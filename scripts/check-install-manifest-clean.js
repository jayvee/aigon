#!/usr/bin/env node
'use strict';

/**
 * F502 prepublishOnly guard.
 *
 * Re-runs `aigon install-agent --all` against the aigon repo itself, then
 * fails if tracked installed-file trees diverge from what a fresh install
 * produces. Catches the case where a maintainer edits a template but forgets
 * to commit the regenerated installed copies.
 *
 * The install manifest (`.aigon/install-manifest.json`) is derived metadata
 * and is not git-tracked (F589) — lockstep is verified via installed trees
 * only, not `git show HEAD:.aigon/install-manifest.json`.
 *
 * Skip with AIGON_SKIP_PREPUBLISH_INSTALL_CHECK=1 (e.g. for local
 * publish dry-runs that don't intend to commit).
 */

const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const installManifestLib = require('../lib/install-manifest');
const { getAvailableAgents } = require('../lib/templates');
const { getAigonVersion } = require('../lib/version');

if (process.env.AIGON_SKIP_PREPUBLISH_INSTALL_CHECK === '1') {
    console.log('[prepublish] Skipping install-manifest check (AIGON_SKIP_PREPUBLISH_INSTALL_CHECK=1)');
    process.exit(0);
}

const repoRoot = path.resolve(__dirname, '..');
const cli = path.join(repoRoot, 'aigon-cli.js');
const manifestPath = path.join(repoRoot, installManifestLib.MANIFEST_PATH);

const INSTALL_TREE_PATHS = [
    '.claude/',
    '.cursor/',
    '.gemini/',
    '.agents/',
    '.codex/',
    '.opencode/',
    '.aigon/docs/',
].join(' ');

console.log('[prepublish] Re-running install-agent --all to verify lockstep...');

function gitDiffNames() {
    const out = execSync(`git diff --name-only -- ${INSTALL_TREE_PATHS}`, {
        cwd: repoRoot,
        encoding: 'utf8',
    });
    return out.trim().split('\n').filter(Boolean);
}

function gitCachedDiffNames() {
    try {
        const out = execSync(`git diff --cached --name-only -- ${INSTALL_TREE_PATHS}`, {
            cwd: repoRoot,
            encoding: 'utf8',
        });
        return out.trim().split('\n').filter(Boolean);
    } catch (_) {
        return [];
    }
}

function manifestSemanticSnapshot(manifest, { includeTemplateMetadata = true } = {}) {
    if (!manifest) return null;
    const snapshot = {
        version: manifest.version,
        aigonVersion: manifest.aigonVersion,
        agents: Array.isArray(manifest.agents) ? [...manifest.agents].sort() : manifest.agents,
        files: [...(manifest.files || [])].sort((a, b) => String(a.path).localeCompare(String(b.path))).map(f => ({
            path: f.path,
            sha256: f.sha256,
            ...(includeTemplateMetadata ? {
                templateSha: f.templateSha,
                templatePath: f.templatePath,
            } : {}),
        })),
    };
    if (manifest.agentInstalls) {
        snapshot.agentInstalls = Object.fromEntries(
            Object.entries(manifest.agentInstalls)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([agentId, entry]) => [agentId, { version: entry.version }])
        );
    }
    return JSON.stringify(snapshot);
}

function readManifestSemanticSnapshot(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try {
        return manifestSemanticSnapshot(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch (e) {
        return `__INVALID__: ${e.message}`;
    }
}

const before = new Set([...gitDiffNames(), ...gitCachedDiffNames()]);

try {
    execFileSync(process.execPath, [cli, 'install-agent', '--all'], {
        cwd: repoRoot,
        stdio: 'inherit',
        env: { ...process.env, AIGON_NONINTERACTIVE: '1', AIGON_SKIP_TEMPLATE_DRIFT: '1' },
    });
} catch (e) {
    console.error('[prepublish] ❌ install-agent --all failed');
    process.exit(1);
}

const after = new Set([...gitDiffNames(), ...gitCachedDiffNames()]);
const newDirty = [...after].filter(p => !before.has(p));

if (newDirty.length > 0) {
    console.error('\n[prepublish] ❌ Templates appear to have changed without committing the regenerated install:');
    newDirty.forEach(p => console.error(`   - ${p}`));
    console.error('\n   Run: aigon install-agent --all && git add ' + newDirty.join(' '));
    console.error('   Then commit before publishing.');
    process.exit(1);
}

const currentVersion = getAigonVersion() || 'unknown';
const expectedManifestObject = installManifestLib.synthesizeManifestFromDisk(repoRoot, currentVersion);
expectedManifestObject.agents = getAvailableAgents();
expectedManifestObject.agentInstalls = Object.fromEntries(
    expectedManifestObject.agents.map(agentId => [agentId, { version: currentVersion }])
);
const actualManifest = readManifestSemanticSnapshot(manifestPath);

if (actualManifest === null || actualManifest.startsWith('__INVALID__:')) {
    console.error('\n[prepublish] ❌ install-manifest.json is out of sync with the freshly installed trees.');
    if (actualManifest === null) {
        console.error(`   Missing manifest: ${path.relative(repoRoot, manifestPath)}`);
    } else {
        console.error(`   Invalid manifest JSON: ${actualManifest.slice('__INVALID__: '.length)}`);
    }
    console.error('   Re-run: aigon install-agent --all');
    process.exit(1);
}

const expectedManifest = manifestSemanticSnapshot(expectedManifestObject, { includeTemplateMetadata: false });
const actualCoreManifest = manifestSemanticSnapshot(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), { includeTemplateMetadata: false });

if (actualCoreManifest !== expectedManifest) {
    console.error('\n[prepublish] ❌ install-manifest.json is out of sync with the freshly installed trees.');
    console.error('   Re-run: aigon install-agent --all');
    process.exit(1);
}

console.log('[prepublish] ✓ installed agent trees in lockstep with templates');
process.exit(0);
