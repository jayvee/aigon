#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { test, report } = require('../_helpers');
const { collectDashboardHealth } = require('../../lib/dashboard-status-collector');

// REGRESSION: feature 307 requires startup health to use the same collector path
// that backs the dashboard payload.
test('collectDashboardHealth reports a successful collector probe', () => {
    const health = collectDashboardHealth();
    assert.strictEqual(health.ok, true);
    assert.ok(typeof health.repoCount === 'number');
    assert.ok(health.startedAt);
    assert.ok(health.completedAt);
});

report();
