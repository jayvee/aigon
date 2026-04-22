'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const telemetry = require('./telemetry');
const agentRegistry = require('./agent-registry');
const entity = require('./entity');
const { refreshFeatureDependencyGraphs } = require('./feature-dependencies');
const { buildActionContext, assertActionAllowed } = require('./action-scope');
const { runSecurityScan } = require('./security');
const wf = require('./workflow-core');
const { writeStats, readStats } = require('./feature-status');

function parseGitStatusPaths(statusText) {
    return String(statusText || '')
        .split('\n')
        .map(line => line.trimEnd())
        .filter(Boolean)
        .map(line => {
            const match = line.match(/^[ MADRCU?!]{1,2}\s+(.*)$/);
            return match ? match[1] : line;
        })
        .filter(Boolean)
        .map(file => file.includes(' -> ') ? file.split(' -> ')[1] : file);
}

function stageExplicitGitPaths(runGit, statusText, cwd = null) {
    const files = parseGitStatusPaths(statusText);
    if (files.length === 0) return;
    const prefix = cwd ? `git -C "${cwd}" add -- ` : 'git add -- ';
    runGit(`${prefix}${files.map(file => JSON.stringify(file)).join(' ')}`);
}

function stageExplicitWorktreePaths(worktreePath, statusText) {
    const files = parseGitStatusPaths(statusText);
    if (files.length === 0) return;
    execSync(`git -C "${worktreePath}" add -- ${files.map(file => JSON.stringify(file)).join(' ')}`, { encoding: 'utf8' });
}

// ---------------------------------------------------------------------------
// feature-close helpers — each function is one phase of the close flow.
// The main handler in feature.js orchestrates these in sequence.
// ---------------------------------------------------------------------------

/**
 * When the expected branch doesn't exist, try to auto-detect a worktree branch.
 */
function detectBranchOrWorktree(num, desc, agentId, branchName, { branchExists, findWorktrees, filterByFeatureId }) {
    if (agentId) {
        return { ok: false, error: `❌ Branch not found: ${branchName}\n   Did you mean: aigon feature-close ${num}?\n   Looking for: feature-${num}-${desc}` };
    }
    let featureWorktrees = [];
    try {
        featureWorktrees = filterByFeatureId(findWorktrees(), num).map(wt => ({ path: wt.path, agent: wt.agent }));
    } catch (_) {}

    if (featureWorktrees.length === 1) {
        const detectedAgent = featureWorktrees[0].agent;
        const detected = `feature-${num}-${detectedAgent}-${desc}`;
        console.log(`🔍 Auto-detected Drive worktree (agent: ${detectedAgent})`);
        if (!branchExists(detected)) return { ok: false, error: `❌ Branch not found: ${detected}` };
        return { ok: true, branchName: detected, worktreePath: featureWorktrees[0].path, mode: 'multi-agent' };
    }
    if (featureWorktrees.length > 1) {
        const lines = featureWorktrees.map(wt => `   aigon feature-close ${num} ${wt.agent}`).join('\n');
        return { ok: false, error: `❌ Branch not found: feature-${num}-${desc}\n   Multiple worktrees found for feature ${num}. Specify the agent:\n${lines}` };
    }
    return { ok: false, error: `❌ Branch not found: feature-${num}-${desc}\n   Run 'aigon feature-start ${num}' first.` };
}

/**
 * Parse args, resolve spec, detect mode, build hook context.
 * Returns { ok, error, ...target } or { ok: false, error }.
 */
function resolveCloseTarget(args, { PATHS, findFile, getWorktreeBase, findWorktrees, filterByFeatureId, branchExists, resolveFeatureSpecInfo, gitLib, actionName = 'feature-close' }) {
    const requestedFeatureId = args[0];

    // Action-scope check (delegation to main repo if in worktree)
    const actionCtx = buildActionContext(gitLib);
    try {
        const result = assertActionAllowed(actionName, actionCtx, { featureId: requestedFeatureId });
        if (result && result.delegate) {
            return { ok: false, delegate: result.delegate, args };
        }
    } catch (e) {
        return { ok: false, error: e.message };
    }

    const keepBranch = args.includes('--keep-branch');

    // Parse --adopt flag
    let adoptAgents = [];
    const adoptIdx = args.indexOf('--adopt');
    if (adoptIdx !== -1) {
        for (let i = adoptIdx + 1; i < args.length; i++) {
            if (args[i].startsWith('--')) break;
            adoptAgents.push(args[i].toLowerCase());
        }
        if (adoptAgents.length === 0) {
            return { ok: false, error: "Usage: --adopt requires at least one agent code or 'all'\n  Example: aigon feature-close 12 cx --adopt cc cu" };
        }
    }

    // Positional args
    const positionalArgs = [];
    for (const a of args) {
        if (a.startsWith('--')) break;
        positionalArgs.push(a);
    }
    const name = positionalArgs[0];
    const agentId = positionalArgs[1];
    if (!name) {
        return { ok: false, error: "Usage: aigon feature-close <ID> [agent] [--adopt <agents...|all>] [--keep-branch]\n  Without agent: Drive mode (merges feature-ID-desc)\n  With agent: Fleet mode (merges feature-ID-agent-desc, cleans up worktree)\n  --adopt: print diffs from losing agents for selective adoption (Fleet only)\n  --keep-branch: Don't delete the local branch after merge" };
    }

    if (adoptAgents.length > 0 && !agentId) {
        return { ok: false, error: "❌ --adopt is only available in Fleet (multi-agent) mode.\n   Usage: aigon feature-close <ID> <winning-agent> --adopt <agents...|all>" };
    }

    // Resolve spec
    const closeSpec = resolveFeatureSpecInfo(process.cwd(), String(name).padStart(2, '0'), gitLib);
    const found = closeSpec.path
        ? { file: path.basename(closeSpec.path), fullPath: closeSpec.path, folder: closeSpec.stage }
        : null;
    if (!found) return { ok: false, error: `❌ Could not resolve visible spec for feature "${name}".` };

    const match = found.file.match(/^feature-(\d+)-(.*)\.md$/);
    if (!match) return { ok: false, error: "⚠️  Bad filename. Cannot parse ID." };
    const [_, num, desc] = match;

    // Determine mode and branch
    let branchName, worktreePath, mode;
    if (agentId) {
        branchName = `feature-${num}-${agentId}-${desc}`;
        const wtDir = `feature-${num}-${agentId}-${desc}`;
        worktreePath = path.join(getWorktreeBase(), wtDir);
        mode = 'multi-agent';
    } else {
        // feature 240: prefer an existing worktree branch over the drive-style
        // `feature-<num>-<desc>`. A stale drive branch created by an earlier
        // bare `feature-start <id>` call must never silently win when the real
        // implementation lives on a worktree branch.
        let featureWorktrees = [];
        try {
            featureWorktrees = filterByFeatureId(findWorktrees(), num).map(wt => ({ path: wt.path, agent: wt.agent }));
        } catch (_) { /* ignore */ }

        if (featureWorktrees.length === 1) {
            const wt = featureWorktrees[0];
            const wtBranch = `feature-${num}-${wt.agent}-${desc}`;
            if (branchExists(wtBranch)) {
                if (branchExists(`feature-${num}-${desc}`)) {
                    console.log(`⚠️  Stale drive-style branch detected: feature-${num}-${desc}`);
                    console.log(`   Closing the worktree branch instead: ${wtBranch}`);
                    console.log(`   After close succeeds, remove the stale branch: git branch -D feature-${num}-${desc}`);
                }
                branchName = wtBranch;
                worktreePath = wt.path;
                mode = 'multi-agent';
            } else {
                branchName = `feature-${num}-${desc}`;
                worktreePath = null;
                mode = 'drive';
            }
        } else if (featureWorktrees.length > 1) {
            // Multiple worktrees: require an explicit agent arg.
            return {
                ok: false,
                error: `❌ Multiple worktrees found for feature ${num}. Specify the agent:\n${featureWorktrees.map(wt => `   aigon feature-close ${num} ${wt.agent}`).join('\n')}`,
            };
        } else {
            branchName = `feature-${num}-${desc}`;
            worktreePath = null;
            mode = 'drive';
        }
    }

    // Check branch exists, auto-detect worktree if needed
    if (!branchExists(branchName)) {
        const detected = detectBranchOrWorktree(num, desc, agentId, branchName, { branchExists, findWorktrees, filterByFeatureId });
        if (!detected.ok) return detected;
        branchName = detected.branchName;
        worktreePath = detected.worktreePath;
        mode = detected.mode;
    }

    return {
        ok: true,
        name, num, desc, agentId, mode, branchName, worktreePath,
        keepBranch, adoptAgents, specPath: found.fullPath, specFolder: found.folder,
        hookContext: { featureId: num, featureName: desc, agent: agentId || '', adoptAgents },
        repoPath: process.cwd(),
        rawArgs: args,
    };
}

