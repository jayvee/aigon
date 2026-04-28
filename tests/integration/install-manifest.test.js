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

function runUninstall(repo, extraArgs = []) {
    return execFileSync(process.execPath, [CLI, 'uninstall', ...extraArgs], {
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

testAsync('install-agent proceeds and overwrites modified file in non-interactive mode', () => withTempDirAsync('aigon-f422-warn-modified-', async (repo) => {
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

    // Re-run — AIGON_NONINTERACTIVE=1 skips the prompt and proceeds
    const result = spawnSync(process.execPath, [CLI, 'install-agent', 'cc'], {
        cwd: repo,
        env: { ...process.env, ...GIT_SAFE_ENV, HOME: repo, USERPROFILE: repo, AIGON_NONINTERACTIVE: '1' },
        encoding: 'utf8',
    });
    const combined = (result.stdout || '') + (result.stderr || '');
    // Warning must appear in stderr/stdout
    assert.ok(
        combined.includes('modified outside install'),
        `output must warn about modified files: ${combined}`
    );
    // Install must complete (manifest must exist)
    assert.ok(installManifestLib.readManifest(repo), 'manifest must exist after re-install');
}));

testAsync('aigon uninstall --dry-run lists files without deleting', () => withTempDirAsync('aigon-f422-dryrun-', async (repo) => {
    fs.mkdirSync(path.join(repo, 'docs', 'specs'), { recursive: true });
    runInstallAgent(repo);
    const manifest = installManifestLib.readManifest(repo);

    const output = runUninstall(repo, ['--dry-run']);
    assert.ok(output.includes('dry-run'), `output should mention dry-run: ${output}`);

    // Files must still exist
    for (const entry of manifest.files) {
        assert.ok(fs.existsSync(path.join(repo, entry.path)), `${entry.path} must still exist after --dry-run`);
    }
    // Manifest must still exist
    assert.ok(installManifestLib.readManifest(repo), 'manifest must still exist after --dry-run');
}));

testAsync('aigon uninstall removes manifest files, preserves runtime state', () => withTempDirAsync('aigon-f422-uninstall-', async (repo) => {
    fs.mkdirSync(path.join(repo, 'docs', 'specs'), { recursive: true });
    runInstallAgent(repo);
    const manifest = installManifestLib.readManifest(repo);
    assert.ok(manifest.files.length > 0, 'must have files to uninstall');

    // Create some runtime state that must NOT be deleted
    const runtimeDirs = ['.aigon/workflows', '.aigon/state', '.aigon/sessions'];
    for (const d of runtimeDirs) {
        fs.mkdirSync(path.join(repo, d), { recursive: true });
        fs.writeFileSync(path.join(repo, d, 'keep.json'), '{}');
    }
    fs.writeFileSync(path.join(repo, '.aigon', 'config.json'), '{}');

    runUninstall(repo, ['--force']);

    // Runtime state preserved
    for (const d of runtimeDirs) {
        assert.ok(fs.existsSync(path.join(repo, d, 'keep.json')), `runtime state ${d}/keep.json must be preserved`);
    }
    assert.ok(fs.existsSync(path.join(repo, '.aigon', 'config.json')), '.aigon/config.json must be preserved');

    // Manifest itself should be gone
    assert.strictEqual(installManifestLib.readManifest(repo), null, 'manifest must be deleted after uninstall');
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
