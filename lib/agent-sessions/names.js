'use strict';

// Aigon session naming and parsing.
//
// This module owns the tmux session-name convention so that workflow-core,
// dashboard routes, and command modules can build/parse names without reaching
// into `lib/worktree.js`. `lib/worktree.js` re-exports these for backwards
// compatibility (F554). The functions are pure (path-only) so the module has no
// circular-dependency edges.

const path = require('path');

/**
 * Valid tmux session roles.
 * - do: implementation sessions
 * - eval: evaluation sessions
 * - review: code review sessions
 * - auto: autonomous orchestrator sessions
 */
const VALID_TMUX_ROLES = ['do', 'eval', 'review', 'revise', 'spec-review', 'spec-revise', 'spec-check', 'close', 'auto'];

function toUnpaddedId(id) {
    const parsed = parseInt(String(id), 10);
    return Number.isNaN(parsed) ? String(id) : String(parsed);
}

function resolveTmuxRepoName(options) {
    if (options && options.repo) {
        return path.basename(options.repo);
    }

    const worktreePath = options && (options.worktreePath || options.path || options.cwd);
    if (worktreePath) {
        const normalizedPath = path.resolve(worktreePath);
        const baseName = path.basename(normalizedPath);
        const parentBase = path.basename(path.dirname(normalizedPath));
        const grandparentPath = path.dirname(path.dirname(normalizedPath));

        // New location: ~/.aigon/worktrees/{repoName}/feature-NNN-agent-desc
        if (/^(feature|research)-\d+-[a-z]{2}(?:-|$)/.test(baseName) &&
            path.basename(grandparentPath) === 'worktrees' &&
            path.basename(path.dirname(grandparentPath)) === '.aigon') {
            return parentBase; // parentBase IS the repoName
        }

        // Legacy location: ../{repoName}-worktrees/feature-NNN-agent-desc
        if (/^(feature|research)-\d+-[a-z]{2}(?:-|$)/.test(baseName) && parentBase.endsWith('-worktrees')) {
            return parentBase.slice(0, -'-worktrees'.length);
        }

        if (baseName.endsWith('-worktrees')) {
            return baseName.slice(0, -'-worktrees'.length);
        }
    }

    return path.basename(process.cwd());
}

/**
 * Build a tmux session name following the naming convention:
 *   {repo}-{typeChar}{num}-{role}-{agent}(-{desc})
 * The 'auto' role omits the agent suffix.
 * Falls back to shorter forms when repo/desc are unavailable.
 * @param {string} entityId - Feature or research ID
 * @param {string} [agentId]
 * @param {object} [options]
 * @param {string} [options.repo] - repository name (defaults to cwd basename)
 * @param {string} [options.desc] - entity description (kebab-case)
 * @param {string} [options.entityType] - 'f' for feature (default), 'r' for research
 * @param {string} [options.role] - 'do' (default), 'eval', 'review', or 'auto'
 */
function buildTmuxSessionName(entityId, agentId, options) {
    const repo = resolveTmuxRepoName(options);
    const num = toUnpaddedId(entityId);
    const typeChar = (options && options.entityType) || 'f';
    const role = (options && options.role) || 'do';
    const desc = options && options.desc;
    const noAgent = role === 'auto';
    const agent = noAgent ? null : (agentId || 'solo');
    const middle = noAgent ? role : `${role}-${agent}`;
    return desc
        ? `${repo}-${typeChar}${num}-${middle}-${desc}`
        : `${repo}-${typeChar}${num}-${middle}`;
}

/**
 * Build a tmux session name for research sessions.
 * Thin wrapper around buildTmuxSessionName with entityType='r'.
 * @deprecated Use buildTmuxSessionName with options.entityType='r' instead.
 */
function buildResearchTmuxSessionName(researchId, agentId, options) {
    return buildTmuxSessionName(researchId, agentId, Object.assign({}, options, { entityType: 'r' }));
}

/**
 * Parse a tmux session name to extract entity type, id, role, and agent.
 * Returns { repoPrefix, type: 'f'|'r'|'S', id: string, role: string, agent: string|null } or null.
 * 'S' = set autonomous conductor: {repo}-s{setSlug}-auto
 * Handles new-style ({repo}-f{id}-{role}-{agent}(-desc)),
 * legacy feature eval ({repo}-f{id}-eval(-desc)),
 * and legacy ({repo}-f{id}-{agent}(-desc)) names.
 */
function parseTmuxSessionName(name) {
    // 0. Set autonomous orchestrator: {repo}-s{setSlug}-auto
    const setAutoMatch = name.match(/^(.+)-s([a-z0-9][a-z0-9-]*)-auto$/);
    if (setAutoMatch) return { repoPrefix: setAutoMatch[1], type: 'S', id: setAutoMatch[2], role: 'auto', agent: null };
    // 1. Auto sessions (no agent): {repo}-{type}{id}-auto(-desc)
    const autoMatch = name.match(/^(.+)-(f|r)(\d+)-auto(?:-|$)/);
    if (autoMatch) return { repoPrefix: autoMatch[1], type: autoMatch[2], id: autoMatch[3], role: 'auto', agent: null };
    // 2. Role+agent sessions: {repo}-{type}{id}-{role}-{agent}(-desc)
    const roleMatch = name.match(/^(.+)-(f|r)(\d+)-(do|eval|review|revise|spec-review|spec-revise|spec-check|close)-([a-z]{2})(?:-|$)/);
    if (roleMatch) return { repoPrefix: roleMatch[1], type: roleMatch[2], id: roleMatch[3], role: roleMatch[4], agent: roleMatch[5] };
    // 3. Legacy feature eval sessions omitted the agent segment: {repo}-f{id}-eval(-desc)
    const legacyFeatureEvalMatch = name.match(/^(.+)-f(\d+)-eval(?:-|$)/);
    if (legacyFeatureEvalMatch) return { repoPrefix: legacyFeatureEvalMatch[1], type: 'f', id: legacyFeatureEvalMatch[2], role: 'eval', agent: null };
    // 4. Legacy fallback (no role prefix): {repo}-{type}{id}-{agent}(-desc) → role 'do'
    const legacyMatch = name.match(/^(.+)-(f|r)(\d+)-([a-z]{2})(?:-|$)/);
    if (!legacyMatch) return null;
    return { repoPrefix: legacyMatch[1], type: legacyMatch[2], id: legacyMatch[3], role: 'do', agent: legacyMatch[4] };
}

/**
 * Match a tmux session name against a feature or research ID.
 * Returns { type, id, role, agent } or null.
 */
function matchTmuxSessionByEntityId(sessionName, entityId) {
    const parsed = parseTmuxSessionName(sessionName);
    if (!parsed) return null;
    if (toUnpaddedId(parsed.id) !== toUnpaddedId(entityId)) return null;
    return { type: parsed.type, id: parsed.id, role: parsed.role, agent: parsed.agent };
}

module.exports = {
    VALID_TMUX_ROLES,
    toUnpaddedId,
    resolveTmuxRepoName,
    buildTmuxSessionName,
    buildResearchTmuxSessionName,
    parseTmuxSessionName,
    matchTmuxSessionByEntityId,
};
