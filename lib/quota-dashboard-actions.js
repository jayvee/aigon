'use strict';

/**
 * F446: Inject per-agent Resume / Skip (drop) validActions when status is quota-paused.
 * Reads reset hints from agent row + quota.json (shared with quota awareness).
 */

const { formatDashboardActionCommand } = require('./action-command-mapper');
const quotaProbe = require('./quota-probe');

function modelKeyFromAgent(agentRow, snapshot, agentId) {
    const snapAgent = snapshot && snapshot.agents ? snapshot.agents[agentId] : null;
    const mo = agentRow && agentRow.modelOverride != null
        ? agentRow.modelOverride
        : (snapAgent && snapAgent.modelOverride != null ? snapAgent.modelOverride : null);
    if (mo && typeof mo === 'object' && mo.model) return String(mo.model);
    if (typeof mo === 'string') return mo;
    return '__default__';
}

function resetAtFromQuotaState(repoPath, agentId, modelKey) {
    const state = quotaProbe.readQuotaState(repoPath);
    const models = state.agents && state.agents[agentId] && state.agents[agentId].models;
    if (!models) return null;
    const prefer = models[modelKey] || models.__default__;
    if (prefer && prefer.resetAt) return prefer.resetAt;
    const keys = Object.keys(models);
    for (let i = 0; i < keys.length; i++) {
        const e = models[keys[i]];
        if (e && e.verdict === 'depleted' && e.resetAt) return e.resetAt;
    }
    return null;
}

function formatQuotaResetLabel(resetAtIso) {
    if (!resetAtIso) return '';
    try {
        const d = new Date(resetAtIso);
        if (Number.isNaN(d.getTime())) return '';
        return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    } catch (_) {
        return '';
    }
}

function appendQuotaPausedDashboardActions(repoPath, entityType, entityId, snapshot, dashboardAgents, validActions) {
    if (!repoPath || !Array.isArray(dashboardAgents)) {
        return Array.isArray(validActions) ? validActions : [];
    }
    const base = Array.isArray(validActions) ? validActions.slice() : [];
    const haveResume = new Set(base.filter(a => a.action === 'agent-resume').map(a => a.agentId));
    const haveDrop = new Set(base.filter(a => a.action === 'drop-agent').map(a => a.agentId));

    for (let i = 0; i < dashboardAgents.length; i++) {
        const agentRow = dashboardAgents[i];
        if (!agentRow || String(agentRow.status) !== 'quota-paused') continue;
        const agentId = agentRow.id;
        if (!agentId) continue;

        const modelKey = modelKeyFromAgent(agentRow, snapshot, agentId);
        let resetAt = agentRow.quotaPausedResetAt || null;
        if (!resetAt) resetAt = resetAtFromQuotaState(repoPath, agentId, modelKey);
        const quotaResetLabel = formatQuotaResetLabel(resetAt);

        if (!haveResume.has(agentId)) {
            base.push({
                command: formatDashboardActionCommand('agent-resume', entityId, { entityType, agentId }),
                label: 'Resume',
                reason: 'Resume this agent after the provider quota window resets',
                action: 'agent-resume',
                kind: 'agent-resume',
                agentId,
                mode: null,
                category: 'agent-control',
                type: 'action',
                to: null,
                priority: 'high',
                requiresInput: null,
                scope: null,
                metadata: {
                    quotaPaused: true,
                    quotaResetAt: resetAt || null,
                    quotaResetLabel: quotaResetLabel || '',
                },
                clientOnly: false,
            });
            haveResume.add(agentId);
        }

        if (!haveDrop.has(agentId)) {
            base.push({
                command: formatDashboardActionCommand('drop-agent', entityId, { entityType, agentId }),
                label: 'Skip',
                reason: 'Drop this agent after quota exhaustion (Fleet continues without them)',
                action: 'drop-agent',
                kind: 'drop-agent',
                agentId,
                mode: null,
                category: 'agent-control',
                type: 'action',
                to: null,
                priority: 'normal',
                requiresInput: null,
                scope: null,
                metadata: { quotaPaused: true },
                clientOnly: false,
            });
            haveDrop.add(agentId);
        }
    }

    return base;
}

module.exports = {
    appendQuotaPausedDashboardActions,
    formatQuotaResetLabel,
};
