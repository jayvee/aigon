#!/usr/bin/env node
'use strict';

// REGRESSION: dashboard polls must honour operator-hidden repos synced from the UI.
const assert = require('assert');

const { test, report } = require('../_helpers');
const {
    readConductorReposFromGlobalConfig,
    setDashboardHiddenRepos,
    readDashboardPollRepos,
} = require('../../lib/config');

test('readDashboardPollRepos excludes dashboard-hidden repos', () => {
    const registered = readConductorReposFromGlobalConfig();
    if (registered.length < 2) {
        console.log('  (skip: need >=2 registered repos for hidden-repo filter test)');
        return;
    }
    const hidden = registered[0];
    setDashboardHiddenRepos([hidden]);
    const visible = readDashboardPollRepos();
    assert.ok(!visible.includes(hidden));
    assert.strictEqual(visible.length, registered.length - 1);
    setDashboardHiddenRepos([]);
    assert.deepStrictEqual(readDashboardPollRepos(), registered);
});

report();
