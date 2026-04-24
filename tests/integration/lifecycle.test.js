#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');
const { test, testAsync, withTempDir, withTempDirAsync, report } = require('../_helpers');
const engine = require('../../lib/workflow-core/engine');
const { snapshotToDashboardActions } = require('../../lib/workflow-snapshot-adapter');

const REPO_DIRS = [
    'docs/specs/features/03-in-progress',
    'docs/specs/features/logs',
    'docs/specs/features/05-done',
    '.aigon/workflows/features',
    '.aigon/state',
];
const RESEARCH_REPO_DIRS = [
    'docs/specs/research-topics/04-in-evaluation',
    'docs/specs/research-topics/05-done',
    'docs/specs/research-topics/logs',
];

function withTempRepo(fn) {
    return withTempDirAsync('aigon-lifecycle-', async (dir) => {
        for (const sub of REPO_DIRS) fs.mkdirSync(path.join(dir, sub), { recursive: true });
        return fn(dir);
    });
}

function writeSpec(repoPath, featureId, name) {
    const specPath = path.join(repoPath, 'docs', 'specs', 'features', '03-in-progress', `feature-${featureId}-${name}.md`);
    fs.writeFileSync(specPath, `# Feature: ${name}\n`);
    return specPath;
}

function writeResearchSpec(repoPath, researchId, name) {
    const specPath = path.join(repoPath, 'docs', 'specs', 'research-topics', '04-in-evaluation', `research-${researchId}-${name}.md`);
    fs.writeFileSync(specPath, `---\ntitle: ${name}\n---\n\n# Research: ${name}\n`);
    return specPath;
}

const getActions = (snap, id) => snapshotToDashboardActions('feature', id, snap);
const hasAction = (actions, name) => actions.validActions.some(a => a.action === name);

for (const [label, agentId, featureId] of [['cc', 'cc', '01'], ['solo', 'solo', '03']]) {
    testAsync(`solo(${label}): start → ready → close transitions cleanly`, () => withTempRepo(async (repo) => {
        writeSpec(repo, featureId, `solo-${label}`);
        await engine.startFeature(repo, featureId, 'solo_branch', [agentId]);
        const ready = await engine.signalAgentReady(repo, featureId, agentId);
        const actions = getActions(ready, featureId);
        assert.ok(hasAction(actions, 'feature-close'));
        assert.ok(hasAction(actions, 'feature-pause'));
        const closed = await engine.closeFeatureWithEffects(repo, featureId, async () => {});
        assert.strictEqual(closed.lifecycle, 'done');
        assert.strictEqual(getActions(closed, featureId).validActions.length, 0);
    }));
}

testAsync('canCloseFeature blocks pre-close when no agent has signaled', () => withTempRepo(async (repo) => {
    writeSpec(repo, '04', 'solo-not-ready');
    await engine.startFeature(repo, '04', 'solo_branch', ['solo']);
    const closable = await engine.canCloseFeature(repo, '04');
    assert.strictEqual(closable.ok, false);
    assert.match(closable.reason, /not ready to close/);
}));

testAsync('canCloseFeature blocks while spec reviews are still pending', () => withTempRepo(async (repo) => {
    writeSpec(repo, '14', 'pending-spec-review');
    await engine.startFeature(repo, '14', 'solo_branch', ['solo']);
    await engine.signalAgentReady(repo, '14', 'solo');
    await engine.recordSpecReviewSubmitted(repo, 'feature', '14', {
        reviewId: 'sha-review-1',
        reviewerId: 'gg',
        summary: 'tighten scope',
        commitSha: 'sha-review-1',
    });
    const closable = await engine.canCloseFeature(repo, '14');
    assert.strictEqual(closable.ok, false);
    assert.match(closable.reason, /feature-spec-revise 14/);
}));

testAsync('recoverEmptyAgents heals legacy agents:[] features', () => withTempRepo(async (repo) => {
    writeSpec(repo, '05', 'legacy-broken');
    await engine.startFeature(repo, '05', 'solo_branch', []);
    let snap = await engine.showFeature(repo, '05');
    assert.strictEqual(Object.keys(snap.agents).length, 0);
    const close = require('../../lib/feature-close');
    snap = await close.recoverEmptyAgents(repo, '05', snap);
    assert.strictEqual(snap.agents.solo.status, 'ready');
    assert.ok((await engine.canCloseFeature(repo, '05')).ok);
}));

