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

testAsync('install-agent writes manifest with entries after fresh install', () => withTempDirAsync('aigon-f422-fresh-', async (repo) => {
    fs.mkdirSync(path.join(repo, 'docs', 'specs'), { recursive: true });
    runInstallAgent(repo);

    const manifest = installManifestLib.readManifest(repo);
    assert.ok(manifest, 'manifest must exist after install-agent');
    assert.strictEqual(manifest.version, installManifestLib.MANIFEST_VERSION);
    assert.ok(Array.isArray(manifest.files), 'manifest.files must be an array');
    assert.ok(manifest.files.length > 0, 'manifest must have at least one entry');
    assert.ok(manifest.aigonVersion, 'aigonVersion must be set');

    // Every path in the manifest must exist on disk
    for (const entry of manifest.files) {
        assert.ok(fs.existsSync(path.join(repo, entry.path)), `manifest entry ${entry.path} must exist on disk`);
        assert.ok(entry.sha256 && entry.sha256.length === 64, `sha256 must be a 64-char hex string for ${entry.path}`);
        assert.ok(entry.installedAt, `installedAt must be set for ${entry.path}`);
    }
}));

testAsync('install-agent twice does not grow duplicates in manifest', () => withTempDirAsync('aigon-f422-idempotent-', async (repo) => {
    fs.mkdirSync(path.join(repo, 'docs', 'specs'), { recursive: true });
    runInstallAgent(repo);
    const manifest1 = installManifestLib.readManifest(repo);
    const count1 = manifest1.files.length;

    runInstallAgent(repo);
    const manifest2 = installManifestLib.readManifest(repo);
    assert.strictEqual(manifest2.files.length, count1, 'second install must not add duplicate entries');

    // Paths must be unique
    const paths = manifest2.files.map(f => f.path);
    const unique = new Set(paths);
    assert.strictEqual(unique.size, paths.length, 'all paths in manifest must be unique');
}));

testAsync('install-agent manifest sha256 always matches on-disk content', () => withTempDirAsync('aigon-f422-sha-match-', async (repo) => {
    fs.mkdirSync(path.join(repo, 'docs', 'specs'), { recursive: true });
    runInstallAgent(repo);
    const manifest = installManifestLib.readManifest(repo);

    // Every sha in the manifest must match the actual file on disk
    const crypto = require('crypto');
    for (const entry of manifest.files) {
        const absPath = path.join(repo, entry.path);
        if (!fs.existsSync(absPath)) continue;
        const buf = fs.readFileSync(absPath);
        const actual = crypto.createHash('sha256').update(buf).digest('hex');
        assert.strictEqual(actual, entry.sha256, `sha256 mismatch for ${entry.path}`);
    }
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

testAsync('aigon remove --dry-run lists files without deleting', () => withTempDirAsync('aigon-f422-dryrun-', async (repo) => {
    fs.mkdirSync(path.join(repo, 'docs', 'specs'), { recursive: true });
    runInstallAgent(repo);
    const manifest = installManifestLib.readManifest(repo);

    const output = runRemove(repo, ['--dry-run']);
    assert.ok(output.includes('dry-run'), `output should mention dry-run: ${output}`);

    // Files must still exist
    for (const entry of manifest.files) {
        assert.ok(fs.existsSync(path.join(repo, entry.path)), `${entry.path} must still exist after --dry-run`);
    }
    // Manifest must still exist
    assert.ok(installManifestLib.readManifest(repo), 'manifest must still exist after --dry-run');
}));

testAsync('aigon remove removes manifest files, preserves runtime state', () => withTempDirAsync('aigon-f422-remove-', async (repo) => {
    fs.mkdirSync(path.join(repo, 'docs', 'specs'), { recursive: true });
    runInstallAgent(repo);
    const manifest = installManifestLib.readManifest(repo);
    assert.ok(manifest.files.length > 0, 'must have files to remove');

    // Create some runtime state that must NOT be deleted
    const runtimeDirs = ['.aigon/workflows', '.aigon/state', '.aigon/sessions'];
    for (const d of runtimeDirs) {
        fs.mkdirSync(path.join(repo, d), { recursive: true });
        fs.writeFileSync(path.join(repo, d, 'keep.json'), '{}');
    }
    fs.writeFileSync(path.join(repo, '.aigon', 'config.json'), '{}');

    runRemove(repo, ['--force']);

    // Runtime state preserved
    for (const d of runtimeDirs) {
        assert.ok(fs.existsSync(path.join(repo, d, 'keep.json')), `runtime state ${d}/keep.json must be preserved`);
    }
    assert.ok(fs.existsSync(path.join(repo, '.aigon', 'config.json')), '.aigon/config.json must be preserved');

    // Manifest itself should be gone
    assert.strictEqual(installManifestLib.readManifest(repo), null, 'manifest must be deleted after remove');
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

testAsync('migration 2.61.0 is idempotent when manifest already exists', () => withTempDirAsync('aigon-f422-mig-idem-', async (repo) => {
    fs.mkdirSync(path.join(repo, '.aigon'), { recursive: true });
    const existingManifest = installManifestLib.createEmptyManifest('1.0.0');
    installManifestLib.writeManifest(repo, existingManifest);

    await runPendingMigrations(repo);

    const manifest = installManifestLib.readManifest(repo);
    assert.deepStrictEqual(manifest.files, [], 'existing manifest must not be overwritten by migration');
}));

report();
