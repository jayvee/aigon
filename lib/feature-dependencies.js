'use strict';

const fs = require('fs');
const path = require('path');
const specCrud = require('./spec-crud');
const { parseFrontMatter } = require('./cli-parse');

// ---------------------------------------------------------------------------
// Feature dependency graph — extracted from entity.js
// ---------------------------------------------------------------------------

function stripInlineYamlComment(value) {
    let inSingle = false;
    let inDouble = false;
    let escaped = false;

    for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            escaped = true;
            continue;
        }
        if (ch === '"' && !inSingle) {
            inDouble = !inDouble;
            continue;
        }
        if (ch === '\'' && !inDouble) {
            inSingle = !inSingle;
            continue;
        }
        if (ch === '#' && !inSingle && !inDouble && (i === 0 || /\s/.test(value[i - 1]))) {
            return value.slice(0, i).trimEnd();
        }
    }

    return value.trimEnd();
}

function splitInlineYamlArray(value) {
    const parts = [];
    let current = '';
    let inSingle = false;
    let inDouble = false;
    let escaped = false;

    for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (escaped) {
            current += ch;
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            current += ch;
            escaped = true;
            continue;
        }
        if (ch === '"' && !inSingle) {
            inDouble = !inDouble;
            current += ch;
            continue;
        }
        if (ch === '\'' && !inDouble) {
            inSingle = !inSingle;
            current += ch;
            continue;
        }
        if (ch === ',' && !inSingle && !inDouble) {
            parts.push(current.trim());
            current = '';
            continue;
        }
        current += ch;
    }

    if (current.trim()) {
        parts.push(current.trim());
    }
    return parts;
}

function parseYamlScalar(rawValue) {
    const value = stripInlineYamlComment(String(rawValue)).trim();
    if (value === '') return '';

    if (value.startsWith('"') && value.endsWith('"')) {
        try {
            return JSON.parse(value);
        } catch (e) {
            return value.slice(1, -1);
        }
    }
    if (value.startsWith('\'') && value.endsWith('\'')) {
        return value.slice(1, -1).replace(/\\'/g, '\'');
    }
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null' || value === '~') return null;
    if (/^-?\d+$/.test(value)) return parseInt(value, 10);
    if (value.startsWith('[') && value.endsWith(']')) {
        const inner = value.slice(1, -1).trim();
        if (!inner) return [];
        return splitInlineYamlArray(inner).map(parseYamlScalar);
    }
    return value;
}

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
function buildDependencyGraph(paths, utils = {}, featureIndex = buildFeatureIndex(paths)) {
    const parse = parseFrontMatter;
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
                const { data } = parse(content);
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
function rewriteDependsOn(specPath, canonicalIds, _utils) {
    specCrud.modifySpecFile(specPath, ({ content }) => {
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
// SVG rendering helpers (private)
// ---------------------------------------------------------------------------

const DEP_GRAPH_SECTION_TITLE = 'Dependency Graph';
const DEP_GRAPH_SECTION_START = '<!-- AIGON_DEP_GRAPH_START -->';
const DEP_GRAPH_SECTION_END = '<!-- AIGON_DEP_GRAPH_END -->';

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
// Dependency blocking check
// ---------------------------------------------------------------------------

/**
 * Check if a feature spec has unmet dependencies (dependencies not in 05-done).
 * Returns an array of {id, slug, stage} for each unmet dependency, or [] if all met.
 */
function checkUnmetDependencies(specPath, featurePaths) {
    if (!specPath || !fs.existsSync(specPath)) return [];
    try {
        const content = fs.readFileSync(specPath, 'utf8');
        const { data } = parseFrontMatter(content);
        if (!Array.isArray(data.depends_on) || data.depends_on.length === 0) return [];
        const featureIndex = buildFeatureIndex(featurePaths);
        const unmet = [];
        for (const dep of data.depends_on) {
            const resolvedId = resolveDepRef(dep, featureIndex);
            if (!resolvedId) continue;
            const entry = featureIndex.byId[resolvedId];
            if (!entry || entry.folder !== '05-done') {
                const stage = entry ? entry.folder.replace(/^\d+-/, '') : 'unknown';
                unmet.push({ id: resolvedId, slug: entry ? entry.slug : String(dep), stage });
            }
        }
        return unmet;
    } catch (e) {
        return [];
    }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
    buildFeatureIndex,
    resolveDepRef,
    buildDependencyGraph,
    detectCycle,
    rewriteDependsOn,
    buildFeatureDependencySvg,
    refreshFeatureDependencyGraphs,
    checkUnmetDependencies,
};
