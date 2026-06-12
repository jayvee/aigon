#!/usr/bin/env node
// REGRESSION: solo_worktree code reviewers live in snapshot.codeReview, not
// snapshot.agents, so the detail drawer must derive reviewer participants.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { testAsync, withTempDirAsync, report } = require('../_helpers');
const engine = require('../../lib/workflow-core/engine');
const { buildDetailPayload } = require('../../lib/dashboard-server');

testAsync('detail payload surfaces code reviewer and revision agent as read-only participants', () => withTempDirAsync('aigon-detail-reviewer-', async repo => {
    const specPath = path.join(repo, 'docs', 'specs', 'features', '03-in-progress', 'feature-549-reviewer-surfacing.md');
    fs.mkdirSync(path.dirname(specPath), { recursive: true });
    fs.writeFileSync(specPath, '# Feature: reviewer surfacing\n');

    await engine.startFeature(repo, '549', 'solo_worktree', ['cc']);
    await engine.signalAgentReady(repo, '549', 'cc');
    await engine.recordCodeReviewStarted(repo, 'feature', '549', { reviewerId: 'cx', at: '2026-06-12T01:00:00Z' });
    await engine.recordCodeReviewCompleted(repo, 'feature', '549', { reviewerId: 'cx', requestRevision: true, at: '2026-06-12T01:10:00Z' });
    await engine.recordCodeRevisionStarted(repo, 'feature', '549', { revisionAgentId: 'cu', at: '2026-06-12T01:20:00Z' });
    await engine.recordCodeRevisionCompleted(repo, 'feature', '549', { revisionAgentId: 'cu', at: '2026-06-12T01:30:00Z' });

    const payload = buildDetailPayload(repo, 'feature', '549');
    assert.deepStrictEqual(Object.keys(JSON.parse(payload.rawManifest).agents), ['cc']);
    assert.ok(payload.agentFiles.cc, 'implementer row missing');
    assert.strictEqual(payload.agentFiles.cx.role, 'reviewer');
    assert.deepStrictEqual(payload.agentFiles.cu.roles, ['revision-agent']);
    assert.deepStrictEqual(payload.participantAgents.map(a => a.id).sort(), ['cu', 'cx']);

    const byType = Object.fromEntries(payload.events.map(event => [event.type, event]));
    assert.strictEqual(byType['feature.code_review.started'].displayActor, 'cx');
    assert.strictEqual(byType['feature.code_review.started'].displayLabel, 'Code review started');
    assert.strictEqual(byType['feature.code_review.completed'].displayActor, 'cx');
    assert.strictEqual(byType['feature.code_revision.completed'].displayActor, 'cu');
    assert.strictEqual(byType['feature.code_revision.completed'].displayLabel, 'Code revision completed');
}));

report();
