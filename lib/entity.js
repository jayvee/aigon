'use strict';

/**
 * Aigon Entity Lifecycle — unified pipeline for features and research.
 *
 * Each function takes an `entityDef` config and a `ctx` dependency object,
 * sharing the exact same code path for both entity types. The ONLY differences
 * are captured in the entityDef:
 *   - type, prefix, paths, tmuxChar
 *   - doTemplate, evalTemplate
 *
 * Domain-specific extras (PR creation, dev server, autopilot) remain in the
 * command files (feature.js, research.js) which call into these functions.
 */

const fs = require('fs');
const path = require('path');
const manifest = require('./manifest');
const stateMachine = require('./state-machine');

// ---------------------------------------------------------------------------
// Entity definitions
// ---------------------------------------------------------------------------

// Lazy-loaded to avoid circular deps with templates.js
function _PATHS() { return require('./templates').PATHS; }

const FEATURE_DEF = {
    type: 'feature',
    prefix: 'feature',
    get paths() { return _PATHS().features; },
    tmuxChar: 'f',
    doTemplate: 'feature-do',
    evalTemplate: 'feature-eval',
};

const RESEARCH_DEF = {
    type: 'research',
    prefix: 'research',
    get paths() { return _PATHS().research; },
    tmuxChar: 'r',
    doTemplate: 'research-do',
    evalTemplate: 'research-eval',
};

function getEntityDef(type) {
    if (type === 'research') return RESEARCH_DEF;
    return FEATURE_DEF;
}

// ---------------------------------------------------------------------------
// Shared lifecycle: create
// ---------------------------------------------------------------------------

/**
 * Create a new entity spec in the inbox.
 * @param {Object} def - Entity definition (FEATURE_DEF or RESEARCH_DEF)
 * @param {string} name - Entity name
 * @param {Object} ctx - Context with utils, git
 * @param {Object} [options] - { description }
 */
function entityCreate(def, name, ctx, options = {}) {
    const u = ctx.utils;
    const { assertOnDefaultBranch } = ctx.git;

    try { assertOnDefaultBranch(); } catch (e) { return console.error(`❌ ${e.message}`); }

    const templateName = def.type === 'research' ? 'specs/research-template.md' : 'specs/feature-template.md';

    u.createSpecFile({
        input: name,
        usage: `aigon ${def.prefix}-create <name>`,
        example: `aigon ${def.prefix}-create ${def.type === 'research' ? 'api-design' : 'dark-mode'}`,
        inboxDir: path.join(def.paths.root, '01-inbox'),
        existsLabel: def.type === 'research' ? 'Research topic' : 'Feature',
        build: (value) => {
            const slug = u.slugify(value);
            const filename = `${def.prefix}-${slug}.md`;
            const filePath = path.join(def.paths.root, '01-inbox', filename);
            const template = u.readTemplate(templateName);
            let content = template.replace(/\{\{NAME\}\}/g, value);
            if (options.description && def.type === 'feature') {
                content = content.replace(
                    /## Summary\n\n[^\n]*/,
                    `## Summary\n\n${options.description}`
                );
            }
            return {
                filename,
                filePath,
                content,
                nextMessage: `📝 Edit the ${def.type === 'research' ? 'topic' : 'spec'}, then prioritise it using command: ${def.prefix}-prioritise ${slug}`
            };
        }
    });
}

// ---------------------------------------------------------------------------
// Shared lifecycle: prioritise
// ---------------------------------------------------------------------------

/**
 * Assign an ID and move entity from inbox to backlog.
 * @param {Object} def - Entity definition
 * @param {string} name - Entity name or board letter
 * @param {Object} ctx - Context with utils, git, board, stateMachine
 */
