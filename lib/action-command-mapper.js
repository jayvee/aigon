'use strict';

function padEntityId(entityId) {
    const raw = String(entityId || '');
    return /^\d+$/.test(raw) ? raw.padStart(2, '0') : raw;
}

/**
 * Single formatter for action commands — used by both dashboard and board.
 * Returns a CLI command string for the given action.
 */
function formatActionCommand(action, entityId, options = {}) {
    const id = padEntityId(entityId);
    const agentId = options.agentId || null;
    const stage = options.stage || '';
    const agentSuffix = agentId ? ` ${agentId}` : '';

    switch (action) {
        case 'open-session': return `aigon terminal-attach ${id}${agentSuffix}`;
        case 'feature-open': return `aigon feature-open ${id}${agentSuffix}`;
        case 'feature-attach': return `aigon terminal-attach ${id}${agentSuffix}`;
        case 'feature-focus': return `aigon terminal-focus ${id}${agentSuffix}`;
        case 'feature-stop': return `aigon feature-stop ${id}${agentSuffix}`;
        case 'feature-eval': return `/afe ${id}`;
        case 'feature-review': return `aigon feature-review ${id}`;
        case 'feature-review-check': return `aigon feature-review-check ${id}`;
        case 'feature-spec-review': return `aigon feature-spec-review ${entityId}`;
        case 'feature-spec-review-check': return `aigon feature-spec-review-check ${entityId}`;
        case 'feature-close': return `aigon feature-close ${id}${agentSuffix}`;
        case 'feature-start': return `aigon feature-start ${id}`;
        case 'feature-autonomous-start': return `aigon feature-autonomous-start ${id}`;
        case 'feature-pause': return `aigon feature-pause ${id}`;
        case 'feature-resume': return `aigon feature-resume ${id}`;
        case 'force-agent-ready': return `aigon force-agent-ready ${id}${agentSuffix}`;
        case 'drop-agent': return `aigon drop-agent ${id}${agentSuffix}`;
        case 'research-open':
            return agentId ? `aigon terminal-focus ${id}${agentSuffix} --research` : `aigon research-open ${id}`;
        case 'research-attach':
            return `aigon terminal-focus ${id}${agentSuffix} --research`;
        case 'research-eval': return stage === 'in-evaluation' ? `/are ${id}` : `aigon research-eval ${id}`;
        case 'research-spec-review': return `aigon research-spec-review ${entityId}`;
        case 'research-spec-review-check': return `aigon research-spec-review-check ${entityId}`;
        case 'research-close': return `aigon research-close ${id}${agentSuffix}`;
        case 'research-start': return `aigon research-start ${id}`;
        case 'research-stop': return `aigon research-stop ${id}${agentSuffix}`;
        case 'research-pause': return `aigon research-pause ${id}`;
        case 'research-resume': return `aigon research-resume ${id}`;
        case 'feature-prioritise': return `aigon feature-prioritise ${entityId}`;
        case 'research-prioritise': return `aigon research-prioritise ${entityId}`;
        default: return `aigon ${action} ${id}${agentSuffix}`.trim();
    }
}

// Backward-compatible aliases — callers will be updated incrementally
const formatDashboardActionCommand = formatActionCommand;
const formatBoardActionCommand = formatActionCommand;

module.exports = {
    padEntityId,
    formatActionCommand,
    formatDashboardActionCommand,
    formatBoardActionCommand,
};
