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
const { readAgentStatus, writeAgentStatus } = require('./agent-status');
const { buildActionContext, assertActionAllowed, runDelegatedAigonCommand } = require('./action-scope');
const {
    buildFeatureIndex,
    resolveDepRef,
    buildDependencyGraph,
    detectCycle,
    rewriteDependsOn,
    refreshFeatureDependencyGraphs,
} = require('./feature-dependencies');
const specCrudLib = require('./spec-crud');
const cliParseLib = require('./cli-parse');

// ---------------------------------------------------------------------------
// Entity definitions
// ---------------------------------------------------------------------------

// Lazy-loaded to avoid circular deps with templates.js
function _PATHS() { return require('./templates').PATHS; }
function _wf() { return require('./workflow-core/engine'); }

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
    const action = `${def.prefix}-create`;
    const actionCtx = buildActionContext(ctx.git);
    try {
        const result = assertActionAllowed(action, actionCtx);
        if (result && result.delegate) {
            console.log(`📡 Delegating '${action}' to main repo...`);
            runDelegatedAigonCommand(result.delegate, action, [name]);
            return;
        }
    } catch (e) { return console.error(`❌ ${e.message}`); }

    const templateName = def.type === 'research' ? 'specs/research-template.md' : 'specs/feature-template.md';

    try {
        return specCrudLib.createSpecFile({
            input: name,
            usage: `aigon ${def.prefix}-create <name>`,
            example: `aigon ${def.prefix}-create ${def.type === 'research' ? 'api-design' : 'dark-mode'}`,
            inboxDir: path.join(def.paths.root, '01-inbox'),
            existsLabel: def.type === 'research' ? 'Research topic' : 'Feature',
            build: (value) => {
                const slug = cliParseLib.slugify(value);
                const filename = `${def.prefix}-${slug}.md`;
                const filePath = path.join(def.paths.root, '01-inbox', filename);
                const template = u.readTemplate(templateName);
                let content = template.replace(/\{\{NAME\}\}/g, value);
                if (options.description && def.type === 'feature') {
                    content = content.replace(
                        /## Summary\n(?:<!--[^\n]*-->|\n[^\n]*)/,
                        `## Summary\n\n${options.description}`
                    );
                }
                return {
                    filename,
                    filePath,
                    content,
                    nextMessage: `📝 Edit the ${def.type === 'research' ? 'topic' : 'spec'}, then prioritise it using command: ${def.prefix}-prioritise ${slug}`
                };
            },
            afterWrite: (built) => {
                const entityId = path.basename(built.filename, '.md').replace(new RegExp(`^${def.prefix}-`), '');
                _wf().ensureEntityBootstrappedSync(process.cwd(), def.type, entityId, 'inbox', built.filePath);
            }
        });
    } catch (error) {
        process.exitCode = 1;
        console.error(`❌ ${error.message}`);
        return null;
    }
}

function stagePaths(runGit, repoPath, paths) {
    const uniquePaths = [...new Set((paths || []).filter(Boolean))];
    if (uniquePaths.length === 0) return;
    const quoted = uniquePaths.map(p => JSON.stringify(path.relative(repoPath, p))).join(' ');
    runGit(`git add -- ${quoted}`);
}

function appendSpecTransition(specPath, fromFolder, toFolder, actor, agentId) {
    if (!specPath || !fromFolder || !toFolder) return false;
    try {
        const stripPrefix = (folder) => String(folder).replace(/^\d+-/, '');
        const transition = {
            from: stripPrefix(fromFolder),
            to: stripPrefix(toFolder),
            at: new Date().toISOString(),
            actor: agentId ? `${actor} (${agentId})` : actor,
        };
        const yamlEntry = `  - { from: "${transition.from}", to: "${transition.to}", at: "${transition.at}", actor: "${transition.actor}" }`;
        const result = specCrudLib.modifySpecFile(specPath, ({ content }) => {
            const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
            if (!fmMatch) return content;
            const fmBody = fmMatch[1];
            const newFm = /^transitions:\s*$/m.test(fmBody)
                ? fmBody.replace(/^(transitions:\s*)$/m, `$1\n${yamlEntry}`)
                : `${fmBody}\ntransitions:\n${yamlEntry}`;
            return content.replace(fmMatch[1], newFm);
        });
        return Boolean(result && result.changed);
    } catch (e) {
        console.warn(`⚠️  Could not record transition: ${e.message}`);
        return false;
    }
}

// ---------------------------------------------------------------------------
// Shared lifecycle: prioritise
// ---------------------------------------------------------------------------

/**
 * Write a minimal workflow-core snapshot + bootstrap event for a newly
 * prioritised entity. Idempotent — skips if a snapshot already exists.
 *
 * Format matches bootstrapMissingWorkflowSnapshots in lib/commands/setup.js
 * so `aigon doctor --fix` doesn't double-write later.
 */