function entityPrioritise(def, name, ctx) {
    const u = ctx.utils;
    const { assertOnDefaultBranch } = ctx.git;
    const { runGit } = ctx.git;

    try { assertOnDefaultBranch(); } catch (e) { return console.error(`❌ ${e.message}`); }

    let resolvedName = name;

    // Check if argument is a single letter (from board mapping)
    if (resolvedName.length === 1 && resolvedName >= 'a' && resolvedName <= 'z') {
        const mapping = ctx.board.loadBoardMapping();
        const boardKey = def.type === 'research' ? 'research' : 'features';
        if (mapping && mapping[boardKey] && mapping[boardKey][resolvedName]) {
            const mappedName = mapping[boardKey][resolvedName];
            console.log(`📍 Letter '${resolvedName}' maps to: ${mappedName}`);
            resolvedName = mappedName;
        } else {
            return console.error(`❌ Letter '${resolvedName}' not found in board mapping. Run 'aigon board' first.`);
        }
    }

    const found = u.findUnprioritizedFile(def.paths, resolvedName);
    if (!found) return u.printError(`unprioritized ${def.type}`, resolvedName, `Run \`aigon ${def.prefix}-create <name>\` first.`);
    const nextId = u.getNextId(def.paths);
    const paddedId = String(nextId).padStart(2, '0');
    // Transform: {prefix}-topic-name.md -> {prefix}-55-topic-name.md
    const baseName = found.file.replace(/\.md$/, '').replace(new RegExp(`^${def.prefix}-`), '');
    const newName = `${def.prefix}-${paddedId}-${baseName}.md`;
    const moved = u.moveFile(found, '02-backlog', newName, { actor: `cli/${def.prefix}-prioritise` });

    // Commit the prioritisation so it's available in worktrees
    try {
        runGit(`git add ${def.paths.root.replace(process.cwd() + '/', '')}/`);
        runGit(`git commit -m "chore: prioritise ${def.type} ${paddedId} - move to backlog"`);
        console.log(`📝 Committed ${def.type} prioritisation`);
    } catch (e) {
        console.warn(`⚠️  Could not commit: ${e.message}`);
    }

    // Write manifest deterministically at prioritisation time
    manifest.writeManifest(paddedId, {
        id: paddedId,
        type: def.type,
        name: baseName,
        stage: 'backlog',
        specPath: moved.fullPath,
        agents: [],
        winner: null,
        pending: [],
    }, { type: `transition:${def.prefix}-prioritise`, actor: `cli/${def.prefix}-prioritise` }, def.prefix);

    console.log(`📋 Assigned ID: ${paddedId}`);

    if (def.type === 'feature') {
        u.printNextSteps([
            `Drive (branch):   aigon feature-start ${paddedId}`,
            `Drive (worktree): aigon feature-start ${paddedId} <agent>`,
            `Fleet:            aigon feature-start ${paddedId} <agent1> <agent2> [agent3]`
        ]);
    } else {
        console.log(`\n💡 Next steps:`);
        console.log(`   Drive:  aigon research-start ${paddedId}`);
        console.log(`   Fleet:  aigon research-start ${paddedId} cc gg cx`);
    }
}

// ---------------------------------------------------------------------------
// Shared lifecycle: start
// ---------------------------------------------------------------------------

/**
 * Start an entity — move spec, create worktrees/tmux sessions (fleet), or branch (drive).
 * Returns { mode, id, desc, found } or null on error.
 *
 * @param {Object} def - Entity definition
 * @param {string[]} args - CLI args: [id, ...agents, --flags]
 * @param {Object} ctx - Context
 * @returns {Object|null} Result info for caller to add entity-specific extras
 */
