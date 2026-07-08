'use strict';
// F636 Phase A: extracted handlers — was 2228 lines before refactor (1363 after).

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const { readAgentStatus, writeAgentStatus, getStateDir } = require('../agent-status');
const agentRegistry = require('../agent-registry');
const entity = require('../entity');
const { runDelegatedAigonCommand, withActionDelegate } = require('../action-scope');
const featureSpecResolver = require('../feature-spec-resolver');
const workflowSnapshotAdapter = require('../workflow-snapshot-adapter');
const wf = require('../workflow-core');
const { getSnapshotPath, STAGE_FOLDERS } = require('../workflow-core/paths');
const { parseFeatureSpecFileName } = require('../dashboard-status-helpers');
const { collectFeatureDeepStatus } = require('../feature-status');
const { matchTmuxSessionByEntityId } = require('../worktree');
const { injectLiteral: tmuxInjectLiteral } = require('../tmux-inject');
const { resolveAgentPromptBody, buildReviewCheckFeedbackPrompt, printTopAgentSuggestion } = require('../agent-prompt-resolver');
const { createEntityCommands, entityResetBase } = require('./entity-commands');
const { parseCliOptions, getOptionValue } = require('../cli-parse');
const { getDefaultAgent, loadGlobalConfig } = require('../config');
const {
    shouldWriteImplementationLogStarter,
    resolveImplementationLogVariant,
} = require('../profile-placeholders');
const { stageAndCommitPaths, stageAndCommitSpecMove } = require('../git-staging');
const { refreshFeatureDependencyGraphs } = require('../feature-dependencies');
const { recordCanonicalStats } = require('../spec-store/stats-canonical');

// ---------------------------------------------------------------------------
// Shared effect executor — handles all effect types across commands
// ---------------------------------------------------------------------------

async function defaultEffectExecutor(repoPath, featureId, effect) {
    const fsp = require('fs/promises');

    if (effect.type === 'move_spec') {
        const { fromPath, toPath } = effect.payload;
        await fsp.mkdir(path.dirname(toPath), { recursive: true });
        try { await fsp.access(fromPath); } catch { return; } // Source already moved
        try { await fsp.access(toPath); return; } catch {} // Target already exists
        await fsp.rename(fromPath, toPath);
        return;
    }

    if (effect.type === 'init_log') {
        const { agentId, num, desc } = effect.payload;
        const logsDir = path.join(repoPath, 'docs', 'specs', 'features', 'logs');
        await fsp.mkdir(logsDir, { recursive: true });
        const logName = agentId
            ? `feature-${num}-${agentId}-${desc}-log.md`
            : `feature-${num}-${desc}-log.md`;
        const logPath = path.join(logsDir, logName);
        try { await fsp.access(logPath); return; } catch {} // Already exists
        const logTemplate = `# Implementation Log: Feature ${num} - ${desc}\n\n## Status\n\n## Criteria Attestation\n\n## New API Surface\n\n## Key Decisions\n\n## Gotchas / Known Issues\n\n## Explicitly Deferred\n\n## For the Next Feature in This Set\n\n## Test Coverage\n`;
        await fsp.writeFile(logPath, logTemplate, 'utf8');
        return;
    }

    if (effect.type === 'write_eval_stub') {
        return; // No-op — eval stub is optional
    }

    if (effect.type === 'write_close_note') {
        const { winnerAgentId } = effect.payload;
        const closePath = path.join(wf.getFeatureRoot(repoPath, featureId), 'closeout.md');
        await fsp.mkdir(path.dirname(closePath), { recursive: true });
        const body = [
            `# Feature ${featureId} Closeout`,
            '',
            `Winner: ${winnerAgentId || 'solo'}`,
            `Closed at: ${new Date().toISOString()}`,
            '',
        ].join('\n');
        await fsp.writeFile(closePath, body, 'utf8');
        return;
    }
}

// Helper: persist effect events and run them
async function persistAndRunEffects(repoPath, featureId, effects, options = {}) {
    if (effects.length > 0) {
        const now = new Date().toISOString();
        await wf.persistEvents(
            repoPath,
            featureId,
            effects.map((effect) => ({ type: 'effect.requested', effect, at: now })),
        );
    }
    const result = await wf.runPendingEffects(repoPath, featureId, defaultEffectExecutor, options);
    if (result.kind === 'busy') {
        return {
            kind: 'busy',
            message: 'Effects are being executed by another process. Re-run with --reclaim to force.',
        };
    }
    return { kind: 'complete', snapshot: result.snapshot };
}

// Helper: resolve FeatureMode from agent count
function resolveFeatureMode(agentIds) {
    if (agentIds.length > 1) return wf.FeatureMode.FLEET;
    if (agentIds.length === 1) return wf.FeatureMode.SOLO_WORKTREE;
    return wf.FeatureMode.SOLO_BRANCH;
}

function resolveMainRepoPath(repoPath, gitLib) {
    if (gitLib && typeof gitLib.getMainRepoPath === 'function') {
        return gitLib.getMainRepoPath(repoPath);
    }
    return repoPath;
}

function pathExists(targetPath) {
    try {
        fs.accessSync(targetPath);
        return true;
    } catch (_) {
        return false;
    }
}

function mapPathToCurrentCheckout(targetPath, repoPath, gitLib) {
    if (!targetPath) return null;
    const currentCheckoutPath = path.resolve(repoPath);
    const mainRepoPath = path.resolve(resolveMainRepoPath(repoPath, gitLib));
    if (currentCheckoutPath === mainRepoPath) return targetPath;
    if (!targetPath.startsWith(mainRepoPath + path.sep) && targetPath !== mainRepoPath) return targetPath;
    return path.join(currentCheckoutPath, path.relative(mainRepoPath, targetPath));
}

function resolveFeatureSpecInfo(repoPath, featureId, gitLib, options = {}) {
    const mainRepoPath = path.resolve(resolveMainRepoPath(repoPath, gitLib));
    const snapshot = workflowSnapshotAdapter.readFeatureSnapshotSync(mainRepoPath, featureId);
    const resolved = featureSpecResolver.resolveFeatureSpec(mainRepoPath, featureId, { snapshot });
    const mappedPath = mapPathToCurrentCheckout(resolved.path, repoPath, gitLib);

    if (options.requireCurrentCheckout && mappedPath && !pathExists(mappedPath)) {
        return {
            ...resolved,
            path: null,
            source: 'missing-in-current-checkout',
            missingPath: mappedPath,
            mainRepoPath,
        };
    }

    return {
        ...resolved,
        path: mappedPath || resolved.path,
        mainRepoPath,
    };
}

function safeReadDir(dir) {
    try {
        return fs.readdirSync(dir);
    } catch (_) {
        return [];
    }
}

