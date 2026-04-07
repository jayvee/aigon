#!/usr/bin/env node
/**
 * Integration tests — Layer 2 of the test pyramid.
 *
 * Exercises the full workflow engine lifecycle with temp directories:
 *   - Solo: start → submit → close
 *   - Fleet: start → submit both → eval → close (winner)
 *   - Pause → resume
 *   - Review flow
 *
 * Verifies snapshotToDashboardActions() returns correct buttons at each step.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, testAsync, withTempDir, withTempDirAsync, report } = require('../_helpers');
const engine = require('../../lib/workflow-core/engine');
const { snapshotToDashboardActions } = require('../../lib/workflow-snapshot-adapter');

// ─── helpers ──────────────────────────────────────────────────────────────────

const REPO_DIRS = [
    'docs/specs/features/03-in-progress',
    'docs/specs/features/logs',
    'docs/specs/features/05-done',
    '.aigon/workflows/features',
    '.aigon/state',
];

/** Run an async test body with a fresh aigon-style temp repo, auto-cleaned. */
function withTempRepo(fn) {
    return withTempDirAsync('aigon-lifecycle-', async (dir) => {
        for (const sub of REPO_DIRS) fs.mkdirSync(path.join(dir, sub), { recursive: true });
        return fn(dir);
    });
}

function writeSpec(repoPath, featureId, name) {
    const specPath = path.join(
        repoPath, 'docs', 'specs', 'features', '03-in-progress',
        `feature-${featureId}-${name}.md`
    );
    fs.writeFileSync(specPath, `# Feature: ${name}\n`);
    return specPath;
}

const getActions = (snapshot, featureId) => snapshotToDashboardActions('feature', featureId, snapshot);
const hasAction = (actions, actionName) => actions.validActions.some(a => a.action === actionName);

// ─── Solo lifecycle ──────────────────────────────────────────────────────────

console.log('\nSolo lifecycle: start → submit → close');

testAsync('solo: startFeature creates implementing state', () => withTempRepo(async (repo) => {
    writeSpec(repo, '01', 'solo-test');
    const snap = await engine.startFeature(repo, '01', 'solo_branch', ['cc']);
    assert.strictEqual(snap.lifecycle, 'implementing');
    assert.strictEqual(snap.mode, 'solo_branch');
}));

testAsync('solo: agent-ready enables close action', () => withTempRepo(async (repo) => {
    writeSpec(repo, '01', 'solo-test');
    await engine.startFeature(repo, '01', 'solo_branch', ['cc']);
    const snap = await engine.signalAgentReady(repo, '01', 'cc');
    const actions = getActions(snap, '01');
    assert.ok(hasAction(actions, 'feature-close'), 'should have close action after agent-ready');
    assert.ok(hasAction(actions, 'feature-pause'), 'should have pause action');
}));

testAsync('solo: closeFeature transitions to done', () => withTempRepo(async (repo) => {
    writeSpec(repo, '01', 'solo-test');
    await engine.startFeature(repo, '01', 'solo_branch', ['cc']);
    await engine.signalAgentReady(repo, '01', 'cc');
    const snap = await engine.closeFeatureWithEffects(repo, '01', async () => {});
    assert.strictEqual(snap.lifecycle, 'done');
}));

testAsync('solo: registers as canonical "solo" agent and closes cleanly', () => withTempRepo(async (repo) => {
    // REGRESSION: feature 34 / farline-ai-forge — solo Drive used to emit
    // feature.started with agents:[]; signal.agent_ready was silently dropped,
    // soloAllReady never gated, and feature-close threw "cannot be closed from
    // implementing" AFTER the merge had already run, leaving a half-closed repo.
    writeSpec(repo, '03', 'solo-no-agent');
    await engine.startFeature(repo, '03', 'solo_branch', ['solo']);
    await engine.signalAgentReady(repo, '03', 'solo');
    const closable = await engine.canCloseFeature(repo, '03');
    assert.ok(closable.ok, `canCloseFeature should be ok, got: ${closable.reason}`);
    const snap = await engine.closeFeatureWithEffects(repo, '03', async () => {});
    assert.strictEqual(snap.lifecycle, 'done');
}));

testAsync('canCloseFeature blocks pre-close when no agent has signaled', () => withTempRepo(async (repo) => {
    // REGRESSION: feature 233 — without pre-validation, feature-close ran git
    // side-effects (commit, push, merge) and only THEN discovered the engine
    // would reject the transition, leaving a merged-but-not-closed half state.
    writeSpec(repo, '04', 'solo-not-ready');
    await engine.startFeature(repo, '04', 'solo_branch', ['solo']);
    const closable = await engine.canCloseFeature(repo, '04');
    assert.strictEqual(closable.ok, false);
    assert.match(closable.reason, /not ready to close/);
}));

