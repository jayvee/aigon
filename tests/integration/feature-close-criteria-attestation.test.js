#!/usr/bin/env node
'use strict';

// REGRESSION F630: unattested acceptance criteria must block close with actionable output.
// REGRESSION F647: deferred attestation raises spec-shortfall escalation once; bypass records event.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { testAsync, withTempDirAsync, report } = require('../_helpers');
const engine = require('../../lib/workflow-core/engine');
const wf = require('../../lib/workflow-core');
const {
    parseCriteriaAttestationLines,
    enumerateAcceptanceCriteria,
    validateCriteriaAttestation,
    stableCriteriaEscalationId,
    syncCriteriaDeferredEscalations,
} = require('../../lib/criteria-attestation');
const {
    recordCriteriaAttestationFailure,
    recordCriteriaAttestationBypass,
    recordCriteriaAttested,
    isCriteriaAttestationRetry,
} = require('../../lib/feature-close');
const { runEscalationCloseGuard } = require('../../lib/feature-escalation');

const REPO_DIRS = [
    'docs/specs/features/03-in-progress',
    'docs/specs/features/logs',
    '.aigon/workflows/features',
];

function withTempRepo(fn) {
    return withTempDirAsync('aigon-criteria-attest-', async (dir) => {
        for (const sub of REPO_DIRS) fs.mkdirSync(path.join(dir, sub), { recursive: true });
        return fn(dir);
    });
}

function writeSpec(repo, id, name, criteria = []) {
    const criteriaBlock = criteria.length
        ? `\n## Acceptance Criteria\n${criteria.map((line) => `- [ ] ${line}`).join('\n')}\n`
        : '';
    const specPath = path.join(repo, 'docs/specs/features/03-in-progress', `feature-${id}-${name}.md`);
    fs.writeFileSync(specPath, `---\ncomplexity: low\n---\n# Feature: ${name}\n${criteriaBlock}\n## Validation\nx\n`);
    return specPath;
}

function writeLog(repo, id, attestationBody) {
    const file = `feature-${id}-cu-sample-log.md`;
    const full = path.join(repo, 'docs/specs/features/logs', file);
    const body = `# Log\n\n## Criteria Attestation\n${attestationBody}\n`;
    fs.writeFileSync(full, body);
    return { file, rel: `docs/specs/features/logs/${file}`, full };
}

async function bootstrapFeature(repo, id, name, criteria) {
    writeSpec(repo, id, name, criteria);
    await engine.startFeature(repo, id, 'solo_branch', ['cc']);
    await engine.signalAgentReady(repo, id, 'cc');
}

testAsync('enumerateAcceptanceCriteria: stable indices', () => {
    const spec = '## Acceptance Criteria\n- [ ] first\n- [ ] second\n';
    const rows = enumerateAcceptanceCriteria(spec);
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].index, 1);
    assert.strictEqual(rows[1].index, 2);
});

testAsync('parseCriteriaAttestationLines: met/deferred/dropped', () => {
    const map = parseCriteriaAttestationLines([
        '## Criteria Attestation',
        '1. met — integration test foo.test.js',
        '2. deferred — out of scope for v1',
        '3. dropped — spec revised abc1234',
    ].join('\n'));
    assert.strictEqual(map.size, 3);
    assert.strictEqual(map.get(1).status, 'met');
    assert.strictEqual(map.get(2).status, 'deferred');
});

testAsync('REGRESSION F630: missing attestation blocks validation', () => withTempRepo(async (repo) => {
    const specPath = writeSpec(repo, '01', 'attest-missing', ['Ship parser', 'Ship close guard']);
    writeLog(repo, '01', '1. met — tests/integration/foo.test.js\n');
    const result = validateCriteriaAttestation(specPath, repo, '01');
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.unattested, [2]);
}));

testAsync('fully attested validation passes', () => withTempRepo(async (repo) => {
    const specPath = writeSpec(repo, '02', 'attest-pass', ['A', 'B']);
    writeLog(repo, '02', '1. met — test a\n2. met — test b\n');
    const result = validateCriteriaAttestation(specPath, repo, '02');
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.counts.met, 2);
}));

