'use strict';

const { createAgentSessionService } = require('../agent-sessions');

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
    const service = createAgentSessionService({ repoPath, host: null });
    await service.recordSessionSignal({
        entityType,
        entityId,
        agentId,
        status: signal,
        source,
        payload: {
            requestRevision: signal === 'review-complete' ? true : undefined,
            taskType: signal === 'revision-complete' ? 'revise' : undefined,
        },
    });
    return { ok: true, status: 200, payload: { ok: true, signal, entityId, agentId } };
}

module.exports = {
    handleDashboardMarkComplete,
};