/**
 * Auto-commit uncommitted changes on drive branch or in worktree, then push.
 */
function autoCommitAndPush(target, { getCurrentBranch, runGit, getGitStatusPorcelain, getWorktreeStatus }) {
    const { num, mode, branchName, worktreePath } = target;

    // Drive mode: auto-commit on feature branch
    if (mode === 'drive') {
        const currentBranch = getCurrentBranch();
        if (currentBranch === branchName) {
            const uncommitted = getGitStatusPorcelain ? getGitStatusPorcelain() : null;
            if (uncommitted) {
                console.log(`\n📦 Uncommitted changes detected on ${branchName} — auto-committing before close...`);
                try {
                    stageExplicitGitPaths(runGit, uncommitted);
                    runGit(`git commit -m "feat: implementation for feature ${num}"`);
                    console.log(`✅ Auto-committed implementation changes`);
                } catch (e) {
                    return { ok: false, error: `❌ Auto-commit failed. Please commit your changes manually before closing.` };
                }
            }
        }
    }

    // Worktree mode: auto-commit
    if (worktreePath && fs.existsSync(worktreePath)) {
        const wtStatus = getWorktreeStatus(worktreePath);
        if (wtStatus) {
            console.log(`\n📦 Worktree has uncommitted changes — auto-committing before close...`);
            try {
                stageExplicitWorktreePaths(worktreePath, wtStatus);
                execSync(`git -C "${worktreePath}" commit -m "feat: implementation for feature ${num}"`, { encoding: 'utf8' }); // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
                console.log(`✅ Auto-committed worktree changes`);
            } catch (e) {
                return { ok: false, error: `❌ Auto-commit failed: ${e.message}\n   Commit manually: cd "${worktreePath}" && git add -- <files> && git commit -m "feat: implementation for feature ${num}"\n   Then re-run: aigon feature-close ${num}${target.agentId ? ' ' + target.agentId : ''}` };
            }
        }
    }

    // Push branch to origin
    try {
        const hasOrigin = (() => { try { execSync('git remote get-url origin', { stdio: 'pipe' }); return true; } catch { return false; } })();
        if (hasOrigin) {
            runGit(`git push -u origin ${branchName}`);
            console.log(`📤 Pushed branch to origin: ${branchName}`);
        }
    } catch (e) {
        console.warn(`⚠️  Could not push to origin (continuing anyway): ${e.message || 'push failed'}`);
    }

    return { ok: true };
}

/**
 * Some workflow writes can land after the earlier auto-commit phase in drive
 * mode. Commit one last time before leaving the feature branch so checkout
 * does not abort on generated workflow files.
 */
function flushDriveBranchChanges(target, { getCurrentBranch, runGit, getGitStatusPorcelain }) {
    const { num, mode, branchName } = target;
    if (mode !== 'drive') return { ok: true };
    if (!getCurrentBranch || !runGit || !getGitStatusPorcelain) return { ok: true };
    if (getCurrentBranch() !== branchName) return { ok: true };

    const uncommitted = getGitStatusPorcelain();
    if (!uncommitted) return { ok: true };

    console.log(`\n📦 Finalising generated changes on ${branchName} before merge...`);
    try {
        stageExplicitGitPaths(runGit, uncommitted);
        runGit(`git commit -m "feat: implementation for feature ${num}"`);
        console.log('✅ Captured late workflow changes before merge');
        return { ok: true };
    } catch (_) {
        return { ok: false, error: '❌ Auto-commit failed. Please commit your changes manually before closing.' };
    }
}

/**
 * Resolve the working directory the merge-gate security scan should run in.
 * Feature 245: the scan must evaluate the branch being merged, not whichever
 * branch happens to be checked out in the caller's cwd. For worktree-backed
 * closes this is the target worktree path; for plain Drive branch closes the
 * user is expected to be on the feature branch already so we fall back to cwd.
 * If a fleet close resolved a branch but its worktree is missing, fail closed
 * instead of scanning unrelated local state.
 */
function resolveScanCwd(target, cwd, fileExists = fs.existsSync) {
    const wt = target && target.worktreePath;
    if (!wt) return { cwd };
    if (fileExists(wt)) return { cwd: wt };
    return {
        error: `❌ Target worktree not found for ${target.branchName}: ${wt}\n` +
            `   Restore the worktree or run from a checkout of ${target.branchName} so the security scan can inspect the correct branch.`,
    };
}

function runMergeGit(command) {
    console.log(`Running git: ${command}`);
    const result = spawnSync('sh', ['-c', command], { encoding: 'utf8' });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.status === 0) return;
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
    console.error('❌ Git command failed.');
    throw new Error(output || `git merge exited with code ${result.status}`);
}

/**
 * Security scan, switch to default branch, reset settings, stash, merge, pop stash.
 * Returns { ok, preMergeBaseRef } or { ok: false, error }.
 */
