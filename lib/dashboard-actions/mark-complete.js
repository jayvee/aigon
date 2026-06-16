'use strict';

const workflowEngine = require('../workflow-core/engine');
const agentStatusLib = require('../agent-status');

async function handleDashboardMarkComplete(request) {
    const entityType = request.entityType === 'research' ? 'research' : 'feature';
    const entityId = String(request.entityId || '').trim();
    const agentId = String(request.agentId || '').trim();
    const signal = String(request.signal || '').trim();
    const repoPath = String(request.repoPath || '').trim();
    const ALLOWED_SIGNALS = new Set([
        'implementation-complete', 'revision-complete', 'review-complete',
        'spec-review-complete', 'research-complete',
    ]);
    if (!ALLOWED_SIGNALS.has(signal)) {
        return { ok: false, status: 400, error: `Unknown signal '${signal}'. Allowed: ${[...ALLOWED_SIGNALS].join(', ')}` };
    }
    if (!entityId || !agentId) {
        return { ok: false, status: 400, error: 'Entity id and agentId are required' };
    }
    const source = 'dashboard/mark-complete';
    const prefix = entityType === 'research' ? 'research' : 'feature';
    agentStatusLib.writeAgentStatusAt(repoPath, entityId, agentId,
        { status: signal, taskType: null, flags: {} }, prefix);
    if (signal === 'implementation-complete') {
        await workflowEngine.emitSignal(repoPath, entityId, 'agent-ready', agentId, { entityType: 'feature', source });
    } else if (signal === 'research-complete') {
        await workflowEngine.emitSignal(repoPath, entityId, 'agent-ready', agentId, { entityType: 'research', source });
    } else if (signal === 'revision-complete') {
        await workflowEngine.recordCodeRevisionCompleted(repoPath, 'feature', entityId, { revisionAgentId: agentId, source });
        await workflowEngine.emitSignal(repoPath, entityId, 'agent-ready', agentId, { entityType: 'feature', source });
    } else if (signal === 'review-complete') {
        await workflowEngine.recordCodeReviewCompleted(repoPath, entityType, entityId, { reviewerId: agentId, requestRevision: true, source });
    } else if (signal === 'spec-review-complete') {
        await workflowEngine.recordSpecReviewCompleted(repoPath, entityType, entityId, {
            reviewerId: agentId,
            source,
        });
    }
    return { ok: true, status: 200, payload: { ok: true, signal, entityId, agentId } };
}

module.exports = {
    handleDashboardMarkComplete,
};
