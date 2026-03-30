'use strict';

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

const FEATURE_TRANSITIONS = [
    { type: 'transition', from: 'inbox', to: 'backlog', action: 'feature-prioritise', guard: () => true, label: 'Prioritise', uiTrigger: 'drag-drop, Prioritise button' },
    { type: 'transition', from: 'backlog', to: 'in-progress', action: 'feature-start', guard: () => true, label: 'Start', requiresInput: 'agentPicker', uiTrigger: 'Start button' },
    { type: 'transition', from: 'in-progress', to: 'in-evaluation', action: 'feature-eval', guard: (ctx) => isFleet(ctx) && allAgentsSubmitted(ctx), label: 'Evaluate', uiTrigger: 'Evaluate button' },
    { type: 'transition', from: 'in-evaluation', to: 'done', action: 'feature-close', guard: () => true, label: 'Accept & Close', uiTrigger: 'Close button' },
    { type: 'transition', from: 'inbox', to: 'paused', action: 'feature-pause', guard: () => true, label: 'Pause', uiTrigger: 'Drag to Paused' },
    { type: 'transition', from: 'backlog', to: 'paused', action: 'feature-pause', guard: () => true, label: 'Pause', uiTrigger: 'Drag to Paused' },
    { type: 'transition', from: 'in-progress', to: 'paused', action: 'feature-pause', guard: () => true, label: 'Pause', uiTrigger: 'Drag to Paused' },
    { type: 'transition', from: 'paused', to: 'backlog', action: 'feature-resume', guard: () => true, label: 'Resume', uiTrigger: 'Drag to Backlog' },
    { type: 'transition', from: 'paused', to: 'inbox', action: 'feature-resume', guard: () => true, label: 'Resume to Inbox', uiTrigger: 'Drag to Inbox' },
];

// ---------------------------------------------------------------------------
// Feature in-state actions
// ---------------------------------------------------------------------------

const FEATURE_ACTIONS = [
    { type: 'action', stage: 'in-progress', action: 'feature-open', guard: (ctx, agentId) => { const s = (ctx.agentStatuses || {})[agentId]; return s === 'idle' || s === 'error' || s === undefined; }, label: (ctx, agentId) => (ctx.agentStatuses || {})[agentId] === 'error' ? `Restart ${agentId}` : `Start ${agentId}`, perAgent: true, mode: 'terminal' },
    { type: 'action', stage: 'in-progress', action: 'feature-attach', guard: (ctx, agentId) => { const s = (ctx.agentStatuses || {})[agentId]; return (s === 'implementing' || s === 'submitted') && (ctx.tmuxSessionStates || {})[agentId] === 'running'; }, label: (ctx, agentId) => `View ${agentId}`, perAgent: true, mode: 'terminal' },
    { type: 'action', stage: 'in-progress', action: 'feature-open', guard: (ctx, agentId) => (ctx.agentStatuses || {})[agentId] === 'implementing' && (ctx.tmuxSessionStates || {})[agentId] !== 'running', label: (ctx, agentId) => `Start ${agentId}`, perAgent: true, mode: 'terminal' },
    { type: 'action', stage: 'in-progress', action: 'feature-open', guard: (ctx, agentId) => { const s = (ctx.agentStatuses || {})[agentId]; return s === 'idle' || s === 'error' || s === undefined; }, label: (ctx, agentId) => `Start ${agentId}`, perAgent: true, mode: 'terminal' },
    { type: 'action', stage: 'in-progress', action: 'feature-focus', guard: (ctx, agentId) => (ctx.agentStatuses || {})[agentId] === 'waiting', label: (ctx, agentId) => `Focus ${agentId}`, perAgent: true, mode: 'terminal', priority: 'high' },
    { type: 'action', stage: 'in-progress', action: 'feature-stop', guard: (ctx, agentId) => { const s = (ctx.agentStatuses || {})[agentId]; return s === 'implementing' || s === 'waiting'; }, label: (ctx, agentId) => `Stop ${agentId}`, perAgent: true, mode: 'fire-and-forget' },
    { type: 'action', stage: 'in-progress', action: 'feature-close', guard: (ctx) => !isFleet(ctx) && allAgentsSubmitted(ctx), label: () => 'Accept & Close', perAgent: false, mode: 'fire-and-forget', priority: 'high' },
    { type: 'action', stage: 'in-progress', action: 'feature-review', guard: (ctx) => !isFleet(ctx) && allAgentsSubmitted(ctx), label: () => 'Run Review', perAgent: false, mode: 'agent' },
    { type: 'action', stage: 'in-progress', action: 'feature-eval', guard: (ctx) => isFleet(ctx) && allAgentsSubmitted(ctx), label: () => 'Run Evaluation', perAgent: false, mode: 'agent', priority: 'high' },
    { type: 'action', stage: 'in-evaluation', action: 'feature-eval', guard: (ctx) => isFleet(ctx), label: () => 'Continue Evaluation', perAgent: false, mode: 'agent', priority: 'high' },
    { type: 'action', stage: 'in-evaluation', action: 'feature-review', guard: (ctx) => !isFleet(ctx), label: () => 'Run Review', perAgent: false, mode: 'agent' },
    { type: 'action', stage: 'backlog', action: 'feature-start', guard: () => true, label: () => 'Start feature', perAgent: false, mode: 'terminal', requiresInput: 'agentPicker' },
    { type: 'action', stage: 'backlog', action: 'feature-autopilot', guard: () => true, label: () => 'Run Autopilot', perAgent: false, mode: 'terminal', requiresInput: 'agentPicker' },
    { type: 'action', stage: 'in-progress', action: 'feature-autopilot', guard: (ctx) => { const states = ctx.tmuxSessionStates || {}; return !Object.values(states).some(s => s === 'running'); }, label: () => 'Run Autopilot', perAgent: false, mode: 'terminal', requiresInput: 'agentPicker' },
];