function entityStart(def, args, ctx) {
    const u = ctx.utils;
    const { assertOnDefaultBranch, runGit } = ctx.git;

    try { assertOnDefaultBranch(); } catch (e) { console.error(`❌ ${e.message}`); return null; }

    const options = u.parseCliOptions(args);
    const id = options._[0];
    const agentIds = options._.slice(1);
    const mode = agentIds.length > 0 ? 'fleet' : 'drive';
    const backgroundRequested = u.getOptionValue(options, 'background') !== undefined;
    const foregroundRequested = u.getOptionValue(options, 'foreground') !== undefined;

    if (backgroundRequested && foregroundRequested) {
        console.error('❌ Use either --background or --foreground (not both).');
        return null;
    }

    const startConfig = u.getEffectiveConfig();
    const backgroundByConfig = Boolean(startConfig.backgroundAgents);
    const backgroundMode = backgroundRequested ? true : (foregroundRequested ? false : backgroundByConfig);

    if (!id) {
        console.error(`Usage: aigon ${def.prefix}-start <ID> [agents...] [--background|--foreground]`);
        return null;
    }

    // Find in backlog or in-progress
    let found = u.findFile(def.paths, id, ['02-backlog', '03-in-progress']);
    if (!found) {
        console.error(`❌ Could not find ${def.type} "${id}" in backlog or in-progress.`);
        return null;
    }

    const match = found.file.match(new RegExp(`^${def.prefix}-(\\d+)-(.+)\\.md$`));
    const entityId = match ? match[1] : id;
    const entityName = match ? match[2] : '';

    // Bootstrap manifest if missing (pre-manifest entity or manual file move)
    let existingM = manifest.readManifest(entityId, def.prefix);
    if (!existingM) {
        const stage = found.folder === '03-in-progress' ? 'in-progress' : 'backlog';
        manifest.writeManifest(entityId, {
            id: entityId,
            type: def.type,
            name: entityName,
            stage,
            specPath: found.fullPath,
            agents: [],
            winner: null,
            pending: [],
        }, { type: 'bootstrap', actor: `cli/${def.prefix}-start` }, def.prefix);
        existingM = manifest.readManifest(entityId, def.prefix) || {};
    }

    // Outbox replay check
    const isStartReplay = existingM.stage === 'in-progress' &&
        Array.isArray(existingM.pending) && existingM.pending.length > 0;

    // Guard: already running and not a replay
    if (found.folder === '03-in-progress' && !isStartReplay) {
        if (agentIds.length > 0) {
            // Merge agents into manifest
            const currentAgents = Array.isArray(existingM.agents) ? existingM.agents : [];
            const merged = [...new Set([...currentAgents, ...agentIds])];
            manifest.writeManifest(entityId, { agents: merged },
                { type: 'agent-backfill', actor: `cli/${def.prefix}-start` }, def.prefix);
            console.log(`📋 Registered agents [${merged.join(', ')}] for ${def.type} ${entityId}`);
        } else {
            console.log(`ℹ️  ${def.type === 'research' ? 'Research' : 'Feature'} ${String(parseInt(entityId, 10) || entityId)} is already in progress.`);
            return null;
        }
    }

    if (!isStartReplay) {
        try {
            ctx.stateMachine.requestTransition(entityId, `${def.prefix}-start`, {
                agents: agentIds,
                actor: `cli/${def.prefix}-start`,
            });
        } catch (e) {
            console.error(`❌ ${e.message}`);
            return null;
        }
    } else {
        console.log(`📋 Resuming interrupted ${def.prefix}-start (${existingM.pending.length} ops remaining)...`);
    }

    // Move spec to in-progress (idempotent: no-op if already there)
    found = u.findFile(def.paths, id, ['02-backlog']);
    let movedFromBacklog = false;
    if (found) {
        u.moveFile(found, '03-in-progress', null, { actor: `cli/${def.prefix}-start` });
        movedFromBacklog = true;
        found = u.findFile(def.paths, id, ['03-in-progress']);
    } else {
        found = u.findFile(def.paths, id, ['03-in-progress']);
        if (!found) {
            console.error(`❌ Could not find ${def.type} "${id}" in backlog or in-progress.`);
            return null;
        }
    }
    ctx.stateMachine.completePendingOp(entityId, 'move-spec', def.prefix);

    const parsedFile = found.file.match(new RegExp(`^${def.prefix}-(\\d+)-(.+)\\.md$`));
    if (!parsedFile) { console.warn("⚠️  Could not parse filename."); return null; }
    const num = parsedFile[1];
    const desc = parsedFile[2];

    // Commit the spec move
    if (movedFromBacklog) {
        try {
            const relRoot = def.paths.root.replace(process.cwd() + '/', '');
            runGit(`git add ${relRoot}/`);
            runGit(`git commit -m "chore: start ${def.type} ${num} - move spec to in-progress"`);
            console.log(`📝 Committed spec move to in-progress`);
        } catch (e) {
            if (mode !== 'drive') {
                console.error(`❌ Could not commit spec move: ${e.message}`);
                return null;
            }
            console.warn(`⚠️  Could not commit spec move: ${e.message}`);
        }
    }

    // Return result for the caller (feature.js or research.js) to handle mode-specific setup
    return {
        mode,
        id: entityId,
        num,
        desc,
        found,
        agentIds,
        backgroundMode,
        movedFromBacklog,
    };
}

// ---------------------------------------------------------------------------
// Shared lifecycle: eval
// ---------------------------------------------------------------------------

