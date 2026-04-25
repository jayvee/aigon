#!/usr/bin/env node
'use strict';
// REGRESSION (F341): spec review/revision must be first-class engine states,
// not sidecar context. Pins: transient always: → backlog; projector dual-event
// acceptance; MISSING_MIGRATION tag; agent: frontmatter precedence; migration
// idempotency.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { test, testAsync, withTempDirAsync, report } = require('../_helpers');

const { createActor } = require('xstate');
const { featureMachine } = require('../../lib/workflow-core/machine');
const { projectContext } = require('../../lib/workflow-core/projector');
const readModel = require('../../lib/workflow-read-model');
const { resolveSpecRevisionAgent } = require('../../lib/commands/entity-commands');
const { runPendingMigrations } = require('../../lib/migration');
const wf = require('../../lib/workflow-core');

function initRepo(repo) {
    ['docs/specs/features/01-inbox', 'docs/specs/features/02-backlog']
        .forEach((d) => fs.mkdirSync(path.join(repo, d), { recursive: true }));
    execSync('git init -q && git config user.email t@t && git config user.name t', { cwd: repo });
}

test('machine: backlog -> spec_review_in_progress -> (completed) -> backlog via always:', () => {
    const actor = createActor(featureMachine, { input: { currentSpecState: 'backlog', agents: {} } });
    actor.start();
    assert.strictEqual(actor.getSnapshot().value, 'backlog');
    actor.send({ type: 'feature.spec_review.started' });
    assert.strictEqual(actor.getSnapshot().value, 'spec_review_in_progress');
    actor.send({ type: 'feature.spec_review.completed' });
    // transient spec_review_complete always: -> backlog
    assert.strictEqual(actor.getSnapshot().value, 'backlog');
});

test('projector: accepts both legacy spec_review.started and new feature.spec_review.started', () => {
    const legacyCtx = projectContext([
        { type: 'feature.started', featureId: '1', mode: 'solo_branch', agents: [], at: '2026-04-01T00:00:00Z' },
        { type: 'spec_review.started', reviewerId: 'gg', at: '2026-04-01T01:00:00Z' },
    ]);
    const newCtx = projectContext([
        { type: 'feature.started', featureId: '1', mode: 'solo_branch', agents: [], at: '2026-04-01T00:00:00Z' },
        { type: 'feature.spec_review.started', reviewerId: 'gg', at: '2026-04-01T01:00:00Z' },
    ]);
    // Both produce an activeReviewer for gg
    assert.strictEqual(legacyCtx.specReview.activeReviewers.length, 1);
    assert.strictEqual(newCtx.specReview.activeReviewers.length, 1);
    // New event promotes lifecycle to spec_review_in_progress
    assert.strictEqual(newCtx.currentSpecState, 'spec_review_in_progress');
});

test('read-model: sidecar specReview with inbox/backlog lifecycle tagged MISSING_MIGRATION', () => {
    assert.strictEqual(readModel.detectMissingMigration({
        currentSpecState: 'backlog',
        specReview: { pendingCount: 1, activeReviewers: [] },
    }), true);
    assert.strictEqual(readModel.detectMissingMigration({
        currentSpecState: 'backlog',
        specReview: { pendingCount: 0, activeReviewers: [{ agentId: 'gg' }] },
    }), true);
    // Already migrated: state matches spec review
    assert.strictEqual(readModel.detectMissingMigration({
        currentSpecState: 'spec_review_in_progress',
        specReview: { pendingCount: 0, activeReviewers: [{ agentId: 'gg' }] },
    }), false);
    // No specReview sidecar at all
    assert.strictEqual(readModel.detectMissingMigration({ currentSpecState: 'backlog' }), false);
});

test('agent resolver: precedence event > frontmatter > authorAgentId > default', () => {
    // 1. Event-payload wins outright.
    assert.strictEqual(resolveSpecRevisionAgent({ nextReviewerId: 'cc', snapshot: { authorAgentId: 'gg' } }), 'cc');
    // 3. Snapshot fallback when no spec path and no event.
    assert.strictEqual(resolveSpecRevisionAgent({ snapshot: { authorAgentId: 'gg' } }), 'gg');
});

