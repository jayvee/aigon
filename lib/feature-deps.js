'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Parse the body-level `depends_on:` line from a feature spec.
 * Handles: "depends_on: slug", "depends_on: slug1, slug2", "depends_on: none".
 * Returns an array of raw reference strings, empty array when no dependencies.
 */
function parseDependsOn(specContent) {
    const m = specContent.match(/^depends_on:\s*(.+)$/m);
    if (!m) return [];
    const raw = m[1].trim();
    if (!raw || raw === 'none') return [];
    return raw.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Locate a parent feature by slug or numeric ID across all spec folders.
 * Returns { slug, status } where status is the folder name (e.g. '01-inbox')
 * or 'missing' if not found anywhere.
 */
function locateParent(ref, paths) {
    const str = String(ref).trim();
    const isNumeric = /^\d+$/.test(str);

    for (const folder of paths.folders) {
        const dir = path.join(paths.root, folder);
        if (!fs.existsSync(dir)) continue;
        for (const file of fs.readdirSync(dir)) {
            if (!file.endsWith('.md')) continue;
            if (isNumeric) {
                const m = file.match(/^feature-(\d+)-.+\.md$/);
                if (m && (m[1] === str.padStart(2, '0') || String(parseInt(m[1], 10)) === str)) {
                    return { slug: file.replace(/^feature-\d+-/, '').replace(/\.md$/, ''), status: folder };
                }
            } else {
                const slug = str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                if (file === `feature-${slug}.md`) {
                    return { slug, status: folder };
                }
                const m = file.match(/^feature-\d+-(.+)\.md$/);
                if (m && m[1] === slug) {
                    return { slug, status: folder };
                }
            }
        }
    }

    return { slug: str, status: 'missing' };
}

/**
 * Check that all declared parent refs are in a prioritised state
 * (02-backlog or later, not 01-inbox and not missing).
 * Returns an array of violation objects { slug, status }.
 */
function checkDepsPrioritised(parentRefs, paths) {
    const violations = [];
    for (const ref of parentRefs) {
        const { slug, status } = locateParent(ref, paths);
        if (status === '01-inbox' || status === 'missing') {
            violations.push({ slug: ref, status });
        }
    }
    return violations;
}

/**
 * Format the hard-fail error message for unprioritised parents.
 */
function formatDepViolationError(childSlug, violations) {
    const lines = [
        `❌ Cannot prioritise ${childSlug} — depends on parent feature(s) not yet prioritised:`,
    ];
    for (const v of violations) {
        const note = v.status === 'missing' ? '(not found on disk)' : `(still in ${v.status}/)`;
        lines.push(`   - ${v.slug}  ${note}`);
    }
    lines.push('Prioritise the parents first:');
    for (const v of violations) {
        if (v.status !== 'missing') {
            lines.push(`   aigon feature-prioritise ${v.slug}`);
        }
    }
    lines.push('Or use --skip-dep-check to override (use sparingly; produces invalid backlog ordering).');
    return lines.join('\n');
}

/**
 * Read set: and set_lead: from spec frontmatter content.
 * Returns { set: string|null, set_lead: boolean }.
 */
function readSetMembership(content) {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!match) return { set: null, set_lead: false };
    const fm = match[1];
    const setMatch = fm.match(/^set:\s*(.+)$/m);
    const leadMatch = fm.match(/^set_lead:\s*(true|false)$/m);
    return {
        set: setMatch ? setMatch[1].trim() : null,
        set_lead: leadMatch ? leadMatch[1] === 'true' : false,
    };
}

/**
 * Scan the inbox folder for all feature specs belonging to a given set.
 * @returns {Array} [{ slug, fullPath, set, set_lead, deps }]
 */
function scanInboxBySet(setSlug, specRoot) {
    const inboxDir = path.join(specRoot, '01-inbox');
    if (!fs.existsSync(inboxDir)) return [];
    const results = [];
    for (const file of fs.readdirSync(inboxDir)) {
        if (!file.endsWith('.md') || !file.startsWith('feature-')) continue;
        const fullPath = path.join(inboxDir, file);
        const content = fs.readFileSync(fullPath, 'utf8');
        const { set, set_lead } = readSetMembership(content);
        if (set !== setSlug) continue;
        const slug = file.replace(/^feature-/, '').replace(/\.md$/, '');
        const deps = parseDependsOn(content);
        results.push({ slug, fullPath, set, set_lead, deps });
    }
    return results;
}

