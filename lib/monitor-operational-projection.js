'use strict';

/**
 * F681: server-owned operational projection for the live-operations Monitor.
 * Pure read model over uiContract rows — no workflow policy, no browser classification.
 */

/** Retention aligned with dashboard poll cadence and a single operator shift. */
const RECENTLY_COMPLETED_RETENTION_MS = 2 * 60 * 60 * 1000;

const ATTENTION_SEVERITIES = new Set(['error', 'warning']);
const ATTENTION_TONES = new Set(['warn', 'blocked', 'attention']);
const RUNNING_SEVERITIES = new Set(['active', 'running']);
const RUNNING_AGENT_STATUSES = new Set([
    'running', 'implementing', 'waiting', 'needs_attention', 'reviewing',
    'revision', 'idle', 'quota-paused', 'researching',
]);
const COMPLETE_AGENT_STATUSES = new Set([
    'ready', 'implementation-complete', 'revision-complete', 'research-complete',
    'review-complete', 'spec-review-complete',
]);
const PLANNING_LANES = new Set(['inbox', 'backlog']);

function entityKey(repoPath, entityType, entityId) {
    return `${repoPath}::${entityType}::${entityId}`;
}

function activityLine(contract) {
    const headline = contract.presentation && contract.presentation.headline;
    return (headline && (headline.verb || headline.label))
        || (contract.state && contract.state.label)
        || '';
}

function classifyOperationalGroup(contract, updatedAt, nowMs) {
    const state = contract.state || {};
    const presentation = contract.presentation || {};
    const tone = presentation.headline && presentation.headline.tone;
    const severity = state.severity || 'normal';
    const lane = state.lane || '';

    const decisions = (contract.decisions && contract.decisions.actions) || [];
    const hasRecovery = decisions.some(action => action.group === 'recovery' && !action.disabled);
    const hasBlockers = (contract.blockers || []).length > 0;
    const primaryId = contract.decisions && contract.decisions.primaryActionId;
    const agents = contract.agents || [];
    const sessions = contract.sessions || [];
    const hasRunningSession = sessions.some(session => session.running);
    const hasRunningAgent = agents.some(agent => RUNNING_AGENT_STATUSES.has(agent.status));
    const controller = contract.plan && contract.plan.controller;
    const controllerRunning = Boolean(controller && ['running', 'active'].includes(String(controller.status || 'running')));
    const agentNeedsHelp = agents.some(agent => agent.status === 'failed' || agent.status === 'needs_attention');

    const needsAttention = ATTENTION_SEVERITIES.has(severity)
        || ATTENTION_TONES.has(tone)
        || agentNeedsHelp
        || (hasRecovery && (ATTENTION_SEVERITIES.has(severity) || ATTENTION_TONES.has(tone) || agentNeedsHelp))
        || (hasBlockers && primaryId);

    if (needsAttention) return 'needsAttention';

    const updated = updatedAt ? Date.parse(updatedAt) : 0;
    const withinRetention = Number.isFinite(updated) && updated > 0
        && (nowMs - updated) <= RECENTLY_COMPLETED_RETENTION_MS;
    const isDoneLane = lane === 'done';
    const inspectableEndedSessions = sessions.filter(session => session.inspectable && !session.running);
    const workflowRecentlyComplete = agents.some(agent => COMPLETE_AGENT_STATUSES.has(agent.status))
        && !hasRunningSession
        && !hasRunningAgent
        && !controllerRunning;

    if ((isDoneLane && withinRetention)
        || (workflowRecentlyComplete && withinRetention && inspectableEndedSessions.length > 0)) {
        return 'recentlyCompleted';
    }

    const isRunning = !isDoneLane && (
        RUNNING_SEVERITIES.has(severity)
        || hasRunningSession
        || hasRunningAgent
        || controllerRunning
        || (!PLANNING_LANES.has(lane) && lane !== 'done')
    );

    if (isRunning) return 'running';
    return null;
}

function urgencyFor(group, contract) {
    let score = 0;
    const severity = contract.state && contract.state.severity;
    if (severity === 'error') score += 100;
    else if (severity === 'warning') score += 60;
    if (group === 'needsAttention') score += 40;
    else if (group === 'running') score += 10;
    return score;
}

