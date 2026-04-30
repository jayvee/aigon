'use strict';

const fs = require('fs');
const path = require('path');
const cliParse = require('./cli-parse');
const {
    buildFeatureIndex,
    buildDependencyGraph,
    resolveDepRef,
} = require('./feature-dependencies');
const { CANONICAL_STAGE_DIRS } = require('./workflow-core/paths');

// Stage order shared with board.js / dashboard for sorting and summaries.
const STAGE_BY_FOLDER = Object.freeze({
    '01-inbox': 'inbox',
    '02-backlog': 'backlog',
    '03-in-progress': 'in-progress',
    '04-in-evaluation': 'in-evaluation',
    '05-done': 'done',
    '06-paused': 'paused',
});

const STAGE_ORDER = Object.freeze(['inbox', 'backlog', 'in-progress', 'in-evaluation', 'done', 'paused']);

function _defaultPaths() {
    return require('./templates').PATHS.features;
}

/**
 * Build a feature-paths descriptor rooted at `absRepoPath`. Used by the
 * dashboard collector, which walks multiple repos and cannot rely on
 * `PATHS.features` (which is frozen to cwd at module load).
 */
function featurePathsForRepo(absRepoPath) {
    return {
        root: path.join(absRepoPath, 'docs', 'specs', 'features'),
        folders: [...CANONICAL_STAGE_DIRS],
        prefix: 'feature',
    };
}

/**
 * A valid set slug is a non-empty token of [a-z0-9-]. Reject anything with
 * whitespace, slashes, or path separators so a slug is always safe as a CLI
 * argument, a URL query value, and a dashboard DOM id.
 */
function isValidSetSlug(value) {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (!trimmed) return false;
    return /^[a-z0-9][a-z0-9-]*$/.test(trimmed);
}

function readSetTag(content) {
    const { data } = cliParse.parseFrontMatter(String(content || ''));
    const raw = data && data.set;
    if (raw === undefined || raw === null || raw === '') return null;
    const slug = String(raw).trim();
    if (!isValidSetSlug(slug)) return null;
    return slug;
}

function readResearchTag(content) {
    const { data } = cliParse.parseFrontMatter(String(content || ''));
    const ids = data && Array.isArray(data.research) ? data.research : null;
    if (!ids || ids.length === 0) return null;
    if (ids.length === 1) return ids[0];
    return [...ids];
}

/**
 * Scan every feature spec under `paths.root` and return a map of
 * setSlug → ordered member entries. Each member entry carries everything the
 * CLI/dashboard need without re-reading the file:
 *   { paddedId, slug, file, folder, fullPath, stage, mtimeMs, setSlug }
 *
 * Features without a `set:` tag or with an invalid tag are omitted. Features
 * in the inbox (no padded ID yet) are included because a user can tag a spec
 * the moment it is created — the member entry's `paddedId` is null for those.
 */
function scanFeatureSets(paths = _defaultPaths(), specIndex = null) {
    const bySlug = new Map();
    if (!paths || !paths.root) return bySlug;

    const resolvedIndex = specIndex;
    if (resolvedIndex && Array.isArray(resolvedIndex.entries)) {
        resolvedIndex.entries.forEach(entry => {
            if (!entry.setSlug || !entry.slug) return;
            const folder = Object.keys(STAGE_BY_FOLDER).find(key => STAGE_BY_FOLDER[key] === entry.stage) || '01-inbox';
            const setEntry = {
                paddedId: entry.id,
                slug: entry.slug,
                file: entry.file,
                folder,
                fullPath: entry.fullPath,
                stage: entry.stage,
                mtimeMs: entry.mtimeMs || 0,
                setSlug: entry.setSlug,
            };
            if (!bySlug.has(entry.setSlug)) bySlug.set(entry.setSlug, []);
            bySlug.get(entry.setSlug).push(setEntry);
        });

        for (const entries of bySlug.values()) {
            entries.sort((a, b) => {
                const sa = STAGE_ORDER.indexOf(a.stage);
                const sb = STAGE_ORDER.indexOf(b.stage);
                if (sa !== sb) return (sa === -1 ? 99 : sa) - (sb === -1 ? 99 : sb);
                const na = a.paddedId ? parseInt(a.paddedId, 10) : Number.POSITIVE_INFINITY;
                const nb = b.paddedId ? parseInt(b.paddedId, 10) : Number.POSITIVE_INFINITY;
                if (na !== nb) return na - nb;
                return a.slug.localeCompare(b.slug);
            });
        }
        return bySlug;
    }

    for (const folder of paths.folders) {
        const dir = path.join(paths.root, folder);
        if (!fs.existsSync(dir)) continue;
        for (const file of fs.readdirSync(dir)) {
            if (!file.startsWith(`${paths.prefix}-`) || !file.endsWith('.md')) continue;
            const fullPath = path.join(dir, file);
            let content;
            try {
                content = fs.readFileSync(fullPath, 'utf8');
            } catch (_) { continue; }
            const setSlug = readSetTag(content);
            if (!setSlug) continue;

            const idMatch = file.match(/^feature-(\d+)-(.+)\.md$/);
            const noIdMatch = !idMatch && file.match(/^feature-(.+)\.md$/);
            const paddedId = idMatch ? idMatch[1] : null;
            const featureSlug = idMatch ? idMatch[2] : (noIdMatch ? noIdMatch[1] : null);
            if (!featureSlug) continue;

            let mtimeMs = 0;
            try { mtimeMs = fs.statSync(fullPath).mtimeMs; } catch (_) {}

            const entry = {
                paddedId,
                slug: featureSlug,
                file,
                folder,
                fullPath,
                stage: STAGE_BY_FOLDER[folder] || 'unknown',
                mtimeMs,
                setSlug,
            };

            if (!bySlug.has(setSlug)) bySlug.set(setSlug, []);
            bySlug.get(setSlug).push(entry);
        }
    }

    // Stable ordering: stage progression first, then padded numeric id, then slug.
    for (const entries of bySlug.values()) {
        entries.sort((a, b) => {
            const sa = STAGE_ORDER.indexOf(a.stage);
            const sb = STAGE_ORDER.indexOf(b.stage);
            if (sa !== sb) return (sa === -1 ? 99 : sa) - (sb === -1 ? 99 : sb);
            const na = a.paddedId ? parseInt(a.paddedId, 10) : Number.POSITIVE_INFINITY;
            const nb = b.paddedId ? parseInt(b.paddedId, 10) : Number.POSITIVE_INFINITY;
            if (na !== nb) return na - nb;
            return a.slug.localeCompare(b.slug);
        });
    }
    return bySlug;
}

