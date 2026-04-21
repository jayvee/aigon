'use strict';

/**
 * Shared command factory for parallel feature/research lifecycle actions.
 *
 * Feature 292 collapsed the near-mirror handler pairs that used to exist in
 * lib/commands/feature.js and lib/commands/research.js. Every command here is
 * parameterised by an entity definition (FEATURE_DEF, RESEARCH_DEF) so
 * behaviour stays identical across entity types, and a new parallel command
 * requires editing ONE file rather than two.
 *
 * Entity-specific commands (feature-autonomous-start, research-autopilot, the
 * full feature-close/feature-eval pipeline, ...) stay in their respective
 * command modules. See AGENTS.md § Command module ownership.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const agentRegistry = require('../agent-registry');
const entity = require('../entity');
const wf = require('../workflow-core');
const { readHeadSpecReviewCommit } = require('../spec-review-state');
const { resolveAgentCommandPrompt } = require('../agent-prompt-resolver');
const workflowSnapshotAdapter = require('../workflow-snapshot-adapter');
const featureSpecResolver = require('../feature-spec-resolver');
const { parseFeatureSpecFileName } = require('../dashboard-status-helpers');

const SPEC_FOLDERS_ALL = [
    '01-inbox', '02-backlog', '03-in-progress',
    '04-in-evaluation', '05-done', '06-paused',
];

function parseEntitySpecFile(def, file) {
    if (!file) return null;
    const match = file.match(new RegExp(`^${def.prefix}-(\\d+)-(.+)\\.md$`));
    if (!match) return null;
    return { num: match[1], desc: match[2] };
}

function resolveEntitySpec(def, id, folders, ctx) {
    const found = ctx.specCrud.findFile(def.paths, id, folders);
    if (!found) return null;
    const parsed = parseEntitySpecFile(def, found.file);
    if (!parsed) return null;
    return { found, ...parsed };
}

function resolveEntitySpecPath(def, id, ctx) {
    if (def.type === 'feature') {
        const gitLib = ctx.git;
        const mainRepoPath = (gitLib && typeof gitLib.getMainRepoPath === 'function')
            ? gitLib.getMainRepoPath(process.cwd())
            : process.cwd();
        const snapshot = workflowSnapshotAdapter.readFeatureSnapshotSync(mainRepoPath, id);
        const resolved = featureSpecResolver.resolveFeatureSpec(mainRepoPath, id, { snapshot });
        if (!resolved.path) return null;
        const parsed = parseFeatureSpecFileName(path.basename(resolved.path));
        return { path: resolved.path, entityId: (parsed && (parsed.id || parsed.name)) || id };
    }
    const spec = resolveEntitySpec(def, id, SPEC_FOLDERS_ALL, ctx);
    if (!spec) return null;
    return { path: spec.found.fullPath, entityId: spec.num };
}

function resolveReviewAgentFromOptions(options, ctx, fallbackAgent = 'cc') {
    const u = ctx.utils;
    const availableAgents = u.getAvailableAgents();
    const aliasMap = u.buildAgentAliasMap();
    const raw = u.getOptionValue(options, 'agent');
    const resolvedAgent = raw
        ? (aliasMap[String(raw).toLowerCase()] || String(raw).toLowerCase())
        : fallbackAgent;
    if (!availableAgents.includes(resolvedAgent)) {
        console.error(`❌ Unknown agent '${raw || resolvedAgent}'. Supported agents: ${availableAgents.join(', ')}`);
        return null;
    }
    return resolvedAgent;
}

function launchPromptCommand({ commandName, entityId, agentId, argsString = '', modelTask = 'review', ctx }) {
    const u = ctx.utils;
    const cliConfig = u.getAgentCliConfig(agentId);
    const prompt = resolveAgentCommandPrompt({
        agentId,
        commandName,
        argsString: [String(entityId), String(argsString || '').trim()].filter(Boolean).join(' '),
        cliConfig,
    });
    const model = cliConfig.models?.[modelTask];
    if (!agentRegistry.supportsModelFlag(agentId) && model) {
        const agentName = agentRegistry.getAgent(agentId)?.displayName || agentId;
        console.warn(`⚠️  Model config ignored for ${agentName} — model selection is not supported via CLI flag`);
    }
    const modelTokens = (model && agentRegistry.supportsModelFlag(agentId)) ? ['--model', model] : [];
    const flagTokens = u.getAgentLaunchFlagTokens(cliConfig.command, cliConfig.implementFlag, { autonomous: false });
    const spawnArgs = [...flagTokens, ...modelTokens, prompt];
    const env = { ...process.env };
    if (cliConfig.command === 'claude') delete env.CLAUDECODE;
    const result = spawnSync(cliConfig.command, spawnArgs, { stdio: 'inherit', env });
    if (result.error) {
        console.error(`❌ Failed to launch agent: ${result.error.message}`);
        process.exitCode = 1;
    } else if (result.status !== 0) {
        process.exitCode = result.status || 1;
    }
}

function entitySpecReviewPrompt(def, args, commandName, ctx) {
    const u = ctx.utils;
    const options = u.parseCliOptions(args);
    const noLaunch = args.includes('--no-launch');
    const id = options._[0];
    if (!id) {
        console.error(`Usage: aigon ${commandName} <ID|slug> [--agent=<agent>]`);
        return;
    }
    const spec = resolveEntitySpecPath(def, id, ctx);
    if (!spec) {
        console.error(`❌ Could not resolve ${def.type} spec "${id}".`);
        return;
    }

    const sessionInfo = u.detectActiveAgentSession();
    if (!sessionInfo.detected && !noLaunch) {
        const agentId = resolveReviewAgentFromOptions(options, ctx);
        if (!agentId) return;
        launchPromptCommand({ commandName, entityId: id, agentId, ctx });
        return;
    }

    u.printAgentContextWarning(commandName, id);
    console.log(`📋 Spec: ./${path.relative(process.cwd(), spec.path)}`);
}

async function entityRecordSpecReviewFromHead(def, id, kind, ctx) {
    if (!id) {
        const suffix = kind === 'ack' ? '-check-record' : '-record';
        console.error(`Usage: aigon ${def.prefix}-spec-review${suffix} <ID|slug>`);
        process.exitCode = 1;
        return;
    }
    const spec = resolveEntitySpecPath(def, id, ctx);
    if (!spec) {
        console.error(`❌ Could not resolve ${def.type} spec "${id}".`);
        process.exitCode = 1;
        return;
    }
    try {
        const commit = readHeadSpecReviewCommit(process.cwd(), {
            entityType: def.type,
            entityId: spec.entityId,
            kind,
        });
        if (kind === 'review') {
            await wf.recordSpecReviewSubmitted(process.cwd(), def.type, spec.entityId, {
                reviewId: commit.sha,
                reviewerId: commit.reviewerId,
                summary: commit.parsed.summary,
                commitSha: commit.sha,
            });
        } else {
            await wf.recordSpecReviewAcknowledged(process.cwd(), def.type, spec.entityId, {
                ackedBy: process.env.AIGON_AGENT_ID || null,
                commitSha: commit.sha,
            });
        }
        console.log(`✅ Recorded ${def.type} spec review state for ${spec.entityId}`);
    } catch (error) {
        console.error(`❌ ${error.message}`);
        process.exitCode = 1;
    }
}

/**
 * Shared base reset: close sessions, clear state files, move spec to backlog,
 * remove engine state. Callers (feature-reset, research-reset) can pass
 * entity-specific steps via `extraSteps` to handle worktrees/findings.
 */
