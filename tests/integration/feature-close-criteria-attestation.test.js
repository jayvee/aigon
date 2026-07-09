#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { testAsync, withTempDirAsync, report } = require('../_helpers');
const engine = require('../../lib/workflow-core/engine');
const wf = require('../../lib/workflow-core');
const { resolveCloseIntegrityPolicy, isCloseFindingBlocking } = require('../../lib/close-integrity-policy');

const REPO_DIRS = [
    'docs/specs/features/03-in-progress',
    'docs/specs/features/logs',
    '.aigon/workflows/features',
];

function withTempRepo(fn) {
    return withTempDirAsync('aigon-criteria-inert-', async (dir) => {
        for (const sub of REPO_DIRS) fs.mkdirSync(path.join(dir, sub), { recursive: true });
        return fn(dir);
    });
}

async function bootstrapFeature(repo, id) {
    const specPath = path.join(repo, 'docs/specs/features/03-in-progress', `feature-${id}-criteria-inert.md`);
    fs.writeFileSync(specPath, [
        '---',
        'complexity: low',
        '---',
        '# Feature: criteria inert',
        '',
        '## Acceptance Criteria',
        '- [ ] Ship behavior',
        '',
        '## Validation',
        'none',
        '',
    ].join('\n'));
    await engine.startFeature(repo, id, 'solo_branch', ['cc']);
    await engine.signalAgentReady(repo, id, 'cc');
    return specPath;
}

testAsync('close integrity policy is advisory by default with strict opt-in', () => {
    const def = resolveCloseIntegrityPolicy({});
    assert.strictEqual(isCloseFindingBlocking(def, 'review-escalation'), false);
    assert.strictEqual(isCloseFindingBlocking(def, 'preauth-validation'), false);
    assert.strictEqual(isCloseFindingBlocking(def, 'post-merge-gate'), false);

    const strict = resolveCloseIntegrityPolicy({ featureClose: { integrityPolicy: 'blocking' } });
    assert.strictEqual(isCloseFindingBlocking(strict, 'review-escalation'), true);
    assert.strictEqual(isCloseFindingBlocking(strict, 'preauth-validation'), true);
    assert.strictEqual(isCloseFindingBlocking(strict, 'post-merge-gate'), true);

    const selected = resolveCloseIntegrityPolicy({
        featureClose: {
            blockingGates: ['post-merge-gate'],
            advisoryGates: ['review-escalation'],
        },
    });
    assert.strictEqual(isCloseFindingBlocking(selected, 'post-merge-gate'), true);
    assert.strictEqual(isCloseFindingBlocking(selected, 'review-escalation'), false);
});

testAsync('historical criteria attestation events do not project state', () => withTempRepo(async (repo) => {
    await bootstrapFeature(repo, '01');
    await wf.persistEntityEvents(repo, 'feature', '01', [
        {
            type: 'feature.criteria_attested',
            featureId: '01',
            counts: { total: 1, met: 1 },
            criteria: [{ index: 1, status: 'met', evidence: 'old log' }],
            at: new Date().toISOString(),
        },
        {
            type: 'feature.criteria_attestation_bypassed',
            featureId: '01',
            at: new Date().toISOString(),
        },
    ]);
    const snap = await wf.showFeature(repo, '01');
    assert.strictEqual(snap.lastCriteriaAttestation, null);
    assert.strictEqual(snap.lastCloseFailure, null);
}));

testAsync('historical criteria close-gate failure is ignored by replay', () => withTempRepo(async (repo) => {
    await bootstrapFeature(repo, '02');
    await wf.persistEntityEvents(repo, 'feature', '02', [{
        type: 'feature.close_gate_failed',
        featureId: '02',
        gateKind: 'criteria-attestation',
        unattested: [1],
        outputTail: 'missing old attestation',
        at: new Date().toISOString(),
    }]);
    const snap = await wf.showFeature(repo, '02');
    assert.strictEqual(snap.lastCloseFailure, null);
}));

testAsync('old implementation log criteria attestation section is inert prose', () => withTempRepo(async (repo) => {
    await bootstrapFeature(repo, '03');
    fs.writeFileSync(
        path.join(repo, 'docs/specs/features/logs/feature-03-cc-criteria-inert-log.md'),
        '# Log\n\n## Criteria Attestation\n1. deferred - old note\n',
    );
    const snap = await wf.showFeature(repo, '03');
    assert.strictEqual(snap.lastCriteriaAttestation, null);
    assert.strictEqual(snap.openEscalations.length, 0);
}));

report();
