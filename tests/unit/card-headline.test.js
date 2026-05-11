#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { test, report } = require('../_helpers');
const { computeCardHeadline } = require('../../lib/card-headline');

const NOW = Date.parse('2026-04-30T12:00:00Z');
const isoMinusSec = sec => new Date(NOW - sec * 1000).toISOString();

const opts = (extra) => ({ entityType: 'feature', now: NOW, ...(extra || {}) });

// Rule 1 — warn-class supersedes everything else
test('rule 1: lastCloseFailure produces warn / Close failed with reason and age', () => {
    const entity = {
        lastCloseFailure: { reason: 'tests failed', at: isoMinusSec(120) },
        // these would otherwise produce a different headline
        autonomousPlan: { stages: [{ type: 'implement', status: 'running', agents: [{ id: 'cc' }] }] },
    };
    const h = computeCardHeadline(entity, null, [], entity.autonomousPlan, 'in-progress', opts());
    assert.strictEqual(h.tone, 'warn');
    assert.strictEqual(h.verb, 'Close failed');
    assert.strictEqual(h.detail, 'tests failed');
    assert.strictEqual(h.age, 120);
});

test('rule 1: specDrift → warn / Spec drift', () => {
    const h = computeCardHeadline({ specDrift: { lifecycle: 'in-progress' } }, null, [], null, 'in-progress', opts());
    assert.strictEqual(h.tone, 'warn');
    assert.strictEqual(h.verb, 'Spec drift');
});

test('rule 1: missing snapshot past backlog → No engine state', () => {
    const h = computeCardHeadline({}, null, [], null, 'in-progress', opts());
    assert.strictEqual(h.verb, 'No engine state');
    assert.strictEqual(h.tone, 'warn');
});

test('rule 1: missing snapshot in inbox does NOT trigger No engine state', () => {
    const h = computeCardHeadline({}, null, [], null, 'inbox', opts());
    assert.strictEqual(h, null);
});

// Rule 2 — terminal lanes
test('rule 2: lane=done → done / Closed', () => {
    const snap = { closedAt: isoMinusSec(3600) };
    const h = computeCardHeadline({}, snap, [], null, 'done', opts());
    assert.strictEqual(h.tone, 'done');
    assert.strictEqual(h.verb, 'Closed');
    assert.strictEqual(h.age, 3600);
});

test("rule 2: feedback wont-fix → done / Won't fix", () => {
    const h = computeCardHeadline({}, null, [], null, 'wont-fix', opts({ entityType: 'feedback' }));
    assert.strictEqual(h.verb, "Won't fix");
});

// Rule 3 — awaiting human input wins over implementing
test('rule 3: awaitingInput supersedes a running drive agent', () => {
    const agents = [{
        id: 'cc',
        status: 'implementing',
        isWorking: true,
        awaitingInput: { message: 'pick option A or B' },
    }];
    const h = computeCardHeadline({}, { currentSpecState: 'implementing' }, agents, null, 'in-progress', opts());
    assert.strictEqual(h.verb, 'Needs you');
    assert.strictEqual(h.tone, 'attention');
    assert.strictEqual(h.owner, 'cc');
    assert.strictEqual(h.detail, 'pick option A or B');
});

// Rule 4 — F492: autonomous-tone label "Confirming <stage>" replaces the old
// user-action-implying "Implementation done · confirm to proceed".
test('rule 4: pendingCompletionSignal with !isWorking → Confirming <stage> (running)', () => {
    const agents = [{
        id: 'cc',
        status: 'ready',
        isWorking: false,
        pendingCompletionSignal: 'implementation-complete',
    }];
    const h = computeCardHeadline({}, { currentSpecState: 'ready' }, agents, null, 'in-progress', opts());
    assert.strictEqual(h.verb, 'Confirming implementation');
    assert.strictEqual(h.tone, 'running');
    assert.strictEqual(h.owner, 'cc');
});

// Rule 5
test('rule 5: evalStatus=pick winner → Eval complete', () => {
    const h = computeCardHeadline({ evalStatus: 'pick winner', winnerAgent: 'cc' }, { currentSpecState: 'evaluating' }, [], null, 'in-progress', opts());
    assert.strictEqual(h.verb, 'Eval complete');
    assert.ok(/cc/.test(h.detail || ''));
});

// Rule 6
test('rule 6: feature inbox → no headline (lane label already conveys prioritisation)', () => {
    const h = computeCardHeadline({}, null, [], null, 'inbox', opts());
    assert.strictEqual(h, null);
});

test('rule 6: feedback inbox → Needs triage', () => {
    const h = computeCardHeadline({}, null, [], null, 'inbox', opts({ entityType: 'feedback' }));
    assert.strictEqual(h.verb, 'Needs triage');
});

// Rule 7
test('rule 7: backlog with blockedBy → no headline (dependency shown in dep chain)', () => {
    const entity = { blockedBy: [{ id: 12 }, { id: 34 }] };
    const h = computeCardHeadline(entity, null, [], null, 'backlog', opts());
    assert.strictEqual(h, null);
});

test('rule 7: backlog ready → no headline', () => {
    const h = computeCardHeadline({}, null, [], null, 'backlog', opts());
    assert.strictEqual(h, null);
});

