'use strict';

const fs = require('fs');
const path = require('path');

const agentRegistry = require('./agent-registry');
const wf = require('./workflow-core');
const { captureFileSnapshot } = require('./scope-check');
const { refreshFeatureDependencyGraphs, checkUnmetDependencies } = require('./feature-dependencies');
const { stageAndCommitSpecMove } = require('./git-staging');
const { writeStats } = require('./feature-status');
const os = require('os');
const {
    parseCliOptions,
    getOptionValue,
    parseAgentOverrideMap,
    parseFrontMatter,
} = require('./cli-parse');
const { shouldWriteImplementationLogStarter } = require('./profile-placeholders');
const { readAgentStatus, writeAgentStatus } = require('./agent-status');

const LOGS_DIR = 'docs/specs/features/logs';

/**
 * Read planning_context paths from spec frontmatter and append the file
 * contents as a ## Planning Context section to the implementation log.
 * Scans logsAbsPath for the newest matching log file (just created).
 */
function appendPlanningContextToLog(logsAbsPath, num, agentId, specContent) {
    let planningPaths;
    try {
        const parsed = parseFrontMatter(specContent);
        planningPaths = parsed && parsed.data && parsed.data.planning_context;
    } catch (_) { return; }
    if (!planningPaths || planningPaths.length === 0) return;

    const prefix = agentId ? `feature-${num}-${agentId}-` : `feature-${num}-`;
    let files = [];
    try {
        files = fs.readdirSync(logsAbsPath)
            .filter(f => f.startsWith(prefix) && f.endsWith('-log.md'))
            .map(f => ({ name: f, mtime: fs.statSync(path.join(logsAbsPath, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);
    } catch (_) { return; }
    if (files.length === 0) return;

    const logFilePath = path.join(logsAbsPath, files[0].name);
    const sections = [];
    for (const p of planningPaths) {
        const resolved = p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
        if (!fs.existsSync(resolved)) {
            console.warn(`⚠️  planning_context: file not found: ${p}`);
            continue;
        }
        try {
            const content = fs.readFileSync(resolved, 'utf8').trim();
            sections.push(`### ${p}\n\n${content}`);
        } catch (e) {
            console.warn(`⚠️  planning_context: could not read ${p}: ${e.message}`);
        }
    }
    if (sections.length === 0) return;

    try {
        fs.appendFileSync(logFilePath, `\n## Planning Context\n\n${sections.join('\n\n---\n\n')}\n`);
        console.log(`📋 Planning context appended to implementation log`);
    } catch (e) {
        console.warn(`⚠️  Could not append planning context to log: ${e.message}`);
    }
}

async function run(args, deps) {
    const {
        ctx,
        cmds,
        persistAndRunEffects,
        resolveFeatureMode,
    } = deps;

    const u = ctx.utils;
    const sc = ctx.specCrud;
    const { findFile } = sc;
    const {
        PATHS,
        AGENT_CONFIGS,
        setupWorktreeEnvironment,
        reconcileWorktreeJson,
        getWorktreeBase,
        buildAgentCommand,
        buildTmuxSessionName,
        getEffectiveConfig,
        assertTmuxAvailable,
        ensureAgentSessions,
        ensureTmuxSessionForWorktree,
        addWorktreePermissions,
        loadProjectConfig,
        readBasePort,
        registerPort,
    } = u;
    const { runGit } = ctx.git;
    const { runPreHook, runPostHook } = ctx.hooks;

    function clearSessionEndedFlag(featureId, agentId) {
        try {
            const existing = readAgentStatus(featureId, agentId, 'feature') || {};
            const flags = { ...(existing.flags || {}) };
            delete flags.sessionEnded;
            delete flags.sessionEndedAt;
            writeAgentStatus(featureId, agentId, { ...existing, flags });
        } catch (e) {
            // non-fatal — status file may not exist yet for a brand-new session
        }
    }

    const options = parseCliOptions(args);
    const name = options._[0];
    let agentIds = options._.slice(1);
    const backgroundRequested = getOptionValue(options, 'background') !== undefined;
    const foregroundRequested = getOptionValue(options, 'foreground') !== undefined;
    const skipQuotaCheck = getOptionValue(options, 'skip-quota-check') !== undefined;

    // Per-agent overrides from dashboard picker or CLI flags. Format:
    //   --models cc=claude-sonnet-4-6,cx=gpt-5.4
    //   --efforts cc=medium,cx=high
    // Workflow-stage triplets (from --workflow=<slug>) are resolved
    // below and merged as lower-priority defaults — picker values win
    // per the event > workflow > config precedence documented on the
    // spec.
    const pickerModelOverrides = parseAgentOverrideMap(options.models);
    const pickerEffortOverrides = parseAgentOverrideMap(options.efforts);
    const workflowSlug = String(getOptionValue(options, 'workflow') || '').trim() || null;
    const failoverChain = String(getOptionValue(options, 'failover-chain') || '').trim()
        ? String(getOptionValue(options, 'failover-chain')).split(',').map(v => v.trim().toLowerCase()).filter(Boolean)
        : [];
    let workflowTripletDefaults = { modelOverrides: {}, effortOverrides: {} };
    if (workflowSlug) {
        try {
            const workflowDefs = require('./workflow-definitions');
            const def = workflowDefs.resolve(workflowSlug, process.cwd());
            if (!def) {
                process.exitCode = 1;
                return console.error(`❌ Workflow not found: ${workflowSlug}. Run: aigon workflow list`);
            }
            const resolved = workflowDefs.resolveAutonomousInputs(def);
            workflowTripletDefaults = {
                modelOverrides: { ...(resolved.modelOverrides || {}) },
                effortOverrides: { ...(resolved.effortOverrides || {}) },
            };
        } catch (e) {
            process.exitCode = 1;
            return console.error(`❌ Could not load workflow ${workflowSlug}: ${e.message}`);
        }
    }
    // Merge: workflow defaults sit underneath; picker values overwrite.
    const mergedModelOverrides = { ...workflowTripletDefaults.modelOverrides };
    for (const [k, v] of Object.entries(pickerModelOverrides)) {
        if (v === null) delete mergedModelOverrides[k]; else mergedModelOverrides[k] = v;
    }
    const mergedEffortOverrides = { ...workflowTripletDefaults.effortOverrides };
    for (const [k, v] of Object.entries(pickerEffortOverrides)) {
        if (v === null) delete mergedEffortOverrides[k]; else mergedEffortOverrides[k] = v;
    }

    if (backgroundRequested && foregroundRequested) {
        return console.error('❌ Use either --background or --foreground (not both).');
    }

    const startupConfig = getEffectiveConfig();
    const backgroundByConfig = Boolean(startupConfig.backgroundAgents);
    const backgroundMode = backgroundRequested
        ? true
        : (foregroundRequested ? false : backgroundByConfig);

    if (!name) {
        process.exitCode = 1;
        return console.error("Usage: aigon feature-start <ID> [agents...] [--background|--foreground]\n\nExamples:\n  aigon feature-start 55                          # Drive mode (branch)\n  aigon feature-start 55 cc                       # Drive mode (worktree, for parallel development)\n  aigon feature-start 55 cc gg cx cu              # Fleet mode (multiple agents compete)\n  aigon feature-start 55 cc cx --background       # Fleet mode without opening terminals");
    }

    const forceFlag = getOptionValue(options, 'force') !== undefined;

    // Find the feature first to get context for hooks
    let found = findFile(PATHS.features, name, ['02-backlog', '03-in-progress']);
    if (!found) { process.exitCode = 1; return console.error(`❌ Could not find feature "${name}" in backlog or in-progress.`); }

    const preMatch = found.file.match(/^feature-(\d+)-(.*)\.md$/);
    const featureId = preMatch ? preMatch[1] : name;
    const featureName = preMatch ? preMatch[2] : '';

    // F359: suspended in-progress worktree features — inject snapshot agents before
    // mode/hooks so bare `feature-start <id>` can recreate the worktree (spec AC).
    if (found.folder === '03-in-progress') {
        const existingSnapshot = await wf.showFeatureOrNull(process.cwd(), featureId);
        if (
            existingSnapshot
            && agentIds.length === 0
            && (existingSnapshot.mode === wf.FeatureMode.SOLO_WORKTREE
                || existingSnapshot.mode === wf.FeatureMode.FLEET)
        ) {
            try {
                // Sync state moved to @aigon/pro (feature 236); free tier
                // has no sync, so isFeatureSuspended is always false.
                const isFeatureSuspended = (...a) => {
                    try {
                        const { getPro } = require('./pro');
                        const pro = getPro();
                        const fn = pro && ((pro.sync && pro.sync.isFeatureSuspended) || (pro.profile && pro.profile.isFeatureSuspended));
                        if (typeof fn === 'function') return fn(...a);
                    } catch (_) { /* free tier */ }
                    return false;
                };
                const runningId = String(parseInt(featureId, 10) || featureId);
                const wts = require('./git').listWorktreePaths().filter(p => {
                    const m = path.basename(p).match(/^feature-(\d+)-/);
                    return m && m[1] === runningId;
                });
                if (isFeatureSuspended(process.cwd(), featureId, { hasLocalWorktree: wts.length > 0 })) {
                    const snapAgents = Object.keys(existingSnapshot.agents || {})
                        .filter(a => a && String(a).toLowerCase() !== 'solo');
                    if (snapAgents.length > 0) {
                        agentIds = snapAgents;
                        console.warn(
                            `⚠️  Feature ${featureId} is suspended (worktree missing on this machine); ` +
                                `re-creating with agents from snapshot: ${agentIds.join(' ')}`,
                        );
                    } else {
                        console.error(
                            `❌ Feature ${featureId} is suspended (worktree missing) but the snapshot has no agent slots to re-create from.\n` +
                            `   Run: aigon feature-start ${featureId} <agent> [...]`,
                        );
                        process.exitCode = 1;
                        return;
                    }
                }
            } catch (_) { /* non-fatal */ }
        }
    }

    const mode = agentIds.length > 0 ? 'fleet' : 'drive';

    if (!skipQuotaCheck && agentIds.length > 0) {
        const quotaProbe = require('./quota-probe');
        for (const agentId of agentIds) {
            const modelValue = Object.prototype.hasOwnProperty.call(mergedModelOverrides, agentId)
                ? mergedModelOverrides[agentId]
                : ((startupConfig.agents && startupConfig.agents[agentId] && startupConfig.agents[agentId].models && startupConfig.agents[agentId].models.implement) || null);
            let quotaEntry = quotaProbe.isPairDepleted(process.cwd(), agentId, modelValue);
            if (!quotaEntry) {
                try {
                    const probed = quotaProbe.probePair({
                        repoPath: process.cwd(),
                        agentId,
                        modelValue,
                        modelLabel: modelValue || '(agent default)',
                        force: false,
                    });
                    quotaEntry = probed.entry && probed.entry.verdict === 'depleted' ? probed.entry : null;
                } catch (_) {
                    quotaEntry = null; // Unknown probe failures permit start per quota.unknownPolicy.
                }
            }
            if (quotaEntry) {
                process.exitCode = 1;
                return console.error(quotaProbe.formatStartGateMessage({ agentId, modelValue, entry: quotaEntry, featureId }));
            }
        }
    }

    // Dependency check: block start if any depends_on deps are not in 05-done
    if (found.folder === '02-backlog') {
        const specFilePath = path.join(PATHS.features.root, found.folder, found.file);
        const unmetDeps = checkUnmetDependencies(specFilePath, PATHS.features);
        if (unmetDeps.length > 0) {
            const depList = unmetDeps.map(d => `#${d.id} (${d.slug.replace(/-/g, ' ')}) [${d.stage}]`).join(', ');
            if (forceFlag) {
                console.warn(`⚠️  --force: bypassing dependency block for feature ${featureId}`);
                unmetDeps.forEach(d => console.warn(`   Unmet dep: #${d.id} (${d.slug.replace(/-/g, ' ')}) [${d.stage}]`));
            } else {
                process.exitCode = 1;
                return console.error(`❌ Feature ${featureId} is blocked by: ${depList}\n   Use --force to bypass`);
            }
        }
    }

    // Run pre-hook (can abort the command)
    const hookContext = {
        featureId,
        featureName,
        mode,
        agents: agentIds
    };
    if (!runPreHook('feature-start', hookContext)) {
        return;
    }

    // Guard: already running — check engine state for resume
    if (found.folder === '03-in-progress') {
        const repoPath = process.cwd();
        const existingSnapshot = await wf.showFeatureOrNull(repoPath, featureId);
        if (existingSnapshot) {
            // feature 240: when an existing feature is already solo_worktree or
            // fleet mode, a bare `feature-start <id>` (no agents) must NOT fall
            // through to the drive-branch creation path below. Re-running with
            // zero agents used to create a stale `feature-<id>-<slug>` branch
            // alongside the real `feature-<id>-<agent>-<slug>` worktree branch,
            // which then silently merged the wrong branch at close time.
            const existingMode = existingSnapshot.mode;
            if (
                agentIds.length === 0
                && (existingMode === wf.FeatureMode.SOLO_WORKTREE || existingMode === wf.FeatureMode.FLEET)
            ) {
                const runningId = String(parseInt(featureId, 10) || featureId);
                console.log(`ℹ️  Feature ${runningId} is already running as ${existingMode}. Use \`feature-open ${runningId}\` to re-attach — re-running \`feature-start\` without agents would leave a stale drive branch behind.`);
                return;
            }
            if (existingSnapshot.lifecycle === 'implementing') {
                const hasPending = (existingSnapshot.effects || []).some(e => e.status !== 'succeeded');
                if (hasPending) {
                    console.log(`📋 Resuming interrupted feature-start (pending effects)...`);
                } else {
                    console.log(`📋 Feature ${featureId} is already in progress; preserving existing engine agents.`);
                }
            }
        } else if (agentIds.length === 0) {
            const runningId = String(parseInt(featureId, 10) || featureId);
            console.log(`ℹ️  Feature ${runningId} is already running. Use \`feature-open ${runningId}\` to re-attach.`);
            return;
        }
    }

    // Parse filename early — needed by both engine and legacy paths
    const earlyMatch = found.file.match(/^feature-(\d+)-(.*)\.md$/);
    if (!earlyMatch) return console.warn("⚠️  Could not parse filename for branch creation.");
    const [_, num, desc] = earlyMatch;

    // Project config — needed by both the engine-path block below AND
    // the worktree setup further down. Hoisted out of the inner block
    // so setupWorktreeEnvironment can still read logging_level.
    const projCfgStart = loadProjectConfig(process.cwd());

    {
        // ── Workflow-core engine path ──
        const repoPath = process.cwd();
        const specFromPath = found.folder === '02-backlog'
            ? path.join(PATHS.features.root, '02-backlog', found.file)
            : null;
        const specToPath = specFromPath
            ? path.join(PATHS.features.root, '03-in-progress', found.file)
            : null;

        let logStagePath = null;
        if (specFromPath && agentIds.length === 0 && shouldWriteImplementationLogStarter({
            mode: 'drive',
            loggingLevel: projCfgStart.logging_level,
        })) {
            const lp = path.join(PATHS.features.root, 'logs', `feature-${num}-${desc}-log.md`);
            if (!fs.existsSync(lp)) logStagePath = lp;
        }

        try {
            // Check for resume scenario via engine snapshot
            const snapshot = await wf.showFeatureOrNull(repoPath, featureId);
            let startResult;

            if (snapshot && snapshot.lifecycle !== 'backlog') {
                // Resume: run any pending effects
                startResult = await persistAndRunEffects(repoPath, featureId, []);
            } else {
                // Fresh start: create engine state + effects.
                // Solo Drive (no agent) registers as the canonical 'solo' agent so
                // the projector recognises signal.agent_ready and soloAllReady gates.
                // (Bug: empty agents[] left features unable to close — feature 233.)
                const engineMode = resolveFeatureMode(agentIds);
                const engineAgents = agentIds.length === 0 ? ['solo'] : agentIds;
                // Seed authorAgentId from spec frontmatter `agent:` when present;
                // fall back to the agent running this command. Precedence documented
                // in feature 341: frontmatter > env > null.
                let authorAgentId = null;
                try {
                    const specPath = path.join(PATHS.features.root, found.folder, found.file);
                    const raw = fs.readFileSync(specPath, 'utf8');
                    const parsed = parseFrontMatter(raw);
                    if (parsed && parsed.data && typeof parsed.data.agent === 'string' && parsed.data.agent.trim()) {
                        authorAgentId = parsed.data.agent.trim();
                    }
                } catch (_) { /* non-fatal */ }
                if (!authorAgentId) authorAgentId = process.env.AIGON_AGENT_ID || null;

                await wf.startFeature(repoPath, featureId, engineMode, engineAgents, {
                    modelOverrides: mergedModelOverrides,
                    effortOverrides: mergedEffortOverrides,
                    agentFailover: failoverChain.length > 0 ? { chain: failoverChain } : null,
                    authorAgentId,
                });

                const startEffects = [];
                if (specFromPath && specToPath && specFromPath !== specToPath) {
                    startEffects.push({ id: 'start.move_spec', type: 'move_spec', payload: { fromPath: specFromPath, toPath: specToPath } });
                }
                if (agentIds.length === 0) {
                    if (shouldWriteImplementationLogStarter({
                        mode: 'drive',
                        loggingLevel: projCfgStart.logging_level,
                    })) {
                        startEffects.push({ id: 'start.init_log', type: 'init_log', payload: { agentId: null, num, desc } });
                    }
                }

                startResult = await persistAndRunEffects(repoPath, featureId, startEffects);
            }

            if (startResult.kind === 'error') { process.exitCode = 1; return console.error(`❌ ${startResult.message}`); }
            if (startResult.kind === 'busy') { process.exitCode = 1; return console.error(`⏳ ${startResult.message}`); }

            console.log(`🔧 Feature ${featureId} started via workflow-core engine`);

            // Initialize persistent stats record
            try {
                const engineMode = resolveFeatureMode(agentIds);
                writeStats(repoPath, 'feature', featureId, {
                    startedAt: new Date().toISOString(),
                    mode: engineMode,
                    agents: agentIds.length > 0 ? agentIds : ['solo'],
                });
            } catch (e) {
                console.warn(`⚠️  Could not initialize stats record: ${e.message}`);
            }
        } catch (e) {
            process.exitCode = 1;
            console.error(`❌ Workflow-core start failed: ${e.message}`);
            return;
        }

        // Re-find spec in in-progress (engine moved it)
        found = findFile(PATHS.features, name, ['03-in-progress']);
        if (!found) { process.exitCode = 1; return console.error(`❌ Could not find feature "${name}" in in-progress after engine start.`); }
        const movedFromBacklog = !!specFromPath;

        let graphUpdatedPaths = [];
        if (movedFromBacklog) {
            try {
                const graphResult = refreshFeatureDependencyGraphs(PATHS.features, u);
                if (graphResult.changedSpecs > 0) {
                    console.log(`🕸️  Updated dependency graphs in ${graphResult.changedSpecs} feature spec(s)`);
                }
                graphUpdatedPaths = graphResult.updatedPaths || [];
            } catch (e) {
                console.warn(`⚠️  Could not refresh dependency graphs: ${e.message}`);
            }
        }

        // Commit the spec move (important for worktrees)
        if (movedFromBacklog) {
            try {
                const extraPaths = [];
                if (logStagePath && fs.existsSync(logStagePath)) extraPaths.push(logStagePath);
                extraPaths.push(...graphUpdatedPaths);
                // Stage only files this command produced. If you add another file-writing step above,
                // append its path to extraPaths — directory-level git add is not allowed (sweeps unrelated changes).
                // specFromPath is the pre-move 02-backlog path; without it the deletion is never recorded
                // and the spec lingers in 02-backlog/ in HEAD forever (the bug fixed in this commit).
                stageAndCommitSpecMove(runGit, process.cwd(), {
                    fromPath: specFromPath,
                    toPath: specToPath,
                    extraPaths,
                    message: `chore: start feature ${num} - move spec to in-progress`,
                });
                console.log(`📝 Committed spec move to in-progress`);
            } catch (e) {
                if (mode !== 'drive') {
                    console.error(`❌ Could not commit spec move: ${e.message}`);
                    console.error(`   Worktrees require the spec move to be committed before creation.`);
                    console.error(`   Fix any uncommitted changes and try again.`);
                    return;
                }
                console.warn(`⚠️  Could not commit spec move: ${e.message}`);
            }
        }
    }

    // feature 240: consult the authoritative engine snapshot before creating
    // a drive branch. If the engine already tracks this feature as
    // solo_worktree or fleet, the worktree branches are canonical and a
    // drive-style `feature-<num>-<desc>` branch must NEVER be created —
    // it becomes the "stale drive branch" that feature-close later merges
    // by accident.
    let engineMode = null;
    try {
        const authoritativeSnapshot = await wf.showFeatureOrNull(process.cwd(), featureId);
        engineMode = authoritativeSnapshot && authoritativeSnapshot.mode;
    } catch (_) { /* best-effort read */ }
    const engineIsWorktreeBased = engineMode === wf.FeatureMode.SOLO_WORKTREE || engineMode === wf.FeatureMode.FLEET;

    if (mode === 'drive' && engineIsWorktreeBased) {
        console.log(`ℹ️  Feature ${num} is tracked as ${engineMode}; skipping drive branch creation to avoid leaving a stale \`feature-${num}-${desc}\` alongside the worktree branch.`);
        console.log(`   To re-attach, run: aigon feature-open ${num}`);
        return;
    }

    if (mode === 'drive') {
        // Drive mode: Create branch
        const branchName = `feature-${num}-${desc}`;
        try {
            runGit(`git checkout -b ${branchName}`);
            console.log(`🌿 Created branch: ${branchName}`);
        } catch (e) {
            // Branch may already exist
            try {
                runGit(`git checkout ${branchName}`);
                console.log(`🌿 Switched to branch: ${branchName}`);
            } catch (e2) {
                console.error(`❌ Failed to create/switch branch: ${e2.message}`);
                return;
            }
        }

        // Log already created by init_log effect

        const driveSnap = captureFileSnapshot(process.cwd(), num);
        if (driveSnap.ok) {
            console.log(`📸 Scope snapshot: ${driveSnap.fileCount} files recorded`);
        }

        // Append planning context to the implementation log if spec has planning_context:.
        try {
            const specAbsPath = path.join(PATHS.features.root, found.folder, found.file);
            const specContent = fs.readFileSync(specAbsPath, 'utf8');
            appendPlanningContextToLog(path.join(process.cwd(), LOGS_DIR), num, null, specContent);
        } catch (_) {}

        console.log(`\n🚗 Drive mode. Ready to implement in current directory.`);
        console.log(`   Next step: aigon feature-do ${num}`);
        console.log(`   When done: aigon feature-close ${num}`);
    } else {
        // Fleet/worktree mode: Create worktrees
        const wtBase = getWorktreeBase();
        if (!fs.existsSync(wtBase)) {
            fs.mkdirSync(wtBase, { recursive: true });
        }
        const useTmux = true;
        if (useTmux || backgroundMode) {
            try {
                assertTmuxAvailable();
            } catch (e) {
                console.error(`❌ ${e.message}`);
                console.error(`   ${backgroundMode ? 'Background mode' : 'tmux terminal mode'} requires tmux. Install: brew install tmux`);
                return;
            }
        }

        const profile = u.getActiveProfile();
        if (profile.devServer.enabled && !readBasePort()) {
            console.warn(`\n⚠️  No PORT found in .env.local or .env — using default ports`);
            console.warn(`   💡 Add PORT=<number> to .env.local to avoid clashes with other projects`);
        }

        // Auto-register in global port registry
        if (profile.devServer.enabled) {
            const portResult = readBasePort();
            if (portResult) {
                registerPort(path.basename(process.cwd()), portResult.port, process.cwd());
            }
        }

        const createdWorktrees = [];
        agentIds.forEach(agentId => {
            const branchName = `feature-${num}-${agentId}-${desc}`;
            const worktreePath = `${wtBase}/feature-${num}-${agentId}-${desc}`;

            // Check for a valid worktree (has .git file), not just an existing directory
            const isValidWorktree = fs.existsSync(worktreePath) && fs.existsSync(path.join(worktreePath, '.git'));
            if (fs.existsSync(worktreePath) && !isValidWorktree) {
                // Stale empty directory — remove it so git worktree add can succeed
                fs.rmSync(worktreePath, { recursive: true, force: true });
                console.log(`🧹 Removed stale directory: ${worktreePath}`);
            }
            if (isValidWorktree) {
                console.warn(`⚠️  Worktree ${worktreePath} already exists. Skipping.`);
                try {
                    reconcileWorktreeJson(worktreePath, process.cwd());
                } catch (reconcileErr) {
                    console.warn(`   ⚠️  Could not reconcile .aigon/worktree.json: ${reconcileErr.message}`);
                }
                if (useTmux || backgroundMode) {
                    try {
                        const wtConfig = {
                            path: worktreePath,
                            featureId: num,
                            agent: agentId,
                            desc,
                            repoPath: process.cwd(),
                        };
                        const agentCommand = buildAgentCommand(wtConfig);
                        const { sessionName, created } = ensureTmuxSessionForWorktree(wtConfig, agentCommand);
                        if (created) clearSessionEndedFlag(num, agentId);
                        console.log(`   🧵 tmux: ${sessionName}${created ? ' (created)' : ' (already exists)'}`);
                    } catch (tmuxErr) {
                        console.warn(`   ⚠️  Could not create tmux session: ${tmuxErr.message}`);
                    }
                }
            } else {
                try {
                    runGit(`git worktree add ${worktreePath} -b ${branchName}`);
                    console.log(`📂 Worktree: ${worktreePath}`);
                    createdWorktrees.push({ agentId, worktreePath });

                    // Verify spec exists in the worktree. A resumed/partial
                    // start can have already moved the spec in the main
                    // checkout without committing it before this worktree is
                    // created, so heal the worktree branch from the main
                    // checkout before launching the agent.
                    const wtSpecDir = path.join(worktreePath, 'docs', 'specs', 'features', '03-in-progress');
                    const specFileName = found.file;
                    const wtSpecPath = path.join(wtSpecDir, specFileName);
                    let specExistsInWt = fs.existsSync(wtSpecPath);
                    if (!specExistsInWt) {
                        const mainSpecPath = path.join(PATHS.features.root, '03-in-progress', specFileName);
                        if (fs.existsSync(mainSpecPath)) {
                            fs.mkdirSync(wtSpecDir, { recursive: true });
                            fs.copyFileSync(mainSpecPath, wtSpecPath);
                            try {
                                const relSpecPath = path.relative(worktreePath, wtSpecPath);
                                runGit(`git -C ${JSON.stringify(worktreePath)} add -- ${JSON.stringify(relSpecPath)}`);
                                runGit(`git -C ${JSON.stringify(worktreePath)} commit -m ${JSON.stringify(`chore: sync feature ${num} spec to worktree`)} -- ${JSON.stringify(relSpecPath)}`);
                                console.log(`📝 Synced spec into worktree branch: ${relSpecPath}`);
                            } catch (syncErr) {
                                console.warn(`⚠️  Could not commit synced spec in worktree: ${syncErr.message}`);
                            }
                            specExistsInWt = fs.existsSync(wtSpecPath);
                        }
                    }
                    if (!specExistsInWt) {
                        console.error(`❌ Spec not found in worktree 03-in-progress.`);
                        console.error(`   Expected: ${wtSpecPath}`);
                        console.error(`   Worktree agents require the active spec before launch.`);
                        return;
                    }

                    const wtLogMode = agentIds.length > 1 ? 'fleet' : 'drive-wt';
                    setupWorktreeEnvironment(worktreePath, {
                        featureId: num,
                        agentId,
                        desc,
                        profile,
                        logsDirPath: path.join(worktreePath, 'docs/specs/features/logs'),
                        createImplementationLog: shouldWriteImplementationLogStarter({
                            mode: wtLogMode,
                            loggingLevel: projCfgStart.logging_level,
                        }),
                    });

                    // Append planning context to the implementation log if spec has planning_context:.
                    try {
                        const specAbsPath = path.join(PATHS.features.root, found.folder, found.file);
                        const specContent = fs.readFileSync(specAbsPath, 'utf8');
                        appendPlanningContextToLog(
                            path.join(worktreePath, LOGS_DIR),
                            num,
                            agentId,
                            specContent,
                        );
                    } catch (_) {}

                    if (agentId === agentIds[0]) {
                        const wtSnap = captureFileSnapshot(process.cwd(), num);
                        if (wtSnap.ok) {
                            console.log(`📸 Scope snapshot: ${wtSnap.fileCount} files recorded`);
                        }
                    }

                    if (useTmux || backgroundMode) {
                        try {
                            const wtConfig = {
                                path: worktreePath,
                                featureId: num,
                                agent: agentId,
                                desc,
                                repoPath: process.cwd(),
                            };
                            const agentCommand = buildAgentCommand(wtConfig);
                            const { sessionName, created } = ensureTmuxSessionForWorktree(wtConfig, agentCommand);
                            if (created) clearSessionEndedFlag(num, agentId);
                            console.log(`   🧵 tmux: ${sessionName}${created ? ' (created)' : ' (already exists)'}`);
                        } catch (tmuxErr) {
                            console.warn(`   ⚠️  Could not create tmux session: ${tmuxErr.message}`);
                        }
                    }
                } catch (e) {
                    console.error(`❌ Failed to create worktree for ${agentId}: ${e.message}`);
                }
            }
            // Engine tracks its own effects — no legacy completePendingOp needed
        });

        // Add read permissions for all worktrees to Claude settings
        const allWorktreePaths = agentIds.map(agentId => `${wtBase}/feature-${num}-${agentId}-${desc}`);
        addWorktreePermissions(allWorktreePaths);
        // Pre-seed trust for conductor (cc) and all fleet agents
        agentRegistry.ensureAgentTrust('cc', allWorktreePaths);
        for (const id of agentIds) {
            agentRegistry.ensureAgentTrust(id, allWorktreePaths);
        }

        // Agent sessions always run in tmux; GUI terminal choice only affects attach.
        if (createdWorktrees.length > 0) {
            console.log(`\n🖥️  Creating tmux sessions...`);
            const worktreeByAgent = new Map(createdWorktrees.map(wt => [wt.agentId, wt.worktreePath]));
            const sessionResults = ensureAgentSessions(num, createdWorktrees.map(wt => wt.agentId), {
                sessionNameBuilder: (featureId, agent) => buildTmuxSessionName(featureId, agent, { desc, role: 'do' }),
                cwdBuilder: (_, agent) => worktreeByAgent.get(agent),
                commandBuilder: (featureId, agent) => {
                    const wt = {
                        featureId,
                        agent,
                        path: worktreeByAgent.get(agent),
                        desc
                    };
                    return buildAgentCommand(wt);
                },
                sessionMetaBuilder: (sessionName, featureId, agent, cwd) => ({
                    repoPath: path.resolve(process.cwd()),
                    entityType: 'f',
                    entityId: featureId,
                    agent,
                    role: 'do',
                    worktreePath: path.resolve(cwd),
                }),
            });
            sessionResults.forEach(result => {
                if (result.error) {
                    console.warn(`   ⚠️  Could not create tmux session ${result.sessionName}: ${result.error.message}`);
                } else {
                    console.log(`   ✓ ${result.sessionName}${result.created ? ' → started' : ' (already exists)'}`);
                }
            });
            const repoName = path.basename(process.cwd());
            console.log(`\n   Attach: tmux attach -t ${repoName}-f${parseInt(num, 10)}-<agent>-${desc}`);
            console.log(`   List:   tmux ls`);
        }

        if (agentIds.length === 1) {
            const portSuffix = profile.devServer.enabled
                ? ` (PORT=${profile.devServer.ports[agentIds[0]] || AGENT_CONFIGS[agentIds[0]]?.port})`
                : '';
            console.log(`\n🚗 Drive worktree created for parallel development!`);
            console.log(`\n📂 Worktree: ${wtBase}/feature-${num}-${agentIds[0]}-${desc}${portSuffix}`);
            if (backgroundMode) {
                console.log(`\n🟡 Background mode enabled — agent session started without opening a terminal window.`);
                console.log(`   View anytime: aigon feature-open ${num} ${agentIds[0]}`);
            } else {
                console.log(`\n🚀 Starting agent terminal...`);
                cmds['feature-open']([num, agentIds[0]]);
            }
            console.log(`   When done: aigon feature-close ${num}`);
        } else {
            console.log(`\n🏁 Fleet started with ${agentIds.length} agents!`);
            console.log(`\n📂 Worktrees created:`);
            agentIds.forEach(agentId => {
                const portSuffix = profile.devServer.enabled
                    ? ` (PORT=${profile.devServer.ports[agentId] || AGENT_CONFIGS[agentId]?.port})`
                    : '';
                console.log(`   ${agentId}: ${wtBase}/feature-${num}-${agentId}-${desc}${portSuffix}`);
            });
            if (backgroundMode) {
                console.log(`\n🟡 Background mode enabled — all agent sessions started without opening terminal windows.`);
                console.log(`   View all: aigon feature-open ${num} --all`);
            } else {
                console.log(`\n🚀 Starting agent terminals...`);
                cmds['feature-open']([num, '--all']);
            }
            console.log(`   When done: aigon feature-eval ${num}`);
        }
    }

    // Run post-hook (won't fail the command)
    runPostHook('feature-start', hookContext);
}

module.exports = { run };
