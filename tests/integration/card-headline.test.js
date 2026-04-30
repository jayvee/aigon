#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { test, report } = require('../_helpers');
const { computeCardHeadline } = require('../../lib/card-headline');

const NOW = Date.parse('2026-04-30T12:00:00Z');
const isoMinusSec = sec => new Date(NOW - sec * 1000).toISOString();

const opts = (extra) => ({ entityType: 'feature', now: NOW, ...(extra || {}) });

// Rule 1 — warn-class supersedes everything else
test('rule 1: lastCloseFailure produces warn / CLOSE FAILED with reason and age', () => {
    const entity = {
        lastCloseFailure: { reason: 'tests failed', at: isoMinusSec(120) },
        // these would otherwise produce a different headline
        autonomousPlan: { stages: [{ type: 'implement', status: 'running', agents: [{ id: 'cc' }] }] },
    };
    const h = computeCardHeadline(entity, null, [], entity.autonomousPlan, 'in-progress', opts());
    assert.strictEqual(h.tone, 'warn');
    assert.strictEqual(h.verb, 'CLOSE FAILED');
    assert.strictEqual(h.detail, 'tests failed');
    assert.strictEqual(h.age, 120);
});

test('rule 1: rebaseNeeded → warn / REBASE NEEDED', () => {
    const h = computeCardHeadline({ rebaseNeeded: true }, null, [], null, 'in-progress', opts());
    assert.strictEqual(h.tone, 'warn');
    assert.strictEqual(h.verb, 'REBASE NEEDED');
});

test('rule 1: specDrift → warn / SPEC DRIFT', () => {
    const h = computeCardHeadline({ specDrift: { lifecycle: 'in-progress' } }, null, [], null, 'in-progress', opts());
    assert.strictEqual(h.tone, 'warn');
    assert.strictEqual(h.verb, 'SPEC DRIFT');
});

test('rule 1: missing snapshot past backlog → NO ENGINE STATE', () => {
    const h = computeCardHeadline({}, null, [], null, 'in-progress', opts());
    assert.strictEqual(h.verb, 'NO ENGINE STATE');
    assert.strictEqual(h.tone, 'warn');
});

test('rule 1: missing snapshot in inbox does NOT trigger NO ENGINE STATE', () => {
    const h = computeCardHeadline({}, null, [], null, 'inbox', opts());
    assert.strictEqual(h, null);
});

// Rule 2 — terminal lanes
test('rule 2: lane=done → done / DONE', () => {
    const snap = { closedAt: isoMinusSec(3600) };
    const h = computeCardHeadline({}, snap, [], null, 'done', opts());
    assert.strictEqual(h.tone, 'done');
    assert.strictEqual(h.verb, 'DONE');
    assert.strictEqual(h.age, 3600);
});

test("rule 2: feedback wont-fix → done / WON'T FIX", () => {
    const h = computeCardHeadline({}, null, [], null, 'wont-fix', opts({ entityType: 'feedback' }));
    assert.strictEqual(h.verb, "WON'T FIX");
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
    assert.strictEqual(h.verb, 'NEEDS YOU');
    assert.strictEqual(h.tone, 'attention');
    assert.strictEqual(h.owner, 'cc');
    assert.strictEqual(h.detail, 'pick option A or B');
});

// Rule 4
test('rule 4: pendingCompletionSignal with !isWorking → CONFIRM <SIGNAL>', () => {
    const agents = [{
        id: 'cc',
        status: 'submitted',
        isWorking: false,
        pendingCompletionSignal: 'implementation-complete',
    }];
    const h = computeCardHeadline({}, { currentSpecState: 'submitted' }, agents, null, 'in-progress', opts());
    assert.strictEqual(h.verb, 'CONFIRM IMPLEMENTATION-COMPLETE');
    assert.strictEqual(h.owner, 'cc');
});

// Rule 5
test('rule 5: evalStatus=pick winner → PICK WINNER', () => {
    const h = computeCardHeadline({ evalStatus: 'pick winner', winnerAgent: 'cc' }, { currentSpecState: 'evaluating' }, [], null, 'in-progress', opts());
    assert.strictEqual(h.verb, 'PICK WINNER');
    assert.ok(/cc/.test(h.detail || ''));
});

// Rule 6
test('rule 6: feature inbox → no headline (lane label already conveys prioritisation)', () => {
    const h = computeCardHeadline({}, null, [], null, 'inbox', opts());
    assert.strictEqual(h, null);
});

test('rule 6: feedback inbox → NEEDS TRIAGE', () => {
    const h = computeCardHeadline({}, null, [], null, 'inbox', opts({ entityType: 'feedback' }));
    assert.strictEqual(h.verb, 'NEEDS TRIAGE');
});

// Rule 7
test('rule 7: backlog with blockedBy → BLOCKED with detail', () => {
    const entity = { blockedBy: [{ id: 12 }, { id: 34 }] };
    const h = computeCardHeadline(entity, null, [], null, 'backlog', opts());
    assert.strictEqual(h.verb, 'BLOCKED');
    assert.strictEqual(h.tone, 'blocked');
    assert.strictEqual(h.detail, 'waiting on #12, #34');
});

test('rule 7: backlog ready → READY TO START', () => {
    const h = computeCardHeadline({}, null, [], null, 'backlog', opts());
    assert.strictEqual(h.verb, 'READY TO START');
});

