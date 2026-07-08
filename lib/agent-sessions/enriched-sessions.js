'use strict';

// Session/dashboard read-model: enriched tmux listing, sidecar index, orphan classification (F632).

const fs = require('fs');
const path = require('path');
const stateMachine = require('../state-queries');
const workflowSnapshotAdapter = require('../workflow-snapshot-adapter');
const { toUnpaddedId, parseTmuxSessionName } = require('./names');
const { assertTmuxAvailable, runTmux } = require('./hosts/tmux-exec');

// Mirror workflow-core stage folder names without importing workflow-core/paths (F554 boundary).
const STAGE_DIRS = Object.freeze({
    INBOX: '01-inbox',
    BACKLOG: '02-backlog',
    IN_PROGRESS: '03-in-progress',
    IN_EVALUATION: '04-in-evaluation',
    DONE: '05-done',
    PAUSED: '06-paused',
});

const TMUX_SESSION_ROW_SEPARATOR = '__AIGON_SEP__';
const _CONFIG = '../config';

function readConductorReposFromGlobalConfig() {
    return require(_CONFIG).readConductorReposFromGlobalConfig();
}

/**
 * Scan stage folders across all repos to find which stage an entity is in.
 */
function findEntityStage(repos, entityType, entityId) {
    const unpadded = toUnpaddedId(entityId);
    for (const repoPath of repos) {
        const absRepo = path.resolve(repoPath);
        if (entityType === 'f') {
            const featureRoot = path.join(absRepo, 'docs', 'specs', 'features');
            const stages = [
                { dir: STAGE_DIRS.INBOX, stage: 'inbox' },
                { dir: STAGE_DIRS.BACKLOG, stage: 'backlog' },
                { dir: STAGE_DIRS.IN_PROGRESS, stage: 'in-progress' },
                { dir: STAGE_DIRS.IN_EVALUATION, stage: 'in-evaluation' },
                { dir: STAGE_DIRS.DONE, stage: 'done' },
                { dir: STAGE_DIRS.PAUSED, stage: 'paused' },
            ];
            for (const { dir, stage } of stages) {
                const fullDir = path.join(featureRoot, dir);
                if (!fs.existsSync(fullDir)) continue;
                try {
                    const files = fs.readdirSync(fullDir);
                    const pattern = new RegExp('^feature-0*' + unpadded + '-.+\\.md$');
                    if (files.some(f => pattern.test(f))) {
                        return { stage, repo: absRepo };
                    }
                } catch (_) { /* ignore */ }
            }
        } else {
            const researchRoot = path.join(absRepo, 'docs', 'specs', 'research-topics');
            const stages = [
                { dir: STAGE_DIRS.INBOX, stage: 'inbox' },
                { dir: STAGE_DIRS.BACKLOG, stage: 'backlog' },
                { dir: STAGE_DIRS.IN_PROGRESS, stage: 'in-progress' },
                { dir: STAGE_DIRS.IN_EVALUATION, stage: 'in-evaluation' },
                { dir: STAGE_DIRS.DONE, stage: 'done' },
                { dir: STAGE_DIRS.PAUSED, stage: 'paused' },
            ];
            for (const { dir, stage } of stages) {
                const fullDir = path.join(researchRoot, dir);
                if (!fs.existsSync(fullDir)) continue;
                try {
                    const files = fs.readdirSync(fullDir);
                    const pattern = new RegExp('^research-0*' + unpadded + '-.+\\.md$');
                    if (files.some(f => pattern.test(f))) {
                        return { stage, repo: absRepo };
                    }
                } catch (_) { /* ignore */ }
            }
        }
    }
    return null;
}

function classifyOrphanReason(entityTypeChar, entityId, stageResult) {
    if (!entityTypeChar || entityId == null || String(entityId).trim() === '') return null;
    if (!stageResult) return { reason: 'spec-missing' };
    const entityType = entityTypeChar === 'f' ? 'feature' : 'research';
    if (entityType === 'feature' || entityType === 'research') {
        const wfType = entityType === 'feature' ? 'feature' : 'research';
        const wfId = toUnpaddedId(entityId);
        const snap = workflowSnapshotAdapter.readWorkflowSnapshotSync(stageResult.repo, wfType, wfId);
        if (snap && (snap.lifecycle === 'done' || snap.lifecycle === 'closing')) {
            return { reason: snap.lifecycle };
        }
        if (!snap && stageResult.stage === 'done') {
            return { reason: 'done' };
        }
        return null;
    }
    const availableActions = stateMachine.getAvailableActions(
        entityType,
        stageResult.stage,
        { agents: [], agentStatuses: {}, tmuxSessionStates: {} }
    );
    if (availableActions.length === 0) return { reason: stageResult.stage };
    return null;
}

