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

report();
