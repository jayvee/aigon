#!/usr/bin/env node
// REGRESSION feature 304: dashboard review-check states were collapsed back to
// generic implementing/running, so the agent card lost "Addressing review" and
// "Feedback addressed" across reloads.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, testAsync, withTempDirAsync, report } = require('../_helpers');
const engine = require('../../lib/workflow-core/engine');
const reviewState = require('../../lib/feature-review-state');
const wrm = require('../../lib/workflow-read-model');
const {
    normalizeDashboardStatus,
    deriveFeatureDashboardStatus,
} = require('../../lib/dashboard-status-helpers');

test('dashboard status helpers preserve review-check states', () => {
    assert.strictEqual(normalizeDashboardStatus('feedback-addressed'), 'feedback-addressed');
    assert.strictEqual(normalizeDashboardStatus('addressing-review'), 'addressing-review');
    assert.strictEqual(
        deriveFeatureDashboardStatus('implementing', { reviewStatus: 'done', tmuxRunning: true }),
        'addressing-review'
    );
    assert.strictEqual(
        deriveFeatureDashboardStatus('feedback-addressed', { reviewStatus: 'done', tmuxRunning: true }),
        'feedback-addressed'
    );
});

testAsync('workflow read model reloads completed feature review state from disk', () => withTempDirAsync('aigon-review-status-', async (repo) => {
    const specPath = path.join(repo, 'docs', 'specs', 'features', '03-in-progress', 'feature-99-review-status.md');
    fs.mkdirSync(path.dirname(specPath), { recursive: true });
    fs.writeFileSync(specPath, '# Feature: review status\n');
    await engine.startFeature(repo, '99', 'solo_branch', ['cc']);
    reviewState.writeReviewState(repo, '99', {
        current: null,
        history: [{
            agent: 'gg',
            status: 'complete',
            startedAt: '2026-04-20T10:00:00Z',
            completedAt: '2026-04-20T10:05:00Z',
            cycle: 1,
            source: 'test',
        }],
    });

    const first = wrm.getFeatureDashboardState(repo, '99', 'in-progress', [{ id: 'cc', status: 'implementing' }]);
    const second = wrm.getFeatureDashboardState(repo, '99', 'in-progress', [{ id: 'cc', status: 'implementing' }]);

    assert.strictEqual(first.reviewStatus, 'done');
    assert.strictEqual(second.reviewStatus, 'done');
    assert.strictEqual(second.reviewSessions.length, 1);
    assert.strictEqual(second.reviewSessions[0].agent, 'gg');
}));

report();
