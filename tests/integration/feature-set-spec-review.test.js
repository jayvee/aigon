#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { test, withTempDir, GIT_SAFE_ENV } = require('../_helpers');
const featureSets = require('../../lib/feature-sets');
const { buildSetValidActions } = require('../../lib/feature-set-workflow-rules');
const {
    countReviewableSetMembers,
    countLaunchableSetSpecReviewMembers,
    resolveSetSpecReviewPlan,
    buildSetSpecReviewPromptBody,
    isSetMemberReviewable,
} = require('../../lib/feature-set-spec-review');

const FOLDERS = ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused'];

function mkFeaturePaths(root) {
    const base = path.join(root, 'docs', 'specs', 'features');
    FOLDERS.forEach(f => fs.mkdirSync(path.join(base, f), { recursive: true }));
    return { root: base, folders: FOLDERS, prefix: 'feature' };
}

function spec(dir, file, set, dependsOn, bodyLines = []) {
    const lines = ['---'];
    if (set) lines.push(`set: ${set}`);
    if (dependsOn) lines.push(`depends_on: [${dependsOn.join(', ')}]`);
    lines.push('---', '', `# ${file}`, ...bodyLines, '');
    fs.writeFileSync(path.join(dir, file), lines.join('\n'));
}

function initRepo(root) {
    const env = { ...process.env, ...GIT_SAFE_ENV };
    const g = (args) => execFileSync('git', args, { cwd: root, env, stdio: 'pipe' });
    g(['init']);
    g(['config', 'user.email', 'test@aigon.test']);
    g(['config', 'user.name', 'Aigon Test']);
    fs.writeFileSync(path.join(root, '.gitkeep'), '');
    g(['add', '.gitkeep']);
    g(['commit', '-m', 'chore: init test repo']);
}

function runCli(root, args, opts = {}) {
    const cli = path.join(__dirname, '..', '..', 'aigon-cli.js');
    return execFileSync('node', [cli, ...args], {
        cwd: root,
        env: { ...process.env, ...GIT_SAFE_ENV, ...(opts.env || {}) },
        encoding: 'utf8',
        ...opts,
    });
}

test('isSetMemberReviewable accepts inbox/backlog and rejects done/in-progress', () => {
    assert.strictEqual(isSetMemberReviewable({ stage: 'inbox' }), true);
    assert.strictEqual(isSetMemberReviewable({ stage: 'backlog' }), true);
    assert.strictEqual(isSetMemberReviewable({ stage: 'done' }), false);
    assert.strictEqual(isSetMemberReviewable({ stage: 'in-progress' }), false);
});

test('countReviewableSetMembers ignores done and in-progress members', () => {
    const members = [
        { stage: 'backlog', paddedId: '01' },
        { stage: 'inbox' },
        { stage: 'done' },
        { stage: 'in-progress' },
    ];
    assert.strictEqual(countReviewableSetMembers(members), 2);
    assert.strictEqual(countLaunchableSetSpecReviewMembers(members), 1);
});

