#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { testAsync, withTempDirAsync, report } = require('../_helpers');
const { createDashboardRouteDispatcher } = require('../../lib/dashboard-routes');

function buildReqRes(payload) {
    const req = {
        on(event, handler) {
            if (event === 'data') handler(Buffer.from(JSON.stringify(payload)));
            if (event === 'end') handler();
        }
    };
    let statusCode = null;
    let body = null;
    const res = {
        writeHead(code) { statusCode = code; },
        end(payloadText) { body = payloadText; }
    };
    return { req, res, getStatusCode: () => statusCode, getBody: () => (body ? JSON.parse(body) : null) };
}

testAsync('dashboard route accepts /api/feature-spec-revise and launches revision flow', () => withTempDirAsync('aigon-spec-revise-route-', async (repo) => {
    const specDir = path.join(repo, 'docs', 'specs', 'features', '02-backlog');
    const specPath = path.join(specDir, 'feature-46-route-test.md');
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(specPath, '# Feature: route test\n');

    let launchArgs = null;
    const serverCtx = {
        state: {
            getLatestStatus: () => null,
            setLatestStatus: () => {},
            getGlobalConfig: () => ({}),
            setGlobalConfig: () => {},
            getNotificationUnreadCount: () => 0,
            setNotificationUnreadCount: () => {},
        },
        helpers: {},
        routes: {
            parseFeatureSpecFileName(file) {
                const match = String(file || '').match(/^feature-(?:(\d+)-)?(.+)\.md$/);
                return match ? { id: match[1] || null, name: match[2] || null } : null;
            },
            handleLaunchSpecReview(ctx, options) {
                launchArgs = { ctx, options };
                return { ok: true, sessionName: 'test-session' };
            },
        },
        options: {},
    };
    const dispatcher = createDashboardRouteDispatcher(serverCtx);
    const { req, res, getStatusCode, getBody } = buildReqRes({
        entityId: '46',
        agentId: 'cc',
        repoPath: repo,
    });

    const matched = dispatcher.dispatchOssRoute('POST', '/api/feature-spec-revise', req, res);
    await new Promise(resolve => setImmediate(resolve));

    assert.strictEqual(matched, true);
    assert.strictEqual(getStatusCode(), 200);
    assert.strictEqual(getBody().ok, true);
    assert.ok(launchArgs, 'handleLaunchSpecReview should be called');
    assert.strictEqual(launchArgs.options.commandName, 'feature-spec-revise');
    assert.strictEqual(launchArgs.options.role, 'spec-revise');
    assert.strictEqual(launchArgs.options.taskType, 'spec-revise');
    assert.strictEqual(launchArgs.ctx.featureId, '46');
    assert.strictEqual(launchArgs.ctx.agentId, 'cc');
}));

report();