function mergeFeatureBranch(target, {
    getDefaultBranch,
    runGit,
    getCurrentBranch,
    getGitStatusPorcelain,
    runSecurityScan: runScan = runSecurityScan
}) {
    const { branchName, agentId, num } = target;

    const flushResult = flushDriveBranchChanges(target, { getCurrentBranch, runGit, getGitStatusPorcelain });
    if (!flushResult.ok) {
        return flushResult;
    }

    // Security scan — run against the branch/worktree actually being merged.
    const scanTarget = resolveScanCwd(target, process.cwd());
    if (scanTarget.error) {
        return { ok: false, error: scanTarget.error };
    }
    const scanCwd = scanTarget.cwd;
    if (scanCwd !== process.cwd()) {
        console.log(`🔍 Scanning target: ${scanCwd} (${branchName})`);
    }
    const scanResult = runScan('featureClose', { cwd: scanCwd });
    if (!scanResult.passed) {
        return { ok: false, error: `🔒 feature-close aborted due to security scan failure.` };
    }

    const defaultBranch = getDefaultBranch();

    // Capture pre-merge base ref for git signals
    let preMergeBaseRef = defaultBranch;
    try {
        preMergeBaseRef = execSync(`git rev-parse ${defaultBranch}`, { encoding: 'utf8' }).trim() || defaultBranch; // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
    } catch (_) {}

    // Switch to default branch
    try {
        runGit(`git checkout ${defaultBranch}`);
        console.log(`🌿 Switched to ${defaultBranch}`);
    } catch (e) {
        return { ok: false, error: `❌ Failed to switch to ${defaultBranch}. Are you in the main repository?` };
    }

    // Reset agent settings files before merge
    const settingsFilesToReset = ['.claude/settings.json', '.gemini/settings.json'];
    for (const sf of settingsFilesToReset) {
        try { execSync(`git checkout HEAD -- "${sf}"`, { stdio: 'pipe' }); } catch (_) {}
    }

    // Stash remaining dirty files
    let didStash = false;
    try {
        const dirtyStatus = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
        if (dirtyStatus) {
            execSync('git stash push -m "aigon-feature-close-auto-stash"', { encoding: 'utf8', stdio: 'pipe' });
            didStash = true;
            console.log(`📦 Stashed uncommitted changes on ${defaultBranch} before merge`);
        }
    } catch (_) {}

    // Merge
    const mergeMsg = agentId ? `Merge feature ${num} from agent ${agentId}` : `Merge feature ${num}`;
    try {
        runMergeGit(`git merge --no-ff ${branchName} -m "${mergeMsg}"`);
        console.log(`✅ Merged branch: ${branchName}`);
    } catch (e) {
        // Retry if untracked files block the merge
        const overwrittenMatch = (e.message || '').match(/error: The following untracked working tree files would be overwritten by merge:\n([\s\S]*?)\nPlease move or remove them before you merge\./);
        if (overwrittenMatch) {
            const files = overwrittenMatch[1].trim().split('\n').map(f => f.trim()).filter(Boolean);
            for (const f of files) {
                try { execSync(`rm -f "${f}"`, { stdio: 'pipe' }); } catch (_) {}
                console.log(`🗑️  Removed untracked file blocking merge: ${f}`);
            }
            try {
                runMergeGit(`git merge --no-ff ${branchName} -m "${mergeMsg}"`);
                console.log(`✅ Merged branch: ${branchName}`);
            } catch (e2) {
                if (didStash) try { execSync('git stash pop', { stdio: 'pipe' }); } catch (_) {}
                return { ok: false, error: `❌ Merge failed. You may need to resolve conflicts manually.` };
            }
        } else {
            // Merge conflicts: abort and tell the user to rebase.
            // Previous behavior silently took --theirs (feature branch) for all
            // conflicts, which drops main-branch changes without warning.
            try {
                const unmerged = execSync('git diff --name-only --diff-filter=U', { encoding: 'utf8' }).trim();
                const conflictFiles = unmerged ? unmerged.split('\n').filter(Boolean) : [];
                try { execSync('git merge --abort', { stdio: 'pipe' }); } catch (_) {}
                if (didStash) try { execSync('git stash pop', { stdio: 'pipe' }); } catch (_) {}
                const fileList = conflictFiles.map(f => `   - ${f}`).join('\n');
                return { ok: false, error: `❌ Merge conflict in ${conflictFiles.length} file(s):\n${fileList}\n\nRebase the feature branch onto ${defaultBranch} first:\n   git checkout ${branchName}\n   git rebase ${defaultBranch}\n   # resolve conflicts, then retry feature-close\n\nOr open an agent to handle it:\n   aigon feature-open ${num}`, mergeConflict: true };
            } catch (resolveErr) {
                try { execSync('git merge --abort', { stdio: 'pipe' }); } catch (_) {}
                if (didStash) try { execSync('git stash pop', { stdio: 'pipe' }); } catch (_) {}
                return { ok: false, error: `❌ Merge failed. You may need to resolve conflicts manually.` };
            }
        }
    }

    // Restore stash
    if (didStash) {
        try {
            execSync('git stash pop', { stdio: 'pipe' });
            console.log(`📦 Restored stashed changes`);
        } catch (_) {
            console.warn(`⚠️  Stash pop had conflicts — resolve with: git stash show -p | git apply`);
        }
    }

    return { ok: true, defaultBranch, preMergeBaseRef };
}

/**
 * Remote-merged close path: do not perform a second local feature-branch merge.
 * Sync local default branch from origin, then let the normal close phases
 * compute the final git-visible workflow outcome (spec/log move commit) on top
 * of the remote-authoritative default branch.
 */
function syncRemoteMergedBranch(target, {
    getDefaultBranch,
    runGit,
    getCurrentBranch,
    getGitStatusPorcelain,
}) {
    const { branchName } = target;
    const defaultBranch = getDefaultBranch();

    if (getCurrentBranch && getGitStatusPorcelain && getCurrentBranch() === branchName && getGitStatusPorcelain()) {
        return {
            ok: false,
            error: `❌ ${branchName} has uncommitted local changes, but its PR is already merged remotely.\n` +
                `   Commit, stash, or discard those changes before closing so Aigon can sync ${defaultBranch} safely.`,
        };
    }

    let preMergeBaseRef = defaultBranch;
    try {
        preMergeBaseRef = execSync(`git rev-parse ${defaultBranch}`, { encoding: 'utf8' }).trim() || defaultBranch;
    } catch (_) {}

    try {
        execSync('git rev-parse -q --verify MERGE_HEAD', { stdio: 'pipe' });
        execSync('git merge --abort', { stdio: 'pipe' });
        console.log('🧹 Aborted unfinished merge before completing remote-merged close');
    } catch (_) {}

    try {
        runGit(`git checkout ${defaultBranch}`);
        console.log(`🌿 Switched to ${defaultBranch}`);
    } catch (_) {
        return { ok: false, error: `❌ Failed to switch to ${defaultBranch}. Are you in the main repository?` };
    }

    let didStash = false;
    try {
        const dirtyStatus = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
        if (dirtyStatus) {
            execSync('git stash push -m "aigon-feature-close-auto-stash"', { encoding: 'utf8', stdio: 'pipe' });
            didStash = true;
            console.log(`📦 Stashed uncommitted changes on ${defaultBranch} before sync`);
        }
    } catch (_) {}

    try {
        runGit(`git fetch origin ${defaultBranch}`);
        runGit(`git reset --hard origin/${defaultBranch}`);
        console.log(`✅ Synced ${defaultBranch} to origin/${defaultBranch} after remote PR merge`);
    } catch (_) {
        if (didStash) {
            try { execSync('git stash pop', { stdio: 'pipe' }); } catch (_) {}
        }
        return {
            ok: false,
            error: `❌ Failed to sync ${defaultBranch} from origin after remote PR merge.\n` +
                `   Run \`git fetch origin ${defaultBranch}\` and sync your local ${defaultBranch} manually, then re-run feature-close.`,
        };
    }

    console.log(`✅ PR already merged remotely — skipping local feature-branch merge and finishing feature close on ${defaultBranch}`);

    if (didStash) {
        try {
            execSync('git stash pop', { stdio: 'pipe' });
            console.log('📦 Restored stashed changes');
        } catch (_) {
            console.warn(`⚠️  Stash pop had conflicts — resolve with: git stash show -p | git apply`);
        }
    }

    return { ok: true, defaultBranch, preMergeBaseRef, remoteMerged: true };
}

/**
 * Resolve all participating agents from engine snapshot or CLI args.
 */