async function entityResetBase(def, id, ctx, extraSteps = {}) {
    const u = ctx.utils;
    const parsed = parseInt(id, 10);
    const paddedId = String(Number.isNaN(parsed) ? id : parsed).padStart(2, '0');
    const unpaddedId = Number.isNaN(parsed) ? String(id) : String(parsed);
    const candidateIds = [...new Set([paddedId, unpaddedId])];

    console.log(`\n🔄 Resetting ${def.type} ${paddedId}...\n`);

    // Step 1: close active sessions
    if (typeof extraSteps.closeSessions === 'function') {
        try { extraSteps.closeSessions(id); }
        catch (e) { console.warn(`   ⚠️  sessions-close step failed: ${e.message}`); }
    }

    // Step 2: entity-specific pre-cleanup (worktrees, findings, etc.)
    let extraResult = {};
    if (typeof extraSteps.preCleanup === 'function') {
        extraResult = (await extraSteps.preCleanup({ paddedId, unpaddedId, candidateIds })) || {};
    }

    // Step 3: move spec back to 02-backlog
    let specMoved = false;
    const foldersToSearch = def.type === 'research'
        ? ['03-in-progress', '04-in-evaluation', '06-paused']
        : ['03-in-progress', '04-in-evaluation', '05-done', '06-paused'];
    const found = ctx.specCrud.findFile(def.paths, id, foldersToSearch);
    if (found) {
        const targetDir = path.join(def.paths.root, '02-backlog');
        const specBasename = path.basename(found.fullPath);
        const targetPath = path.join(targetDir, specBasename);
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        fs.renameSync(found.fullPath, targetPath);
        console.log(`   📂 Moved spec to backlog: ${specBasename}`);
        specMoved = true;
        try {
            spawnSync('git', ['add', 'docs/specs/features/'], { stdio: 'pipe' });
            const commitResult = spawnSync('git', ['commit', '-m', `chore: reset ${def.type} ${paddedId} - move spec to backlog`], { stdio: 'pipe' });
            if (commitResult.status === 0) {
                console.log(`   📝 Committed spec move to backlog`);
            }
        } catch (e) {
            console.warn(`   ⚠️  Could not commit spec move to backlog: ${e.message}`);
        }
    }

    // Step 4: remove engine state
    let engineRemoved = false;
    try {
        const resetFn = def.type === 'research' ? wf.resetResearch : wf.resetFeature;
        const result = await resetFn(process.cwd(), paddedId);
        if (result && result.removed) {
            engineRemoved = true;
            console.log(`   🗑️  Removed workflow engine state: .aigon/workflows/${def.type === 'research' ? 'research' : 'features'}/${paddedId}/`);
        }
    } catch (e) {
        console.warn(`   ⚠️  Could not remove workflow engine state for ${paddedId}: ${e.message}`);
    }

    // Step 5: re-bootstrap engine state at backlog so the entity re-enters
    // the workflow as a first-class backlog item. Without this, a reset
    // leaves "spec on disk + no engine snapshot", which the read model now
    // treats as a hard error (F294 removed the compat fallback).
    //
    // Guarded: only bootstrap when a spec file still exists at backlog.
    // If the spec was deleted entirely (not a normal reset outcome), skip.
    let engineBootstrapped = false;
    if (specMoved) {
        try {
            await wf.ensureEntityBootstrapped(process.cwd(), def.type === 'research' ? 'research' : 'feature', paddedId, 'backlog');
            engineBootstrapped = true;
        } catch (e) {
            console.warn(`   ⚠️  Could not re-bootstrap engine state for ${paddedId}: ${e.message}`);
        }
    }

    // Step 6: entity-specific post-cleanup (gc caddy routes, etc.)
    if (typeof extraSteps.postCleanup === 'function') {
        try { extraSteps.postCleanup({ paddedId, unpaddedId, candidateIds }); }
        catch (e) { /* non-fatal */ }
    }

    return {
        paddedId,
        unpaddedId,
        candidateIds,
        specMoved,
        engineRemoved,
        engineBootstrapped,
        ...extraResult,
    };
}

