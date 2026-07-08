#!/usr/bin/env node
// F622: SSE live push — /api/events stream, status broadcast, client cleanup.
'use strict';

const assert = require('assert');
const { test, report } = require('../_helpers');
const { createDashboardSseHub, formatSseChunk } = require('../../lib/dashboard-sse');
const { createDashboardRouteDispatcher } = require('../../lib/dashboard-routes');
const { createStatusSnapshotStore } = require('../../lib/dashboard-status-version');

function buildStatus(overrides = {}) {
    return {
        generatedAt: overrides.generatedAt || '2026-07-07T00:00:00.000Z',
        summary: { waiting: 0, inProgress: 1, implementing: 1, complete: 0, error: 0, total: 1 },
        repos: [{
            path: '/tmp/repo',
            features: [{
                id: '1',
                stage: 'in-progress',
                currentSpecState: 'implementing',
                agents: [{ id: 'cu', status: 'implementing' }],
            }],
            research: [],
            feedback: [],
        }],
        ...overrides,
    };
}

function mockSseResponse() {
    let statusCode = null;
    let headers = null;
    const chunks = [];
    const closeHandlers = [];
    const res = {
        writeHead(code, hdrs) { statusCode = code; headers = hdrs; },
        write(chunk) { chunks.push(String(chunk)); return true; },
        end() {},
        on() { return res; },
    };
    return {
        res,
        req: { on(event, cb) { if (event === 'close') closeHandlers.push(cb); return { on: () => {} }; } },
        getStatusCode: () => statusCode,
        getHeaders: () => headers,
        getBody: () => chunks.join(''),
        close: () => closeHandlers.forEach(cb => cb()),
    };
}

test('F622: formatSseChunk emits event + JSON data', () => {
    assert.strictEqual(formatSseChunk('status', { statusVersion: 3 }), 'event: status\ndata: {"statusVersion":3}\n\n');
});

test('F622: handleEventsRequest sets SSE headers and initial status event', () => {
    const hub = createDashboardSseHub();
    const mock = mockSseResponse();
    hub.handleEventsRequest(mock.req, mock.res, () => 7);
    assert.strictEqual(mock.getStatusCode(), 200);
    assert.strictEqual(mock.getHeaders()['content-type'], 'text/event-stream; charset=utf-8');
    assert.strictEqual(mock.getHeaders()['cache-control'], 'no-store');
    assert.strictEqual(mock.getHeaders().connection, 'keep-alive');
    assert.strictEqual(mock.getHeaders()['x-accel-buffering'], 'no');
    const body = mock.getBody();
    assert.ok(body.includes('retry: 1000'));
    assert.ok(body.includes('event: status'));
    assert.ok(body.includes('"statusVersion":7'));
    assert.strictEqual(hub.getClientCount(), 1);
    mock.close();
    assert.strictEqual(hub.getClientCount(), 0);
});

test('F622: broadcast delivers status events to connected clients', () => {
    const hub = createDashboardSseHub();
    const mock = mockSseResponse();
    hub.handleEventsRequest(mock.req, mock.res, () => 1);
    hub.broadcast('status', { statusVersion: 2 });
    assert.ok(mock.getBody().includes('event: status\ndata: {"statusVersion":2}'));
});

test('F622: repeated open/close does not leak clients', () => {
    const hub = createDashboardSseHub();
    for (let i = 0; i < 12; i += 1) {
        const mock = mockSseResponse();
        hub.handleEventsRequest(mock.req, mock.res, () => 1);
        mock.close();
    }
    assert.strictEqual(hub.getClientCount(), 0);
});

test('F622: /api/events route delegates to handleSseEventsRequest', () => {
    let called = false;
    const ctx = {
        state: {},
        helpers: {
            handleSseEventsRequest(req, res) {
                called = true;
                res.writeHead(200, { 'content-type': 'text/event-stream' });
                res.end('event: ping\ndata: {}\n\n');
            },
        },
        routes: {},
        options: {},
    };
    const dispatcher = createDashboardRouteDispatcher(ctx);
    const mock = mockSseResponse();
    dispatcher.dispatchOssRoute('GET', '/api/events', mock.req, mock.res);
    assert.ok(called);
    assert.strictEqual(mock.getStatusCode(), 200);
});

test('F622: statusVersion bump broadcasts only after init', () => {
    const hub = createDashboardSseHub();
    const store = createStatusSnapshotStore();
    const events = [];
    const origBroadcast = hub.broadcast.bind(hub);
    hub.broadcast = (name, data) => {
        events.push({ name, data });
        origBroadcast(name, data);
    };

    function replaceLikeServer(next, source) {
        const prev = store.getStatusVersion();
        store.replaceLatestStatus(next, source);
        const nextVer = store.getStatusVersion();
        if (source !== 'init' && nextVer !== prev) {
            hub.broadcast('status', { statusVersion: nextVer });
        }
    }

    replaceLikeServer(buildStatus(), 'init');
    assert.strictEqual(events.length, 0);
    replaceLikeServer(buildStatus({ generatedAt: '2026-07-07T01:00:00.000Z' }), 'poll');
    assert.strictEqual(events.length, 0);
    const changed = buildStatus();
    changed.repos[0].features[0].stage = 'done';
    replaceLikeServer(changed, 'poll');
    assert.strictEqual(events.length, 1);
    assert.deepStrictEqual(events[0], { name: 'status', data: { statusVersion: 2 } });
});

report();