/**
 * Get all distinct set slugs found in inbox and backlog specs.
 * @param {string} specRoot - root of the feature spec tree
 * @param {string[]} [folders] - override stage folders to scan (default: inbox + backlog)
 * @returns {string[]} sorted array of set slugs
 */
function getAllKnownSets(specRoot, folders) {
    const stageFolders = folders || ['01-inbox', '02-backlog'];
    const sets = new Set();
    for (const folder of stageFolders) {
        const dir = path.join(specRoot, folder);
        if (!fs.existsSync(dir)) continue;
        for (const file of fs.readdirSync(dir)) {
            if (!file.endsWith('.md') || !file.startsWith('feature-')) continue;
            const content = fs.readFileSync(path.join(dir, file), 'utf8');
            const { set } = readSetMembership(content);
            if (set) sets.add(set);
        }
    }
    return [...sets].sort();
}

/**
 * Topological sort using Kahn's algorithm with tie-breaker.
 * Tie-breaker: set_lead: true first, then alphabetical by slug.
 * Deps not present in the specs array are treated as external (already prioritised) and ignored.
 * @param {Array} specs - [{ slug, set_lead, deps: [slug,...] }]
 * @returns {{ sorted: string[], cycle: string[]|null }}
 */
function topoSort(specs) {
    const slugToSpec = new Map(specs.map(s => [s.slug, s]));
    const slugSet = new Set(specs.map(s => s.slug));
    const inDegree = new Map(specs.map(s => [s.slug, 0]));
    const adj = new Map(specs.map(s => [s.slug, []]));

    for (const s of specs) {
        for (const dep of s.deps) {
            if (!slugSet.has(dep)) continue; // external dep already prioritised — skip
            adj.get(dep).push(s.slug);
            inDegree.set(s.slug, inDegree.get(s.slug) + 1);
        }
    }

    const cmp = (a, b) => {
        const sa = slugToSpec.get(a);
        const sb = slugToSpec.get(b);
        if (sa && sb) {
            if (sa.set_lead && !sb.set_lead) return -1;
            if (!sa.set_lead && sb.set_lead) return 1;
        }
        return a.localeCompare(b);
    };

    let ready = specs.filter(s => inDegree.get(s.slug) === 0).map(s => s.slug).sort(cmp);
    const sorted = [];

    while (ready.length > 0) {
        const slug = ready.shift();
        sorted.push(slug);
        const newReady = [];
        for (const child of (adj.get(slug) || [])) {
            inDegree.set(child, inDegree.get(child) - 1);
            if (inDegree.get(child) === 0) newReady.push(child);
        }
        ready = [...ready, ...newReady].sort(cmp);
    }

    if (sorted.length !== specs.length) {
        const inSorted = new Set(sorted);
        const cycleNodes = specs.filter(s => !inSorted.has(s.slug)).map(s => s.slug);
        return { sorted: [], cycle: _findCyclePath(cycleNodes, adj) };
    }

    return { sorted, cycle: null };
}

function _findCyclePath(nodes, adj) {
    const nodeSet = new Set(nodes);
    const color = new Map(nodes.map(n => [n, 0])); // 0=white, 1=gray, 2=black
    const parent = new Map();
    let cyclePath = null;

    function dfs(node) {
        if (cyclePath) return;
        color.set(node, 1);
        for (const child of (adj.get(node) || [])) {
            if (cyclePath || !nodeSet.has(child)) continue;
            if (color.get(child) === 1) {
                // Back-edge: node → child (child is gray ancestor); reconstruct cycle
                const path = [];
                let cur = node;
                while (cur !== child) {
                    path.push(cur);
                    cur = parent.get(cur);
                    if (cur === undefined) { cyclePath = nodes; return; }
                }
                path.reverse();
                path.unshift(child);
                path.push(child);
                cyclePath = path;
                return;
            }
            if (color.get(child) === 0) {
                parent.set(child, node);
                dfs(child);
            }
        }
        color.set(node, 2);
    }

    for (const node of nodes) {
        if (!cyclePath && color.get(node) === 0) dfs(node);
    }

    return cyclePath || nodes;
}

module.exports = {
    parseDependsOn,
    checkDepsPrioritised,
    formatDepViolationError,
    readSetMembership,
    scanInboxBySet,
    getAllKnownSets,
    topoSort,
};
