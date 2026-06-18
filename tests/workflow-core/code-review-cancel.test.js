#!/usr/bin/env node
// REGRESSION (F562): code_review.cancelled returns to ready and clears active reviewer.
'use strict';
const assert = require('assert');
const { test, report } = require('../_helpers');
const { projectContext } = require('../../lib/workflow-core/projector');
const { deriveAvailableActions } = require('../../lib/workflow-core/actions');
const { createActor } = require('xstate');
const { featureMachine } = require('../../lib/workflow-core/machine');
const { ManualActionKind } = require('../../lib/workflow-core/types');

const BASE = [
    { type: 'feature.started', featureId: '1', mode: 'solo_branch', agents: ['cc'], at: '2026-04-01T00:00:00Z' },
    { type: 'signal.agent_ready', agentId: 'cc', at: '2026-04-01T00:30:00Z' },
];

test('projector: code_review.cancelled → ready, clears active reviewer, preserves reviewCycles', () => {
    const events = [
        ...BASE,
        { type: 'feature.code_review.started', reviewerId: 'gg', at: '2026-04-01T01:00:00Z' },
        { type: 'feature.code_review.completed', reviewerId: 'gg', requestRevision: true, at: '2026-04-01T02:00:00Z' },
        { type: 'feature.code_revision.started', revisionAgentId: 'cc', at: '2026-04-01T03:00:00Z' },
        { type: 'feature.code_revision.completed', revisionAgentId: 'cc', requestAnotherCycle: true, nextReviewerId: 'cx', at: '2026-04-01T04:00:00Z' },
        { type: 'feature.code_review.started', reviewerId: 'cx', at: '2026-04-01T05:00:00Z' },
        { type: 'feature.code_review.cancelled', at: '2026-04-01T05:30:00Z' },
    ];
    const ctx = projectContext(events);
    assert.strictEqual(ctx.currentSpecState, 'ready');
    assert.strictEqual(ctx.codeReview.activeReviewerId, null);
    assert.strictEqual(ctx.pendingCodeReviewer, null);
    assert.strictEqual(ctx.reviewCycles.length, 1);
    assert.strictEqual(ctx.codeReview.reviewerId, 'gg');
});

test('projector: first-cycle cancel preserves cancelled review marker for rerun UX', () => {
    const ctx = projectContext([
        ...BASE,
        { type: 'feature.code_review.started', reviewerId: 'gg', at: '2026-04-01T01:00:00Z' },
        { type: 'feature.code_review.cancelled', at: '2026-04-01T01:30:00Z' },
    ]);
    assert.strictEqual(ctx.currentSpecState, 'ready');
    assert.ok(ctx.codeReview);
    assert.strictEqual(ctx.codeReview.activeReviewerId, null);
    assert.strictEqual(ctx.codeReview.reviewerId, 'gg');
    assert.strictEqual(ctx.codeReview.cancelledAt, '2026-04-01T01:30:00Z');
});

test('machine: code_review.cancelled only valid from code_review_in_progress', () => {
    const base = {
        currentSpecState: 'implementing',
        mode: 'solo_branch',
        authorAgentId: 'cc',
        winnerAgentId: null,
        agents: { cc: { status: 'ready' } },
        reviewCycles: [],
        pendingCodeReviewer: null,
        pendingSpecReviewer: null,
    };
    const actor = createActor(featureMachine, { input: base });
    actor.start();
    actor.send({ type: 'feature.code_review.started', reviewerId: 'gg', at: '2026-04-01T01:00:00Z' });
    assert.strictEqual(actor.getSnapshot().value, 'code_review_in_progress');
    actor.send({ type: 'feature.code_review.cancelled', at: '2026-04-01T01:30:00Z' });
    assert.strictEqual(actor.getSnapshot().value, 'ready');
});

test('actions: Cancel review offered only during code_review_in_progress', () => {
    const inReview = {
        currentSpecState: 'code_review_in_progress',
        mode: 'solo_branch',
        agents: { cc: { status: 'ready' } },
        codeReview: { activeReviewerId: 'gg', reviewStartedAt: '2026-04-01T01:00:00Z' },
        updatedAt: '2026-04-01T01:00:00Z',
    };
    const ready = {
        currentSpecState: 'ready',
        mode: 'solo_branch',
        agents: { cc: { status: 'ready' } },
        updatedAt: '2026-04-01T02:00:00Z',
    };
    const inReviewActions = deriveAvailableActions(inReview, 'feature').map((action) => action.kind);
    const readyActions = deriveAvailableActions(ready, 'feature').map((action) => action.kind);
    assert.ok(inReviewActions.includes(ManualActionKind.FEATURE_CANCEL_CODE_REVIEW));
    assert.ok(!readyActions.includes(ManualActionKind.FEATURE_CANCEL_CODE_REVIEW));
});

report();
