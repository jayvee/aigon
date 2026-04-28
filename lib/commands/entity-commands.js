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
const { readHeadSpecReviewCommit, isSpecReviewCycleAllowed } = require('../spec-review-state');
const { resolveAgentCommandPrompt, printTopAgentSuggestion } = require('../agent-prompt-resolver');
const workflowSnapshotAdapter = require('../workflow-snapshot-adapter');
const featureSpecResolver = require('../feature-spec-resolver');
const { parseFeatureSpecFileName } = require('../dashboard-status-helpers');
const { parseCliOptions, getOptionValue, parseFrontMatter } = require('../cli-parse');
const { getDefaultAgent } = require('../config');
const { collectTranscriptRecords, formatTranscriptCliOutput, openTranscriptPath } = require('../transcript-read');

/**
 * Resolve the owning agent for a spec-revision cycle.
 *
 * Precedence (feature 341):
 *   1. Event payload nextReviewerId (operator picker / CLI --agent)
 *   2. Frontmatter `agent:` field
 *   3. Snapshot `context.authorAgentId`
 *   4. getDefaultAgent() fallback
 *
 * @param {{nextReviewerId?: string, specPath?: string, snapshot?: object, repoPath?: string}} opts
 * @returns {string|null}
 */
function resolveSpecRevisionAgent(opts = {}) {
    const nextReviewerId = String(opts.nextReviewerId || '').trim();
    if (nextReviewerId) return nextReviewerId;

    if (opts.specPath && fs.existsSync(opts.specPath)) {
        try {
            const raw = fs.readFileSync(opts.specPath, 'utf8');
            const parsed = parseFrontMatter(raw);
            if (parsed && parsed.data && typeof parsed.data.agent === 'string' && parsed.data.agent.trim()) {
                return parsed.data.agent.trim();
            }
        } catch (_) { /* fall through */ }
    }

    if (opts.snapshot && opts.snapshot.authorAgentId) {
        return String(opts.snapshot.authorAgentId).trim() || null;
    }

    return getDefaultAgent(opts.repoPath || process.cwd());
}

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

function resolveReviewAgentFromOptions(options, ctx, fallbackAgent) {
    const u = ctx.utils;
    const availableAgents = u.getAvailableAgents();
    const aliasMap = u.buildAgentAliasMap();
    const raw = getOptionValue(options, 'agent');
    const defaultAgent = fallbackAgent || getDefaultAgent((ctx && ctx.repoPath) || process.cwd());
    const resolvedAgent = raw
        ? (aliasMap[String(raw).toLowerCase()] || String(raw).toLowerCase())
        : defaultAgent;
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
    const promptFlag = agentRegistry.getPromptFlag(agentId);
    const spawnArgs = [...flagTokens, ...modelTokens, ...(promptFlag ? [promptFlag] : []), prompt];
    const env = { ...process.env };
    if (cliConfig.command === 'claude') delete env.CLAUDECODE;
    const result = spawnSync(cliConfig.command, spawnArgs, { stdio: 'inherit', env }); // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
    if (result.error) {
        console.error(`❌ Failed to launch agent: ${result.error.message}`);
        process.exitCode = 1;
    } else if (result.status !== 0) {
        process.exitCode = result.status || 1;
    }
}

