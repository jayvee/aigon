#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { test, report } = require('../_helpers');
const { createDashboardRouteDispatcher } = require('../../lib/dashboard-routes');

// REGRESSION: /api/health must be a cheap liveness probe that reads the
// already-cached status snapshot. It MUST NOT call collectDashboardStatusData()
// or collectDashboardStatusDataAsync()
// — at scale that path takes 2–3s, blows the `aigon server status` 3s probe
// timeout, and surfaces as a false "Health: unavailable" / "server crashed".
//
// Earlier shape (recomputing inside the handler) caused that exact incident on
// 2026-04-25 with 8 repos / 575 features / 37 research items.

function buildStubReqRes() {
    const req = {};
    let statusCode = null;
    let body = null;
    const res = {
        writeHead(code) { statusCode = code; },
        end(payload) { body = payload; }
    };
    return { req, res, getStatusCode: () => statusCode, getBody: () => (body ? JSON.parse(body) : null) };
}

function buildStubServerCtx(latestStatus, { onCollect } = {}) {
    return {
        state: {
            getLatestStatus: () => latestStatus,
            setLatestStatus: () => { throw new Error('setLatestStatus must not be called from /api/health'); },
            getGlobalConfig: () => ({}),
            setGlobalConfig: () => {},
            getNotificationUnreadCount: () => 0,
            setNotificationUnreadCount: () => {},
        },
        helpers: {},
        routes: {
            collectDashboardStatusData: () => {
                if (onCollect) onCollect();
                throw new Error('collectDashboardStatusData must not be called from /api/health (use the cached snapshot)');
            },
            // F471/R8: ctx.routes exposes both; health must use cache only.
            collectDashboardStatusDataAsync: async () => {
                if (onCollect) onCollect();
                throw new Error('collectDashboardStatusDataAsync must not be called from /api/health (use the cached snapshot)');
            },
        },
        options: {},
    };
}

test('/api/health returns 200 with cached repoCount and warming=false', () => {
    const cached = { repos: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] };
    const ctx = buildStubServerCtx(cached);
    const dispatcher = createDashboardRouteDispatcher(ctx);
    const { req, res, getStatusCode, getBody } = buildStubReqRes();

    const matched = dispatcher.dispatchOssRoute('GET', '/api/health', req, res);

    assert.strictEqual(matched, true, '/api/health route should match');
    assert.strictEqual(getStatusCode(), 200);
    const body = getBody();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.warming, false);
    assert.strictEqual(body.repoCount, 3);
    assert.ok(typeof body.completedAt === 'string' && body.completedAt.length > 0);
});

test('/api/health returns warming=true before first poll populates cache', () => {
    // Cache empty (server just started, poll loop hasn't run yet).
    const ctx = buildStubServerCtx(null);
    const dispatcher = createDashboardRouteDispatcher(ctx);
    const { req, res, getStatusCode, getBody } = buildStubReqRes();

    dispatcher.dispatchOssRoute('GET', '/api/health', req, res);

    assert.strictEqual(getStatusCode(), 200, 'must still report 200 — process is alive');
    const body = getBody();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.warming, true);
    assert.strictEqual(body.repoCount, 0);
});

test('/api/health does not invoke the heavy status collector', () => {
    let collectCalls = 0;
    const cached = { repos: [] };
    const ctx = buildStubServerCtx(cached, { onCollect: () => { collectCalls++; } });
    const dispatcher = createDashboardRouteDispatcher(ctx);
    const { req, res } = buildStubReqRes();

    dispatcher.dispatchOssRoute('GET', '/api/health', req, res);

    assert.strictEqual(collectCalls, 0, 'no status collector may run from /api/health');
});

report();