/**
 * Transition entity from in-progress to in-evaluation.
 * Returns { found, num, desc } for the caller to continue with agent-specific logic.
 *
 * @param {Object} def - Entity definition
 * @param {string} id - Entity ID
 * @param {Object} ctx - Context
 * @param {Object} [options] - { force, setupOnly }
 * @returns {Object|null}
 */
function entityEval(def, id, ctx, options = {}) {
    const u = ctx.utils;
    const { assertOnDefaultBranch, runGit } = ctx.git;

    try { assertOnDefaultBranch(); } catch (e) { console.error(`❌ ${e.message}`); return null; }

    const found = u.findFile(def.paths, id, ['03-in-progress', '04-in-evaluation']);
    if (!found) {
        console.error(`❌ Could not find ${def.type} "${id}" in progress or in-evaluation.`);
        return null;
    }

    const match = found.file.match(new RegExp(`^${def.prefix}-(\\d+)-(.+)\\.md$`));
    if (!match) { console.warn("⚠️  Could not parse filename."); return null; }
    const num = match[1];
    const desc = match[2];

    // Move to in-evaluation if still in-progress
    if (found.folder === '03-in-progress') {
        // Check agent completion (unless --force)
        if (!options.force) {
            const incompleteAgents = collectIncompleteAgents(def, num, ctx);
            if (incompleteAgents.length > 0) {
                console.log('');
                console.log(`⚠️  ${incompleteAgents.length} agent(s) not yet submitted:`);
                incompleteAgents.forEach(a => {
                    console.log(`   ${a.agent} (${a.name}) — status: ${a.status}`);
                    const reconnectCmd = def.type === 'research'
                        ? `aigon terminal-focus ${num} ${a.agent} --research`
                        : `aigon terminal-focus ${num} ${a.agent}`;
                    console.log(`     → ${reconnectCmd}`);
                });
                console.log('');
                console.log(`   To proceed anyway: aigon ${def.prefix}-eval ${num} --force`);
                console.log('');
                return null;
            }
        }

        // Bootstrap manifest if missing
        let existingM = manifest.readManifest(num, def.prefix);
        if (!existingM) {
            manifest.writeManifest(num, {
                id: num, type: def.type, name: desc,
                stage: 'in-progress', specPath: found.fullPath,
                agents: [], winner: null, pending: [],
            }, { type: 'bootstrap', actor: `cli/${def.prefix}-eval` }, def.prefix);
            existingM = manifest.readManifest(num, def.prefix) || {};
        }

        // Outbox replay check
        const isReplay = existingM.stage === 'in-evaluation' &&
            Array.isArray(existingM.pending) && existingM.pending.length > 0;

        if (!isReplay) {
            try {
                ctx.stateMachine.requestTransition(num, `${def.prefix}-eval`, { actor: `cli/${def.prefix}-eval` });
            } catch (e) {
                console.error(`❌ ${e.message}`);
                return null;
            }
        }

        u.moveFile(found, '04-in-evaluation', null, { actor: `cli/${def.prefix}-eval` });
        ctx.stateMachine.completePendingOp(num, 'move-spec', def.prefix);

        try {
            const relRoot = def.paths.root.replace(process.cwd() + '/', '');
            runGit(`git add ${relRoot}/`);
            runGit(`git commit -m "chore: move ${def.type} ${num} to evaluation"`);
        } catch (e) { /* already committed or nothing to commit */ }
        console.log(`📋 ${def.type === 'research' ? 'Research' : 'Feature'} ${num} moved to in-evaluation.`);
    }

    if (options.setupOnly) return null;

    const evalFound = u.findFile(def.paths, id, ['04-in-evaluation']);
    return { found: evalFound || found, num, desc };
}

// ---------------------------------------------------------------------------
// Shared lifecycle: close
// ---------------------------------------------------------------------------

/**
 * Close an entity — move spec to done, clean up sessions.
 * Returns { num, desc } for the caller to do entity-specific cleanup (merge, etc).
 *
 * @param {Object} def - Entity definition
 * @param {string} id - Entity ID
 * @param {Object} ctx - Context
 * @returns {Object|null}
 */