// Rule 8 — autonomous stages. F492: verb is the active participle so the
// stage name appears once (not paired with a generic "Running ·" prefix).
test('rule 8: running stage → verb-form stage name with owner', () => {
    const plan = { stages: [
        { type: 'implement', status: 'running', agents: [{ id: 'cc' }], startedAt: isoMinusSec(45) },
    ] };
    const h = computeCardHeadline({}, { currentSpecState: 'implementing' }, [], plan, 'in-progress', opts());
    assert.strictEqual(h.verb, 'Implementing');
    assert.strictEqual(h.owner, 'cc');
    assert.strictEqual(h.age, 45);
    assert.strictEqual(h.tone, 'running');
});

test('rule 8: failed stage → Stage failed (warn)', () => {
    const plan = { stages: [
        { type: 'implement', status: 'failed', agents: [{ id: 'cc' }] },
    ] };
    const h = computeCardHeadline({}, { currentSpecState: 'implementing' }, [], plan, 'in-progress', opts());
    assert.strictEqual(h.verb, 'Implement failed');
    assert.strictEqual(h.tone, 'warn');
});

// F492: stage handoff label is autonomous-tone "Starting <noun>" (running)
// replacing the old user-action-flavoured "<Stage> gate" (waiting).
test('rule 8: handoff (waiting after complete) → Starting <stage> (running)', () => {
    const plan = { stages: [
        { type: 'implement', status: 'complete', agents: [{ id: 'cc' }] },
        { type: 'review', status: 'waiting', agents: [{ id: 'gg' }] },
    ] };
    const h = computeCardHeadline({}, { currentSpecState: 'ready' }, [], plan, 'in-progress', opts());
    assert.strictEqual(h.verb, 'Starting review');
    assert.strictEqual(h.owner, 'gg');
    assert.strictEqual(h.tone, 'running');
});

// F492: when every stage is complete and the lane is still in-progress, the
// run finished where the user asked it to stop. Label names the stop point.
test('rule 8: all complete → Stopped at <last-stage> (ready)', () => {
    const plan = { stages: [
        { type: 'implement', status: 'complete', agents: [{ id: 'cc' }] },
        { type: 'review', status: 'complete', agents: [{ id: 'gg' }] },
    ] };
    const h = computeCardHeadline({}, { currentSpecState: 'ready' }, [], plan, 'in-progress', opts());
    assert.strictEqual(h.verb, 'Stopped at review');
    assert.strictEqual(h.tone, 'ready');
});

// Rule 9 — drive/solo
test('rule 9: drive implementing → Implementing with owner', () => {
    const agents = [{ id: 'solo', status: 'implementing', isWorking: true }];
    const h = computeCardHeadline({}, { currentSpecState: 'implementing' }, agents, null, 'in-progress', opts());
    assert.strictEqual(h.verb, 'Implementing');
    assert.strictEqual(h.subject, null);
    assert.strictEqual(h.tone, 'running');
});

test('rule 9: drive ready → ready / Implemented', () => {
    const agents = [{ id: 'solo', status: 'ready', isWorking: false }];
    const h = computeCardHeadline({}, { currentSpecState: 'ready' }, agents, null, 'in-progress', opts());
    assert.strictEqual(h.verb, 'Implemented');
    assert.strictEqual(h.tone, 'ready');
});

test('rule 9: sessionEnded while implementing → Finished (unconfirmed)', () => {
    const agents = [{ id: 'cc', status: 'implementing', isWorking: false, flags: { sessionEnded: true } }];
    const h = computeCardHeadline({}, { currentSpecState: 'implementing' }, agents, null, 'in-progress', opts());
    assert.strictEqual(h.verb, 'Finished (unconfirmed)');
});

test('rule 9: idleLadder needs-attention upgrades tone to attention', () => {
    const agents = [{
        id: 'cc',
        status: 'ready',
        isWorking: false,
        idleLadder: { state: 'needs-attention', idleSec: 600 },
    }];
    const h = computeCardHeadline({}, { currentSpecState: 'ready' }, agents, null, 'in-progress', opts());
    assert.strictEqual(h.tone, 'attention');
    assert.ok(/agent silent/.test(h.detail || ''));
});

test('rule 9: idleLadder idle on non-running agent → Idle with age', () => {
    const agents = [{
        id: 'cc',
        status: 'ready',
        isWorking: false,
        idleLadder: { state: 'idle', idleSec: 1200 },
    }];
    const h = computeCardHeadline({}, { currentSpecState: 'ready' }, agents, null, 'in-progress', opts());
    assert.strictEqual(h.verb, 'Idle');
    assert.strictEqual(h.age, 1200);
});

// Rule 11 — lifecycle fallback
test('rule 11: lifecycle fallback when no agents/plan', () => {
    const snapshot = { currentSpecState: 'code_review_in_progress' };
    const h = computeCardHeadline({}, snapshot, [], null, 'in-progress', opts());
    assert.strictEqual(h.verb, 'Code review');
    assert.strictEqual(h.tone, 'waiting');
});

// Edge: age omitted when timestamp missing
test('age silently drops when timestamp missing', () => {
    const plan = { stages: [{ type: 'implement', status: 'running', agents: [{ id: 'cc' }] }] };
    const h = computeCardHeadline({}, { currentSpecState: 'implementing' }, [], plan, 'in-progress', opts());
    assert.strictEqual(h.age, null);
});

// Combination: warn supersedes running stage
test('combo: warn-class (specDrift) beats a running stage', () => {
    const plan = { stages: [{ type: 'implement', status: 'running', agents: [{ id: 'cc' }] }] };
    const h = computeCardHeadline({ specDrift: { lifecycle: 'in-progress' } }, { currentSpecState: 'implementing' }, [], plan, 'in-progress', opts());
    assert.strictEqual(h.verb, 'Spec drift');
});

report();
