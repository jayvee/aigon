#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { test, report } = require('../_helpers');

// Spin up an isolated HOME + cwd so the global/project config writes don't
// touch the developer's real ~/.aigon. Set BEFORE requiring lib/config.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-focus-test-'));
const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-focus-repo-'));
process.env.HOME = tmpHome;
const originalCwd = process.cwd();
process.chdir(tmpRepo);

// Clear cached modules so they pick up the new HOME.
for (const k of Object.keys(require.cache)) {
    if (k.includes('/lib/config') || k.includes('/lib/global-config-migration') || k.includes('/lib/terminal-adapters')) {
        delete require.cache[k];
    }
}

const config = require('../../lib/config');
const ta = require('../../lib/terminal-adapters');

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

// --- Default = background ---
test('default focusOnLaunch is background', () => {
    writeGlobal({ terminalApp: 'apple-terminal' });
    clearProject();
    const eff = config.getEffectiveConfig(tmpRepo);
    assert.strictEqual(eff.terminal.focusOnLaunch, 'background');
});

// --- Global override survives merge ---
test('global override to foreground wins over default', () => {
    writeGlobal({ terminalApp: 'apple-terminal', terminal: { focusOnLaunch: 'foreground' } });
    clearProject();
    const eff = config.getEffectiveConfig(tmpRepo);
    assert.strictEqual(eff.terminal.focusOnLaunch, 'foreground');
});

// --- F521: terminal.focusOnLaunch is user-scope; project overrides are ignored ---
test('F521: project override of terminal.focusOnLaunch is ignored (user-scope)', () => {
    writeGlobal({ terminalApp: 'apple-terminal', terminal: { focusOnLaunch: 'foreground' } });
    writeProject({ terminal: { focusOnLaunch: 'background' } });
    const eff = config.getEffectiveConfig(tmpRepo);
    // Project value 'background' is ignored — global 'foreground' wins.
    assert.strictEqual(eff.terminal.focusOnLaunch, 'foreground');
});

// --- Legacy `terminal: "warp"` string is migrated, not exposed as object ---
test('legacy terminal:"warp" string still migrates to terminalApp', () => {
    const { migrateLegacyTerminalSettings } = require('../../lib/global-config-migration');
    const cfg = { terminal: 'warp' };
    migrateLegacyTerminalSettings(cfg);
    assert.strictEqual(cfg.terminalApp, 'warp');
    assert.strictEqual(cfg.terminal, undefined);
});

// --- Object-shaped terminal is preserved through migration ---
test('object terminal: { focusOnLaunch } survives migration', () => {
    const { migrateLegacyTerminalSettings } = require('../../lib/global-config-migration');
    const cfg = { terminalApp: 'iterm2', terminal: { focusOnLaunch: 'foreground' } };
    migrateLegacyTerminalSettings(cfg);
    assert.deepStrictEqual(cfg.terminal, { focusOnLaunch: 'foreground' });
});

// --- AppleScript wrapper produces capture/restore frame ---
test('wrapBackgroundAppleScript brackets body with capture + restore', () => {
    const out = ta.wrapBackgroundAppleScript('do script "x"', 'iTerm');
    assert.ok(out.startsWith('tell application "System Events"'), 'starts with capture');
    assert.ok(out.includes('set prevApp to name of first process whose frontmost is true'));
    assert.ok(out.includes('do script "x"'), 'body present');
    assert.ok(out.includes('if prevApp is not "iTerm" then'), 'guards re-activate');
    assert.ok(out.includes('tell application prevApp to activate'));
});

// --- Adapter smoke: each macOS adapter accepts opts.background without throwing
//     during script construction. We can't actually invoke osascript here, so
//     stub runOsaScript via spawnSync mocking is overkill — instead, exercise
//     the public surface via the adapter table and ensure it's wired up. ---
test('iterm2 / ghostty / cmux / apple-terminal adapters exist with launch()', () => {
    for (const id of ['iterm2', 'ghostty', 'cmux', 'apple-terminal', 'warp']) {
        const a = ta.adapters.find(x => (x.id || x.name) === id);
        assert.ok(a, `${id} adapter present`);
        assert.strictEqual(typeof a.launch, 'function', `${id}.launch is function`);
    }
});

process.chdir(originalCwd);
report();