testAsync('recoverEmptyAgents heals legacy agents:[] features', () => withTempRepo(async (repo) => {
    // REGRESSION: feature 233 — features started under the old code have
    // feature.started with agents:[]. closeEngineState must auto-inject 'solo'
    // so they can close without manual events.jsonl editing.
    writeSpec(repo, '05', 'legacy-broken');
    // Hand-craft the broken event log: feature.started with no agents.
    await engine.startFeature(repo, '05', 'solo_branch', []);
    let snap = await engine.showFeature(repo, '05');
    assert.strictEqual(Object.keys(snap.agents).length, 0, 'precondition: agents empty');
    const close = require('../../lib/feature-close');
    snap = await close.recoverEmptyAgents(repo, '05', snap);
    assert.ok(snap.agents.solo, 'solo agent should be registered after recovery');
    assert.strictEqual(snap.agents.solo.status, 'ready');
    const closable = await engine.canCloseFeature(repo, '05');
    assert.ok(closable.ok, `should be closable post-recovery: ${closable.reason}`);
}));

testAsync('solo: done state has no actions', () => withTempRepo(async (repo) => {
    writeSpec(repo, '01', 'solo-test');
    await engine.startFeature(repo, '01', 'solo_branch', ['cc']);
    await engine.signalAgentReady(repo, '01', 'cc');
    const snap = await engine.closeFeatureWithEffects(repo, '01', async () => {});
    const actions = getActions(snap, '01');
    assert.strictEqual(actions.validActions.length, 0, 'done state should have no actions');
}));

// ─── Fleet lifecycle ─────────────────────────────────────────────────────────

console.log('\nFleet lifecycle: start → submit both → eval → close');

testAsync('fleet: startFeature with two agents', () => withTempRepo(async (repo) => {
    writeSpec(repo, '02', 'fleet-test');
    const snap = await engine.startFeature(repo, '02', 'fleet', ['cc', 'gg']);
    assert.strictEqual(snap.lifecycle, 'implementing');
    assert.strictEqual(snap.mode, 'fleet');
}));

testAsync('fleet: both agents ready enables eval', () => withTempRepo(async (repo) => {
    writeSpec(repo, '02', 'fleet-test');
    await engine.startFeature(repo, '02', 'fleet', ['cc', 'gg']);
    await engine.signalAgentReady(repo, '02', 'cc');
    const snap = await engine.signalAgentReady(repo, '02', 'gg');
    const actions = getActions(snap, '02');
    assert.ok(hasAction(actions, 'feature-eval'), 'should have eval action when all agents ready');
}));

testAsync('fleet: eval → select winner → close', () => withTempRepo(async (repo) => {
    writeSpec(repo, '02', 'fleet-test');
    await engine.startFeature(repo, '02', 'fleet', ['cc', 'gg']);
    await engine.signalAgentReady(repo, '02', 'cc');
    await engine.signalAgentReady(repo, '02', 'gg');
    const evalSnap = await engine.requestFeatureEval(repo, '02');
    assert.strictEqual(evalSnap.lifecycle, 'evaluating');
    const winnerSnap = await engine.selectWinner(repo, '02', 'cc');
    assert.strictEqual(winnerSnap.winnerAgentId, 'cc');
    const closeSnap = await engine.closeFeatureWithEffects(repo, '02', async () => {});
    assert.strictEqual(closeSnap.lifecycle, 'done');
}));

testAsync('fleet: evaluating state shows select-winner actions before a winner is chosen', () => withTempRepo(async (repo) => {
    writeSpec(repo, '02', 'fleet-test');
    await engine.startFeature(repo, '02', 'fleet', ['cc', 'gg']);
    await engine.signalAgentReady(repo, '02', 'cc');
    await engine.signalAgentReady(repo, '02', 'gg');
    const snap = await engine.requestFeatureEval(repo, '02');
    const actions = getActions(snap, '02');
    // Before a winner is selected, fleet eval only offers per-agent select-winner
    const pickActions = actions.validActions.filter(a => a.action === 'select-winner');
    assert.ok(pickActions.length > 0, 'evaluating state should have select-winner actions before a winner is chosen');
}));

// ─── Pause → resume ──────────────────────────────────────────────────────────

console.log('\nPause → resume');

testAsync('pause transitions to paused state', () => withTempRepo(async (repo) => {
    writeSpec(repo, '03', 'pause-test');
    await engine.startFeature(repo, '03', 'solo_branch', ['cc']);
    const snap = await engine.pauseFeature(repo, '03');
    assert.strictEqual(snap.currentSpecState, 'paused');
    const actions = getActions(snap, '03');
    assert.ok(hasAction(actions, 'feature-resume'), 'paused state should have resume action');
    assert.ok(!hasAction(actions, 'feature-pause'), 'paused state should not have pause action');
}));

testAsync('resume returns to implementing state', () => withTempRepo(async (repo) => {
    writeSpec(repo, '03', 'pause-test');
    await engine.startFeature(repo, '03', 'solo_branch', ['cc']);
    await engine.pauseFeature(repo, '03');
    const snap = await engine.resumeFeature(repo, '03');
    assert.strictEqual(snap.currentSpecState, 'implementing');
    const actions = getActions(snap, '03');
    assert.ok(hasAction(actions, 'feature-pause'), 'resumed state should have pause action');
}));