function listFeatureRecords(repoPath, gitLib) {
    const mainRepoPath = resolveMainRepoPath(repoPath, gitLib);
    const featuresRoot = path.join(mainRepoPath, 'docs', 'specs', 'features');
    const workflowRoot = path.join(mainRepoPath, '.aigon', 'workflows', 'features');
    const records = [];
    const activeIds = new Set();

    safeReadDir(workflowRoot)
        .filter(entry => /^\d+$/.test(entry))
        .forEach(featureId => {
            const snapshot = workflowSnapshotAdapter.readFeatureSnapshotSync(mainRepoPath, featureId);
            const stage = workflowSnapshotAdapter.snapshotToStage(snapshot);
            if (!snapshot || !stage) return;
            const resolvedSpec = featureSpecResolver.resolveFeatureSpec(mainRepoPath, featureId, { snapshot });
            const parsed = resolvedSpec.path ? parseFeatureSpecFileName(path.basename(resolvedSpec.path)) : null;
            activeIds.add(String(featureId).padStart(2, '0'));
            records.push({
                id: String(featureId).padStart(2, '0'),
                name: parsed ? parsed.name : `feature-${featureId}`,
                stage,
                specPath: mapPathToCurrentCheckout(resolvedSpec.path, repoPath, gitLib),
                source: 'workflow-core',
            });
        });

    featureSpecResolver.VISIBLE_STAGE_DIRS.forEach(({ dir, stage }) => {
        const fullDir = path.join(featuresRoot, dir);
        safeReadDir(fullDir)
            .filter(file => /^feature-(\d+)-.+\.md$/.test(file))
            .forEach(file => {
                const parsed = parseFeatureSpecFileName(file);
                if (!parsed || activeIds.has(parsed.id)) return;
                records.push({
                    id: parsed.id,
                    name: parsed.name,
                    stage,
                    specPath: mapPathToCurrentCheckout(path.join(fullDir, file), repoPath, gitLib),
                    source: 'visible-spec',
                });
            });
    });

    return records.sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }));
}

