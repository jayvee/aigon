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

    return u.createSpecFile({
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
                // Replace the Summary section's HTML-comment placeholder with the
                // supplied description. Handles both the current template shape
                // (`## Summary\n<!-- comment -->`) and the legacy shape
                // (`## Summary\n\n<placeholder text>`) for safety.
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
function buildDependencyGraph(paths, utils, featureIndex) {
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
                    const resolved = data.depends_on
                        .map(d => resolveDepRef(d, featureIndex))
                        .filter(Boolean);
                    if (resolved.length > 0) {
                        graph.set(paddedId, resolved);
                    }
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

const DEP_GRAPH_SECTION_TITLE = 'Dependency Graph';
const DEP_GRAPH_SECTION_START = '<!-- AIGON_DEP_GRAPH_START -->';
const DEP_GRAPH_SECTION_END = '<!-- AIGON_DEP_GRAPH_END -->';

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stagePaths(runGit, repoPath, paths) {
    const uniquePaths = [...new Set((paths || []).filter(Boolean))];
    if (uniquePaths.length === 0) return;
    const quoted = uniquePaths.map(p => JSON.stringify(path.relative(repoPath, p))).join(' ');
    runGit(`git add -- ${quoted}`);
}

function appendSpecTransition(utils, specPath, fromFolder, toFolder, actor, agentId) {
    if (!specPath || !fromFolder || !toFolder || typeof utils.modifySpecFile !== 'function') return false;
    try {
        const stripPrefix = (folder) => String(folder).replace(/^\d+-/, '');
        const transition = {
            from: stripPrefix(fromFolder),
            to: stripPrefix(toFolder),
            at: new Date().toISOString(),
            actor: agentId ? `${actor} (${agentId})` : actor,
        };
        const yamlEntry = `  - { from: "${transition.from}", to: "${transition.to}", at: "${transition.at}", actor: "${transition.actor}" }`;
        const result = utils.modifySpecFile(specPath, ({ content }) => {
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

function escapeXml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function truncateText(value, maxLength) {
    const text = String(value || '').trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(1, maxLength - 1))}…`;
}

function stageFromFolder(folder) {
    if (folder === '05-done') return 'done';
    if (folder === '04-in-evaluation') return 'in-evaluation';
    if (folder === '03-in-progress') return 'in-progress';
    if (folder === '02-backlog') return 'backlog';
    if (folder === '01-inbox') return 'inbox';
    if (folder === '06-paused') return 'paused';
    return 'unknown';
}

function stagePalette(stage) {
    const palettes = {
        done: { fill: '#dcfce7', stroke: '#16a34a' },
        'in-progress': { fill: '#dbeafe', stroke: '#2563eb' },
        backlog: { fill: '#e5e7eb', stroke: '#6b7280' },
        'in-evaluation': { fill: '#fef3c7', stroke: '#d97706' },
        inbox: { fill: '#f3f4f6', stroke: '#9ca3af' },
        paused: { fill: '#fef3c7', stroke: '#a16207' },
        unknown: { fill: '#f3f4f6', stroke: '#9ca3af' },
    };
    return palettes[stage] || palettes.unknown;
}

function buildReverseDependencyGraph(graph) {
    const reverse = new Map();
    for (const [node, deps] of graph.entries()) {
        if (!reverse.has(node)) reverse.set(node, []);
        for (const dep of deps) {
            if (!reverse.has(dep)) reverse.set(dep, []);
            reverse.get(dep).push(node);
        }
    }
    return reverse;
}

function collectAncestors(graph, featureId) {
    const ancestors = new Set();
    const stack = [featureId];
    while (stack.length > 0) {
        const node = stack.pop();
        const deps = graph.get(node) || [];
        for (const dep of deps) {
            if (ancestors.has(dep)) continue;
            ancestors.add(dep);
            stack.push(dep);
        }
    }
    return ancestors;
}

function collectDescendants(reverseGraph, featureId) {
    const descendants = new Set();
    const stack = [featureId];
    while (stack.length > 0) {
        const node = stack.pop();
        const dependents = reverseGraph.get(node) || [];
        for (const dependent of dependents) {
            if (descendants.has(dependent)) continue;
            descendants.add(dependent);
            stack.push(dependent);
        }
    }
    return descendants;
}

function idSort(a, b) {
    const aNum = parseInt(String(a), 10);
    const bNum = parseInt(String(b), 10);
    if (Number.isNaN(aNum) && Number.isNaN(bNum)) return String(a).localeCompare(String(b));
    if (Number.isNaN(aNum)) return 1;
    if (Number.isNaN(bNum)) return -1;
    return aNum - bNum;
}

function getNodeMeta(featureId, featureIndex) {
    const entry = featureIndex.byId[featureId];
    if (!entry) {
        return {
            id: featureId,
            name: `feature ${featureId}`,
            stage: 'unknown',
        };
    }
    return {
        id: entry.paddedId,
        name: entry.slug.replace(/-/g, ' '),
        stage: stageFromFolder(entry.folder),
    };
}

function buildFeatureDependencySvg(featureId, featureIndex, graph) {
    const reverseGraph = buildReverseDependencyGraph(graph);
    const ancestors = collectAncestors(graph, featureId);
    const descendants = collectDescendants(reverseGraph, featureId);
    if (ancestors.size === 0 && descendants.size === 0) return null;

    const included = new Set([featureId, ...ancestors, ...descendants]);
    const levels = new Map([[featureId, 0]]);

    // Assign ancestor columns to the left using breadth-first distances.
    const ancestorQueue = [featureId];
    while (ancestorQueue.length > 0) {
        const node = ancestorQueue.shift();
        const currentLevel = levels.get(node);
        const deps = graph.get(node) || [];
        for (const dep of deps) {
            if (!included.has(dep)) continue;
            const nextLevel = currentLevel - 1;
            const priorLevel = levels.get(dep);
            if (priorLevel === undefined || nextLevel < priorLevel) {
                levels.set(dep, nextLevel);
                ancestorQueue.push(dep);
            }
        }
    }

    // Assign descendant columns to the right using breadth-first distances.
    const descendantQueue = [featureId];
    while (descendantQueue.length > 0) {
        const node = descendantQueue.shift();
        const currentLevel = levels.get(node);
        const dependents = reverseGraph.get(node) || [];
        for (const dependent of dependents) {
            if (!included.has(dependent)) continue;
            const nextLevel = currentLevel + 1;
            const priorLevel = levels.get(dependent);
            if (priorLevel === undefined || nextLevel > priorLevel) {
                levels.set(dependent, nextLevel);
                descendantQueue.push(dependent);
            }
        }
    }

    const levelValues = Array.from(new Set([...included].map(id => levels.get(id) || 0))).sort((a, b) => a - b);
    const nodesByLevel = new Map(levelValues.map(level => [level, []]));
    for (const id of included) {
        const level = levels.get(id) || 0;
        nodesByLevel.get(level).push(id);
    }
    for (const ids of nodesByLevel.values()) {
        ids.sort(idSort);
    }

    const nodeWidth = 220;
    const nodeHeight = 84;
    const colGap = 80;
    const rowGap = 24;
    const margin = 24;
    const colStride = nodeWidth + colGap;
    const rowStride = nodeHeight + rowGap;
    const maxRows = Math.max(...levelValues.map(level => nodesByLevel.get(level).length));
    const svgWidth = margin * 2 + (levelValues.length * colStride) - colGap;
    const svgHeight = margin * 2 + (maxRows * rowStride) - rowGap;
    const positions = new Map();

    levelValues.forEach((level, colIndex) => {
        const ids = nodesByLevel.get(level);
        ids.forEach((id, rowIndex) => {
            const x = margin + (colIndex * colStride);
            const y = margin + (rowIndex * rowStride);
            positions.set(id, { x, y });
        });
    });

    const markerId = `dep-arrow-${featureId}`;
    const edgePaths = [];
    for (const dependent of included) {
        const deps = graph.get(dependent) || [];
        for (const dep of deps) {
            if (!included.has(dep)) continue;
            const from = positions.get(dep);
            const to = positions.get(dependent);
            if (!from || !to) continue;

            let x1 = from.x + nodeWidth;
            let x2 = to.x;
            if (from.x > to.x) {
                x1 = from.x;
                x2 = to.x + nodeWidth;
            } else if (from.x === to.x) {
                x1 = from.x + (nodeWidth / 2);
                x2 = to.x + (nodeWidth / 2);
            }
            const y1 = from.y + (nodeHeight / 2);
            const y2 = to.y + (nodeHeight / 2);
            const bend = Math.max(40, Math.abs(x2 - x1) * 0.35);
            const c1 = x1 + (x2 >= x1 ? bend : -bend);
            const c2 = x2 - (x2 >= x1 ? bend : -bend);
            edgePaths.push(`<path d="M ${x1} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${x2} ${y2}" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#${markerId})"/>`);
        }
    }

    const nodeBlocks = [];
    for (const id of [...included].sort(idSort)) {
        const pos = positions.get(id);
        if (!pos) continue;
        const meta = getNodeMeta(id, featureIndex);
        const palette = stagePalette(meta.stage);
        const isCurrent = id === featureId;
        const stroke = isCurrent ? '#f59e0b' : palette.stroke;
        const strokeWidth = isCurrent ? 3 : 2;
        const displayName = truncateText(meta.name, 26);
        const displayStage = truncateText(meta.stage, 18);
        nodeBlocks.push(
            `<g>` +
            `<rect x="${pos.x}" y="${pos.y}" width="${nodeWidth}" height="${nodeHeight}" rx="12" ry="12" fill="${palette.fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>` +
            `<text x="${pos.x + 12}" y="${pos.y + 24}" font-size="14" font-weight="700" fill="#0f172a">#${escapeXml(meta.id)}</text>` +
            `<text x="${pos.x + 12}" y="${pos.y + 46}" font-size="13" font-weight="500" fill="#1f2937">${escapeXml(displayName)}</text>` +
            `<text x="${pos.x + 12}" y="${pos.y + 66}" font-size="12" fill="#475569">${escapeXml(displayStage)}</text>` +
            `</g>`
        );
    }

    return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" role="img" aria-label="Feature dependency graph for feature ${escapeXml(featureId)}" style="font-family: system-ui, -apple-system, sans-serif">`,
        `<defs><marker id="${markerId}" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs>`,
        edgePaths.join(''),
        nodeBlocks.join(''),
        '</svg>',
    ].join('');
}

function upsertDependencyGraphSection(specPath, svgMarkup) {
    if (!specPath || !fs.existsSync(specPath)) return false;
    const content = fs.readFileSync(specPath, 'utf8');
    const sectionPattern = new RegExp(
        `\\n?##\\s+${escapeRegex(DEP_GRAPH_SECTION_TITLE)}\\s*\\n\\n${escapeRegex(DEP_GRAPH_SECTION_START)}[\\s\\S]*?${escapeRegex(DEP_GRAPH_SECTION_END)}\\s*\\n?`,
        'm'
    );

    let nextContent = content;
    if (!svgMarkup) {
        nextContent = nextContent.replace(sectionPattern, '\n').replace(/\n{3,}/g, '\n\n');
    } else {
        const sectionBlock = `\n## ${DEP_GRAPH_SECTION_TITLE}\n\n${DEP_GRAPH_SECTION_START}\n${svgMarkup}\n${DEP_GRAPH_SECTION_END}\n`;
        if (sectionPattern.test(nextContent)) {
            nextContent = nextContent.replace(sectionPattern, sectionBlock);
        } else {
            nextContent = nextContent.replace(/\s*$/, '') + sectionBlock;
        }
    }

    if (nextContent === content) return false;
    fs.writeFileSync(specPath, nextContent);
    return true;
}

function refreshFeatureDependencyGraphs(paths, utils) {
    const featureIndex = buildFeatureIndex(paths);
    const graph = buildDependencyGraph(paths, utils, featureIndex);
    const uniqueEntries = new Map();
    Object.values(featureIndex.byId).forEach(entry => {
        if (!entry || !entry.paddedId || !entry.fullPath) return;
        if (!uniqueEntries.has(entry.paddedId)) uniqueEntries.set(entry.paddedId, entry);
    });

    let changedSpecs = 0;
    const updatedIds = [];
    [...uniqueEntries.values()]
        .sort((a, b) => idSort(a.paddedId, b.paddedId))
        .forEach(entry => {
            const svg = buildFeatureDependencySvg(entry.paddedId, featureIndex, graph);
            if (upsertDependencyGraphSection(entry.fullPath, svg)) {
                changedSpecs += 1;
                updatedIds.push(entry.paddedId);
            }
        });

    return { changedSpecs, updatedIds };
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
        featureId: paddedId,
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

    // Create workflow engine snapshot so the entity shows up with live
    // lifecycle state (not as a "legacy / missing-workflow" orphan). Before
    // this, prioritise moved the file but never registered the entity with
    // the engine — every newly prioritised entity looked like legacy data on
    // the dashboard and had to be backfilled via `aigon doctor --fix` before
    // Start/other actions would appear.
    initWorkflowSnapshot(process.cwd(), def.type, paddedId, moved.fullPath);

    if (def.type === 'feature') {
        const graphResult = refreshFeatureDependencyGraphs(def.paths, u);
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
    const postFound = u.findFile(def.paths, num, ['04-in-evaluation', '03-in-progress']);
    if (postFound) {
        console.warn(`⚠️  Drift: ${def.prefix} ${num} spec still in ${postFound.folder} after engine close. Force-moving to 05-done.`);
        const moved = u.moveFile(postFound, '05-done', null, { actor: `cli/${def.prefix}-close` });
        if (moved && moved.fullPath) stagedPaths.push(moved.fullPath);
        console.log(`📋 Moved spec to done`);
    } else if (def.type === 'research') {
        const doneSpec = u.findFile(def.paths, num, ['05-done']);
        if (doneSpec) {
            if (appendSpecTransition(u, doneSpec.fullPath, fromFolder, '05-done', `cli/${def.prefix}-close`, agentId)) {
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
function entitySubmit(def, id, agentId, ctx) {
    // Emit workflow event so the engine records the submission (fire-and-forget; status file is the sync fallback)
    const entityType = def.type === 'research' ? 'research' : undefined;
    _wf().emitSignal(process.cwd(), id, 'agent-submitted', agentId, entityType ? { entityType } : {})
        .catch(() => { /* best-effort — engine may not be initialised for this entity yet */ });
    // Keep the status file write as a derived cache for shell traps
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

    // Fleet helpers
    createFleetSessions,

    // Dependency helpers
    buildFeatureIndex,
    resolveDepRef,
    buildDependencyGraph,
    buildFeatureDependencySvg,
    detectCycle,
    rewriteDependsOn,
    refreshFeatureDependencyGraphs,
};
