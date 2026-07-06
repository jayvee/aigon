'use strict';

function buildDisabledAction(action, disabledReason) {
    return {
        ...action,
        disabled: true,
        disabledReason: String(disabledReason || ''),
    };
}

function hasPersistedAutonomousState(setState) {
    return Boolean(setState && setState.autonomous && setState.autonomous.status);
}

/** True when the set still has members the conductor has not finished. */
function hasRemainingSetWork(setState) {
    if (!setState || setState.isComplete) return false;
    const auto = setState && setState.autonomous;
    if (auto && Array.isArray(auto.members) && auto.members.length > 0) {
        const completed = new Set((Array.isArray(auto.completed) ? auto.completed : []).map(String));
        return auto.members.some((id) => !completed.has(String(id)));
    }
    return true;
}

function buildSetValidActions(setState, options = {}) {
    const status = String(setState && setState.status || 'idle');
    const isComplete = Boolean(setState && setState.isComplete);
    const remainingWork = hasRemainingSetWork(setState);
    const persistedAutonomous = hasPersistedAutonomousState(setState);
    const inboxMemberCount = Number(setState && setState.inboxMemberCount) || 0;
    const reviewableMemberCount = Number(setState && setState.reviewableMemberCount) || 0;
    const launchableSpecReviewMemberCount = Number(setState && setState.launchableSpecReviewMemberCount) || 0;
    const pendingSpecReviseMemberCount = Number(setState && setState.pendingSpecReviseMemberCount) || 0;
    const requiresPro = Boolean(options.requiresPro);
    const allowActions = !requiresPro || Boolean(options.proAvailable);
    const proReason = options.proDisabledReason || 'Set conductor controls require Aigon Pro.';

    const actions = [];

    if (!isComplete && reviewableMemberCount > 0 && launchableSpecReviewMemberCount > 0) {
        actions.push({
            action: 'feature-set-spec-review',
            label: 'Review Set Specs',
            priority: 'high',
            category: 'lifecycle',
            requiresInput: 'agentPicker',
        });
    }

    if (!isComplete && pendingSpecReviseMemberCount > 0) {
        actions.push({
            action: 'feature-set-spec-revise',
            label: 'Revise Set Specs',
            priority: 'high',
            category: 'lifecycle',
            requiresInput: 'agentPicker',
        });
    }

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

    if (!isComplete && remainingWork && (status === 'idle' || status === 'stopped' || status === 'paused-on-quota')) {
        actions.push({
            action: 'set-autonomous-start',
            label: (status === 'stopped' || status === 'paused-on-quota') ? 'Resume (choose agents…)' : 'Start set autonomously',
            priority: 'high',
            category: 'lifecycle',
            requiresInput: 'agentPicker',
        });
        if (status === 'idle') {
            actions.push({
                action: 'set-autonomous-schedule',
                label: 'Schedule set',
                priority: 'normal',
                category: 'lifecycle',
                requiresInput: 'agentPicker',
                metadata: {
                    proOnly: true,
                },
            });
        }
    }
    if (status === 'running') {
        actions.push({
            action: 'set-autonomous-stop',
            label: 'Stop',
            priority: 'high',
            category: 'lifecycle',
        });
    }
    if (!isComplete && remainingWork && persistedAutonomous && (status === 'paused-on-failure' || status === 'paused-on-quota' || status === 'stopped')) {
        actions.push({
            action: 'set-autonomous-resume',
            label: 'Resume (same agents)',
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
        const proGated = new Set(['set-autonomous-start', 'set-autonomous-schedule', 'set-autonomous-stop', 'set-autonomous-resume', 'set-autonomous-reset']);
        return actions.map((action) => (
            proGated.has(action.action) ? buildDisabledAction(action, proReason) : action
        ));
    }
    if (!options.proAvailable) {
        return actions.map((action) => (
            action.action === 'set-autonomous-schedule'
                ? buildDisabledAction(action, options.scheduleDisabledReason || 'Scheduled set runs require Aigon Pro.')
                : action
        ));
    }
    return actions;
}

module.exports = {
    buildSetValidActions,
};
