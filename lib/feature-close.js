'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const telemetry = require('./telemetry');
const agentRegistry = require('./agent-registry');
const entity = require('./entity');
const { buildActionContext, assertActionAllowed } = require('./action-scope');
const { runSecurityScan } = require('./security');
const wf = require('./workflow-core');

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
function resolveCloseTarget(args, { PATHS, findFile, getWorktreeBase, findWorktrees, filterByFeatureId, branchExists, resolveFeatureSpecInfo, gitLib }) {
    const requestedFeatureId = args[0];

    // Action-scope check (delegation to main repo if in worktree)
    const actionCtx = buildActionContext(gitLib);
    try {
        const result = assertActionAllowed('feature-close', actionCtx, { featureId: requestedFeatureId });
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
        worktreePath = `${getWorktreeBase()}/feature-${num}-${agentId}-${desc}`;
        mode = 'multi-agent';
    } else {
        branchName = `feature-${num}-${desc}`;
        worktreePath = null;
        mode = 'drive';
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
                    runGit(`git add -A`);
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
                execSync(`git -C "${worktreePath}" add -A`, { encoding: 'utf8' });
                execSync(`git -C "${worktreePath}" commit -m "feat: implementation for feature ${num}"`, { encoding: 'utf8' });
                console.log(`✅ Auto-committed worktree changes`);
            } catch (e) {
                return { ok: false, error: `❌ Auto-commit failed: ${e.message}\n   Commit manually: cd "${worktreePath}" && git add -A && git commit -m "feat: implementation for feature ${num}"\n   Then re-run: aigon feature-close ${num}${target.agentId ? ' ' + target.agentId : ''}` };
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
 * Security scan, switch to default branch, reset settings, stash, merge, pop stash.
 * Returns { ok, preMergeBaseRef } or { ok: false, error }.
 */
function mergeFeatureBranch(target, { getDefaultBranch, runGit }) {
    const { branchName, agentId, num } = target;

    // Security scan
    const scanResult = runSecurityScan('featureClose');
    if (!scanResult.passed) {
        return { ok: false, error: `🔒 feature-close aborted due to security scan failure.` };
    }

    const defaultBranch = getDefaultBranch();

    // Capture pre-merge base ref for git signals
    let preMergeBaseRef = defaultBranch;
    try {
        preMergeBaseRef = execSync(`git rev-parse ${defaultBranch}`, { encoding: 'utf8' }).trim() || defaultBranch;
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
        runGit(`git merge --no-ff ${branchName} -m "${mergeMsg}"`);
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
                runGit(`git merge --no-ff ${branchName} -m "${mergeMsg}"`);
                console.log(`✅ Merged branch: ${branchName}`);
            } catch (e2) {
                if (didStash) try { execSync('git stash pop', { stdio: 'pipe' }); } catch (_) {}
                return { ok: false, error: `❌ Merge failed. You may need to resolve conflicts manually.` };
            }
        } else {
            if (didStash) try { execSync('git stash pop', { stdio: 'pipe' }); } catch (_) {}
            return { ok: false, error: `❌ Merge failed. You may need to resolve conflicts manually.` };
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

            // Transcript telemetry (agents with transcript capture capability)
            const hasTranscript = agentRegistry.supportsTranscriptTelemetry(currentAgent) || currentAgent === 'solo';
            let telemetryData = null;
            if (hasTranscript && agentLogPath) {
                try {
                    telemetryData = telemetry.captureFeatureTelemetry(num, desc, {
                        agentId: currentAgent !== 'solo' ? currentAgent : undefined,
                        repoPath,
                        worktreePath: agentWtPath || undefined,
                        linesChanged: gitSignals ? (gitSignals.lines_changed || 0) : 0,
                    });
                    if (telemetryData) {
                        upsertLogFrontmatterScalars(agentLogPath, telemetryData);
                        console.log(`📊 Recorded token telemetry for ${currentAgent} ($${telemetryData.cost_usd} across ${telemetryData.sessions} session${telemetryData.sessions !== 1 ? 's' : ''})`);
                    }
                } catch (e) {
                    console.warn(`⚠️  Could not capture transcript telemetry for ${currentAgent}: ${e.message}`);
                }
            } else if (!hasTranscript && agentLogPath) {
                upsertLogFrontmatterScalars(agentLogPath, { model: `${currentAgent}-cli` });
            }

            // Emit normalized session record
            if (!hasTranscript || !telemetryData) {
                telemetry.writeAgentFallbackSession(num, currentAgent, {
                    repoPath,
                    source: 'feature-close-fallback',
                    model: `${currentAgent}-cli`,
                    endAt: new Date().toISOString(),
                    sessionId: `feature-${num}-${currentAgent}-${Date.now()}`,
                });
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
 * Engine state transition: migration, winner selection, close with effects, dependency graphs.
 */
async function closeEngineState(target, allAgents, { PATHS, findFile, defaultEffectExecutor, persistAndRunEffects, resolveFeatureMode, safeWriteWithStatus }) {
    const { name, num, repoPath, agentId, specFolder, rawArgs } = target;
    const closeFeatureId = name;

    const winnerId = agentId || (allAgents.length === 1 ? allAgents[0] : 'solo');

    // Explicit migration for pre-workflow-core features
    const existingSnapshot = await wf.showFeatureOrNull(repoPath, closeFeatureId);
    if (!existingSnapshot) {
        const lifecycle = specFolder === '04-in-evaluation' ? 'evaluating' : 'implementing';
        const migration = await wf.migrateEntityLifecycleIfNeeded({
            repoPath, entityType: 'feature', entityId: closeFeatureId,
            mode: resolveFeatureMode(allAgents), agents: allAgents,
            readyAgents: allAgents, lifecycle,
        });
        if (migration.migrated) {
            console.log(`🔧 Migrated feature ${closeFeatureId} into workflow-core (${migration.steps.join(', ')})`);
        }
    }

    const featureSnapshot = await wf.showFeature(repoPath, closeFeatureId);
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
        const graphResult = entity.refreshFeatureDependencyGraphs(PATHS.features, { safeWriteWithStatus });
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

    // Resolve unmerged files first
    try {
        const unmerged = execSync('git diff --name-only --diff-filter=U', { encoding: 'utf8' }).trim();
        if (unmerged) {
            for (const f of unmerged.split('\n').filter(Boolean)) {
                try {
                    execSync(`git checkout --theirs "${f}"`, { stdio: 'pipe' });
                    execSync(`git add "${f}"`, { stdio: 'pipe' });
                } catch (_) {
                    try { execSync(`git add "${f}"`, { stdio: 'pipe' }); } catch (_2) {}
                }
            }
        }
    } catch (_) {}

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

    // Force-move spec to 05-done if stuck
    const stuckSpec = findFile(PATHS.features, num, ['03-in-progress', '04-in-evaluation', '06-paused']);
    if (stuckSpec) {
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
 * Remove worktree and delete branch.
 */
function cleanupWorktreeAndBranch(target, { runGit, safeRemoveWorktree, getWorktreeStatus }) {
    const { worktreePath, branchName, keepBranch } = target;

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
            execSync(`git rev-parse --verify ${branchName}`, { stdio: 'pipe' });
            runGit(`git branch -d ${branchName}`);
            console.log(`🗑️  Deleted branch: ${branchName}`);
        } catch (e) {
            // Branch already gone — expected
        }
    } else {
        try {
            runGit(`git branch -d ${branchName}`);
            console.log(`🗑️  Deleted branch: ${branchName}`);
        } catch (e) {
            // Optional
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
        try { execSync(`git push -u origin ${lb.branch}`, { stdio: 'pipe' }); console.log(`   📤 Pushed to origin: ${lb.branch}`); } catch (e) {}
        const worktrees = filterByFeatureId(findWorktrees(), num);
        const wt = worktrees.find(w => w.branch === lb.branch || path.basename(w.path).includes(`-${lb.agent}-`));
        if (wt) {
            if (safeRemoveWorktree(wt.path)) {
                console.log(`   🗑️  Removed worktree: ${wt.path}`);
                removeWorktreePermissions([wt.path]);
                removeWorktreeTrust([wt.path]);
            }
        }
        try { execSync(`git branch -D ${lb.branch}`, { stdio: 'pipe' }); console.log(`   🗑️  Deleted branch: ${lb.branch}`); } catch (e) {}
    });

    const paddedNum = String(num).padStart(2, '0');
    cleanupBranches.forEach(lb => {
        try {
            const sessions = execSync('tmux ls -F "#{session_name}" 2>/dev/null', { encoding: 'utf8' }).trim().split('\n');
            sessions.filter(s => s.includes(`-f${num}-${lb.agent}-`) || s.includes(`-f${paddedNum}-${lb.agent}-`)).forEach(s => {
                try { execSync(`tmux kill-session -t "${s}"`, { stdio: 'pipe' }); } catch (_) {}
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
function postCloseActions(target, { gcDevServers, runPostHook, loadProjectConfig, runDeployCommand }) {
    const { num, desc, mode, hookContext } = target;

    // Clean stale dev-proxy entries
    try {
        const gcRemoved = gcDevServers();
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
    } catch (e) {}

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

module.exports = {
    resolveCloseTarget,
    autoCommitAndPush,
    mergeFeatureBranch,
    checkResumeState,
    resolveAllAgents,
    recordCloseTelemetry,
    closeEngineState,
    commitSpecMove,
    cleanupWorktreeAndBranch,
    handleFleetAdoption,
    postCloseActions,
};
