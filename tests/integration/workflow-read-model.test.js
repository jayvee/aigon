#!/usr/bin/env node
// REGRESSION F275: snapshot lifecycle overrides visible folder stage.
// REGRESSION F271 `936d2da7`: research read-model tolerates null entityId.
// REGRESSION F276: detect-only spec drift; AIGON_AUTO_RECONCILE=1 opts into moves.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, testAsync, withTempDir, withTempDirAsync, report, ENTITY_STAGE_DIRS, seedEntityDirs, writeSpec, writeSnap } = require('../_helpers');
const wrm = require('../../lib/workflow-read-model');
const board = require('../../lib/board');
const workflowEngine = require('../../lib/workflow-core/engine');
const seed = (repo) => ['features', 'research-topics'].forEach((kind) => seedEntityDirs(repo, kind));
const writeFeatureAuto = (repo, id, payload) => {
    const file = path.join(repo, '.aigon', 'state', `feature-${String(id).padStart(2, '0')}-auto.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(payload, null, 2));
};

// REGRESSION: inbox + spec review must not show in backlog column before prioritise.
test('inbox + spec_review_in_progress lifecycle still buckets as inbox (feature and research)', () => withTempDir('aigon-rm-', (repo) => {
    seed(repo);
    const slug = 'pre-prio-spec-review';
    writeSpec(repo, 'features', '01-inbox', `feature-${slug}.md`);
    writeSpec(repo, 'research-topics', '01-inbox', `research-${slug}.md`);
    writeSnap(repo, 'features', slug, 'spec_review_in_progress');
    writeSnap(repo, 'research', slug, 'spec_review_in_progress');
    const f = wrm.getFeatureDashboardState(repo, slug, 'inbox', []);
    const r = wrm.getResearchDashboardState(repo, slug, 'inbox', []);
    assert.strictEqual(f.stage, 'inbox');
    assert.strictEqual(r.stage, 'inbox');
    assert.strictEqual(f.readModelSource, wrm.WORKFLOW_SOURCE.SNAPSHOT);
    assert.strictEqual(r.readModelSource, wrm.WORKFLOW_SOURCE.SNAPSHOT);
}));

// REGRESSION: solo close uses the in-evaluation column but must not show fleet eval UI.
test('closing lifecycle in in-evaluation column does not set evalStatus evaluating', () => withTempDir('aigon-rm-close-', (repo) => {
    seed(repo);
    writeSpec(repo, 'features', '04-in-evaluation', 'feature-2-brewery-import.md');
    writeSnap(repo, 'features', '2', 'closing');
    const state = wrm.getFeatureDashboardState(repo, '2', 'in-evaluation', [{ id: 'cu', status: 'ready' }]);
    assert.strictEqual(state.stage, 'in-evaluation');
    assert.strictEqual(state.evalStatus, null);
    assert.strictEqual(state.evalSession, null);
}));

for (const [kind, getState] of [['features', wrm.getFeatureDashboardState], ['research-topics', wrm.getResearchDashboardState]]) {
    const id = kind === 'features' ? '12' : '21';
    test(`${kind}: snapshot lifecycle overrides visible folder stage`, () => withTempDir('aigon-rm-', (repo) => {
        seed(repo);
        writeSpec(repo, kind, '02-backlog', `${kind === 'features' ? 'feature' : 'research'}-${id}-x.md`);
        writeSnap(repo, kind === 'features' ? 'features' : 'research', id, 'implementing');
        const s = getState(repo, id, 'backlog', []);
        assert.strictEqual(s.stage, 'in-progress');
        assert.strictEqual(s.readModelSource, wrm.WORKFLOW_SOURCE.SNAPSHOT);
        if (kind === 'features') assert.ok(s.validActions.length > 0);
    }));
}

testAsync('startup readiness derives heartbeat and all-ready intervals from workflow events', () => withTempDirAsync('aigon-rm-', async (repo) => {
    seed(repo);
    writeSpec(repo, 'features', '03-in-progress', 'feature-31-startup.md');
    await workflowEngine.startFeature(repo, '31', 'fleet', ['cc', 'cx']);
    await workflowEngine.emitSignal(repo, '31', 'heartbeat', 'cc');
    let state = wrm.getFeatureDashboardState(repo, '31', 'in-progress', []);
    assert.strictEqual(state.startupReadiness.agentCount, 2);
    assert.strictEqual(state.startupReadiness.heartbeatCount, 1);
    assert.strictEqual(state.startupReadiness.phase, 'agents_partially_booted');
    assert.ok(Number.isFinite(state.startupReadiness.agents.find(a => a.agentId === 'cc').featureStartedToFirstHeartbeatMs));

    await workflowEngine.emitSignal(repo, '31', 'heartbeat', 'cx');
    await workflowEngine.emitSignal(repo, '31', 'agent-ready', 'cc');
    await workflowEngine.emitSignal(repo, '31', 'agent-ready', 'cx');
    state = wrm.getFeatureDashboardState(repo, '31', 'in-progress', []);
    assert.strictEqual(state.startupReadiness.heartbeatCount, 2);
    assert.strictEqual(state.startupReadiness.readyCount, 2);
    assert.strictEqual(state.startupReadiness.phase, 'all_ready');
    assert.ok(Number.isFinite(state.startupReadiness.featureStartedToAllReadyMs));
}));

test('spec drift is detect-only by default; AIGON_AUTO_RECONCILE=1 moves the file', () => withTempDir('aigon-rm-', (repo) => {
    seed(repo);
    writeSpec(repo, 'features', '02-backlog', 'feature-16-x.md');
    writeSnap(repo, 'features', '16', 'implementing');
    delete process.env.AIGON_AUTO_RECONCILE;
    const detect = wrm.getFeatureDashboardState(repo, '16', 'backlog', []);
    assert.deepStrictEqual(detect.specDrift, {
        currentPath: 'docs/specs/features/02-backlog/feature-16-x.md',
        expectedPath: 'docs/specs/features/03-in-progress/feature-16-x.md',
        lifecycle: 'implementing',
    });
    assert.ok(fs.existsSync(path.join(repo, 'docs/specs/features/02-backlog/feature-16-x.md')));
    writeSpec(repo, 'features', '02-backlog', 'feature-17-x.md');
    writeSnap(repo, 'features', '17', 'implementing');
    process.env.AIGON_AUTO_RECONCILE = '1';
    try {
        const moved = wrm.getFeatureDashboardState(repo, '17', 'backlog', []);
        assert.strictEqual(moved.specDrift, null);
        assert.ok(!fs.existsSync(path.join(repo, 'docs/specs/features/02-backlog/feature-17-x.md')));
        assert.ok(fs.existsSync(path.join(repo, 'docs/specs/features/03-in-progress/feature-17-x.md')));
    } finally { delete process.env.AIGON_AUTO_RECONCILE; }
}));
test('board re-buckets snapshot-backed features and carries spec drift', () => withTempDir('aigon-rm-', (repo) => {
    seed(repo);
    writeSpec(repo, 'features', '02-backlog', 'feature-14-x.md');
    writeSpec(repo, 'features', '02-backlog', 'feature-15-legacy.md');
    writeSpec(repo, 'features', '02-backlog', 'feature-18-x.md');
    writeSnap(repo, 'features', '14', 'implementing');
    writeSnap(repo, 'features', '18', 'implementing');
    const items = board.collectBoardItems(
        { root: path.join(repo, 'docs', 'specs', 'features'), prefix: 'feature', folders: ENTITY_STAGE_DIRS },
        new Set(ENTITY_STAGE_DIRS), repo
    );
    const ids = (col) => (items[col] || []).map(i => i.id);
    assert.ok(!ids('02-backlog').includes('14') && ids('03-in-progress').includes('14'));
    const legacy = (items['02-backlog'] || []).find(i => i.id === '15');
    assert.strictEqual(legacy.readModelSource, wrm.WORKFLOW_SOURCE.MISSING_SNAPSHOT);
    const drifted = (items['03-in-progress'] || []).find(i => i.id === '18');
    assert.deepStrictEqual(drifted.specDrift, {
        currentPath: 'docs/specs/features/02-backlog/feature-18-x.md',
        expectedPath: 'docs/specs/features/03-in-progress/feature-18-x.md',
        lifecycle: 'implementing',
    });
}));
// REGRESSION F297: autonomous plan shows full stage sequence (valid) or error with doctor hint (broken slug).
for (const [desc, id, autoPayload, check] of [
    ['valid workflow slug exposes future reviewed stages', '12',
        { workflowSlug: 'solo-cc-reviewed-cx', agents: ['cc'], reviewAgent: 'cx' },
        (state) => {
            assert.ok(state.autonomousPlan && !state.autonomousPlan.error);
            assert.deepStrictEqual(
                state.autonomousPlan.stages.map(s => ({ type: s.type, status: s.status, agents: s.agents.map(a => a.id) })),
                [
                    { type: 'implement', status: 'running', agents: ['cc'] },
                    { type: 'review', status: 'waiting', agents: ['cx'] },
                    { type: 'revision', status: 'waiting', agents: ['cc'] },
                    { type: 'close', status: 'waiting', agents: [] },
                ]
            );
        }],
    ['broken workflow slug errors loudly with doctor hint', '13',
        { workflowSlug: 'missing-workflow', agents: ['cc'] },
        (state) => { assert.ok(state.autonomousPlan && state.autonomousPlan.error); assert.match(state.autonomousPlan.error.message, /aigon doctor --fix/); }],
]) {
    test(`autonomous plan: ${desc}`, () => withTempDir('aigon-rm-', (repo) => {
        seed(repo);
        writeSpec(repo, 'features', '03-in-progress', `feature-${id}-auto.md`);
        writeSnap(repo, 'features', id, 'implementing');
        writeFeatureAuto(repo, id, { featureId: id, status: 'running', running: true, mode: 'solo_worktree', stopAfter: 'close', startedAt: '2026-04-01T10:00:00Z', updatedAt: '2026-04-01T10:01:00Z', ...autoPayload });
        check(wrm.getFeatureDashboardState(repo, id, 'in-progress', [{ id: 'cc', status: 'implementing' }]));
    }));
}

test('autonomous controller: normalizes representative sidecar states', () => {
    assert.strictEqual(wrm.buildAutonomousController(null), null);
    const fixtures = [
        [
            {
                status: 'running',
                running: true,
                sessionName: 'repo-f12-auto',
                mode: 'solo_worktree',
                agents: ['cc'],
                reviewAgent: 'cx',
                startedAt: '2026-04-01T10:00:00Z',
                updatedAt: '2026-04-01T10:01:00Z',
                workflowState: 'implementing',
            },
            {
                status: 'running',
                running: true,
                reason: null,
                reasonCategory: 'running',
                reasonLabel: 'Implementing',
                recommendedRecoveryKind: 'manual',
                sessionRunning: true,
                agents: ['cc'],
                reviewAgent: 'cx',
                evalAgent: null,
            },
        ],
        [
            { status: 'failed', running: false, reason: 'review-exited-without-signal', error: { message: 'review died' } },
            { status: 'failed', reasonCategory: 'reviewer-exited', reasonLabel: 'Reviewer exited without signaling', recommendedRecoveryKind: 'rerun-review', error: 'review died' },
        ],
        [
            { status: 'stopped', running: false, reason: 'stop-after-review' },
            { status: 'stopped', reasonCategory: 'stopped-checkpoint', recommendedRecoveryKind: 'manual' },
        ],
        [
            { status: 'stopped', running: false, reason: 'stopped-by-user' },
            { status: 'stopped', reasonCategory: 'stopped-by-user', recommendedRecoveryKind: 'manual' },
        ],
        [
            { status: 'quota-paused', running: false, reason: 'quota-cap' },
            { status: 'quota-paused', reasonCategory: 'quota', recommendedRecoveryKind: 'wait-quota' },
        ],
        [
            { status: 'completed', running: false, reason: 'feature-closed', endedAt: '2026-04-01T10:30:00Z' },
            { status: 'completed', reasonCategory: 'completed', recommendedRecoveryKind: 'manual', endedAt: '2026-04-01T10:30:00Z' },
        ],
        [
            { status: 'failed', running: false, reason: 'new-future-reason' },
            { status: 'failed', reasonCategory: 'unknown', reasonLabel: 'Unknown controller state', recommendedRecoveryKind: 'manual' },
        ],
    ];

    for (const [input, expected] of fixtures) {
        const dto = wrm.buildAutonomousController(input, (sessionName) => sessionName === 'repo-f12-auto');
        for (const [key, value] of Object.entries(expected)) {
            assert.deepStrictEqual(dto[key], value, `${input.status || 'missing'} ${input.reason || 'no-reason'} ${key}`);
        }
    }
});

test('autonomous controller: maps every finishAuto reason literal', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../lib/feature-autonomous.js'), 'utf8');
    const reasons = [...source.matchAll(/finishAuto\([^)]*reason:\s*'([^']+)'/g)].map(match => match[1]);
    assert.ok(reasons.length > 0, 'finishAuto reason literals found');
    for (const reason of [...new Set(reasons)]) {
        const dto = wrm.buildAutonomousController({ status: 'failed', running: false, reason });
        assert.notStrictEqual(dto.reasonCategory, 'unknown', `${reason} should have a stable category`);
        assert.ok(dto.reasonLabel, `${reason} should have a label`);
        assert.ok(dto.recommendedRecoveryKind, `${reason} should have a recovery kind`);
    }
});

test('autonomous controller: done feature still reads completed sidecar', () => withTempDir('aigon-rm-auto-done-', (repo) => {
    seed(repo);
    const id = '44';
    writeSpec(repo, 'features', '05-done', `feature-${id}-done-auto.md`);
    writeSnap(repo, 'features', id, 'done');
    writeFeatureAuto(repo, id, {
        featureId: id,
        status: 'completed',
        running: false,
        reason: 'feature-closed',
        sessionName: 'repo-f44-auto',
        mode: 'solo_worktree',
        agents: ['cx'],
        reviewAgent: 'gg',
        workflowState: 'done',
        startedAt: '2026-04-01T10:00:00Z',
        updatedAt: '2026-04-01T10:30:00Z',
        endedAt: '2026-04-01T10:30:00Z',
    });
    const state = wrm.getFeatureDashboardState(repo, id, 'done', [{ id: 'cx', status: 'implementation-complete' }]);
    assert.strictEqual(state.stage, 'done');
    assert.ok(state.autonomousController, 'completed controller DTO is present for done features');
    assert.strictEqual(state.autonomousController.status, 'completed');
    assert.strictEqual(state.autonomousController.reason, 'feature-closed');
    assert.strictEqual(state.autonomousController.reasonLabel, 'Feature closed');
    assert.strictEqual(state.autonomousController.reasonCategory, 'completed');
    assert.strictEqual(state.autonomousController.recommendedRecoveryKind, 'manual');
    assert.deepStrictEqual(state.autonomousController.agents, ['cx']);
    assert.strictEqual(state.autonomousController.reviewAgent, 'gg');
}));

// REGRESSION F524: approved review (requestRevision=false) marks the
// autonomous revision stage as complete, so the card headline doesn't read
// "Starting revision" in the gap between review-approve and close-trigger.
test('autonomous plan: approved review skips revision stage', () => withTempDir('aigon-rm-', (repo) => {
    seed(repo);
    const id = '14';
    writeSpec(repo, 'features', '03-in-progress', `feature-${id}-approved.md`);
    const snapDir = path.join(repo, '.aigon', 'workflows', 'features', id);
    fs.mkdirSync(snapDir, { recursive: true });
    fs.writeFileSync(path.join(snapDir, 'snapshot.json'), JSON.stringify({
        entityType: 'feature', featureId: id,
        currentSpecState: 'implementing', lifecycle: 'implementing',
        mode: 'solo_worktree', agents: { cc: { status: 'ready' } },
        codeReview: {
            reviewerId: 'cx',
            reviewCompletedAt: '2026-04-01T10:05:00Z',
            requestRevision: false,
            revisionAgentId: null,
        },
        createdAt: '2026-04-01T10:00:00Z', updatedAt: '2026-04-01T10:05:00Z',
    }));
    writeFeatureAuto(repo, id, {
        featureId: id, status: 'running', running: true, mode: 'solo_worktree',
        stopAfter: 'close', agents: ['cc'], reviewAgent: 'cx',
        workflowSlug: 'solo-cc-reviewed-cx',
        feedbackInjected: true, reviewTriggered: true,
        startedAt: '2026-04-01T10:00:00Z', updatedAt: '2026-04-01T10:05:00Z',
    });
    const state = wrm.getFeatureDashboardState(repo, id, 'in-progress', [{ id: 'cc', status: 'ready' }]);
    const revision = state.autonomousPlan.stages.find(s => s.type === 'revision');
    assert.ok(revision, 'revision stage present in plan');
    assert.strictEqual(revision.status, 'complete', 'approved review marks revision as complete (skipped)');
}));

// REGRESSION F654: progress-index model — one fixture per conductor state, full stage list.
const SOLO_CLOSE_STAGES = ['implement', 'review', 'revision', 'close'];
const stageStatuses = (state) => state.autonomousPlan.stages.map(s => s.status);

for (const [desc, id, setup, expectedStatuses] of [
    ['running implement', '20', (repo, featureId) => {
        writeSpec(repo, 'features', '03-in-progress', `feature-${featureId}-impl.md`);
        writeSnap(repo, 'features', featureId, 'implementing');
        writeFeatureAuto(repo, featureId, {
            featureId, status: 'running', running: true, mode: 'solo_worktree',
            stopAfter: 'close', agents: ['cc'], reviewAgent: 'cx',
            workflowSlug: 'solo-cc-reviewed-cx',
            startedAt: '2026-04-01T10:00:00Z', updatedAt: '2026-04-01T10:01:00Z',
        });
        return [{ id: 'cc', status: 'implementing' }];
    }, ['running', 'waiting', 'waiting', 'waiting']],
    ['running review', '21', (repo, featureId) => {
        writeSpec(repo, 'features', '03-in-progress', `feature-${featureId}-review.md`);
        const snapDir = path.join(repo, '.aigon', 'workflows', 'features', featureId);
        fs.mkdirSync(snapDir, { recursive: true });
        fs.writeFileSync(path.join(snapDir, 'snapshot.json'), JSON.stringify({
            entityType: 'feature', featureId,
            currentSpecState: 'code_review_in_progress', lifecycle: 'code_review_in_progress',
            mode: 'solo_worktree', agents: { cc: { status: 'ready' } },
            codeReview: { reviewerId: 'cx', reviewStartedAt: '2026-04-01T10:03:00Z' },
            createdAt: '2026-04-01T10:00:00Z', updatedAt: '2026-04-01T10:03:00Z',
        }));
        writeFeatureAuto(repo, featureId, {
            featureId, status: 'running', running: true, mode: 'solo_worktree',
            stopAfter: 'close', agents: ['cc'], reviewAgent: 'cx',
            workflowSlug: 'solo-cc-reviewed-cx', reviewTriggered: true,
            startedAt: '2026-04-01T10:00:00Z', updatedAt: '2026-04-01T10:03:00Z',
        });
        return [{ id: 'cc', status: 'ready' }, { id: 'cx', status: 'code_review_in_progress', tmuxRunning: true }];
    }, ['complete', 'waiting', 'waiting', 'waiting']],
    ['requested revision waiting', '22', (repo, featureId) => {
        writeSpec(repo, 'features', '03-in-progress', `feature-${featureId}-rev-wait.md`);
        const snapDir = path.join(repo, '.aigon', 'workflows', 'features', featureId);
        fs.mkdirSync(snapDir, { recursive: true });
        fs.writeFileSync(path.join(snapDir, 'snapshot.json'), JSON.stringify({
            entityType: 'feature', featureId,
            currentSpecState: 'implementing', lifecycle: 'implementing',
            mode: 'solo_worktree', agents: { cc: { status: 'ready' } },
            codeReview: {
                reviewerId: 'cx', reviewCompletedAt: '2026-04-01T10:05:00Z',
                requestRevision: true, revisionAgentId: 'cc',
            },
            createdAt: '2026-04-01T10:00:00Z', updatedAt: '2026-04-01T10:05:00Z',
        }));
        writeFeatureAuto(repo, featureId, {
            featureId, status: 'running', running: true, mode: 'solo_worktree',
            stopAfter: 'close', agents: ['cc'], reviewAgent: 'cx',
            workflowSlug: 'solo-cc-reviewed-cx', reviewTriggered: true,
            startedAt: '2026-04-01T10:00:00Z', updatedAt: '2026-04-01T10:05:00Z',
        });
        return [{ id: 'cc', status: 'ready' }];
    }, ['complete', 'complete', 'waiting', 'waiting']],
    ['running revision', '23', (repo, featureId) => {
        writeSpec(repo, 'features', '03-in-progress', `feature-${featureId}-rev-run.md`);
        const snapDir = path.join(repo, '.aigon', 'workflows', 'features', featureId);
        fs.mkdirSync(snapDir, { recursive: true });
        fs.writeFileSync(path.join(snapDir, 'snapshot.json'), JSON.stringify({
            entityType: 'feature', featureId,
            currentSpecState: 'implementing', lifecycle: 'implementing',
            mode: 'solo_worktree', agents: { cc: { status: 'implementing' } },
            codeReview: {
                reviewerId: 'cx', reviewCompletedAt: '2026-04-01T10:05:00Z',
                requestRevision: true, revisionAgentId: 'cc',
            },
            createdAt: '2026-04-01T10:00:00Z', updatedAt: '2026-04-01T10:06:00Z',
        }));
        writeFeatureAuto(repo, featureId, {
            featureId, status: 'running', running: true, mode: 'solo_worktree',
            stopAfter: 'close', agents: ['cc'], reviewAgent: 'cx',
            workflowSlug: 'solo-cc-reviewed-cx', reviewTriggered: true,
            feedbackInjected: true,
            startedAt: '2026-04-01T10:00:00Z', updatedAt: '2026-04-01T10:06:00Z',
        });
        return [{ id: 'cc', status: 'implementing' }];
    }, ['complete', 'complete', 'running', 'waiting']],
    ['running eval (fleet)', '24', (repo, featureId) => {
        writeSpec(repo, 'features', '03-in-progress', `feature-${featureId}-eval.md`);
        writeSnap(repo, 'features', featureId, 'evaluating');
        writeFeatureAuto(repo, featureId, {
            featureId, status: 'running', running: true, mode: 'fleet',
            stopAfter: 'close', agents: ['cc', 'cx'], evalAgent: 'gg',
            evalTriggered: true,
            startedAt: '2026-04-01T10:00:00Z', updatedAt: '2026-04-01T10:10:00Z',
        });
        return [
            { id: 'cc', status: 'ready' },
            { id: 'cx', status: 'ready' },
        ];
    }, ['complete', 'running', 'waiting']],
    ['eval complete (fleet)', '25', (repo, featureId) => {
        writeSpec(repo, 'features', '03-in-progress', `feature-${featureId}-eval-done.md`);
        const snapDir = path.join(repo, '.aigon', 'workflows', 'features', featureId);
        fs.mkdirSync(snapDir, { recursive: true });
        fs.writeFileSync(path.join(snapDir, 'snapshot.json'), JSON.stringify({
            entityType: 'feature', featureId,
            currentSpecState: 'evaluating', lifecycle: 'evaluating',
            mode: 'fleet', agents: { cc: { status: 'ready' }, cx: { status: 'ready' } },
            winnerAgentId: 'cc',
            createdAt: '2026-04-01T10:00:00Z', updatedAt: '2026-04-01T10:12:00Z',
        }));
        writeFeatureAuto(repo, featureId, {
            featureId, status: 'running', running: true, mode: 'fleet',
            stopAfter: 'close', agents: ['cc', 'cx'], evalAgent: 'gg',
            evalTriggered: true,
            startedAt: '2026-04-01T10:00:00Z', updatedAt: '2026-04-01T10:12:00Z',
        });
        return [
            { id: 'cc', status: 'ready' },
            { id: 'cx', status: 'ready' },
        ];
    }, ['complete', 'complete', 'waiting']],
    ['close running', '26', (repo, featureId) => {
        writeSpec(repo, 'features', '03-in-progress', `feature-${featureId}-close.md`);
        const snapDir = path.join(repo, '.aigon', 'workflows', 'features', featureId);
        fs.mkdirSync(snapDir, { recursive: true });
        fs.writeFileSync(path.join(snapDir, 'snapshot.json'), JSON.stringify({
            entityType: 'feature', featureId,
            currentSpecState: 'closing', lifecycle: 'closing',
            mode: 'solo_worktree', agents: { cc: { status: 'ready' } },
            codeReview: {
                reviewerId: 'cx', reviewCompletedAt: '2026-04-01T10:05:00Z',
                requestRevision: false,
            },
            createdAt: '2026-04-01T10:00:00Z', updatedAt: '2026-04-01T10:15:00Z',
        }));
        writeFeatureAuto(repo, featureId, {
            featureId, status: 'running', running: true, mode: 'solo_worktree',
            stopAfter: 'close', agents: ['cc'], reviewAgent: 'cx',
            workflowSlug: 'solo-cc-reviewed-cx', closeTriggered: true,
            startedAt: '2026-04-01T10:00:00Z', updatedAt: '2026-04-01T10:15:00Z',
        });
        return [{ id: 'cc', status: 'ready' }];
    }, ['complete', 'complete', 'complete', 'running']],
    ['close complete', '27', (repo, featureId) => {
        writeSpec(repo, 'features', '03-in-progress', `feature-${featureId}-done.md`);
        const snapDir = path.join(repo, '.aigon', 'workflows', 'features', featureId);
        fs.mkdirSync(snapDir, { recursive: true });
        fs.writeFileSync(path.join(snapDir, 'snapshot.json'), JSON.stringify({
            entityType: 'feature', featureId,
            currentSpecState: 'closing', lifecycle: 'closing',
            mode: 'solo_worktree', agents: { cc: { status: 'ready' } },
            codeReview: {
                reviewerId: 'cx', reviewCompletedAt: '2026-04-01T10:05:00Z',
                requestRevision: false,
            },
            createdAt: '2026-04-01T10:00:00Z', updatedAt: '2026-04-01T10:30:00Z',
        }));
        writeFeatureAuto(repo, featureId, {
            featureId, status: 'completed', running: false, mode: 'solo_worktree',
            stopAfter: 'close', agents: ['cc'], reviewAgent: 'cx',
            workflowSlug: 'solo-cc-reviewed-cx', closeTriggered: true,
            startedAt: '2026-04-01T10:00:00Z', updatedAt: '2026-04-01T10:30:00Z',
            endedAt: '2026-04-01T10:30:00Z',
        });
        return [{ id: 'cc', status: 'implementation-complete' }];
    }, ['complete', 'complete', 'complete', 'complete']],
]) {
    test(`autonomous plan progress index: ${desc}`, () => withTempDir('aigon-rm-', (repo) => {
        seed(repo);
        const agents = setup(repo, id);
        const state = wrm.getFeatureDashboardState(repo, id, 'in-progress', agents);
        assert.ok(state.autonomousPlan && !state.autonomousPlan.error, 'plan available');
        assert.deepStrictEqual(
            stageStatuses(state),
            expectedStatuses,
            `stage statuses for ${desc}`,
        );
        assert.deepStrictEqual(
            state.autonomousPlan.stages.map(s => s.type),
            expectedStatuses.length === 3 ? ['implement', 'eval', 'close'] : SOLO_CLOSE_STAGES,
        );
    }));
}

// REGRESSION: brewboard-seed backlog specs ship without engine snapshots — Start must still appear.
test('backlog + MISSING_SNAPSHOT still exposes feature-start and research-start', () => withTempDir('aigon-rm-', (repo) => {
    seed(repo);
    writeSpec(repo, 'features', '02-backlog', 'feature-99-seed-demo.md');
    const f = wrm.getFeatureDashboardState(repo, '99', 'backlog', []);
    assert.strictEqual(f.readModelSource, wrm.WORKFLOW_SOURCE.MISSING_SNAPSHOT);
    assert.ok(f.validActions.some((a) => a.action === 'feature-start'), 'feature-start for backlog without snapshot');
    assert.ok(f.validActions.some((a) => a.action === 'feature-autonomous-start'), 'autonomous start for backlog without snapshot');
    assert.ok(!f.validActions.some((a) => a.action === 'feature-schedule'), 'schedule needs engine snapshot');
    writeSpec(repo, 'research-topics', '02-backlog', 'research-88-seed-demo.md');
    const r = wrm.getResearchDashboardState(repo, '88', 'backlog', []);
    assert.strictEqual(r.readModelSource, wrm.WORKFLOW_SOURCE.MISSING_SNAPSHOT);
    assert.ok(r.validActions.some((a) => a.action === 'research-start'), 'research-start for backlog without snapshot');
    assert.ok(!r.validActions.some((a) => a.action === 'research-schedule'), 'schedule needs engine snapshot');
}));
// REGRESSION feature 295: operator.nudge_sent must survive projection onto the workflow snapshot.
testAsync('nudge event is recorded and surfaced on snapshot', () => withTempDirAsync('aigon-rm-', async (repo) => {
    const specPath = path.join(repo, 'docs', 'specs', 'features', '03-in-progress', 'feature-07-test.md');
    fs.mkdirSync(path.dirname(specPath), { recursive: true });
    fs.writeFileSync(specPath, '# test\n');
    workflowEngine.ensureEntityBootstrappedSync(repo, 'feature', '07', 'implementing', specPath);
    const at = new Date().toISOString();
    await workflowEngine.persistEntityEvents(repo, 'feature', '07', [{ type: 'operator.nudge_sent', featureId: '07', agentId: 'cc', role: 'do', text: 'follow up', at, atISO: at }]);
    const snapshot = await workflowEngine.showFeature(repo, '07');
    assert.deepStrictEqual(snapshot.nudges, [{ agentId: 'cc', role: 'do', text: 'follow up', atISO: at }]);
}));

// REGRESSION: dashboard validActions must include unprioritise for real backlog engine rows (API + pipeline).
test('backlog snapshot exposes feature-unprioritise validAction', () => withTempDir('aigon-unprio-va-', (repo) => {
    seed(repo);
    const specPath = path.join(repo, 'docs/specs/features/02-backlog/feature-51-unprio-dash.md');
    fs.mkdirSync(path.dirname(specPath), { recursive: true });
    fs.writeFileSync(specPath, '# x\n');
    workflowEngine.ensureEntityBootstrappedSync(repo, 'feature', '51', 'backlog', specPath);
    const f = wrm.getFeatureDashboardState(repo, '51', 'backlog', []);
    assert.ok(
        (f.validActions || []).some((a) => a.action === 'feature-unprioritise'),
        'feature-unprioritise on backlog snapshot',
    );
}));

// buildPendingScheduleIndex regression test moved to @aigon/pro with feature
// 236 alongside the scheduled-kickoff engine.

// REGRESSION F460: getFeatureDashboardState/getResearchDashboardState reuse a
// caller-supplied baseState instead of re-reading snapshot+events from disk.
// dashboard-status-collector calls these twice per row (empty agents → full
// agents); the second call must not duplicate the I/O the first call did.
// REGRESSION F460: dashboard-status-collector calls getFeature/getResearch twice per row
// (empty agents → full agents); the second call with options.baseState must reuse the first
// call's snapshot+events instead of re-reading from disk.
for (const [kind, snapKey, prefix, snapMethod, eventsMethod, getter] of [
    ['features',  'features', 'feature',  'readFeatureSnapshotSync',  'readFeatureEventsSync',  wrm.getFeatureDashboardState],
    ['research-topics', 'research', 'research', 'readWorkflowSnapshotSync', 'readWorkflowEventsSync', wrm.getResearchDashboardState],
]) {
    test(`F460: passing options.baseState skips snapshot+events re-read (${kind})`, () => withTempDir(`aigon-rm-f460-${prefix}-`, (repo) => {
        seed(repo);
        const id = kind === 'features' ? '30' : '22';
        writeSpec(repo, kind, '03-in-progress', `${prefix}-${id}-dedupe.md`);
        writeSnap(repo, snapKey, id, 'implementing');
        const adapter = require('../../lib/workflow-snapshot-adapter');
        const origSnap = adapter[snapMethod];
        const origEvents = adapter[eventsMethod];
        let snapCalls = 0, eventCalls = 0;
        adapter[snapMethod] = (...a) => { snapCalls++; return origSnap.apply(adapter, a); };
        adapter[eventsMethod] = (...a) => { eventCalls++; return origEvents.apply(adapter, a); };
        try {
            const initial = getter(repo, id, null, []);
            const baselineSnap = snapCalls, baselineEvents = eventCalls;
            assert.ok(baselineSnap >= 1, 'first pass reads snapshot at least once');
            const second = getter(repo, id, initial.stage, [{ id: 'cc', status: 'implementing' }], { baseState: initial });
            assert.strictEqual(snapCalls, baselineSnap, 'second pass with baseState must not re-read snapshot');
            assert.strictEqual(eventCalls, baselineEvents, 'second pass with baseState must not re-read events');
            assert.strictEqual(second.stage, initial.stage);
            assert.strictEqual(second.workflowSnapshot, initial.workflowSnapshot);
        } finally {
            adapter[snapMethod] = origSnap;
            adapter[eventsMethod] = origEvents;
        }
    }));
}

// REGRESSION F494: manual nudge action (feature-nudge / research-nudge) was filtered
// out by a guard that read context.tmuxSessionStates — a field the dashboard's
// action-derivation pipeline never populated. Bridge in enrichSnapshotWithInfraData
// must surface tmux state so the guard evaluates correctly.
const NUDGE_CASES = [
    // [kind,        lane,           lifecycle,      tmuxRunning, expectNudge, label]
    ['features',     '03-in-progress', 'implementing', true,        true,        'feature-nudge appears with tmuxRunning'],
    ['features',     '03-in-progress', 'implementing', false,       false,       'feature-nudge hidden when no tmux'],
    ['features',     '05-done',        'done',         true,        false,       'feature-nudge hidden in done state'],
    ['research-topics', '03-in-progress', 'implementing', true,     true,        'research-nudge appears with tmuxRunning'],
    ['research-topics', '03-in-progress', 'implementing', false,    false,       'research-nudge hidden when no tmux'],
];
let nudgeId = 71;
for (const [kind, stage, lifecycle, tmuxRunning, expectNudge, label] of NUDGE_CASES) {
    const id = String(nudgeId++);
    const prefix = kind === 'features' ? 'feature' : 'research';
    const lane = stage === '05-done' ? 'done' : 'in-progress';
    const getter = kind === 'features' ? wrm.getFeatureDashboardState : wrm.getResearchDashboardState;
    test(`F494 nudge: ${label}`, () => withTempDir('aigon-rm-', (repo) => {
        seed(repo);
        writeSpec(repo, kind, stage, `${prefix}-${id}-nudge.md`);
        writeSnap(repo, kind === 'features' ? 'features' : 'research', id, lifecycle);
        const state = getter(repo, id, lane, [{ id: 'cx', status: kind === 'features' ? 'running' : 'researching', tmuxRunning }]);
        const present = state.validActions.some((a) => a.action === `${prefix}-nudge`);
        assert.strictEqual(present, expectNudge, `${prefix}-nudge expectation mismatch`);
    }));
}

// REGRESSION F656: pre-start parked features expose resume and pauseReason on read model.
test('prestart paused feature: workflow snapshot carries prestart reason + resume action', () => withTempDir('aigon-rm-pause-', (repo) => {
    seed(repo);
    writeSpec(repo, 'features', '06-paused', 'feature-88-parked.md');
    const snapDir = path.join(repo, '.aigon', 'workflows', 'features', '88');
    fs.mkdirSync(snapDir, { recursive: true });
    fs.writeFileSync(path.join(snapDir, 'snapshot.json'), JSON.stringify({
        entityType: 'feature', featureId: '88',
        currentSpecState: 'paused', lifecycle: 'paused',
        pauseReason: 'prestart:inbox',
        agents: {}, createdAt: '2026-04-01T10:00:00Z', updatedAt: '2026-04-01T10:00:00Z',
    }));
    const state = wrm.getFeatureDashboardState(repo, '88', 'paused', []);
    assert.strictEqual(state.stage, 'paused');
    assert.strictEqual(state.workflowSnapshot.pauseReason, 'prestart:inbox');
    assert.ok(state.validActions.some((a) => a.action === 'feature-resume'));
}));

report();
