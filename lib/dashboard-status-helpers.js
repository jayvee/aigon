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
    const buildName = isResearch ? buildResearchTmuxSessionName : buildTmuxSessionName;
    try {
        assertTmuxAvailable();
        const defaultSessionName = buildName(featureId, agentId);

        const listResult = runTmux(['list-sessions', '-F', '#S'], { encoding: 'utf8', stdio: 'pipe' });
        if (!listResult.error && listResult.status === 0) {
            const candidates = listResult.stdout
                .split('\n')
                .map(s => s.trim())
                .filter(Boolean)
                .filter(s => matchTmuxSessionByEntityId(s, featureId)?.agent === agentId);

            if (candidates.length > 0) {
                const clientsResult = runTmux(['list-clients', '-F', '#{session_name}'], { encoding: 'utf8', stdio: 'pipe' });
                const attachedSet = (!clientsResult.error && clientsResult.status === 0)
                    ? new Set(clientsResult.stdout.split('\n').map(s => s.trim()).filter(Boolean))
                    : new Set();

                const attachedCandidates = candidates.filter(name => attachedSet.has(name));
                const pool = attachedCandidates.length > 0 ? attachedCandidates : candidates;
                pool.sort((a, b) => b.length - a.length || a.localeCompare(b));
                return { sessionName: pool[0], running: true };
            }
        }

        return { sessionName: defaultSessionName, running: false };
    } catch (e) {
        return { sessionName: buildName(featureId, agentId), running: false };
    }
}

function listTmuxSessionNames() {
    try {
        assertTmuxAvailable();
        const listResult = runTmux(['list-sessions', '-F', '#S'], { encoding: 'utf8', stdio: 'pipe' });
        if (listResult.error || listResult.status !== 0) return [];
        return listResult.stdout.split('\n').map(s => s.trim()).filter(Boolean);
    } catch (_) {
        return [];
    }
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

function resolveFeatureWorktreePath(worktreeBaseDir, featureId, agentId) {
    if (!featureId || !agentId) return null;
    if (!fs.existsSync(worktreeBaseDir)) return null;
    try {
        const entries = fs.readdirSync(worktreeBaseDir);
        const hit = entries.find(name => {
            const m = name.match(/^feature-(\d+)-(\w+)-.+$/);
            return m && m[1] === String(featureId) && m[2] === String(agentId);
        });
        return hit ? path.join(worktreeBaseDir, hit) : null;
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
    resolveFeatureWorktreePath,
    detectDefaultBranch,
    worktreeHasImplementationCommits,
    hasResearchFindingsProgress,
    parseStatusFlags,
    maybeFlagEndedSession,
};