async function entitySpecReviewPrompt(def, args, commandName, ctx) {
    const u = ctx.utils;
    const options = parseCliOptions(args);
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

    const isCheck = /-revise$/.test(commandName);

    // REGRESSION: spec-review cycle is only valid for inbox/backlog entities.
    // spec-revise also allows spec_review_in_progress (an in-flight review cycle).
    {
        const snapshot = def.type === 'research'
            ? await wf.showResearchOrNull(process.cwd(), spec.entityId)
            : await wf.showFeatureOrNull(process.cwd(), spec.entityId);
        const lifecycle = snapshot && snapshot.lifecycle;
        const allowed = isCheck
            ? (isSpecReviewCycleAllowed(lifecycle) || lifecycle === 'spec_review_in_progress')
            : isSpecReviewCycleAllowed(lifecycle);
        if (!allowed) {
            const hint = isCheck ? 'inbox, backlog, or spec_review_in_progress' : 'inbox or backlog';
            console.error(`❌ Spec-review cycle is not allowed for ${def.type} ${id} (lifecycle: ${lifecycle || 'unknown'}).`);
            console.error(`   Spec review is only available when the entity is in: ${hint}.`);
            console.error(`   Use \`aigon ${def.prefix}-spec-review\` on an inbox or backlog item, or use code review for in-progress work.`);
            process.exitCode = 1;
            return;
        }
    }
    const sessionInfo = u.detectActiveAgentSession();
    const launchedInline = !sessionInfo.detected && !noLaunch;
    let agentIdForEvent;
    if (launchedInline) {
        if (isCheck) {
            // Spec-revise precedence: --agent flag > frontmatter agent: >
            // snapshot.authorAgentId > default. `resolveReviewAgentFromOptions`
            // already handles flag > default; inject frontmatter/snapshot
            // fallback via resolveSpecRevisionAgent.
            const rawAgentFlag = getOptionValue(options, 'agent');
            if (rawAgentFlag) {
                agentIdForEvent = resolveReviewAgentFromOptions(options, ctx);
            } else {
                const snapshot = def.type === 'research'
                    ? await wf.showResearchOrNull(process.cwd(), spec.entityId)
                    : await wf.showFeatureOrNull(process.cwd(), spec.entityId);
                agentIdForEvent = resolveSpecRevisionAgent({
                    specPath: spec.path,
                    snapshot,
                    repoPath: process.cwd(),
                });
                // Validate against available agents
                const aliasMap = u.buildAgentAliasMap();
                const available = u.getAvailableAgents();
                if (agentIdForEvent) {
                    agentIdForEvent = aliasMap[String(agentIdForEvent).toLowerCase()] || String(agentIdForEvent).toLowerCase();
                    if (!available.includes(agentIdForEvent)) {
                        console.error(`❌ Resolved agent '${agentIdForEvent}' is not available. Pass --agent=<id> explicitly.`);
                        return;
                    }
                }
            }
        } else {
            agentIdForEvent = resolveReviewAgentFromOptions(options, ctx);
        }
    } else {
        agentIdForEvent = String(process.env.AIGON_AGENT_ID || '').trim() || null;
    }

    if (launchedInline && !agentIdForEvent) return;

    if (agentIdForEvent) {
        try {
            if (isCheck) {
                await wf.recordSpecReviewCheckStarted(process.cwd(), def.type, spec.entityId, {
                    checkerId: agentIdForEvent,
                });
            } else {
                await wf.recordSpecReviewStarted(process.cwd(), def.type, spec.entityId, {
                    reviewerId: agentIdForEvent,
                });
            }
        } catch (error) {
            console.warn(`⚠️  Could not record ${isCheck ? 'spec-check' : 'spec-review'} start: ${error.message}`);
        }
    }

    if (launchedInline) {
        printTopAgentSuggestion('spec_review', spec.path);
        launchPromptCommand({ commandName, entityId: id, agentId: agentIdForEvent, ctx });
        return;
    }

    printTopAgentSuggestion('spec_review', spec.path);
    u.printAgentContextWarning(commandName, id);
    console.log(`📋 Spec: ./${path.relative(process.cwd(), spec.path)}`);
}