testAsync('record paths: review submit and revise ack emit transient completion events', () => withTempDirAsync('aigon-f341-record-', async (repo) => {
    initRepo(repo);
    fs.writeFileSync(path.join(repo, 'docs/specs/features/02-backlog/feature-12-x.md'), '# x\n');
    execSync('git add . && git commit -qm init', { cwd: repo });

    await wf.recordSpecReviewStarted(repo, 'feature', '12', { reviewerId: 'gg', at: '2026-04-01T01:00:00Z' });
    await wf.recordSpecReviewSubmitted(repo, 'feature', '12', {
        reviewerId: 'gg',
        reviewId: 'r1',
        summary: 'looks good',
        commitSha: 'abc123',
        at: '2026-04-01T02:00:00Z',
    });
    let snapshot = JSON.parse(fs.readFileSync(path.join(repo, '.aigon/workflows/features/12/snapshot.json'), 'utf8'));
    assert.strictEqual(snapshot.currentSpecState, 'backlog');
    assert.strictEqual(snapshot.specReview.pendingCount, 1);

    await wf.recordSpecReviewCheckStarted(repo, 'feature', '12', { checkerId: 'cc', at: '2026-04-01T03:00:00Z' });
    await wf.recordSpecReviewAcknowledged(repo, 'feature', '12', {
        reviewIds: ['r1'],
        ackedBy: 'cc',
        commitSha: 'def456',
        at: '2026-04-01T04:00:00Z',
    });
    snapshot = JSON.parse(fs.readFileSync(path.join(repo, '.aigon/workflows/features/12/snapshot.json'), 'utf8'));
    assert.strictEqual(snapshot.currentSpecState, 'backlog');
    assert.strictEqual(snapshot.specReview.pendingCount, 0);
}));

testAsync('migration 2.56.0: idempotent rewrite of snapshots into new states', () => withTempDirAsync('aigon-f341-mig-', async (repo) => {
    initRepo(repo);
    fs.writeFileSync(path.join(repo, 'docs/specs/features/02-backlog/feature-12-x.md'), '# x\n');
    execSync('git add . && git commit -qm init', { cwd: repo });
    // Seed a legacy-style snapshot with specReview activity but lifecycle still backlog.
    const snapDir = path.join(repo, '.aigon/workflows/features/12');
    fs.mkdirSync(snapDir, { recursive: true });
    const snap = {
        entityType: 'feature', featureId: '12', lifecycle: 'backlog', currentSpecState: 'backlog',
        mode: 'solo_branch', agents: {}, specReview: { activeReviewers: [{ agentId: 'gg', startedAt: '2026-04-01T00:00:00Z' }], pendingCount: 0, pendingReviews: [], pendingAgents: [], pendingLabel: '' },
        eventCount: 1, createdAt: '2026-04-01T00:00:00Z', updatedAt: '2026-04-01T00:00:00Z',
    };
    fs.writeFileSync(path.join(snapDir, 'snapshot.json'), JSON.stringify(snap, null, 2));
    fs.writeFileSync(path.join(snapDir, 'events.jsonl'), JSON.stringify({ type: 'feature.started', featureId: '12', mode: 'solo_branch', agents: [], at: '2026-04-01T00:00:00Z' }) + '\n');

    await runPendingMigrations(repo);
    const after1 = JSON.parse(fs.readFileSync(path.join(snapDir, 'snapshot.json'), 'utf8'));
    assert.strictEqual(after1.currentSpecState, 'spec_review_in_progress');
    // Re-run: must not re-rewrite (idempotent).
    await runPendingMigrations(repo);
    const after2 = JSON.parse(fs.readFileSync(path.join(snapDir, 'snapshot.json'), 'utf8'));
    assert.strictEqual(after2.currentSpecState, 'spec_review_in_progress');
}));

