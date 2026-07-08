#!/usr/bin/env node
'use strict';

// REGRESSION F631: invented Pre-authorised-by footer with no spec grant blocks close.
// REGRESSION F645: valid slug passes; footer-less feature unaffected; bypass records event.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { testAsync, withTempDirAsync, report } = require('../_helpers');
const engine = require('../../lib/workflow-core/engine');
const wf = require('../../lib/workflow-core');
const {
    validatePreauthorisations,
    parsePreauthEntries,
    extractPreauthFootersFromRange,
} = require('../../lib/spec-preauth');
const {
    recordPreauthValidationFailure,
    recordPreauthBypass,
    isPreauthValidationRetry,
} = require('../../lib/feature-close');

const REPO_DIRS = [
    'docs/specs/features/03-in-progress',
    'docs/specs/features/logs',
    '.aigon/workflows/features',
    '.aigon/state',
];

function withTempRepo(fn) {
    return withTempDirAsync('aigon-preauth-close-', async (dir) => {
        for (const sub of REPO_DIRS) fs.mkdirSync(path.join(dir, sub), { recursive: true });
        return fn(dir);
    });
}

function seedGitRepo(root) {
    const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
    const g = (args) => execFileSync('git', args, { cwd: root, env, stdio: 'pipe' });
    g(['init']);
    g(['config', 'user.email', 't@a.test']);
    g(['config', 'user.name', 'T']);
    g(['checkout', '-b', 'main']);
    fs.writeFileSync(path.join(root, 'README.md'), 'base\n');
    g(['add', '.']);
    g(['commit', '-m', 'base']);
    return g;
}

function writeSpec(repo, id, name, preauthLines = []) {
    const preauthBlock = preauthLines.length
        ? `\n## Pre-authorised\n${preauthLines.map((line) => `- ${line}`).join('\n')}\n`
        : '';
    const specPath = path.join(repo, 'docs', 'specs', 'features', '03-in-progress', `feature-${id}-${name}.md`);
    fs.writeFileSync(specPath, `---\ncomplexity: low\n---\n# Feature: ${name}\n${preauthBlock}\n## Validation\nx\n`);
    return specPath;
}

async function bootstrapFeature(repo, id, name, preauthLines) {
    writeSpec(repo, id, name, preauthLines);
    await engine.startFeature(repo, id, 'solo_branch', ['cc']);
    await engine.signalAgentReady(repo, id, 'cc');
}

testAsync('parsePreauthEntries + validatePreauthorisations: valid slug passes', () => withTempRepo(async (repo) => {
    const g = seedGitRepo(repo);
    const line = 'May skip npm run test:ui for lib-only changes';
    const specPath = writeSpec(repo, '01', 'preauth-pass', [line]);
    const entries = parsePreauthEntries(specPath);
    assert.strictEqual(entries.length, 1);
    assert.ok(entries[0].slug.includes('skip-npm-run-test-ui'));

    g(['checkout', '-b', 'feature-01-preauth-pass']);
    fs.writeFileSync(path.join(repo, 'lib-demo.js'), 'x\n');
    g(['add', 'lib-demo.js']);
    g(['commit', '-m', 'feat: demo', '--trailer', `Pre-authorised-by: ${entries[0].slug}`]);

    const result = validatePreauthorisations(specPath, repo, 'main', 'HEAD');
    assert.strictEqual(result.ok, true, 'listed slug must pass');
    assert.strictEqual(result.matched.length, 1);
    assert.strictEqual(result.unmatched.length, 0);
}));

testAsync('REGRESSION F631: invented slug blocks with actionable unmatched list', () => withTempRepo(async (repo) => {
    const g = seedGitRepo(repo);
    const specPath = writeSpec(repo, '02', 'preauth-fail');
    await bootstrapFeature(repo, '02', 'preauth-fail');

    g(['checkout', '-b', 'feature-02-preauth-fail']);
    fs.writeFileSync(path.join(repo, 'lib-demo.js'), 'x\n');
    g(['add', 'lib-demo.js']);
    g(['commit', '-m', 'feat: demo', '--trailer', 'Pre-authorised-by: iterate-gate-static-guards-preexisting']);

    const result = validatePreauthorisations(specPath, repo, 'main', 'HEAD');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.unmatched.length, 1);
    assert.strictEqual(result.unmatched[0].slug, 'iterate-gate-static-guards-preexisting');
}));

testAsync('footer-less feature unaffected by validation', () => withTempRepo(async (repo) => {
    const g = seedGitRepo(repo);
    const specPath = writeSpec(repo, '03', 'no-footers');
    g(['checkout', '-b', 'feature-03-no-footers']);
    fs.writeFileSync(path.join(repo, 'lib-demo.js'), 'x\n');
    g(['add', 'lib-demo.js']);
    g(['commit', '-m', 'feat: no preauth footer']);

    const result = validatePreauthorisations(specPath, repo, 'main', 'HEAD');
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.footers.length, 0);
}));

testAsync('recordPreauthValidationFailure: close_recovery + preauth kind', () => withTempRepo(async (repo) => {
    await bootstrapFeature(repo, '04', 'preauth-recovery');
    await recordPreauthValidationFailure(repo, '04', {
        unmatched: [{ slug: 'invented-slug', sha: 'abc1234' }],
        outputTail: 'preauth failed',
        returnSpecState: 'ready',
    });

    const eventsPath = wf.getEntityWorkflowPaths(repo, 'feature', '04').eventsPath;
    const events = fs.readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const gateEvent = events.find((e) => e.type === 'feature.close_gate_failed');
    assert.ok(gateEvent);
    assert.strictEqual(gateEvent.gateKind, 'preauth-validation');
    assert.ok(events.some((e) => e.type === 'feature.close_recovery.started'));

    const snap = await wf.showFeature(repo, '04');
    assert.strictEqual(snap.currentSpecState, 'close_recovery_in_progress');
    assert.strictEqual(snap.lastCloseFailure.kind, 'preauth-validation');
    assert.ok(isPreauthValidationRetry(snap));
}));

testAsync('escape hatch records feature.preauthorisation_validation_bypassed', () => withTempRepo(async (repo) => {
    await bootstrapFeature(repo, '05', 'preauth-bypass');
    await recordPreauthBypass(repo, '05');
    const eventsPath = wf.getEntityWorkflowPaths(repo, 'feature', '05').eventsPath;
    const events = fs.readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.ok(events.some((e) => e.type === 'feature.preauthorisation_validation_bypassed'));
}));

testAsync('extractPreauthFootersFromRange: parses commit trailers', () => withTempRepo(async (repo) => {
    const g = seedGitRepo(repo);
    g(['checkout', '-b', 'feature-footers']);
    fs.writeFileSync(path.join(repo, 'x.js'), '1\n');
    g(['add', 'x.js']);
    g(['commit', '-m', 'test', '--trailer', 'Pre-authorised-by: my-slug']);
    const footers = extractPreauthFootersFromRange(repo, 'main', 'HEAD');
    assert.strictEqual(footers.length, 1);
    assert.strictEqual(footers[0].slug, 'my-slug');
}));

report();
