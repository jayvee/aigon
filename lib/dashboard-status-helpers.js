'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const {
    assertTmuxAvailable,
    buildTmuxSessionName,
    buildResearchTmuxSessionName,
    matchTmuxSessionByEntityId,
    runTmux,
    tmuxSessionExists,
    shellQuote,
} = require('./worktree');

// ---------------------------------------------------------------------------
// Tmux session list cache — avoids spawning `tmux list-sessions` for every
// agent in every feature during a poll. A TTL of 3s is short enough that
// freshly-started or stopped sessions show up within one poll cycle (10s).
// ---------------------------------------------------------------------------
let _tmuxListCache = null;  // { sessions: string[], clients: Set<string>, at: number }
const TMUX_LIST_TTL_MS = 3000;

function _getCachedTmuxList() {
    const now = Date.now();
    if (_tmuxListCache && (now - _tmuxListCache.at) < TMUX_LIST_TTL_MS) {
        return _tmuxListCache;
    }
    try {
        assertTmuxAvailable();
        const listResult = runTmux(['list-sessions', '-F', '#S'], { encoding: 'utf8', stdio: 'pipe' });
        const sessions = (!listResult.error && listResult.status === 0)
            ? listResult.stdout.split('\n').map(s => s.trim()).filter(Boolean)
            : [];
        const clientsResult = runTmux(['list-clients', '-F', '#{session_name}'], { encoding: 'utf8', stdio: 'pipe' });
        const clients = new Set((!clientsResult.error && clientsResult.status === 0)
            ? clientsResult.stdout.split('\n').map(s => s.trim()).filter(Boolean)
            : []);
        _tmuxListCache = { sessions, clients, at: now };
    } catch (_) {
        _tmuxListCache = { sessions: [], clients: new Set(), at: now };
    }
    return _tmuxListCache;
}

function normalizeDashboardStatus(raw) {
    const status = String(raw || '').trim().toLowerCase();
    if (status === 'implementing' || status === 'waiting' || status === 'submitted' || status === 'error') {
        return status;
    }
    return 'implementing';
}

function parseFeatureSpecFileName(file) {
    const m = file.match(/^feature-(\d+)-(.+)\.md$/);
    if (m) return { id: m[1], name: m[2] };
    const m2 = file.match(/^feature-(.+)\.md$/);
    if (m2) return { id: null, name: m2[1] };
    return null;
}

function safeTmuxSessionExists(featureId, agentId, options) {
    if (!agentId || agentId === 'solo') return null;
    const isResearch = options && options.isResearch;
    const buildName = isResearch
        ? (id, agent) => buildResearchTmuxSessionName(id, agent, { role: 'do' })
        : (id, agent) => buildTmuxSessionName(id, agent, { role: 'do' });
    const defaultSessionName = buildName(featureId, agentId);
    try {
        const { sessions, clients } = _getCachedTmuxList();
        const candidates = sessions.filter(s => {
            const m = matchTmuxSessionByEntityId(s, featureId);
            return m && m.agent === agentId && m.role === 'do';
        });
        if (candidates.length > 0) {
            const attachedCandidates = candidates.filter(name => clients.has(name));
            const pool = attachedCandidates.length > 0 ? attachedCandidates : candidates;
            pool.sort((a, b) => b.length - a.length || a.localeCompare(b));
            return { sessionName: pool[0], running: true };
        }
        return { sessionName: defaultSessionName, running: false };
    } catch (_) {
        return { sessionName: defaultSessionName, running: false };
    }
}

function safeFeatureAutoSessionExists(featureId) {
    if (!featureId) return null;
    try {
        const { sessions } = _getCachedTmuxList();
        const candidates = sessions.filter(s => {
            const m = matchTmuxSessionByEntityId(s, featureId);
            return m && m.type === 'f' && m.role === 'auto';
        });
        if (candidates.length === 0) return null;
        candidates.sort((a, b) => b.length - a.length || a.localeCompare(b));
        return { sessionName: candidates[0], running: true };
    } catch (_) {
        return null;
    }
}

function listTmuxSessionNames() {
    return _getCachedTmuxList().sessions;
}

function findTmuxSessionsByPrefix(prefix, mapSession) {
    const mapper = typeof mapSession === 'function' ? mapSession : (session) => ({ session });
    return listTmuxSessionNames()
        .filter(session => session.startsWith(prefix))
        .map(session => mapper(session))
        .filter(Boolean);
}

function findFirstTmuxSessionByPrefix(prefix, mapSession) {
    const matches = findTmuxSessionsByPrefix(prefix, mapSession);
    return matches[0] || null;
}

/**
 * Resolve a feature worktree directory for an agent.
 * @param {string} worktreeBaseDir - Canonical base (typically ~/.aigon/worktrees/{repo})
 * @param {string} featureId
 * @param {string} agentId
 * @param {string} [repoRoot] - Absolute main repo path; enables correct ../{repo}-worktrees fallback
 */
