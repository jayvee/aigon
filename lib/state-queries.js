'use strict';

const {
    getFeatureStageTransitions,
    getFeatureStageActions,
} = require('./feature-workflow-rules');

/**
 * Aigon State Queries — read-only UI helpers for the dashboard.
 *
 * Extracted from the former state-machine.js during the workflow-engine
 * full cutover (Feature 171). Contains stage definitions, transition
 * definitions, action definitions, guards, and query functions.
 *
 * This module is pure — no I/O, no filesystem access, no tmux calls.
 * It receives context and returns decisions.
 *
 * Write-side logic (requestTransition, completePendingOp) has been
 * deleted — all state mutations now go through the workflow-core engine.
 */

// ---------------------------------------------------------------------------
// Stage definitions
// ---------------------------------------------------------------------------

const FEATURE_STAGES = ['inbox', 'backlog', 'in-progress', 'in-evaluation', 'done', 'paused'];

const RESEARCH_STAGES = ['inbox', 'backlog', 'in-progress', 'in-evaluation', 'done', 'paused'];

const FEEDBACK_STAGES = ['inbox', 'triaged', 'actionable', 'done', 'wont-fix', 'duplicate'];

const AGENT_STATUSES = ['idle', 'implementing', 'waiting', 'submitted', 'error'];

function createTransition(from, to, action, label, options = {}) {
    return {
        type: 'transition',
        from,
        to,
        action,
        guard: options.guard || (() => true),
        label,
        ...(options.requiresInput ? { requiresInput: options.requiresInput } : {}),
        ...(options.uiTrigger ? { uiTrigger: options.uiTrigger } : {}),
    };
}

function createAction(stage, action, options = {}) {
    return {
        type: 'action',
        stage,
        action,
        guard: options.guard || (() => true),
        label: options.label || (() => action),
        perAgent: options.perAgent === true,
        mode: options.mode || 'fire-and-forget',
        ...(options.priority ? { priority: options.priority } : {}),
        ...(options.requiresInput ? { requiresInput: options.requiresInput } : {}),
    };
}

// ---------------------------------------------------------------------------
// Guard helpers
// ---------------------------------------------------------------------------

function allAgentsSubmitted(ctx) {
    const statuses = Object.values(ctx.agentStatuses || {});
    if (statuses.length === 0) return false;
    return statuses.every(s => s === 'submitted');
}

function isFleet(ctx) {
    const agents = (ctx.agents || []).filter(id => id !== 'solo');
    return agents.length > 1;
}

// ---------------------------------------------------------------------------
// Feature transitions
// ---------------------------------------------------------------------------

function resolveFeatureRuleGuard(name) {
    const guards = {
        fleetAndAllAgentsSubmitted: (ctx) => isFleet(ctx) && allAgentsSubmitted(ctx),
        soloAndAllAgentsSubmitted: (ctx) => !isFleet(ctx) && allAgentsSubmitted(ctx),
        isFleet: (ctx) => isFleet(ctx),
        isSolo: (ctx) => !isFleet(ctx),
        noRunningTmuxSessions: (ctx) => {
            const states = ctx.tmuxSessionStates || {};
            return !Object.values(states).some(s => s === 'running');
        },
        agentIdleOrErrorOrMissing: (ctx, agentId) => {
            const status = (ctx.agentStatuses || {})[agentId];
            return status === 'idle' || status === 'error' || status === undefined;
        },
        agentImplementingOrSubmittedWithTmux: (ctx, agentId) => {
            const status = (ctx.agentStatuses || {})[agentId];
            return (status === 'implementing' || status === 'submitted') && (ctx.tmuxSessionStates || {})[agentId] === 'running';
        },
        agentImplementingWithoutTmux: (ctx, agentId) =>
            (ctx.agentStatuses || {})[agentId] === 'implementing' && (ctx.tmuxSessionStates || {})[agentId] !== 'running',
        agentWaiting: (ctx, agentId) => (ctx.agentStatuses || {})[agentId] === 'waiting',
        agentImplementingOrWaiting: (ctx, agentId) => {
            const status = (ctx.agentStatuses || {})[agentId];
            return status === 'implementing' || status === 'waiting';
        },
    };
    return guards[name] || (() => true);
}

function resolveFeatureLabel(actionDef) {
    if (actionDef.label) return () => actionDef.label;
    if (actionDef.labelType === 'agent-open') return (ctx, agentId) => (ctx.agentStatuses || {})[agentId] === 'error' ? `Restart ${agentId}` : `Start ${agentId}`;
    if (actionDef.labelType === 'agent-view') return (ctx, agentId) => `View ${agentId}`;
    if (actionDef.labelType === 'agent-start') return (ctx, agentId) => `Start ${agentId}`;
    if (actionDef.labelType === 'agent-focus') return (ctx, agentId) => `Focus ${agentId}`;
    if (actionDef.labelType === 'agent-stop') return (ctx, agentId) => `Stop ${agentId}`;
    return () => actionDef.action;
}

