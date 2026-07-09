#!/usr/bin/env node
'use strict';

// REGRESSION F658: close readiness projection — single authoritative blocker.

const assert = require('assert');
const { test, report } = require('../_helpers');
const { buildCloseReadiness, applyCloseReadinessActionPriority } = require('../../lib/close-readiness');
const { computeCardHeadline } = require('../../lib/card-headline');

const NOW = Date.parse('2026-07-09T12:00:00Z');

function snap(overrides) {
    return {
        currentSpecState: 'ready',
        lifecycle: 'ready',
        openEscalations: [],
        ...overrides,
    };
}

test('F656-shaped row: open escalation blocks ready and autonomous handoff headline', () => {
    const snapshot = snap({
        openEscalations: [{
            category: 'architectural',
            reason: 'Phase B shortfall',
            escalationId: 'e1',
        }],
    });
    const entity = {
        id: '56',
        stage: 'in-progress',
        agents: [{ id: 'cu', status: 'ready' }],
        autonomousController: {
            status: 'stopped',
            reason: 'escalation-pending',
        },
        autonomousPlan: {
            stages: [
                { type: 'review', status: 'complete', agents: [{ id: 'cx' }] },
                { type: 'close', status: 'waiting', agents: [{ id: 'cu' }] },
            ],
        },
    };
    const readiness = buildCloseReadiness(entity, snapshot, { stage: 'in-progress' });
    assert.strictEqual(readiness.ready, false);
    assert.strictEqual(readiness.primaryBlocker.kind, 'open-escalation');
    const headline = computeCardHeadline(
        { ...entity, closeReadiness: readiness },
        snapshot,
        entity.agents,
        entity.autonomousPlan,
        'in-progress',
        { entityType: 'feature', closeReadiness: readiness, now: NOW },
    );
    assert.ok(headline.verb.startsWith('Blocked:'));
    assert.ok(!headline.verb.includes('Starting close'));
});

test('criteria attestation missing lists indices', () => {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-cr-'));
    const specPath = path.join(dir, 'spec.md');
    fs.writeFileSync(specPath, '# Feature\n\n## Acceptance Criteria\n\n- [ ] One\n- [ ] Two\n');
    const snapshot = snap({});
    const readiness = buildCloseReadiness(
        { id: '01', stage: 'in-progress', agents: [{ id: 'cu', status: 'ready' }] },
        snapshot,
        { repoPath: dir, featureId: '01', specPath, stage: 'in-progress' },
    );
    assert.strictEqual(readiness.ready, false);
    const criteria = readiness.blockers.find(b => b.kind === 'criteria-attestation');
    assert.ok(criteria);
    assert.ok(/1/.test(criteria.detail));
    fs.rmSync(dir, { recursive: true, force: true });
});

test('applyCloseReadinessActionPriority keeps one primary escalation action', () => {
    const readiness = {
        primaryBlocker: { actionKind: 'feature-escalation-accept' },
    };
    const actions = [
        { action: 'feature-close', priority: 'high', label: 'Close' },
        { action: 'feature-escalation-accept', priority: 'high', label: 'Acknowledge & proceed' },
        { action: 'feature-escalation-reopen', priority: 'high', label: 'Send back' },
    ];
    const out = applyCloseReadinessActionPriority(actions, readiness);
    assert.strictEqual(out.find(a => a.action === 'feature-escalation-accept').priority, 'high');
    assert.strictEqual(out.find(a => a.action === 'feature-close').priority, 'normal');
});

test('applicable false for implementing stage without close signals', () => {
    const snapshot = snap({ currentSpecState: 'implementing', lifecycle: 'implementing' });
    const readiness = buildCloseReadiness(
        { id: '01', stage: 'in-progress', agents: [{ id: 'cu', status: 'implementing' }] },
        snapshot,
        { stage: 'in-progress' },
    );
    assert.strictEqual(readiness.applicable, false);
});

report();