// Rule 8 — autonomous stages
test('rule 8: running stage → RUNNING · STAGE with owner', () => {
    const plan = { stages: [
        { type: 'implement', status: 'running', agents: [{ id: 'cc' }], startedAt: isoMinusSec(45) },
    ] };
    const h = computeCardHeadline({}, { currentSpecState: 'implementing' }, [], plan, 'in-progress', opts());
    assert.strictEqual(h.verb, 'RUNNING · IMPLEMENT');
    assert.strictEqual(h.owner, 'cc');
    assert.strictEqual(h.age, 45);
    assert.strictEqual(h.tone, 'running');
});

test('rule 8: failed stage → STAGE FAILED (warn)', () => {
    const plan = { stages: [
        { type: 'implement', status: 'failed', agents: [{ id: 'cc' }] },
    ] };
    const h = computeCardHeadline({}, { currentSpecState: 'implementing' }, [], plan, 'in-progress', opts());
    assert.strictEqual(h.verb, 'IMPLEMENT FAILED');
    assert.strictEqual(h.tone, 'warn');
});

test('rule 8: gate (waiting after complete) → STAGE GATE', () => {
    const plan = { stages: [
        { type: 'implement', status: 'complete', agents: [{ id: 'cc' }] },
        { type: 'review', status: 'waiting', agents: [{ id: 'gg' }] },
    ] };
    const h = computeCardHeadline({}, { currentSpecState: 'submitted' }, [], plan, 'in-progress', opts());
    assert.strictEqual(h.verb, 'REVIEW GATE');
    assert.strictEqual(h.owner, 'gg');
    assert.strictEqual(h.tone, 'waiting');
});

test('rule 8: all complete → READY TO CLOSE', () => {
    const plan = { stages: [
        { type: 'implement', status: 'complete', agents: [{ id: 'cc' }] },
        { type: 'review', status: 'complete', agents: [{ id: 'gg' }] },
    ] };
    const h = computeCardHeadline({}, { currentSpecState: 'submitted' }, [], plan, 'in-progress', opts());
    assert.strictEqual(h.verb, 'READY TO CLOSE');
    assert.strictEqual(h.tone, 'ready');
});

// Rule 9 — drive/solo
test('rule 9: drive implementing → RUNNING with owner', () => {
    const agents = [{ id: 'solo', status: 'implementing', isWorking: true }];
    const h = computeCardHeadline({}, { currentSpecState: 'implementing' }, agents, null, 'in-progress', opts());
    assert.strictEqual(h.verb, 'RUNNING');
    assert.strictEqual(h.subject, 'Implement');
    assert.strictEqual(h.tone, 'running');
});

test('rule 9: drive submitted → attention / SUBMITTED', () => {
    const agents = [{ id: 'solo', status: 'submitted', isWorking: false }];
    const h = computeCardHeadline({}, { currentSpecState: 'submitted' }, agents, null, 'in-progress', opts());
    assert.strictEqual(h.verb, 'SUBMITTED');
    assert.strictEqual(h.tone, 'attention');
});

test('rule 9: sessionEnded while implementing → FINISHED (UNCONFIRMED)', () => {
    const agents = [{ id: 'cc', status: 'implementing', isWorking: false, flags: { sessionEnded: true } }];
    const h = computeCardHeadline({}, { currentSpecState: 'implementing' }, agents, null, 'in-progress', opts());
    assert.strictEqual(h.verb, 'FINISHED (UNCONFIRMED)');
});

test('rule 9: idleLadder needs-attention upgrades tone to attention', () => {
    const agents = [{
        id: 'cc',
        status: 'submitted',
        isWorking: false,
        idleLadder: { state: 'needs-attention', idleSec: 600 },
    }];
    const h = computeCardHeadline({}, { currentSpecState: 'submitted' }, agents, null, 'in-progress', opts());
    assert.strictEqual(h.tone, 'attention');
    assert.ok(/agent silent/.test(h.detail || ''));
});

test('rule 9: idleLadder idle on non-running agent → IDLE with age', () => {
    const agents = [{
        id: 'cc',
        status: 'submitted',
        isWorking: false,
        idleLadder: { state: 'idle', idleSec: 1200 },
    }];
    const h = computeCardHeadline({}, { currentSpecState: 'submitted' }, agents, null, 'in-progress', opts());
    assert.strictEqual(h.verb, 'IDLE');
    assert.strictEqual(h.age, 1200);
});

// Rule 11 — lifecycle fallback
test('rule 11: lifecycle fallback when no agents/plan', () => {
    const snapshot = { currentSpecState: 'code_review_in_progress' };
    const h = computeCardHeadline({}, snapshot, [], null, 'in-progress', opts());
    assert.strictEqual(h.verb, 'CODE REVIEW');
    assert.strictEqual(h.tone, 'waiting');
});

// Edge: age omitted when timestamp missing
test('age silently drops when timestamp missing', () => {
    const plan = { stages: [{ type: 'implement', status: 'running', agents: [{ id: 'cc' }] }] };
    const h = computeCardHeadline({}, { currentSpecState: 'implementing' }, [], plan, 'in-progress', opts());
    assert.strictEqual(h.age, null);
});

// Combination: warn supersedes running stage
test('combo: warn-class beats a running stage', () => {
    const plan = { stages: [{ type: 'implement', status: 'running', agents: [{ id: 'cc' }] }] };
    const h = computeCardHeadline({ rebaseNeeded: true }, { currentSpecState: 'implementing' }, [], plan, 'in-progress', opts());
    assert.strictEqual(h.verb, 'REBASE NEEDED');
});

report();
