#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');
const insights = require('../../lib/insights');

function seedAadeRepo(repo) {
    const doneDir = path.join(repo, 'docs', 'specs', 'features', '05-done');
    const logsDir = path.join(repo, 'docs', 'specs', 'features', 'logs');
    fs.mkdirSync(doneDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });

    fs.writeFileSync(path.join(doneDir, 'feature-42-auth-flow.md'), '# Feature: Auth Flow\n');
    fs.writeFileSync(path.join(logsDir, 'feature-42-cc-auth-flow-log.md'), `---
cost_usd: 0.25
tokens_per_line_changed: 3.5
total_tokens: 1500
lines_changed: 428
autonomy_label: "Full Autonomy"
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
completedAt: 2026-03-15T10:00:00+11:00
---

## Implementation Log
Implemented auth flow.
`);

    fs.writeFileSync(path.join(doneDir, 'feature-43-dashboard-fix.md'), '# Feature: Dashboard Fix\n');
    fs.writeFileSync(path.join(logsDir, 'feature-43-cc-dashboard-fix-log.md'), `---
cost_usd: 0.80
tokens_per_line_changed: 12.1
total_tokens: 5000
lines_changed: 413
autonomy_label: "Thrashing"
rework_thrashing: true
rework_fix_cascade: false
rework_scope_creep: true
completedAt: 2026-03-16T14:00:00+11:00
---

## Implementation Log
Had issues.
`);

    fs.writeFileSync(path.join(doneDir, 'feature-44-legacy-thing.md'), '# Feature: Legacy Thing\n');
    fs.writeFileSync(path.join(logsDir, 'feature-44-cc-legacy-thing-log.md'), `---
completedAt: 2026-03-10T08:00:00+11:00
---

Old feature, no AADE telemetry.
`);

    fs.writeFileSync(path.join(doneDir, 'feature-45-partial-data.md'), '# Feature: Partial Data\n');
    fs.writeFileSync(path.join(logsDir, 'feature-45-cc-partial-data-log.md'), `---
cost_usd: 0.10
completedAt: 2026-03-17T09:00:00+11:00
---

Only cost data available.
`);
}

function withAadeRepo(fn) {
    return withTempDir('aigon-insights-', (repo) => {
        seedAadeRepo(repo);
        return fn(repo);
    });
}

// REGRESSION: collectAadeFeatures must enumerate every done spec.
test('returns all features from done directory', () => withAadeRepo((repo) => {
    assert.strictEqual(insights.collectAadeFeatures(repo).length, 4);
}));

// REGRESSION: AADE frontmatter cost and autonomy labels must surface on feature rows.
test('reads cost and autonomy fields from frontmatter', () => withAadeRepo((repo) => {
    const features = insights.collectAadeFeatures(repo);
    const f42 = features.find(f => f.featureId === '42');
    assert.strictEqual(f42.costUsd, 0.25);
    assert.strictEqual(f42.autonomyLabel, 'Full Autonomy');
}));

// REGRESSION: rework flags must combine into hasRework for dashboard aggregates.
test('reads rework flags correctly', () => withAadeRepo((repo) => {
    const f43 = insights.collectAadeFeatures(repo).find(f => f.featureId === '43');
    assert.strictEqual(f43.reworkThrashing, true);
    assert.strictEqual(f43.reworkFixCascade, false);
    assert.strictEqual(f43.reworkScopeCreep, true);
    assert.strictEqual(f43.hasRework, true);
}));

// REGRESSION: legacy logs without AADE telemetry must not fabricate cost/autonomy fields.
test('feature without AADE data has null fields', () => withAadeRepo((repo) => {
    const f44 = insights.collectAadeFeatures(repo).find(f => f.featureId === '44');
    assert.strictEqual(f44.costUsd, null);
    assert.strictEqual(f44.autonomyLabel, null);
    assert.strictEqual(f44.hasRework, false);
}));

// REGRESSION: token and line-change metrics must parse from implementation logs.
test('reads tokens_per_line_changed and total_tokens', () => withAadeRepo((repo) => {
    const f42 = insights.collectAadeFeatures(repo).find(f => f.featureId === '42');
    assert.strictEqual(f42.tokensPerLineChanged, 3.5);
    assert.strictEqual(f42.totalTokens, 1500);
    assert.strictEqual(f42.linesChanged, 428);
}));

// REGRESSION: dashboard ordering must follow completedAtMs ascending.
test('features are sorted by completedAtMs', () => withAadeRepo((repo) => {
    const features = insights.collectAadeFeatures(repo);
    for (let i = 1; i < features.length; i++) {
        assert.ok(features[i].completedAtMs >= features[i - 1].completedAtMs,
            `Feature ${features[i].featureId} should be after ${features[i - 1].featureId}`);
    }
}));

// REGRESSION: deterministic insights must refuse to invent signal on tiny samples.
test('returns insufficientData for fewer than 3 features', () => {
    const result = insights.buildDeterministicInsights([{ featureId: '1' }, { featureId: '2' }]);
    assert.strictEqual(result.insufficientData, true);
});

// REGRESSION: sufficient sample size must yield five observations.
test('returns 5 observations for sufficient data', () => withAadeRepo((repo) => {
    const result = insights.buildDeterministicInsights(insights.collectAadeFeatures(repo));
    assert.strictEqual(result.insufficientData, false);
    assert.strictEqual(result.observations.length, 5);
}));

// REGRESSION: autonomy buckets must count full-autonomy vs thrashing labels.
test('computes autonomy counts in aggregates', () => withAadeRepo((repo) => {
    const result = insights.buildDeterministicInsights(insights.collectAadeFeatures(repo));
    assert.strictEqual(result.aggregates.autonomyCounts.fullAutonomy, 1);
    assert.strictEqual(result.aggregates.autonomyCounts.thrashing, 1);
}));

report();
