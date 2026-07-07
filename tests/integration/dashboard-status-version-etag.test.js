#!/usr/bin/env node
// F620: /api/status ETag + If-None-Match conditional GET.
'use strict';

const assert = require('assert');
const { test, report } = require('../_helpers');
const { createDashboardRouteDispatcher } = require('../../lib/dashboard-routes');
const {
    computeStatusFingerprint,
    createStatusSnapshotStore,
    ifNoneMatchSatisfied,
} = require('../../lib/dashboard-status-version');

function buildStatus(overrides = {}) {
    return {
        generatedAt: overrides.generatedAt || '2026-07-07T00:00:00.000Z',
        summary: { waiting: 0, inProgress: 1, inEval: 0, implementing: 1, complete: 0, error: 0, total: 1 },
        repos: [{
            path: '/tmp/repo',
            features: [{
                id: '1',
                stage: 'in-progress',
                currentSpecState: 'implementing',
                agents: [{ id: 'cu', status: 'implementing', idleLadder: { state: 'active' } }],
            }],
            research: [],
            feedback: [],
        }],
        updateCheck: null,
        ...overrides,
    };
}

function buildReqRes(reqHeaders = {}) {
    const req = { headers: reqHeaders };
    let statusCode = null;
    let headers = null;
    let body = null;
    const res = {
        writeHead(code, hdrs) { statusCode = code; headers = hdrs; },
        end(payload) { body = payload; },
    };
    return {
        req,
        res,
        getStatusCode: () => statusCode,
        getHeaders: () => headers,
        getBody: () => body,
        getJson: () => (body ? JSON.parse(body) : null),
    };
}

function buildStatusCtx(store) {
    return {
        state: {
            getLatestStatus: () => store.getLatestStatus(),
            setLatestStatus: next => store.replaceLatestStatus(next, 'test'),
            getStatusVersion: () => store.getStatusVersion(),
            getSerializedStatusBody: () => store.getSerializedBody(),
            getGlobalConfig: () => ({}),
            setGlobalConfig: () => {},
            getNotificationUnreadCount: () => 0,
            setNotificationUnreadCount: () => {},
        },
        helpers: { log: () => {} },
        routes: {},
        options: {},
    };
}

test('F620: computeStatusFingerprint ignores generatedAt', () => {
    const a = buildStatus({ generatedAt: '2026-07-07T00:00:00.000Z' });
    const b = buildStatus({ generatedAt: '2026-07-07T01:00:00.000Z' });
    assert.strictEqual(computeStatusFingerprint(a), computeStatusFingerprint(b));
});

test('F620: replaceLatestStatus bumps version only when fingerprint changes', () => {
    const store = createStatusSnapshotStore();
    store.replaceLatestStatus(buildStatus(), 'a');
    assert.strictEqual(store.getStatusVersion(), 1);
    store.replaceLatestStatus(buildStatus({ generatedAt: '2026-07-07T02:00:00.000Z' }), 'b');
    assert.strictEqual(store.getStatusVersion(), 1);
    const changed = buildStatus();
    changed.repos[0].features[0].stage = 'done';
    store.replaceLatestStatus(changed, 'c');
    assert.strictEqual(store.getStatusVersion(), 2);
});

test('F620: ifNoneMatchSatisfied handles quoted, weak, and list validators', () => {
    assert.strictEqual(ifNoneMatchSatisfied('"3"', 3), true);
    assert.strictEqual(ifNoneMatchSatisfied('W/"3"', 3), true);
    assert.strictEqual(ifNoneMatchSatisfied('"1", "3"', 3), true);
    assert.strictEqual(ifNoneMatchSatisfied('"2"', 3), false);
});

test('F620: /api/status returns 304 when If-None-Match matches', () => {
    const store = createStatusSnapshotStore();
    store.replaceLatestStatus(buildStatus(), 'init');
    const ctx = buildStatusCtx(store);
    const dispatcher = createDashboardRouteDispatcher(ctx);

    const first = buildReqRes();
    dispatcher.dispatchOssRoute('GET', '/api/status', first.req, first.res);
    assert.strictEqual(first.getStatusCode(), 200);
    assert.strictEqual(first.getHeaders().etag, '"1"');
    assert.strictEqual(first.getJson().statusVersion, 1);

    const second = buildReqRes({ 'if-none-match': '"1"' });
    dispatcher.dispatchOssRoute('GET', '/api/status', second.req, second.res);
    assert.strictEqual(second.getStatusCode(), 304);
    assert.ok(second.getBody() == null || second.getBody() === '');
    assert.strictEqual(second.getHeaders().etag, '"1"');
});

test('F620: structural change bumps version and returns full body', () => {
    const store = createStatusSnapshotStore();
    store.replaceLatestStatus(buildStatus(), 'init');
    const ctx = buildStatusCtx(store);
    const dispatcher = createDashboardRouteDispatcher(ctx);

    const changed = buildStatus();
    changed.repos[0].features[0].stage = 'done';
    store.replaceLatestStatus(changed, 'refresh');

    const res = buildReqRes({ 'if-none-match': '"1"' });
    dispatcher.dispatchOssRoute('GET', '/api/status', res.req, res.res);
    assert.strictEqual(res.getStatusCode(), 200);
    assert.strictEqual(res.getHeaders().etag, '"2"');
    assert.strictEqual(res.getJson().statusVersion, 2);
    assert.strictEqual(res.getJson().repos[0].features[0].stage, 'done');
});

report();
