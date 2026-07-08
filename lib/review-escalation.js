'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

/** Minimum documented categories; unknown categories are still accepted. */
const ESCALATION_CATEGORIES = Object.freeze([
    'architectural',
    'security',
    'scope',
    'spec-shortfall',
]);

const ESCALATE_LINE_RE = /^\s*(?:[-*]|\d+\.)?\s*(?:\*\*)?ESCALATE:([a-z][a-z0-9-]*)\*{0,2}\s*[—–-]\s*(.+)$/i;

function extractCodeReviewSection(body) {
    const text = String(body || '');
    const sections = text.split(/^## /m);
    const match = sections.find((section, index) => index > 0 && /^Code Review\b/.test(section));
    if (!match) return '';
    return match.split(/^## /m)[0];
}

/**
 * Parse ESCALATE markers from an implementation log body.
 * @returns {Array<{category: string, reason: string, lineNumber: number}>}
 */
function parseEscalationMarkers(logBody, { baseLine = 1 } = {}) {
    const section = extractCodeReviewSection(logBody);
    if (!section) return [];
    const lines = section.split('\n');
    const markers = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const hit = line.match(ESCALATE_LINE_RE);
        if (!hit) continue;
        markers.push({
            category: String(hit[1] || '').trim().toLowerCase(),
            reason: String(hit[2] || '').trim(),
            lineNumber: baseLine + i,
        });
    }
    return markers;
}

function computeEscalationId(logPath, lineNumber, category) {
    const rel = String(logPath || '').replace(/\\/g, '/');
    return `${rel}:${lineNumber}:${String(category || '').toLowerCase()}`;
}

function stableEscalationId(logPath, lineNumber, category) {
    const raw = computeEscalationId(logPath, lineNumber, category);
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

function findFeatureImplementationLog(repoPath, featureId) {
    const padded = String(featureId || '').trim().padStart(2, '0');
    const logsDir = path.join(repoPath, 'docs', 'specs', 'features', 'logs');
    if (!fs.existsSync(logsDir)) return null;
    const file = fs.readdirSync(logsDir)
        .find((name) => name.startsWith(`feature-${padded}-`) && name.endsWith('-log.md'));
    if (!file) return null;
    const fullPath = path.join(logsDir, file);
    return {
        file,
        fullPath,
        relPath: path.join('docs', 'specs', 'features', 'logs', file).replace(/\\/g, '/'),
    };
}

function listFeatureWorktreeDirs(repoPath, featureId) {
    const padded = String(featureId || '').trim().padStart(2, '0');
    const repoName = path.basename(path.resolve(repoPath));
    const baseDir = path.join(os.homedir(), '.aigon', 'worktrees', repoName);
    if (!fs.existsSync(baseDir)) return [];
    try {
        return fs.readdirSync(baseDir)
            .filter((name) => name.startsWith(`feature-${padded}-`))
            .map((name) => path.join(baseDir, name))
            .filter((dir) => fs.existsSync(dir));
    } catch (_) {
        return [];
    }
}

/**
 * Roots to search for an implementation log. Worktree implementations store
 * logs on the feature branch checkout, not in the primary repo cwd.
 */
function resolveImplementationLogSearchRoots(repoPath, featureId, options = {}) {
    const seen = new Set();
    const roots = [];
    const add = (root) => {
        if (!root) return;
        const resolved = path.resolve(root);
        if (seen.has(resolved)) return;
        seen.add(resolved);
        roots.push(resolved);
    };
    if (options.worktreePath) add(options.worktreePath);
    if (options.cwd) add(options.cwd);
    for (const wt of listFeatureWorktreeDirs(repoPath, featureId)) add(wt);
    add(repoPath);
    return roots;
}

function readImplementationLogBody(repoPath, featureId, options = {}) {
    const roots = options.searchRoots
        || resolveImplementationLogSearchRoots(repoPath, featureId, options);
    for (const root of roots) {
        const found = findFeatureImplementationLog(root, featureId);
        if (!found) continue;
        try {
            return { log: found, body: fs.readFileSync(found.fullPath, 'utf8'), repoRoot: root };
        } catch (_) {
            return { log: found, body: '', repoRoot: root };
        }
    }
    return { log: null, body: '' };
}

function getOpenEscalations(snapshot) {
    return Array.isArray(snapshot && snapshot.openEscalations) ? snapshot.openEscalations : [];
}

function hasOpenReviewEscalations(snapshot) {
    return getOpenEscalations(snapshot).length > 0;
}

function formatEscalationCloseBlockMessage(featureId, openEscalations) {
    const id = String(featureId || '').trim().padStart(2, '0');
    const lines = [
        `Feature ${id} has ${openEscalations.length} open review escalation(s) that must be dispositioned before close:`,
        '',
    ];
    openEscalations.forEach((entry, index) => {
        const n = index + 1;
        const reason = String(entry.reason || '').trim();
        const preview = reason.length > 120 ? `${reason.slice(0, 117)}…` : reason;
        lines.push(`  ${n}. [${entry.category}] ${preview}`);
        lines.push(`     aigon feature-escalation accept ${id} ${n} --reason "…"`);
        lines.push(`     aigon feature-escalation follow-up ${id} ${n} --name <slug>`);
        lines.push(`     aigon feature-escalation reopen ${id} ${n} --reason "…"`);
        lines.push('');
    });
    return lines.join('\n').trimEnd();
}

function resolveEscalationByIndex(snapshot, index) {
    const open = getOpenEscalations(snapshot);
    const n = Number(index);
    if (!Number.isInteger(n) || n < 1 || n > open.length) return null;
    return open[n - 1];
}

module.exports = {
    ESCALATION_CATEGORIES,
    ESCALATE_LINE_RE,
    extractCodeReviewSection,
    parseEscalationMarkers,
    computeEscalationId,
    stableEscalationId,
    findFeatureImplementationLog,
    listFeatureWorktreeDirs,
    resolveImplementationLogSearchRoots,
    readImplementationLogBody,
    getOpenEscalations,
    hasOpenReviewEscalations,
    formatEscalationCloseBlockMessage,
    resolveEscalationByIndex,
};
