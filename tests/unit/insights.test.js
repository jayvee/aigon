#!/usr/bin/env node
'use strict';

/**
 * Unit tests for AADE analytics integration (lib/insights.js + lib/utils.js)
 * Run: node lib/insights.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(description, fn) {
    try {
        fn();
        console.log(`  \u2713 ${description}`);
        passed++;
    } catch (err) {
        console.error(`  \u2717 ${description}`);
        console.error(`    ${err.message}`);
        failed++;
    }
}

// ---------------------------------------------------------------------------
// Set up a temp repo with done features and log files with AADE frontmatter
// ---------------------------------------------------------------------------

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-insights-test-'));

function setupTestRepo() {
    const repoPath = path.join(tmpRoot, 'test-repo');
    const doneDir = path.join(repoPath, 'docs', 'specs', 'features', '05-done');
    const logsDir = path.join(repoPath, 'docs', 'specs', 'features', 'logs');
    fs.mkdirSync(doneDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });

    // Feature 1 — full AADE data
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

    // Feature 2 — with rework flags
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

    // Feature 3 — no AADE data (legacy feature)
    fs.writeFileSync(path.join(doneDir, 'feature-44-legacy-thing.md'), '# Feature: Legacy Thing\n');
    fs.writeFileSync(path.join(logsDir, 'feature-44-cc-legacy-thing-log.md'), `---
completedAt: 2026-03-10T08:00:00+11:00
---

Old feature, no AADE telemetry.
`);

    // Feature 4 — partial AADE data (only cost)
    fs.writeFileSync(path.join(doneDir, 'feature-45-partial-data.md'), '# Feature: Partial Data\n');
    fs.writeFileSync(path.join(logsDir, 'feature-45-cc-partial-data-log.md'), `---
cost_usd: 0.10
completedAt: 2026-03-17T09:00:00+11:00
---

Only cost data available.
`);

    return repoPath;
}

// ---------------------------------------------------------------------------
// Tests for collectAadeFeatures (lib/insights.js)
// ---------------------------------------------------------------------------

const insights = require('../../lib/insights');

console.log('\n  collectAadeFeatures');

const repoPath = setupTestRepo();

test('returns all features from done directory', () => {
    const features = insights.collectAadeFeatures(repoPath);
    assert.strictEqual(features.length, 4);
});

test('reads cost_usd from frontmatter', () => {
    const features = insights.collectAadeFeatures(repoPath);
    const f42 = features.find(f => f.featureId === '42');
    assert.strictEqual(f42.costUsd, 0.25);
});

test('reads autonomy_label from frontmatter', () => {
    const features = insights.collectAadeFeatures(repoPath);
    const f42 = features.find(f => f.featureId === '42');
    assert.strictEqual(f42.autonomyLabel, 'Full Autonomy');
});

test('reads rework flags correctly', () => {
    const features = insights.collectAadeFeatures(repoPath);
    const f43 = features.find(f => f.featureId === '43');
    assert.strictEqual(f43.reworkThrashing, true);
    assert.strictEqual(f43.reworkFixCascade, false);
    assert.strictEqual(f43.reworkScopeCreep, true);
    assert.strictEqual(f43.hasRework, true);
});

test('feature without AADE data has null fields', () => {
    const features = insights.collectAadeFeatures(repoPath);
    const f44 = features.find(f => f.featureId === '44');
    assert.strictEqual(f44.costUsd, null);
    assert.strictEqual(f44.autonomyLabel, null);
    assert.strictEqual(f44.hasRework, false);
});

test('reads tokens_per_line_changed and total_tokens', () => {
    const features = insights.collectAadeFeatures(repoPath);
    const f42 = features.find(f => f.featureId === '42');
    assert.strictEqual(f42.tokensPerLineChanged, 3.5);
    assert.strictEqual(f42.totalTokens, 1500);
    assert.strictEqual(f42.linesChanged, 428);
});

test('features are sorted by completedAtMs', () => {
    const features = insights.collectAadeFeatures(repoPath);
    for (let i = 1; i < features.length; i++) {
        assert.ok(features[i].completedAtMs >= features[i - 1].completedAtMs,
            `Feature ${features[i].featureId} should be after ${features[i - 1].featureId}`);
    }
});

// ---------------------------------------------------------------------------
// Tests for buildDeterministicInsights
// ---------------------------------------------------------------------------

console.log('\n  buildDeterministicInsights');

test('returns insufficientData for fewer than 3 features', () => {
    const result = insights.buildDeterministicInsights([{ featureId: '1' }, { featureId: '2' }]);
    assert.strictEqual(result.insufficientData, true);
});

test('returns 5 observations for sufficient data', () => {
    const features = insights.collectAadeFeatures(repoPath);
    const result = insights.buildDeterministicInsights(features);
    assert.strictEqual(result.insufficientData, false);
    assert.strictEqual(result.observations.length, 5);
});

test('computes rework rate in aggregates', () => {
    const features = insights.collectAadeFeatures(repoPath);
    const result = insights.buildDeterministicInsights(features);
    assert.ok(result.aggregates.reworkRate !== undefined);
});

test('computes autonomy counts in aggregates', () => {
    const features = insights.collectAadeFeatures(repoPath);
    const result = insights.buildDeterministicInsights(features);
    assert.ok(result.aggregates.autonomyCounts !== undefined);
    assert.strictEqual(result.aggregates.autonomyCounts.fullAutonomy, 1);
    assert.strictEqual(result.aggregates.autonomyCounts.thrashing, 1);
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
} catch (_) { /* ignore */ }

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
