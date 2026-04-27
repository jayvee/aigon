'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
    assertTmuxAvailable,
    buildTmuxSessionName,
    buildResearchTmuxSessionName,
    matchTmuxSessionByEntityId,
    runTmux,
    tmuxSessionExists,
} = require('./worktree');
const { readFeatureAutoState, readSetAutoState } = require('./auto-session-state');

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
    if (
        status === 'implementing'
        || status === 'reviewing'
        || status === 'revising'
        || status === 'spec-reviewing'
        || status === 'waiting'
        || status === 'submitted'
        || status === 'implementation-complete'
        || status === 'revision-complete'
        || status === 'review-complete'
        || status === 'spec-review-complete'
        || status === 'research-complete'
        || status === 'error'
        || status === 'addressing-review'
        || status === 'feedback-addressed'
    ) {
        return status;
    }
    return 'implementing';
}

function deriveFeatureDashboardStatus(rawStatus, options = {}) {
    // The agent status file is the source of truth for `revision-complete` —
    // workflow snapshots only know engine states (idle/running/...), so a
    // snapshot-derived status will never carry it. Prefer it when present so
    // the signal survives normalization.
    const fileStatus = String(options.fileStatus || '').trim().toLowerCase();
    if (fileStatus === 'revision-complete') return 'revision-complete';
    const normalizedStatus = normalizeDashboardStatus(rawStatus);
    if (normalizedStatus === 'revision-complete') return normalizedStatus;
    return normalizedStatus;
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

function safeFeatureAutoSessionExists(featureId, repoPath) {
    if (!featureId) return null;
    try {
        const { sessions } = _getCachedTmuxList();
        const candidates = sessions.filter(s => {
            const m = matchTmuxSessionByEntityId(s, featureId);
            return m && m.type === 'f' && m.role === 'auto';
        });
        if (candidates.length > 0) {
            candidates.sort((a, b) => b.length - a.length || a.localeCompare(b));
            return { sessionName: candidates[0], running: true, status: 'running' };
        }
    } catch (_) {
        // Fall back to persisted state below.
    }
    if (!repoPath) return null;
    try {
        const persisted = readFeatureAutoState(repoPath, featureId);
        if (!persisted) return null;
        return {
            sessionName: null,
            running: false,
            status: persisted.status || 'stopped',
            updatedAt: persisted.updatedAt || null,
            startedAt: persisted.startedAt || null,
            endedAt: persisted.endedAt || null,
            reason: persisted.reason || null,
        };
    } catch (_) {
        return null;
    }
}

function safeSetAutoSessionExists(setSlug, repoPath) {
    if (!setSlug) return null;
    const repoPrefix = repoPath ? `${path.basename(repoPath)}-` : '';
    const expected = `${repoPrefix}s${setSlug}-auto`;
    try {
        const { sessions } = _getCachedTmuxList();
        const candidates = sessions.filter(s => s === expected);
        if (candidates.length > 0) {
            candidates.sort((a, b) => b.length - a.length || a.localeCompare(b));
            const persisted = repoPath ? readSetAutoState(repoPath, setSlug) : null;
            return {
                sessionName: candidates[0],
                running: true,
                status: 'running',
                currentFeature: persisted && persisted.currentFeature ? String(persisted.currentFeature) : null,
            };
        }
    } catch (_) {
        // Fall back to persisted state below.
    }
    if (!repoPath) return null;
    try {
        const persisted = readSetAutoState(repoPath, setSlug);
        if (!persisted) return null;
        return {
            sessionName: persisted.sessionName || null,
            running: Boolean(persisted.running),
            status: persisted.status || 'stopped',
            currentFeature: persisted.currentFeature || null,
            failedFeature: persisted.failedFeature || null,
            completed: Array.isArray(persisted.completed) ? persisted.completed.slice() : [],
            failed: Array.isArray(persisted.failed) ? persisted.failed.slice() : [],
            updatedAt: persisted.updatedAt || null,
            startedAt: persisted.startedAt || null,
            endedAt: persisted.endedAt || null,
            reason: persisted.reason || null,
        };
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
 * Resolve a feature worktree directory for an agent under ~/.aigon/worktrees/{repo}.
 */
function resolveFeatureWorktreePath(worktreeBaseDir, featureId, agentId) {
    if (!featureId || !agentId) return null;
    return _scanWorktreeDir(worktreeBaseDir, featureId, agentId);
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
    try {
        const remoteHead = execFileSync('git', ['-C', repoPath, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
        const parsed = remoteHead.replace(/^origin\//, '').trim();
        if (parsed) return parsed;
    } catch (_) { /* ignore */ }
    for (const candidate of ['main', 'master']) {
        try {
            execFileSync('git', ['-C', repoPath, 'show-ref', '--verify', '--quiet', `refs/heads/${candidate}`], {
                stdio: ['ignore', 'ignore', 'ignore']
            });
            return candidate;
        } catch (_) { /* ignore */ }
    }
    try {
        return execFileSync('git', ['-C', repoPath, 'branch', '--show-current'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
    } catch (_) {
        return 'main';
    }
}

function computeRebaseNeeded(worktreePath, defaultBranch) {
    if (!worktreePath || !defaultBranch) return false;
    try {
        const count = parseInt(execFileSync('git', ['-C', worktreePath, 'rev-list', '--count', `HEAD..${defaultBranch}`], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim(), 10);
        return Number.isFinite(count) && count > 0;
    } catch (_) {
        return false;
    }
}

function worktreeHasImplementationCommits(worktreePath) {
    if (!worktreePath || !fs.existsSync(worktreePath)) return false;
    let branch = '';
    try {
        branch = execFileSync('git', ['-C', worktreePath, 'branch', '--show-current'], {
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
        const ahead = parseInt(execFileSync('git', ['-C', worktreePath, 'rev-list', '--count', `${defaultBranch}..HEAD`], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim(), 10);
        if (Number.isFinite(ahead) && ahead > 0) return true;
    } catch (_) { /* ignore */ }
    try {
        const subject = execFileSync('git', ['-C', worktreePath, 'log', '-1', '--pretty=%s'], {
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
    deriveFeatureDashboardStatus,
    parseFeatureSpecFileName,
    listTmuxSessionNames,
    findTmuxSessionsByPrefix,
    findFirstTmuxSessionByPrefix,
    safeTmuxSessionExists,
    safeFeatureAutoSessionExists,
    safeSetAutoSessionExists,
    resolveFeatureWorktreePath,
    detectDefaultBranch,
    computeRebaseNeeded,
    worktreeHasImplementationCommits,
    hasResearchFindingsProgress,
    parseStatusFlags,
    maybeFlagEndedSession,
};
