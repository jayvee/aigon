#!/usr/bin/env node
// F620: /api/status ETag + If-None-Match conditional GET.
'use strict';

const assert = require('assert');
const { test, testAsync, report } = require('../_helpers');
const { createDashboardRouteDispatcher } = require('../../lib/dashboard-routes');
const {
    computeStatusFingerprint,
    createStatusSnapshotStore,
    ifNoneMatchSatisfied,
} = require('../../lib/dashboard-status-version');
const { buildResearchUiContract } = require('../../lib/research-ui-contract');
const { buildFeatureSetUiContract } = require('../../lib/feature-set-ui-contract');
const { buildFeatureUiContract } = require('../../lib/feature-ui-contract');

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

test('F620: computeStatusFingerprint includes rendered update-check details', () => {
    const a = buildStatus({ updateCheck: { state: 'update-available', latestStable: '1.2.3', upgradeCommand: 'aigon update' } });
    const b = buildStatus({ updateCheck: { state: 'update-available', latestStable: '1.2.4', upgradeCommand: 'aigon update' } });
    assert.notStrictEqual(computeStatusFingerprint(a), computeStatusFingerprint(b));
});

// REGRESSION F671: completing spec revision must invalidate cached /api/status.
test('F671: computeStatusFingerprint bumps when spec revision sessions change', () => {
    const base = buildStatus();
    base.repos[0].features[0].stage = 'backlog';
    base.repos[0].features[0].currentSpecState = 'backlog';
    base.repos[0].features[0].agents = [];
    const revising = JSON.parse(JSON.stringify(base));
    revising.repos[0].features[0].specRevisionSessions = [{ agent: 'cu', running: true, status: 'addressing-spec-review' }];
    const done = JSON.parse(JSON.stringify(base));
    done.repos[0].features[0].specRevisionSessions = [];
    assert.notStrictEqual(computeStatusFingerprint(base), computeStatusFingerprint(revising));
    assert.notStrictEqual(computeStatusFingerprint(revising), computeStatusFingerprint(done));
});

// F678: research and set contracts must repaint cards like feature contracts do.
// Each case mutates one contract fact and asserts the fingerprint moves — a
// field left out of the fingerprint would silently stop pushing updates.
function setStatus(overrides = {}) {
    const status = buildStatus();
    const card = {
        slug: 'dashboard-ui-rollout',
        goal: 'Ship the dashboard',
        status: 'running',
        validActions: [],
        progress: { merged: 1, total: 3, percent: 33 },
        depGraph: { nodes: [{ featureId: '677', label: 'a', state: 'done' }], edges: [] },
        specCycle: {
            review: { status: 'complete', pendingCount: 0, memberCount: 3, commitSha: 'abc123' },
            revision: { status: 'inactive', pendingCount: 0, memberCount: 0, commitSha: null },
        },
        ...overrides,
    };
    status.repos[0].sets = [{ slug: card.slug, uiContract: buildFeatureSetUiContract(card) }];
    return computeStatusFingerprint(status);
}

function researchStatus(validActions) {
    const status = buildStatus();
    status.repos[0].research = [{
        id: '204', stage: 'in-progress', currentSpecState: 'implementing', agents: [],
        uiContract: buildResearchUiContract({
            id: '204', displayKey: 'R204', name: 'Retrieval', stage: 'in-progress',
            agents: [], validActions, cardPresentation: { severity: 'normal' },
        }, { currentSpecState: 'implementing', lifecycle: 'implementing' }),
    }];
    return computeStatusFingerprint(status);
}

function memberContract(lifecycle) {
    return {
        currentFeature: { id: '678', label: 'member', stage: 'in-progress' },
        currentFeatureContract: buildFeatureUiContract({
            id: '678', displayKey: 'F678', name: 'member', stage: 'in-progress', agents: [],
            validActions: [], cardPresentation: { severity: 'normal' },
        }, { currentSpecState: lifecycle, lifecycle }),
    };
}

test('F678: research contract action changes bump the fingerprint', () => {
    assert.notStrictEqual(researchStatus([]), researchStatus([{ action: 'research-close', label: 'Close' }]));
});

test('F678: set spec-cycle, member progress, and nested member contract each bump the fingerprint', () => {
    // Spec-cycle status moves without any session change — proving the contract
    // carries it independently of tmux liveness.
    assert.notStrictEqual(setStatus(), setStatus({
        specCycle: {
            review: { status: 'feedback-waiting', pendingCount: 2, memberCount: 3, commitSha: 'abc123' },
            revision: { status: 'needed', pendingCount: 2, memberCount: 0, commitSha: null },
        },
    }));
    assert.notStrictEqual(setStatus(), setStatus({
        depGraph: { nodes: [{ featureId: '677', label: 'a', state: 'in-progress' }], edges: [] },
    }));
    assert.notStrictEqual(
        setStatus(memberContract('implementing')),
        setStatus(memberContract('code_review_in_progress')),
    );
});

test('F678: fingerprint is stable when nothing repaint-relevant changed', () => {
    assert.strictEqual(setStatus(), setStatus());
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

testAsync('F620: /api/refresh returns 304 when refreshed status is unchanged', async () => {
    const store = createStatusSnapshotStore();
    store.replaceLatestStatus(buildStatus(), 'init');
    const ctx = buildStatusCtx(store);
    ctx.helpers.pollStatus = async () => {
        store.replaceLatestStatus(buildStatus({ generatedAt: '2026-07-07T02:00:00.000Z' }), 'refresh');
    };
    const dispatcher = createDashboardRouteDispatcher(ctx);

    const res = buildReqRes({ 'if-none-match': '"1"' });
    res.req.on = (event, cb) => {
        if (event === 'end') cb();
        return res.req;
    };
    dispatcher.dispatchOssRoute('POST', '/api/refresh', res.req, res.res);
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(res.getStatusCode(), 304);
    assert.ok(res.getBody() == null || res.getBody() === '');
    assert.strictEqual(res.getHeaders().etag, '"1"');
});

report();
