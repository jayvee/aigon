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
const { writeStats, readStats } = require('./feature-status');

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
        const wtDir = `feature-${num}-${agentId}-${desc}`;
        const newPath = path.join(getWorktreeBase(), wtDir);
        // Backward compat: check legacy sibling location if new path doesn't exist
        const { getLegacyWorktreeBase } = require('./worktree');
        const legacyPath = path.join(getLegacyWorktreeBase(), wtDir);
        worktreePath = fs.existsSync(newPath) ? newPath : (fs.existsSync(legacyPath) ? legacyPath : newPath);
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
                execSync(`git -C "${worktreePath}" add -A`, { encoding: 'utf8' }); // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
                execSync(`git -C "${worktreePath}" commit -m "feat: implementation for feature ${num}"`, { encoding: 'utf8' }); // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
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

/**
 * Security scan, switch to default branch, reset settings, stash, merge, pop stash.
 * Returns { ok, preMergeBaseRef } or { ok: false, error }.
 */
function mergeFeatureBranch(target, { getDefaultBranch, runGit, runSecurityScan: runScan = runSecurityScan }) {
    const { branchName, agentId, num } = target;

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
            // Auto-resolve all conflicts: take the feature branch version (--theirs)
            // for everything. The feature branch has the agent's implementation which
            // is what we're merging. Changes on main can be re-applied after.
            //
            // Safety: the merge commit is visible in git log, the branch is pushed
            // to origin before merge, and `git revert HEAD` undoes the resolution.
            try {
                const unmerged = execSync('git diff --name-only --diff-filter=U', { encoding: 'utf8' }).trim();
                if (unmerged) {
                    const conflictFiles = unmerged.split('\n').filter(Boolean);
                    const resolved = [];
                    for (const f of conflictFiles) {
                        try {
                            execSync(`git checkout --theirs "${f}"`, { stdio: 'pipe' });
                            execSync(`git add "${f}"`, { stdio: 'pipe' });
                            resolved.push(f);
                        } catch (_) {
                            try { execSync(`git add "${f}"`, { stdio: 'pipe' }); resolved.push(f); } catch (_2) {}
                        }
                    }
                    execSync(`git commit --no-edit`, { stdio: 'pipe' });
                    console.log(`✅ Merged branch: ${branchName} (auto-resolved ${resolved.length} conflict(s))`);
                    resolved.forEach(f => console.log(`   ⚠️  ${f} — kept feature branch version`));
                    console.log(`   Run \`git diff HEAD~1..HEAD\` to review the resolution`);
                    console.log(`   Run \`git revert HEAD\` to undo if needed`);
                } else {
                    if (didStash) try { execSync('git stash pop', { stdio: 'pipe' }); } catch (_) {}
                    return { ok: false, error: `❌ Merge failed. You may need to resolve conflicts manually.` };
                }
            } catch (resolveErr) {
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
            execSync(`git rev-parse --verify ${branchName}`, { stdio: 'pipe' }); // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
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
                            sessions += 1;
                            const agentId = (data.agent || 'unknown').toLowerCase();
                            if (!costByAgent[agentId]) {
                                costByAgent[agentId] = {
                                    agent: agentId, model: null,
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
                            if (recordHasRealData) row.hasRealData = true;
                        } catch (_) {}
                    }
                    Object.values(costByAgent).forEach(row => {
                        row.freshInputTokens = Math.max(0, row.inputTokens - row.cachedInputTokens);
                    });
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
    mergeFeatureBranch,
    resolveScanCwd,
    checkResumeState,
    resolveAllAgents,
    recordCloseTelemetry,
    snapshotFinalStats,
    closeEngineState,
    recoverEmptyAgents,
    commitSpecMove,
    cleanupWorktreeAndBranch,
    handleFleetAdoption,
    postCloseActions,
    restartServerIfLibChanged,
    writeRestartMarkerFile,
    consumeRestartMarker,
};
