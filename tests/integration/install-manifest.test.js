#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { testAsync, withTempDirAsync, report, GIT_SAFE_ENV } = require('../_helpers');
const { runPendingMigrations } = require('../../lib/migration');
const installManifestLib = require('../../lib/install-manifest');

const CLI = path.join(__dirname, '..', '..', 'aigon-cli.js');

function runInstallAgent(repo, extraArgs = []) {
    return execFileSync(process.execPath, [CLI, 'install-agent', 'cc', ...extraArgs], {
        cwd: repo,
        env: { ...process.env, ...GIT_SAFE_ENV, HOME: repo, USERPROFILE: repo, AIGON_NONINTERACTIVE: '1' },
        stdio: 'pipe',
    }).toString();
}

function runRemove(repo, extraArgs = []) {
    return execFileSync(process.execPath, [CLI, 'remove', ...extraArgs], {
        cwd: repo,
        env: { ...process.env, ...GIT_SAFE_ENV, HOME: repo, USERPROFILE: repo, AIGON_NONINTERACTIVE: '1' },
        stdio: 'pipe',
    }).toString();
}

testAsync('install-agent writes manifest with valid entries; second run is idempotent (no duplicates)', () => withTempDirAsync('aigon-f422-fresh-', async (repo) => {
    fs.mkdirSync(path.join(repo, 'docs', 'specs'), { recursive: true });
    runInstallAgent(repo);

    const manifest = installManifestLib.readManifest(repo);
    assert.ok(manifest);
    assert.strictEqual(manifest.version, installManifestLib.MANIFEST_VERSION);
    assert.ok(manifest.files.length > 0 && manifest.aigonVersion);
    for (const entry of manifest.files) {
        assert.ok(fs.existsSync(path.join(repo, entry.path)), `${entry.path} on disk`);
        assert.ok(entry.sha256 && entry.sha256.length === 64);
        assert.ok(entry.installedAt);
    }

    const count = manifest.files.length;
    runInstallAgent(repo);
    const manifest2 = installManifestLib.readManifest(repo);
    assert.strictEqual(manifest2.files.length, count, 'second install must not add duplicates');
    const paths = manifest2.files.map(f => f.path);
    assert.strictEqual(new Set(paths).size, paths.length, 'paths unique');
}));

testAsync('install-agent refreshes stale manifest entries without overwrite prompt', () => withTempDirAsync('aigon-f422-refresh-modified-', async (repo) => {
    const { spawnSync } = require('child_process');
    fs.mkdirSync(path.join(repo, 'docs', 'specs'), { recursive: true });
    runInstallAgent(repo);
    const manifest = installManifestLib.readManifest(repo);
    assert.ok(manifest.files.length > 0);

    // Hand-edit a tracked file
    const entry = manifest.files[0];
    const absPath = path.join(repo, entry.path);
    fs.writeFileSync(absPath, '# hand-edited content by test');
    assert.ok(installManifestLib.getModifiedFiles(manifest, repo).length > 0, 'pre-condition: file is modified');

    // Re-run: install-agent is a sync/update path, so it should not ask an
    // overwrite question. It refreshes the install manifest after writing.
    const result = spawnSync(process.execPath, [CLI, 'install-agent', 'cc'], {
        cwd: repo,
        env: { ...process.env, ...GIT_SAFE_ENV, HOME: repo, USERPROFILE: repo, AIGON_NONINTERACTIVE: '1' },
        encoding: 'utf8',
    });
    const combined = (result.stdout || '') + (result.stderr || '');
    assert.strictEqual(result.status, 0, `install-agent failed: ${combined}`);
    assert.ok(!combined.includes('Proceed with overwrite'), `install-agent must not prompt for overwrite: ${combined}`);

    const nextManifest = installManifestLib.readManifest(repo);
    assert.ok(nextManifest, 'manifest must exist after re-install');
    assert.strictEqual(installManifestLib.getModifiedFiles(nextManifest, repo).length, 0, 'manifest must be refreshed after re-install');
}));

testAsync('aigon remove: --dry-run preserves files; --force deletes manifest files, preserves runtime state', () => withTempDirAsync('aigon-f422-remove-', async (repo) => {
    fs.mkdirSync(path.join(repo, 'docs', 'specs'), { recursive: true });
    runInstallAgent(repo);
    const manifest = installManifestLib.readManifest(repo);
    assert.ok(manifest.files.length > 0);

    // Runtime state that must survive --force
    const runtimeDirs = ['.aigon/workflows', '.aigon/state', '.aigon/sessions'];
    for (const d of runtimeDirs) {
        fs.mkdirSync(path.join(repo, d), { recursive: true });
        fs.writeFileSync(path.join(repo, d, 'keep.json'), '{}');
    }
    fs.writeFileSync(path.join(repo, '.aigon', 'config.json'), '{}');

    // --dry-run: lists, deletes nothing
    const output = runRemove(repo, ['--dry-run']);
    assert.ok(output.includes('dry-run'));
    for (const entry of manifest.files) assert.ok(fs.existsSync(path.join(repo, entry.path)));
    assert.ok(installManifestLib.readManifest(repo));

    // --force: deletes manifest files but preserves runtime state
    runRemove(repo, ['--force']);
    for (const d of runtimeDirs) assert.ok(fs.existsSync(path.join(repo, d, 'keep.json')));
    assert.ok(fs.existsSync(path.join(repo, '.aigon', 'config.json')));
    assert.strictEqual(installManifestLib.readManifest(repo), null);
}));

testAsync('migration 2.61.0 synthesizes manifest for legacy repo', () => withTempDirAsync('aigon-f422-mig-', async (repo) => {
    fs.mkdirSync(path.join(repo, 'docs', 'specs'), { recursive: true });
    // Simulate a legacy install without a manifest: just write some files in aigon dirs
    fs.mkdirSync(path.join(repo, '.claude', 'commands', 'aigon'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', 'commands', 'aigon', 'feature-create.md'), '# content');
    fs.mkdirSync(path.join(repo, '.aigon', 'docs'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.aigon', 'docs', 'development_workflow.md'), '# docs');

    assert.strictEqual(installManifestLib.readManifest(repo), null, 'pre-condition: no manifest');

    await runPendingMigrations(repo);

    const manifest = installManifestLib.readManifest(repo);
    assert.ok(manifest, 'migration must create manifest');
    assert.ok(manifest.files.length >= 2, 'manifest must include scanned files');
    const paths = manifest.files.map(f => f.path);
    assert.ok(paths.some(p => p.includes('feature-create.md')), 'must include feature-create.md');
    assert.ok(paths.some(p => p.includes('development_workflow.md')), 'must include development_workflow.md');
}));

report();