async function resolveAllAgents(repoPath, name, agentId) {
    let allAgents;
    try {
        const snapshot = await wf.showFeature(repoPath, name);
        allAgents = snapshot && snapshot.agents ? Object.keys(snapshot.agents) : [];
    } catch (_) {
        allAgents = [];
    }
    if (allAgents.length === 0) {
        allAgents = agentId ? [agentId] : ['solo'];
    }
    return allAgents;
}

/**
 * Compute and persist git signals + token telemetry for all participating agents.
 */
function recordCloseTelemetry(target, mergeResult, allAgents, { PATHS, getWorktreeBase, getFeatureGitSignals, estimateExpectedScopeFiles, upsertLogFrontmatterScalars }) {
    const { num, desc, branchName, specPath, repoPath } = target;
    const { preMergeBaseRef } = mergeResult;

    const logsDir = path.join(PATHS.features.root, 'logs');
    const expectedScopeFiles = estimateExpectedScopeFiles(specPath);
    const wtBase = getWorktreeBase();

    function findAgentLogPath(agent) {
        const expectedLogName = agent && agent !== 'solo'
            ? `feature-${num}-${agent}-${desc}-log.md`
            : `feature-${num}-${desc}-log.md`;
        const expectedLogPath = path.join(logsDir, expectedLogName);
        if (fs.existsSync(expectedLogPath)) return expectedLogPath;
        if (!fs.existsSync(logsDir)) return null;
        const fallbackPrefix = agent && agent !== 'solo'
            ? `feature-${num}-${agent}-`
            : `feature-${num}-`;
        const fallback = fs.readdirSync(logsDir)
            .filter(file => file.startsWith(fallbackPrefix) && file.endsWith('-log.md'))
            .sort()[0];
        return fallback ? path.join(logsDir, fallback) : null;
    }

    function getAgentWorktreePath(agent) {
        if (agent === 'solo' || !agent) return target.worktreePath || null;
        return `${wtBase}/feature-${num}-${agent}-${desc}`;
    }

    for (const currentAgent of allAgents) {
        try {
            const agentLogPath = findAgentLogPath(currentAgent);
            const agentWtPath = getAgentWorktreePath(currentAgent);
            const agentBranch = currentAgent && currentAgent !== 'solo'
                ? `feature-${num}-${currentAgent}-${desc}`
                : branchName;

            // Git signals
            let gitSignals = null;
            try {
                gitSignals = getFeatureGitSignals({ baseRef: preMergeBaseRef, targetRef: agentBranch, expectedScopeFiles });
                if (agentLogPath && gitSignals) {
                    upsertLogFrontmatterScalars(agentLogPath, gitSignals);
                    console.log(`📊 Recorded git signals for ${currentAgent}: ${path.basename(agentLogPath)}`);
                }
            } catch (e) {
                console.warn(`⚠️  Could not compute git signals for ${currentAgent}: ${e.message}`);
            }

            // Telemetry (routes per agent: cc→JSONL, gg→Gemini, cx→Codex, cu→no-op)
            let telemetryData = null;
            if (agentLogPath) {
                try {
                    telemetryData = telemetry.captureAgentTelemetry(num, desc, currentAgent, {
                        repoPath,
                        worktreePath: agentWtPath || undefined,
                    });
                    if (telemetryData && Object.keys(telemetryData).length > 0) {
                        upsertLogFrontmatterScalars(agentLogPath, telemetryData);
                        if (telemetryData.cost_usd !== undefined) {
                            console.log(`📊 Recorded token telemetry for ${currentAgent} ($${telemetryData.cost_usd} across ${telemetryData.sessions} session${telemetryData.sessions !== 1 ? 's' : ''})`);
                        }
                    }
                } catch (e) {
                    console.warn(`⚠️  Could not capture telemetry for ${currentAgent}: ${e.message}`);
                }
            }

            // Emit fallback normalized session record if no telemetry captured
            const hasTranscript = agentRegistry.supportsTranscriptTelemetry(currentAgent) || currentAgent === 'solo';
            if (!hasTranscript || !telemetryData || !telemetryData.cost_usd) {
                telemetry.writeAgentFallbackSession(num, currentAgent, {
                    repoPath,
                    source: 'feature-close-fallback',
                    model: `${currentAgent}-cli`,
                    endAt: new Date().toISOString(),
                    sessionId: `feature-${num}-${currentAgent}-${Date.now()}`,
                });
            } else if (hasTranscript && telemetryData && telemetryData.cost_usd) {
                // CC/solo transcript-based agents: write a normalized JSON record if the
                // SessionEnd hook didn't already capture one with real token data.
                // (The hook may have missed if the session was killed or restarted.)
                const telemetryDir = path.join(repoPath, '.aigon', 'telemetry');
                const existingHasData = (() => {
                    try {
                        if (!fs.existsSync(telemetryDir)) return false;
                        const files = fs.readdirSync(telemetryDir)
                            .filter(f => f.startsWith(`feature-${num}-${currentAgent}-`) && f.endsWith('.json'));
                        return files.some(f => {
                            try {
                                const d = JSON.parse(fs.readFileSync(path.join(telemetryDir, f), 'utf8'));
                                return (d.tokenUsage?.input > 0 || d.tokenUsage?.billable > 0 || d.costUsd > 0);
                            } catch (_) { return false; }
                        });
                    } catch (_) { return false; }
                })();
                if (!existingHasData) {
                    telemetry.writeNormalizedTelemetryRecord({
                        source: 'feature-close-transcript',
                        sessionId: `feature-${num}-${currentAgent}-${Date.now()}`,
                        entityType: 'feature',
                        featureId: String(num),
                        repoPath,
                        agent: currentAgent,
                        activity: 'implement',
                        model: telemetryData.model || `${currentAgent}-cli`,
                        startAt: null,
                        endAt: new Date().toISOString(),
                        turnCount: 0,
                        toolCalls: 0,
                        tokenUsage: {
                            input: telemetryData.input_tokens || 0,
                            output: telemetryData.output_tokens || 0,
                            cacheReadInput: telemetryData.cache_read_input_tokens || 0,
                            cacheCreationInput: telemetryData.cache_creation_input_tokens || 0,
                            thinking: telemetryData.thinking_tokens || 0,
                            total: telemetryData.total_tokens || 0,
                            billable: telemetryData.billable_tokens || (telemetryData.input_tokens || 0) + (telemetryData.output_tokens || 0),
                        },
                        costUsd: telemetryData.cost_usd || 0,
                    }, { repoPath });
                }
            }
        } catch (e) {
            console.warn(`⚠️  Could not capture telemetry for ${currentAgent}: ${e.message}`);
        }
    }

}


/**
 * Check if a previous close was interrupted and can be resumed.
 * Returns 'done' | 'resumed' | 'closing' | null.
 */
async function checkResumeState(repoPath, featureId, persistAndRunEffects) {
    const snapshot = await wf.showFeatureOrNull(repoPath, featureId);
    if (!snapshot) return null;
    if (snapshot.currentSpecState === 'done') {
        console.log(`✅ Feature ${featureId} is already closed.`);
        return 'done';
    }
    if (snapshot.currentSpecState === 'closing') {
        console.log(`📋 Resuming interrupted feature-close...`);
        const resumeResult = await persistAndRunEffects(repoPath, featureId, []);
        if (resumeResult.kind === 'busy') {
            console.error(`⏳ ${resumeResult.message}`);
            return 'busy';
        }
        if (resumeResult.kind === 'error') {
            console.error(`❌ ${resumeResult.message}`);
            return 'error';
        }
        console.log(`📋 Close effects completed (resumed).`);
        return 'resumed';
    }
    return null;
}

