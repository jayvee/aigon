'use strict';

// F523: regenerate installed agent command files after a bake-affecting
// setting changes.
//
// Background: install-agent inlines values like `profile`, `devServer.enabled`
// and the `instructions.*` directives into per-agent command files
// (e.g. `.claude/commands/aigon/feature-do.md`). Editing those values in
// `.aigon/config.json` (via dashboard or `aigon config set`) has no effect
// on agents until install-agent is re-run. This module runs the
// regeneration and commits the result so the setting change actually
// reaches future agent sessions.

const fs = require('fs');
const { spawnSync } = require('child_process');

const installManifestLib = require('./install-manifest');
const { CLI_ENTRY_PATH } = require('./config');
const { isAigonSourceRepo } = require('./repo-identity');

// Keys whose values are inlined into installed agent command files at
// install-agent time. Source of truth for the CLI path. The dashboard
// schema (`DASHBOARD_SETTINGS_SCHEMA`) carries `affectsInstalledCommands:
// true` on its own subset; the CLI uses this set because the
// `instructions.*` keys are config-only and not in the dashboard schema.
const BAKE_AFFECTING_KEYS = new Set([
    'profile',
    'devServer.enabled',
    'instructions.rigor',
    'instructions.testing',
    'instructions.logging',
    'instructions.planMode',
    'instructions.documentation',
    'instructions.devServer',
]);

function keyAffectsInstalledCommands(key, schema) {
    if (Array.isArray(schema)) {
        const def = schema.find(s => s.key === key);
        if (def && def.affectsInstalledCommands) return true;
    }
    return BAKE_AFFECTING_KEYS.has(key);
}

function hasInstallManifest(repoPath) {
    try {
        return !!installManifestLib.readManifest(repoPath);
    } catch (_) {
        // Corrupt manifest (invalid JSON) — a manifest existed, so agents
        // are presumably installed. Don't skip: `install-agent --all` below
        // self-heals corrupt manifests (lib/install-manifest.js
        // readManifestRecovering), so let it run instead of giving up.
        return true;
    }
}

// Re-run `aigon install-agent --all` in `repoPath` and commit any
// regenerated agent command files. Skips silently when the repo has no
// install manifest (the user never ran install-agent — nothing to refresh).
//
// Returns { regenerated, skipped, committed?, reason?, error? }. Never throws.
function regenerateAgentInstructions(repoPath) {
    if (!repoPath || !fs.existsSync(repoPath)) {
        return { regenerated: false, skipped: true, reason: 'repo-path-missing' };
    }
    if (!hasInstallManifest(repoPath)) {
        return { regenerated: false, skipped: true, reason: 'no-install-manifest' };
    }
    if (isAigonSourceRepo(repoPath)) {
        return { regenerated: false, skipped: true, reason: 'aigon-source-repo' };
    }

    const installResult = spawnSync(
        process.execPath,
        [CLI_ENTRY_PATH, 'install-agent', '--all'],
        { cwd: repoPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    if (installResult.error || (typeof installResult.status === 'number' && installResult.status !== 0)) {
        return {
            regenerated: false,
            skipped: false,
            error: (installResult.error && installResult.error.message) ||
                (installResult.stderr || installResult.stdout || '').slice(0, 500).trim() ||
                'install-agent --all failed',
        };
    }

    // Stage only install surfaces — never `git add -A`, which would sweep
    // unrelated user edits into our commit.
    const stagePaths = ['.claude', '.cursor', '.agents', '.codex', '.aigon'];
    const addResult = spawnSync('git', ['add', '--', ...stagePaths], {
        cwd: repoPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (addResult.error || (typeof addResult.status === 'number' && addResult.status !== 0)) {
        return {
            regenerated: true,
            committed: false,
            error: (addResult.error && addResult.error.message) ||
                (addResult.stderr || '').slice(0, 500).trim() ||
                'git add failed',
        };
    }

    // Nothing staged? install-agent was a no-op (state already matched).
    const diff = spawnSync('git', ['diff', '--cached', '--quiet'], {
        cwd: repoPath, stdio: 'ignore',
    });
    if (diff.status === 0) {
        return { regenerated: true, skipped: false, committed: false };
    }

    const commitResult = spawnSync(
        'git',
        ['commit', '-m', 'chore(install): regenerate agent instructions after settings change'],
        { cwd: repoPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    if (commitResult.error || (typeof commitResult.status === 'number' && commitResult.status !== 0)) {
        return {
            regenerated: true,
            committed: false,
            error: (commitResult.error && commitResult.error.message) ||
                (commitResult.stderr || '').slice(0, 500).trim() ||
                'git commit failed',
        };
    }

    return { regenerated: true, skipped: false, committed: true };
}

module.exports = {
    BAKE_AFFECTING_KEYS,
    keyAffectsInstalledCommands,
    regenerateAgentInstructions,
};
