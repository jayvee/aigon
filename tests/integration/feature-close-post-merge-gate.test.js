#!/usr/bin/env node
'use strict';

// REGRESSION F644: post-merge gate runs on merged main; failure records
// feature.close_gate_failed + close_recovery_in_progress without feature.closed.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { testAsync, withTempDirAsync, report } = require('../_helpers');
const engine = require('../../lib/workflow-core/engine');
const wf = require('../../lib/workflow-core');
const {
    resolvePostMergeGateCommand,
    runPostMergeGate,
    runPostMergeGatePhase,
    recordPostMergeGateFailure,
    isPostMergeGateRetry,
} = require('../../lib/feature-close');
const { resolveCloseIntegrityPolicy } = require('../../lib/close-integrity-policy');
const { readRedMainCondition, recordRedMainFailure } = require('../../lib/red-main-condition');
const { snapshotToDashboardActions } = require('../../lib/workflow-snapshot-adapter');
const REPO_DIRS = [
    'docs/specs/features/03-in-progress',
    'docs/specs/features/logs',
    'docs/specs/features/05-done',
    '.aigon/workflows/features',
    '.aigon/state',
];

function withTempRepo(fn) {
    return withTempDirAsync('aigon-pmg-', async (dir) => {
        for (const sub of REPO_DIRS) fs.mkdirSync(path.join(dir, sub), { recursive: true });
        return fn(dir);
    });
}

function writeSpec(repo, id, name) {
    const specPath = path.join(repo, 'docs', 'specs', 'features', '03-in-progress', `feature-${id}-${name}.md`);
    fs.writeFileSync(specPath, `# Feature: ${name}\n`);
    return specPath;
}