/**
 * Auto-recover features broken by the legacy "agents:[]" bug (feature 233).
 * If the snapshot has zero registered agents but is in a non-fleet mode, inject the
 * canonical 'solo' agent as ready so soloAllReady can gate. Idempotent: returns the
 * (possibly refreshed) snapshot. No-op when agents are already populated.
 */
async function recoverEmptyAgents(repoPath, featureId, snapshot) {
    if (!snapshot) return snapshot;
    const agentCount = Object.keys(snapshot.agents || {}).length;
    if (agentCount > 0) return snapshot;
    if (snapshot.mode === 'fleet') return snapshot;
    // Synthesise a feature.started replacement is impossible (event log is append-only),
    // so persist a fresh `agent.marked_ready` for 'solo'. The projector ignores marks
    // for unknown agents, so we also persist a `feature.bootstrapped` event with the
    // canonical solo agent registered. The bootstrapped event reseeds context.agents.
    const events = await wf.readEvents(wf.getEntityWorkflowPaths(repoPath, 'feature', featureId).eventsPath);
    const startedEvent = events.find(e => e.type === 'feature.started');
    const at = new Date().toISOString();
    await wf.persistEvents(repoPath, featureId, [
        {
            type: 'feature.bootstrapped',
            featureId,
            mode: snapshot.mode || (startedEvent && startedEvent.mode) || 'solo_branch',
            agents: ['solo'],
            lifecycle: snapshot.currentSpecState,
            at,
        },
        { type: 'agent.marked_ready', agentId: 'solo', at },
    ]);
    console.log(`🔧 Recovered feature ${featureId}: registered 'solo' agent (was empty due to legacy bug).`);
    return wf.showFeature(repoPath, featureId);
}

/**
 * Engine state transition: migration, winner selection, close with effects, dependency graphs.
 */
async function closeEngineState(target, allAgents, { PATHS, findFile, defaultEffectExecutor, persistAndRunEffects, resolveFeatureMode, safeWriteWithStatus }) {
    const { name, num, repoPath, agentId, specFolder, rawArgs } = target;
    const closeFeatureId = name;

    const winnerId = agentId || (allAgents.length === 1 ? allAgents[0] : 'solo');

    // Workflow-core snapshot is required. Folder position is NOT treated as
    // authoritative lifecycle during normal close (feature 270) — pre-engine
    // features must be migrated explicitly via `aigon doctor --fix`.
    const existingSnapshot = await wf.showFeatureOrNull(repoPath, closeFeatureId);
    if (!existingSnapshot) {
        return { ok: false, error: `❌ Feature ${closeFeatureId} has no workflow-core snapshot.\n   Folder position is no longer auto-migrated on close.\n   Run \`aigon doctor --fix\` to migrate legacy features into the engine, then retry.` };
    }

    let featureSnapshot = await wf.showFeature(repoPath, closeFeatureId);
    // Heal legacy "agents:[]" features (feature 233) before attempting the close transition.
    featureSnapshot = await recoverEmptyAgents(repoPath, closeFeatureId, featureSnapshot);
    const snapshotAgents = featureSnapshot && featureSnapshot.agents ? Object.keys(featureSnapshot.agents) : allAgents;
    const needsExplicitWinner = snapshotAgents.length > 1 &&
        !featureSnapshot.winnerAgentId &&
        featureSnapshot.currentSpecState === 'evaluating';

    if (needsExplicitWinner) {
        await wf.selectWinner(repoPath, closeFeatureId, winnerId);
        console.log(`🏆 Winner recorded: ${winnerId}`);
    }

    // Close with durable effects
    const engineOpts = rawArgs.includes('--reclaim') ? { claimTimeoutMs: 1 } : {};
    const closeResult = await wf.tryCloseFeatureWithEffects(repoPath, closeFeatureId, defaultEffectExecutor, engineOpts);
    if (closeResult.kind === 'busy') {
        return { ok: false, error: `⏳ Close effects are being executed by another process. Re-run with --reclaim to force.` };
    }
    console.log(`📋 Moved spec to done`);

    // Refresh dependency graphs
    let changedDependencyIds = [];
    try {
        const graphResult = refreshFeatureDependencyGraphs(PATHS.features, { safeWriteWithStatus });
        if (graphResult.changedSpecs > 0) {
            console.log(`🕸️  Updated dependency graphs in ${graphResult.changedSpecs} feature spec(s)`);
        }
        changedDependencyIds = graphResult.updatedIds || [];
    } catch (e) {
        console.warn(`⚠️  Could not refresh dependency graphs: ${e.message}`);
    }

    return { ok: true, changedDependencyIds };
}

/**
 * Resolve unmerged files, stage specs/logs, force-move stuck spec, commit.
 */
function commitSpecMove(target, engineResult, { PATHS, findFile, runGit, stagePaths }) {
    const { num, desc, repoPath } = target;
    const { changedDependencyIds = [] } = engineResult;

    // Start from a clean index so this commit only captures spec/log moves.
    // Without this, unrelated files staged by earlier merge/stash activity can
    // leak into the "move spec and logs" commit (farline-ai-forge features 35/38).
    try { runGit('git reset --quiet HEAD --'); } catch (_) {}

    // Stage spec directory and log files
    const stagedPaths = [];
    try { runGit(`git add docs/specs/features/`); } catch (_) {}
    const doneSpec = findFile(PATHS.features, num, ['05-done']);
    if (doneSpec) stagedPaths.push(doneSpec.fullPath);
    const evalPath = path.join(PATHS.features.root, 'evaluations', `feature-${num}-eval.md`);
    if (fs.existsSync(evalPath)) stagedPaths.push(evalPath);
    const logsDir = path.join(PATHS.features.root, 'logs');
    if (fs.existsSync(logsDir)) {
        const logPrefix = `feature-${num}-`;
        fs.readdirSync(logsDir)
            .filter(file => file.startsWith(logPrefix) && file.endsWith('-log.md'))
            .forEach(file => stagedPaths.push(path.join(logsDir, file)));
    }
    changedDependencyIds.forEach((featureId) => {
        const changedSpec = findFile(PATHS.features, featureId, PATHS.features.folders);
        if (changedSpec) stagedPaths.push(changedSpec.fullPath);
    });
    try { stagePaths(runGit, repoPath, stagedPaths); } catch (_) {}

    // Force-move spec to 05-done if stuck — drift-correction after engine close
    // succeeded but the move_spec effect didn't land the file (e.g. concurrent
    // edit, filesystem race, or the closing-state fromPath mis-computed as
    // 04-in-evaluation when the spec was at 02-backlog or 03-in-progress).
    const stuckSpec = findFile(PATHS.features, num, ['02-backlog', '03-in-progress', '04-in-evaluation', '06-paused']);
    if (stuckSpec) {
        console.warn(`⚠️  Drift: spec for feature ${num} still in ${stuckSpec.folder} after engine close. Force-moving to 05-done.`);
        const donePath = path.join(PATHS.features.root, '05-done', path.basename(stuckSpec.fullPath));
        fs.mkdirSync(path.dirname(donePath), { recursive: true });
        fs.renameSync(stuckSpec.fullPath, donePath);
        try { runGit(`git add docs/specs/features/`); } catch (_) {}
    }

    try {
        runGit(`git commit -m "chore: complete feature ${num} - move spec and logs"`);
        console.log(`📝 Committed spec and log file moves`);
    } catch (e) {
        // No changes to commit — fine
    }
}