function countMembersByStage(members) {
    const counts = Object.fromEntries(STAGE_ORDER.map(stage => [stage, 0]));
    for (const m of members) {
        if (counts[m.stage] !== undefined) counts[m.stage]++;
    }
    return counts;
}

function isMemberComplete(member) {
    return member.stage === 'done';
}

/**
 * Build a summary row per set. Cheap — O(features) after the scan.
 */
function summarizeSets(paths = _defaultPaths(), specIndex = null) {
    const index = scanFeatureSets(paths, specIndex);
    const summaries = [];
    for (const [setSlug, members] of index.entries()) {
        const counts = countMembersByStage(members);
        const completed = members.filter(isMemberComplete).length;
        const lastUpdatedAt = members.reduce((m, x) => Math.max(m, x.mtimeMs || 0), 0);
        summaries.push({
            slug: setSlug,
            memberCount: members.length,
            completed,
            counts,
            lastUpdatedAt: lastUpdatedAt ? new Date(lastUpdatedAt).toISOString() : null,
            isComplete: completed === members.length && members.length > 0,
        });
    }
    summaries.sort((a, b) => a.slug.localeCompare(b.slug));
    return summaries;
}

/**
 * Return one set's member list in topological order based on depends_on edges.
 * Members without a padded ID (inbox) are appended after the sorted chain —
 * they aren't in the dep graph until prioritisation assigns them an ID.
 * Cycles cannot be introduced by `set` alone; if the existing graph has a
 * cycle we preserve the scan order to avoid crashing a read path.
 */
function getSetMembersSorted(setSlug, paths = _defaultPaths(), specIndex = null) {
    const index = scanFeatureSets(paths, specIndex);
    const members = index.get(setSlug) || [];
    if (members.length === 0) return [];

    const identified = members.filter(m => m.paddedId);
    const anonymous = members.filter(m => !m.paddedId);
    if (identified.length === 0) return [...anonymous];

    const memberIds = new Set(identified.map(m => m.paddedId));
    const index2 = buildFeatureIndex(paths, specIndex);
    const graph = buildDependencyGraph(paths, {}, index2, specIndex);

    // Restrict the graph to edges inside this set — cross-set deps shouldn't
    // gate ordering within this view (and would pull in non-members).
    const subGraph = new Map();
    for (const id of memberIds) {
        const deps = (graph.get(id) || []).filter(d => memberIds.has(d));
        subGraph.set(id, deps);
    }

    // Kahn's algorithm. Tie-break by numeric id so output is stable.
    const indegree = new Map([...memberIds].map(id => [id, 0]));
    // Incoming edge = someone depends on this node; deps ⇒ parents.
    for (const [node, deps] of subGraph.entries()) {
        for (const _ of deps) indegree.set(node, (indegree.get(node) || 0) + 1);
    }

    const ready = [...indegree.entries()]
        .filter(([, deg]) => deg === 0)
        .map(([id]) => id)
        .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

    const order = [];
    const reverse = new Map();
    for (const [node, deps] of subGraph.entries()) {
        for (const d of deps) {
            if (!reverse.has(d)) reverse.set(d, []);
            reverse.get(d).push(node);
        }
    }

    while (ready.length > 0) {
        const node = ready.shift();
        order.push(node);
        for (const dependent of reverse.get(node) || []) {
            indegree.set(dependent, (indegree.get(dependent) || 0) - 1);
            if (indegree.get(dependent) === 0) {
                ready.push(dependent);
                ready.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
            }
        }
    }

    const byId = new Map(identified.map(m => [m.paddedId, m]));
    const sorted = order.length === memberIds.size
        ? order.map(id => byId.get(id))
        : identified;
    return [...sorted, ...anonymous];
}