function initWorkflowSnapshot(repoPath, entityType, paddedId, specPath) {
    const workflowDir = entityType === 'research' ? 'research' : 'features';
    const prefix = entityType === 'research' ? 'research' : 'feature';
    const entityRoot = path.join(repoPath, '.aigon', 'workflows', workflowDir, paddedId);
    const snapshotPath = path.join(entityRoot, 'snapshot.json');
    const eventsPath = path.join(entityRoot, 'events.jsonl');

    if (fs.existsSync(snapshotPath)) return;

    const now = new Date().toISOString();
    const lifecycle = 'backlog';
    const event = {
        type: `${prefix}.bootstrapped`,
        [`${entityType === 'research' ? 'researchId' : 'featureId'}`]: paddedId,
        stage: 'backlog',
        lifecycle,
        at: now,
    };

    fs.mkdirSync(entityRoot, { recursive: true });
    if (!fs.existsSync(eventsPath) || fs.readFileSync(eventsPath, 'utf8').trim() === '') {
        fs.writeFileSync(eventsPath, JSON.stringify(event) + '\n', 'utf8');
    }

    const snapshot = {
        entityType,
        [entityType === 'research' ? 'researchId' : 'featureId']: paddedId,
        lifecycle,
        mode: null,
        winnerAgentId: null,
        agents: {},
        currentSpecState: lifecycle,
        specPath,
        effects: [],
        lastEffectError: null,
        availableActions: [],
        eventCount: 1,
        createdAt: now,
        updatedAt: now,
    };
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
}