function entityClose(def, id, ctx) {
    const u = ctx.utils;
    const { assertOnDefaultBranch, runGit } = ctx.git;

    try { assertOnDefaultBranch(); } catch (e) { console.error(`❌ ${e.message}`); return null; }

    // Look in in-evaluation first, then in-progress
    let found = u.findFile(def.paths, id, ['04-in-evaluation']);
    let skippingEval = false;
    if (!found) {
        found = u.findFile(def.paths, id, ['03-in-progress']);
        if (found) skippingEval = true;
    }
    if (!found) {
        console.error(`❌ Could not find ${def.type} "${id}" in in-evaluation or in-progress.`);
        return null;
    }

    const match = found.file.match(new RegExp(`^${def.prefix}-(\\d+)-(.+)\\.md$`));
    if (!match) { console.warn("⚠️  Could not parse filename."); return null; }
    const num = match[1];
    const desc = match[2];

    if (skippingEval) {
        console.log(`⚠️  ${def.type === 'research' ? 'Research' : 'Feature'} ${num} is still in-progress (eval hasn't run). Closing anyway.`);
    }

    // Bootstrap manifest if missing (pre-manifest entity)
    const existingM = manifest.readManifest(num, def.prefix);
    if (!existingM) {
        const stage = skippingEval ? 'in-progress' : 'in-evaluation';
        manifest.writeManifest(num, {
            id: num, type: def.type, name: desc,
            stage, specPath: found.fullPath,
            agents: [], winner: null, pending: [],
        }, { type: 'bootstrap', actor: `cli/${def.prefix}-close` }, def.prefix);
    }

    return { found, num, desc, skippingEval };
}

/**
 * Finalize entity close: move spec to done, record transition, clean up sessions.
 * Called after entity-specific merge/cleanup.
 *
 * @param {Object} def - Entity definition
 * @param {Object} closeResult - Result from entityClose
 * @param {Object} ctx - Context
 */
function entityCloseFinalize(def, closeResult, ctx) {
    const u = ctx.utils;
    const { runGit } = ctx.git;
    const { num } = closeResult;
    const doneFolder = def.type === 'research' ? '05-done' : '05-done';

    // Record transition (idempotent: skip if already done)
    try {
        ctx.stateMachine.requestTransition(num, `${def.prefix}-close`, { actor: `cli/${def.prefix}-close` });
    } catch (e) {
        if (!e.message.includes("Invalid transition")) throw e;
    }

    // Move spec to done
    const postFound = u.findFile(def.paths, num, ['04-in-evaluation', '03-in-progress']);
    if (postFound) {
        u.moveFile(postFound, doneFolder, null, { actor: `cli/${def.prefix}-close` });
        console.log(`📋 Moved spec to done`);
    }
    ctx.stateMachine.completePendingOp(num, 'move-spec', def.prefix);

    // Gracefully close all agent tmux sessions
    try {
        const { gracefullyCloseEntitySessions } = require('./worktree');
        const result = gracefullyCloseEntitySessions(num, def.tmuxChar, {
            repoPath: process.cwd(),
        });
        if (result.closed > 0) {
            console.log(`🧹 Closed ${result.closed} agent session(s)`);
        }
    } catch (e) { /* non-fatal */ }

    // Commit
    try {
        const relRoot = def.paths.root.replace(process.cwd() + '/', '');
        runGit(`git add ${relRoot}/`);
        runGit(`git commit -m "chore: complete ${def.type} ${num} - move spec to done"`);
        console.log(`📝 Committed spec move`);
    } catch (e) {
        // May fail if no changes to commit
    }
}

// ---------------------------------------------------------------------------
// Shared lifecycle: submit (for fleet agents)
// ---------------------------------------------------------------------------

/**
 * Mark an agent's findings/implementation as submitted.
 * @param {Object} def - Entity definition
 * @param {string} id - Entity ID
 * @param {string} agentId - Agent identifier
 * @param {Object} ctx - Context
 */
function entitySubmit(def, id, agentId, ctx) {
    manifest.writeAgentStatus(id, agentId, { status: 'submitted', flags: {} }, def.prefix);
    console.log(`✅ ${def.type === 'research' ? 'Research' : 'Feature'} ${id} submitted (${agentId})`);
}

// ---------------------------------------------------------------------------
// Helper: collect incomplete agents
// ---------------------------------------------------------------------------