async function bootstrapFeature(repo, id, name) {
    writeSpec(repo, id, name);
    await engine.startFeature(repo, id, 'solo_branch', ['cc']);
    await engine.signalAgentReady(repo, id, 'cc');
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

testAsync('resolvePostMergeGateCommand: false / true / string / unset', async () => {
    const load = (cfg) => () => cfg;
    assert.strictEqual(resolvePostMergeGateCommand('/tmp', load({ featureClose: { postMergeGate: false } })).mode, 'disabled');
    const trueRes = resolvePostMergeGateCommand('/tmp', load({ featureClose: { postMergeGate: true } }), () => 'deploy-cmd');
    assert.strictEqual(trueRes.mode, 'run');
    assert.strictEqual(trueRes.command, 'deploy-cmd');
    const strRes = resolvePostMergeGateCommand('/tmp', load({ featureClose: { postMergeGate: 'make check' } }));
    assert.strictEqual(strRes.command, 'make check');
    assert.strictEqual(resolvePostMergeGateCommand('/tmp', load({})).mode, 'disabled');
});

testAsync('recordPostMergeGateFailure: events + snapshot recovery state', () => withTempRepo(async (repo) => {
    await bootstrapFeature(repo, '01', 'post-merge-gate-fail');
    await recordPostMergeGateFailure(repo, '01', {
        gateCommand: 'node -e "process.exit(1)"',
        exitCode: 1,
        outputTail: 'gate failed tail',
        mergedCommitSha: 'abc123',
        logPath: '.aigon/state/close-gates/feature-01-test.log',
        returnSpecState: 'ready',
    });

    const eventsPath = wf.getEntityWorkflowPaths(repo, 'feature', '01').eventsPath;
    const events = fs.readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const gateEvent = events.find((e) => e.type === 'feature.close_gate_failed');
    assert.ok(gateEvent, 'feature.close_gate_failed must be present');
    assert.strictEqual(gateEvent.exitCode, 1);
    assert.strictEqual(gateEvent.mergedCommitSha, 'abc123');
    assert.ok(events.some((e) => e.type === 'feature.close_recovery.started'));

    const snap = await wf.showFeature(repo, '01');
    assert.strictEqual(snap.currentSpecState, 'close_recovery_in_progress');
    assert.strictEqual(snap.lastCloseFailure.kind, 'post-merge-gate');
    assert.strictEqual(snap.lastCloseFailure.stderrTail, 'gate failed tail');
    assert.ok(isPostMergeGateRetry(snap));
}));

testAsync('REGRESSION: post-merge-gate failure swaps Close for Close with agent', () => withTempRepo(async (repo) => {
    await bootstrapFeature(repo, '02', 'post-merge-gate-actions');
    await recordPostMergeGateFailure(repo, '02', {
        gateCommand: 'npm run test:core',
        exitCode: 1,
        outputTail: 'test failed',
        returnSpecState: 'ready',
    });
    const snap = await wf.showFeature(repo, '02');
    const actions = snapshotToDashboardActions('feature', '02', snap, 'in-progress');
    const agentClose = actions.validActions.find(a => a.action === 'feature-resolve-and-close');
    assert.ok(agentClose, 'should expose feature-resolve-and-close');
    assert.strictEqual(agentClose.label, 'Close with agent');
    assert.ok(!actions.validActions.some(a => a.action === 'feature-close'),
        'plain feature-close must be swapped out');
}));

testAsync('REGRESSION: two merges — first gate passes, second fails when combined markers exist', () => withTempDirAsync('aigon-pmg-merge-', async (root) => {
    for (const sub of REPO_DIRS) fs.mkdirSync(path.join(root, sub), { recursive: true });
    const gateScript = path.join(root, 'scripts', 'post-merge-gate-fixture.js');
    fs.mkdirSync(path.dirname(gateScript), { recursive: true });
    fs.writeFileSync(gateScript, `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const a = fs.existsSync(path.join(root, '.gate-marker-a'));
const b = fs.existsSync(path.join(root, '.gate-marker-b'));
process.exit(a && b ? 1 : 0);
`);
    fs.writeFileSync(path.join(root, '.aigon', 'config.json'), JSON.stringify({
        featureClose: { postMergeGate: 'node scripts/post-merge-gate-fixture.js' },
    }, null, 2));

    const g = seedGitRepo(root);
    g(['checkout', '-b', 'feature-a']);
    fs.writeFileSync(path.join(root, '.gate-marker-a'), 'a\n');
    g(['add', '.']);
    g(['commit', '-m', 'feature a']);
    g(['checkout', 'main']);
    g(['merge', '--no-ff', 'feature-a', '-m', 'merge a']);

    let gate = runPostMergeGate(root, 'a', resolvePostMergeGateCommand(root, () => JSON.parse(fs.readFileSync(path.join(root, '.aigon', 'config.json'), 'utf8'))));
    assert.strictEqual(gate.ok, true, 'first merge alone should pass gate');

    g(['checkout', '-b', 'feature-b']);
    fs.writeFileSync(path.join(root, '.gate-marker-b'), 'b\n');
    g(['add', '.']);
    g(['commit', '-m', 'feature b']);
    g(['checkout', 'main']);
    g(['merge', '--no-ff', 'feature-b', '-m', 'merge b']);

    gate = runPostMergeGate(root, 'b', resolvePostMergeGateCommand(root, () => JSON.parse(fs.readFileSync(path.join(root, '.aigon', 'config.json'), 'utf8'))));
    assert.strictEqual(gate.ok, false, 'combined merge must fail post-merge gate');
    assert.ok(fs.existsSync(gate.logPath), 'full gate log written');
}));

testAsync('happy path: gate pass does not emit close_gate_failed; close clears failure', () => withTempRepo(async (repo) => {
    await bootstrapFeature(repo, '02', 'post-merge-gate-pass');
    const pass = runPostMergeGate(repo, '02', { command: process.platform === 'win32' ? 'node -e "process.exit(0)"' : 'true' });
    assert.strictEqual(pass.ok, true);

    const eventsBefore = fs.readFileSync(wf.getEntityWorkflowPaths(repo, 'feature', '02').eventsPath, 'utf8');
    assert.ok(!eventsBefore.includes('feature.close_gate_failed'));

    await engine.closeFeatureWithEffects(repo, '02', async () => {});
    const snap = await wf.showFeature(repo, '02');
    assert.strictEqual(snap.currentSpecState, 'done');
    assert.strictEqual(snap.lastCloseFailure, null);
}));

testAsync('runPostMergeGatePhase: advisory failure records red-main without recovery', () => withTempRepo(async (repo) => {
    await bootstrapFeature(repo, '03', 'advisory-pmg');
    fs.writeFileSync(path.join(repo, '.aigon', 'config.json'), JSON.stringify({
        featureClose: { postMergeGate: 'node -e "process.exit(1)"' },
    }, null, 2));
    const loadProjectConfig = () => JSON.parse(fs.readFileSync(path.join(repo, '.aigon', 'config.json'), 'utf8'));
    const result = await runPostMergeGatePhase(
        { repoPath: repo, name: '03', num: '03' },
        {
            loadProjectConfig,
            resolveDeployCommand: () => null,
            integrityPolicy: resolveCloseIntegrityPolicy(loadProjectConfig()),
        },
    );
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.advisory, true);
    const red = readRedMainCondition(repo);
    assert.ok(red && red.active);
    assert.strictEqual(red.firstSeenFeatureId, '03');
    const snap = await wf.showFeature(repo, '03');
    assert.notStrictEqual(snap.currentSpecState, 'close_recovery_in_progress');
    const events = fs.readFileSync(wf.getEntityWorkflowPaths(repo, 'feature', '03').eventsPath, 'utf8');
    assert.ok(events.includes('feature.close_finding_advisory'));
    assert.ok(!events.includes('feature.close_gate_failed'));
}));

testAsync('runPostMergeGatePhase: passing gate clears red-main', () => withTempRepo(async (repo) => {
    await bootstrapFeature(repo, '04', 'advisory-pmg-clear');
    recordRedMainFailure(repo, { featureId: '04', gateCommand: 'node -e "process.exit(1)"' });
    const loadProjectConfig = () => ({ featureClose: { postMergeGate: process.platform === 'win32' ? 'node -e "process.exit(0)"' : 'true' } });
    const result = await runPostMergeGatePhase(
        { repoPath: repo, name: '04', num: '04' },
        {
            loadProjectConfig,
            resolveDeployCommand: () => null,
            integrityPolicy: resolveCloseIntegrityPolicy({}),
        },
    );
    assert.strictEqual(result.ok, true);
    assert.strictEqual(readRedMainCondition(repo), null);
}));

testAsync('runPostMergeGatePhase: strict policy still enters recovery', () => withTempRepo(async (repo) => {
    await bootstrapFeature(repo, '05', 'blocking-pmg');
    const loadProjectConfig = () => ({ featureClose: { postMergeGate: 'node -e "process.exit(1)"', integrityPolicy: 'blocking' } });
    const result = await runPostMergeGatePhase(
        { repoPath: repo, name: '05', num: '05' },
        {
            loadProjectConfig,
            resolveDeployCommand: () => null,
            integrityPolicy: resolveCloseIntegrityPolicy(loadProjectConfig()),
        },
    );
    assert.strictEqual(result.ok, false);
    const snap = await wf.showFeature(repo, '05');
    assert.strictEqual(snap.currentSpecState, 'close_recovery_in_progress');
}));

report();
