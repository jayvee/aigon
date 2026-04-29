'use strict';

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
const { getSnapshotPath } = require('../workflow-core/paths');
const { parseFeatureSpecFileName } = require('../dashboard-status-helpers');
const { collectFeatureDeepStatus } = require('../feature-status');
const { matchTmuxSessionByEntityId } = require('../worktree');
const { resolveAgentPromptBody, buildReviewCheckFeedbackPrompt, printTopAgentSuggestion } = require('../agent-prompt-resolver');
const { createEntityCommands, entityResetBase } = require('./entity-commands');
const { parseCliOptions, getOptionValue } = require('../cli-parse');
const { getDefaultAgent } = require('../config');
const {
    shouldWriteImplementationLogStarter,
    resolveImplementationLogVariant,
} = require('../profile-placeholders');

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
        const logTemplate = `# Implementation Log: Feature ${num} - ${desc}\n\n## Status\n\n## New API Surface\n\n## Key Decisions\n\n## Gotchas / Known Issues\n\n## Explicitly Deferred\n\n## For the Next Feature in This Set\n\n## Test Coverage\n`;
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

function stagePaths(runGit, repoPath, paths) {
    const uniquePaths = [...new Set((paths || []).filter(Boolean))];
    if (uniquePaths.length === 0) return;
    const quoted = uniquePaths.map(p => JSON.stringify(path.relative(repoPath, p))).join(' ');
    runGit(`git add -- ${quoted}`);
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

    const { parseLogFrontmatterForBackfill: _parseLogFrontmatterForBackfill, estimateExpectedScopeFiles, upsertLogFrontmatterScalars: _upsertLogFrontmatterScalars } = require('../feature-command-helpers');
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
        const setSlug = allSets ? null : (setIdx !== -1 ? args[setIdx + 1] : null);
        const dryRun = args.includes('--dry-run');
        const yes = args.includes('--yes');

        if (!allSets && !setSlug) {
            process.exitCode = 1;
            return console.error('Usage: aigon feature-prioritise --set <slug> [--yes] [--dry-run]\n       aigon feature-prioritise --all-sets [--yes] [--dry-run]');
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

            for (const slug of sorted) {
                const prevCode = process.exitCode;
                process.exitCode = 0;
                entity.entityPrioritise(def, slug, ctx, []);
                if (process.exitCode !== 0) {
                    console.error(`\n❌ Set prioritise stopped at '${slug}'. Specs before it were already prioritised.`);
                    console.error(`   Fix the error above, then run: aigon feature-prioritise ${slug}`);
                    return;
                }
                // Restore prev code only if the call succeeded (0)
                void prevCode;
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
                const validAgents = agentRegistry.getAllAgentIds();
                if (!validAgents.includes(agentId)) {
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
            const id = args[0];
            if (!id) return console.error("Usage: aigon feature-pause <id or name>");

            const prestartPause = await entity.pausePrestartEntity(def, id, ctx);
            if (prestartPause && prestartPause.handled) return;

            const isNumeric = /^\d+$/.test(id);
            if (!isNumeric) {
                return console.error(
                    `❌ Could not pause feature "${id}" (no matching inbox/backlog spec or pre-start workflow). ` +
                    'If the spec was moved on disk, run `aigon doctor --fix` or use a numeric id after prioritise.',
                );
            }

            // ID-based pause — engine path
            const paddedId = String(id).padStart(2, '0');
            const repoPath = process.cwd();
            const engineOpts = args.includes('--reclaim') ? { claimTimeoutMs: 1 } : {};

            // Missing workflow snapshot: refuse to bootstrap from folder position
            // (feature 270). Point the operator to the explicit migration path.
            if (!(await wf.showFeatureOrNull(repoPath, paddedId))) {
                process.exitCode = 1;
                return console.error(`❌ Feature ${paddedId} has no workflow-core snapshot.\n   Run \`aigon doctor --fix\` to migrate legacy features, then retry.`);
            }

            const snapshot = await wf.showFeature(repoPath, paddedId);

            if (snapshot.currentSpecState === 'paused') {
                const hasPending = snapshot.effects.some(e => e.status !== 'succeeded');
                if (!hasPending) {
                    console.log(`✅ Feature ${paddedId} is already paused.`);
                    return;
                }
                // Resume pending effects from interrupted pause
                const effectResult = await persistAndRunEffects(repoPath, paddedId, [], engineOpts);
                if (effectResult.kind === 'busy') { process.exitCode = 1; return console.error(`⏳ ${effectResult.message}`); }
                console.log(`✅ Paused: completed pending effects for ${paddedId}`);
                return;
            }

            if (snapshot.currentSpecState !== 'implementing') {
                process.exitCode = 1;
                return console.error(`❌ Cannot pause feature ${paddedId} from state "${snapshot.currentSpecState}".`);
            }

            const found = findFile(PATHS.features, paddedId, ['03-in-progress', '06-paused']);
            if (!found) return console.error(`❌ Could not find feature "${paddedId}" in in-progress or paused.`);
            const specFromPath = path.join(PATHS.features.root, '03-in-progress', found.file);
            const specToPath = path.join(PATHS.features.root, '06-paused', found.file);

            await wf.pauseFeature(repoPath, paddedId);

            const pauseEffects = (specFromPath && specToPath && specFromPath !== specToPath)
                ? [{ id: 'pause.move_spec', type: 'move_spec', payload: { fromPath: specFromPath, toPath: specToPath } }]
                : [];
            const result = await persistAndRunEffects(repoPath, paddedId, pauseEffects, engineOpts);

            if (result.kind === 'error') { process.exitCode = 1; return console.error(`❌ ${result.message}`); }
            if (result.kind === 'busy') { process.exitCode = 1; return console.error(`⏳ ${result.message}`); }

            console.log(`✅ Paused: ${found.file} -> 06-paused/`);
        },

        'feature-resume': async (args) => {
            const id = args[0];
            if (!id) return console.error("Usage: aigon feature-resume <id or name>");

            const prestartResume = await entity.resumePrestartEntity(def, id, ctx);
            if (prestartResume && prestartResume.handled) return;

            // Check if this is a name (no ID) — find in paused and move to inbox
            const isNumeric = /^\d+$/.test(id);
            const pausedDir = path.join(PATHS.features.root, '06-paused');
            if (!isNumeric) {
                const slug = id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                const candidates = fs.existsSync(pausedDir) ? fs.readdirSync(pausedDir).filter(f => f.includes(slug) && f.endsWith('.md')) : [];
                if (candidates.length === 0) return console.error(`❌ No paused feature matching "${id}"`);
                const specFile = candidates[0];
                const targetDir = path.join(PATHS.features.root, '01-inbox');
                fs.renameSync(path.join(pausedDir, specFile), path.join(targetDir, specFile));
                console.log(`✅ Resumed: ${specFile} -> 01-inbox/`);
                return;
            }

            // ID-based resume — engine path
            const paddedId = String(id).padStart(2, '0');
            const repoPath = process.cwd();
            const engineOpts = args.includes('--reclaim') ? { claimTimeoutMs: 1 } : {};

            // Missing workflow snapshot: refuse to bootstrap from folder position
            // (feature 270). Point the operator to the explicit migration path.
            if (!(await wf.showFeatureOrNull(repoPath, paddedId))) {
                process.exitCode = 1;
                return console.error(`❌ Feature ${paddedId} has no workflow-core snapshot.\n   Run \`aigon doctor --fix\` to migrate legacy features, then retry.`);
            }

            const snapshot = await wf.showFeature(repoPath, paddedId);

            if (snapshot.currentSpecState === 'implementing') {
                const hasPending = snapshot.effects.some(e => e.status !== 'succeeded');
                if (!hasPending) {
                    console.log(`✅ Feature ${paddedId} is already implementing.`);
                    return;
                }
                const effectResult = await persistAndRunEffects(repoPath, paddedId, [], engineOpts);
                if (effectResult.kind === 'busy') { process.exitCode = 1; return console.error(`⏳ ${effectResult.message}`); }
                console.log(`✅ Resumed: completed pending effects for ${paddedId}`);
                return;
            }

            if (snapshot.currentSpecState !== 'paused') {
                process.exitCode = 1;
                return console.error(`❌ Cannot resume feature ${paddedId} from state "${snapshot.currentSpecState}".`);
            }

            const found = findFile(PATHS.features, paddedId, ['06-paused', '03-in-progress']);
            if (!found) return console.error(`❌ Could not find feature "${paddedId}" in paused or in-progress.`);
            const specFromPath = path.join(PATHS.features.root, '06-paused', found.file);
            const specToPath = path.join(PATHS.features.root, '03-in-progress', found.file);

            await wf.resumeFeature(repoPath, paddedId);

            const resumeEffects = (specFromPath && specToPath && specFromPath !== specToPath)
                ? [{ id: 'resume.move_spec', type: 'move_spec', payload: { fromPath: specFromPath, toPath: specToPath } }]
                : [];
            const result = await persistAndRunEffects(repoPath, paddedId, resumeEffects, engineOpts);

            if (result.kind === 'error') { process.exitCode = 1; return console.error(`❌ ${result.message}`); }
            if (result.kind === 'busy') { process.exitCode = 1; return console.error(`⏳ ${result.message}`); }

            console.log(`✅ Resumed: ${found.file} -> 03-in-progress/`);
        },

        'feature-unprioritise': async (args) => {
            const id = args[0];
            if (!id) return console.error("Usage: aigon feature-unprioritise <ID>");

            const paddedId = String(id).padStart(2, '0');
            const repoPath = process.cwd();
            const engineOpts = args.includes('--reclaim') ? { claimTimeoutMs: 1 } : {};

            if (!(await wf.showFeatureOrNull(repoPath, paddedId))) {
                process.exitCode = 1;
                return console.error(`❌ Feature ${paddedId} has no workflow-core snapshot.\n   Run \`aigon doctor --fix\` to migrate legacy features, then retry.`);
            }

            const snapshot = await wf.showFeature(repoPath, paddedId);
            const workflowId = String(snapshot.featureId || paddedId);

            if (snapshot.currentSpecState !== 'backlog') {
                process.exitCode = 1;
                return console.error(`❌ Cannot unprioritise feature ${paddedId} from state "${snapshot.currentSpecState}". Feature must be in backlog.`);
            }

            const found = findFile(PATHS.features, paddedId, ['02-backlog']);
            if (!found) return console.error(`❌ Could not find feature "${paddedId}" in backlog.`);

            const specFromPath = path.join(PATHS.features.root, '02-backlog', found.file);
            const numericNamed = /^feature-\d+-(.+)\.md$/.exec(found.file);
            let inboxFilename = found.file;
            if (numericNamed) {
                inboxFilename = `feature-${numericNamed[1]}.md`;
            }
            const specToPath = path.join(PATHS.features.root, '01-inbox', inboxFilename);

            if (numericNamed && fs.existsSync(specToPath)) {
                process.exitCode = 1;
                return console.error(`❌ Inbox already contains ${inboxFilename}; refusing to overwrite.`);
            }

            let effectFeatureId = workflowId;
            if (numericNamed) {
                const slugId = numericNamed[1];
                try {
                    wf.migrateEntityWorkflowIdSync(repoPath, 'feature', workflowId, slugId, specToPath, 'inbox');
                } catch (err) {
                    process.exitCode = 1;
                    return console.error(`❌ ${err.message}`);
                }
                effectFeatureId = slugId;
            } else {
                await wf.persistEvents(repoPath, workflowId, [{
                    type: 'feature.bootstrapped',
                    featureId: workflowId,
                    stage: 'inbox',
                    lifecycle: 'inbox',
                    at: new Date().toISOString(),
                }]);
            }

            const unprioritiseEffects = [
                { id: 'unprioritise.move_spec', type: 'move_spec', payload: { fromPath: specFromPath, toPath: specToPath } }
            ];
            const result = await persistAndRunEffects(repoPath, effectFeatureId, unprioritiseEffects, engineOpts);

            if (result.kind === 'error') { process.exitCode = 1; return console.error(`❌ ${result.message}`); }
            if (result.kind === 'busy') { process.exitCode = 1; return console.error(`⏳ ${result.message}`); }

            try {
                const { runGit } = ctx.git;
                runGit(`git add ${PATHS.features.root.replace(process.cwd() + '/', '')}/`);
                runGit(`git commit -m "chore: unprioritise feature ${workflowId} - move to inbox"`);
                console.log(`📝 Committed feature unprioritisation`);
            } catch (e) {
                console.warn(`⚠️  Could not commit: ${e.message}`);
            }

            console.log(`✅ Moved: ${found.file} -> 01-inbox/${inboxFilename}`);
        },

        'feature-delete': async (args) => {
            await entity.entityDelete(def, args[0], ctx);
        },

        'feature-now': (args) => withActionDelegate('feature-now', args, ctx, () => {
            const name = args.join(' ').trim();
            if (!name) return console.error("Usage: aigon feature-now <name>\nFast-track: create + prioritise + setup in one step (Drive mode)\nExample: aigon feature-now dark-mode");

            const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

            // Check for existing feature with same slug
            const existing = findFile(PATHS.features, slug);
            if (existing) {
                return console.error(`❌ Feature already exists: ${existing.file} (in ${existing.folder})`);
            }

            // Assign ID
            const nextId = getNextId(PATHS.features);
            const paddedId = String(nextId).padStart(2, '0');
            const filename = `feature-${paddedId}-${slug}.md`;

            // Run pre-hook
            const hookContext = {
                featureId: paddedId,
                featureName: slug,
                mode: 'drive',
                agents: []
            };
            if (!runPreHook('feature-now', hookContext)) {
                return;
            }

            // Ensure in-progress directory exists
            const inProgressDir = path.join(PATHS.features.root, '03-in-progress');
            if (!fs.existsSync(inProgressDir)) {
                fs.mkdirSync(inProgressDir, { recursive: true });
            }

            // Create spec directly in 03-in-progress
            const template = readTemplate('specs/feature-template.md');
            const content = template.replace(/\{\{NAME\}\}/g, name);
            const specPath = path.join(inProgressDir, filename);
            fs.writeFileSync(specPath, content);
            console.log(`✅ Created spec: ./docs/specs/features/03-in-progress/${filename}`);

            // Create branch
            const branchName = `feature-${paddedId}-${slug}`;
            try {
                runGit(`git checkout -b ${branchName}`);
                console.log(`🌿 Created branch: ${branchName}`);
            } catch (e) {
                try {
                    runGit(`git checkout ${branchName}`);
                    console.log(`🌿 Switched to branch: ${branchName}`);
                } catch (e2) {
                    console.error(`❌ Failed to create/switch branch: ${e2.message}`);
                    return;
                }
            }

            const logsDir = path.join(PATHS.features.root, 'logs');
            const logName = `feature-${paddedId}-${slug}-log.md`;
            const logPath = path.join(logsDir, logName);
            const writeNowLog = shouldWriteImplementationLogStarter({
                mode: 'drive',
                loggingLevel: loadProjectConfig(process.cwd()).logging_level,
            });
            if (writeNowLog) {
                if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
                if (!fs.existsSync(logPath)) {
                    const logTemplate = `# Implementation Log: Feature ${paddedId} - ${slug}\n\n## Plan\n\n## Progress\n\n## Decisions\n`;
                    fs.writeFileSync(logPath, logTemplate);
                    console.log(`📝 Log: ./docs/specs/features/logs/${logName}`);
                }
            }

            // Single atomic commit
            try {
                runGit(`git add docs/specs/features/`);
                runGit(`git commit -m "chore: create and start feature ${paddedId} - ${slug}"`);
                console.log(`📝 Committed feature creation and setup`);
            } catch (e) {
                console.warn(`⚠️  Could not commit: ${e.message}`);
            }

            // Run post-hook
            runPostHook('feature-now', hookContext);

            console.log(`\n🚗 Feature ${paddedId} ready for implementation!`);
            console.log(`   Spec: ./docs/specs/features/03-in-progress/${filename}`);
            if (writeNowLog) console.log(`   Log:  ./docs/specs/features/logs/${logName}`);
            console.log(`   Branch: ${branchName}`);
            console.log(`\n📝 Next: Write the spec, then implement.`);
            console.log(`   When done: aigon feature-close ${paddedId}`);
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
            spawnSync('tmux', ['send-keys', '-t', sessionName, '-l', feedbackPrompt], { stdio: 'ignore' });
            spawnSync('sleep', ['0.1'], { stdio: 'ignore' });
            spawnSync('tmux', ['send-keys', '-t', sessionName, 'C-m'], { stdio: 'ignore' });
            writeAgentStatus(id, implAgent, { status: 'addressing-review', taskType: 'revise' });
            console.log(`✅ Revise prompt injected into session: ${sessionName}`);
        },

        'feature-close': async (args) => {
            const close = require('../feature-close');

            // Phase 1: Resolve target (args, spec, mode, branch)
            const target = close.resolveCloseTarget(args, {
                PATHS, findFile, getWorktreeBase, findWorktrees, filterByFeatureId,
                branchExists, resolveFeatureSpecInfo, gitLib, actionName: 'feature-close',
            });
            if (!target.ok) {
                if (target.delegate) {
                    console.log(`📡 Delegating 'feature-close' to main repo...`);
                    runDelegatedAigonCommand(target.delegate, 'feature-close', args);
                    return;
                }
                process.exitCode = 1; return console.error(target.error);
            }

            // Phase 2: Resume check — detect interrupted close
            const resumeState = await close.checkResumeState(target.repoPath, target.name, persistAndRunEffects);
            if (resumeState === 'done') return;
            if (resumeState === 'busy' || resumeState === 'error') { process.exitCode = 1; return; }
            const isResume = resumeState === 'resumed';

            // Phase 3: Pre-hook
            if (!runPreHook('feature-close', target.hookContext)) return;

            // Phase 3.5: Pre-validate engine transition before git side-effects (feature 233).
            if (!isResume) {
                // Apply the same legacy "agents:[]" recovery the engine close phase uses,
                // so the validation reflects what the actual close will see.
                let preCheckSnapshot = await wf.showFeatureOrNull(target.repoPath, target.name);
                preCheckSnapshot = await close.recoverEmptyAgents(target.repoPath, target.name, preCheckSnapshot);
                const closable = await wf.canCloseFeature(target.repoPath, target.name);
                if (!closable.ok) {
                    process.exitCode = 1;
                    return console.error(
                        `❌ ${closable.reason}\n   Run \`aigon agent-status implementation-complete\` first, ` +
                        `then re-run \`aigon feature-close ${target.name}\`.`,
                    );
                }
            }

            // Phase 3.7: Remote PR awareness (GitHub-only, automatic)
            let remoteGateState = null;
            const prCheckEnabled = loadProjectConfig(target.repoPath).github?.prCheck !== false;
            if (!isResume && prCheckEnabled) {
                const { checkGitHubGate } = require('../remote-gate-github');
                const defaultBranch = getDefaultBranch();
                const gateResult = checkGitHubGate(target.branchName, defaultBranch);
                if (!gateResult.ok) {
                    process.exitCode = 1;
                    return console.error(`❌ Remote PR blocked close: ${gateResult.message}`);
                }
                remoteGateState = gateResult.state || gateResult.mode || null;
                if (remoteGateState === 'merged') {
                    console.log(`✅ Remote PR already merged — PR #${gateResult.prNumber} (${gateResult.url})`);
                }
            }

            // Phase 4: Auto-commit and push (skip on resume — merge already done)
            if (!isResume) {
                if (remoteGateState !== 'merged') {
                    const commitResult = close.autoCommitAndPush(target, {
                        getCurrentBranch, runGit,
                        getGitStatusPorcelain: u.getGitStatusPorcelain,
                        getWorktreeStatus: u.getWorktreeStatus,
                    });
                    if (!commitResult.ok) { process.exitCode = 1; return console.error(commitResult.error); }
                }
            }

            // Phase 5: Merge (skip on resume)
            let mergeResult;
            if (!isResume) {
                if (remoteGateState === 'merged') {
                    mergeResult = close.syncRemoteMergedBranch(target, {
                        getDefaultBranch,
                        runGit,
                        getCurrentBranch,
                        getGitStatusPorcelain: gitStatusPorcelain,
                    });
                } else {
                    mergeResult = close.mergeFeatureBranch(target, {
                        getDefaultBranch,
                        runGit,
                        getCurrentBranch,
                        getGitStatusPorcelain: gitStatusPorcelain,
                    });
                }
                if (!mergeResult.ok) {
                    process.exitCode = 1;
                    console.error(mergeResult.error);
                    await close.recordCloseFailure(target.repoPath, target.name, mergeResult.error, 1);
                    return;
                }
            } else {
                mergeResult = { ok: true, defaultBranch: getDefaultBranch(), preMergeBaseRef: getDefaultBranch() };
            }

            // Phase 6: Telemetry
            const allAgents = await close.resolveAllAgents(target.repoPath, target.name, target.agentId);
            close.recordCloseTelemetry(target, mergeResult, allAgents, {
                PATHS, getWorktreeBase, getFeatureGitSignals,
                estimateExpectedScopeFiles, upsertLogFrontmatterScalars,
            });

            // Phase 6.5a: Archive session transcripts to durable hot tier (before worktree is deleted)
            close.finaliseTranscripts(target);

            // Phase 6.5: Snapshot final stats (before worktree is deleted)
            close.snapshotFinalStats(target, {
                getDefaultBranch,
                preMergeBaseRef: mergeResult.preMergeBaseRef,
            });

            // Phase 7: Engine state transition
            const engineResult = await close.closeEngineState(target, allAgents, {
                PATHS, findFile, defaultEffectExecutor, persistAndRunEffects,
                resolveFeatureMode, safeWriteWithStatus: u.safeWriteWithStatus,
            });
            if (!engineResult.ok) { process.exitCode = 1; return console.error(engineResult.error); }
            if (engineResult.alreadyClosed) return;

            // Phase 8: Commit spec move
            close.commitSpecMove(target, engineResult, { PATHS, findFile, runGit, stagePaths });

            // Phase 8.5: After a remote PR merge, push the final close-state commit
            // so remote main reflects the authoritative done-spec outcome as well.
            if (mergeResult.remoteMerged) {
                close.pushRemoteMergedCloseCommit(mergeResult.defaultBranch, { runGit });
            }

            // Phase 9: Cleanup worktree and branch
            close.cleanupWorktreeAndBranch(target, {
                runGit, safeRemoveWorktree: u.safeRemoveWorktree,
                getWorktreeStatus: u.getWorktreeStatus,
                forceDeleteBranch: !!mergeResult.remoteMerged,
                deleteRemoteBranch: !!mergeResult.remoteMerged,
            });

            // Phase 10: Fleet adoption (multi-agent only)
            close.handleFleetAdoption(target, {
                listBranches, findWorktrees, filterByFeatureId,
                safeRemoveWorktree: u.safeRemoveWorktree,
                removeWorktreePermissions, removeWorktreeTrust,
            });

            // Phase 11: Post-close actions
            close.postCloseActions(target, {
                gcCaddyRoutes, runPostHook, loadProjectConfig, runDeployCommand,
            });

            // Phase 12: Auto-restart aigon server if lib/*.js changed (feature 228).
            try {
                const { isProcessAlive: proxyIsProcessAlive, getAigonServerAppId, isPortInUseSync } = require('../proxy');
                const { getConfiguredServerPort } = require('../config');
                const serverAppId = getAigonServerAppId();
                close.restartServerIfLibChanged(
                    { preMergeBaseRef: mergeResult.preMergeBaseRef },
                    {
                        getChangedLibFiles: (baseRef) => {
                            const out = execSync(
                                `git diff --name-only ${baseRef}..HEAD -- 'lib/**/*.js'`,
                                { encoding: 'utf8', cwd: target.repoPath, stdio: ['ignore', 'pipe', 'ignore'] }
                            );
                            return String(out || '').trim().split('\n').filter(Boolean);
                        },
                        getServerRegistryEntry: () => {
                            const port = getConfiguredServerPort();
                            if (isPortInUseSync(port)) {
                                try {
                                    const pids = require('child_process').execSync(`lsof -ti tcp:${port}`, { encoding: 'utf8', stdio: 'pipe' }).trim();
                                    if (pids) return { pid: parseInt(pids.split('\n')[0], 10), port };
                                } catch (_) {}
                            }
                            return null;
                        },
                        isProcessAlive: proxyIsProcessAlive,
                        loadProjectConfig,
                        restartServer: () => {
                            runDelegatedAigonCommand(target.repoPath, 'server', ['restart']);
                        },
                        writeRestartMarker: (marker) => close.writeRestartMarkerFile(target.repoPath, marker),
                        log: (m) => console.log(m),
                        warn: (m) => console.warn(m),
                    }
                );
            } catch (e) {
                // Never let the restart phase break a successful close.
                console.warn(`⚠️  Server restart phase errored: ${e.message}`);
            }

            // Re-surface stash-pop conflicts at end of run (see restoreAutoStash() in feature-close.js).
            if (mergeResult && mergeResult.stashPopConflicted) {
                const files = mergeResult.stashPopConflicted;
                console.warn('');
                console.warn('⚠️  FEATURE CLOSED, but your auto-stash did not restore cleanly.');
                console.warn(`⚠️  ${files.length} file(s) still have unresolved conflict markers:`);
                files.forEach(f => console.warn(`      ${f}`));
                console.warn('⚠️  Resolve before running further aigon commands (see warning above for exact commands).');
                console.warn('');
                process.exitCode = 1;
            }
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
            const dryRun = args.includes('--dry-run');
            const repoArg = args.find(a => a.startsWith('--repo='));
            const targetRepo = repoArg ? repoArg.slice('--repo='.length) : null;
            const excludeAboveArg = args.find(a => a.startsWith('--exclude-above='));
            const excludeAboveHours = excludeAboveArg ? parseFloat(excludeAboveArg.slice('--exclude-above='.length)) : null;
            // Active hours: 08:00 – 23:00 local → anything outside = "autonomous"
            const activeHourStart = 8;
            const activeHourEnd = 23;

            const repos = readConductorReposFromGlobalConfig();
            if (!repos || repos.length === 0) {
                return console.error('❌ No repos registered in global config. Add repos to ~/.aigon/config.json first.');
            }

            // repos is an array of path strings
            const repoPaths = repos.map(r => (typeof r === 'string' ? r : r.path)).filter(Boolean);

            const filteredPaths = targetRepo
                ? repoPaths.filter(p => p.includes(targetRepo))
                : repoPaths;

            if (filteredPaths.length === 0) {
                return console.error(`❌ No repos matched --repo=${targetRepo}`);
            }

            let totalPatched = 0;
            let totalSkipped = 0;
            let totalErrors = 0;

            filteredPaths.forEach(repoPath => {
                if (!repoPath || !fs.existsSync(repoPath)) return;

                const logsDir = path.join(repoPath, 'docs/specs/features/logs');
                if (!fs.existsSync(logsDir)) return;

                const logFiles = fs.readdirSync(logsDir)
                    .filter(f => f.endsWith('-log.md') && !fs.lstatSync(path.join(logsDir, f)).isDirectory())
                    .sort();

                console.log(`\n📁 ${repoPath} (${logFiles.length} logs)`);

                logFiles.forEach(logFile => {
                    const logPath = path.join(logsDir, logFile);
                    let content;
                    try { content = fs.readFileSync(logPath, 'utf8'); } catch (e) { totalErrors++; return; }

                    const { fields, events } = _parseLogFrontmatterForBackfill(content);
                    const patches = {};

                    // --- Infer startedAt ---
                    if (!fields.startedAt) {
                        let startedAt = null;
                        try {
                            const gitOut = execSync(
                                `git -C "${repoPath}" log --follow --diff-filter=A --format="%aI" -- "docs/specs/features/logs/${logFile}" 2>/dev/null`,
                                { encoding: 'utf8', timeout: 8000 }
                            ).trim();
                            if (gitOut) startedAt = gitOut.split('\n').pop().trim(); // oldest = last line
                        } catch (_) {}

                        // Also try logs/ root (before selected/)
                        if (!startedAt) {
                            try {
                                const gitOut = execSync(
                                    `git -C "${repoPath}" log --follow --diff-filter=A --format="%aI" -- "docs/specs/features/logs/${logFile}" 2>/dev/null`,
                                    { encoding: 'utf8', timeout: 8000 }
                                ).trim();
                                if (gitOut) startedAt = gitOut.split('\n').pop().trim();
                            } catch (_) {}
                        }

                        if (startedAt) patches.setStartedAt = startedAt;
                    }

                    // --- Infer completedAt ---
                    if (!fields.completedAt) {
                        let completedAt = null;
                        try {
                            const gitOut = execSync(
                                `git -C "${repoPath}" log --diff-filter=A --format="%aI" -- "docs/specs/features/logs/${logFile}" 2>/dev/null`,
                                { encoding: 'utf8', timeout: 8000 }
                            ).trim();
                            if (gitOut) completedAt = gitOut.split('\n')[0].trim(); // newest = first line
                        } catch (_) {}

                        if (!completedAt) {
                            try {
                                const gitOut = execSync(
                                    `git -C "${repoPath}" log -1 --format="%aI" -- "docs/specs/features/logs/${logFile}" 2>/dev/null`,
                                    { encoding: 'utf8', timeout: 8000 }
                                ).trim();
                                if (gitOut) completedAt = gitOut.trim();
                            } catch (_) {}
                        }

                        if (completedAt) patches.forceCompletedAt = completedAt;
                    }

                    // --- Auto-set cycleTimeExclude if --exclude-above threshold exceeded ---
                    if (excludeAboveHours !== null && !isNaN(excludeAboveHours) && fields.cycleTimeExclude === undefined) {
                        const startTs = patches.setStartedAt || fields.startedAt;
                        const endTs = patches.forceCompletedAt || fields.completedAt;
                        if (startTs && endTs) {
                            const durationHours = (new Date(endTs).getTime() - new Date(startTs).getTime()) / 3600000;
                            if (durationHours > excludeAboveHours) {
                                patches.setCycleTimeExclude = true;
                            }
                        }
                    }

                    // --- Infer autonomyRatio ---
                    if (fields.autonomyRatio === undefined) {
                        let autonomyRatio = null;
                        try {
                            const featureMatch = logFile.match(/^feature-(\d+)-/);
                            if (featureMatch) {
                                const gitOut = execSync(
                                    `git -C "${repoPath}" log --format="%aI" -- "docs/specs/features/logs/${logFile}" "docs/specs/features/logs/${logFile}" 2>/dev/null`,
                                    { encoding: 'utf8', timeout: 8000 }
                                ).trim();
                                if (gitOut) {
                                    const commitTimes = gitOut.split('\n').map(s => s.trim()).filter(Boolean);
                                    if (commitTimes.length > 0) {
                                        const autonomous = commitTimes.filter(ts => {
                                            const d = new Date(ts);
                                            const hour = d.getHours(); // local time
                                            return hour < activeHourStart || hour >= activeHourEnd;
                                        });
                                        autonomyRatio = (autonomous.length / commitTimes.length).toFixed(2);
                                    }
                                }
                            }
                        } catch (_) {}

                        if (autonomyRatio !== null) patches.setAutonomyRatio = autonomyRatio;
                    }

                    const patchCount = Object.keys(patches).length;
                    if (patchCount === 0) {
                        totalSkipped++;
                        return;
                    }

                    const patchDesc = Object.entries(patches).map(([k, v]) => {
                        const name = k.replace('set', '').replace('force', '').toLowerCase();
                        const val = typeof v === 'string' ? v.slice(0, 10) : v;
                        return `${name}=${val}`;
                    }).join(', ');

                    console.log(`  ${dryRun ? '[dry-run] ' : ''}${logFile}: ${patchDesc}`);

                    if (!dryRun) {
                        // NOTE: Log frontmatter writes removed — timestamps now live in manifests.
                        // This command is now dry-run only (reports what would change).
                        console.log(`    ⚠️  Skipped write — log frontmatter is deprecated. Use manifests for timestamps.`);
                        totalSkipped++;
                    } else {
                        totalPatched++;
                    }
                });
            });

            console.log(`\n${dryRun ? '[dry-run] ' : ''}✅ Done: ${totalPatched} patched, ${totalSkipped} skipped (already set), ${totalErrors} errors`);
            if (dryRun) console.log('   Run without --dry-run to apply patches.');
        },

        'feature-autonomous-start': async (args) => {
            const featureAutonomous = require('../feature-autonomous');
            await featureAutonomous.run(args, handlerDeps);
        },

        'feature-autopilot': async () => {
            console.error('❌ feature-autopilot has been removed.');
            console.error('   Use: aigon feature-autonomous-start <id> <agents...> [--eval-agent=<agent>] [--review-agent=<agent>] [--stop-after=implement|eval|review|close]');
            process.exitCode = 1;
        },

        'feature-open': (args) => {
            const featureIds = [];
            let agentCode = null;
            let terminalOverride = null;
            let allFlag = false;
            args.forEach(arg => {
                if (arg.startsWith('--terminal=')) terminalOverride = arg.split('=')[1];
                else if (arg.startsWith('-t=')) terminalOverride = arg.split('=')[1];
                else if (arg.startsWith('--agent=')) agentCode = arg.split('=')[1];
                else if (arg === '--all') allFlag = true;
                else if (/^\d+$/.test(arg)) featureIds.push(arg);
                else if (!arg.startsWith('-')) agentCode = arg; // legacy positional
            });

            if (featureIds.length === 0) {
                console.error(`❌ Feature ID is required.\n`);
                console.error(`Usage:`);
                console.error(`  aigon feature-open <ID> [agent]          Open single worktree`);
                console.error(`  aigon feature-open <ID> --all           Open all Fleet worktrees side-by-side`);
                console.error(`  aigon feature-open <ID> <ID>... [--agent=<code>]`);
                console.error(`                                           Open multiple features side-by-side`);
                return;
            }

            // Find all worktrees
            let allWorktrees;
            try {
                allWorktrees = findWorktrees();
            } catch (e) {
                return console.error(`❌ Could not list worktrees: ${e.message}`);
            }

            if (allWorktrees.length === 0) {
                return console.error(`❌ No worktrees found.\n\n   Create one with: aigon feature-start <ID> <agent>`);
            }

            // Determine terminal app (project config > global config > default)
            const effectiveConfig = getEffectiveConfig();
            const terminalApp = terminalOverride || effectiveConfig.terminalApp || 'apple-terminal';

            // Determine mode
            if (featureIds.length > 1) {
                // --- PARALLEL MODE: multiple features side-by-side ---
                const worktreeConfigs = [];
                const errors = [];

                for (const fid of featureIds) {
                    let matches = filterByFeatureId(allWorktrees, fid);

                    if (agentCode) {
                        const agentMap = buildAgentAliasMap();
                        const normalizedAgent = agentMap[agentCode.toLowerCase()] || agentCode.toLowerCase();
                        matches = matches.filter(wt => wt.agent === normalizedAgent);
                    }

                    if (matches.length === 0) {
                        errors.push(`Feature ${fid}: no worktree found${agentCode ? ` for agent ${agentCode}` : ''}`);
                    } else if (matches.length > 1 && !agentCode) {
                        const agents = matches.map(wt => wt.agent).join(', ');
                        errors.push(`Feature ${fid}: multiple worktrees (${agents}). Use --agent=<code> to specify.`);
                    } else {
                        const wt = matches[0];
                        worktreeConfigs.push({ ...wt, agentCommand: buildAgentCommand(wt) });
                    }
                }

                if (errors.length > 0) {
                    console.error(`❌ Cannot open parallel worktrees:\n`);
                    errors.forEach(err => console.error(`   ${err}`));
                    return;
                }

                const idsLabel = featureIds.join(', ');

                if (terminalApp === 'warp') {
                    const configName = `parallel-features-${featureIds.join('-')}`;
                    const title = `Parallel: Features ${idsLabel}`;

                    try {
                        const configFile = openInWarpSplitPanes(worktreeConfigs, configName, title);

                        console.log(`\n🚀 Opening ${worktreeConfigs.length} features side-by-side in Warp:`);
                        console.log(`   Features: ${idsLabel}\n`);
                        worktreeConfigs.forEach(wt => {
                            console.log(`   ${wt.featureId.padEnd(4)} ${wt.agent.padEnd(8)} → ${wt.path}`);
                        });
                        console.log(`\n   Warp config: ${configFile}`);
                    } catch (e) {
                        console.error(`❌ Failed to open Warp: ${e.message}`);
                    }
                } else {
                    console.log(`\n🚀 Opening ${worktreeConfigs.length} features via tmux sessions:`);
                    worktreeConfigs.forEach(wt => {
                        openSingleWorktree(wt, wt.agentCommand, terminalApp);
                    });
                }
            } else if (allFlag) {
                // --- ARENA MODE: all agents for one feature side-by-side ---
                const featureId = featureIds[0];
                const paddedId = String(featureId).padStart(2, '0');
                let worktrees = filterByFeatureId(allWorktrees, featureId);

                if (worktrees.length === 0) {
                    return console.error(`❌ No worktrees found for feature ${featureId}.\n\n   Create worktrees with: aigon feature-start ${featureId} cc gg`);
                }

                if (worktrees.length < 2) {
                    return console.error(`❌ Only 1 worktree found for feature ${featureId}. Use \`aigon feature-open ${featureId}\` for single worktrees.\n\n   To add more agents: aigon feature-start ${featureId} cc gg cx`);
                }

                // Sort by port offset order (cc=+1, gg=+2, cx=+3, cu=+4)
                const agentOrder = agentRegistry.getSortedAgentIds();
                worktrees.sort((a, b) => {
                    const aIdx = agentOrder.indexOf(a.agent);
                    const bIdx = agentOrder.indexOf(b.agent);
                    return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
                });

                const profile = u.getActiveProfile();
                const worktreeConfigs = worktrees.map(wt => {
                    const agentMeta = AGENT_CONFIGS[wt.agent] || {};
                    const port = profile.devServer.enabled ? (profile.devServer.ports[wt.agent] || agentMeta.port) : null;
                    const portLabel = port ? `🔌 ${agentMeta.name || wt.agent} — Port ${port}` : null;
                    return {
                        ...wt,
                        agentCommand: buildAgentCommand(wt),
                        portLabel
                    };
                });

                if (terminalApp === 'warp') {
                    const configName = `arena-feature-${paddedId}`;
                    const desc = worktreeConfigs[0].desc;
                    const title = `Arena: Feature ${paddedId} - ${desc}`;

                    try {
                        const configFile = openInWarpSplitPanes(worktreeConfigs, configName, title, 'cyan');

                        console.log(`\n🚀 Opening ${worktreeConfigs.length} worktrees side-by-side in Warp:`);
                        console.log(`   Feature: ${paddedId} - ${desc}\n`);
                        worktreeConfigs.forEach(wt => {
                            console.log(`   ${wt.agent.padEnd(8)} → ${wt.path}`);
                        });
                        console.log(`\n   Warp config: ${configFile}`);
                    } catch (e) {
                        console.error(`❌ Failed to open Warp: ${e.message}`);
                    }
                } else {
                    console.log(`\n🚀 Opening ${worktreeConfigs.length} Fleet worktrees via tmux sessions:`);
                    worktreeConfigs.forEach(wt => {
                        openSingleWorktree(wt, wt.agentCommand, terminalApp);
                    });
                }
            } else {
                // --- SINGLE MODE: open one worktree ---
                const featureId = featureIds[0];
                let worktrees = filterByFeatureId(allWorktrees, featureId);

                if (worktrees.length === 0) {
                    return console.error(`❌ No worktrees found for feature ${featureId}`);
                }

                // Filter by agent if provided
                if (agentCode) {
                    const agentMap = buildAgentAliasMap();
                    const normalizedAgent = agentMap[agentCode.toLowerCase()] || agentCode.toLowerCase();
                    worktrees = worktrees.filter(wt => wt.agent === normalizedAgent);

                    if (worktrees.length === 0) {
                        return console.error(`❌ No worktree found for feature ${featureId} with agent ${agentCode}`);
                    }
                }

                // Select worktree: if multiple, pick most recently modified
                let selectedWt;
                if (worktrees.length === 1) {
                    selectedWt = worktrees[0];
                } else {
                    worktrees.sort((a, b) => b.mtime - a.mtime);
                    selectedWt = worktrees[0];
                    console.log(`ℹ️  Multiple worktrees found, opening most recent:`);
                    worktrees.forEach((wt, i) => {
                        const marker = i === 0 ? '→' : ' ';
                        console.log(`   ${marker} ${wt.featureId}-${wt.agent}: ${wt.path}`);
                    });
                }

                const agentCommand = buildAgentCommand(selectedWt);
                openSingleWorktree(selectedWt, agentCommand, terminalApp);
            }
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