test('resolveSetSpecReviewPlan topo-orders reviewable members and builds prompt payload', () => withTempDir('aigon-set-spec-review-plan-', (root) => {
    initRepo(root);
    const p = mkFeaturePaths(root);
    spec(path.join(p.root, '02-backlog'), 'feature-01-root.md', 'auth', null, ['## Summary', 'Root spec']);
    spec(path.join(p.root, '02-backlog'), 'feature-02-leaf.md', 'auth', ['01'], ['## Summary', 'Leaf spec']);
    spec(path.join(p.root, '05-done'), 'feature-03-done.md', 'auth', null, ['## Summary', 'Done spec']);
    spec(path.join(p.root, '03-in-progress'), 'feature-04-active.md', 'auth', null, ['## Summary', 'Active spec']);

    const plan = resolveSetSpecReviewPlan(root, 'auth', p);
    assert.ifError(plan.error);
    assert.strictEqual(plan.reviewable.length, 2);
    assert.deepStrictEqual(plan.reviewable.map(m => m.paddedId), ['01', '02']);
    assert.strictEqual(plan.anchor.paddedId, '01');

    const prompt = buildSetSpecReviewPromptBody(plan, 'cx');
    assert.match(prompt, /set slug.*auth/i);
    assert.match(prompt, /#01[\s\S]*#02/);
    assert.match(prompt, /#02 → #01/);
    assert.match(prompt, /Root spec/);
    assert.match(prompt, /Leaf spec/);
    assert.doesNotMatch(prompt, /Done spec/);
    assert.doesNotMatch(prompt, /Active spec/);
    assert.match(prompt, /spec-review: feature/);
    assert.match(prompt, /feature-spec-review-record/);
}));

test('feature-set-spec-review CLI rejects invalid slug and empty reviewable set', () => withTempDir('aigon-set-spec-review-cli-', (root) => {
    initRepo(root);
    const p = mkFeaturePaths(root);
    spec(path.join(p.root, '03-in-progress'), 'feature-01-only.md', 'solo');

    assert.throws(
        () => runCli(root, ['feature-set-spec-review', 'bad slug'], { stdio: 'pipe' }),
        e => e.status === 1 && /Invalid set slug/.test(String(e.stderr))
    );
    assert.throws(
        () => runCli(root, ['feature-set-spec-review', 'solo'], { stdio: 'pipe' }),
        e => e.status === 1 && /no reviewable members/i.test(String(e.stderr))
    );
}));

test('feature-set-spec-review --no-launch prints ordered set context', () => withTempDir('aigon-set-spec-review-nolaunch-', (root) => {
    initRepo(root);
    const p = mkFeaturePaths(root);
    spec(path.join(p.root, '02-backlog'), 'feature-01-a.md', 'pair');
    spec(path.join(p.root, '02-backlog'), 'feature-02-b.md', 'pair', ['01']);

    const out = runCli(root, ['feature-set-spec-review', 'pair', '--no-launch', '--agent=cx']);
    assert.match(out, /2 reviewable member/i);
    assert.match(out, /SET SPEC REVIEW PROMPT/);
    assert.match(out, /#01[\s\S]*#02/);
}));

test('buildSetValidActions exposes feature-set-spec-review when reviewableMemberCount > 0', () => {
    // REGRESSION: dashboard must not branch on member state client-side — server owns enablement.
    const actions = buildSetValidActions({
        slug: 'auth',
        status: 'idle',
        isComplete: false,
        inboxMemberCount: 0,
        reviewableMemberCount: 2,
        launchableSpecReviewMemberCount: 2,
    });
    const review = actions.find(a => a.action === 'feature-set-spec-review');
    assert.ok(review);
    assert.strictEqual(review.requiresInput, 'agentPicker');
    const hidden = buildSetValidActions({
        slug: 'auth',
        status: 'idle',
        isComplete: false,
        reviewableMemberCount: 0,
        launchableSpecReviewMemberCount: 0,
    });
    assert.ok(!hidden.some(a => a.action === 'feature-set-spec-review'));
    const inboxOnly = buildSetValidActions({
        slug: 'auth',
        status: 'idle',
        isComplete: false,
        reviewableMemberCount: 2,
        launchableSpecReviewMemberCount: 0,
    });
    assert.ok(!inboxOnly.some(a => a.action === 'feature-set-spec-review'));
});

test('getSetMembersSorted remains the ordering source for set spec review', () => withTempDir('aigon-set-spec-review-order-', (root) => {
    const p = mkFeaturePaths(root);
    spec(path.join(p.root, '02-backlog'), 'feature-03-leaf.md', 'order', ['02']);
    spec(path.join(p.root, '02-backlog'), 'feature-01-root.md', 'order');
    spec(path.join(p.root, '02-backlog'), 'feature-02-mid.md', 'order', ['01']);
    const sorted = featureSets.getSetMembersSorted('order', p).map(m => m.paddedId);
    assert.deepStrictEqual(sorted, ['01', '02', '03']);
    const plan = resolveSetSpecReviewPlan(root, 'order', p);
    assert.deepStrictEqual(plan.reviewable.map(m => m.paddedId), sorted);
}));