const FEATURE_TRANSITIONS = getFeatureStageTransitions().map((transition) => createTransition(
    transition.from,
    transition.to,
    transition.action,
    transition.label,
    {
        guard: resolveFeatureRuleGuard(transition.guardName),
        ...(transition.requiresInput ? { requiresInput: transition.requiresInput } : {}),
        ...(transition.uiTrigger ? { uiTrigger: transition.uiTrigger } : {}),
    }
));

// ---------------------------------------------------------------------------
// Feature in-state actions
// ---------------------------------------------------------------------------

const FEATURE_ACTIONS = getFeatureStageActions().map((actionDef) => createAction(actionDef.stage, actionDef.action, {
    guard: resolveFeatureRuleGuard(actionDef.guardName),
    label: resolveFeatureLabel(actionDef),
    perAgent: actionDef.perAgent === true,
    mode: actionDef.mode || 'fire-and-forget',
    ...(actionDef.priority ? { priority: actionDef.priority } : {}),
    ...(actionDef.requiresInput ? { requiresInput: actionDef.requiresInput } : {}),
}));

// ---------------------------------------------------------------------------
// Research transitions and actions
// ---------------------------------------------------------------------------

const RESEARCH_TRANSITIONS = [
    createTransition('inbox', 'backlog', 'research-prioritise', 'Prioritise'),
    createTransition('backlog', 'in-progress', 'research-start', 'Start', { requiresInput: 'agentPicker' }),
    createTransition('in-progress', 'in-evaluation', 'research-eval', 'Evaluate', {
        guard: (ctx) => allAgentsSubmitted(ctx),
        uiTrigger: 'Evaluate button'
    }),
    createTransition('in-evaluation', 'done', 'research-close', 'Close'),
    createTransition('in-progress', 'paused', 'research-pause', 'Pause'),
    createTransition('paused', 'in-progress', 'research-resume', 'Resume'),
];

const RESEARCH_ACTIONS = [
    createAction('in-progress', 'research-open', {
        guard: (ctx, agentId) => { const s = (ctx.agentStatuses || {})[agentId]; return s === 'idle' || s === 'error' || s === undefined; },
        label: (ctx, agentId) => `Open ${agentId}`,
        perAgent: true,
        mode: 'terminal'
    }),
    createAction('in-progress', 'research-attach', {
        guard: (ctx, agentId) => { const s = (ctx.agentStatuses || {})[agentId]; return (s === 'implementing' || s === 'submitted') && (ctx.tmuxSessionStates || {})[agentId] === 'running'; },
        label: (ctx, agentId) => `Attach ${agentId}`,
        perAgent: true,
        mode: 'terminal'
    }),
    createAction('in-progress', 'research-open', {
        guard: (ctx, agentId) => (ctx.agentStatuses || {})[agentId] === 'implementing' && (ctx.tmuxSessionStates || {})[agentId] !== 'running',
        label: (ctx, agentId) => `Start ${agentId}`,
        perAgent: true,
        mode: 'terminal'
    }),
    createAction('in-progress', 'research-close', {
        guard: (ctx) => !isFleet(ctx) && allAgentsSubmitted(ctx),
        label: () => 'Close',
        priority: 'high'
    }),
    createAction('in-progress', 'research-eval', {
        guard: (ctx) => isFleet(ctx) && allAgentsSubmitted(ctx),
        label: () => 'Run Evaluation',
        mode: 'agent',
        priority: 'high'
    }),
    createAction('in-evaluation', 'research-eval', {
        label: () => 'Synthesize Findings',
        mode: 'agent',
        priority: 'high'
    }),
];

// ---------------------------------------------------------------------------
// Feedback transitions and actions
// ---------------------------------------------------------------------------

const FEEDBACK_TRANSITIONS = [
    createTransition('inbox', 'triaged', 'feedback-triage', 'Triage'),
    createTransition('triaged', 'actionable', 'feedback-promote', 'Promote'),
    createTransition('triaged', 'wont-fix', 'feedback-wont-fix', "Won't Fix"),
    createTransition('triaged', 'duplicate', 'feedback-duplicate', 'Duplicate'),
    createTransition('actionable', 'done', 'feedback-close', 'Close'),
];

const FEEDBACK_ACTIONS = [];

// ---------------------------------------------------------------------------
// Entity registry
// ---------------------------------------------------------------------------