async function entityRecordSpecReviewFromHead(def, id, kind, ctx) {
    if (!id) {
        const cmdName = kind === 'ack' ? `${def.prefix}-spec-revise-record` : `${def.prefix}-spec-review-record`;
        console.error(`Usage: aigon ${cmdName} <ID|slug>`);
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

    // Step 7: verify nothing leaked. The reset earlier reported its work via
    // counters, but several cleanup paths used to swallow errors silently
    // (2026-04-28: heartbeat-* files were missed entirely, tmux sessions
    // could survive, etc.). This step re-checks the surfaces a reset is
    // supposed to clear and prints loud warnings — never throws — so the
    // green "✅ Reset complete" line cannot lie about leaked state.
    const leaks = collectResetLeaks(def, paddedId, unpaddedId);
    if (leaks.length > 0) {
        console.warn('\n⚠️  Reset verification found leftover state:');
        leaks.forEach(line => console.warn(`     ${line}`));
        console.warn('     The reset reported success but some surfaces were not cleared.');
        console.warn('     Run `aigon feature-reset <id>` again, or clean these manually.');
    }

    return {
        paddedId,
        unpaddedId,
        candidateIds,
        specMoved,
        engineRemoved,
        engineBootstrapped,
        leaks,
        ...extraResult,
    };
}

/**
 * Re-scan the surfaces a reset is supposed to clear and return any leftovers.
 * Pure observation — never deletes anything. Used by entityResetBase to
 * surface silent cleanup failures (the old reset path swallowed errors and
 * still printed a green check).
 */
function collectResetLeaks(def, paddedId, unpaddedId) {
    const leaks = [];
    const repo = process.cwd();

    // 1. State files in .aigon/state/ — same matcher as feature-reset's filter
    try {
        const stateDir = path.join(repo, '.aigon', 'state');
        if (fs.existsSync(stateDir)) {
            const matches = fs.readdirSync(stateDir).filter(f => (
                f.startsWith(`feature-${paddedId}-`) ||
                f.startsWith(`feature-${paddedId}.`) ||
                f.startsWith(`feature-${unpaddedId}-`) ||
                f.startsWith(`feature-${unpaddedId}.`) ||
                f.startsWith(`heartbeat-${paddedId}-`) ||
                f.startsWith(`heartbeat-${paddedId}.`) ||
                f.startsWith(`heartbeat-${unpaddedId}-`) ||
                f.startsWith(`heartbeat-${unpaddedId}.`)
            ));
            matches.forEach(f => leaks.push(`state file: .aigon/state/${f}`));
        }
    } catch (e) { /* observation only */ }

    // 2. Workflow engine dir
    try {
        const wfSubdir = def.type === 'research' ? 'research' : 'features';
        const wfDir = path.join(repo, '.aigon', 'workflows', wfSubdir, paddedId);
        if (fs.existsSync(wfDir)) leaks.push(`workflow dir: .aigon/workflows/${wfSubdir}/${paddedId}/`);
    } catch (e) { /* observation only */ }

    // 3. Live tmux sessions for this entity ID
    try {
        const list = spawnSync('tmux', ['list-sessions', '-F', '#S'], { encoding: 'utf8' });
        if (!list.error && list.status === 0) {
            const wt = require('../worktree');
            list.stdout.split('\n').map(s => s.trim()).filter(Boolean).forEach(name => {
                const m = wt.matchTmuxSessionByEntityId(name, paddedId);
                if (m && m.type === (def.type === 'research' ? 'r' : 'f')) {
                    leaks.push(`tmux session: ${name}`);
                }
            });
        }
    } catch (e) { /* observation only */ }

    // 4. Worktrees still on disk for features
    try {
        const wt = require('../worktree');
        const worktrees = wt.findWorktrees ? wt.findWorktrees() : [];
        const filtered = wt.filterByFeatureId
            ? wt.filterByFeatureId(worktrees, paddedId)
            : worktrees.filter(w => w.path && (w.path.includes(`feature-${paddedId}-`) || w.path.includes(`feature-${unpaddedId}-`)));
        filtered.forEach(w => leaks.push(`worktree: ${w.path}`));
    } catch (e) { /* observation only */ }

    return leaks;
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
            return entitySpecReviewPrompt(def, args, `${def.prefix}-spec-review`, ctx);
        },

        [`${def.prefix}-spec-revise`]: (args) => {
            return entitySpecReviewPrompt(def, args, `${def.prefix}-spec-revise`, ctx);
        },

        [`${def.prefix}-spec-review-record`]: async (args) => {
            await entityRecordSpecReviewFromHead(def, args[0], 'review', ctx);
        },

        [`${def.prefix}-spec-revise-record`]: async (args) => {
            await entityRecordSpecReviewFromHead(def, args[0], 'ack', ctx);
        },

        [`${def.prefix}-cancel-spec-review`]: async (args) => {
            const id = args[0];
            if (!id) return console.error(`Usage: aigon ${def.prefix}-cancel-spec-review <id>`);
            const paddedId = String(id).padStart(2, '0');
            const repoPath = process.cwd();
            const snapshot = def.type === 'research'
                ? await wf.showResearchOrNull(repoPath, paddedId)
                : await wf.showFeatureOrNull(repoPath, paddedId);
            if (!snapshot) { process.exitCode = 1; return console.error(`❌ ${def.prefix} ${paddedId} not found.`); }
            if (snapshot.lifecycle !== 'spec_review_in_progress') {
                process.exitCode = 1;
                return console.error(`❌ ${def.prefix} ${paddedId} is not in spec_review_in_progress (current: ${snapshot.lifecycle}).`);
            }
            await wf.recordSpecReviewCancelled(repoPath, def.type, paddedId);
            console.log(`✅ Spec review cancelled for ${def.prefix} ${paddedId}. Returned to backlog.`);
        },

        [`${def.prefix}-cancel-spec-revision`]: async (args) => {
            const id = args[0];
            if (!id) return console.error(`Usage: aigon ${def.prefix}-cancel-spec-revision <id>`);
            const paddedId = String(id).padStart(2, '0');
            const repoPath = process.cwd();
            const snapshot = def.type === 'research'
                ? await wf.showResearchOrNull(repoPath, paddedId)
                : await wf.showFeatureOrNull(repoPath, paddedId);
            if (!snapshot) { process.exitCode = 1; return console.error(`❌ ${def.prefix} ${paddedId} not found.`); }
            if (snapshot.lifecycle !== 'spec_revision_in_progress') {
                process.exitCode = 1;
                return console.error(`❌ ${def.prefix} ${paddedId} is not in spec_revision_in_progress (current: ${snapshot.lifecycle}).`);
            }
            await wf.recordSpecRevisionCancelled(repoPath, def.type, paddedId);
            console.log(`✅ Spec revision cancelled for ${def.prefix} ${paddedId}. Returned to backlog.`);
        },

        [`${def.prefix}-rename`]: (args) => {
            entity.entityRename(def, args[0], args.slice(1).join(' '), ctx);
        },

        [`${def.prefix}-transcript`]: (args) => {
            const u = ctx.utils;
            const options = parseCliOptions(args);
            const id = options._[0];
            const agentArgRaw = options._[1] || null;
            const shouldOpen = getOptionValue(options, 'open') !== undefined;
            if (!id) {
                console.error(`Usage: aigon ${def.prefix}-transcript <ID> [agent] [--open]`);
                process.exitCode = 1;
                return;
            }
            let agentId = null;
            if (agentArgRaw) {
                const aliasMap = u.buildAgentAliasMap();
                const available = u.getAvailableAgents();
                agentId = aliasMap[String(agentArgRaw).toLowerCase()] || String(agentArgRaw).toLowerCase();
                if (!available.includes(agentId)) {
                    console.error(`❌ Unknown agent '${agentArgRaw}'. Supported agents: ${available.join(', ')}`);
                    process.exitCode = 1;
                    return;
                }
            }
            const repoPath = process.cwd();
            const records = collectTranscriptRecords(repoPath, def.type, id, agentId);
            if (!records.length) {
                // REGRESSION: missing-pointer case (cu/op/km, or pre-F357 sessions)
                console.error(`❌ No transcript sessions found for ${def.type} ${id}.`);
                process.exitCode = 1;
                return;
            }
            console.log(formatTranscriptCliOutput(records, def.type, id));
            if (shouldOpen) {
                for (const r of records) {
                    if (r.agentSessionPath) {
                        const result = openTranscriptPath(r.agentSessionPath);
                        if (result.ok) {
                            console.log(`  Opened ${r.agentSessionPath} with ${result.openedWith}`);
                        } else {
                            console.error(`  ❌ Could not open ${r.agentSessionPath}: ${result.error}`);
                        }
                    }
                }
            }
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
    resolveSpecRevisionAgent,
    launchPromptCommand,
    SPEC_FOLDERS_ALL,
};
