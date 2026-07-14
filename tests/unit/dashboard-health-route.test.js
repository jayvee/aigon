#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { test, report } = require('../_helpers');
const { createDashboardRouteDispatcher } = require('../../lib/dashboard-routes');

function requestHealth(latestStatus) {
    let statusCode;
    let body;
    const collect = () => { throw new Error('/api/health must use cached status'); };
    const ctx = {
        state: {
            getLatestStatus: () => latestStatus,
            setLatestStatus: collect,
            getGlobalConfig: () => ({}),
            setGlobalConfig: () => {},
            getNotificationUnreadCount: () => 0,
            setNotificationUnreadCount: () => {},
        },
        helpers: {},
        routes: { collectDashboardStatusData: collect, collectDashboardStatusDataAsync: collect },
        options: {},
    };
    const matched = createDashboardRouteDispatcher(ctx).dispatchOssRoute('GET', '/api/health', {}, {
        writeHead(code) { statusCode = code; },
        end(payload) { body = JSON.parse(payload); },
    });
    return { matched, statusCode, body };
}

test('/api/health is a cached, cheap liveness probe', () => {
    for (const [latestStatus, warming, repoCount] of [
        [{ repos: [{}, {}, {}] }, false, 3],
        [null, true, 0],
    ]) {
        const result = requestHealth(latestStatus);
        assert.strictEqual(result.matched, true);
        assert.strictEqual(result.statusCode, 200);
        assert.strictEqual(result.body.ok, true);
        assert.strictEqual(result.body.warming, warming);
        assert.strictEqual(result.body.repoCount, repoCount);
        assert.ok(result.body.completedAt);
    }
});

report();
