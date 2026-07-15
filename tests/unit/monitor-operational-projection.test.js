'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    buildMonitorOperationalProjection,
    classifyOperationalGroup,
    monitorOperationalFingerprint,
} = require('../../lib/monitor-operational-projection');

function contract(overrides = {}) {
    return {
        entity: { kind: 'feature', id: '1', displayKey: 'F1', name: 'Test', title: 'Test' },
        state: { lane: 'in-progress', severity: 'active', label: 'Implementing' },
        presentation: { headline: { verb: 'CC is implementing' } },
        decisions: { primaryActionId: null, actions: [] },
        blockers: [],
        agents: [{ id: 'cc', status: 'running' }],
        sessions: [],
        ...overrides,
    };
}

test('classifyOperationalGroup — attention from error severity', () => {
    const group = classifyOperationalGroup(contract({
        state: { lane: 'in-progress', severity: 'error', label: 'Failed' },
    }), new Date().toISOString(), Date.now());
    assert.equal(group, 'needsAttention');
});

test('classifyOperationalGroup — running active work', () => {
    const group = classifyOperationalGroup(contract(), new Date().toISOString(), Date.now());
    assert.equal(group, 'running');
});

test('buildMonitorOperationalProjection — groups entities with contracts from all repos', () => {
    const now = Date.now();
    const payload = buildMonitorOperationalProjection([{
        path: '/tmp/repo',
        features: [{
            id: '10',
            updatedAt: new Date(now).toISOString(),
            uiContract: contract({
                state: { lane: 'in-progress', severity: 'error', label: 'Review failed' },
            }),
        }],
        research: [],
        sets: [],
    }, {
        path: '/tmp/other',
        features: [{
            id: '11',
            updatedAt: new Date(now).toISOString(),
            uiContract: contract(),
        }],
        research: [],
        sets: [],
    }]);

    assert.equal(payload.summary.needsAttention, 1);
    assert.equal(payload.summary.running, 1);
    assert.equal(payload.groups.needsAttention.length, 1);
    assert.equal(payload.groups.needsAttention[0].entityId, '10');
    assert.equal(payload.groups.running[0].entityId, '11');
});

test('monitorOperationalFingerprint bumps when group membership changes', () => {
    const now = Date.now();
    const base = buildMonitorOperationalProjection([{
        path: '/tmp/repo',
        features: [{
            id: '1',
            updatedAt: new Date(now).toISOString(),
            uiContract: contract(),
        }],
        research: [],
        sets: [],
    }]);
    const changed = buildMonitorOperationalProjection([{
        path: '/tmp/repo',
        features: [{
            id: '1',
            updatedAt: new Date(now).toISOString(),
            uiContract: contract({
                state: { lane: 'in-progress', severity: 'error', label: 'Failed' },
            }),
        }],
        research: [],
        sets: [],
    }]);
    assert.notEqual(monitorOperationalFingerprint(base), monitorOperationalFingerprint(changed));
});