/**
 * Shared command factory for parallel feature/research lifecycle commands.
 * Returns handlers for the actions that are strictly parameterised by `def`.
 * Callers merge these into their full command set and add entity-specific
 * overrides/extensions (feature-start, feature-close, research-open, ...).
 */
function createEntityCommands(def, ctx) {
    const cmds = {
        [`${def.prefix}-create`]: (args) => {
            entity.entityCreate(def, args[0], ctx);
        },

        [`${def.prefix}-prioritise`]: (args) => {
            if (!args[0]) return console.error(`Usage: aigon ${def.prefix}-prioritise <name or letter>`);
            entity.entityPrioritise(def, args[0], ctx);
        },

        [`${def.prefix}-spec-review`]: (args) => {
            entitySpecReviewPrompt(def, args, `${def.prefix}-spec-review`, ctx);
        },

        [`${def.prefix}-spec-review-check`]: (args) => {
            entitySpecReviewPrompt(def, args, `${def.prefix}-spec-review-check`, ctx);
        },

        [`${def.prefix}-spec-review-record`]: async (args) => {
            await entityRecordSpecReviewFromHead(def, args[0], 'review', ctx);
        },

        [`${def.prefix}-spec-review-check-record`]: async (args) => {
            await entityRecordSpecReviewFromHead(def, args[0], 'ack', ctx);
        },

        [`${def.prefix}-rename`]: (args) => {
            entity.entityRename(def, args[0], args.slice(1).join(' '), ctx);
        },
    };
    return cmds;
}

module.exports = {
    createEntityCommands,
    entityResetBase,
    // Helpers exported so command modules can reuse them when wiring
    // entity-specific overrides without duplicating the logic.
    resolveEntitySpec,
    resolveEntitySpecPath,
    parseEntitySpecFile,
    resolveReviewAgentFromOptions,
    launchPromptCommand,
    SPEC_FOLDERS_ALL,
};