const ENTITY_DEFINITIONS = {
    feature: { stages: FEATURE_STAGES, transitions: FEATURE_TRANSITIONS, actions: FEATURE_ACTIONS },
    research: { stages: RESEARCH_STAGES, transitions: RESEARCH_TRANSITIONS, actions: RESEARCH_ACTIONS },
    feedback: { stages: FEEDBACK_STAGES, transitions: FEEDBACK_TRANSITIONS, actions: FEEDBACK_ACTIONS },
};

// ---------------------------------------------------------------------------
// Query functions
// ---------------------------------------------------------------------------

function getValidTransitions(entityType, currentStage, context) {
    const def = ENTITY_DEFINITIONS[entityType];
    if (!def) return [];
    return def.transitions
        .filter(t => t.from === currentStage && t.guard(context))
        .map(t => ({
            type: 'transition',
            action: t.action,
            from: t.from,
            to: t.to,
            label: typeof t.label === 'function' ? t.label(context) : t.label,
            ...(t.requiresInput ? { requiresInput: t.requiresInput } : {}),
            ...(t.uiTrigger ? { uiTrigger: t.uiTrigger } : {})
        }));
}

function getAvailableActions(entityType, currentStage, context) {
    const def = ENTITY_DEFINITIONS[entityType];
    if (!def) return [];
    const result = [];
    const transitions = getValidTransitions(entityType, currentStage, context);
    result.push(...transitions);
    const agents = (context.agents || []).filter(id => id !== 'solo');
    def.actions
        .filter(a => a.stage === currentStage)
        .forEach(a => {
            if (a.perAgent) {
                const agentsToCheck = agents.length > 0 ? agents : (
                    context.agentStatuses ? Object.keys(context.agentStatuses) : []
                );
                agentsToCheck.forEach(agentId => {
                    if (a.guard(context, agentId)) {
                        result.push({
                            type: 'action', stage: currentStage, action: a.action, agentId,
                            label: typeof a.label === 'function' ? a.label(context, agentId) : a.label,
                            mode: a.mode,
                            ...(a.priority ? { priority: a.priority } : {}),
                            ...(a.requiresInput ? { requiresInput: a.requiresInput } : {})
                        });
                    }
                });
            } else {
                if (a.guard(context, null)) {
                    result.push({
                        type: 'action', stage: currentStage, action: a.action,
                        label: typeof a.label === 'function' ? a.label(context, null) : a.label,
                        mode: a.mode,
                        ...(a.priority ? { priority: a.priority } : {}),
                        ...(a.requiresInput ? { requiresInput: a.requiresInput } : {})
                    });
                }
            }
        });
    return result;
}

function getSessionAction(agentId, context) {
    const sessionState = (context.tmuxSessionStates || {})[agentId] || 'none';
    const agentStatus = (context.agentStatuses || {})[agentId] || 'idle';
    if (sessionState === 'none' || sessionState === 'exited') {
        return { action: 'create-and-start', needsAgentCommand: true };
    }
    if (agentStatus === 'implementing' || agentStatus === 'waiting') {
        return { action: 'attach' };
    }
    return { action: 'send-keys', needsAgentCommand: true };
}

function shouldNotify(entityType, stage, context, notificationType) {
    if (notificationType === 'all-submitted') {
        if (entityType === 'feature') {
            return getValidTransitions(entityType, stage, context).some(t => t.action === 'feature-eval');
        }
        if (entityType === 'research') {
            return getValidTransitions(entityType, stage, context).some(t => t.action === 'research-eval');
        }
    }
    return false;
}

function getRecommendedActions(entityType, currentStage, context) {
    const all = getAvailableActions(entityType, currentStage, context);
    const high = all.filter(a => a.priority === 'high');
    const normal = all.filter(a => a.priority !== 'high');
    return [...high, ...normal];
}

function isActionValid(action, entityType, currentStage, context) {
    const ctx = context || {};
    const available = getAvailableActions(entityType, currentStage, ctx);
    return available.some(a => a.action === action);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
    FEATURE_STAGES,
    RESEARCH_STAGES,
    FEEDBACK_STAGES,
    AGENT_STATUSES,
    ENTITY_DEFINITIONS,
    FEATURE_TRANSITIONS,
    FEATURE_ACTIONS,
    RESEARCH_TRANSITIONS,
    RESEARCH_ACTIONS,
    FEEDBACK_TRANSITIONS,
    FEEDBACK_ACTIONS,
    getValidTransitions,
    getAvailableActions,
    getSessionAction,
    getRecommendedActions,
    isActionValid,
    shouldNotify,
    allAgentsSubmitted,
    isFleet,
};
