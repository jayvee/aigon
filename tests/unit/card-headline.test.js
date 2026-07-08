#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { test, report } = require('../_helpers');
const { computeCardHeadline } = require('../../lib/card-headline');

const NOW = Date.parse('2026-04-30T12:00:00Z');
const isoMinusSec = sec => new Date(NOW - sec * 1000).toISOString();

function call(entity, snap, agents, plan, lane, entityType) {
    return computeCardHeadline(entity, snap, agents, plan, lane, { entityType: entityType || 'feature', now: NOW });
}

// Each row exercises one rule path. `expect` is a partial — assert only listed keys.
// `expect === null` asserts the headline itself is null.
const CASES = [
    // --- Rule 1: warn class wins over everything ---
    ['1', 'lastCloseFailure produces warn + reason + age',
        { lastCloseFailure: { reason: 'tests failed', at: isoMinusSec(120) }, autonomousPlan: { stages: [{ type: 'implement', status: 'running', agents: [{ id: 'cc' }] }] } },
        null, [], { stages: [{ type: 'implement', status: 'running', agents: [{ id: 'cc' }] }] }, 'in-progress', null,
        { tone: 'warn', verb: 'Close failed', detail: 'tests failed', age: 120 }],
    ['1', 'specDrift → warn / Spec drift',
        { specDrift: { lifecycle: 'in-progress' } }, null, [], null, 'in-progress', null,
        { tone: 'warn', verb: 'Spec drift' }],
    ['1', 'missing snapshot past backlog → No engine state',
        {}, null, [], null, 'in-progress', null,
        { verb: 'No engine state', tone: 'warn' }],
    ['1', 'missing snapshot in inbox → null',
        {}, null, [], null, 'inbox', null, null],

    // --- Rule 2: terminal lanes ---
    ['2', 'lane=done → done / Closed',
        {}, { closedAt: isoMinusSec(3600) }, [], null, 'done', null,
        { tone: 'done', verb: 'Closed', age: 3600 }],
    ['2', "feedback wont-fix → Won't fix",
        {}, null, [], null, 'wont-fix', 'feedback', { verb: "Won't fix" }],
    ['2', 'failed autonomous controller overrides failed stage headline',
        { autonomousController: { status: 'failed', reasonLabel: 'Reviewer exited without signaling', updatedAt: isoMinusSec(300), sessionName: 'mock-auto', sessionRunning: false } },
        { currentSpecState: 'code_review_in_progress' }, [],
        { stages: [{ type: 'review', status: 'failed', agents: [{ id: 'gg' }] }] }, 'in-progress', null,
        { tone: 'warn', verb: 'Autonomous failed', detailMatches: /Reviewer exited without signaling.*session exited/, age: 300 }],

    // --- Rule 3: awaiting input supersedes implementing ---
    ['3', 'awaitingInput beats a running drive agent',
        {}, { currentSpecState: 'implementing' },
        [{ id: 'cc', status: 'implementing', isWorking: true, awaitingInput: { message: 'pick option A or B' } }],
        null, 'in-progress', null,
        { verb: 'Needs you', tone: 'attention', owner: 'cc', detail: 'pick option A or B' }],

    // --- Rule 4: F492 autonomous-tone "Confirming <stage>" ---
    ['4', 'pendingCompletionSignal w/ !isWorking → Confirming implementation',
        {}, { currentSpecState: 'ready' },
        [{ id: 'cc', status: 'ready', isWorking: false, pendingCompletionSignal: 'implementation-complete' }],
        null, 'in-progress', null,
        { verb: 'Confirming implementation', tone: 'running', owner: 'cc' }],

    // --- Rule 5: eval status ---
    ['5', 'evalStatus=pick winner → Eval complete (detail names winner)',
        { evalStatus: 'pick winner', winnerAgent: 'cc' }, { currentSpecState: 'evaluating' }, [], null, 'in-progress', null,
        { verb: 'Eval complete', detailMatches: /cc/ }],

    // --- Rule 6: inbox ---
    ['6', 'feature inbox → null (lane label conveys prioritisation)',
        {}, null, [], null, 'inbox', null, null],
    ['6', 'feedback inbox → Needs triage',
        {}, null, [], null, 'inbox', 'feedback', { verb: 'Needs triage' }],

    // --- Rule 7: backlog ---
    ['7', 'backlog with blockedBy → null',
        { blockedBy: [{ id: 12 }, { id: 34 }] }, null, [], null, 'backlog', null, null],
    ['7', 'backlog ready → null',
        {}, null, [], null, 'backlog', null, null],

    // --- Rule 8: autonomous stages (F492 active participle) ---
    ['8', 'running stage → verb-form stage name + owner + age',
        {}, { currentSpecState: 'implementing' }, [],
        { stages: [{ type: 'implement', status: 'running', agents: [{ id: 'cc' }], startedAt: isoMinusSec(45) }] }, 'in-progress', null,
        { verb: 'Implementing', owner: 'cc', age: 45, tone: 'running' }],
    ['8', 'failed stage → Stage failed (warn)',
        {}, { currentSpecState: 'implementing' }, [],
        { stages: [{ type: 'implement', status: 'failed', agents: [{ id: 'cc' }] }] }, 'in-progress', null,
        { verb: 'Implement failed', tone: 'warn' }],
    ['8', 'handoff (waiting after complete) → Starting <stage> (running)',
        {}, { currentSpecState: 'ready' }, [],
        { stages: [
            { type: 'implement', status: 'complete', agents: [{ id: 'cc' }] },
            { type: 'review', status: 'waiting', agents: [{ id: 'gg' }] },
        ] }, 'in-progress', null,
        { verb: 'Starting review', owner: 'gg', tone: 'running' }],
    ['8', 'all complete → Stopped at <last-stage> (ready)',
        {}, { currentSpecState: 'ready' }, [],
        { stages: [
            { type: 'implement', status: 'complete', agents: [{ id: 'cc' }] },
            { type: 'review', status: 'complete', agents: [{ id: 'gg' }] },
        ] }, 'in-progress', null,
        { verb: 'Stopped at review', tone: 'ready' }],

    // --- Rule 9: drive/solo ---
    ['9', 'drive implementing → Implementing (no subject, tone running)',
        {}, { currentSpecState: 'implementing' },
        [{ id: 'solo', status: 'implementing', isWorking: true }], null, 'in-progress', null,
        { verb: 'Implementing', subject: null, tone: 'running' }],
    ['9', 'drive ready → ready / Implemented',
        {}, { currentSpecState: 'ready' },
        [{ id: 'solo', status: 'ready', isWorking: false }], null, 'in-progress', null,
        { verb: 'Implemented', tone: 'ready' }],
    ['9', 'sessionEnded while implementing → Finished (unconfirmed)',
        {}, { currentSpecState: 'implementing' },
        [{ id: 'cc', status: 'implementing', isWorking: false, flags: { sessionEnded: true } }], null, 'in-progress', null,
        { verb: 'Finished (unconfirmed)' }],
    ['9', 'idleLadder needs-attention upgrades tone',
        {}, { currentSpecState: 'ready' },
        [{ id: 'cc', status: 'ready', isWorking: false, idleLadder: { state: 'needs-attention', idleSec: 600 } }], null, 'in-progress', null,
        { tone: 'attention', detailMatches: /agent silent/ }],
    ['9', 'idleLadder idle on non-running → Idle with age',
        {}, { currentSpecState: 'ready' },
        [{ id: 'cc', status: 'ready', isWorking: false, idleLadder: { state: 'idle', idleSec: 1200 } }], null, 'in-progress', null,
        { verb: 'Idle', age: 1200 }],

    // --- Rule 11: lifecycle fallback ---
    ['11', 'lifecycle fallback when no agents/plan',
        {}, { currentSpecState: 'code_review_in_progress' }, [], null, 'in-progress', null,
        { verb: 'Code review', tone: 'waiting' }],

    // --- Edges / combinations ---
    ['edge', 'age silently drops when timestamp missing',
        {}, { currentSpecState: 'implementing' }, [],
        { stages: [{ type: 'implement', status: 'running', agents: [{ id: 'cc' }] }] }, 'in-progress', null,
        { age: null }],
    ['combo', 'warn-class (specDrift) beats a running stage',
        { specDrift: { lifecycle: 'in-progress' } }, { currentSpecState: 'implementing' }, [],
        { stages: [{ type: 'implement', status: 'running', agents: [{ id: 'cc' }] }] }, 'in-progress', null,
        { verb: 'Spec drift' }],
];

for (const [rule, name, entity, snap, agents, plan, lane, etype, expect] of CASES) {
    test(`rule ${rule}: ${name}`, () => {
        const h = call(entity, snap, agents, plan, lane, etype);
        if (expect === null) { assert.strictEqual(h, null); return; }
        for (const [k, v] of Object.entries(expect)) {
            if (k === 'detailMatches') {
                assert.ok(v.test(h.detail || ''), `detail "${h.detail}" must match ${v}`);
            } else {
                assert.strictEqual(h[k], v, `${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(h[k])}`);
            }
        }
    });
}

report();