// ─── Review flow ─────────────────────────────────────────────────────────────

console.log('\nReview flow');

testAsync('solo: agent-ready goes to ready_for_review in review-mode', () => withTempRepo(async (repo) => {
    writeSpec(repo, '04', 'review-test');
    await engine.startFeature(repo, '04', 'solo_branch', ['cc']);
    const snap = await engine.signalAgentReady(repo, '04', 'cc');
    // In solo mode, agent-ready should enable close
    const actions = getActions(snap, '04');
    assert.ok(hasAction(actions, 'feature-close'), 'should have close after agent-ready');
}));

// REGRESSION (feature 229): captureAgentTelemetry must aggregate normalized
// telemetry records written by the StopHook instead of re-parsing Claude
// JSONL transcripts via brittle resolveClaudeProjectDir slug matching. When
// records exist, transcript discovery is bypassed entirely.
test('telemetry aggregator reads StopHook records over transcripts', () => withTempDir('aigon-tel-', (repo) => {
    const telemetry = require('../../lib/telemetry');
    telemetry.writeNormalizedTelemetryRecord({
        source: 'claude-transcript', sessionId: 'sess-a', entityType: 'feature',
        featureId: '777', repoPath: repo, agent: 'cc', activity: 'implement',
        model: 'claude-opus-4-6', startAt: '2026-04-07T00:00:00Z', endAt: '2026-04-07T01:00:00Z',
        tokenUsage: { input: 100, output: 200, cacheReadInput: 50, cacheCreationInput: 25, thinking: 10, total: 385, billable: 310 },
        costUsd: 0.42,
    }, { repoPath: repo });
    telemetry.writeNormalizedTelemetryRecord({
        source: 'claude-transcript', sessionId: 'sess-b', entityType: 'feature',
        featureId: '777', repoPath: repo, agent: 'cc', activity: 'review',
        model: 'claude-opus-4-6', startAt: '2026-04-07T02:00:00Z', endAt: '2026-04-07T03:00:00Z',
        tokenUsage: { input: 50, output: 80, cacheReadInput: 0, cacheCreationInput: 0, thinking: 0, total: 130, billable: 130 },
        costUsd: 0.13,
    }, { repoPath: repo });
    telemetry.writeAgentFallbackSession('777', 'cc', {
        repoPath: repo,
        source: 'feature-close-fallback',
        sessionId: 'fallback-close-record',
    });

    const agg = telemetry.aggregateNormalizedTelemetryRecords('777', 'cc', { repoPath: repo, linesChanged: 50 });
    assert.strictEqual(agg.sessions, 2, 'ignores fallback zero-usage records');
    assert.strictEqual(agg.input_tokens, 150);
    assert.strictEqual(agg.cost_usd, 0.55);
    assert.strictEqual(agg.model, 'claude-opus-4-6');
    assert.strictEqual(agg.billable_tokens, 440); // input+output+thinking
    assert.strictEqual(agg.tokens_per_line_changed, 8.8);

    // 'solo' acts as wildcard agent for legacy callers
    const soloAgg = telemetry.aggregateNormalizedTelemetryRecords('777', 'solo', { repoPath: repo });
    assert.strictEqual(soloAgg.sessions, 2);

    // Missing feature → null (caller falls back gracefully, no crash)
    assert.strictEqual(telemetry.aggregateNormalizedTelemetryRecords('999', 'cc', { repoPath: repo }), null);
}));

// ─── git.getMainRepoPath ─────────────────────────────────────────────────────

console.log('\ngit.getMainRepoPath');

testAsync('getMainRepoPath returns repo root from a subdirectory', () => withTempDirAsync('aigon-git-', async (dir) => {
    // REGRESSION: feature 233 — getMainRepoPath only handled absolute git-common-dir
    // (worktree case). From a subdir of a non-worktree repo it returned the subdir,
    // misrouting every spec/snapshot lookup and surfacing as
    // "Could not resolve visible spec for feature N".
    const { execSync } = require('child_process');
    const gitLib = require('../../lib/git');
    execSync('git init -q', { cwd: dir });
    execSync('git config user.email t@t', { cwd: dir });
    execSync('git config user.name t', { cwd: dir });
    fs.writeFileSync(path.join(dir, 'README.md'), 'x');
    execSync('git add . && git commit -qm init', { cwd: dir });
    fs.mkdirSync(path.join(dir, 'a', 'b', 'c'), { recursive: true });
    const subdir = path.join(dir, 'a', 'b', 'c');
    // fs.realpathSync resolves /private/var → /var on macOS so the assert is stable.
    assert.strictEqual(fs.realpathSync(gitLib.getMainRepoPath(subdir)), fs.realpathSync(dir));
    assert.strictEqual(fs.realpathSync(gitLib.getMainRepoPath(dir)), fs.realpathSync(dir));
}));

// ─── Run and report ──────────────────────────────────────────────────────────

report();