test('prioritise writes workflow snapshot (F270 1c2766bc)', () => withTempDir('aigon-prio-', (repo) => {
    const specPath = path.join(repo, 'docs/specs/features/02-backlog/feature-06-x.md');
    fs.mkdirSync(path.dirname(specPath), { recursive: true });
    fs.writeFileSync(specPath, '# feature-06\n');
    engine.ensureEntityBootstrappedSync(repo, 'feature', '06', 'backlog', specPath);
    const snap = JSON.parse(fs.readFileSync(path.join(repo, '.aigon/workflows/features/06/snapshot.json'), 'utf8'));
    assert.strictEqual(snap.entityType, 'feature');
    assert.strictEqual(snap.featureId, '06');
    assert.strictEqual(snap.lifecycle, 'backlog');
    assert.strictEqual(snap.currentSpecState, 'backlog');
    const eventsBefore = fs.readFileSync(path.join(repo, '.aigon/workflows/features/06/events.jsonl'), 'utf8');
    engine.ensureEntityBootstrappedSync(repo, 'feature', '06', 'backlog', specPath);
    assert.strictEqual(fs.readFileSync(path.join(repo, '.aigon/workflows/features/06/events.jsonl'), 'utf8'), eventsBefore);
}));

testAsync('fleet: start → both ready → eval → select winner → close', () => withTempRepo(async (repo) => {
    writeSpec(repo, '02', 'fleet-test');
    await engine.startFeature(repo, '02', 'fleet', ['cc', 'gg']);
    await engine.signalAgentReady(repo, '02', 'cc');
    const ready = await engine.signalAgentReady(repo, '02', 'gg');
    assert.ok(hasAction(getActions(ready, '02'), 'feature-eval'));
    const evalSnap = await engine.requestFeatureEval(repo, '02');
    assert.strictEqual(evalSnap.lifecycle, 'evaluating');
    const pickers = getActions(evalSnap, '02').validActions.filter(a => a.action === 'select-winner');
    assert.ok(pickers.length > 0);
    const winner = await engine.selectWinner(repo, '02', 'cc');
    assert.strictEqual(winner.winnerAgentId, 'cc');
    const closed = await engine.closeFeatureWithEffects(repo, '02', async () => {});
    assert.strictEqual(closed.lifecycle, 'done');
}));

testAsync('pause → resume lifecycle', () => withTempRepo(async (repo) => {
    writeSpec(repo, '03', 'pause-test');
    await engine.startFeature(repo, '03', 'solo_branch', ['cc']);
    const paused = await engine.pauseFeature(repo, '03');
    assert.strictEqual(paused.currentSpecState, 'paused');
    assert.ok(hasAction(getActions(paused, '03'), 'feature-resume'));
    assert.ok(!hasAction(getActions(paused, '03'), 'feature-pause'));
    const resumed = await engine.resumeFeature(repo, '03');
    assert.strictEqual(resumed.currentSpecState, 'implementing');
    assert.ok(hasAction(getActions(resumed, '03'), 'feature-pause'));
}));