function resolveFeatureWorktreePath(worktreeBaseDir, featureId, agentId, repoRoot) {
    if (!featureId || !agentId) return null;

    // Try the provided directory first (new location)
    const result = _scanWorktreeDir(worktreeBaseDir, featureId, agentId);
    if (result) return result;

    // Backward compat: if worktreeBaseDir is the new ~/.aigon/worktrees/{repo} path,
    // also check the legacy sibling pattern. Detect by checking if parent is 'worktrees'
    // under '.aigon'. If so, derive the legacy path from the repo name.
    const parentDir = path.basename(path.dirname(worktreeBaseDir));
    const grandparentDir = path.basename(path.dirname(path.dirname(worktreeBaseDir)));
    if (parentDir === 'worktrees' && grandparentDir === '.aigon') {
        const repoName = path.basename(worktreeBaseDir);
        const home = process.env.HOME || require('os').homedir();
        /** @type {string[]} */
        const legacyCandidates = [];
        if (repoRoot) {
            const absRepo = path.resolve(repoRoot);
            legacyCandidates.push(path.resolve(path.dirname(absRepo), `${path.basename(absRepo)}-worktrees`));
        }
        legacyCandidates.push(path.join(home, 'src', `${repoName}-worktrees`));
        for (const legacyBase of legacyCandidates) {
            const legacyResult = _scanWorktreeDir(legacyBase, featureId, agentId);
            if (legacyResult) return legacyResult;
        }
    }

    return null;
}

function _scanWorktreeDir(baseDir, featureId, agentId) {
    if (!fs.existsSync(baseDir)) return null;
    try {
        const entries = fs.readdirSync(baseDir);
        const hit = entries.find(name => {
            const m = name.match(/^feature-(\d+)-(\w+)-.+$/);
            return m && m[1] === String(featureId) && m[2] === String(agentId);
        });
        return hit ? path.join(baseDir, hit) : null;
    } catch (_) {
        return null;
    }
}

function detectDefaultBranch(repoPath) {
    const quoted = shellQuote(repoPath);
    try {
        const remoteHead = execSync(`git -C ${quoted} symbolic-ref --short refs/remotes/origin/HEAD`, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
        const parsed = remoteHead.replace(/^origin\//, '').trim();
        if (parsed) return parsed;
    } catch (_) { /* ignore */ }
    for (const candidate of ['main', 'master']) {
        try {
            execSync(`git -C ${quoted} show-ref --verify --quiet refs/heads/${candidate}`, {
                stdio: ['ignore', 'ignore', 'ignore']
            });
            return candidate;
        } catch (_) { /* ignore */ }
    }
    try {
        return execSync(`git -C ${quoted} branch --show-current`, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
    } catch (_) {
        return 'main';
    }
}

function worktreeHasImplementationCommits(worktreePath) {
    if (!worktreePath || !fs.existsSync(worktreePath)) return false;
    const quoted = shellQuote(worktreePath);
    let branch = '';
    try {
        branch = execSync(`git -C ${quoted} branch --show-current`, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
    } catch (_) {
        return false;
    }
    if (!branch) return false;
    const defaultBranch = detectDefaultBranch(worktreePath);
    if (branch === defaultBranch) return false;
    try {
        const ahead = parseInt(execSync(`git -C ${quoted} rev-list --count ${defaultBranch}..HEAD`, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim(), 10);
        if (Number.isFinite(ahead) && ahead > 0) return true;
    } catch (_) { /* ignore */ }
    try {
        const subject = execSync(`git -C ${quoted} log -1 --pretty=%s`, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim().toLowerCase();
        if (!subject) return false;
        return !subject.includes('worktree setup');
    } catch (_) {
        return false;
    }
}

function hasResearchFindingsProgress(researchLogsDir, id, agent) {
    if (!researchLogsDir || !id || !agent) return false;
    const findingsPath = path.join(researchLogsDir, `research-${id}-${agent}-findings.md`);
    if (!fs.existsSync(findingsPath)) return false;
    try {
        const content = fs.readFileSync(findingsPath, 'utf8');
        const findingsSection = content.match(/^##\s+Findings\s*\r?\n([\s\S]*?)(?=^##\s+|$)/im);
        const body = findingsSection ? findingsSection[1] : content;
        const nonTemplateLines = body.split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean)
            .filter(line => !line.startsWith('- [') && !line.startsWith('*TODO') && !/^TBD$/i.test(line));
        return nonTemplateLines.length >= 3;
    } catch (_) {
        return false;
    }
}

function parseStatusFlags(flags) {
    if (!flags || typeof flags !== 'object' || Array.isArray(flags)) return {};
    return { ...flags };
}

function maybeFlagEndedSession(repoPath, options = {}) {
    const {
        entityType = 'feature',
        id,
        agent,
        status,
        flags,
        tmuxRunning,
        worktreePath,
        researchLogsDir,
        hasStatusFile
    } = options;
    const nextFlags = parseStatusFlags(flags);
    const currentlyImplementing = status === 'implementing';
    const sessionEnded = !tmuxRunning;
    if (!currentlyImplementing || !sessionEnded || !id || !agent || agent === 'solo') {
        return { status, flags: nextFlags, hasStatusFile };
    }

    const hasEvidence = entityType === 'research'
        ? hasResearchFindingsProgress(researchLogsDir, id, agent)
        : worktreeHasImplementationCommits(worktreePath);
    if (!hasEvidence || nextFlags.sessionEnded) {
        return { status, flags: nextFlags, hasStatusFile };
    }

    const now = new Date().toISOString();
    const updatedFlags = { ...nextFlags, sessionEnded: true, sessionEndedAt: now };
    return { status: 'implementing', flags: updatedFlags, hasStatusFile };
}

module.exports = {
    normalizeDashboardStatus,
    parseFeatureSpecFileName,
    listTmuxSessionNames,
    findTmuxSessionsByPrefix,
    findFirstTmuxSessionByPrefix,
    safeTmuxSessionExists,
    safeFeatureAutoSessionExists,
    resolveFeatureWorktreePath,
    detectDefaultBranch,
    worktreeHasImplementationCommits,
    hasResearchFindingsProgress,
    parseStatusFlags,
    maybeFlagEndedSession,
};
