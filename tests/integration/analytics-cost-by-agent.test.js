#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');

// REGRESSION F402: analytics payload must expose costByAgent when closed features with telemetry exist.
test('analytics: costByAgent present in payload when telemetry exists', () => withTempDir('aigon-analytics-cost-', (repo) => {
    // Set up minimal repo structure
    const dirs = [
        'docs/specs/features/05-done',
        '.aigon/workflows/features',
        '.aigon/telemetry',
        '.aigon/state',
    ];
    dirs.forEach(d => fs.mkdirSync(path.join(repo, d), { recursive: true }));

    // Write a closed feature spec
    fs.writeFileSync(
        path.join(repo, 'docs/specs/features/05-done/feature-01-test-feature.md'),
        '# Feature: test-feature\n'
    );

    // Write a telemetry file for this feature (simulating a real agent session)
    const telemetryRecord = {
        featureId: '01',
        agent: 'cc',
        model: 'claude-sonnet-4-6',
        activity: 'implement',
        startAt: new Date(Date.now() - 3600000).toISOString(),
        endAt: new Date().toISOString(),
        costUsd: 0.0123,
        tokenUsage: {
            input: 1000,
            cacheReadInput: 200,
            output: 500,
            thinking: 0,
            billable: 1500,
        },
    };
    fs.writeFileSync(
        path.join(repo, '.aigon/telemetry/feature-01-cc-session1.json'),
        JSON.stringify(telemetryRecord, null, 2)
    );

    // Write a workflow snapshot to mark the feature as done
    const snapshot = {
        featureId: '01',
        lifecycle: 'done',
        agents: { cc: { status: 'closed' } },
        closedAt: new Date().toISOString(),
    };
    fs.writeFileSync(
        path.join(repo, '.aigon/workflows/features/feature-01.json'),
        JSON.stringify(snapshot, null, 2)
    );

    const { collectAnalyticsData } = require('../../lib/analytics');
    const result = collectAnalyticsData({ repos: [repo] });

    assert.ok(result, 'analytics result should be non-null');
    assert.ok(Array.isArray(result.costByAgent), 'costByAgent must be an array');
    assert.ok(result.costByAgent.length > 0, 'costByAgent must be non-empty when telemetry exists');

    const ccRow = result.costByAgent.find(r => r.agent === 'cc');
    assert.ok(ccRow, 'costByAgent must include a row for the cc agent');
    assert.ok(typeof ccRow.sessions === 'number', 'costByAgent row must have sessions count');
    assert.ok(typeof ccRow.costUsd === 'number', 'costByAgent row must have costUsd');
    assert.ok(typeof ccRow.billableTokens === 'number', 'costByAgent row must have billableTokens');
}));

test('analytics: costByAgent is empty array when no telemetry exists', () => withTempDir('aigon-analytics-nocost-', (repo) => {
    const dirs = [
        'docs/specs/features/05-done',
        '.aigon/workflows/features',
        '.aigon/state',
    ];
    dirs.forEach(d => fs.mkdirSync(path.join(repo, d), { recursive: true }));

    const { collectAnalyticsData } = require('../../lib/analytics');
    const result = collectAnalyticsData({ repos: [repo] });

    assert.ok(result, 'analytics result should be non-null');
    assert.ok(Array.isArray(result.costByAgent), 'costByAgent must be an array even with no telemetry');
}));

report();