test('telemetry aggregator keeps feature-close normalization invariants', () => withTempDir('aigon-tel-', (repo) => {
    const telemetry = require('../../lib/telemetry');
    for (const [sessionId, activity, tokenUsage, costUsd] of [['sess-a', 'implement', { input: 100, output: 200, cacheReadInput: 50, cacheCreationInput: 25, thinking: 10, total: 385, billable: 310 }, 0.42], ['sess-b', 'review', { input: 50, output: 80, cacheReadInput: 0, cacheCreationInput: 0, thinking: 0, total: 130, billable: 130 }, 0.13]]) telemetry.writeNormalizedTelemetryRecord({ source: 'claude-transcript', sessionId, entityType: 'feature', featureId: '777', repoPath: repo, agent: 'cc', activity, model: 'claude-opus-4-6', startAt: '2026-04-07T00:00:00Z', endAt: '2026-04-07T01:00:00Z', tokenUsage, costUsd }, { repoPath: repo });
    telemetry.writeAgentFallbackSession('777', 'cc', { repoPath: repo, source: 'feature-close-fallback', sessionId: 'fallback-close-record' });
    const agg = telemetry.aggregateNormalizedTelemetryRecords('777', 'cc', { repoPath: repo, linesChanged: 50 });
    assert.deepStrictEqual([agg.sessions, agg.input_tokens, agg.billable_tokens, agg.cost_usd, agg.model], [2, 150, 440, 0.55, 'claude-opus-4-6']); assert.strictEqual(telemetry.aggregateNormalizedTelemetryRecords('777', 'solo', { repoPath: repo }).sessions, 2);
    assert.strictEqual(telemetry.aggregateNormalizedTelemetryRecords('999', 'cc', { repoPath: repo }), null);
}));

test('research close finalizer stages engine-moved spec and commits it', () => withTempDir('aigon-research-close-', (repo) => {
    for (const sub of RESEARCH_REPO_DIRS) fs.mkdirSync(path.join(repo, sub), { recursive: true });
    execSync('git init -q', { cwd: repo });
    execSync('git config user.email t@t', { cwd: repo });
    execSync('git config user.name t', { cwd: repo });

    const initialSpec = writeResearchSpec(repo, '24', 'close-test');
    const findingsPath = path.join(repo, 'docs', 'specs', 'research-topics', 'logs', 'research-24-cc-findings.md');
    fs.writeFileSync(findingsPath, '# Findings\n');
    execSync('git add . && git commit -qm init', { cwd: repo });

    const doneSpecPath = path.join(repo, 'docs', 'specs', 'research-topics', '05-done', path.basename(initialSpec));
    fs.renameSync(initialSpec, doneSpecPath);

    const script = `
        const entity = require(${JSON.stringify(path.join(__dirname, '../../lib/entity'))});
        const utils = require(${JSON.stringify(path.join(__dirname, '../../lib/utils'))});
        const { execSync } = require('child_process');
        const runGit = (command) => execSync(command, { cwd: process.cwd(), stdio: 'pipe' });
        entity.entityCloseFinalize(entity.RESEARCH_DEF, { num: '24', fromFolder: '04-in-evaluation' }, {
            utils, git: { runGit },
        });
    `;
    execFileSync(process.execPath, ['-e', script], { cwd: repo, stdio: 'pipe' });

    assert.strictEqual(
        execSync('git log --format=%s -1', { cwd: repo }).toString().trim(),
        'chore: complete research 24 - move spec to done'
    );
    const nameStatus = execSync('git show --name-status --format= HEAD', { cwd: repo }).toString();
    assert.match(nameStatus, /D\tdocs\/specs\/research-topics\/04-in-evaluation\/research-24-close-test\.md/);
    assert.match(nameStatus, /A\tdocs\/specs\/research-topics\/05-done\/research-24-close-test\.md/);
    assert.match(fs.readFileSync(doneSpecPath, 'utf8'), /transitions:\n  - \{ from: "in-evaluation", to: "done"/);
}));

testAsync('getMainRepoPath returns repo root from a subdirectory', () => withTempDirAsync('aigon-git-', async (dir) => {
    const gitLib = require('../../lib/git');
    execSync('git init -q', { cwd: dir });
    execSync('git config user.email t@t', { cwd: dir });
    execSync('git config user.name t', { cwd: dir });
    fs.writeFileSync(path.join(dir, 'README.md'), 'x');
    execSync('git add . && git commit -qm init', { cwd: dir });
    fs.mkdirSync(path.join(dir, 'a', 'b', 'c'), { recursive: true });
    // fs.realpathSync resolves /private/var → /var on macOS so the assert is stable.
    assert.strictEqual(fs.realpathSync(gitLib.getMainRepoPath(path.join(dir, 'a', 'b', 'c'))), fs.realpathSync(dir));
    assert.strictEqual(fs.realpathSync(gitLib.getMainRepoPath(dir)), fs.realpathSync(dir));
}));

report();
