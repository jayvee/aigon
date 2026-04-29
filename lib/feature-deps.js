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

module.exports = { parseDependsOn, checkDepsPrioritised, formatDepViolationError };