/**
 * Remote-merged closes create the final "feature done" workflow commit locally
 * after syncing to origin/main. Push that close commit back so remote main also
 * reflects the authoritative spec/log outcome.
 */
function pushRemoteMergedCloseCommit(defaultBranch, { runGit }) {
    try {
        runGit(`git push origin ${defaultBranch}`);
        console.log(`📤 Pushed finalized close state to origin/${defaultBranch}`);
    } catch (_) {
        console.warn(`⚠️  Could not push finalized close state to origin/${defaultBranch} — push manually if needed.`);
    }
}

/**
 * Remove worktree and delete branch.
 * Remote-merged closes may need force-delete because squash/rebase merges do
 * not leave the local feature branch as an ancestor of default branch.
 */
function cleanupWorktreeAndBranch(target, { runGit, safeRemoveWorktree, getWorktreeStatus, forceDeleteBranch = false, deleteRemoteBranch = false }) {
    const { worktreePath, branchName, keepBranch } = target;
    const deleteCmd = forceDeleteBranch ? `git branch -D ${branchName}` : `git branch -d ${branchName}`;

    let worktreeRemoved = false;
    if (worktreePath && fs.existsSync(worktreePath)) {
        const wtStatus = getWorktreeStatus(worktreePath);
        if (wtStatus) {
            console.warn(`\n⚠️  Worktree has uncommitted changes:\n${wtStatus.split('\n').map(l => `   ${l}`).join('\n')}`);
            console.warn(`   Moving worktree to Trash for recovery.`);
        }
        if (safeRemoveWorktree(worktreePath)) {
            console.log(`🧹 Removed worktree: ${worktreePath}${wtStatus ? ' (moved to Trash)' : ''}`);
            worktreeRemoved = true;
        } else {
            console.warn(`⚠️  Could not automatically remove worktree: ${worktreePath}`);
        }
    }

    if (keepBranch) {
        console.log(`📌 Keeping branch: ${branchName} (--keep-branch)`);
    } else if (worktreeRemoved) {
        try {
            execSync(`git rev-parse --verify ${branchName}`, { stdio: 'pipe' }); // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
            runGit(deleteCmd);
            console.log(`🗑️  Deleted branch: ${branchName}`);
        } catch (e) {
            // Branch already gone — expected
        }
    } else {
        try {
            runGit(deleteCmd);
            console.log(`🗑️  Deleted branch: ${branchName}`);
        } catch (e) {
            // Optional
        }
    }

    if (!keepBranch && deleteRemoteBranch) {
        try {
            runGit(`git push origin --delete ${branchName}`);
            console.log(`🗑️  Deleted remote branch: ${branchName}`);
        } catch (_) {
            // Optional — GitHub may already have deleted it.
        }
    }
}

/**
 * Push, remove worktrees, delete branches, kill tmux sessions for losing agents.
 */
function cleanupLosingBranches(num, losingBranches, adoptAgents, { findWorktrees, filterByFeatureId, safeRemoveWorktree, removeWorktreePermissions, removeWorktreeTrust }) {
    if (losingBranches.length === 0) return;

    const adoptedBranches = losingBranches.filter(lb => adoptAgents.includes(lb.agent));
    const cleanupBranches = losingBranches.filter(lb => !adoptAgents.includes(lb.agent));

    if (adoptedBranches.length > 0) {
        console.log(`\n   📌 Kept for adoption: ${adoptedBranches.map(lb => lb.agent).join(', ')}`);
    }
    if (cleanupBranches.length === 0) return;

    console.log(`\n🧹 Auto-cleaning ${cleanupBranches.length} losing implementation(s)...`);
    cleanupBranches.forEach(lb => {
        try { execSync(`git push -u origin ${lb.branch}`, { stdio: 'pipe' }); console.log(`   📤 Pushed to origin: ${lb.branch}`); } catch (e) {} // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
        const worktrees = filterByFeatureId(findWorktrees(), num);
        const wt = worktrees.find(w => w.branch === lb.branch || path.basename(w.path).includes(`-${lb.agent}-`));
        if (wt) {
            if (safeRemoveWorktree(wt.path)) {
                console.log(`   🗑️  Removed worktree: ${wt.path}`);
                removeWorktreePermissions([wt.path]);
                removeWorktreeTrust([wt.path]);
            }
        }
        try { execSync(`git branch -D ${lb.branch}`, { stdio: 'pipe' }); console.log(`   🗑️  Deleted branch: ${lb.branch}`); } catch (e) {} // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
    });

    const paddedNum = String(num).padStart(2, '0');
    cleanupBranches.forEach(lb => {
        try {
            const sessions = execSync('tmux ls -F "#{session_name}" 2>/dev/null', { encoding: 'utf8' }).trim().split('\n');
            sessions.filter(s => s.includes(`-f${num}-${lb.agent}-`) || s.includes(`-f${paddedNum}-${lb.agent}-`)).forEach(s => {
                try { execSync(`tmux kill-session -t "${s}"`, { stdio: 'pipe' }); } catch (_) {} // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
            });
        } catch (e) {}
    });
}

/**
 * Fleet mode: handle losing branches, adoption diffs, cleanup.
 */