function pruneStaleSessionSidecars(repos, liveSessionNames, liveTmuxIds) {
    for (const repo of repos) {
        const dir = path.join(path.resolve(repo), '.aigon', 'sessions');
        if (!fs.existsSync(dir)) continue;
        let entries;
        try {
            entries = fs.readdirSync(dir);
        } catch (_) {
            continue;
        }
        for (const f of entries) {
            if (!f.endsWith('.json')) continue;
            const stem = f.slice(0, -'.json'.length);
            let tmuxId = null;
            if (liveTmuxIds) {
                try {
                    const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
                    if (raw && typeof raw === 'object' && raw.tmuxId) {
                        tmuxId = String(raw.tmuxId);
                    }
                } catch (_) { /* unreadable → fall back to name */ }
            }
            const alive = tmuxId
                ? liveTmuxIds.has(tmuxId)
                : liveSessionNames.has(stem);
            if (alive) continue;
            try {
                fs.unlinkSync(path.join(dir, f));
            } catch (_) { /* non-fatal */ }
        }
    }
}

function loadSessionSidecarIndex(repos, liveSessionNames, liveTmuxIds) {
    const map = new Map();
    for (const repo of repos) {
        const dir = path.join(path.resolve(repo), '.aigon', 'sessions');
        if (!fs.existsSync(dir)) continue;
        let entries;
        try {
            entries = fs.readdirSync(dir);
        } catch (_) {
            continue;
        }
        for (const f of entries) {
            if (!f.endsWith('.json')) continue;
            const stem = f.slice(0, -'.json'.length);
            try {
                const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
                if (!raw || typeof raw !== 'object') continue;
                const tmuxId = raw.tmuxId ? String(raw.tmuxId) : null;
                const alive = tmuxId && liveTmuxIds
                    ? liveTmuxIds.has(tmuxId)
                    : liveSessionNames.has(stem);
                if (!alive) continue;
                const category = raw.category === 'repo' ? 'repo' : 'entity';
                if (category === 'entity') {
                    if (raw.entityType !== 'f' && raw.entityType !== 'r' && raw.entityType !== 'S') continue;
                    if (raw.entityId == null || String(raw.entityId).trim() === '') continue;
                }
                if (!raw.repoPath || !String(raw.repoPath).trim()) continue;
                const name = raw.sessionName != null ? String(raw.sessionName).trim() : stem;
                if (name !== stem && !(tmuxId && liveTmuxIds && liveTmuxIds.has(tmuxId))) continue;
                map.set(name, raw);
            } catch (_) { /* corrupt or race */ }
        }
    }
    return map;
}

function parseEnrichedTmuxSessionRow(line) {
    const text = String(line || '');
    if (text.includes(TMUX_SESSION_ROW_SEPARATOR)) {
        const parts = text.split(TMUX_SESSION_ROW_SEPARATOR);
        const [name, createdEpoch, attached, tmuxId, panePid] = parts;
        return { name, createdEpoch, attached, tmuxId, panePid };
    }
    if (text.includes('\t')) {
        const parts = text.split('\t');
        const [name, createdEpoch, attached, tmuxId, panePid] = parts;
        return { name, createdEpoch, attached, tmuxId, panePid };
    }
    const fallbackMatch = text.match(/^(.*)_(\d+)_(0|1)$/);
    if (fallbackMatch) {
        return { name: fallbackMatch[1], createdEpoch: fallbackMatch[2], attached: fallbackMatch[3] };
    }
    return { name: null, createdEpoch: null, attached: null };
}