function migrateWorkflowEntityId(repoPath, entityType, fromId, toId, specPath) {
    const workflowDir = entityType === 'research' ? 'research' : 'features';
    const idKey = entityType === 'research' ? 'researchId' : 'featureId';
    const oldRoot = path.join(repoPath, '.aigon', 'workflows', workflowDir, fromId);
    const newRoot = path.join(repoPath, '.aigon', 'workflows', workflowDir, toId);
    const oldEventsPath = path.join(oldRoot, 'events.jsonl');
    const oldSnapshotPath = path.join(oldRoot, 'snapshot.json');
    const newEventsPath = path.join(newRoot, 'events.jsonl');
    const newSnapshotPath = path.join(newRoot, 'snapshot.json');

    if (!fs.existsSync(oldRoot) || fs.existsSync(newRoot)) return false;

    fs.mkdirSync(newRoot, { recursive: true });

    if (fs.existsSync(oldEventsPath)) {
        const migratedEvents = fs.readFileSync(oldEventsPath, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map(line => {
                const event = JSON.parse(line);
                if (event[idKey] === fromId) event[idKey] = toId;
                return JSON.stringify(event);
            })
            .join('\n');
        fs.writeFileSync(newEventsPath, migratedEvents + (migratedEvents ? '\n' : ''), 'utf8');
    }

    if (fs.existsSync(oldSnapshotPath)) {
        const snapshot = JSON.parse(fs.readFileSync(oldSnapshotPath, 'utf8'));
        snapshot.specPath = specPath;
        if (entityType === 'research') {
            snapshot.entityType = 'research';
            snapshot.researchId = toId;
            delete snapshot.featureId;
        } else {
            snapshot.entityType = snapshot.entityType || 'feature';
            snapshot.featureId = toId;
            delete snapshot.researchId;
        }
        fs.writeFileSync(newSnapshotPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
    }

    fs.rmSync(oldRoot, { recursive: true, force: true });
    return true;
}

/**
 * Assign an ID and move entity from inbox to backlog.
 * @param {Object} def - Entity definition
 * @param {string} name - Entity name or board letter
 * @param {Object} ctx - Context with utils, git, board, stateMachine
 */
function entityPrioritise(def, name, ctx) {
    const u = ctx.utils;
    const { runGit } = ctx.git;
    const action = `${def.prefix}-prioritise`;
    const actionCtx = buildActionContext(ctx.git);
    try {
        const result = assertActionAllowed(action, actionCtx);
        if (result && result.delegate) {
            console.log(`📡 Delegating '${action}' to main repo...`);
            runDelegatedAigonCommand(result.delegate, action, [name]);
            return;
        }
    } catch (e) { return console.error(`❌ ${e.message}`); }

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

    const found = specCrudLib.findUnprioritizedFile(def.paths, resolvedName);
    if (!found) return specCrudLib.printError(`unprioritized ${def.type}`, resolvedName, `Run \`aigon ${def.prefix}-create <name>\` first.`);
    const nextId = specCrudLib.getNextId(def.paths);
    const paddedId = String(nextId).padStart(2, '0');
    // Transform: {prefix}-topic-name.md -> {prefix}-55-topic-name.md
    const baseName = found.file.replace(/\.md$/, '').replace(new RegExp(`^${def.prefix}-`), '');
    const newName = `${def.prefix}-${paddedId}-${baseName}.md`;

    // --- Dependency resolution (features only) ---
    let canonicalDeps = [];
    if (def.type === 'feature') {
        try {
            const content = fs.readFileSync(found.fullPath, 'utf8');
            const { data } = cliParseLib.parseFrontMatter(content);
            if (Array.isArray(data.depends_on) && data.depends_on.length > 0) {
                const featureIndex = buildFeatureIndex(def.paths);
                // Also register the newly-prioritised feature itself (even though it's still in inbox)
                // We point to its FUTURE path in the index.
                const futureDir = path.join(path.dirname(path.dirname(found.fullPath)), '02-backlog');
                const futurePath = path.join(futureDir, newName);
                featureIndex.byId[paddedId] = { paddedId, slug: baseName, file: newName, folder: '02-backlog', fullPath: futurePath };
                featureIndex.byId[String(parseInt(paddedId, 10))] = featureIndex.byId[paddedId];
                featureIndex.bySlug[baseName] = featureIndex.byId[paddedId];

                const unresolved = [];
                for (const ref of data.depends_on) {
                    const resolved = resolveDepRef(ref, featureIndex);
                    if (!resolved) {
                        unresolved.push(ref);
                    } else {
                        canonicalDeps.push(resolved);
                    }
                }

                if (unresolved.length > 0) {
                    return console.error(`❌ depends_on references not found: ${unresolved.join(', ')}\n   Check feature IDs or slugs and try again.`);
                }

                // Deduplicate
                canonicalDeps = [...new Set(canonicalDeps)];

                // Build full graph including this new feature, then check for cycles
                const graph = buildDependencyGraph(def.paths, cliParseLib);
                graph.set(paddedId, canonicalDeps);
                const cycle = detectCycle(graph);
                if (cycle) {
                    return console.error(`❌ Circular dependency detected: ${cycle.join(' -> ')}\n   Remove one of these dependencies and try again.`);
                }
            }
        } catch (e) {
            if (e.message && (e.message.includes('depends_on references not found') || e.message.includes('Circular dependency'))) {
                throw e;
            }
            console.warn(`⚠️  Could not process dependencies: ${e.message}`);
        }
    }

    const futureSpecPath = path.join(def.paths.root, '02-backlog', newName);
    try {
        _wf().migrateEntityWorkflowIdSync(process.cwd(), def.type, baseName, paddedId, futureSpecPath, 'backlog');
    } catch (error) {
        process.exitCode = 1;
        return console.error(`❌ ${error.message}`);
    }

    const moved = specCrudLib.moveFile(found, '02-backlog', newName, { actor: `cli/${def.prefix}-prioritise` });

    // Rewrite spec frontmatter with canonical padded IDs (if any)
    if (canonicalDeps.length > 0) {
        rewriteDependsOn(moved.fullPath, canonicalDeps, u);
        console.log(`🔗 Dependencies resolved: [${canonicalDeps.join(', ')}]`);
    }

    if (def.type === 'feature') {
        const graphResult = refreshFeatureDependencyGraphs(def.paths, cliParseLib);
        if (graphResult.changedSpecs > 0) {
            console.log(`🕸️  Updated dependency graphs in ${graphResult.changedSpecs} feature spec(s)`);
        }
    }

    // Commit the prioritisation so it's available in worktrees
    try {
        runGit(`git add ${def.paths.root.replace(process.cwd() + '/', '')}/`);
        runGit(`git commit -m "chore: prioritise ${def.type} ${paddedId} - move to backlog"`);
        console.log(`📝 Committed ${def.type} prioritisation`);
    } catch (e) {
        console.warn(`⚠️  Could not commit: ${e.message}`);
    }

    console.log(`📋 Assigned ID: ${paddedId}`);

    if (def.type === 'feature') {
        specCrudLib.printNextSteps([
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

// entityStart, entityEval, entityClose removed — research and feature lifecycle
// transitions now go through workflow-core engine

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
    const { num, fromFolder, agentId } = closeResult;
    const repoPath = process.cwd();
    const stagedPaths = [];
    const stagedRoots = [];

    // Drift-correction: engine close effect should have moved the spec to 05-done.
    // If the spec is still in an earlier stage, warn and force-move (feature 270).
    const postFound = specCrudLib.findFile(def.paths, num, ['04-in-evaluation', '03-in-progress']);
    if (postFound) {
        console.warn(`⚠️  Drift: ${def.prefix} ${num} spec still in ${postFound.folder} after engine close. Force-moving to 05-done.`);
        const moved = specCrudLib.moveFile(postFound, '05-done', null, { actor: `cli/${def.prefix}-close` });
        if (moved && moved.fullPath) stagedPaths.push(moved.fullPath);
        console.log(`📋 Moved spec to done`);
    } else if (def.type === 'research') {
        const doneSpec = specCrudLib.findFile(def.paths, num, ['05-done']);
        if (doneSpec) {
            if (appendSpecTransition(doneSpec.fullPath, fromFolder, '05-done', `cli/${def.prefix}-close`, agentId)) {
                stagedPaths.push(doneSpec.fullPath);
            }
            stagedRoots.push(def.paths.root);
        }
    }

    // Stage findings files (research only)
    if (def.type === 'research') {
        const logsDir = path.join(def.paths.root, 'logs');
        if (fs.existsSync(logsDir)) {
            const findingsPrefix = `research-${num}-`;
            fs.readdirSync(logsDir)
                .filter(file => file.startsWith(findingsPrefix) && file.endsWith('-findings.md'))
                .forEach(file => stagedPaths.push(path.join(logsDir, file)));
        }
    }

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
        if (stagedRoots.length > 0) stagePaths(runGit, repoPath, stagedRoots);
        stagePaths(runGit, repoPath, stagedPaths);
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
async function entitySubmit(def, id, agentId, ctx) {
    // Engine state is authoritative for submit semantics; only update the cache after it lands.
    const entityType = def.type === 'research' ? 'research' : undefined;
    await _wf().emitSignal(process.cwd(), id, 'agent-submitted', agentId, entityType ? { entityType } : {});
    writeAgentStatus(id, agentId, { status: 'submitted', flags: {} }, def.prefix);
    console.log(`✅ ${def.type === 'research' ? 'Research' : 'Feature'} ${id} submitted (${agentId})`);
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
        sessionNameBuilder: (id, agent) => u.buildTmuxSessionName(id, agent, { desc, entityType: def.tmuxChar, role: 'do' }),
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
            const sessionName = u.buildTmuxSessionName(num, agentId, { desc, entityType: def.tmuxChar, role: 'do' });
            try {
                u.openTerminalAppWithCommand(cwd, `tmux attach -t ${u.shellQuote(sessionName)}`, sessionName);
            } catch (e) {
                console.warn(`   ⚠️  Could not open terminal for ${sessionName}: ${e.message}`);
            }
        });
    }
}

// ---------------------------------------------------------------------------
// Rename (inbox-only)
// ---------------------------------------------------------------------------

function entityRename(def, oldName, newName, ctx) {
    const u = ctx.utils;
    const { runGit } = ctx.git;
    const wf = require('./workflow-core/engine');

    if (!oldName || !newName) {
        return console.error(`Usage: aigon ${def.prefix}-rename <old-name> <new-name>\nOnly works for inbox (unprioritised) entities.`);
    }

    const oldSlug = u.slugify(oldName);
    const newSlug = u.slugify(newName);

    if (oldSlug === newSlug) return console.error(`❌ Old and new names produce the same slug: "${oldSlug}"`);

    const found = u.findUnprioritizedFile(def.paths, oldSlug);
    if (!found) return console.error(`❌ No unprioritised ${def.type} found matching "${oldSlug}" in 01-inbox.\n   Only inbox entities (no ID yet) can be renamed with this command.`);

    const inboxDir = path.join(def.paths.root, '01-inbox');
    const newFilename = `${def.prefix}-${newSlug}.md`;
    const newFilePath = path.join(inboxDir, newFilename);

    if (require('fs').existsSync(newFilePath)) {
        return console.error(`❌ A spec already exists at: ${newFilePath}`);
    }

    // Rename the spec file via git so history is preserved
    runGit(`git mv "${found.fullPath}" "${newFilePath}"`);
    console.log(`✅ Renamed spec: ${found.file} → ${newFilename}`);

    // Migrate workflow state: slug-keyed dir + snapshot/events rewrite
    const repoPath = process.cwd();
    try {
        wf.migrateEntityWorkflowIdSync(repoPath, def.type, oldSlug, newSlug, newFilePath, 'inbox');
        console.log(`✅ Workflow state migrated: ${oldSlug} → ${newSlug}`);
    } catch (e) {
        console.error(`❌ Workflow migration failed: ${e.message}`);
        // Undo the git mv so the repo isn't left in a broken state
        runGit(`git mv "${newFilePath}" "${found.fullPath}"`);
        return;
    }

    runGit(`git add -A`);
    runGit(`git commit -m "chore: rename ${def.type} - ${oldSlug} → ${newSlug}"`);
    console.log(`\n✅ ${def.type === 'research' ? 'Research' : 'Feature'} renamed to "${newSlug}".`);
    console.log(`   Next: aigon ${def.prefix}-prioritise ${newSlug}`);
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
    entityCloseFinalize,
    entitySubmit,
    entityRename,

    // Fleet helpers
    createFleetSessions,
};