test('machine: code review complete routes to revision or submitted', () => {
    // REGRESSION: code review must not collapse back to the legacy reviewing state.
    const base = {
        currentSpecState: 'implementing',
        mode: 'solo_branch',
        authorAgentId: 'cc',
        winnerAgentId: null,
        agents: { cc: { status: 'ready' } },
    };
    const revise = createActor(featureMachine, { input: base });
    revise.start();
    revise.send({ type: 'feature.code_review.started', reviewerId: 'gg', at: '2026-04-01T01:00:00Z' });
    assert.strictEqual(revise.getSnapshot().value, 'code_review_in_progress');
    revise.send({ type: 'feature.code_review.started', reviewerId: 'gg', at: '2026-04-01T01:00:30Z' });
    assert.strictEqual(revise.getSnapshot().value, 'code_review_in_progress');
    revise.send({ type: 'feature.code_review.completed', reviewerId: 'gg', requestRevision: true, at: '2026-04-01T02:00:00Z' });
    assert.strictEqual(revise.getSnapshot().value, 'code_revision_in_progress');
    assert.strictEqual(revise.getSnapshot().context.codeReview.revisionAgentId, 'cc');

    const clean = createActor(featureMachine, { input: base });
    clean.start();
    clean.send({ type: 'feature.code_review.started', reviewerId: 'gg', at: '2026-04-01T01:00:00Z' });
    clean.send({ type: 'feature.code_review.completed', reviewerId: 'gg', requestRevision: false, at: '2026-04-01T02:00:00Z' });
    assert.strictEqual(clean.getSnapshot().value, 'submitted');
});

test('projector: accepts legacy review_requested and new code review events', () => {
    // REGRESSION: legacy review_requested event logs must project like new code review starts.
    const legacyCtx = projectContext([
        { type: 'feature.started', featureId: '1', mode: 'solo_branch', agents: ['cc'], at: '2026-04-01T00:00:00Z' },
        { type: 'signal.agent_submitted', agentId: 'cc', at: '2026-04-01T00:30:00Z' },
        { type: 'feature.review_requested', reviewerId: 'gg', at: '2026-04-01T01:00:00Z' },
    ]);
    const newCtx = projectContext([
        { type: 'feature.started', featureId: '1', mode: 'solo_branch', agents: ['cc'], at: '2026-04-01T00:00:00Z' },
        { type: 'signal.agent_submitted', agentId: 'cc', at: '2026-04-01T00:30:00Z' },
        { type: 'feature.code_review.started', reviewerId: 'gg', at: '2026-04-01T01:00:00Z' },
        { type: 'feature.code_review.completed', reviewerId: 'gg', requestRevision: true, at: '2026-04-01T02:00:00Z' },
        { type: 'feature.code_revision.completed', revisionAgentId: 'cc', at: '2026-04-01T03:00:00Z' },
    ]);
    assert.strictEqual(legacyCtx.currentSpecState, 'code_review_in_progress');
    assert.strictEqual(newCtx.currentSpecState, 'submitted');
    assert.strictEqual(newCtx.codeReview.revisionAgentId, 'cc');
    assert.strictEqual(newCtx.codeReview.revisionCompletedAt, '2026-04-01T03:00:00Z');
});

testAsync('migration 2.57.0: idempotent reviewing rename', () => withTempDirAsync('aigon-f342-mig-', async (repo) => {
    initRepo(repo);
    const snapDir = path.join(repo, '.aigon/workflows/features/12');
    fs.mkdirSync(snapDir, { recursive: true });
    fs.writeFileSync(path.join(snapDir, 'snapshot.json'), JSON.stringify({
        entityType: 'feature',
        featureId: '12',
        lifecycle: 'reviewing',
        currentSpecState: 'reviewing',
        mode: 'solo_branch',
        agents: { cc: { status: 'ready' } },
        eventCount: 2,
        createdAt: '2026-04-01T00:00:00Z',
        updatedAt: '2026-04-01T01:00:00Z',
    }, null, 2));
    fs.writeFileSync(path.join(snapDir, 'events.jsonl'), '');
    await runPendingMigrations(repo);
    const after1 = JSON.parse(fs.readFileSync(path.join(snapDir, 'snapshot.json'), 'utf8'));
    assert.strictEqual(after1.currentSpecState, 'code_review_in_progress');
    await runPendingMigrations(repo);
    const after2 = JSON.parse(fs.readFileSync(path.join(snapDir, 'snapshot.json'), 'utf8'));
    assert.strictEqual(after2.currentSpecState, 'code_review_in_progress');
}));

report();