testAsync('deferred raises escalation once and blocks close', () => withTempRepo(async (repo) => {
    await bootstrapFeature(repo, '03', 'attest-deferred', ['Must ship', 'May slip']);
    const specPath = writeSpec(repo, '03', 'attest-deferred', ['Must ship', 'May slip']);
    const log = writeLog(repo, '03', '1. met — test\n2. deferred — Phase B partial\n');
    const validation = validateCriteriaAttestation(specPath, repo, '03');
    assert.strictEqual(validation.ok, true);

    const first = await syncCriteriaDeferredEscalations(repo, '03', validation, wf);
    assert.strictEqual(first.raised, 1);
    const second = await syncCriteriaDeferredEscalations(repo, '03', validation, wf);
    assert.strictEqual(second.raised, 0);

    const snap = await wf.showFeature(repo, '03');
    assert.strictEqual(snap.openEscalations.length, 1);
    assert.strictEqual(snap.openEscalations[0].category, 'spec-shortfall');
    assert.strictEqual(snap.openEscalations[0].source, 'criteria-attestation');
    const expectedId = stableCriteriaEscalationId('03', 2);
    assert.strictEqual(snap.openEscalations[0].escalationId, expectedId);

    const blocked = await runEscalationCloseGuard(repo, '03');
    assert.strictEqual(blocked.ok, false);
    assert.ok(log.rel);
}));

testAsync('spec-revised extra criterion requires new attestation line', () => withTempRepo(async (repo) => {
    const specPath = writeSpec(repo, '04', 'attest-revise', ['Original']);
    writeLog(repo, '04', '1. met — done\n');
    let result = validateCriteriaAttestation(specPath, repo, '04');
    assert.strictEqual(result.ok, true);

    const content = fs.readFileSync(specPath, 'utf8');
    fs.writeFileSync(specPath, content.replace(
        '- [ ] Original',
        '- [ ] Original\n- [ ] Added by spec-revise',
    ));
    result = validateCriteriaAttestation(specPath, repo, '04');
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.unattested, [2]);
}));

testAsync('recordCriteriaAttestationFailure: close_recovery + criteria kind', () => withTempRepo(async (repo) => {
    await bootstrapFeature(repo, '05', 'attest-recovery', ['One']);
    await recordCriteriaAttestationFailure(repo, '05', {
        unattested: [1],
        invalid: [],
        outputTail: 'missing',
        returnSpecState: 'ready',
    });
    const snap = await wf.showFeature(repo, '05');
    assert.strictEqual(snap.currentSpecState, 'close_recovery_in_progress');
    assert.strictEqual(snap.lastCloseFailure.kind, 'criteria-attestation');
    assert.ok(isCriteriaAttestationRetry(snap));
}));

testAsync('escape hatch records feature.criteria_attestation_bypassed', () => withTempRepo(async (repo) => {
    await bootstrapFeature(repo, '06', 'attest-bypass', ['One']);
    await recordCriteriaAttestationBypass(repo, '06');
    const eventsPath = wf.getEntityWorkflowPaths(repo, 'feature', '06').eventsPath;
    const events = fs.readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.ok(events.some((e) => e.type === 'feature.criteria_attestation_bypassed'));
}));

testAsync('recordCriteriaAttested projects lastCriteriaAttestation', () => withTempRepo(async (repo) => {
    await bootstrapFeature(repo, '07', 'attest-event', ['A']);
    await recordCriteriaAttested(repo, '07', {
        counts: { total: 1, met: 1, deferred: 0, dropped: 0 },
        criteria: [{ index: 1, status: 'met', evidence: 'test.js' }],
    });
    const snap = await wf.showFeature(repo, '07');
    assert.ok(snap.lastCriteriaAttestation);
    assert.strictEqual(snap.lastCriteriaAttestation.counts.met, 1);
}));

testAsync('zero acceptance criteria skips validation', () => withTempRepo(async (repo) => {
    const specPath = writeSpec(repo, '08', 'no-criteria', []);
    const result = validateCriteriaAttestation(specPath, repo, '08');
    assert.strictEqual(result.skipped, true);
    assert.strictEqual(result.ok, true);
}));

report();
