#!/usr/bin/env node
'use strict';

/**
 * F502 layer 3 — install-manifest lockstep CI guard.
 *
 * This test pins `templates/` to `.aigon/install-manifest.json`. If a
 * maintainer edits a template without re-running `aigon install-agent --all`,
 * the test fails with the exact remediation. Catches the "merged a template
 * edit without reinstall" case that drift cache + auto-reinstall can't.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { testAsync, withTempDirAsync, report, GIT_SAFE_ENV } = require('../_helpers');
const installManifestLib = require('../../lib/install-manifest');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'aigon-cli.js');

function runInstallAll(repo) {
    return execFileSync(process.execPath, [CLI, 'install-agent', '--all'], {
        cwd: repo,
        env: { ...process.env, ...GIT_SAFE_ENV, HOME: repo, USERPROFILE: repo, AIGON_NONINTERACTIVE: '1' },
        stdio: 'pipe',
    }).toString();
}

testAsync('install-manifest is in lockstep with templates/ (F502 layer 3)', () => withTempDirAsync('aigon-f502-lockstep-', async (repo) => {
    const committed = installManifestLib.readManifest(REPO_ROOT);
    assert.ok(committed, 'aigon repo must have a committed install-manifest');
    const committedAgents = installManifestLib.getInstalledAgents(committed);
    assert.ok(committedAgents.length > 0, 'committed manifest must list installed agents');

    fs.mkdirSync(path.join(repo, 'docs', 'specs'), { recursive: true });

    // Mirror the dogfood project config so placeholder resolution
    // (planMode, testing rigor, etc.) produces the same content the
    // committed manifest was generated against. We pin `profile: library`
    // explicitly so auto-detection (which reads root files like
    // package.json that don't exist in the tmpdir) cannot drift the result.
    const dogfoodConfig = path.join(REPO_ROOT, '.aigon', 'config.json');
    let cfg = {};
    if (fs.existsSync(dogfoodConfig)) {
        try { cfg = JSON.parse(fs.readFileSync(dogfoodConfig, 'utf8')); } catch (_) { /* ignore */ }
    }
    cfg.profile = 'library';
    fs.mkdirSync(path.join(repo, '.aigon'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.aigon', 'config.json'), JSON.stringify(cfg, null, 2));

    runInstallAll(repo);

    const fresh = installManifestLib.readManifest(repo);
    assert.ok(fresh, 'fresh install must produce a manifest');

    // Compare: for every command/skill/rules path in the committed manifest,
    // the fresh install must produce a file with the same sha256.
    //
    // We restrict to command/skill files (template-derived, deterministic).
    // Settings files (.claude/settings.json, .gemini/settings.json) are
    // merged with user state and may legitimately differ across machines.
    const COMPARE_PREFIXES = [
        '.claude/commands/aigon/',
        '.claude/skills/aigon/',
        '.cursor/commands/',
        '.cursor/rules/aigon',
        '.gemini/commands/aigon/',
        '.agents/skills/aigon-',
        '.opencode/commands/',
        '.aigon/docs/',
    ];
    function shouldCompare(p) {
        return COMPARE_PREFIXES.some(pre => p.startsWith(pre));
    }

    const committedByPath = new Map();
    for (const entry of committed.files) {
        if (shouldCompare(entry.path)) committedByPath.set(entry.path, entry.sha256);
    }
    const freshByPath = new Map();
    for (const entry of fresh.files) {
        if (shouldCompare(entry.path)) freshByPath.set(entry.path, entry.sha256);
    }

    const drift = [];
    for (const [p, sha] of committedByPath) {
        if (!freshByPath.has(p)) {
            drift.push(`  - REMOVED: ${p} (in committed manifest, not produced by fresh install)`);
            continue;
        }
        const freshSha = freshByPath.get(p);
        if (freshSha !== sha) {
            drift.push(`  - CHANGED: ${p} (committed sha=${sha.slice(0, 12)}…, fresh sha=${freshSha.slice(0, 12)}…)`);
        }
    }
    for (const [p] of freshByPath) {
        if (!committedByPath.has(p)) {
            drift.push(`  - ADDED:   ${p} (produced by fresh install, missing from committed manifest)`);
        }
    }

    if (drift.length > 0) {
        const remediation = '\n  Templates edited but install-manifest not regenerated.'
            + '\n  Run: aigon install-agent --all && git add .aigon/install-manifest.json .claude/ .cursor/ .gemini/ .agents/';
        assert.fail(`install-manifest drift detected:\n${drift.slice(0, 30).join('\n')}${drift.length > 30 ? `\n  …and ${drift.length - 30} more` : ''}\n${remediation}`);
    }
}));

testAsync('manifest.agents list survives a fresh install (F502)', () => withTempDirAsync('aigon-f502-agents-array-', async (repo) => {
    fs.mkdirSync(path.join(repo, 'docs', 'specs'), { recursive: true });
    runInstallAll(repo);
    const m = installManifestLib.readManifest(repo);
    assert.ok(Array.isArray(m.agents), 'manifest.agents must be present');
    assert.ok(m.agents.length > 0, 'manifest.agents must be non-empty after --all');
    // --all installs every agent the registry exposes; check a representative
    // subset rather than enumerating to avoid coupling to the registry list.
    assert.ok(m.agents.includes('cc'), `manifest.agents should include cc, got: ${m.agents.join(',')}`);
}));

report();
