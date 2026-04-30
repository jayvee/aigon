#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { test, testAsync, withTempDirAsync, report } = require('../_helpers');
const engine = require('../../lib/workflow-core/engine');
const { collectRepoStatus, clearTierCache } = require('../../lib/dashboard-status-collector');
const { createDashboardRouteDispatcher } = require('../../lib/dashboard-routes');

function makeResponse(resolve) {
    const res = new EventEmitter();
    res.statusCode = 0;
    res.headers = {};
    res.setHeader = (key, value) => { res.headers[key.toLowerCase()] = value; };
    res.writeHead = (status, headers) => {
        res.statusCode = status;
        Object.assign(res.headers, headers || {});
    };
    res.end = (body) => {
        resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: body ? JSON.parse(body) : null,
        });
    };
    return res;
}

function dispatch(routeCtx, method, url) {
    return new Promise((resolve) => {
        const req = new EventEmitter();
        req.method = method;
        req.url = url;
        req.headers = { host: 'localhost' };
        const res = makeResponse(resolve);
        routeCtx.dispatchOssRoute(method, url.split('?')[0], req, res);
    });
}

testAsync('collectRepoStatus trims detail-only fields from feature and research rows', () => withTempDirAsync('aigon-list-detail-', async (repo) => {
    const featureSpec = path.join(repo, 'docs', 'specs', 'features', '02-backlog', 'feature-91-list-detail.md');
    const researchSpec = path.join(repo, 'docs', 'specs', 'research-topics', '02-backlog', 'research-12-list-detail.md');
    fs.mkdirSync(path.dirname(featureSpec), { recursive: true });
    fs.mkdirSync(path.dirname(researchSpec), { recursive: true });
    fs.writeFileSync(featureSpec, '# Feature: list detail\n');
    fs.writeFileSync(researchSpec, '# Research: list detail\n');
    engine.ensureEntityBootstrappedSync(repo, 'feature', '91', 'backlog', featureSpec, { authorAgentId: 'cc' });
    engine.ensureEntityBootstrappedSync(repo, 'research', '12', 'backlog', researchSpec, { authorAgentId: 'cc' });
    clearTierCache(repo);

    const status = collectRepoStatus(repo, { summary: { implementing: 0, waiting: 0, complete: 0, error: 0, total: 0 } });
    const feature = status.features.find(row => String(row.id) === '91');
    const research = status.research.find(row => String(row.id) === '12');
    assert.ok(feature, 'feature row missing');
    assert.ok(research, 'research row missing');

    [feature, research].forEach((row) => {
        assert.strictEqual(Object.prototype.hasOwnProperty.call(row, 'workflowEvents'), false, 'workflowEvents must be detail-only');
        assert.strictEqual(Object.prototype.hasOwnProperty.call(row, 'reviewSessions'), false, 'full reviewSessions must be detail-only');
        assert.ok(Number.isFinite(row.workflowEventCount), 'list row should keep event count');
        assert.ok(row.detailFingerprint, 'list row should expose detail fingerprint for drawer cache invalidation');
        assert.ok(Array.isArray(row.reviewSessionSummary), 'list row should keep lightweight review summary');
    });
    assert.strictEqual(Object.prototype.hasOwnProperty.call(feature, 'autonomousPlan'), false, 'autonomousPlan must be detail-only');
}));

testAsync('typed feature and research detail routes resolve independently', async () => {
    const calls = [];
    const dispatcher = createDashboardRouteDispatcher({
        state: {
            getLatestStatus: () => ({}),
            setLatestStatus: () => {},
            getGlobalConfig: () => ({}),
            setGlobalConfig: () => {},
            getNotificationUnreadCount: () => 0,
            setNotificationUnreadCount: () => {},
        },
        helpers: {},
        routes: {
            readConductorReposFromGlobalConfig: () => ['/tmp/aigon-route-repo'],
            resolveDetailRepoPath: (_repos, options) => {
                calls.push(options);
                return options.repoPath || '/tmp/aigon-route-repo';
            },
            buildDetailPayload: (repoPath, type, id, specPathHint) => ({
                id,
                type,
                repoPath,
                specPath: specPathHint || null,
                workflowEvents: [{ type: `${type}.created` }],
                reviewSessions: [{ agent: 'cc', running: false }],
                autonomousPlan: type === 'feature' ? { status: 'idle' } : null,
            }),
        },
    });

    const feature = await dispatch(dispatcher, 'GET', '/api/features/91/details?repoPath=/tmp/aigon-route-repo');
    const research = await dispatch(dispatcher, 'GET', '/api/research/12/details?repoPath=/tmp/aigon-route-repo');
    assert.strictEqual(feature.statusCode, 200);
    assert.strictEqual(feature.body.type, 'feature');
    assert.deepStrictEqual(feature.body.workflowEvents, [{ type: 'feature.created' }]);
    assert.deepStrictEqual(feature.body.autonomousPlan, { status: 'idle' });
    assert.strictEqual(research.statusCode, 200);
    assert.strictEqual(research.body.type, 'research');
    assert.deepStrictEqual(research.body.reviewSessions, [{ agent: 'cc', running: false }]);
    assert.strictEqual(calls[0].type, 'feature');
    assert.strictEqual(calls[1].type, 'research');
});

test('drawer details fetch is lazy, cached by fingerprint, and renders inline errors', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../templates/dashboard/js/detail-tabs.js'), 'utf8');
    assert.ok(src.includes('__aigonEntityDetailCache'), 'drawer should keep an in-memory detail cache');
    assert.ok(src.includes('drawer.detailFingerprint'), 'cache key should include the list-provided detail fingerprint');
    assert.ok(src.includes('/api/${segment}/${parsed.id}/details'), 'drawer should use typed details endpoints');
    assert.ok(src.includes('drawer-empty-error'), 'detail fetch failures should render inline drawer errors');
});

report();
