'use strict';

const path = require('path');
const { sendNudge } = require('../nudge');

async function handleDashboardNudge(request) {
    const entityType = request.entityType === 'research' ? 'research' : 'feature';
    const entityId = String(request.entityId || '').trim();
    const repoPath = String(request.repoPath || '').trim() || process.cwd();
    const message = String(request.message || '');
    const agentId = String(request.agentId || '').trim() || null;
    const role = String(request.role || 'do').trim() || 'do';
    if (!entityId || !message.trim()) {
        return { ok: false, status: 400, error: `${entityType}Id and message are required` };
    }
    try {
        const result = await sendNudge(path.resolve(repoPath), entityId, message, {
            agentId,
            role,
            entityType,
        });
        return {
            ok: true,
            status: 200,
            payload: {
                ok: true,
                message: `Nudge delivered to ${result.sessionName}`,
                sessionName: result.sessionName,
                agentId: result.agentId,
                role: result.role,
            },
        };
    } catch (error) {
        return {
            ok: false,
            status: 422,
            error: error.message,
            payload: { paneTail: error.paneTail || '' },
        };
    }
}

module.exports = {
    handleDashboardNudge,
};