function parseEnrichedTmuxSessionsOutput(output, repos) {
    const lines = String(output || '')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);

    const preliminary = lines.map(line => {
        const { name, createdEpoch, attached, tmuxId, panePid } = parseEnrichedTmuxSessionRow(line);
        const trimmedName = String(name || '').trim();
        const createdMs = Number.parseInt(createdEpoch, 10) * 1000;
        if (!trimmedName || !Number.isFinite(createdMs)) return null;
        const trimmedId = tmuxId != null ? String(tmuxId).trim() : '';
        const pid = Number.parseInt(panePid, 10);
        return {
            name: trimmedName,
            createdAt: new Date(createdMs).toISOString(),
            attached: String(attached || '').trim() === '1',
            tmuxId: trimmedId || null,
            shellPid: Number.isFinite(pid) ? pid : null,
        };
    }).filter(Boolean);

    const liveNames = new Set(preliminary.map(p => p.name));
    const liveTmuxIds = new Set(preliminary.map(p => p.tmuxId).filter(Boolean));
    pruneStaleSessionSidecars(repos, liveNames, liveTmuxIds);
    const sidecarBySession = loadSessionSidecarIndex(repos, liveNames, liveTmuxIds);

    return preliminary.map(row => {
        const trimmedName = row.name;
        const side = sidecarBySession.get(trimmedName);
        const category = side && side.category === 'repo' ? 'repo' : 'entity';
        let parsed = null;
        if (side && category === 'entity') {
            const rp = side.repoPath ? path.resolve(side.repoPath) : '';
            parsed = {
                repoPrefix: rp ? path.basename(rp) : '',
                type: side.entityType,
                id: String(side.entityId),
                role: side.role != null ? String(side.role) : 'do',
                agent: side.agent != null ? String(side.agent) : null,
            };
        } else if (!side) {
            parsed = parseTmuxSessionName(trimmedName);
        }
        const sortedRepos = parsed && parsed.repoPrefix
            ? [...repos].sort((a, b) => {
                const aMatch = path.basename(path.resolve(a)) === parsed.repoPrefix ? -1 : 0;
                const bMatch = path.basename(path.resolve(b)) === parsed.repoPrefix ? -1 : 0;
                return aMatch - bMatch;
            })
            : repos;
        const isFeatureOrResearch = parsed && (parsed.type === 'f' || parsed.type === 'r');
        const stageResult = isFeatureOrResearch ? findEntityStage(sortedRepos, parsed.type, parsed.id) : null;
        const orphan = isFeatureOrResearch ? classifyOrphanReason(parsed.type, parsed.id, stageResult) : null;
        let repoPathResult = stageResult ? stageResult.repo : (parsed && parsed.repoPrefix
            ? repos.find(r => path.basename(path.resolve(r)) === parsed.repoPrefix) || null
            : null);
        if (side && side.repoPath) {
            repoPathResult = path.resolve(side.repoPath);
        }

        const sidecarTmuxId = side && side.tmuxId ? String(side.tmuxId) : null;
        const sidecarShellPid = side && Number.isFinite(side.shellPid) ? side.shellPid : null;

        return {
            name: trimmedName,
            createdAt: row.createdAt,
            attached: row.attached,
            category,
            tmuxId: row.tmuxId || sidecarTmuxId,
            shellPid: row.shellPid != null ? row.shellPid : sidecarShellPid,
            entityType: parsed ? parsed.type : null,
            entityId: parsed ? parsed.id : null,
            role: parsed ? parsed.role : (side && side.role ? String(side.role) : null),
            agent: parsed ? parsed.agent : (side && side.agent ? String(side.agent) : null),
            repoPath: repoPathResult ? path.resolve(repoPathResult) : null,
            stage: stageResult ? stageResult.stage : null,
            orphan,
        };
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getEnrichedSessions() {
    assertTmuxAvailable();
    const SEP = TMUX_SESSION_ROW_SEPARATOR;
    const fmt = `#{session_name}${SEP}#{session_created}${SEP}#{session_attached}${SEP}#{session_id}${SEP}#{pane_pid}`;
    const result = runTmux(['list-sessions', '-F', fmt], { encoding: 'utf8', stdio: 'pipe' });
    if (result.error || result.status !== 0) {
        return { sessions: [], orphanCount: 0 };
    }
    const repos = readConductorReposFromGlobalConfig();
    const sessions = parseEnrichedTmuxSessionsOutput(result.stdout, repos);
    const orphanCount = sessions.filter(s => s.orphan).length;
    return { sessions, orphanCount };
}

module.exports = {
    TMUX_SESSION_ROW_SEPARATOR,
    findEntityStage,
    classifyOrphanReason,
    pruneStaleSessionSidecars,
    loadSessionSidecarIndex,
    parseEnrichedTmuxSessionRow,
    parseEnrichedTmuxSessionsOutput,
    getEnrichedSessions,
};
