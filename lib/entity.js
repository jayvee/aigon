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
const { execSync } = require('child_process');
const manifest = require('./manifest');
const stateMachine = require('./state-machine');
const { buildActionContext, assertActionAllowed } = require('./action-scope');

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
    const action = `${def.prefix}-create`;
    const actionCtx = buildActionContext(ctx.git);
    try {
        const result = assertActionAllowed(action, actionCtx);
        if (result && result.delegate) {
            console.log(`📡 Delegating '${action}' to main repo...`);
            execSync(`node "${path.join(result.delegate, 'aigon-cli.js')}" ${action} ${JSON.stringify(name)}`, { stdio: 'inherit', cwd: result.delegate });
            return;
        }
    } catch (e) { return console.error(`❌ ${e.message}`); }

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
// Dependency helpers
// ---------------------------------------------------------------------------

/**
 * Scan all spec folders and build a map of ID -> { paddedId, slug, file }.
 * Also builds slug/name -> paddedId lookup for resolving name references.
 */
function buildFeatureIndex(paths) {
    const index = { byId: {}, bySlug: {} };
    for (const folder of paths.folders) {
        const dir = path.join(paths.root, folder);
        if (!fs.existsSync(dir)) continue;
        for (const file of fs.readdirSync(dir)) {
            const match = file.match(/^feature-(\d+)-(.+)\.md$/);
            if (!match) continue;
            const paddedId = match[1];
            const slug = match[2];
            const entry = { paddedId, slug, file, folder, fullPath: path.join(dir, file) };
            index.byId[paddedId] = entry;
            index.byId[String(parseInt(paddedId, 10))] = entry; // unpadded lookup
            index.bySlug[slug] = entry;
        }
    }
    return index;
}

/**
 * Resolve a single depends_on reference (ID, slug, or name) to a canonical padded ID.
 * Returns the padded ID string, or null if not found.
 */
function resolveDepRef(ref, featureIndex) {
    const str = String(ref).trim();
    // Try as numeric ID (padded or unpadded)
    if (/^\d+$/.test(str)) {
        const paddedId = str.padStart(2, '0');
        if (featureIndex.byId[paddedId]) return featureIndex.byId[paddedId].paddedId;
        if (featureIndex.byId[str]) return featureIndex.byId[str].paddedId;
        return null;
    }
    // Try as slug
    const slug = str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (featureIndex.bySlug[slug]) return featureIndex.bySlug[slug].paddedId;
    return null;
}

/**
 * Build the full dependency graph from all feature specs that have depends_on frontmatter.
 * Returns { graph: Map<paddedId, paddedId[]> }
 */
function buildDependencyGraph(paths, utils) {
    const graph = new Map();
    for (const folder of paths.folders) {
        const dir = path.join(paths.root, folder);
        if (!fs.existsSync(dir)) continue;
        for (const file of fs.readdirSync(dir)) {
            const match = file.match(/^feature-(\d+)-(.+)\.md$/);
            if (!match) continue;
            const paddedId = match[1];
            try {
                const content = fs.readFileSync(path.join(dir, file), 'utf8');
                const { data } = utils.parseFrontMatter(content);
                if (Array.isArray(data.depends_on) && data.depends_on.length > 0) {
                    graph.set(paddedId, data.depends_on.map(d => String(d).padStart(2, '0')));
                }
            } catch (e) { /* skip unreadable specs */ }
        }
    }
    return graph;
}

/**
 * Detect cycles in the dependency graph using DFS.
 * Returns the cycle path as an array of IDs if found, or null if no cycle.
 */
function detectCycle(graph) {
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map();
    const parent = new Map();

    for (const node of graph.keys()) {
        color.set(node, WHITE);
    }
    // Also register nodes that appear only as dependencies
    for (const deps of graph.values()) {
        for (const dep of deps) {
            if (!color.has(dep)) color.set(dep, WHITE);
        }
    }

    for (const start of color.keys()) {
        if (color.get(start) !== WHITE) continue;
        const stack = [start];
        while (stack.length > 0) {
            const node = stack[stack.length - 1];
            if (color.get(node) === WHITE) {
                color.set(node, GRAY);
                const deps = graph.get(node) || [];
                for (const dep of deps) {
                    if (color.get(dep) === GRAY) {
                        // Found cycle — reconstruct path
                        const cycle = [dep];
                        let cur = node;
                        while (cur !== dep) {
                            cycle.push(cur);
                            cur = parent.get(cur);
                        }
                        cycle.push(dep);
                        return cycle.reverse();
                    }
                    if (!color.has(dep) || color.get(dep) === WHITE) {
                        if (!color.has(dep)) color.set(dep, WHITE);
                        parent.set(dep, node);
                        stack.push(dep);
                    }
                }
            } else {
                color.set(node, BLACK);
                stack.pop();
            }
        }
    }
    return null;
}

