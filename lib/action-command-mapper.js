'use strict';

function padEntityId(entityId) {
    return String(entityId || '').padStart(2, '0');
}

function formatDashboardActionCommand(action, entityId, options = {}) {
    const id = padEntityId(entityId);
    const agentId = options.agentId || null;
    const stage = options.stage || '';
    const agentSuffix = agentId ? ` ${agentId}` : '';

    switch (action) {
        case 'feature-open': return `aigon feature-open ${id}${agentSuffix}`;
        case 'feature-attach': return `aigon terminal-attach ${id}${agentSuffix}`;
        case 'feature-focus': return `aigon terminal-focus ${id}${agentSuffix}`;
        case 'feature-stop': return `aigon feature-stop ${id}${agentSuffix}`;
        case 'feature-eval': return `/afe ${id}`;
        case 'feature-review': return `aigon feature-review ${id}`;
        case 'feature-close': return `aigon feature-close ${id}${agentSuffix}`;
        case 'feature-start': return `aigon feature-start ${id}`;
        case 'feature-autopilot': return `aigon feature-autopilot ${id}`;
        case 'feature-pause': return `aigon feature-pause ${id}`;
        case 'feature-resume': return `aigon feature-resume ${id}`;
        case 'force-agent-ready': return `aigon force-agent-ready ${id}${agentSuffix}`;
        case 'drop-agent': return `aigon drop-agent ${id}${agentSuffix}`;
        case 'research-open':
            return agentId ? `aigon terminal-focus ${id}${agentSuffix} --research` : `aigon research-open ${id}`;
        case 'research-attach':
            return `aigon terminal-focus ${id}${agentSuffix} --research`;
        case 'research-eval': return stage === 'in-evaluation' ? `/are ${id}` : `aigon research-eval ${id}`;
        case 'research-close': return `aigon research-close ${id}${agentSuffix}`;
        case 'research-start': return `aigon research-start ${id}`;
        case 'research-pause': return `aigon research-pause ${id}`;
        case 'research-resume': return `aigon research-resume ${id}`;
        case 'feature-prioritise': return `aigon feature-prioritise ${entityId}`;
        case 'research-prioritise': return `aigon research-prioritise ${entityId}`;
        default: return `aigon ${action} ${id}${agentSuffix}`.trim();
    }
}

function formatBoardActionCommand(action, entityId, options = {}) {
    const id = padEntityId(entityId);
    const agentId = options.agentId || null;
    const isSolo = agentId === 'solo' || !agentId;

    switch (action) {
        case 'feature-prioritise': return `aigon feature-prioritise ${entityId}`;
        case 'research-prioritise': return `aigon research-prioritise ${entityId}`;
        case 'feature-start': return `aigon feature-start ${id}`;
        case 'research-start': return `aigon research-start ${id}`;
        case 'feature-open': return isSolo ? `aigon feature-do ${id}` : `aigon feature-open ${id} ${agentId}`;
        case 'research-open':
            return isSolo ? `aigon research-do ${id}` : `aigon terminal-focus ${id} ${agentId} --research`;
        case 'feature-attach':
        case 'feature-focus':
            return isSolo ? `aigon terminal-focus ${id}` : `aigon terminal-focus ${id} ${agentId}`;
        case 'research-attach': return `aigon terminal-focus ${id} ${agentId} --research`;
        case 'feature-eval': return `aigon feature-eval ${id}`;
        case 'research-eval': return `aigon research-eval ${id}`;
        case 'feature-close': return isSolo ? `aigon feature-close ${id}` : `aigon feature-close ${id} ${agentId}`;
        case 'research-close': return isSolo ? `aigon research-close ${id}` : `aigon research-close ${id} ${agentId}`;
        case 'research-pause': return `aigon research-pause ${id}`;
        case 'research-resume': return `aigon research-resume ${id}`;
        case 'feature-review': return `aigon feature-review ${id}`;
        case 'feature-autopilot': return `aigon feature-autopilot ${id}`;
        case 'feature-pause': return `aigon feature-pause ${id}`;
        case 'feature-resume': return `aigon feature-resume ${id}`;
        default: return null;
    }
}

module.exports = {
    padEntityId,
    formatDashboardActionCommand,
    formatBoardActionCommand,
};
