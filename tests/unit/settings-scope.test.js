#!/usr/bin/env node
'use strict';

// F521 — settings-scope-restructure
// Verifies the scope model end-to-end at the unit layer:
//   1. Every DASHBOARD_SETTINGS_SCHEMA entry carries a valid scope.
//   2. The schema's scope tags align with USER_SCOPE_KEYS in lib/config.js.
//   3. getEffectiveConfig short-circuits project-layer values for user-scope keys.
//   4. listStaleUserScopeProjectOverrides surfaces stale paths.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { test, report } = require('../_helpers');

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-scope-home-'));
const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-scope-repo-'));
process.env.HOME = tmpHome;
const originalCwd = process.cwd();
process.chdir(tmpRepo);

for (const k of Object.keys(require.cache)) {
    if (k.includes('/lib/config') || k.includes('/lib/dashboard-server') || k.includes('/lib/terminal-adapters')) {
        delete require.cache[k];
    }
}

const config = require('../../lib/config');
const dashboardServer = require('../../lib/dashboard-server');

function writeGlobal(obj) {
    const dir = path.join(tmpHome, '.aigon');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(obj));
}
function writeProject(obj) {
    const dir = path.join(tmpRepo, '.aigon');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(obj));
}
function clearProject() {
    const f = path.join(tmpRepo, '.aigon', 'config.json');
    if (fs.existsSync(f)) fs.unlinkSync(f);
}

const VALID_SCOPES = new Set(['user', 'shared', 'repo']);

// ── Schema scope tagging ───────────────────────────────────────────────────

test('every schema entry carries a valid scope', () => {
    const schema = dashboardServer.DASHBOARD_SETTINGS_SCHEMA;
    assert.ok(Array.isArray(schema) && schema.length > 0, 'schema is non-empty');
    for (const def of schema) {
        assert.ok(VALID_SCOPES.has(def.scope), `${def.key} has invalid scope: ${def.scope}`);
    }
});

test('schema user-scope tags match config scope logic', () => {
    const schema = dashboardServer.DASHBOARD_SETTINGS_SCHEMA;
    const schemaUserKeys = schema.filter(d => d.scope === 'user').map(d => d.key).sort();
    
    // Every schema-user key MUST be recognised as user-scope by config's
    // isUserScopeKey logic — otherwise the resolver won't short-circuit
    // and the UI will be lying.
    for (const k of schemaUserKeys) {
        assert.ok(config.isUserScopeKey(k), `schema user-scope key "${k}" not recognised by config.isUserScopeKey`);
    }
});

test('getSettingScope returns the right scope for known keys', () => {
    assert.strictEqual(config.getSettingScope('terminalApp'), 'user');
    assert.strictEqual(config.getSettingScope('terminal.focusOnLaunch'), 'user');
    assert.strictEqual(config.getSettingScope('autoNudge.enabled'), 'user');
    assert.strictEqual(config.getSettingScope('agents.cc.cli'), 'user');
    assert.strictEqual(config.getSettingScope('agents.gg.implementFlag'), 'user');
    assert.strictEqual(config.getSettingScope('profile'), 'repo');
    assert.strictEqual(config.getSettingScope('devServer.enabled'), 'repo');
    assert.strictEqual(config.getSettingScope('defaultAgent'), 'shared');
    assert.strictEqual(config.getSettingScope('security.enabled'), 'shared');
    // Unknown keys default to 'shared' so legacy values keep working.
    assert.strictEqual(config.getSettingScope('totally.unknown.key'), 'shared');
});

// ── Resolver short-circuit ─────────────────────────────────────────────────

test('user-scope project override is ignored at resolution time', () => {
    writeGlobal({ terminalApp: 'apple-terminal', autoNudge: { enabled: false } });
    writeProject({ terminalApp: 'iterm2', autoNudge: { enabled: true } });
    const eff = config.getEffectiveConfig(tmpRepo);
    assert.strictEqual(eff.terminalApp, 'apple-terminal', 'terminalApp comes from global, not project');
    assert.strictEqual(eff.autoNudge.enabled, false, 'autoNudge.enabled comes from global, not project');
});

test('shared-scope project override still wins', () => {
    writeGlobal({ defaultAgent: 'cc' });
    writeProject({ defaultAgent: 'gg' });
    const eff = config.getEffectiveConfig(tmpRepo);
    assert.strictEqual(eff.defaultAgent, 'gg');
});

test('repo-scope project value is honoured (no global default applied)', () => {
    writeGlobal({});
    writeProject({ profile: 'ios' });
    const eff = config.getEffectiveConfig(tmpRepo);
    assert.strictEqual(eff.profile, 'ios');
});

test('agents.<id>.cli project override is ignored (user-scope)', () => {
    writeGlobal({ agents: { cc: { cli: 'claude-stable' } } });
    writeProject({ agents: { cc: { cli: 'claude-experimental' } } });
    const eff = config.getEffectiveConfig(tmpRepo);
    assert.strictEqual(eff.agents.cc.cli, 'claude-stable');
});

// ── Stale-override detection ───────────────────────────────────────────────

test('listStaleUserScopeProjectOverrides reports stale paths', () => {
    const projectConfig = {
        terminalApp: 'iterm2',
        autoNudge: { idleVisibleSec: 90 },
        agents: { cc: { cli: 'claude', implementFlag: '--yolo' } },
        // shared-scope key — should NOT appear in stale list
        defaultAgent: 'cc',
    };
    const stale = config.listStaleUserScopeProjectOverrides(projectConfig);
    assert.ok(stale.includes('terminalApp'));
    assert.ok(stale.includes('autoNudge.idleVisibleSec'));
    assert.ok(stale.includes('agents.cc.cli'));
    assert.ok(stale.includes('agents.cc.implementFlag'));
    assert.ok(!stale.includes('defaultAgent'), 'shared-scope keys are not stale');
});

test('listStaleUserScopeProjectOverrides handles empty / missing input', () => {
    assert.deepStrictEqual(config.listStaleUserScopeProjectOverrides(null), []);
    assert.deepStrictEqual(config.listStaleUserScopeProjectOverrides({}), []);
    assert.deepStrictEqual(config.listStaleUserScopeProjectOverrides({ defaultAgent: 'cc' }), []);
});

// ── Cleanup ────────────────────────────────────────────────────────────────
clearProject();
process.chdir(originalCwd);
report();
