#!/usr/bin/env node
// REGRESSION feature 304: dashboard review-check states were collapsed back to
// generic implementing/running, so the agent card lost "Addressing review" and
// "Feedback addressed" across reloads.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, testAsync, withTempDirAsync, report } = require('../_helpers');
const engine = require('../../lib/workflow-core/engine');
const wrm = require('../../lib/workflow-read-model');
const ast = require('../../lib/agent-status');
const { collectRepoStatus, clearTierCache } = require('../../lib/dashboard-status-collector');
const {
    normalizeDashboardStatus,
    deriveFeatureDashboardStatus,
} = require('../../lib/dashboard-status-helpers');
// REGRESSION: dashboard showed "Checking" forever because the read model read
// from tmux presence instead of the snapshot. Spec-review status now flows from
// events (started / submitted / check_started / acked); tmux is just a shell.
testAsync('spec-review lifecycle drives card status from events, not tmux', () => withTempDirAsync('aigon-spec-review-lifecycle-', async (repo) => {
    const specPath = path.join(repo, 'docs', 'specs', 'features', '02-backlog', 'feature-50-lifecycle.md');
    fs.mkdirSync(path.dirname(specPath), { recursive: true });
    fs.writeFileSync(specPath, '# Feature: lifecycle\n');
    engine.ensureEntityBootstrappedSync(repo, 'feature', '50', 'backlog', specPath, { authorAgentId: 'cc' });
    await engine.recordSpecReviewStarted(repo, 'feature', '50', { reviewerId: 'cx' });
    let state = wrm.getFeatureDashboardState(repo, '50', 'backlog', []);
    assert.deepStrictEqual(
        state.specReviewSessions.map(s => ({ agent: s.agent, running: s.running, status: s.status })),
        [{ agent: 'cx', running: true, status: 'reviewing' }],
    );
    assert.strictEqual(state.specCheckSessions.length, 0);
    await engine.recordSpecReviewSubmitted(repo, 'feature', '50', {
        reviewerId: 'cx', summary: 'tighten criteria', reviewId: 'cx-1',
    });
    state = wrm.getFeatureDashboardState(repo, '50', 'backlog', []);
    assert.deepStrictEqual(
        state.specReviewSessions.map(s => ({ agent: s.agent, running: s.running, status: s.status })),
        [{ agent: 'cx', running: false, status: 'pending' }],
    );
    await engine.recordSpecReviewCheckStarted(repo, 'feature', '50', { checkerId: 'cc' });
    state = wrm.getFeatureDashboardState(repo, '50', 'backlog', []);
    assert.deepStrictEqual(
        state.specRevisionSessions.map(s => ({ agent: s.agent, running: s.running, status: s.status })),
        [{ agent: 'cc', running: true, status: 'revising' }],
    );
    assert.deepStrictEqual(
        state.specCheckSessions.map(s => ({ agent: s.agent, running: s.running, status: s.status })),
        [{ agent: 'cc', running: true, status: 'revising' }],
    );
    await engine.recordSpecReviewAcknowledged(repo, 'feature', '50', { ackedBy: 'cc', reviewIds: ['cx-1'] });
    state = wrm.getFeatureDashboardState(repo, '50', 'backlog', []);
    assert.strictEqual(state.specReviewSessions.length, 0);
    assert.strictEqual(state.specCheckSessions.length, 0);
}));
test('dashboard status helpers preserve revision-complete state', () => {
    assert.strictEqual(normalizeDashboardStatus('revision-complete'), 'revision-complete');
    assert.strictEqual(
        deriveFeatureDashboardStatus('revision-complete', { reviewStatus: 'done', tmuxRunning: true }),
        'revision-complete'
    );
    // addressing-review and feedback-addressed are deprecated aliases removed in F409;
    // they normalize through to their underlying canonical names or fall through.
    assert.strictEqual(
        deriveFeatureDashboardStatus('implementing', { reviewStatus: 'done', tmuxRunning: true }),
        'implementing'
    );
});
testAsync('workflow read model derives completed feature review state from engine events', () => withTempDirAsync('aigon-review-status-', async (repo) => {
    const specPath = path.join(repo, 'docs', 'specs', 'features', '03-in-progress', 'feature-99-review-status.md');
    fs.mkdirSync(path.dirname(specPath), { recursive: true });
    fs.writeFileSync(specPath, '# Feature: review status\n');
    await engine.startFeature(repo, '99', 'solo_branch', ['cc']);
    await engine.signalAgentReady(repo, '99', 'cc');
    await engine.recordCodeReviewStarted(repo, 'feature', '99', { reviewerId: 'gg', at: '2026-04-20T10:00:00Z' });
    await engine.recordCodeReviewCompleted(repo, 'feature', '99', { reviewerId: 'gg', requestRevision: true, at: '2026-04-20T10:05:00Z' });
    const first = wrm.getFeatureDashboardState(repo, '99', 'in-progress', [{ id: 'cc', status: 'implementing' }]);
    const second = wrm.getFeatureDashboardState(repo, '99', 'in-progress', [{ id: 'cc', status: 'implementing' }]);
    assert.strictEqual(first.reviewStatus, 'done');
    assert.strictEqual(second.reviewStatus, 'done');
    assert.strictEqual(second.reviewSessions.length, 1);
    assert.strictEqual(second.reviewSessions[0].agent, 'gg');
}));
testAsync('collectRepoStatus surfaces revision-complete from per-agent status file', () => withTempDirAsync('aigon-revision-complete-', async (repo) => {
    const specPath = path.join(repo, 'docs', 'specs', 'features', '03-in-progress', 'feature-77-revision-complete.md');
    fs.mkdirSync(path.dirname(specPath), { recursive: true });
    fs.writeFileSync(specPath, '# fb\n');
    await engine.startFeature(repo, '77', 'solo_branch', ['cc']);
    // Per-agent file is the source of truth for `revision-complete` — the workflow
    // snapshot reports engine states (idle/running/...), so the dashboard must
    // read the status file rather than collapse to the snapshot value.
    ast.writeAgentStatusAt(repo, '77', 'cc', { status: 'revision-complete' }, 'feature');
    clearTierCache(repo);
    const response = { summary: { implementing: 0, waiting: 0, complete: 0, error: 0, total: 0 } };
    const st = collectRepoStatus(repo, response);
    const feature = st.features.find(f => String(f.id) === '77');
    assert.ok(feature, 'feature 77 missing from dashboard payload');
    const cc = feature.agents.find(a => a.id === 'cc');
    assert.ok(cc, 'cc agent missing from feature 77');
    assert.strictEqual(cc.status, 'revision-complete', `expected revision-complete, got ${cc.status}`);
}));
// REGRESSION: spec-review-check author selection should default from workflow bootstrap state.
testAsync('collectRepoStatus includes authorAgentId for backlog research items', () => withTempDirAsync('aigon-author-agent-dashboard-', async (repo) => {
    const specPath = path.join(repo, 'docs', 'specs', 'research-topics', '02-backlog', 'research-36-author-default.md');
    fs.mkdirSync(path.dirname(specPath), { recursive: true });
    fs.writeFileSync(specPath, '# Research: author default\n');
    engine.ensureEntityBootstrappedSync(repo, 'research', '36', 'backlog', specPath, { authorAgentId: 'cc' });
    clearTierCache(repo);
    const response = { summary: { implementing: 0, waiting: 0, complete: 0, error: 0, total: 0 } };
    const status = collectRepoStatus(repo, response);
    const research = status.research.find(item => String(item.id) === '36');
    assert.ok(research, 'research 36 missing from dashboard payload');
    assert.strictEqual(research.authorAgentId, 'cc');
}));
// REGRESSION feature 439: solo_branch Drive cards must surface which CLI agent is
// implementing so the kanban card header can show "Drive  Claude Code" etc.
testAsync('collectRepoStatus sets driveToolAgentId for solo_branch from tool agent status file', () => withTempDirAsync('aigon-drive-tool-agent-', async (repo) => {
    const specPath = path.join(repo, 'docs', 'specs', 'features', '03-in-progress', 'feature-88-drive-tool-agent.md');
    fs.mkdirSync(path.dirname(specPath), { recursive: true });
    fs.writeFileSync(specPath, '# drive tool agent\n');
    await engine.startFeature(repo, '88', 'solo_branch', ['solo']);
    ast.writeAgentStatusAt(repo, '88', 'op', { status: 'implementing' }, 'feature');
    clearTierCache(repo);
    const response = { summary: { implementing: 0, waiting: 0, complete: 0, error: 0, total: 0 } };
    const st = collectRepoStatus(repo, response);
    const feature = st.features.find(f => String(f.id) === '88');
    assert.ok(feature, 'feature 88 missing from dashboard payload');
    assert.strictEqual(feature.driveToolAgentId, 'op', `expected driveToolAgentId 'op', got ${feature.driveToolAgentId}`);
}));
report();
