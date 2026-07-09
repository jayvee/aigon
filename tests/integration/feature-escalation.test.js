#!/usr/bin/env node
'use strict';

// REGRESSION F630: ESCALATE markers in implementation logs must become engine
// events, block feature-close, and unblock after operator disposition.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { testAsync, withTempDirAsync, report } = require('../_helpers');
const engine = require('../../lib/workflow-core/engine');
const wf = require('../../lib/workflow-core');
const {
    parseEscalationMarkers,
    stableEscalationId,
} = require('../../lib/review-escalation');
const {
    syncReviewEscalationsFromLog,
    runEscalationCommand,
    runEscalationCloseGuard,
} = require('../../lib/feature-escalation');
const { buildCloseReadiness } = require('../../lib/close-readiness');

const REPO_DIRS = [
    'docs/specs/features/03-in-progress',
    'docs/specs/features/logs',
    'docs/specs/features/01-inbox',
    '.aigon/workflows/features',
];

function withTempRepo(fn) {
    return withTempDirAsync('aigon-esc-', async (dir) => {
        for (const sub of REPO_DIRS) fs.mkdirSync(path.join(dir, sub), { recursive: true });
        return fn(dir);
    });
}

function writeFeature(repo, id, name) {
    const specPath = path.join(repo, 'docs/specs/features/03-in-progress', `feature-${id}-${name}.md`);
    fs.writeFileSync(specPath, `# Feature: ${name}\n`);
    return specPath;
}

function writeLog(repo, id, body) {
    const logsDir = path.join(repo, 'docs/specs/features/logs');
    const file = `feature-${id}-cu-sample-log.md`;
    const full = path.join(logsDir, file);
    fs.writeFileSync(full, body);
    return {
        file,
        rel: `docs/specs/features/logs/${file}`,
        full,
    };
}

async function bootstrapReady(repo, id, name) {
    writeFeature(repo, id, name);
    await engine.startFeature(repo, id, 'solo_branch', ['cc']);
    await engine.signalAgentReady(repo, id, 'cc');
    await engine.recordCodeReviewStarted(repo, 'feature', id, { reviewerId: 'cx', source: 'test' });
    await engine.recordCodeReviewCompleted(repo, 'feature', id, {
        reviewerId: 'cx',
        requestRevision: false,
        source: 'test/review-complete',
    });
}

const F630_BODY = `---
agent: cu
---

# Implementation Log

## Code Review

**Reviewed by**: cx

### Escalated Issues (exceptions only)
- ESCALATE:architectural — Phase B is still materially short of the spec
`;

testAsync('parseEscalationMarkers: F630 log shape + bold/bullet variants', async () => {
    const markers = parseEscalationMarkers(F630_BODY);
    assert.strictEqual(markers.length, 1);
    assert.strictEqual(markers[0].category, 'architectural');
    assert.ok(markers[0].reason.includes('Phase B'));
    const bold = parseEscalationMarkers('## Code Review\n- **ESCALATE:security** — secret handling');
    assert.strictEqual(bold[0].category, 'security');
});

testAsync('review-complete raises escalation events and is advisory by default', () => withTempRepo(async (repo) => {
    const id = '01';
    writeFeature(repo, id, 'escalation-guard');
    const log = writeLog(repo, id, F630_BODY);
    await engine.startFeature(repo, id, 'solo_branch', ['cc']);
    await engine.signalAgentReady(repo, id, 'cc');
    await engine.recordCodeReviewStarted(repo, 'feature', id, { reviewerId: 'cx' });
    await engine.recordCodeReviewCompleted(repo, 'feature', id, {
        reviewerId: 'cx',
        requestRevision: false,
        source: 'test',
    });
    const snap = await wf.showFeature(repo, id);
    assert.strictEqual(snap.openEscalations.length, 1);
    assert.strictEqual(snap.openEscalations[0].category, 'architectural');
    const expectedId = stableEscalationId(log.rel, snap.openEscalations[0].lineNumber, 'architectural');
    assert.strictEqual(snap.openEscalations[0].escalationId, expectedId);

    const advisory = await runEscalationCloseGuard(repo, id);
    assert.strictEqual(advisory.ok, true);
    assert.strictEqual(advisory.advisory, true);

    const blocked = await runEscalationCloseGuard(repo, id, {
        config: { featureClose: { blockingGates: ['review-escalation'] } },
    });
    assert.strictEqual(blocked.ok, false);

    const resync = await syncReviewEscalationsFromLog(repo, id, { reviewerAgentId: 'cx' });
    assert.strictEqual(resync.raised, 0);
    assert.ok(resync.skipped >= 1);
}));

testAsync('disposition accept unblocks close', () => withTempRepo(async (repo) => {
    await bootstrapReady(repo, '02', 'esc-accept');
    writeLog(repo, '02', F630_BODY);
    await syncReviewEscalationsFromLog(repo, '02', { reviewerAgentId: 'cx' });
    let snap = await wf.showFeature(repo, '02');
    assert.strictEqual(snap.openEscalations.length, 1);

    await runEscalationCommand(['accept', '02', '1', '--reason', 'accepted risk'], { repoPath: repo });
    snap = await wf.showFeature(repo, '02');
    assert.strictEqual(snap.openEscalations.length, 0);
    const ok = await runEscalationCloseGuard(repo, '02');
    assert.strictEqual(ok.ok, true);
}));

testAsync('disposition reopen starts code revision', () => withTempRepo(async (repo) => {
    await bootstrapReady(repo, '03', 'esc-reopen');
    writeLog(repo, '03', F630_BODY);
    await syncReviewEscalationsFromLog(repo, '03', { reviewerAgentId: 'cx' });

    await runEscalationCommand(['reopen', '03', '1', '--reason', 'needs more work'], { repoPath: repo });
    const snap = await wf.showFeature(repo, '03');
    assert.strictEqual(snap.openEscalations.length, 0);
    assert.strictEqual(snap.currentSpecState, 'code_revision_in_progress');
}));

testAsync('REGRESSION F656: approved review with open escalation is close-ready under advisory policy', () => withTempRepo(async (repo) => {
    const id = '04';
    await bootstrapReady(repo, id, 'f656-advisory-close');
    writeLog(repo, id, F630_BODY);
    await syncReviewEscalationsFromLog(repo, id, { reviewerAgentId: 'cx' });
    const snap = await wf.showFeature(repo, id);
    assert.strictEqual(snap.openEscalations.length, 1);

    const guard = await runEscalationCloseGuard(repo, id);
    assert.strictEqual(guard.ok, true);
    assert.strictEqual(guard.advisory, true);

    const readiness = buildCloseReadiness(
        { id, stage: 'in-progress', agents: [{ id: 'cc', status: 'ready' }] },
        snap,
        { stage: 'in-progress', featureId: id },
    );
    assert.strictEqual(readiness.ready, true);
    assert.strictEqual(readiness.primaryBlocker, null);
}));

report();
