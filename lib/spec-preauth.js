'use strict';

const { execFileSync } = require('child_process');
const { readSpecSection } = require('./spec-crud');
const { slugify } = require('./cli-parse');

const PREAUTH_FOOTER_RE = /^Pre-authorised-by:\s*(.+)\s*$/gim;

function normalizePreauthSlug(value) {
    return slugify(String(value || '').trim());
}

/**
 * Parse `## Pre-authorised` bullets into { slug, description } entries.
 * @param {string} specPath
 * @returns {{ slug: string, description: string }[]}
 */
function parsePreauthEntries(specPath) {
    const lines = readSpecSection(specPath, 'Pre-authorised');
    return lines.map((description) => ({
        slug: normalizePreauthSlug(description),
        description,
    }));
}

function resolveCommitRange(baseRef, targetRef, cwd) {
    const base = String(baseRef || 'main').trim();
    const target = String(targetRef || 'HEAD').trim();
    let range = `${base}..${target}`;
    try {
        execFileSync('git', ['rev-parse', '--verify', base], { cwd, stdio: 'pipe' });
        execFileSync('git', ['rev-parse', '--verify', target], { cwd, stdio: 'pipe' });
    } catch (_) {
        return null;
    }
    try {
        const mergeBase = execFileSync('git', ['merge-base', base, target], {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        if (mergeBase) range = `${mergeBase}..${target}`;
    } catch (_) {
        // Fall back to base..target when merge-base is unavailable.
    }
    return range;
}

/**
 * Extract Pre-authorised-by footers from commits in a git range.
 * @returns {{ sha: string, slug: string, normalizedSlug: string, subject: string }[]}
 */
function extractPreauthFootersFromRange(repoPath, baseRef, targetRef) {
    const range = resolveCommitRange(baseRef, targetRef, repoPath);
    if (!range) return [];

    let raw = '';
    try {
        raw = execFileSync('git', ['log', '--format=%H%x1f%s%x1f%B%x1e', '--reverse', range], {
            cwd: repoPath,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
    } catch (_) {
        return [];
    }

    const footers = [];
    const records = raw.split('\x1e').filter(Boolean);
    for (const record of records) {
        const parts = record.split('\x1f');
        const sha = (parts[0] || '').trim();
        const subject = (parts[1] || '').trim();
        const body = parts.slice(2).join('\x1f');
        if (!sha) continue;

        PREAUTH_FOOTER_RE.lastIndex = 0;
        let match;
        while ((match = PREAUTH_FOOTER_RE.exec(body)) !== null) {
            const slug = String(match[1] || '').trim();
            if (!slug) continue;
            footers.push({
                sha,
                subject,
                slug,
                normalizedSlug: normalizePreauthSlug(slug),
            });
        }
    }
    return footers;
}

function slugMatchesFooter(entrySlug, footer) {
    const entry = normalizePreauthSlug(entrySlug);
    const normalized = footer.normalizedSlug || normalizePreauthSlug(footer.slug);
    return entry === normalized;
}

/**
 * Validate commit footers against spec pre-authorisations.
 * @returns {{
 *   ok: boolean,
 *   matched: { slug: string, description: string, sha: string, subject: string }[],
 *   unmatched: { slug: string, sha: string, subject: string }[],
 *   entries: { slug: string, description: string }[],
 *   footers: object[],
 * }}
 */
function validatePreauthorisations(specPath, repoPath, baseRef, targetRef) {
    const entries = parsePreauthEntries(specPath);
    const footers = extractPreauthFootersFromRange(repoPath, baseRef, targetRef);
    const entrySlugs = new Set(entries.map((e) => e.slug));

    if (footers.length === 0) {
        return { ok: true, matched: [], unmatched: [], entries, footers };
    }

    const matched = [];
    const unmatched = [];
    for (const footer of footers) {
        const entry = entries.find((e) => slugMatchesFooter(e.slug, footer));
        if (entry) {
            matched.push({
                slug: entry.slug,
                description: entry.description,
                sha: footer.sha,
                subject: footer.subject,
            });
        } else if (!entrySlugs.has(footer.normalizedSlug)) {
            unmatched.push({
                slug: footer.slug,
                sha: footer.sha,
                subject: footer.subject,
            });
        }
    }

    return {
        ok: unmatched.length === 0,
        matched,
        unmatched,
        entries,
        footers,
    };
}

function formatPreauthFailureMessage(unmatched) {
    const lines = ['Pre-authorisation validation failed — unmatched commit footer(s):'];
    for (const item of unmatched) {
        lines.push(`  • ${item.sha.slice(0, 7)}: Pre-authorised-by: ${item.slug}`);
    }
    lines.push('Fix: add a matching line to the spec `## Pre-authorised` section (with operator consent),');
    lines.push('     or revert the commit that bypassed the gate.');
    lines.push('Emergency bypass: aigon feature-close <ID> --no-verify-preauth');
    return lines.join('\n');
}

function formatPreauthWarning(unmatched) {
    const lines = ['Unmatched Pre-authorised-by footer(s) — will block feature-close until resolved:'];
    for (const item of unmatched) {
        lines.push(`  • ${item.sha.slice(0, 7)}: ${item.slug}`);
    }
    return lines.join('\n');
}

module.exports = {
    parsePreauthEntries,
    extractPreauthFootersFromRange,
    validatePreauthorisations,
    normalizePreauthSlug,
    formatPreauthFailureMessage,
    formatPreauthWarning,
};
