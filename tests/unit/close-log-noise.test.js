#!/usr/bin/env node
'use strict';

// REGRESSION: close-log panel was flooded with noise from deactivated gg template
// drift, Aigon ephemeral session files, and optional semgrep absence.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, report } = require('../_helpers');
const { filterEphemeralWorkingTreePaths, isEphemeralWorkingTreePath } = require('../../lib/ephemeral-paths');

test('ephemeral paths filter Aigon session/telemetry noise from stash warnings', () => {
    assert.strictEqual(isEphemeralWorkingTreePath('.aigon/sessions/events.jsonl'), true);
    assert.strictEqual(isEphemeralWorkingTreePath('.aigon/telemetry/signal-health/2026-07-11.jsonl'), true);
    assert.strictEqual(isEphemeralWorkingTreePath('docs/.DS_Store'), true);
    assert.strictEqual(isEphemeralWorkingTreePath('src/lib/foo.ts'), false);
    const filtered = filterEphemeralWorkingTreePaths([
        '.aigon/sessions/foo.json',
        'src/app.ts',
    ]);
    assert.deepStrictEqual(filtered, ['src/app.ts']);
});

test('template drift ignores deactivated gg even when legacy gemini files remain in manifest', () => {
    const { withTempDir } = require('../_helpers');
    const installManifest = require('../../lib/install-manifest');
    withTempDir((repo) => {
        fs.mkdirSync(path.join(repo, 'templates', 'generic', 'commands'), { recursive: true });
        const tpl = path.join(repo, 'templates', 'generic', 'commands', 'feature-close.md');
        fs.writeFileSync(tpl, '# close\n');
        const tplSha = require('crypto').createHash('sha256').update(fs.readFileSync(tpl)).digest('hex');
        const manifest = installManifest.createEmptyManifest('9.9.9');
        manifest.agents = ['cc', 'gg'];
        manifest.files = [
            { path: '.gemini/commands/aigon/feature-close.toml', sha256: 'disk-old', templatePath: 'templates/generic/commands/feature-close.md', templateSha: 'stale-template-sha' },
            { path: '.claude/commands/aigon/feature-close.md', sha256: 'disk-old', templatePath: 'templates/generic/commands/feature-close.md', templateSha: 'stale-template-sha' },
        ];
        installManifest.writeManifest(repo, manifest);
        fs.mkdirSync(path.join(repo, '.gemini', 'commands', 'aigon'), { recursive: true });
        fs.writeFileSync(path.join(repo, '.gemini', 'commands', 'aigon', 'feature-close.toml'), 'old');
        fs.mkdirSync(path.join(repo, '.claude', 'commands', 'aigon'), { recursive: true });
        fs.writeFileSync(path.join(repo, '.claude', 'commands', 'aigon', 'feature-close.md'), 'old');
        // Touch template mtime so cache invalidates
        const now = new Date();
        fs.utimesSync(tpl, now, now);
        const drift = require('../../lib/template-drift');
        drift.clearCache(repo);
        const { byAgent } = drift.detectStaleTemplates(repo);
        assert.ok(byAgent.cc, 'active agent still reports drift');
        assert.strictEqual(byAgent.gg, undefined, 'deactivated gg must not warn');
        assert.notStrictEqual(tplSha, 'stale-template-sha');
    });
});

report();
