#!/usr/bin/env node
'use strict';

// F521 — PUT /api/settings scope-violation handling.
// Exercises the route handler directly with a mock ctx — we don't need a live
// HTTP server to verify the 400 / 200 paths.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { test, report } = require('../_helpers');

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-api-home-'));
const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-api-repo-'));
process.env.HOME = tmpHome;
const originalCwd = process.cwd();
process.chdir(tmpRepo);

for (const k of Object.keys(require.cache)) {
    if (k.includes('/lib/')) delete require.cache[k];
}

const routes = require('../../lib/dashboard-routes/config');
const dashboardServer = require('../../lib/dashboard-server');

// Locate the PUT /api/settings handler.
const putSettings = routes.find(r => r.method === 'PUT' && r.path === '/api/settings');
assert.ok(putSettings, 'PUT /api/settings route exists');

function invoke(payload) {
    return new Promise((resolve) => {
        const responses = [];
        const ctx = {
            routes: {
                DASHBOARD_SETTINGS_SCHEMA: dashboardServer.DASHBOARD_SETTINGS_SCHEMA,
                coerceDashboardSettingValue: (type, v) => v,
                buildDashboardSettingsPayload: () => ({}),
                readRawGlobalConfig: () => ({}),
                setNestedValue: () => {},
            },
            helpers: {
                resolveRequestedRepoPathOrRespond: (_res, p) => p || tmpRepo,
            },
            readJsonBody: () => Promise.resolve(payload),
            sendJson: (status, body) => { responses.push({ status, body }); resolve(responses[0]); },
            setGlobalConfig: () => {},
        };
        putSettings.handler({ url: '/api/settings', headers: { host: 'x' } }, {}, ctx);
    });
}

// ── user-scope rejection ───────────────────────────────────────────────────
test('user-scope key cannot be written at project scope', async () => {
    const r = await invoke({ scope: 'project', key: 'terminalApp', value: 'iterm2', repoPath: tmpRepo });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.error, 'scope_violation');
    assert.strictEqual(r.body.key, 'terminalApp');
    assert.strictEqual(r.body.requestedScope, 'project');
    assert.strictEqual(r.body.allowedScope, 'user');
    assert.ok(r.body.message && r.body.message.includes('user-scope'));
});

test('user-scope key at global scope is accepted (no scope_violation)', async () => {
    const r = await invoke({ scope: 'global', key: 'terminalApp', value: 'iterm2', repoPath: tmpRepo });
    assert.notStrictEqual(r.body.error, 'scope_violation');
});

// ── repo-scope rejection ───────────────────────────────────────────────────
test('repo-scope key cannot be written at global scope', async () => {
    const r = await invoke({ scope: 'global', key: 'profile', value: 'ios', repoPath: tmpRepo });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.error, 'scope_violation');
    assert.strictEqual(r.body.allowedScope, 'repo');
});

test('repo-scope key at project scope is accepted', async () => {
    const r = await invoke({ scope: 'project', key: 'profile', value: 'ios', repoPath: tmpRepo });
    assert.notStrictEqual(r.body.error, 'scope_violation');
});

// ── shared-scope accepts both ──────────────────────────────────────────────
test('shared-scope key accepted at both global and project', async () => {
    const a = await invoke({ scope: 'global', key: 'defaultAgent', value: 'cc', repoPath: tmpRepo });
    assert.notStrictEqual(a.body.error, 'scope_violation');
    const b = await invoke({ scope: 'project', key: 'defaultAgent', value: 'cu', repoPath: tmpRepo });
    assert.notStrictEqual(b.body.error, 'scope_violation');
});

process.chdir(originalCwd);
report();
