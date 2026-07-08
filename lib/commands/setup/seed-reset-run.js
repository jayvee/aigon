'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');
const {
    rebuildSeedFeatureManifests,
    validateSeedProvisionCommits,
    collectSeedResetRemoteUrls,
    cleanupSeedResetRemoteBranches,
    closeSeedResetOpenPullRequests,
    stripSeedResetStaleConfigKeys,
    applySeedStateFixtures,
} = require('./seed-reset');
const { SEED_REGISTRY, WORKING_REPO_REGISTRY } = require('./seed-registry');
const { ensureLocalGitExclude, getStandardLocalGitExcludeEntries, gitAddPathsFromPorcelain } = require('./gitignore-and-hooks');
const { listRepoRelatedPids, killPidsHard } = require('./pid-utils');
const { findEntitiesMissingWorkflowState, bootstrapMissingWorkflowSnapshots } = require('./agent-trust');

module.exports = function seedResetRunCommand(ctx, getCommand) {
    const u = ctx.utils;
    const { getAvailableAgents } = u;
    const { getAigonVersion, setInstalledVersion } = ctx.version;

    return async (args) => {const os = require('os');

const repoArg = args.find(a => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
if (!repoArg) {
    console.error('Usage: aigon seed-reset <repo-path> [--dry-run] [--force]');
    console.error('\nWipes a seed repo and re-clones it from the canonical seed.');
    console.error('Three phases: Nuke → Clone → Provision.');
    console.error(`\nKnown seeds: ${Object.keys(SEED_REGISTRY).join(', ')}`);
    console.error('\nExamples:');
    console.error('  aigon seed-reset brewboard            # resolves to $HOME/src/brewboard');
    console.error('  aigon seed-reset /path/to/brewboard');
    console.error('  aigon seed-reset trailhead --dry-run');
    console.error('  aigon seed-reset brewboard --force    # skip confirmation');
    return;
}

// --- Resolve paths ---
const isBareSeedName =
    Object.prototype.hasOwnProperty.call(SEED_REGISTRY, repoArg) &&
    !repoArg.includes(path.sep) &&
    !repoArg.startsWith('~') &&
    !repoArg.startsWith('.');
const canonicalRepoArg = isBareSeedName
    ? path.join(process.env.HOME || os.homedir(), 'src', repoArg)
    : repoArg;
const repoPath = path.resolve(canonicalRepoArg.replace(/^~/, process.env.HOME));
const repoName = path.basename(repoPath);
const parentDir = path.dirname(repoPath);
const worktreeDir = path.join(os.homedir(), '.aigon', 'worktrees', repoName);
const legacyWorktreeDir = `${repoPath}-worktrees`;

const seedUrl = SEED_REGISTRY[repoName];
const workingRepoUrl = WORKING_REPO_REGISTRY[repoName];
if (!seedUrl) {
    console.error(`❌ Unknown seed repo: ${repoName}`);
    console.error(`   Known seeds: ${Object.keys(SEED_REGISTRY).join(', ')}`);
    return;
}

// --- Gather inventory (always runs — needed for dry-run and plan display) ---

function gatherInventory() {
    const inv = {
        tmuxSessions: [],
        worktreePaths: [],
        repoExists: fs.existsSync(repoPath),
        worktreeDirExists: fs.existsSync(worktreeDir),
        legacyWorktreeDirExists: fs.existsSync(legacyWorktreeDir),
        remoteUrls: [],
    };

    // Tmux sessions matching "<repoName>-*"
    try {
        const tmuxList = spawnSync('tmux', ['list-sessions', '-F', '#S'], { encoding: 'utf8' });
        if (!tmuxList.error && tmuxList.status === 0) {
            inv.tmuxSessions = tmuxList.stdout.split('\n').map(s => s.trim()).filter(s =>
                s.toLowerCase().startsWith(repoName.toLowerCase() + '-')
            );
        }
    } catch (_) { /* tmux not installed or no server */ }

    // Git worktrees (only if repo exists and is a git repo)
    if (inv.repoExists && fs.existsSync(path.join(repoPath, '.git'))) {
        try {
            const wtOutput = execSync('git worktree list --porcelain', { cwd: repoPath, encoding: 'utf8' });
            inv.worktreePaths = wtOutput.split('\n\n')
                .filter(block => block.includes('worktree '))
                .map(block => block.match(/^worktree (.+)$/m)?.[1])
                .filter(p => p && p !== repoPath);
        } catch (_) { /* ignore — repo may be in broken state */ }
    }

    inv.remoteUrls = collectSeedResetRemoteUrls({
        repoName,
        seedUrl,
        repoPath,
        repoExists: inv.repoExists,
    });

    return inv;
}

// --- Print plan ---

function printPlan(inv) {
    console.log(`\n🔄 Resetting ${repoName} from seed: ${seedUrl}\n`);
    console.log('   Plan:');
    if (inv.tmuxSessions.length)  console.log(`   [nuke]      Kill ${inv.tmuxSessions.length} tmux session(s): ${inv.tmuxSessions.join(', ')}`);
                                  console.log(`   [nuke]      Kill agent/dev-server processes for ${repoName}`);
    if (inv.worktreePaths.length)  console.log(`   [nuke]      Remove Claude trust/permissions for ${inv.worktreePaths.length} worktree(s)`);
                                  console.log(`   [nuke]      GC stale dev-proxy entries`);
    if (inv.repoExists)           console.log(`   [nuke]      rm -rf ${repoPath}`);
    if (inv.worktreeDirExists)    console.log(`   [nuke]      rm -rf ${worktreeDir}`);
    if (inv.legacyWorktreeDirExists) console.log(`   [nuke]      rm -rf ${legacyWorktreeDir} (legacy)`);
                                  console.log(`   [nuke]      Remove Gemini session dirs for this repo`);
    if (workingRepoUrl)           console.log(`   [nuke]      Close open PRs on ${workingRepoUrl} for feature/research branches`);
    if (inv.remoteUrls.length)    console.log(`   [nuke]      Delete remote feature/research branches`);
    console.log(`   [clone]     git clone ${seedUrl} ${repoPath}`);
    if (workingRepoUrl)           console.log(`   [clone]     git remote set-url origin ${workingRepoUrl}`);
    console.log(`   [provision] aigon apply`);
    console.log(`   [provision] aigon install-agent (all available agents)`);
                                  console.log(`   [provision] npm install (warm cache for worktrees)`);
                                  console.log(`   [provision] git commit (so worktrees inherit templates)`);
    if (workingRepoUrl)           console.log(`   [provision] git push --force origin HEAD:main`);
                                  console.log(`   [provision] git push --force ${seedUrl} HEAD:main (keep seed current)`);
                                  console.log(`   [provision] Ensure local git exclude for runtime files`);
    console.log('');
}

// --- Phase 1: NUKE — kill sessions, remove dirs ---
// Every step is individually wrapped. Non-critical failures log warnings and continue.

function nukePhase(inv) {
    console.log('🔥 Phase 1: Nuke\n');

    // 1a. Kill tmux sessions
    inv.tmuxSessions.forEach(sessionName => {
        try {
            spawnSync('tmux', ['kill-session', '-t', sessionName], { stdio: 'ignore' });
            console.log(`   ✓ Killed tmux: ${sessionName}`);
        } catch (_) {
            console.log(`   ⚠️  Could not kill tmux session: ${sessionName}`);
        }
    });

    // 1b. Kill agent processes (aigon commands, dev-servers referencing this repo)
    const agentPatterns = [
        `aigon:feature-do.*${repoName}`,
        `aigon:research-do.*${repoName}`,
        `aigon:feature-code-review.*${repoName}`,
        `aigon:feature-review.*${repoName}`,
    ];
    agentPatterns.forEach(pattern => {
        try { spawnSync('pkill', ['-f', pattern], { stdio: 'ignore' }); } catch (_) { /* ok */ } // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
    });

    // 1c. Kill straggler processes with cwd under repo or worktree dirs.
    // Detached shells, dev servers, and agent child processes may survive tmux shutdown.
    [repoPath, worktreeDir, legacyWorktreeDir, `${repoName}-worktrees`].forEach(pattern => {
        try {
            spawnSync('pkill', ['-f', String(pattern)], { stdio: 'ignore' }); // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
        } catch (_) { /* ok */ }
    });
    console.log(`   ✓ Killed agent/straggler processes`);

    // 1d. Remove worktree permissions/trust from Claude settings (before wiping dirs)
    if (inv.worktreePaths.length > 0) {
        try {
            const { removeWorktreePermissions, removeWorktreeTrust } = u;
            if (removeWorktreePermissions) removeWorktreePermissions(inv.worktreePaths);
            if (removeWorktreeTrust) removeWorktreeTrust(inv.worktreePaths);
            console.log(`   ✓ Removed Claude trust/permissions for ${inv.worktreePaths.length} worktree(s)`);
        } catch (e) {
            console.log(`   ⚠️  Could not clean Claude settings: ${e.message}`);
        }
    }

    // 1e. GC Caddy routes for dead backends
    try {
        const { gcCaddyRoutes } = u;
        if (gcCaddyRoutes) {
            const removed = gcCaddyRoutes();
            if (removed > 0) console.log(`   ✓ Cleaned ${removed} stale Caddy routes`);
        }
    } catch (_) { /* non-fatal */ }

    // 1f. Close open PRs on the working repo before deleting branches.
    if (workingRepoUrl) {
        try {
            const prResult = closeSeedResetOpenPullRequests({ remoteUrl: workingRepoUrl });
            if (prResult.closed.length > 0) {
                console.log(`   ✓ Closed open PR(s): ${prResult.closed.map(n => `#${n}`).join(', ')}`);
            } else if (prResult.skipped) {
                console.log(`   ⚠️  Skipped PR cleanup (${prResult.skipped})`);
            }
        } catch (e) {
            console.log(`   ⚠️  Could not close open PRs: ${e.message}`);
        }
    }

    // 1g. Delete remote feature/research branches on seed + working remotes.
    try {
        const remoteCleanup = cleanupSeedResetRemoteBranches({
            remoteUrls: inv.remoteUrls,
            repoPath,
            repoExists: inv.repoExists,
        });
        Object.entries(remoteCleanup.deletedByRemote).forEach(([remoteUrl, branchNames]) => {
            if (branchNames.length > 0) {
                console.log(`   ✓ Deleted ${branchNames.length} remote branch(es) on ${remoteUrl}`);
            }
        });
    } catch (e) {
        console.log(`   ⚠️  Could not clean remote branches: ${e.message}`);
    }

    // 1h. Remove directories with retry for ENOTEMPTY / EBUSY
    removeDirectoryRobust(repoPath, 'repo');
    removeDirectoryRobust(worktreeDir, 'worktrees');
    if (inv.legacyWorktreeDirExists) removeDirectoryRobust(legacyWorktreeDir, 'legacy worktrees');

    // 1i. Remove Gemini tmp dirs whose .project_root points into this repo
    try {
        const geminiTmpDir = path.join(os.homedir(), '.gemini', 'tmp');
        if (fs.existsSync(geminiTmpDir)) {
            const pathPrefixes = [repoPath, worktreeDir, legacyWorktreeDir].filter(Boolean);
            let removed = 0;
            for (const entry of fs.readdirSync(geminiTmpDir)) {
                const projectRootFile = path.join(geminiTmpDir, entry, '.project_root');
                if (!fs.existsSync(projectRootFile)) continue;
                const storedPath = fs.readFileSync(projectRootFile, 'utf8').trim();
                if (pathPrefixes.some(prefix => storedPath.startsWith(prefix))) {
                    removeDirectoryRobust(path.join(geminiTmpDir, entry), `gemini/tmp/${entry}`);
                    removed++;
                }
            }
            if (removed > 0) console.log(`   ✓ Removed ${removed} Gemini session dir(s)`);
        }
    } catch (_) { /* non-fatal */ }
}

/**
 * Remove a directory with retries to handle ENOTEMPTY and EBUSY.
 * Processes with open file handles can cause rmSync to fail on first attempt;
 * a brief delay lets the OS release them after we killed processes above.
 */
function removeDirectoryRobust(dirPath, label) {
    if (!fs.existsSync(dirPath)) return;

    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 500;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            fs.rmSync(dirPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
            console.log(`   ✓ Removed ${label}: ${dirPath}`);
            return;
        } catch (e) {
            const isRetryable = e.code === 'ENOTEMPTY' || e.code === 'EBUSY' || e.code === 'EPERM';
            if (isRetryable && attempt < MAX_RETRIES) {
                console.log(`   ⚠️  ${label} removal failed (${e.code}), retrying in ${RETRY_DELAY_MS}ms... (${attempt}/${MAX_RETRIES})`);
                spawnSync('sleep', [String(RETRY_DELAY_MS / 1000)]);
                continue;
            }
            // Last resort: try shell rm -rf which handles some cases fs.rmSync can't
            try {
                spawnSync('rm', ['-rf', dirPath], { stdio: 'ignore' }); // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
                console.log(`   ✓ Removed ${label}: ${dirPath} (via shell fallback)`);
                return;
            } catch (_) {
                console.error(`   ❌ Could not remove ${label}: ${dirPath} — ${e.message}`);
                console.error(`      You may need to manually remove it and re-run seed-reset.`);
            }
        }
    }
}

// --- Phase 2: CLONE — single source of truth from seed repo ---
// This is the only phase that can abort — if clone fails, there's nothing to provision.

// Captured immediately after `git clone` so Phase 3 can verify that the
// provisioned HEAD only differs from the seed by allowlisted provision
// commits before either force-push fires. See validateSeedProvisionCommits.
let seedTipAtClone = null;

function clonePhase() {
    console.log('\n📦 Phase 2: Clone\n');

    // Ensure parent directory exists (handles the case where repo dir was the only
    // thing in a parent that was also removed somehow)
    if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
    }

    try {
        // Guard: nuke any leftover directory so git clone never hits "File exists"
        if (fs.existsSync(repoPath)) {
            fs.rmSync(repoPath, { recursive: true, force: true });
        }
        execSync(`git clone "${seedUrl}" "${repoPath}"`, { cwd: parentDir, stdio: 'pipe' });
        console.log(`   ✓ Cloned from ${seedUrl}`);
        try {
            seedTipAtClone = execSync('git rev-parse HEAD', {
                cwd: repoPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
            }).trim();
        } catch (e) {
            console.log(`   ⚠️  Could not capture seed tip after clone: ${e.message}`);
        }
        if (workingRepoUrl) {
            execSync(`git remote set-url origin "${workingRepoUrl}"`, { cwd: repoPath, stdio: 'pipe' });
            console.log(`   ✓ Repointed origin to ${workingRepoUrl}`);
        } else {
            // No working repo configured — strip origin so the local sandbox
            // can't accidentally push back to the seed (matches install-seed).
            try {
                execSync('git remote remove origin', { cwd: repoPath, stdio: 'pipe' });
                console.log(`   ✓ Removed origin (local sandbox — no push target)`);
            } catch (_) { /* origin may not exist */ }
        }
        return true;
    } catch (e) {
        console.error(`   ❌ Clone failed: ${e.message}`);
        console.error(`   Cannot continue without a successful clone.`);
        return false;
    }
}

// --- Phase 3: PROVISION — install agents, rebuild state, commit ---
// Every step is non-fatal. A partial provision is better than no provision.

async function provisionPhase() {
    console.log('\n🔧 Phase 3: Provision\n');

    const savedCwd = process.cwd();
    try {
        process.chdir(repoPath);
    } catch (e) {
        console.error(`   ❌ Could not chdir to ${repoPath}: ${e.message}`);
        return;
    }

    try {
        // 3a. Run aigon apply to bootstrap workflow-core events and .aigon/ structure
        try {
            await getCommand('apply')([]);
            console.log(`   ✓ Aigon initialized`);
        } catch (e) {
            console.log(`   ⚠️  aigon apply failed: ${e.message}`);
        }

        // 3b. Rebuild manifests from spec folders (manifests are gitignored state)
        try {
            const manifests = rebuildSeedFeatureManifests(repoPath, { collapseActiveToBacklog: true });
            console.log(`   ✓ Rebuilt ${manifests.length} feature manifest(s)`);
            // Bootstrap workflow-core snapshots so features don't show as "legacy" on the board
            const { features: missingF, research: missingR } = findEntitiesMissingWorkflowState(repoPath);
            const bootstrapped = bootstrapMissingWorkflowSnapshots(repoPath, missingF, 'feature')
                + bootstrapMissingWorkflowSnapshots(repoPath, missingR, 'research');
            if (bootstrapped > 0) {
                console.log(`   ✓ Bootstrapped workflow state for ${bootstrapped} entit${bootstrapped === 1 ? 'y' : 'ies'}`);
            }
            // Apply seed-state fixtures — advance specific features to their target state
            // (e.g. code_review_in_progress for review bench fixtures)
            const fixtures = applySeedStateFixtures(repoPath);
            if (fixtures > 0) {
                console.log(`   ✓ Applied seed-state fixtures for ${fixtures} feature(s)`);
            }
        } catch (e) {
            console.log(`   ⚠️  Failed to rebuild manifests: ${e.message}`);
        }

        // 3c. Install all available agents
        let cliVersion;
        try {
            const agentsToInstall = getAvailableAgents();
            console.log(`   Installing agents: ${[...agentsToInstall].join(', ')}`);
            await getCommand('install-agent')([...agentsToInstall]);
            cliVersion = getAigonVersion();
            if (cliVersion) setInstalledVersion(cliVersion);
            console.log(`   ✓ Agents installed`);
        } catch (e) {
            console.log(`   ⚠️  Agent install failed: ${e.message}`);
        }

        // 3d. Pre-install dependencies to warm the npm/package manager cache
        //     so worktree installs pull from local cache and are much faster.
        //     node_modules is gitignored so this does not affect the commit.
        try {
            const pkgJson = path.join(repoPath, 'package.json');
            if (fs.existsSync(pkgJson)) {
                const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
                const hasDeps = pkg.dependencies || pkg.devDependencies;
                if (hasDeps) {
                    const npmResult = spawnSync('npm', ['install', '--prefer-offline'], {
                        cwd: repoPath,
                        stdio: 'pipe',
                        timeout: 120000,
                    });
                    if (npmResult.status === 0) {
                        console.log(`   ✓ Dependencies pre-installed (npm cache warmed)`);
                    } else {
                        console.log(`   ⚠️  npm install failed (worktrees will install from registry)`);
                    }
                }
            }
        } catch (e) {
            console.log(`   ⚠️  Dependency pre-install skipped: ${e.message}`);
        }

        // 3e. Ensure local runtime files stay ignored via git exclude
        // (uses local exclude instead of modifying .gitignore to avoid creating commits
        //  for gitignore changes in a "reset to clean state" operation)
        try {
            const localExclude = ensureLocalGitExclude(repoPath, getStandardLocalGitExcludeEntries(repoPath));
            if (localExclude.addedEntries.length > 0) {
                console.log(`   ✓ Updated local git exclude`);
            }
        } catch (e) {
            console.log(`   ⚠️  Could not update local git exclude: ${e.message}`);
        }

        // 3e. Auto-commit so worktrees inherit current templates
        try {
            const statusOut = execSync('git status --porcelain', { cwd: repoPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            const hasChanges = statusOut.trim().length > 0;
            if (!hasChanges) throw new Error('nothing to commit');
            if (!gitAddPathsFromPorcelain(repoPath, statusOut)) throw new Error('nothing to commit');
            execSync(
                `git commit -m "chore: install Aigon v${cliVersion || 'latest'}"`,
                { cwd: repoPath, stdio: 'pipe' }
            );
            console.log(`   ✓ Committed agent install (v${cliVersion || 'latest'})`);
        } catch (_) {
            // Nothing to commit (seed already had current artifacts) — that's fine
        }

        // 3f. Strip stale config keys from the freshly provisioned repo baseline.
        try {
            const removed = stripSeedResetStaleConfigKeys(path.join(repoPath, '.aigon', 'config.json'), ['pro']);
            if (removed.length > 0) {
                execSync('git add .aigon/config.json', { cwd: repoPath, stdio: 'pipe' });
                execSync(
                    `git commit -m "chore: strip stale seed config"`,
                    { cwd: repoPath, stdio: 'pipe' }
                );
                console.log(`   ✓ Removed stale config key(s): ${removed.join(', ')}`);
            }
        } catch (e) {
            console.log(`   ⚠️  Could not strip stale config: ${e.message}`);
        }

        // 3g + 3h. Validate, then force-push the provisioned baseline.
        //
        // The push-back to seedUrl is what cements contamination if HEAD contains
        // anything beyond allowlisted provision commits — every subsequent reset
        // would clone the contaminated seed and re-push it. Gate BOTH pushes on
        // the same validation so the working remote stays in lockstep with the
        // seed: either both get the clean baseline or neither runs and the user
        // gets a loud diagnostic.
        if (workingRepoUrl) {
            const guard = validateSeedProvisionCommits({ repoPath, seedTipAtClone });
            if (!guard.ok) {
                console.log(`   ⛔ ABORTING force-push — HEAD contains commit(s) outside the provision allowlist:`);
                if (guard.error) {
                    console.log(`      ${guard.error}`);
                }
                guard.rogue.forEach(line => console.log(`      ${line}`));
                console.log(`      Neither origin nor ${seedUrl} will be force-pushed.`);
                console.log(`      This protects the seed from being permanently contaminated by`);
                console.log(`      feature merges that leaked into the cloned baseline. To recover:`);
                console.log(`        1. Inspect the rogue commit(s) above`);
                console.log(`        2. Strip them from the seed (commit the deletion, push to seed)`);
                console.log(`        3. Re-run aigon seed-reset ${repoName} --force`);
            } else {
                try {
                    execSync('git push --force origin HEAD:main', { cwd: repoPath, stdio: 'pipe' });
                    execSync('git fetch origin', { cwd: repoPath, stdio: 'pipe' });
                    const localHead = execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
                    const remoteHead = execSync('git rev-parse origin/main', { cwd: repoPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
                    if (localHead !== remoteHead) {
                        throw new Error(`HEAD ${localHead} != origin/main ${remoteHead}`);
                    }
                    console.log(`   ✓ Forced working remote baseline to ${localHead}`);
                } catch (e) {
                    console.log(`   ⚠️  Could not push working remote baseline: ${e.message}`);
                }
                try {
                    execSync(`git push --force ${JSON.stringify(seedUrl)} HEAD:main`, { cwd: repoPath, stdio: 'pipe' });
                    console.log(`   ✓ Updated seed repo with provisioned baseline`);
                } catch (e) {
                    console.log(`   ⚠️  Could not update seed repo: ${e.message}`);
                }
            }
        }
    } finally {
        // Always restore cwd, even if provision partially failed
        try { process.chdir(savedCwd); } catch (_) { /* best effort */ }
    }
}

// --- Execute ---

const inventory = gatherInventory();
printPlan(inventory);

if (dryRun) {
    console.log('🔍 Dry run complete — no changes made.');
    return;
}

if (!force) {
    console.error('⚠️  This will destroy all work in the repo. Run with --force to confirm.');
    return;
}

nukePhase(inventory);

const cloneOk = clonePhase();
if (!cloneOk) return;

await provisionPhase();

console.log(`\n✅ ${repoName} reset from seed.`);
    };
};
