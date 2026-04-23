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
    const requiresPro = Boolean(options.requiresPro);
    const allowActions = !requiresPro || Boolean(options.proAvailable);
    const proReason = options.proDisabledReason || 'Set conductor controls require Aigon Pro.';

    const actions = [];

    if (!isComplete && status === 'idle') {
        actions.push({
            action: 'set-autonomous-start',
            label: 'Start',
            priority: 'high',
            category: 'lifecycle',
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
        return actions.map((action) => buildDisabledAction(action, proReason));
    }
    return actions;
}

module.exports = {
    buildSetValidActions,
};