module.exports = function featureCommands(ctx) {
    const u = ctx.utils;
    const v = ctx.validation;
    const gitLib = ctx.git;
    const hooksLib = ctx.hooks;
    const sc = ctx.specCrud;
    const def = entity.FEATURE_DEF;

    const {
        createSpecFile,
        findFile,
        moveFile,
        getNextId,
        printError,
    } = sc;

    const {
        PATHS,
        PROVIDER_FAMILIES,
        AGENT_CONFIGS,
        readTemplate,
        printAgentContextWarning,
        setupWorktreeEnvironment,
        loadAgentConfig,
        getWorktreeBase,
        findWorktrees,
        filterByFeatureId,
        buildAgentCommand,
        buildTmuxSessionName,
        getEffectiveConfig,
        assertTmuxAvailable,
        ensureAgentSessions,
        openInWarpSplitPanes,
        openSingleWorktree,
        shellQuote,
        tmuxSessionExists,
        createDetachedTmuxSession,
        addWorktreePermissions,
        removeWorktreePermissions,
        removeWorktreeTrust,
        getAvailableAgents,
        buildAgentAliasMap,
        getAgentCliConfig,
        getAgentLaunchFlagTokens,
        detectActiveAgentSession,
        setTerminalTitle,
        isSameProviderFamily,
        loadProjectConfig,
        readConductorReposFromGlobalConfig,
        runDeployCommand,
        safeWriteWithStatus,
        gcCaddyRoutes,
    } = u;

    const {
        runPreHook,
        runPostHook,
    } = hooksLib;

    const {
        runFeatureValidateCommand,
        runRalphCommand,
    } = v;

    const {
        getCurrentBranch,
        getDefaultBranch,
        assertOnDefaultBranch,
        branchExists,
        listBranches,
        runGit,
        detectWorktreeFeature,
        getFeatureGitSignals,
    } = ctx.git;

    const {
        getGitStatusPorcelain: gitStatusPorcelain,
    } = v;

    const {
        loadBoardMapping,
    } = ctx.board;

    const { estimateExpectedScopeFiles, upsertLogFrontmatterScalars: _upsertLogFrontmatterScalars } = require('../feature-command-helpers');
    const upsertLogFrontmatterScalars = (logPath, fields) => _upsertLogFrontmatterScalars(safeWriteWithStatus, logPath, fields);

    // Extracted handlers (feature-start, feature-eval, feature-autonomous)
    // receive this bundle so they can reach shared closures/helpers.
    // `cmds` is exposed via a lazy getter because handlers dispatch to sibling
    // commands that don't exist until the declaration below finishes.
    const handlerDeps = {
        ctx,
        persistAndRunEffects,
        resolveFeatureMode,
        resolveMainRepoPath,
        resolveFeatureSpecInfo,
        runRalphCommand,
        get cmds() { return cmds; },
    };

    // ---------------------------------------------------------------------------
    // feature-prioritise --set / --all-sets handler
    // ---------------------------------------------------------------------------
    async function featurePrioritiseSet(args) {
        const featureDeps = require('../feature-deps');
        const allSets = args.includes('--all-sets');
        const setIdx = args.indexOf('--set');
        const rawSetSlug = setIdx !== -1 ? args[setIdx + 1] : null;
        // Reject missing or accidentally-flag values (e.g. --set --dry-run)
        const setSlug = allSets ? null : (rawSetSlug && !rawSetSlug.startsWith('--') ? rawSetSlug : null);
        const dryRun = args.includes('--dry-run');
        const yes = args.includes('--yes');
        const skipDepCheck = args.includes('--skip-dep-check');

        if (!allSets && !setSlug) {
            process.exitCode = 1;
            return console.error('Usage: aigon feature-prioritise --set <slug> [--yes] [--dry-run] [--skip-dep-check]\n       aigon feature-prioritise --all-sets [--yes] [--dry-run] [--skip-dep-check]');
        }

        const specRoot = def.paths.root;
        const allKnownSets = featureDeps.getAllKnownSets(specRoot, def.paths.folders);

        let setsToProcess;
        if (allSets) {
            setsToProcess = allKnownSets.filter(s => featureDeps.scanInboxBySet(s, specRoot).length > 0).sort();
            if (setsToProcess.length === 0) {
                process.exitCode = 1;
                return console.error('❌ No sets with inbox features found.');
            }
        } else {
            setsToProcess = [setSlug];
        }

        for (const currentSet of setsToProcess) {
            const specs = featureDeps.scanInboxBySet(currentSet, specRoot);

            if (specs.length === 0) {
                process.exitCode = 1;
                console.error(`❌ No inbox features found with set: ${currentSet}`);
                if (allKnownSets.length > 0) {
                    console.error(`   Known sets: ${allKnownSets.join(', ')}`);
                }
                continue;
            }

            // Exactly one set_lead allowed
            const leads = specs.filter(s => s.set_lead);
            if (leads.length > 1) {
                process.exitCode = 1;
                console.error(
                    `❌ Multiple specs claim set_lead: true for set '${currentSet}':\n` +
                    leads.map(s => `   - ${s.slug}`).join('\n') + '\n' +
                    `   Exactly one spec may declare set_lead: true.`
                );
                continue;
            }

            const { sorted, cycle } = featureDeps.topoSort(specs);
            if (cycle) {
                process.exitCode = 1;
                console.error(
                    `❌ Circular dependency detected in set '${currentSet}':\n   ${cycle.join(' → ')}\n` +
                    `   Remove one of these dependencies before prioritising.`
                );
                continue;
            }

            // Print plan
            const slugToSpec = new Map(specs.map(s => [s.slug, s]));
            const count = sorted.length;
            console.log(`\nSet '${currentSet}' — ${count} spec${count === 1 ? '' : 's'} to prioritise in this order:`);
            for (let i = 0; i < sorted.length; i++) {
                const spec = slugToSpec.get(sorted[i]);
                const notes = [];
                if (spec.set_lead) notes.push('set_lead');
                const inSetDeps = spec.deps.filter(d => sorted.includes(d));
                if (inSetDeps.length > 0) notes.push(`deps: ${inSetDeps.join(', ')}`);
                const noteStr = notes.length > 0 ? ` (${notes.join(', ')})` : '';
                console.log(`  ${i + 1}. ${sorted[i]}${noteStr}`);
            }

            if (dryRun) {
                console.log('(dry-run: no specs were moved)');
                continue;
            }

            if (!yes) {
                const proceed = await new Promise((resolve) => {
                    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
                    rl.question('Proceed? [y/N] ', (answer) => {
                        rl.close();
                        resolve(answer.trim().toLowerCase() === 'y');
                    });
                });
                if (!proceed) {
                    console.log('Aborted.');
                    continue;
                }
            }

            const passthroughs = skipDepCheck ? ['--skip-dep-check'] : [];
            for (const slug of sorted) {
                process.exitCode = 0;
                entity.entityPrioritise(def, slug, ctx, passthroughs);
                if (process.exitCode !== 0) {
                    console.error(`\n❌ Set prioritise stopped at '${slug}'. Specs before it were already prioritised.`);
                    console.error(`   Fix the error above, then run: aigon feature-prioritise ${slug}`);
                    return;
                }
            }
        }
    }

    const cmds = {
        // Shared parallel commands (create, prioritise, spec-review quartet).
        // Entity-specific overrides for feature-create follow so the worktree
        // guard and --agent/draftSpecWithAgent post-hook still run.
        ...createEntityCommands(entity.FEATURE_DEF, ctx),

        'feature-create': (args) => {
            // Guard: warn if running from inside a feature worktree
            const wtFeature = detectWorktreeFeature();
            if (wtFeature) {
                console.error(`\n⚠️  You are in a worktree for feature ${wtFeature.featureId}.`);
                console.error(`   Creating a new feature here will commit to the wrong branch.`);
                console.error(`   Switch to the main repo first.\n`);
                return;
            }
            // Parse args:
            //   aigon feature-create <name> <description words...>
            //   aigon feature-create <name> --description <text>
            //   aigon feature-create <name> --agent <id> "<description>"
            // First positional is always the name. Flags (--agent, --description)
            // are extracted in any position; remaining positional words become
            // the description (joined with spaces). The legacy --description
            // form stays supported for backward compatibility.
            const name = args[0];
            const rest = args.slice(1);
            const flags = {};
            const positional = [];
            const knownFlags = new Set(['--agent', '--description', '--set']);
            for (let i = 0; i < rest.length; i++) {
                const token = rest[i];
                if (knownFlags.has(token)) {
                    const key = token.slice(2);
                    if (key === 'description') {
                        // Legacy behaviour: --description consumes the rest of the args.
                        flags.description = rest.slice(i + 1).join(' ').trim();
                        i = rest.length;
                    } else {
                        flags[key] = rest[i + 1];
                        i += 1;
                    }
                } else {
                    positional.push(token);
                }
            }
            let description = (flags.description || positional.join(' ')).trim();
            // Back-compat warning: stranded args before --description (legacy parser)
            const descIdx = rest.indexOf('--description');
            if (descIdx > 0 && !('agent' in flags)) {
                const stranded = rest.slice(0, descIdx).filter(t => !knownFlags.has(t)).join(' ');
                if (stranded) {
                    console.warn(`⚠️  Ignored unrecognized args before --description: "${stranded}"`);
                    console.warn(`   Either quote the name if it has spaces, or drop these words.`);
                }
            }

            const agentId = flags.agent;
            const setSlug = typeof flags.set === 'string' ? flags.set.trim() : '';
            if ('set' in flags && !setSlug) {
                return console.error('❌ --set requires a non-empty slug.');
            }
            if (agentId) {
                const validAgents = agentRegistry.getLaunchableAgentIds();
                if (!validAgents.includes(agentId)) {
                    const deactivatedMsg = agentRegistry.formatDeactivatedAgentMessage(agentId);
                    if (deactivatedMsg) return console.error(`❌ Cannot use agent for draft: ${deactivatedMsg}`);
                    return console.error(`❌ Unknown agent '${agentId}'. Valid agents: ${validAgents.join(', ')}`);
                }
                if (!description) {
                    return console.error(`❌ A description is required when using --agent — pass it positionally or via --description.`);
                }
            }

            const built = entity.entityCreate(entity.FEATURE_DEF, name, ctx, { description, set: setSlug || null, agent: agentId || null });
            if (agentId && built && built.filePath) {
                const { draftSpecWithAgent } = require('../feature-draft');
                draftSpecWithAgent(built.filePath, agentId, description);
            }
        },

        'feature-prioritise': async (args) => {
            if (args.includes('--set') || args.includes('--all-sets')) {
                return featurePrioritiseSet(args);
            }
            if (!args[0]) return console.error('Usage: aigon feature-prioritise <name or letter>');
            entity.entityPrioritise(def, args[0], ctx, args);
        },

        'feature-pause': async (args) => {
            const lifecycle = require('../feature-lifecycle');
            await lifecycle.runPause(args, { ctx, def, persistAndRunEffects, findFile, PATHS });
        },

        'feature-resume': async (args) => {
            const lifecycle = require('../feature-lifecycle');
            await lifecycle.runResume(args, { ctx, def, persistAndRunEffects, findFile, PATHS });
        },

        'feature-unprioritise': async (args) => {
            const lifecycle = require('../feature-lifecycle');
            await lifecycle.runUnprioritise(args, { ctx, persistAndRunEffects, findFile, PATHS });
        },

        'feature-delete': async (args) => {
            await entity.entityDelete(def, args[0], ctx);
        },

        'feature-now': (args) => withActionDelegate('feature-now', args, ctx, () => {
            const featureNow = require('../feature-now');
            featureNow.run(args, {
                ctx, PATHS, findFile, getNextId, runPreHook, runPostHook, readTemplate, runGit, loadProjectConfig, u,
            });
        }),

        'feature-start': async (args) => withActionDelegate('feature-start', args, ctx, async () => {
            const featureStart = require('../feature-start');
            await featureStart.run(args, handlerDeps);
        }),

        'feature-do': (args) => {
            const featureDo = require('../feature-do');
            return featureDo.run(args, handlerDeps);
        },

        'feature-spec': (args) => {
            const options = parseCliOptions(args);
            const id = options._[0];
            const asJson = getOptionValue(options, 'json') !== undefined;
            if (!id) {
                process.exitCode = 1;
                return console.error('Usage: aigon feature-spec <ID> [--json]');
            }

            const resolved = resolveFeatureSpecInfo(process.cwd(), String(id).padStart(2, '0'), gitLib, { requireCurrentCheckout: true });
            if (!resolved.path) {
                process.exitCode = 1;
                if (resolved.source === 'missing-in-current-checkout') {
                    return console.error(`❌ Active spec for feature "${id}" is missing in this checkout.\n\nExpected: ./${path.relative(process.cwd(), resolved.missingPath)}\nSync the worktree or restart the feature.`);
                }
                return printError('feature', id, 'No visible spec path could be resolved.');
            }

            if (asJson) {
                console.log(JSON.stringify(resolved, null, 2));
                return;
            }

            console.log(`./${path.relative(process.cwd(), resolved.path)}`);
        },

        'feature-status': (args) => {
            const options = parseCliOptions(args);
            const id = options._[0];
            const asJson = getOptionValue(options, 'json') !== undefined;
            if (!id) {
                process.exitCode = 1;
                return console.error('Usage: aigon feature-status <ID> [--json]');
            }

            const padded = String(id).padStart(2, '0');
            const checkoutPath = process.cwd();
            const mainRepoPath = resolveMainRepoPath(checkoutPath, gitLib);
            const deepStatus = collectFeatureDeepStatus(mainRepoPath, padded, { currentCheckoutPath: checkoutPath });

            if (asJson) {
                console.log(JSON.stringify(deepStatus, null, 2));
                return;
            }

            // Formatted grid output
            const s = deepStatus.session || {};
            const p = deepStatus.progress || {};
            const c = deepStatus.cost || {};
            const sp = deepStatus.spec || {};

            const line = (label, value) => console.log(`  ${label.padEnd(18)} ${value}`);

            console.log(`\n  Feature ${deepStatus.id} — ${deepStatus.name}`);
            console.log(`  ${'─'.repeat(50)}`);

            console.log('\n  SESSION');
            line('Status', (s.tmuxAlive || s.localSessionActive) ? '🟢 Alive' : '🔴 Dead');
            if (s.sessionName) line('Session', s.sessionName);
            if (s.localSessionActive && !s.tmuxAlive) line('Session type', 'Current shell (worktree)');
            if (s.uptimeSeconds != null) {
                const h = Math.floor(s.uptimeSeconds / 3600);
                const m = Math.floor((s.uptimeSeconds % 3600) / 60);
                line('Uptime', h ? `${h}h ${m}m` : `${m}m`);
            }

            console.log('\n  PROGRESS');
            line('Commits', String(p.commitCount || 0));
            if (p.lastCommitAt) line('Last commit', p.lastCommitAt);
            if (p.lastCommitMessage) line('Message', p.lastCommitMessage);
            line('Files changed', String(p.filesChanged || 0));
            line('Lines', `+${p.linesAdded || 0} / -${p.linesRemoved || 0}`);

            console.log('\n  COST');
            line('Input reported', String(c.inputTokens || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
            line('Approx uncached', String(c.freshInputTokens || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
            line('Cached input', String(c.cachedInputTokens || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
            line('Output tokens', String(c.outputTokens || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
            line('Reasoning', String(c.thinkingTokens || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
            line('Billable', String(c.billableTokens || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
            line('Observed total', String(c.totalTokens || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
            if (c.estimatedUsd) line('Estimated', `$${c.estimatedUsd}`);
            if (c.model) line('Model', c.model);
            if (c.sessions) line('Sessions', String(c.sessions));

            console.log('\n  SPEC');
            line('Criteria', sp.criteriaTotal ? `${sp.criteriaDone}/${sp.criteriaTotal}` : 'n/a');
            if (sp.specPath) line('Spec', `./${sp.specPath}`);
            if (sp.logPath) line('Log', `./${sp.logPath}`);

            console.log('\n  IDENTITY');
            line('Lifecycle', deepStatus.lifecycle || 'unknown');
            line('Mode', deepStatus.mode || 'unknown');
            line('Primary agent', deepStatus.primaryAgent || 'none');
            if (deepStatus.worktreePath) line('Worktree', deepStatus.worktreePath);
            console.log('');
        },

        'feature-list': (args) => {
            const options = parseCliOptions(args);
            const asJson = getOptionValue(options, 'json') !== undefined;
            const activeOnly = getOptionValue(options, 'active') !== undefined;
            const includeDone = getOptionValue(options, 'all') !== undefined;
            let records = listFeatureRecords(process.cwd(), gitLib);

            if (activeOnly) {
                records = records.filter(record => ['in-progress', 'in-review', 'in-evaluation'].includes(record.stage));
            } else if (!includeDone) {
                records = records.filter(record => record.stage !== 'done');
            }

            if (asJson) {
                console.log(JSON.stringify(records, null, 2));
                return;
            }

            records.forEach(record => {
                const specLabel = record.specPath ? ` ./${path.relative(process.cwd(), record.specPath)}` : '';
                console.log(`${record.id}  ${record.stage.padEnd(13)} ${record.name}${specLabel}`);
            });
        },

        'feature-validate': (args) => {
            return runFeatureValidateCommand(args);
        },

        'feature-eval': async (args) => withActionDelegate('feature-eval', args, ctx, async () => {
            const featureEval = require('../feature-eval');
            await featureEval.run(args, handlerDeps);
        }),

        'feature-code-review': (args) => {
            const id = args[0];
            if (!id) return console.error("Usage: aigon feature-code-review <ID>\n\nLaunches a review agent in the feature's worktree.\nMust be run from the main repo, not from inside a worktree.");

            // Resolve the worktree — review MUST run in the worktree, never main
            const worktrees = filterByFeatureId(findWorktrees(), id);
            if (worktrees.length === 0) {
                return console.error(`❌ No worktree found for feature ${id}.\n   Reviews require a worktree. Was this feature started with a worktree?`);
            }
            // Pick the first worktree (solo) or the one matching the implementing agent
            const wt = worktrees[0];
            const currentBranch = ctx.git.getCurrentBranch();
            if (currentBranch === 'main' || currentBranch === 'master') {
                console.log(`📂 Worktree found: ${wt.path}`);
                console.log(`   Review will run in the worktree, not on ${currentBranch}.`);
            }
            // The actual review is driven by the slash command template.
            // This handler just validates and prints context — the agent
            // is launched by feature-open (dashboard) or the slash command.
            const specInfoForSuggest = resolveFeatureSpecInfo(process.cwd(), String(id).padStart(2, '0'), gitLib, { requireCurrentCheckout: false });
            printTopAgentSuggestion('review', specInfoForSuggest && specInfoForSuggest.specPath);
            printAgentContextWarning('feature-code-review', id);
        },

        'feature-review': (args) => {
            console.warn('⚠️  Deprecated: `aigon feature-review` — use `aigon feature-code-review` instead.');
            cmds['feature-code-review'](args);
        },


        'feature-code-revise': async (args) => {
            const id = args[0];
            if (!id) return console.error('Usage: aigon feature-code-revise <ID>\n\nInjects the revise prompt into the implementing agent\'s tmux session.');

            const repoPath = process.cwd();
            const snapshot = workflowSnapshotAdapter.readFeatureSnapshotSync(repoPath, id);
            const agentIds = snapshot ? Object.keys(snapshot.agents || {}) : [];
            const implAgent = snapshot && snapshot.mode === 'fleet'
                ? (snapshot.winnerAgentId || snapshot.authorAgentId || agentIds[0])
                : (agentIds[0] || snapshot && snapshot.authorAgentId);
            if (!implAgent) return console.error(`❌ No implementing agent found for feature ${id}.`);

            const allSessions = spawnSync('tmux', ['list-sessions', '-F', '#S'], { encoding: 'utf8' });
            const sessionName = (allSessions.stdout || '').split('\n').map(s => s.trim()).filter(Boolean)
                .find(s => {
                    const m = matchTmuxSessionByEntityId(s, id);
                    return m && m.role === 'do' && m.agent === implAgent;
                });

            if (!sessionName) {
                return console.error(`❌ Implementation session not found for feature ${id} agent ${implAgent}.\n   Is the agent's tmux session still running?`);
            }

            const feedbackPrompt = buildReviewCheckFeedbackPrompt(implAgent, id);
            try {
                await wf.recordCodeRevisionStarted(repoPath, 'feature', id, {
                    revisionAgentId: implAgent,
                    source: 'feature-code-revise',
                });
            } catch (err) {
                process.exitCode = 1;
                return console.error(`❌ Failed to record code revision start for feature ${id}: ${err.message}`);
            }
            try {
                tmuxInjectLiteral(sessionName, feedbackPrompt, { submitKey: 'C-m' });
            } catch (err) {
                process.exitCode = 1;
                return console.error(`❌ Failed to inject revise prompt into session "${sessionName}": ${err.message}`);
            }
            writeAgentStatus(id, implAgent, { status: 'addressing-code-review', taskType: 'revise' });
            console.log(`✅ Revise prompt injected into session: ${sessionName}`);
        },

        'feature-close': async (args) => {
            const close = require('../feature-close');
            await close.run(args, {
                ctx,
                persistAndRunEffects,
                resolveFeatureSpecInfo,
                runPreHook,
                runPostHook,
                runDelegatedAigonCommand,
                wf,
                loadProjectConfig,
                loadGlobalConfig,
                getDefaultBranch,
                getCurrentBranch,
                runGit,
                gitStatusPorcelain,
                recordCanonicalStats,
                execSync,
                gcCaddyRoutes,
                runDeployCommand,
                parseCliOptions,
                getOptionValue,
                PATHS,
                findFile,
                getWorktreeBase,
                findWorktrees,
                filterByFeatureId,
                branchExists,
                gitLib,
                estimateExpectedScopeFiles,
                upsertLogFrontmatterScalars,
                getFeatureGitSignals,
                defaultEffectExecutor,
                resolveFeatureMode,
                safeWriteWithStatus,
                listBranches,
                removeWorktreePermissions,
                removeWorktreeTrust,
            });
        },

        'feature-push': (args) => {
            const close = require('../feature-close');
            const currentBranch = getCurrentBranch();
            const worktreeFeatureMatch = String(currentBranch || '').match(/^feature-(\d+)-([a-z]{2,})-(.+)$/);
            const driveFeatureMatch = String(currentBranch || '').match(/^feature-(\d+)-(.+)$/);
            let resolvedArgs = [...args];

            if (resolvedArgs.length === 0) {
                if (worktreeFeatureMatch) {
                    resolvedArgs = [worktreeFeatureMatch[1], worktreeFeatureMatch[2]];
                } else if (driveFeatureMatch) {
                    resolvedArgs = [driveFeatureMatch[1]];
                }
            } else if (resolvedArgs.length === 1 && worktreeFeatureMatch) {
                const requestedId = String(parseInt(resolvedArgs[0], 10));
                const currentId = String(parseInt(worktreeFeatureMatch[1], 10));
                if (requestedId === currentId) {
                    resolvedArgs = [worktreeFeatureMatch[1], worktreeFeatureMatch[2]];
                }
            }

            const id = resolvedArgs[0];
            if (!id) {
                process.exitCode = 1;
                return console.error("Usage: aigon feature-push [ID] [agent]\n\nFrom a feature worktree, no arguments are needed — Aigon infers the current feature branch.\nFrom the main repo or a non-feature branch, pass <ID> and optionally [agent].\n\nExamples: aigon feature-push\n          aigon feature-push 55\n          aigon feature-push 55 gg");
            }

            // Resolve the target using the same rules as feature-close
            const target = close.resolveCloseTarget(resolvedArgs, {
                PATHS, findFile, getWorktreeBase, findWorktrees, filterByFeatureId,
                branchExists, resolveFeatureSpecInfo, gitLib, actionName: 'feature-push',
            });
            if (!target.ok) {
                if (target.delegate) {
                    console.log(`📡 Delegating 'feature-push' to main repo...`);
                    runDelegatedAigonCommand(target.delegate, 'feature-push', args);
                    return;
                }
                process.exitCode = 1;
                return console.error(target.error);
            }

            const { branchName } = target;

            // Check origin exists
            try {
                execSync('git remote get-url origin', { stdio: 'pipe' });
            } catch {
                process.exitCode = 1;
                return console.error(`❌ No 'origin' remote found. Add one with:\n   git remote add origin <url>`);
            }

            // Push with upstream tracking
            try {
                runGit(`git push -u origin ${branchName}`);
                console.log(`✅ Pushed branch to origin: ${branchName}`);
                console.log(`   Create a PR on GitHub, then run \`aigon feature-close ${id}\` when ready.`);
            } catch (e) {
                process.exitCode = 1;
                return console.error(`❌ Push failed: ${e.message || 'unknown error'}\n   Check your remote access and try again.`);
            }
        },

        'feature-rebase': (args) => {
            const close = require('../feature-close');
            const currentBranch = getCurrentBranch();
            const worktreeFeatureMatch = String(currentBranch || '').match(/^feature-(\d+)-([a-z]{2,})-(.+)$/);
            const driveFeatureMatch = String(currentBranch || '').match(/^feature-(\d+)-(.+)$/);
            let resolvedArgs = [...args];

            if (resolvedArgs.length === 0) {
                if (worktreeFeatureMatch) {
                    resolvedArgs = [worktreeFeatureMatch[1], worktreeFeatureMatch[2]];
                } else if (driveFeatureMatch) {
                    resolvedArgs = [driveFeatureMatch[1]];
                }
            }

            const id = resolvedArgs[0];
            if (!id) {
                process.exitCode = 1;
                return console.error('Usage: aigon feature-rebase <ID>\n\nFrom a feature worktree, no arguments are needed — Aigon infers the current feature branch.\n\nExample: aigon feature-rebase 55');
            }

            const target = close.resolveCloseTarget(resolvedArgs, {
                PATHS, findFile, getWorktreeBase, findWorktrees, filterByFeatureId,
                branchExists, resolveFeatureSpecInfo, gitLib, actionName: 'feature-rebase',
            });
            if (!target.ok) {
                if (target.delegate) {
                    console.log(`📡 Delegating 'feature-rebase' to main repo...`);
                    runDelegatedAigonCommand(target.delegate, 'feature-rebase', args);
                    return;
                }
                process.exitCode = 1;
                return console.error(target.error);
            }

            const worktreePath = target.worktreePath || target.repoPath || process.cwd();
            const { detectDefaultBranch } = require('../dashboard-status-helpers');
            const defaultBranch = detectDefaultBranch(worktreePath) || 'main';
            const q = shellQuote(worktreePath);

            // Stash uncommitted changes so git rebase can run cleanly
            let stashed = false;
            try {
                const dirty = execSync(`git -C ${q} status --porcelain`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
                if (dirty) {
                    execSync(`git -C ${q} stash push -m "aigon feature-rebase auto-stash"`, { encoding: 'utf8', stdio: 'inherit' });
                    stashed = true;
                }
            } catch (e) {
                process.exitCode = 1;
                return console.error(`❌ Could not stash changes before rebase: ${e.message}`);
            }

            console.log(`🔄 Rebasing ${target.branchName} onto ${defaultBranch}...`);
            let rebaseErr = null;
            try {
                execSync(`git -C ${q} rebase ${defaultBranch}`, { encoding: 'utf8', stdio: 'inherit' });
            } catch (e) {
                rebaseErr = e;
                try { execSync(`git -C ${q} rebase --abort`, { stdio: 'ignore' }); } catch (_) { /* ignore */ }
            }

            if (stashed) {
                try { execSync(`git -C ${q} stash pop`, { encoding: 'utf8', stdio: 'inherit' }); } catch (_) { /* ignore pop failure */ }
            }

            if (rebaseErr) {
                const msg = String(rebaseErr.stderr || rebaseErr.stdout || rebaseErr.message || '').trim();
                process.exitCode = 1;
                console.error(`❌ Rebase failed — rebase aborted.`);
                if (msg) console.error(`   ${msg.split('\n')[0]}`);
                console.error(`   Resolve conflicts manually in the worktree, then run:`);
                console.error(`     git -C ${worktreePath} rebase ${defaultBranch}`);
                return;
            }

            console.log(`✅ Rebase complete. Branch ${target.branchName} is up to date with ${defaultBranch}.`);
        },

        'feature-cleanup': (args) => withActionDelegate('feature-cleanup', args, ctx, () => {
            const id = args[0];
            const pushFlag = args.includes('--push');
            if (!id) return console.error("Usage: aigon feature-cleanup <ID> [--push]\n\nRemoves all worktrees and branches for a feature.\n\nOptions:\n  --push  Push branches to origin before deleting locally\n\nExample: aigon feature-cleanup 55");

            const paddedId = String(id).padStart(2, '0');
            const unpaddedId = String(parseInt(id, 10));

            // Build hook context
            const hookContext = {
                featureId: paddedId
            };

            // Run pre-hook (can abort the command)
            if (!runPreHook('feature-cleanup', hookContext)) {
                return;
            }

            // Remove worktrees and collect paths for permission cleanup
            let worktreeCount = 0;
            const removedWorktreePaths = [];
            try {
                filterByFeatureId(findWorktrees(), id).forEach(wt => {
                    const wtStatus = u.getWorktreeStatus(wt.path);
                    if (wtStatus) {
                        console.warn(`   ⚠️  Worktree has uncommitted changes — moving to Trash: ${wt.path}`);
                    }
                    console.log(`   Removing worktree: ${wt.path}`);
                    removedWorktreePaths.push(wt.path);
                    if (u.safeRemoveWorktree(wt.path)) { worktreeCount++; }
                    else { console.error(`   ❌ Failed to remove ${wt.path}`); }
                });
            } catch (e) { console.error("❌ Error reading git worktrees."); }

            // Clean up worktree permissions and trust from Claude settings
            if (removedWorktreePaths.length > 0) {
                removeWorktreePermissions(removedWorktreePaths);
                removeWorktreeTrust(removedWorktreePaths);
            }

            // Find and handle branches
            const featureBranches = [];
            try {
                listBranches().forEach(branch => {
                    if (branch.startsWith(`feature-${paddedId}-`) || branch.startsWith(`feature-${unpaddedId}-`)) {
                        featureBranches.push(branch);
                    }
                });
            } catch (e) {
                // Ignore errors
            }

            let branchCount = 0;
            if (featureBranches.length > 0) {
                featureBranches.forEach(branch => {
                    if (pushFlag) {
                        try {
                            execSync(`git push -u origin ${branch}`, { stdio: 'pipe' });
                            console.log(`   📤 Pushed: ${branch}`);
                        } catch (e) {
                            console.warn(`   ⚠️  Could not push ${branch} (may already exist on remote)`);
                        }
                    }
                    try {
                        execSync(`git branch -D ${branch}`, { stdio: 'pipe' });
                        console.log(`   🗑️  Deleted local branch: ${branch}`);
                        branchCount++;
                    } catch (e) {
                        console.error(`   ❌ Failed to delete ${branch}`);
                    }
                });
            }

            // Clean up stale dev-proxy entries
            try {
                const gcRemoved = gcCaddyRoutes();
                if (gcRemoved > 0) {
                    console.log(`🧹 Cleaned ${gcRemoved} stale dev-proxy entr${gcRemoved === 1 ? 'y' : 'ies'}`);
                }
            } catch (e) { /* non-fatal */ }

            console.log(`\n✅ Cleanup complete: ${worktreeCount} worktree(s), ${branchCount} branch(es) removed.`);
            if (!pushFlag && branchCount > 0) {
                console.log(`💡 Tip: Use 'aigon feature-cleanup ${id} --push' to push branches to origin before deleting.`);
            }
            console.log(`💡 To FULLY reset a feature back to backlog (sessions + state + spec move), use 'aigon feature-reset ${id}'.`);

            // Run post-hook (won't fail the command)
            runPostHook('feature-cleanup', hookContext);
        }),

        'feature-reset': async (args) => {
            const id = args[0];
            if (!id) return console.error("Usage: aigon feature-reset <ID>\n\nFully resets a feature back to a fresh state — as if it was never started.\nRuns the full sequence so you don't have to stitch commands together:\n  1. sessions-close: kill agent processes, tmux sessions, preview dashboards, Warp tabs\n  2. remove worktrees + delete feature branches\n  3. clear .aigon/state/ files for the feature\n  4. move spec back to 02-backlog/\n  5. clear workflow-core engine state (.aigon/workflows/features/<id>/)\n  6. GC dev-proxy entries\n\nUse this whenever you want to start a feature over with a different agent or fresh.\n\nExample: aigon feature-reset 01");

            const result = await entityResetBase(entity.FEATURE_DEF, id, ctx, {
                closeSessions: (entityId) => closeSessionsForFeature(entityId),
                preCleanup: ({ paddedId, unpaddedId }) => {
                    let worktreeCount = 0;
                    const removedWorktreePaths = [];
                    try {
                        filterByFeatureId(findWorktrees(), id).forEach(wt => {
                            console.log(`   Removing worktree: ${wt.path}`);
                            if (u.safeRemoveWorktree(wt.path)) {
                                worktreeCount++;
                                removedWorktreePaths.push(wt.path);
                            } else {
                                console.error(`   ❌ Failed to remove ${wt.path}`);
                            }
                        });
                    } catch (e) {
                        console.warn(`   ⚠️  Worktree enumeration/removal failed: ${e.message}`);
                    }

                    if (removedWorktreePaths.length > 0) {
                        removeWorktreePermissions(removedWorktreePaths);
                        removeWorktreeTrust(removedWorktreePaths);
                    }

                    let branchCount = 0;
                    try {
                        listBranches().forEach(branch => {
                            if (branch.startsWith(`feature-${paddedId}-`) || branch.startsWith(`feature-${unpaddedId}-`)) {
                                try {
                                    execSync(`git branch -D ${branch}`, { stdio: 'pipe' });
                                    console.log(`   🗑️  Deleted branch: ${branch}`);
                                    branchCount++;
                                } catch (e) {
                                    console.warn(`   ⚠️  Failed to delete branch ${branch}: ${e.message}`);
                                }
                            }
                        });
                    } catch (e) {
                        console.warn(`   ⚠️  Branch enumeration failed: ${e.message}`);
                    }

                    let stateCount = 0;
                    const stateDir = getStateDir();
                    if (fs.existsSync(stateDir)) {
                        // Match every state file the runtime writes for a feature:
                        //   feature-<id>-<agent>.json, feature-<id>-file-snapshot.txt,
                        //   heartbeat-<id>-<agent>, heartbeat-<id>-auto, etc.
                        // The old filter only matched the `feature-` prefix and silently
                        // leaked all `heartbeat-*` files (2026-04-28 incident).
                        const matchesId = (f) => (
                            f.startsWith(`feature-${paddedId}-`) ||
                            f.startsWith(`feature-${paddedId}.`) ||
                            f.startsWith(`feature-${unpaddedId}-`) ||
                            f.startsWith(`feature-${unpaddedId}.`) ||
                            f.startsWith(`heartbeat-${paddedId}-`) ||
                            f.startsWith(`heartbeat-${paddedId}.`) ||
                            f.startsWith(`heartbeat-${unpaddedId}-`) ||
                            f.startsWith(`heartbeat-${unpaddedId}.`)
                        );
                        const stateFiles = fs.readdirSync(stateDir).filter(matchesId);
                        stateFiles.forEach(f => {
                            try {
                                fs.unlinkSync(path.join(stateDir, f));
                                console.log(`   🗑️  Removed state: ${f}`);
                                stateCount++;
                            } catch (e) {
                                console.warn(`   ⚠️  Failed to remove state file ${f}: ${e.message}`);
                            }
                        });
                    }

                    return { worktreeCount, branchCount, stateCount };
                },
                postCleanup: () => { try { gcCaddyRoutes(); } catch (e) { /* non-fatal */ } },
            });

            const { worktreeCount = 0, branchCount = 0, stateCount = 0, engineRemoved, specMoved } = result;
            console.log(`\n✅ Reset complete: ${worktreeCount} worktree(s), ${branchCount} branch(es), ${stateCount} state file(s)${engineRemoved ? ', engine state' : ''} removed${specMoved ? ', spec moved to backlog' : ''}.`);
        },

        'feature-backfill-timestamps': (args) => {
            const backfill = require('../feature-backfill-timestamps');
            backfill.run(args, { readConductorReposFromGlobalConfig });
        },

        'feature-autonomous-start': async (args) => {
            const featureAutonomous = require('../feature-autonomous');
            await featureAutonomous.run(args, handlerDeps);
        },

        'feature-autonomous-resume': async (args) => {
            const featureAutonomous = require('../feature-autonomous');
            await featureAutonomous.resume(args, handlerDeps);
        },

        'feature-autonomous-stop': async (args) => {
            const featureAutonomous = require('../feature-autonomous');
            await featureAutonomous.stop(args, handlerDeps);
        },

        'feature-autopilot': async () => {
            console.error('❌ feature-autopilot has been removed.');
            console.error('   Use: aigon feature-autonomous-start <id> <agents...> [--eval-agent=<agent>] [--review-agent=<agent>] [--stop-after=implement|eval|review|close]');
            process.exitCode = 1;
        },

        'feature-open': (args) => {
            const featureOpen = require('../feature-open');
            featureOpen.run(args, {
                findWorktrees,
                filterByFeatureId,
                buildAgentAliasMap,
                buildAgentCommand,
                openInWarpSplitPanes,
                openSingleWorktree,
                getEffectiveConfig,
                u,
                AGENT_CONFIGS,
            });
        },

        'feature-transfer': async (args) => {
            const parsed = parseCliOptions(args);
            const id = parsed._[0];
            const toAgent = getOptionValue(parsed, 'to');
            const reason = getOptionValue(parsed, 'reason');
            const launch = !parsed['no-launch'];

            if (!id || !toAgent) {
                console.error('Usage: aigon feature-transfer <ID> --to=<agent> [--reason="..."] [--no-launch]');
                console.error('\nTransfers an in-progress feature from its current agent to <agent>:');
                console.error('  1. captures pane output from every live tmux session for the feature');
                console.error('  2. writes a transfer briefing to docs/specs/features/logs/feature-<ID>-transfer-*.md');
                console.error('  3. commits any uncommitted work in the worktree as `wip(transfer): ...`');
                console.error('  4. kills the old agent\'s tmux sessions + clears its heartbeat file');
                console.error('  5. moves the worktree to feature-<ID>-<newAgent>-<desc>/ (git worktree move)');
                console.error('  6. emits a fresh feature.started event so the engine shows the new agent');
                console.error('  7. (default) spawns a tmux session running <agent> inside the moved worktree');
                console.error('\nExample: aigon feature-transfer 306 --to=cc --reason="cx hit usage limit"');
                return;
            }

            const { transferFeature } = require('../feature-transfer');
            try {
                await transferFeature(process.cwd(), id, toAgent, { reason, launch });
            } catch (err) {
                console.error(`❌ Transfer failed: ${err.message}`);
                process.exitCode = 1;
                return;
            }
        },

        'sessions-close': (args) => {
            const id = args.find(a => !a.startsWith('--'));

            if (!id) {
                console.error('Usage: aigon sessions-close <ID>');
                console.error('\n  aigon sessions-close 05   # Kill all agents, tmux sessions + close Warp tab for #05');
                console.error('\n  Note: to fully reset a feature back to backlog (sessions + worktrees + state),');
                console.error('  use `aigon feature-reset <ID>` instead — it calls sessions-close internally.');
                return;
            }

            closeSessionsForFeature(id);
        },

        'feature-escalation': async (args) => {
            const { runEscalationCommand } = require('../feature-escalation');
            await runEscalationCommand(args);
        },

    };

    // Shared implementation: kill all agent processes, tmux sessions, preview
    // dashboards, and Warp tabs for a feature ID. Used by both `sessions-close`
    // and `feature-reset` so they can never drift apart.
    function closeSessionsForFeature(id) {
            const paddedId = String(parseInt(id, 10)).padStart(2, '0');

            // Kill agent processes for this ID across all agent types and command types
            const killPatterns = [
                `aigon:feature-do ${paddedId}`,
                `aigon:feature-code-review ${paddedId}`,
                `aigon:research-do ${paddedId}`,
            ];

            console.log(`\nClosing all agent sessions for #${paddedId}...\n`);

            let foundAny = false;
            killPatterns.forEach(pattern => {
                try {
                    // SIGTERM (default) — graceful exit; agents flush buffers and close connections
                    spawnSync('pkill', ['-f', pattern], { stdio: 'ignore' }); // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
                    foundAny = true;
                    console.log(`   ✓ ${pattern}`);
                } catch (e) {
                    // pkill exits 1 when no processes match — that's fine
                }
            });

            // Brief wait for processes to exit cleanly, then SIGKILL any stragglers
            if (foundAny) {
                try { execSync('sleep 1', { stdio: 'ignore' }); } catch (e) { /* ignore */ }
                killPatterns.forEach(pattern => {
                    try {
                        spawnSync('pkill', ['-9', '-f', pattern], { stdio: 'ignore' }); // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
                    } catch (e) {
                        // Already exited — this is the expected path
                    }
                });
            }

            if (!foundAny) {
                console.log('   (no running agent processes found for this ID)');
            }

            // Kill tmux sessions for this feature ID
            let closedTmuxSessions = 0;
            const killedAgentIds = [];
            try {
                const tmuxList = spawnSync('tmux', ['list-sessions', '-F', '#S'], { encoding: 'utf8' });
                if (!tmuxList.error && tmuxList.status === 0) {
                    const sessions = tmuxList.stdout
                        .split('\n')
                        .map(line => line.trim())
                        .filter(Boolean);
                    sessions.forEach(sessionName => {
                        const matched = u.matchTmuxSessionByEntityId(sessionName, id);
                        if (!matched) return;

                        const kill = spawnSync('tmux', ['kill-session', '-t', sessionName], { stdio: 'ignore' });
                        if (!kill.error && kill.status === 0) {
                            closedTmuxSessions++;
                            console.log(`   ✓ tmux ${sessionName}`);
                            // Track agent IDs for engine signal emission
                            if (matched.agent && matched.type === 'f' && !killedAgentIds.includes(matched.agent)) {
                                killedAgentIds.push(matched.agent);
                            }
                        }
                    });
                }
            } catch (e) {
                // No tmux server running or tmux not installed.
            }

            // Emit signal.session_lost for each killed agent (when engine state exists)
            if (killedAgentIds.length > 0) {
                const snapshotPath = getSnapshotPath(process.cwd(), paddedId);
                if (fs.existsSync(snapshotPath)) {
                    killedAgentIds.forEach(agentId => {
                        wf.emitSignal(process.cwd(), paddedId, 'session-lost', agentId)
                            .then(() => console.log(`   ✓ engine signal: session_lost (${agentId})`))
                            .catch((err) => {
                                console.error(`   ⚠️  Engine signal session_lost failed for ${agentId}: ${err.message}`);
                            });
                    });
                }
            }

            // Kill preview dashboard processes for this feature ID
            // serverIds are "{agent}-{featureId}" (e.g., "cc-156", "gg-156")
            let closedPreviews = 0;
            try {
                const { parseCaddyRoutes, removeCaddyRoute, getAppId, isPortInUseSync } = require('../proxy');
                const appId = getAppId();
                const featureNum = parseInt(id, 10);
                const routes = parseCaddyRoutes();
                for (const route of routes) {
                    if (!(route.comment && /^Dashboard(?:[: ]|$)/.test(route.comment))) continue;
                    if (!route.hostname.endsWith(`.${appId}.localhost`)) continue;
                    // Match hostnames like "cc-156.appid.localhost" for the feature ID
                    const m = route.hostname.match(/^([a-z]{2})-(\d+)\./);
                    if (!m || parseInt(m[2], 10) !== featureNum) continue;
                    // Kill the process on the backend port
                    if (isPortInUseSync(route.port)) {
                        try {
                            const pids = require('child_process').execSync(`lsof -ti tcp:${route.port}`, { encoding: 'utf8', stdio: 'pipe' }).trim();
                            pids.split('\n').filter(Boolean).forEach(p => {
                                try { process.kill(parseInt(p, 10), 'SIGTERM'); } catch (_) {}
                            });
                            console.log(`   ✓ preview dashboard ${m[1]}-${m[2]} (port ${route.port})`);
                            closedPreviews++;
                        } catch (_) {}
                    }
                    removeCaddyRoute(route.hostname);
                }
            } catch (e) {
                // Non-fatal — proxy module may not be available
            }

            // Try to close the Warp arena tab/window
            const warpTitleHints = [
                `Arena Research: ${paddedId}`,
                `Arena: Feature ${paddedId}`,
            ];

            let warpClosed = false;
            for (const hint of warpTitleHints) {
                if (u.closeWarpWindow(hint)) {
                    warpClosed = true;
                }
            }

            if (warpClosed) {
                console.log('\n✅ Warp Fleet tab closed.');
            } else {
                const tmuxSuffix = closedTmuxSessions > 0 ? ` Closed ${closedTmuxSessions} tmux session(s).` : '';
                console.log(`\n✅ Done. (Close the Warp tab manually if still open.)${tmuxSuffix}`);
            }
    }

    return cmds;
};

// Backward-compat wrapper used by aigon-cli.js — exports every handler the
// factory returns so "defined but not whitelisted" drift is impossible.
function createFeatureCommands(overrides = {}) {
    const utils = require('../utils');
    const hooksLib = require('../hooks');
    const versionLib = require('../version');
    const specCrud = require('../spec-crud');
    const git = require('../git');
    const board = require('../board');
    const feedbackLib = require('../feedback');
    const validation = require('../validation');
    const ctx = {
        utils: { ...utils, ...overrides },
        hooks: { ...hooksLib, ...overrides },
        version: { ...versionLib, ...overrides },
        specCrud: { ...specCrud, ...overrides },
        git: { ...git, ...overrides },
        board: { ...board, ...overrides },
        feedback: { ...feedbackLib, ...overrides },
        validation: { ...validation, ...overrides },
    };
    const allCmds = module.exports(ctx);
    return Object.fromEntries(
        Object.entries(allCmds).filter(([, handler]) => typeof handler === 'function')
    );
}

module.exports.createFeatureCommands = createFeatureCommands;
