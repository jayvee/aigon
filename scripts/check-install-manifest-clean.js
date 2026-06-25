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
const path = require('path');

if (process.env.AIGON_SKIP_PREPUBLISH_INSTALL_CHECK === '1') {
    console.log('[prepublish] Skipping install-manifest check (AIGON_SKIP_PREPUBLISH_INSTALL_CHECK=1)');
    process.exit(0);
}

const repoRoot = path.resolve(__dirname, '..');
const cli = path.join(repoRoot, 'aigon-cli.js');

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

console.log('[prepublish] ✓ installed agent trees in lockstep with templates');
process.exit(0);
