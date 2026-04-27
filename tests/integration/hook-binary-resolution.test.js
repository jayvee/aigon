#!/usr/bin/env node
'use strict';
// REGRESSION: F333 — hook commands must use login-shell wrapper instead of hardcoded
// absolute paths or bare `aigon` so hooks fire correctly when Claude Code is launched
// from the macOS Dock (minimal PATH) or when aigon is installed via nvm/fnm/Homebrew.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');
const { wrapAigonCommand, migrateAigonHookCommand } = require('../../lib/commands/setup')._test;
const { pathsFromGitStatusPorcelain } = require('../../lib/commands/setup/gitignore-and-hooks');
const userShell = process.env.SHELL || '/bin/bash';
test('wrap/migrate hook command cases', () => {
    const wrapped = `${userShell} -l -c "aigon check-version"`;
    assert.strictEqual(wrapAigonCommand('aigon check-version'), wrapped);
    assert.strictEqual(wrapAigonCommand('aigon session-hook --repo "$CLAUDE_PROJECT_DIR"'), `${userShell} -l -c "aigon session-hook --repo \\"$CLAUDE_PROJECT_DIR\\""`);
    [
        ['aigon check-version', wrapped],
        ['/opt/homebrew/bin/aigon check-version', wrapped],
        ['/usr/local/bin/aigon session-hook --repo foo', `${userShell} -l -c "aigon session-hook --repo foo"`],
        ['/Users/alice/.local/state/fnm_multishells/12345/bin/aigon check-version', wrapped],
        [wrapped, wrapped],
        ['/usr/local/bin/node /path/to/my-hook.js', '/usr/local/bin/node /path/to/my-hook.js'],
        [null, null],
        [undefined, undefined],
    ].forEach(([input, expected]) => assert.strictEqual(migrateAigonHookCommand(input), expected));
});
function migrateHookSettings(settings) {
    Object.values(settings.hooks).forEach(hookArr => {
        hookArr.forEach(entry => {
            if (entry.hooks) entry.hooks.forEach(h => { h.command = migrateAigonHookCommand(h.command); });
            else entry.command = migrateAigonHookCommand(entry.command);
        });
    });
    return settings;
}
test('fresh install: settings-based hooks written with login-shell wrapper', () => withTempDir('aigon-hook-333-', (dir) => {
    const settingsPath = path.join(dir, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    // Write a minimal existing settings file with bare aigon hook
    fs.writeFileSync(settingsPath, JSON.stringify({
        hooks: {
            SessionStart: [
                { matcher: 'startup', hooks: [{ type: 'command', command: 'aigon check-version', timeout: 30 }] }
            ]
        }
    }, null, 2));
    const settings = migrateHookSettings(JSON.parse(fs.readFileSync(settingsPath, 'utf8')));
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    const migrated = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const hook = migrated.hooks.SessionStart[0].hooks[0];
    assert.ok(hook.command.startsWith(userShell), 'hook command should start with user shell');
    assert.ok(hook.command.includes('-l -c "aigon check-version"'), 'hook command should be login-shell wrapped');
}));
test('fresh install: standalone hooks file written with login-shell wrapper', () => withTempDir('aigon-hook-333cu-', (dir) => {
    const hooksPath = path.join(dir, '.cursor', 'hooks.json');
    fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
    const hookConfigs = [
        { command: 'aigon check-version', timeout: 30 },
        { command: 'aigon project-context', timeout: 10 },
    ];
    const hooksFile = { hooks: { sessionStart: [] } };
    hookConfigs.forEach(hookConfig => {
        const alreadyExists = hooksFile.hooks.sessionStart.some(existing =>
            existing.command && existing.command.includes(hookConfig.command)
        );
        if (!alreadyExists) {
            hooksFile.hooks.sessionStart.push({
                ...hookConfig,
                command: wrapAigonCommand(hookConfig.command),
            });
        }
    });
    fs.writeFileSync(hooksPath, JSON.stringify(hooksFile, null, 2));
    const written = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
    assert.strictEqual(written.hooks.sessionStart.length, 2, 'cursor hooks file should include both aigon hooks');
    const commands = written.hooks.sessionStart.map(entry => entry.command);
    assert.ok(commands.every(cmd => cmd.startsWith(userShell)), 'cursor hook commands should start with user shell');
    assert.ok(commands.some(cmd => cmd.includes('-l -c "aigon check-version"')), 'cursor hooks file should include wrapped check-version');
    assert.ok(commands.some(cmd => cmd.includes('-l -c "aigon project-context"')), 'cursor hooks file should include wrapped project-context');
}));
test('re-run: already-wrapped hook is left unchanged', () => withTempDir('aigon-hook-333idem-', (dir) => {
    const settingsPath = path.join(dir, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const wrappedCmd = wrapAigonCommand('aigon check-version');
    const initial = {
        hooks: {
            SessionStart: [
                { matcher: 'startup', hooks: [{ type: 'command', command: wrappedCmd, timeout: 30 }] }
            ]
        }
    };
    fs.writeFileSync(settingsPath, JSON.stringify(initial, null, 2));
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    let changed = false;
    Object.values(settings.hooks).forEach(hookArr => {
        hookArr.forEach(entry => {
            if (entry.hooks) {
                entry.hooks.forEach(h => {
                    const m = migrateAigonHookCommand(h.command);
                    if (m !== h.command) { h.command = m; changed = true; }
                });
            }
        });
    });
    assert.ok(!changed, 'already-wrapped hook should not be changed on re-run');
    const hook = settings.hooks.SessionStart[0].hooks[0];
    assert.strictEqual(hook.command, wrappedCmd, 'hook command should be unchanged');
}));
test('non-aigon hook entry is left byte-for-byte identical', () => withTempDir('aigon-hook-333non-', (dir) => {
    const settingsPath = path.join(dir, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const nonAigonCmd = 'node /path/to/custom-hook.js';
    const initial = {
        hooks: {
            SessionStart: [
                { type: 'command', command: nonAigonCmd, timeout: 10 }
            ]
        }
    };
    fs.writeFileSync(settingsPath, JSON.stringify(initial, null, 2));
    const settings = migrateHookSettings(JSON.parse(fs.readFileSync(settingsPath, 'utf8')));
    assert.strictEqual(
        settings.hooks.SessionStart[0].command,
        nonAigonCmd,
        'non-aigon hook command must be byte-for-byte identical after migration'
    );
}));
test('pathsFromGitStatusPorcelain lists paths for explicit git add (F307 seed-reset)', () => {
    // REGRESSION: seed-reset provision must not use `git add -A`; parser must cover rename + untracked.
    const got = pathsFromGitStatusPorcelain(' M docs/foo.md\n?? .claude/x\nR  a.md -> b.md\n').sort();
    assert.deepStrictEqual(got, ['.claude/x', 'a.md', 'b.md', 'docs/foo.md'].sort());
});
report();