function handleFleetAdoption(target, { listBranches, findWorktrees, filterByFeatureId, safeRemoveWorktree, removeWorktreePermissions, removeWorktreeTrust }) {
    const { agentId, num, branchName, adoptAgents: rawAdoptAgents } = target;
    if (!agentId) return;

    let adoptAgents = [...rawAdoptAgents];

    // Find losing branches
    const losingBranches = [];
    try {
        const branches = listBranches();
        const featurePattern = new RegExp(`^feature-${num}-(\\w+)-`);
        branches.forEach(branch => {
            const m = branch.match(featurePattern);
            if (m && branch !== branchName) {
                losingBranches.push({ branch, agent: m[1] });
            }
        });
    } catch (e) {}

    // Resolve --adopt all
    if (adoptAgents.includes('all')) {
        if (losingBranches.length === 0) {
            console.warn(`\n⚠️  --adopt all: no losing branches found. Continuing normally.`);
            adoptAgents = [];
        } else {
            adoptAgents = losingBranches.map(lb => lb.agent);
        }
    }

    // Validate requested adopt agents
    if (adoptAgents.length > 0) {
        const losingAgentIds = losingBranches.map(lb => lb.agent);
        const invalidAgents = adoptAgents.filter(a => !losingAgentIds.includes(a));
        if (invalidAgents.length > 0) {
            console.error(`❌ No losing branch found for agent(s): ${invalidAgents.join(', ')}`);
            if (losingAgentIds.length > 0) {
                console.error(`   Available losing agents: ${losingAgentIds.join(', ')}`);
            }
            return;
        }
    }

    // Print adoption diffs
    if (adoptAgents.length > 0) {
        console.log(`\n🔍 Adoption diffs from ${adoptAgents.length} agent(s):`);
        for (const adoptAgent of adoptAgents) {
            const lb = losingBranches.find(l => l.agent === adoptAgent);
            if (!lb) continue;
            console.log(`\n${'='.repeat(72)}`);
            console.log(`📋 DIFF FROM AGENT: ${adoptAgent} (${lb.branch})`);
            console.log(`${'='.repeat(72)}`);
            try {
                const diff = execSync(`git diff HEAD ${lb.branch}`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
                if (diff.trim()) {
                    console.log(diff);
                } else {
                    console.log(`   (no unique changes — diff is empty)`);
                }
            } catch (diffErr) {
                console.error(`   ❌ Failed to generate diff for ${adoptAgent}: ${diffErr.message || 'diff failed'}`);
            }
        }
        console.log(`\n${'='.repeat(72)}`);
        console.log(`END OF ADOPTION DIFFS`);
        console.log(`${'='.repeat(72)}`);
    }

    // Auto-cleanup losing agents
    cleanupLosingBranches(num, losingBranches, adoptAgents, { findWorktrees, filterByFeatureId, safeRemoveWorktree, removeWorktreePermissions, removeWorktreeTrust });
}

/**
 * Dev-proxy GC, close tmux sessions, auto-deploy, post-hook.
 */
function postCloseActions(target, { gcCaddyRoutes, runPostHook, loadProjectConfig, runDeployCommand }) {
    const { num, desc, mode, hookContext } = target;

    // Clean stale dev-proxy entries
    try {
        const gcRemoved = gcCaddyRoutes();
        if (gcRemoved > 0) {
            console.log(`🧹 Cleaned ${gcRemoved} stale dev-proxy entr${gcRemoved === 1 ? 'y' : 'ies'}`);
        }
    } catch (e) {}

    // Close tmux sessions
    try {
        const { gracefullyCloseEntitySessions } = require('./worktree');
        const result = gracefullyCloseEntitySessions(num, 'f', {
            repoPath: process.cwd(),
            featureDesc: desc,
        });
        if (result.closed > 0) {
            console.log(`🧹 Closed ${result.closed} agent session(s)`);
        }
        if (result.remaining && result.remaining.length > 0) {
            console.warn(`⚠️  ${result.remaining.length} tmux session(s) survived cleanup: ${result.remaining.join(', ')}`);
            console.warn(`   Run: aigon sessions-close ${num}`);
        }
    } catch (e) {
        console.warn(`⚠️  tmux cleanup errored: ${e.message}`);
    }

    console.log(`\n✅ Feature ${num} complete! (${mode} mode)`);

    // Auto-deploy
    const deployAfterDone = loadProjectConfig()?.workflow?.deployAfterDone;
    if (deployAfterDone) {
        console.log(`\n🚀 Deploying (workflow.deployAfterDone)...`);
        const deployExitCode = runDeployCommand(deployAfterDone === 'preview');
        if (deployExitCode !== 0) {
            console.error(`\n⚠️  Deploy failed (exit ${deployExitCode}) — merge is intact, deploy manually with: aigon deploy`);
            process.exitCode = deployExitCode;
        } else {
            console.log(`✅ Deployed.`);
        }
    }

    runPostHook('feature-close', hookContext);
}

/**
 * Snapshot final stats into stats.json before worktree is deleted.
 * Captures git stats from the branch and telemetry data.
 */
function snapshotFinalStats(target, { getDefaultBranch, preMergeBaseRef }) {
    const { num, repoPath, worktreePath, branchName } = target;
    const cwd = (worktreePath && fs.existsSync(worktreePath)) ? worktreePath : repoPath;

    try {
        const existing = readStats(repoPath, 'feature', num) || {};
        const startedAt = existing.startedAt || null;
        const now = new Date();
        const completedAt = now.toISOString();
        const durationMs = startedAt ? (now.getTime() - new Date(startedAt).getTime()) : null;

        // Git stats from the branch
        const defaultBranch = getDefaultBranch();
        const baseRef = preMergeBaseRef || defaultBranch;
        let commitCount = 0, filesChanged = 0, linesAdded = 0, linesRemoved = 0;
        let lastCommitAt = null, lastCommitMessage = null;

        try {
            const countStr = execSync(
                `git rev-list --count ${baseRef}..${branchName}`, // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
                { encoding: 'utf8', cwd, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }
            ).trim();
            commitCount = parseInt(countStr, 10) || 0;
        } catch (_) {}

        if (commitCount > 0) {
            try {
                lastCommitAt = execSync(
                    `git log ${branchName} -1 --format=%aI`, // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
                    { encoding: 'utf8', cwd, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }
                ).trim() || null;
            } catch (_) {}
            try {
                lastCommitMessage = execSync(
                    `git log ${branchName} -1 --format=%s`, // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
                    { encoding: 'utf8', cwd, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }
                ).trim() || null;
            } catch (_) {}
            try {
                const diffStat = execSync(
                    `git diff --numstat ${baseRef}..${branchName}`, // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
                    { encoding: 'utf8', cwd, stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }
                ).trim();
                if (diffStat) {
                    for (const line of diffStat.split('\n')) {
                        const m = line.match(/^(\d+)\t(\d+)\t/);
                        if (m) {
                            linesAdded += parseInt(m[1], 10) || 0;
                            linesRemoved += parseInt(m[2], 10) || 0;
                            filesChanged += 1;
                        }
                    }
                }
            } catch (_) {}
        }

        // Read snapshot to capture per-agent model/effort overrides (feature 291).
        // These are the authoritative triplet the feature ran under, so stats
        // attribution can roll up by {agent, model, effort}.
        const snapshotPath = path.join(repoPath, '.aigon', 'workflows', 'features', String(num), 'snapshot.json');
        let snapshotAgents = {};
        try {
            if (fs.existsSync(snapshotPath)) {
                const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
                if (snap && snap.agents && typeof snap.agents === 'object') snapshotAgents = snap.agents;
            }
        } catch (_) {}

        // Telemetry / cost data
        let cost = existing.cost || null;
        const telemetryDir = path.join(repoPath, '.aigon', 'telemetry');
        if (fs.existsSync(telemetryDir)) {
            try {
                const files = fs.readdirSync(telemetryDir)
                    .filter(f => f.startsWith(`feature-${num}-`) && f.endsWith('.json'));
                if (files.length > 0) {
                    let inputTokens = 0, cachedInputTokens = 0, outputTokens = 0, thinkingTokens = 0, totalTokens = 0, costUsd = 0, model = null, sessions = 0;
                    const costByAgent = {};
                    const costByActivity = {};
                    let workflowRunId = null;
                    for (const file of files) {
                        try {
                            const data = JSON.parse(fs.readFileSync(path.join(telemetryDir, file), 'utf8'));
                            const input = data.tokenUsage?.input || 0;
                            const cachedInput = data.tokenUsage?.cacheReadInput || 0;
                            const output = data.tokenUsage?.output || 0;
                            const thinking = data.tokenUsage?.thinking || 0;
                            const total = data.tokenUsage?.total || 0;
                            const billable = data.tokenUsage?.billable || 0;
                            const fileCost = data.costUsd || 0;
                            const isFallback = data.source === 'feature-close-fallback' || (typeof data.source === 'string' && data.source.startsWith('no-telemetry'));
                            const recordHasRealData = !isFallback && (input > 0 || cachedInput > 0 || output > 0 || thinking > 0 || total > 0 || billable > 0 || fileCost > 0);
                            inputTokens += input;
                            cachedInputTokens += cachedInput;
                            outputTokens += output;
                            thinkingTokens += thinking;
                            totalTokens += total;
                            costUsd += fileCost;
                            if (!model && data.model) model = data.model;
                            if (!workflowRunId && data.workflowRunId) workflowRunId = data.workflowRunId;
                            sessions += 1;
                            const agentId = (data.agent || 'unknown').toLowerCase();
                            if (!costByAgent[agentId]) {
                                const snapAgent = snapshotAgents[agentId] || {};
                                costByAgent[agentId] = {
                                    agent: agentId, model: null, effort: null,
                                    modelOverride: snapAgent.modelOverride || null,
                                    effortOverride: snapAgent.effortOverride || null,
                                    inputTokens: 0, cachedInputTokens: 0, freshInputTokens: 0,
                                    outputTokens: 0, thinkingTokens: 0, totalTokens: 0, billableTokens: 0,
                                    costUsd: 0, sessions: 0, hasRealData: false,
                                };
                            }
                            const row = costByAgent[agentId];
                            row.inputTokens += input;
                            row.cachedInputTokens += cachedInput;
                            row.outputTokens += output;
                            row.thinkingTokens += thinking;
                            row.totalTokens += total;
                            row.billableTokens += billable || (input + output + thinking);
                            row.costUsd += fileCost;
                            row.sessions += 1;
                            if (!row.model && data.model) row.model = data.model;
                            if (!row.effort && row.effortOverride) row.effort = row.effortOverride;
                            if (recordHasRealData) row.hasRealData = true;
                            // Per-activity rollup
                            const activityKey = data.activity || 'implement';
                            if (!costByActivity[activityKey]) {
                                costByActivity[activityKey] = {
                                    activity: activityKey,
                                    inputTokens: 0, cachedInputTokens: 0,
                                    outputTokens: 0, thinkingTokens: 0, totalTokens: 0, billableTokens: 0,
                                    costUsd: 0, sessions: 0,
                                };
                            }
                            const actRow = costByActivity[activityKey];
                            actRow.inputTokens += input;
                            actRow.cachedInputTokens += cachedInput;
                            actRow.outputTokens += output;
                            actRow.thinkingTokens += thinking;
                            actRow.totalTokens += total;
                            actRow.billableTokens += billable || (input + output + thinking);
                            actRow.costUsd += fileCost;
                            actRow.sessions += 1;
                        } catch (_) {}
                    }
                    Object.values(costByAgent).forEach(row => {
                        row.freshInputTokens = Math.max(0, row.inputTokens - row.cachedInputTokens);
                    });
                    // Derive workflowRunId from featureId + startedAt if not already set
                    if (!workflowRunId && existing.startedAt) {
                        workflowRunId = `${num}-${new Date(existing.startedAt).getTime()}`;
                    }
                    const models = [...new Set(Object.values(costByAgent).map(a => a.model).filter(Boolean))];
                    const modelLabel = models.length > 1 ? models.join(', ') : (models[0] || model);
                    cost = {
                        inputTokens,
                        cachedInputTokens,
                        freshInputTokens: Math.max(0, inputTokens - cachedInputTokens),
                        outputTokens,
                        thinkingTokens,
                        totalTokens: totalTokens || (inputTokens + outputTokens + cachedInputTokens + thinkingTokens),
                        billableTokens: inputTokens + outputTokens + thinkingTokens,
                        estimatedUsd: Math.round(costUsd * 10000) / 10000,
                        model: modelLabel,
                        sessions,
                        costByAgent,
                        costByActivity,
                        workflowRunId,
                    };
                }
            } catch (_) {}
        }

        writeStats(repoPath, 'feature', num, {
            completedAt,
            durationMs,
            commitCount,
            filesChanged,
            linesAdded,
            linesRemoved,
            lastCommitAt,
            lastCommitMessage,
            cost,
        });
        console.log(`📊 Saved final stats (${commitCount} commits, ${filesChanged} files, +${linesAdded}/-${linesRemoved})`);
    } catch (e) {
        console.warn(`⚠️  Could not snapshot final stats: ${e.message}`);
    }
}

/**
 * Final close phase: if the merged commits touched any lib/*.js files, restart
 * the running aigon server so it picks up the new backend code. Best-effort —
 * never fatal. Skipped silently if no server is running, the user opted out via
 * `featureClose.autoRestartServer = false`, or the diff command fails.
 *
 * Why: feature-close historically left a stale server process running on the
 * pre-merge code, so users (and agents) saw "broken" behavior that was really
 * just the backend not being reloaded. CLAUDE.md rule 4 codifies the manual
 * step; this phase enforces it. See feature 228.
 */
function restartServerIfLibChanged(target, deps) {
    const {
        getChangedLibFiles,
        getServerRegistryEntry,
        isProcessAlive,
        loadProjectConfig,
        restartServer,
        writeRestartMarker,
        log,
        warn,
    } = deps;

    const cfg = loadProjectConfig() || {};
    if (cfg.featureClose && cfg.featureClose.autoRestartServer === false) return;

    let changed = [];
    try {
        changed = getChangedLibFiles(target.preMergeBaseRef);
    } catch (_) {
        return; // diff failed — skip silently
    }

    if (changed.length === 0) return;

    const entry = getServerRegistryEntry();
    if (!entry || !entry.pid || !isProcessAlive(entry.pid)) return;

    // feature 234: when the close subprocess was spawned by the dashboard,
    // calling `aigon server restart` here kills our own grandparent and then
    // crashes via EPIPE because our stdio fds point at the dead grandparent's
    // pipes. Instead, record the need for a restart and let the dashboard
    // orchestrate it after it has responded to the frontend.
    if (process.env.AIGON_INVOKED_BY_DASHBOARD === '1') {
        log(`🔄 Recording restart need (${changed.length} lib/*.js file(s) changed) — dashboard will restart itself.`);
        if (typeof writeRestartMarker === 'function') {
            try {
                writeRestartMarker({ reason: 'lib-changed', files: changed, at: new Date().toISOString() });
            } catch (e) {
                warn(`⚠️  Failed to write restart marker: ${e.message}`);
            }
        }
        return;
    }

    log(`🔄 Restarting aigon server (${changed.length} lib/*.js file(s) changed)...`);
    try {
        restartServer();
    } catch (e) {
        warn(`⚠️  Server restart failed: ${e.message}. Restart manually with 'aigon server restart'.`);
    }
}

/**
 * feature 234: atomically write the "restart needed" marker file so the
 * dashboard can detect that its spawned close subprocess needs it to
 * restart. Marker lives under `<repoPath>/.aigon/server/restart-needed.json`.
 * Atomic via temp file + rename to avoid partial reads.
 */
function writeRestartMarkerFile(repoPath, marker) {
    const dir = path.join(repoPath, '.aigon', 'server');
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, 'restart-needed.json');
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(marker, null, 2));
    fs.renameSync(tmp, target);
}

/**
 * feature 234: read + delete the restart marker for a repo. Returns null if
 * absent or unreadable. Deletes the file even on parse failure so a corrupt
 * marker doesn't get stuck across runs.
 */
function consumeRestartMarker(repoPath) {
    const target = path.join(repoPath, '.aigon', 'server', 'restart-needed.json');
    if (!fs.existsSync(target)) return null;
    let marker = null;
    try {
        marker = JSON.parse(fs.readFileSync(target, 'utf8'));
    } catch (_) { /* leave null, still unlink */ }
    try { fs.unlinkSync(target); } catch (_) {}
    return marker;
}

module.exports = {
    resolveCloseTarget,
    autoCommitAndPush,
    flushDriveBranchChanges,
    mergeFeatureBranch,
    syncRemoteMergedBranch,
    resolveScanCwd,
    checkResumeState,
    resolveAllAgents,
    recordCloseTelemetry,
    snapshotFinalStats,
    closeEngineState,
    recoverEmptyAgents,
    commitSpecMove,
    pushRemoteMergedCloseCommit,
    cleanupWorktreeAndBranch,
    handleFleetAdoption,
    postCloseActions,
    restartServerIfLibChanged,
    writeRestartMarkerFile,
    consumeRestartMarker,
};