// ---------------------------------------------------------------------------
// Research transitions and actions
// ---------------------------------------------------------------------------

const RESEARCH_TRANSITIONS = [
    { type: 'transition', from: 'inbox', to: 'backlog', action: 'research-prioritise', guard: () => true, label: 'Prioritise' },
    { type: 'transition', from: 'backlog', to: 'in-progress', action: 'research-start', guard: () => true, label: 'Start', requiresInput: 'agentPicker' },
    { type: 'transition', from: 'in-progress', to: 'in-evaluation', action: 'research-eval', guard: (ctx) => allAgentsSubmitted(ctx), label: 'Evaluate', uiTrigger: 'Evaluate button' },
    { type: 'transition', from: 'in-evaluation', to: 'done', action: 'research-close', guard: () => true, label: 'Close' },
    { type: 'transition', from: 'in-progress', to: 'paused', action: 'research-pause', guard: () => true, label: 'Pause' },
    { type: 'transition', from: 'paused', to: 'in-progress', action: 'research-resume', guard: () => true, label: 'Resume' },
];

const RESEARCH_ACTIONS = [
    { type: 'action', stage: 'in-progress', action: 'research-open', guard: (ctx, agentId) => { const s = (ctx.agentStatuses || {})[agentId]; return s === 'idle' || s === 'error' || s === undefined; }, label: (ctx, agentId) => `Open ${agentId}`, perAgent: true, mode: 'terminal' },
    { type: 'action', stage: 'in-progress', action: 'research-attach', guard: (ctx, agentId) => { const s = (ctx.agentStatuses || {})[agentId]; return (s === 'implementing' || s === 'submitted') && (ctx.tmuxSessionStates || {})[agentId] === 'running'; }, label: (ctx, agentId) => `Attach ${agentId}`, perAgent: true, mode: 'terminal' },
    { type: 'action', stage: 'in-progress', action: 'research-open', guard: (ctx, agentId) => (ctx.agentStatuses || {})[agentId] === 'implementing' && (ctx.tmuxSessionStates || {})[agentId] !== 'running', label: (ctx, agentId) => `Start ${agentId}`, perAgent: true, mode: 'terminal' },
    { type: 'action', stage: 'in-progress', action: 'research-close', guard: (ctx) => !isFleet(ctx) && allAgentsSubmitted(ctx), label: () => 'Close', perAgent: false, mode: 'fire-and-forget', priority: 'high' },
    { type: 'action', stage: 'in-progress', action: 'research-eval', guard: (ctx) => isFleet(ctx) && allAgentsSubmitted(ctx), label: () => 'Run Evaluation', perAgent: false, mode: 'agent', priority: 'high' },
    { type: 'action', stage: 'in-evaluation', action: 'research-eval', guard: () => true, label: () => 'Synthesize Findings', perAgent: false, mode: 'agent', priority: 'high' },
];

// ---------------------------------------------------------------------------
// Feedback transitions and actions
// ---------------------------------------------------------------------------

const FEEDBACK_TRANSITIONS = [
    { type: 'transition', from: 'inbox', to: 'triaged', action: 'feedback-triage', guard: () => true, label: 'Triage' },
    { type: 'transition', from: 'triaged', to: 'actionable', action: 'feedback-promote', guard: () => true, label: 'Promote' },
    { type: 'transition', from: 'triaged', to: 'wont-fix', action: 'feedback-wont-fix', guard: () => true, label: "Won't Fix" },
    { type: 'transition', from: 'triaged', to: 'duplicate', action: 'feedback-duplicate', guard: () => true, label: 'Duplicate' },
    { type: 'transition', from: 'actionable', to: 'done', action: 'feedback-close', guard: () => true, label: 'Close' },
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