function buildItem(entityType, row, repoPath, group, nowMs) {
    const contract = row.uiContract;
    if (!contract) return null;
    const entityId = entityType === 'feature-set' ? String(row.slug || contract.entity.id) : String(row.id);
    if (!entityId) return null;

    const updatedAt = row.updatedAt || row.createdAt || null;
    return {
        key: entityKey(repoPath, entityType, entityId),
        repoPath,
        entityType,
        entityId,
        group,
        urgency: urgencyFor(group, contract),
        identity: {
            displayKey: contract.entity.displayKey || entityId,
            name: contract.entity.title || contract.entity.name || entityId,
        },
        activityLine: activityLine(contract),
        contextLine: (contract.presentation && contract.presentation.contextLine) || null,
        updatedAt,
        contract,
    };
}

function collectRepoItems(repo, nowMs) {
    if (!repo || repo.contractCardsPreview !== true) return [];

    const items = [];
    const repoPath = repo.path;

    (repo.features || []).forEach((feature) => {
        if (!feature.uiContract) return;
        const group = classifyOperationalGroup(feature.uiContract, feature.updatedAt, nowMs);
        if (!group) return;
        const item = buildItem('feature', feature, repoPath, group, nowMs);
        if (item) items.push(item);
    });

    (repo.research || []).forEach((research) => {
        if (!research.uiContract) return;
        const group = classifyOperationalGroup(research.uiContract, research.updatedAt, nowMs);
        if (!group) return;
        const item = buildItem('research', research, repoPath, group, nowMs);
        if (item) items.push(item);
    });

    (repo.sets || []).forEach((setCard) => {
        if (!setCard.uiContract) return;
        const group = classifyOperationalGroup(setCard.uiContract, setCard.updatedAt, nowMs);
        if (!group) return;
        const item = buildItem('feature-set', setCard, repoPath, group, nowMs);
        if (item) items.push(item);
    });

    return items;
}

function sortItems(items) {
    return items.slice().sort((a, b) => {
        if (b.urgency !== a.urgency) return b.urgency - a.urgency;
        const aTs = a.updatedAt ? Date.parse(a.updatedAt) : 0;
        const bTs = b.updatedAt ? Date.parse(b.updatedAt) : 0;
        return bTs - aTs;
    });
}

function buildMonitorOperationalProjection(repos, options = {}) {
    const nowMs = options.nowMs || Date.now();
    const allItems = [];
    (repos || []).forEach(repo => {
        allItems.push(...collectRepoItems(repo, nowMs));
    });

    const groups = {
        needsAttention: sortItems(allItems.filter(item => item.group === 'needsAttention')),
        running: sortItems(allItems.filter(item => item.group === 'running')),
        recentlyCompleted: sortItems(allItems.filter(item => item.group === 'recentlyCompleted')),
    };

    const sessionIds = new Set();
    allItems.forEach((item) => {
        (item.contract.sessions || []).forEach((session) => {
            if (session.inspectable && session.sessionId) sessionIds.add(session.sessionId);
        });
    });

    return {
        retentionMinutes: RECENTLY_COMPLETED_RETENTION_MS / 60000,
        summary: {
            needsAttention: groups.needsAttention.length,
            running: groups.running.length,
            sessionsAvailable: sessionIds.size,
            recentlyCompleted: groups.recentlyCompleted.length,
        },
        groups,
    };
}

function monitorOperationalFingerprint(projection) {
    if (!projection) return '';
    const parts = [
        `na:${projection.summary.needsAttention}`,
        `run:${projection.summary.running}`,
        `ses:${projection.summary.sessionsAvailable}`,
        `rc:${projection.summary.recentlyCompleted}`,
    ];
    ['needsAttention', 'running', 'recentlyCompleted'].forEach((groupName) => {
        (projection.groups[groupName] || []).forEach((item) => {
            parts.push(`${item.key}:${item.urgency}:${item.activityLine}`);
        });
    });
    return parts.join(';');
}

module.exports = {
    RECENTLY_COMPLETED_RETENTION_MS,
    buildMonitorOperationalProjection,
    monitorOperationalFingerprint,
    classifyOperationalGroup,
};