/**
 * Rewrite depends_on in a spec's YAML frontmatter to use canonical padded IDs.
 * Only touches the depends_on line; leaves everything else intact.
 */
function rewriteDependsOn(specPath, canonicalIds, utils) {
    utils.modifySpecFile(specPath, ({ content }) => {
        // Match the depends_on line in frontmatter and replace its value
        const fmMatch = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)/);
        if (!fmMatch) return content;
        const newValue = `[${canonicalIds.join(', ')}]`;
        const updatedFm = fmMatch[2].replace(
            /^(depends_on:\s*).*$/m,
            `$1${newValue}`
        );
        return fmMatch[1] + updatedFm + fmMatch[3] + content.slice(fmMatch[0].length);
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
    const { runGit } = ctx.git;
    const action = `${def.prefix}-prioritise`;
    const actionCtx = buildActionContext(ctx.git);
    try {
        const result = assertActionAllowed(action, actionCtx);
        if (result && result.delegate) {
            console.log(`📡 Delegating '${action}' to main repo...`);
            execSync(`node "${path.join(result.delegate, 'aigon-cli.js')}" ${action} ${JSON.stringify(name)}`, { stdio: 'inherit', cwd: result.delegate });
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

    const found = u.findUnprioritizedFile(def.paths, resolvedName);
    if (!found) return u.printError(`unprioritized ${def.type}`, resolvedName, `Run \`aigon ${def.prefix}-create <name>\` first.`);
    const nextId = u.getNextId(def.paths);
    const paddedId = String(nextId).padStart(2, '0');
    // Transform: {prefix}-topic-name.md -> {prefix}-55-topic-name.md
    const baseName = found.file.replace(/\.md$/, '').replace(new RegExp(`^${def.prefix}-`), '');
    const newName = `${def.prefix}-${paddedId}-${baseName}.md`;

    // --- Dependency resolution (features only) ---
    let canonicalDeps = [];
    if (def.type === 'feature') {
        try {
            const content = fs.readFileSync(found.fullPath, 'utf8');
            const { data } = u.parseFrontMatter(content);
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
                const graph = buildDependencyGraph(def.paths, u);
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

    const moved = u.moveFile(found, '02-backlog', newName, { actor: `cli/${def.prefix}-prioritise` });

    // Rewrite spec frontmatter with canonical padded IDs (if any)
    if (canonicalDeps.length > 0) {
        rewriteDependsOn(moved.fullPath, canonicalDeps, u);
        console.log(`🔗 Dependencies resolved: [${canonicalDeps.join(', ')}]`);
    }

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
        dependsOn: canonicalDeps.length > 0 ? canonicalDeps : undefined,
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
    const { runGit } = ctx.git;
    const action = `${def.prefix}-start`;
    const actionCtx = buildActionContext(ctx.git);
    try {
        const result = assertActionAllowed(action, actionCtx);
        if (result && result.delegate) {
            console.log(`📡 Delegating '${action}' to main repo...`);
            const argsStr = args.map(a => JSON.stringify(a)).join(' ');
            execSync(`node "${path.join(result.delegate, 'aigon-cli.js')}" ${action} ${argsStr}`, { stdio: 'inherit', cwd: result.delegate });
            return null;
        }
    } catch (e) { console.error(`❌ ${e.message}`); return null; }

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
    ctx.stateMachine.completePendingOp(num, 'move-spec', def.prefix);

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
    const { runGit } = ctx.git;
    const action = `${def.prefix}-eval`;
    const actionCtx = buildActionContext(ctx.git);
    try {
        const result = assertActionAllowed(action, actionCtx);
        if (result && result.delegate) {
            console.log(`📡 Delegating '${action}' to main repo...`);
            execSync(`node "${path.join(result.delegate, 'aigon-cli.js')}" ${action} ${JSON.stringify(id)}`, { stdio: 'inherit', cwd: result.delegate });
            return null;
        }
    } catch (e) { console.error(`❌ ${e.message}`); return null; }

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
    const { runGit } = ctx.git;
    const action = `${def.prefix}-close`;
    const actionCtx = buildActionContext(ctx.git);
    try {
        const result = assertActionAllowed(action, actionCtx);
        if (result && result.delegate) {
            console.log(`📡 Delegating '${action}' to main repo...`);
            execSync(`node "${path.join(result.delegate, 'aigon-cli.js')}" ${action} ${JSON.stringify(id)}`, { stdio: 'inherit', cwd: result.delegate });
            return null;
        }
    } catch (e) { console.error(`❌ ${e.message}`); return null; }

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

    // Dependency helpers (exported for testing)
    buildFeatureIndex,
    resolveDepRef,
    buildDependencyGraph,
    detectCycle,
    rewriteDependsOn,
};
