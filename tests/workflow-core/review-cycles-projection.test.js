#!/usr/bin/env node
// REGRESSION (F343): reviewCycles[] projection and code_revision_complete loopback.
'use strict';
const assert = require('assert');
const { test, report } = require('../_helpers');
const { projectContext } = require('../../lib/workflow-core/projector');
const { createActor } = require('xstate');
const { featureMachine } = require('../../lib/workflow-core/machine');
const BASE = [{ type: 'feature.started', featureId: '1', mode: 'solo_branch', agents: ['cc'], at: '2026-04-01T00:00:00Z' }, { type: 'signal.agent_ready', agentId: 'cc', at: '2026-04-01T00:30:00Z' }];
const CYCLE1 = [{ type: 'feature.code_review.started', reviewerId: 'gg', at: '2026-04-01T01:00:00Z' }, { type: 'feature.code_review.completed', reviewerId: 'gg', requestRevision: true, at: '2026-04-01T02:00:00Z' }, { type: 'feature.code_revision.started', revisionAgentId: 'cc', at: '2026-04-01T03:00:00Z' }];
test('projector: requestAnotherCycle=true → code_review_in_progress + pendingCodeReviewer=cx + reviewCycles[0]; cleared on next code_review.started', () => {
    const ctx = projectContext([...BASE, ...CYCLE1, { type: 'feature.code_revision.completed', revisionAgentId: 'cc', requestAnotherCycle: true, nextReviewerId: 'cx', at: '2026-04-01T04:00:00Z' }]);
    assert.strictEqual(ctx.currentSpecState, 'code_review_in_progress');
    assert.strictEqual(ctx.pendingCodeReviewer, 'cx');
    assert.strictEqual(ctx.reviewCycles.length, 1);
    assert.deepStrictEqual({ type: ctx.reviewCycles[0].type, cycle: ctx.reviewCycles[0].cycle, reviewer: ctx.reviewCycles[0].reviewer }, { type: 'code', cycle: 1, reviewer: 'gg' });
    const ctx2 = projectContext([...BASE, ...CYCLE1, { type: 'feature.code_revision.completed', revisionAgentId: 'cc', requestAnotherCycle: true, nextReviewerId: 'cx', at: '2026-04-01T04:00:00Z' }, { type: 'feature.code_review.started', reviewerId: 'cx', at: '2026-04-01T05:00:00Z' }]);
    assert.strictEqual(ctx2.pendingCodeReviewer, null);
    assert.strictEqual(ctx2.codeReview.activeReviewerId, 'cx');
});
test('machine: anotherCycleRequested loops to code_review_in_progress; missing guard goes to submitted', () => {
    const base = { currentSpecState: 'implementing', mode: 'solo_branch', authorAgentId: 'cc', winnerAgentId: null, agents: { cc: { status: 'ready' } }, reviewCycles: [], pendingCodeReviewer: null, pendingSpecReviewer: null };
    const a = createActor(featureMachine, { input: base }); a.start();
    a.send({ type: 'feature.code_review.started', reviewerId: 'gg', at: '2026-04-01T01:00:00Z' });
    a.send({ type: 'feature.code_review.completed', reviewerId: 'gg', requestRevision: true, at: '2026-04-01T02:00:00Z' });
    a.send({ type: 'feature.code_revision.started', at: '2026-04-01T03:00:00Z' });
    a.send({ type: 'feature.code_revision.completed', requestAnotherCycle: true, nextReviewerId: 'cx', at: '2026-04-01T04:00:00Z' });
    assert.strictEqual(a.getSnapshot().value, 'code_review_in_progress');
    assert.strictEqual(a.getSnapshot().context.pendingCodeReviewer, 'cx');
    const b = createActor(featureMachine, { input: base }); b.start();
    b.send({ type: 'feature.code_review.started', reviewerId: 'gg', at: '2026-04-01T01:00:00Z' });
    b.send({ type: 'feature.code_review.completed', reviewerId: 'gg', requestRevision: true, at: '2026-04-01T02:00:00Z' });
    b.send({ type: 'feature.code_revision.started', at: '2026-04-01T03:00:00Z' });
    b.send({ type: 'feature.code_revision.completed', at: '2026-04-01T04:00:00Z' });
    assert.strictEqual(b.getSnapshot().value, 'submitted');
});
report();