/**
 * Normalise a depends_on token the same way resolveDepRef treats non-numeric refs.
 * @param {string} ref
 * @returns {string}
 */
function slugifyDepToken(ref) {
    return String(ref).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Return inbox feature slugs for `setSlug` in an order safe for sequential
 * `feature-prioritise` (each member's backlog deps exist before it runs).
 * Uses intra-set depends_on edges between inbox peers; other refs must resolve
 * via {@link resolveDepRef} against existing prioritised specs.
 *
 * @param {string} setSlug
 * @param {object} [paths] feature paths descriptor (defaults to PATHS.features)
 * @returns {string[]}
 */
function computeSetInboxPrioritisationOrder(setSlug, paths = _defaultPaths(), specIndex = null) {
    if (!isValidSetSlug(setSlug)) {
        throw new Error(`Invalid set slug: "${setSlug}"`);
    }
    const members = scanFeatureSets(paths, specIndex).get(setSlug) || [];
    const inboxPeers = members.filter(m => !m.paddedId && m.stage === 'inbox');
    if (inboxPeers.length === 0) {
        throw new Error(`No inbox features in set "${setSlug}" to prioritise (all members already have IDs, or the set is empty).`);
    }

    const peerSlugs = new Set(inboxPeers.map(m => m.slug));
    const featureIndex = buildFeatureIndex(paths, specIndex);

    /** @type {Map<string, string[]>} peer -> inbox peers that depend on peer */
    const adj = new Map();
    /** @type {Map<string, number>} */
    const indegree = new Map();
    for (const slug of peerSlugs) {
        adj.set(slug, []);
        indegree.set(slug, 0);
    }

    for (const m of inboxPeers) {
        let content;
        try {
            content = fs.readFileSync(m.fullPath, 'utf8');
        } catch (e) {
            throw new Error(`Could not read ${m.fullPath}: ${e.message}`);
        }
        const { data } = cliParse.parseFrontMatter(content);
        const rawDeps = Array.isArray(data.depends_on) ? data.depends_on : [];

        for (const ref of rawDeps) {
            const ext = resolveDepRef(ref, featureIndex);
            if (ext) continue;

            const norm = slugifyDepToken(ref);
            if (!peerSlugs.has(norm)) {
                const label = String(ref).trim();
                if (/^\d+$/.test(label)) {
                    throw new Error(`depends_on "${label}" in feature-${m.slug}.md does not match any existing prioritised feature.`);
                }
                throw new Error(`depends_on "${label}" in feature-${m.slug}.md is not another inbox member of set "${setSlug}" and does not match a backlog feature slug or id.`);
            }

            adj.get(norm).push(m.slug);
            indegree.set(m.slug, (indegree.get(m.slug) || 0) + 1);
        }
    }

    const ready = [...peerSlugs].filter(s => indegree.get(s) === 0).sort((a, b) => a.localeCompare(b));
    const order = [];

    while (ready.length > 0) {
        const u = ready.shift();
        order.push(u);
        for (const v of adj.get(u) || []) {
            indegree.set(v, indegree.get(v) - 1);
            if (indegree.get(v) === 0) {
                ready.push(v);
                ready.sort((a, b) => a.localeCompare(b));
            }
        }
    }

    if (order.length !== peerSlugs.size) {
        throw new Error(`Circular depends_on among inbox members of set "${setSlug}".`);
    }
    return order;
}

/** Intra-set dep edges (source paddedId → dependency paddedId) for rendering. */
function getSetDependencyEdges(setSlug, paths = _defaultPaths(), specIndex = null) {
    const members = (scanFeatureSets(paths, specIndex).get(setSlug) || []).filter(m => m.paddedId);
    if (members.length === 0) return [];
    const memberIds = new Set(members.map(m => m.paddedId));
    const graph = buildDependencyGraph(paths, {}, undefined, specIndex);
    const edges = [];
    for (const id of memberIds) {
        for (const dep of graph.get(id) || []) {
            if (memberIds.has(dep)) edges.push({ from: id, to: dep });
        }
    }
    return edges;
}

module.exports = {
    isValidSetSlug,
    readSetTag,
    readResearchTag,
    scanFeatureSets,
    summarizeSets,
    getSetMembersSorted,
    getSetDependencyEdges,
    computeSetInboxPrioritisationOrder,
    slugifyDepToken,
    countMembersByStage,
    featurePathsForRepo,
    STAGE_ORDER,
    STAGE_BY_FOLDER,
};
