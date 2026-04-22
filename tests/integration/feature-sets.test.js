#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { test, withTempDir, report, GIT_SAFE_ENV } = require('../_helpers');
const featureSets = require('../../lib/feature-sets');
const { parseFrontMatter } = require('../../lib/cli-parse');

const FOLDERS = ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused'];
function mkFeaturePaths(root) {
    FOLDERS.forEach(f => fs.mkdirSync(path.join(root, f), { recursive: true }));
    return { root, folders: FOLDERS, prefix: 'feature' };
}
function spec(dir, file, set, dependsOn) {
    const lines = ['---'];
    if (set) lines.push(`set: ${set}`);
    if (dependsOn) lines.push(`depends_on: [${dependsOn.join(', ')}]`);
    lines.push('---', '', `# ${file}`, '');
    fs.writeFileSync(path.join(dir, file), lines.join('\n'));
}

test('isValidSetSlug rejects whitespace, slashes, empty, non-strings', () => {
    assert.strictEqual(featureSets.isValidSetSlug('feature-set-1'), true);
    ['', 'Has Space', 'a/b', '-lead', 'UPPER', null, 5].forEach(v =>
        assert.strictEqual(featureSets.isValidSetSlug(v), false, `bad: ${v}`));
});

test('set: frontmatter survives a plain file move, scanner reads the new stage', () => withTempDir('aigon-set-rt-', (root) => {
    const p = mkFeaturePaths(root);
    spec(path.join(p.root, '01-inbox'), 'feature-example.md', 'auth');
    fs.renameSync(path.join(p.root, '01-inbox', 'feature-example.md'),
                  path.join(p.root, '02-backlog', 'feature-07-example.md'));
    const { data } = parseFrontMatter(fs.readFileSync(path.join(p.root, '02-backlog', 'feature-07-example.md'), 'utf8'));
    assert.strictEqual(data.set, 'auth');
    assert.deepStrictEqual(featureSets.scanFeatureSets(p).get('auth').map(m => [m.paddedId, m.stage]),
        [['07', 'backlog']]);
}));

test('scanner groups tagged, summarises counts, ignores untagged + invalid slugs', () => withTempDir('aigon-set-scan-', (root) => {
    const p = mkFeaturePaths(root);
    spec(path.join(p.root, '02-backlog'),     'feature-01-a.md', 'auth');
    spec(path.join(p.root, '02-backlog'),     'feature-02-b.md', 'auth');
    spec(path.join(p.root, '03-in-progress'), 'feature-03-c.md', 'billing');
    spec(path.join(p.root, '05-done'),        'feature-04-d.md', 'auth');
    spec(path.join(p.root, '02-backlog'),     'feature-05-e.md'); // no set
    spec(path.join(p.root, '02-backlog'),     'feature-06-f.md', 'has/slash');

    const idx = featureSets.scanFeatureSets(p);
    assert.deepStrictEqual([...idx.keys()].sort(), ['auth', 'billing']);
    const auth = featureSets.summarizeSets(p).find(s => s.slug === 'auth');
    assert.strictEqual(auth.memberCount, 3);
    assert.strictEqual(auth.counts.done, 1);
    assert.strictEqual(auth.counts.backlog, 2);
}));

test('getSetMembersSorted topo-sorts intra-set edges, ignores cross-set deps', () => withTempDir('aigon-set-topo-', (root) => {
    const p = mkFeaturePaths(root);
    spec(path.join(p.root, '02-backlog'), 'feature-01-root.md', 'auth');
    spec(path.join(p.root, '02-backlog'), 'feature-02-mid.md',  'auth', ['01']);
    spec(path.join(p.root, '02-backlog'), 'feature-03-leaf.md', 'auth', ['02']);
    spec(path.join(p.root, '02-backlog'), 'feature-09-out.md',  'other');
    spec(path.join(p.root, '02-backlog'), 'feature-04-x.md',    'auth', ['09']);

    const sorted = featureSets.getSetMembersSorted('auth', p).map(m => m.paddedId);
    assert.deepStrictEqual(sorted.slice(0, 3), ['01', '02', '03']);

    const edges = featureSets.getSetDependencyEdges('auth', p);
    assert.ok(edges.some(e => e.from === '02' && e.to === '01'));
    assert.ok(!edges.some(e => e.to === '09'), 'cross-set edge must be excluded');
}));

test('aigon set list / show render tagged specs and fail cleanly on invalid slug', () => withTempDir('aigon-set-cli-', (root) => {
    const fr = path.join(root, 'docs', 'specs', 'features');
    mkFeaturePaths(fr);
    spec(path.join(fr, '02-backlog'), 'feature-01-a.md', 'auth');
    spec(path.join(fr, '02-backlog'), 'feature-02-b.md', 'auth', ['01']);
    const cli = path.join(__dirname, '..', '..', 'aigon-cli.js');
    const run = (args, opts = {}) => execFileSync('node', [cli, ...args],
        { cwd: root, env: { ...process.env, ...GIT_SAFE_ENV }, encoding: 'utf8', ...opts });
    assert.match(run(['set', 'list']), /auth[\s\S]*0\/2/);
    const show = run(['set', 'show', 'auth']);
    assert.match(show, /#01[\s\S]*#02/);
    assert.match(show, /#02 → #01/);
    assert.deepStrictEqual(JSON.parse(run(['set', 'show', 'auth', '--json'])).dependencies, [{ from: '02', to: '01' }]);
    assert.throws(() => run(['set', 'show', 'has/slash'], { stdio: 'pipe' }),
        e => e.status === 1 && /Invalid set slug/.test(String(e.stderr)));
}));

report();
