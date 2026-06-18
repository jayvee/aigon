'use strict';

const { formatDashboardActionCommand } = require('./action-command-mapper');
const { safeFeatureAutoSessionExists } = require('./dashboard-status-helpers');

function isFeatureAutonomousActive(repoPath, featureId, autoState) {
    if (autoState) {
        if (autoState.running === false && autoState.status === 'stopped') return false;
        if (autoState.running === true || autoState.status === 'running') return true;
    }
    const live = safeFeatureAutoSessionExists(featureId, repoPath);
    return Boolean(live && live.running === true);
}

function appendFeatureAutonomousDashboardActions(repoPath, featureId, autoState, validActions) {
    const base = Array.isArray(validActions) ? validActions.slice() : [];
    if (!isFeatureAutonomousActive(repoPath, featureId, autoState)) return base;
    if (base.some((action) => action.action === 'feature-autonomous-stop')) return base;
    base.push({
        command: formatDashboardActionCommand('feature-autonomous-stop', featureId),
        label: 'Stop automation',
        reason: 'Stop AutoConductor only; current sessions and workflow state are unchanged',
        action: 'feature-autonomous-stop',
        kind: 'feature-autonomous-stop',
        mode: 'fire-and-forget',
        category: 'lifecycle',
        type: 'action',
    });
    return base;
}

module.exports = {
    isFeatureAutonomousActive,
    appendFeatureAutonomousDashboardActions,
};
