#!/usr/bin/env node
'use strict';

/**
 * F502 prepublishOnly guard.
 *
 * Re-runs `aigon install-agent --all` against the aigon repo itself, then
 * fails if it produces a non-empty git diff. Catches the case where a
 * maintainer edits a template, runs the lockstep CI test (which passes
 * because the maintainer regenerated the manifest locally), but forgets
 * to commit the regenerated installed copies.
 *
 * The diff check is required because the install path always rewrites
 * `installedAt` timestamps, so we'd otherwise ship a "clean" publish
 * with a freshly-rewritten manifest on every release.
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

console.log('[prepublish] Re-running install-agent --all to verify lockstep...');

// Snapshot the install manifest's content (excluding installedAt-only diffs)
// before reinstall. After reinstall, compare git diff against the manifest
// AND installed file trees.
function gitDiffNames() {
    const out = execSync('git diff --name-only -- .aigon/install-manifest.json .claude/ .cursor/ .gemini/ .agents/ .codex/ .opencode/ .aigon/docs/', {
        cwd: repoRoot,
        encoding: 'utf8',
    });
    return out.trim().split('\n').filter(Boolean);
}

const before = gitDiffNames();

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

const after = gitDiffNames();
const newDirty = after.filter(p => !before.includes(p));

// Manifest-only diffs are always present (installedAt timestamps tick on
// every install). Discount these via a content-only check that ignores
// installedAt fields.
function manifestSemanticDiff() {
    try {
        const headRaw = execSync('git show HEAD:.aigon/install-manifest.json', { cwd: repoRoot, encoding: 'utf8' });
        const diskRaw = require('fs').readFileSync(path.join(repoRoot, '.aigon', 'install-manifest.json'), 'utf8');
        const head = JSON.parse(headRaw);
        const disk = JSON.parse(diskRaw);
        function strip(m) {
            const stripped = {
                version: m.version,
                aigonVersion: m.aigonVersion,
                agents: m.agents,
                files: (m.files || []).map(f => ({
                    path: f.path,
                    sha256: f.sha256,
                    templateSha: f.templateSha,
                    templatePath: f.templatePath,
                })),
            };
            // Strip installedAt timestamps from agentInstalls — they tick on
            // every install. Keep version so a true version drift is caught.
            if (m.agentInstalls) {
                stripped.agentInstalls = Object.fromEntries(
                    Object.entries(m.agentInstalls).map(([k, v]) => [k, { version: v.version }])
                );
            }
            return stripped;
        }
        return JSON.stringify(strip(head)) !== JSON.stringify(strip(disk));
    } catch (_) {
        return false; // can't compare → don't fail on this alone
    }
}

const meaningfulDirty = newDirty.filter(p => {
    if (p === '.aigon/install-manifest.json') return manifestSemanticDiff();
    return true;
});

if (meaningfulDirty.length > 0) {
    console.error('\n[prepublish] ❌ Templates appear to have changed without committing the regenerated install:');
    meaningfulDirty.forEach(p => console.error(`   - ${p}`));
    console.error('\n   Run: aigon install-agent --all && git add ' + meaningfulDirty.join(' '));
    console.error('   Then commit before publishing.');
    process.exit(1);
}

console.log('[prepublish] ✓ install-manifest in lockstep with templates');
process.exit(0);