function collectIncompleteAgents(def, entityId, ctx) {
    const u = ctx.utils;
    const incompleteAgents = [];

    if (def.type === 'research') {
        // Research: check findings files in logs dir
        const logsDir = path.join(def.paths.root, 'logs');
        if (!logsDir || !fs.existsSync(logsDir)) return [];
        const findingsFiles = fs.readdirSync(logsDir)
            .filter(f => f.startsWith(`research-${entityId}-`) && f.endsWith('-findings.md'))
            .sort();
        findingsFiles.forEach(file => {
            const match = file.match(/^research-\d+-([a-z]{2})-findings\.md$/);
            if (!match) return;
            try {
                const agent = match[1];
                const agentState = manifest.readAgentStatus(entityId, agent, def.prefix);
                const status = agentState ? (agentState.status || 'unknown') : 'unknown';
                if (status !== 'submitted') {
                    const agentConfig = u.loadAgentConfig(agent);
                    incompleteAgents.push({ agent, name: agentConfig?.name || agent, status });
                }
            } catch (e) { /* skip on read error */ }
        });
    } else {
        // Feature: check worktrees
        const worktrees = u.filterByFeatureId(u.findWorktrees(), entityId);
        worktrees.forEach(w => {
            const agentState = manifest.readAgentStatus(entityId, w.agent, def.prefix);
            const status = agentState ? (agentState.status || 'unknown') : 'unknown';
            if (status !== 'submitted') {
                const agentConfig = u.loadAgentConfig(w.agent);
                incompleteAgents.push({ agent: w.agent, name: agentConfig?.name || w.agent, status });
            }
        });
    }

    return incompleteAgents;
}

// ---------------------------------------------------------------------------
// Fleet session helpers (used by both feature-start and research-start fleet mode)
// ---------------------------------------------------------------------------

/**
 * Create tmux sessions for fleet agents.
 * @param {Object} def - Entity definition
 * @param {string} num - Entity ID
 * @param {string} desc - Entity description
 * @param {string[]} agentIds - Agent IDs
 * @param {Object} ctx - Context
 * @param {Object} [options] - { cwdBuilder, commandBuilder, backgroundMode }
 */
function createFleetSessions(def, num, desc, agentIds, ctx, options = {}) {
    const u = ctx.utils;
    const backgroundMode = options.backgroundMode || false;

    try {
        u.assertTmuxAvailable();
    } catch (e) {
        console.error(`\n❌ ${e.message}`);
        console.error('   tmux is required. Install: brew install tmux');
        return;
    }

    console.log(`\n🖥️  Creating tmux sessions...`);

    const cwdBuilder = options.cwdBuilder || (() => process.cwd());
    const commandBuilder = options.commandBuilder || ((_, agent) => {
        return u.buildAgentCommand({
            agent,
            featureId: num,
            entityType: def.type,
            desc,
            path: cwdBuilder(num, agent),
        });
    });

    const sessionResults = u.ensureAgentSessions(num, agentIds, {
        sessionNameBuilder: (id, agent) => u.buildTmuxSessionName(id, agent, { desc, entityType: def.tmuxChar }),
        cwdBuilder,
        commandBuilder,
    });

    sessionResults.forEach(result => {
        if (result.error) {
            console.warn(`   ⚠️  Could not create tmux session ${result.sessionName}: ${result.error.message}`);
        } else {
            console.log(`   ✓ ${result.sessionName}${result.created ? ' → started' : ' (already exists)'}`);
        }
    });

    if (backgroundMode) {
        console.log(`\n🟡 Background mode — sessions created but not opened.`);
    } else {
        console.log(`\n🚀 Opening agent terminals...`);
        const cwd = cwdBuilder(num, agentIds[0]);
        agentIds.forEach(agentId => {
            const sessionName = u.buildTmuxSessionName(num, agentId, { desc, entityType: def.tmuxChar });
            try {
                u.openTerminalAppWithCommand(cwd, `tmux attach -t ${u.shellQuote(sessionName)}`, sessionName);
            } catch (e) {
                console.warn(`   ⚠️  Could not open terminal for ${sessionName}: ${e.message}`);
            }
        });
    }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
    // Entity definitions
    FEATURE_DEF,
    RESEARCH_DEF,
    getEntityDef,

    // Lifecycle functions
    entityCreate,
    entityPrioritise,
    entityStart,
    entityEval,
    entityClose,
    entityCloseFinalize,
    entitySubmit,

    // Fleet helpers
    createFleetSessions,
    collectIncompleteAgents,
};
