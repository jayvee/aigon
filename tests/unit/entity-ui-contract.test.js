#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { test, report } = require('../_helpers');
const { buildEntityUiContract } = require('../../lib/entity-ui-contract');

function base(overrides = {}) {
    return {
        entity: { type: 'feature', id: '1', displayKey: 'F1', name: 'Contract test' },
        state: { lifecycle: 'implementing', phase: 'implementation', lane: 'in-progress', label: 'Implementing', severity: 'normal' },
        actions: [],
        sessions: [],
        ...overrides,
    };
}

test('running, completed, and failed sessions expose Peek', () => {
    const contract = buildEntityUiContract(base({
        sessions: [
            { sessionName: 'live', status: 'running' },
            { sessionName: 'complete', status: 'complete' },
            { sessionName: 'failed', status: 'failed' },
        ],
    }));
    assert.deepStrictEqual(contract.sessions.map(session => session.affordances[0].actionId), ['peek-session', 'peek-session', 'peek-session']);
    assert.deepStrictEqual(contract.sessions.map(session => session.affordances[0].interaction.mode), ['live', 'snapshot', 'snapshot']);
});

test('ended session without an inspectable record does not fabricate Peek', () => {
    const contract = buildEntityUiContract(base({ sessions: [{ status: 'complete' }] }));
    assert.deepStrictEqual(contract.sessions[0].affordances, []);
});

test('duplicate action identities are rejected', () => {
    assert.throws(() => buildEntityUiContract(base({
        actions: [
            { action: 'feature-pause', label: 'Pause' },
            { action: 'feature-pause', label: 'Pause again' },
        ],
    })), /Duplicate UI contract action identity/);
});

test('disabled actions require a stable unavailable reason', () => {
    assert.throws(() => buildEntityUiContract(base({
        actions: [{ action: 'feature-start', label: 'Start', disabled: true }],
    })), /requires unavailableReason/);
});

test('primary action must identify exactly one enabled decision', () => {
    assert.throws(() => buildEntityUiContract(base({
        actions: [{ action: 'feature-start', label: 'Start', disabled: true, disabledReason: 'Blocked' }],
        primaryActionId: 'feature-start',
    })), /exactly one enabled action/);
});

// F678: every retained session is inspectable, in every terminal state. Live
// sessions resolve to the pane; ended ones to the saved console snapshot.
test('running, completed, stopped, lost, and failed sessions all expose inspection', () => {
    const contract = buildEntityUiContract(base({
        sessions: [
            { sessionName: 'a', status: 'running' },
            { sessionName: 'b', status: 'completed' },
            { sessionName: 'c', status: 'stopped' },
            { sessionName: 'd', status: 'lost' },
            { sessionName: 'e', status: 'failed' },
        ],
    }));
    assert.deepStrictEqual(
        contract.sessions.map(session => session.sessionStatus),
        ['running', 'completed', 'stopped', 'lost', 'failed'],
    );
    assert.ok(contract.sessions.every(session => session.inspection.available));
    assert.deepStrictEqual(
        contract.sessions.map(session => session.inspection.target),
        ['live-pane', 'console-snapshot', 'console-snapshot', 'console-snapshot', 'console-snapshot'],
    );
});

test('a stage-owned worker session is marked so it is not repeated as peer activity', () => {
    const contract = buildEntityUiContract(base({
        sessions: [
            { sessionName: 'worker', status: 'running' },
            { sessionName: 'loose', status: 'running' },
        ],
        plan: { stages: [{ type: 'implement', status: 'running', sessionIds: ['worker'] }] },
    }));
    const [worker, loose] = contract.sessions;
    assert.strictEqual(worker.stageOwned, true);
    assert.strictEqual(worker.owningStageType, 'implement');
    assert.strictEqual(loose.stageOwned, false);
    assert.strictEqual(loose.owningStageType, null);
});

test('internal workflow signals stay in metadata and are never operator actions', () => {
    const contract = buildEntityUiContract(base({
        actions: [
            { action: 'feature-close', label: 'Close' },
            { action: 'feature.auto_advance', label: 'Auto advance', metadata: { uiVisibility: 'internal' } },
        ],
    }));
    const exposed = contract.decisions.actions.concat(contract.tools).map(action => action.actionId);
    assert.deepStrictEqual(exposed, ['feature-close']);
    assert.deepStrictEqual(contract.internalSignals.map(signal => signal.actionId), ['feature.auto_advance']);
});

// Malformed contracts must fail loudly at the collector, never reach the browser
// as a half-built row the renderer has to guess about.
test('an unknown entity kind is rejected rather than silently rendered', () => {
    assert.throws(
        () => buildEntityUiContract(base({ entity: { type: 'sprint', id: '1' } })),
        /requires a known kind/,
    );
});

test('an entity without an id is rejected', () => {
    assert.throws(
        () => buildEntityUiContract(base({ entity: { type: 'feature', id: '' } })),
        /requires an id/,
    );
});

test('set membership without a slug is rejected rather than half-rendered', () => {
    assert.throws(
        () => buildEntityUiContract(base({ entity: { type: 'feature', id: '1', set: { name: 'no slug' } } })),
        /set membership requires a slug/,
    );
});

report();
