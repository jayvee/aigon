'use strict';

function buildDisabledAction(action, disabledReason) {
    return {
        ...action,
        disabled: true,
        disabledReason: String(disabledReason || ''),
    };
}

function buildSetValidActions(setState, options = {}) {
    const status = String(setState && setState.status || 'idle');
    const isComplete = Boolean(setState && setState.isComplete);
    const inboxMemberCount = Number(setState && setState.inboxMemberCount) || 0;
    const requiresPro = Boolean(options.requiresPro);
    const allowActions = !requiresPro || Boolean(options.proAvailable);
    const proReason = options.proDisabledReason || 'Set conductor controls require Aigon Pro.';

    const actions = [];

    if (!isComplete && inboxMemberCount > 0) {
        const slug = setState && setState.slug ? String(setState.slug) : 'set';
        actions.push({
            action: 'set-prioritise',
            label: 'Prioritise inbox members',
            priority: 'high',
            category: 'lifecycle',
            metadata: {
                confirmationMessage: `Prioritise ${inboxMemberCount} inbox feature(s) in set "${slug}" in dependency order? Each gets the next available feature id.`,
            },
        });
    }

    if (!isComplete && status === 'idle') {
        actions.push({
            action: 'set-autonomous-start',
            label: 'Start set autonomously',
            priority: 'high',
            category: 'lifecycle',
            requiresInput: 'agentPicker',
        });
    }
    if (status === 'running') {
        actions.push({
            action: 'set-autonomous-stop',
            label: 'Stop',
            priority: 'high',
            category: 'lifecycle',
        });
    }
    if (status === 'paused-on-failure') {
        actions.push({
            action: 'set-autonomous-resume',
            label: 'Resume',
            priority: 'high',
            category: 'lifecycle',
        });
    }
    if (status !== 'idle' || isComplete || Boolean(setState && setState.autonomous)) {
        actions.push({
            action: 'set-autonomous-reset',
            label: 'Reset',
            priority: 'normal',
            category: 'lifecycle',
            metadata: {
                destructive: true,
                confirmationMessage: `Reset set "${setState && setState.slug ? setState.slug : 'set'}"? This clears the set conductor state file and any in-flight set session.`,
            },
        });
    }

    if (!allowActions) {
        const proGated = new Set(['set-autonomous-start', 'set-autonomous-stop', 'set-autonomous-resume', 'set-autonomous-reset']);
        return actions.map((action) => (
            proGated.has(action.action) ? buildDisabledAction(action, proReason) : action
        ));
    }
    return actions;
}

module.exports = {
    buildSetValidActions,
};
