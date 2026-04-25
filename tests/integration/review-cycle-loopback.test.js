#!/usr/bin/env node
// REGRESSION (F343): multi-cycle code review round-trip via engine.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { testAsync, withTempDirAsync, report } = require('../_helpers');
const engine = require('../../lib/workflow-core/engine');
const { projectContext } = require('../../lib/workflow-core/projector');
const readSnap = (repo, id) => { try { return JSON.parse(fs.readFileSync(path.join(repo, '.aigon', 'workflows', 'features', id, 'snapshot.json'), 'utf8')); } catch (_) { return null; } };
const readEvts = (repo, id) => { try { return fs.readFileSync(path.join(repo, '.aigon', 'workflows', 'features', id, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch (_) { return []; } };
async function setupFeature(repo, id, label) { const sp = path.join(repo, 'docs', 'specs', 'features', '03-in-progress', `feature-${id}-${label}.md`); fs.mkdirSync(path.dirname(sp), { recursive: true }); fs.writeFileSync(sp, `# ${label}\n`); await engine.startFeature(repo, id, 'solo_branch', ['cc']); await engine.signalAgentReady(repo, id, 'cc'); }

testAsync('loopback: revision.completed(requestAnotherCycle,nextReviewerId=gg) → code_review_in_progress, reviewCycles[0] populated', () => withTempDirAsync('aigon-loopback-', async (repo) => {
    await setupFeature(repo, '10', 'loopback');
    await engine.recordCodeReviewStarted(repo, 'feature', '10', { reviewerId: 'cc', at: '2026-04-01T01:00:00Z' });
    await engine.recordCodeReviewCompleted(repo, 'feature', '10', { reviewerId: 'cc', requestRevision: true, at: '2026-04-01T02:00:00Z' });
    await engine.recordCodeRevisionStarted(repo, 'feature', '10', { revisionAgentId: 'cc', at: '2026-04-01T03:00:00Z' });
    await engine.recordCodeRevisionCompleted(repo, 'feature', '10', { revisionAgentId: 'cc', requestAnotherCycle: true, nextReviewerId: 'gg', at: '2026-04-01T04:00:00Z' });
    const snap = readSnap(repo, '10');
    assert.strictEqual(snap.currentSpecState, 'code_review_in_progress');
    assert.strictEqual(snap.pendingCodeReviewer, 'gg');
    assert.strictEqual(snap.reviewCycles.length, 1);
    assert.strictEqual(snap.reviewCycles[0].reviewer, 'cc');
    const ctx = projectContext(readEvts(repo, '10'));
    assert.strictEqual(ctx.currentSpecState, 'code_review_in_progress');
    assert.strictEqual(ctx.pendingCodeReviewer, 'gg');
}));

testAsync('loopback: cycle 2 no loopback → submitted, reviewCycles has cycle 1 entry', () => withTempDirAsync('aigon-loopback-c2-', async (repo) => {
    await setupFeature(repo, '11', 'c2');
    await engine.recordCodeReviewStarted(repo, 'feature', '11', { reviewerId: 'cc', at: '2026-04-01T01:00:00Z' });
    await engine.recordCodeReviewCompleted(repo, 'feature', '11', { reviewerId: 'cc', requestRevision: true, at: '2026-04-01T02:00:00Z' });
    await engine.recordCodeRevisionStarted(repo, 'feature', '11', { revisionAgentId: 'cc', at: '2026-04-01T03:00:00Z' });
    await engine.recordCodeRevisionCompleted(repo, 'feature', '11', { revisionAgentId: 'cc', requestAnotherCycle: true, nextReviewerId: 'gg', at: '2026-04-01T04:00:00Z' });
    await engine.recordCodeReviewStarted(repo, 'feature', '11', { reviewerId: 'gg', at: '2026-04-01T05:00:00Z' });
    await engine.recordCodeReviewCompleted(repo, 'feature', '11', { reviewerId: 'gg', requestRevision: true, at: '2026-04-01T06:00:00Z' });
    await engine.recordCodeRevisionStarted(repo, 'feature', '11', { revisionAgentId: 'cc', at: '2026-04-01T07:00:00Z' });
    await engine.recordCodeRevisionCompleted(repo, 'feature', '11', { revisionAgentId: 'cc', at: '2026-04-01T08:00:00Z' });
    const snap = readSnap(repo, '11');
    assert.strictEqual(snap.currentSpecState, 'submitted');
    assert.strictEqual(snap.reviewCycles.length, 1);
    assert.strictEqual(snap.reviewCycles[0].reviewer, 'cc');
}));

report();
