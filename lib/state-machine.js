'use strict';

/**
 * Aigon Unified State Machine
 *
 * Single source of truth for all lifecycle logic:
 * - What stages exist for each entity type
 * - What transitions are valid from each stage
 * - What in-state actions are available
 * - What context modifies the action graph
 *
 * This module is pure — no I/O, no filesystem access, no tmux calls.
 * It receives context and returns decisions.
 */

// ---------------------------------------------------------------------------
// Stage definitions
// ---------------------------------------------------------------------------

const FEATURE_STAGES = ['inbox', 'backlog', 'in-progress', 'in-evaluation', 'done'];

const RESEARCH_STAGES = ['inbox', 'backlog', 'in-progress', 'paused', 'done'];

const FEEDBACK_STAGES = ['inbox', 'triaged', 'actionable', 'done', 'wont-fix', 'duplicate'];

const AGENT_STATUSES = ['idle', 'implementing', 'waiting', 'submitted', 'error'];

// ---------------------------------------------------------------------------
// Guard helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if all agents have submitted.
 * @param {StateContext} ctx
 */
function allAgentsSubmitted(ctx) {
    const statuses = Object.values(ctx.agentStatuses || {});
    if (statuses.length === 0) return false;
    return statuses.every(s => s === 'submitted');
}

/**
 * Returns true if this is a fleet context (more than one agent, none named 'solo').
 * @param {StateContext} ctx
 */
function isFleet(ctx) {
    const agents = (ctx.agents || []).filter(id => id !== 'solo');
    return agents.length > 1;
}

// ---------------------------------------------------------------------------
// Feature transitions (stage changes)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Transition
 * @property {'transition'} type
 * @property {string} from
 * @property {string} to
 * @property {string} action
 * @property {function(StateContext): boolean} guard
 * @property {string|function(StateContext): string} label
 * @property {string} [requiresInput]  - 'agentPicker' etc.
 * @property {string} [uiTrigger]
 */

const FEATURE_TRANSITIONS = [
    {
        type: 'transition',
        from: 'inbox',
        to: 'backlog',
        action: 'feature-prioritise',
        guard: () => true,
        label: 'Prioritise',
        uiTrigger: 'drag-drop, Prioritise button'
    },
    {
        type: 'transition',
        from: 'backlog',
        to: 'in-progress',
        action: 'feature-setup',
        guard: () => true,
        label: 'Setup',
        requiresInput: 'agentPicker',
        uiTrigger: 'Setup button'
    },
    {
        type: 'transition',
        from: 'in-progress',
        to: 'in-evaluation',
        action: 'feature-eval',
        guard: (ctx) => allAgentsSubmitted(ctx),
        label: 'Evaluate',
        uiTrigger: 'Evaluate button'
    },
    {
        type: 'transition',
        from: 'in-evaluation',
        to: 'done',
        action: 'feature-close',
        guard: () => true,
        label: 'Accept & Close',
        uiTrigger: 'Close button'
    }
];

// ---------------------------------------------------------------------------
// Feature in-state actions (operations within a stage)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Action
 * @property {'action'} type
 * @property {string} stage
 * @property {string} action
 * @property {function(StateContext, string|null): boolean} guard
 * @property {string|function(StateContext, string|null): string} label
 * @property {boolean} perAgent  - rendered once per agent that passes the guard
 * @property {string} mode       - 'terminal' | 'fire-and-forget' | 'agent'
 * @property {string} [priority] - 'high' surfaces as recommended next action
 */

const FEATURE_ACTIONS = [
    // idle or error agents: Open / Restart
    {
        type: 'action',
        stage: 'in-progress',
        action: 'feature-open',
        guard: (ctx, agentId) => {
            const status = (ctx.agentStatuses || {})[agentId];
            return status === 'idle' || status === 'error' || status === undefined;
        },
        label: (ctx, agentId) => {
            return (ctx.agentStatuses || {})[agentId] === 'error'
                ? `Restart ${agentId}`
                : `Open ${agentId}`;
        },
        perAgent: true,
        mode: 'terminal'
    },
    // implementing + session running: Attach
    {
        type: 'action',
        stage: 'in-progress',
        action: 'feature-attach',
        guard: (ctx, agentId) => {
            return (ctx.agentStatuses || {})[agentId] === 'implementing' &&
                (ctx.tmuxSessionStates || {})[agentId] === 'running';
        },
        label: (ctx, agentId) => `Attach ${agentId}`,
        perAgent: true,
        mode: 'terminal'
    },
    // implementing + no session (e.g. warp/vscode): Open
    {
        type: 'action',
        stage: 'in-progress',
        action: 'feature-open',
        guard: (ctx, agentId) => {
            return (ctx.agentStatuses || {})[agentId] === 'implementing' &&
                (ctx.tmuxSessionStates || {})[agentId] !== 'running';
        },
        label: (ctx, agentId) => `Open ${agentId}`,
        perAgent: true,
        mode: 'terminal'
    },
    // waiting agent: Focus
    {
        type: 'action',
        stage: 'in-progress',
        action: 'feature-focus',
        guard: (ctx, agentId) => (ctx.agentStatuses || {})[agentId] === 'waiting',
        label: (ctx, agentId) => `Focus ${agentId}`,
        perAgent: true,
        mode: 'terminal',
        priority: 'high'
    },
    // implementing or waiting: Stop
    {
        type: 'action',
        stage: 'in-progress',
        action: 'feature-stop',
        guard: (ctx, agentId) => {
            const s = (ctx.agentStatuses || {})[agentId];
            return s === 'implementing' || s === 'waiting';
        },
        label: (ctx, agentId) => `Stop ${agentId}`,
        perAgent: true,
        mode: 'fire-and-forget'
    },
    // solo submitted: Close without eval
    {
        type: 'action',
        stage: 'in-progress',
        action: 'feature-close',
        guard: (ctx) => !isFleet(ctx) && allAgentsSubmitted(ctx),
        label: () => 'Accept & Close',
        perAgent: false,
        mode: 'fire-and-forget',
        priority: 'high'
    },
    // solo submitted: Review
    {
        type: 'action',
        stage: 'in-progress',
        action: 'feature-review',
        guard: (ctx) => !isFleet(ctx) && allAgentsSubmitted(ctx),
        label: () => 'Run Review',
        perAgent: false,
        mode: 'agent'
    },
    // fleet all submitted: Evaluate
    {
        type: 'action',
        stage: 'in-progress',
        action: 'feature-eval',
        guard: (ctx) => isFleet(ctx) && allAgentsSubmitted(ctx),
        label: () => 'Run Evaluation',
        perAgent: false,
        mode: 'agent',
        priority: 'high'
    },
    // in-evaluation fleet: continue eval
    {
        type: 'action',
        stage: 'in-evaluation',
        action: 'feature-eval',
        guard: (ctx) => isFleet(ctx),
        label: () => 'Continue Evaluation',
        perAgent: false,
        mode: 'agent',
        priority: 'high'
    },
    // in-evaluation solo: review
    {
        type: 'action',
        stage: 'in-evaluation',
        action: 'feature-review',
        guard: (ctx) => !isFleet(ctx),
        label: () => 'Run Review',
        perAgent: false,
        mode: 'agent'
    },
    // backlog: setup solo
    {
        type: 'action',
        stage: 'backlog',
        action: 'feature-setup',
        guard: () => true,
        label: () => 'Start feature',
        perAgent: false,
        mode: 'terminal',
        requiresInput: 'agentPicker'
    }
];

// ---------------------------------------------------------------------------
// Research transitions and actions
// ---------------------------------------------------------------------------

const RESEARCH_TRANSITIONS = [
    {
        type: 'transition',
        from: 'inbox',
        to: 'backlog',
        action: 'research-prioritise',
        guard: () => true,
        label: 'Prioritise'
    },
    {
        type: 'transition',
        from: 'backlog',
        to: 'in-progress',
        action: 'research-setup',
        guard: () => true,
        label: 'Setup',
        requiresInput: 'agentPicker'
    },
    {
        type: 'transition',
        from: 'in-progress',
        to: 'done',
        action: 'research-close',
        guard: (ctx) => allAgentsSubmitted(ctx),
        label: 'Close'
    },
    {
        type: 'transition',
        from: 'in-progress',
        to: 'paused',
        action: 'research-pause',
        guard: () => true,
        label: 'Pause'
    },
    {
        type: 'transition',
        from: 'paused',
        to: 'in-progress',
        action: 'research-resume',
        guard: () => true,
        label: 'Resume'
    }
];

const RESEARCH_ACTIONS = [
    {
        type: 'action',
        stage: 'in-progress',
        action: 'research-open',
        guard: (ctx, agentId) => {
            const status = (ctx.agentStatuses || {})[agentId];
            return status === 'idle' || status === 'error' || status === undefined;
        },
        label: (ctx, agentId) => `Open ${agentId}`,
        perAgent: true,
        mode: 'terminal'
    },
    {
        type: 'action',
        stage: 'in-progress',
        action: 'research-attach',
        guard: (ctx, agentId) => {
            return (ctx.agentStatuses || {})[agentId] === 'implementing' &&
                (ctx.tmuxSessionStates || {})[agentId] === 'running';
        },
        label: (ctx, agentId) => `Attach ${agentId}`,
        perAgent: true,
        mode: 'terminal'
    },
    {
        type: 'action',
        stage: 'in-progress',
        action: 'research-synthesize',
        guard: (ctx) => allAgentsSubmitted(ctx),
        label: () => 'Synthesize',
        perAgent: false,
        mode: 'agent',
        priority: 'high'
    }
];

// ---------------------------------------------------------------------------
// Feedback transitions and actions
// ---------------------------------------------------------------------------

const FEEDBACK_TRANSITIONS = [
    {
        type: 'transition',
        from: 'inbox',
        to: 'triaged',
        action: 'feedback-triage',
        guard: () => true,
        label: 'Triage'
    },
    {
        type: 'transition',
        from: 'triaged',
        to: 'actionable',
        action: 'feedback-promote',
        guard: () => true,
        label: 'Promote'
    },
    {
        type: 'transition',
        from: 'triaged',
        to: 'wont-fix',
        action: 'feedback-wont-fix',
        guard: () => true,
        label: "Won't Fix"
    },
    {
        type: 'transition',
        from: 'triaged',
        to: 'duplicate',
        action: 'feedback-duplicate',
        guard: () => true,
        label: 'Duplicate'
    },
    {
        type: 'transition',
        from: 'actionable',
        to: 'done',
        action: 'feedback-close',
        guard: () => true,
        label: 'Close'
    }
];

const FEEDBACK_ACTIONS = [];

// ---------------------------------------------------------------------------
// Entity registry
// ---------------------------------------------------------------------------

const ENTITY_DEFINITIONS = {
    feature: {
        stages: FEATURE_STAGES,
        transitions: FEATURE_TRANSITIONS,
        actions: FEATURE_ACTIONS
    },
    research: {
        stages: RESEARCH_STAGES,
        transitions: RESEARCH_TRANSITIONS,
        actions: RESEARCH_ACTIONS
    },
    feedback: {
        stages: FEEDBACK_STAGES,
        transitions: FEEDBACK_TRANSITIONS,
        actions: FEEDBACK_ACTIONS
    }
};

// ---------------------------------------------------------------------------
// Query functions
// ---------------------------------------------------------------------------

/**
 * Returns valid stage transitions from the current state.
 *
 * @param {'feature'|'research'|'feedback'} entityType
 * @param {string} currentStage
 * @param {StateContext} context
 * @returns {Array<{type:'transition', action:string, to:string, label:string, requiresInput?:string}>}
 */
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

/**
 * Returns all available actions (transitions + in-state actions) for the current state.
 * Per-agent actions are expanded: one entry per agent that passes the guard.
 *
 * @param {'feature'|'research'|'feedback'} entityType
 * @param {string} currentStage
 * @param {StateContext} context
 * @returns {Array<object>}
 */
function getAvailableActions(entityType, currentStage, context) {
    const def = ENTITY_DEFINITIONS[entityType];
    if (!def) return [];

    const result = [];

    // Stage transitions first
    const transitions = getValidTransitions(entityType, currentStage, context);
    result.push(...transitions);

    // In-state actions for the current stage
    const agents = (context.agents || []).filter(id => id !== 'solo');
    const ctx = context;

    def.actions
        .filter(a => a.stage === currentStage)
        .forEach(a => {
            if (a.perAgent) {
                // Expand per-agent actions
                const agentsToCheck = agents.length > 0 ? agents : (
                    ctx.agentStatuses ? Object.keys(ctx.agentStatuses) : []
                );
                agentsToCheck.forEach(agentId => {
                    if (a.guard(ctx, agentId)) {
                        result.push({
                            type: 'action',
                            stage: currentStage,
                            action: a.action,
                            agentId,
                            label: typeof a.label === 'function' ? a.label(ctx, agentId) : a.label,
                            mode: a.mode,
                            ...(a.priority ? { priority: a.priority } : {}),
                            ...(a.requiresInput ? { requiresInput: a.requiresInput } : {})
                        });
                    }
                });
            } else {
                if (a.guard(ctx, null)) {
                    result.push({
                        type: 'action',
                        stage: currentStage,
                        action: a.action,
                        label: typeof a.label === 'function' ? a.label(ctx, null) : a.label,
                        mode: a.mode,
                        ...(a.priority ? { priority: a.priority } : {}),
                        ...(a.requiresInput ? { requiresInput: a.requiresInput } : {})
                    });
                }
            }
        });

    return result;
}

/**
 * Resolves what the "Open" action should do for a given agent.
 * Returns one of: create-and-start, attach, send-keys.
 *
 * | tmuxSessionState   | agentStatus                  | Result           |
 * |--------------------|------------------------------|------------------|
 * | none               | any                          | create-and-start |
 * | exited             | any                          | create-and-start |
 * | running            | implementing / waiting       | attach           |
 * | running            | submitted / error / other    | send-keys        |
 *
 * @param {string} agentId
 * @param {StateContext} context
 * @returns {{ action: 'create-and-start'|'attach'|'send-keys', needsAgentCommand?: boolean }}
 */
function getSessionAction(agentId, context) {
    const sessionState = (context.tmuxSessionStates || {})[agentId] || 'none';
    const agentStatus = (context.agentStatuses || {})[agentId] || 'idle';

    if (sessionState === 'none' || sessionState === 'exited') {
        return { action: 'create-and-start', needsAgentCommand: true };
    }

    // Session exists — is the agent process still alive?
    if (agentStatus === 'implementing' || agentStatus === 'waiting') {
        return { action: 'attach' };
    }

    // Session alive but agent finished (submitted/error) — restart agent in existing session
    return { action: 'send-keys', needsAgentCommand: true };
}

/**
 * Returns an ordered list of recommended actions for the current state.
 * High-priority actions (priority: 'high') come first.
 * Replaces inferDashboardNextCommand and inferDashboardNextActions.
 *
 * @param {'feature'|'research'|'feedback'} entityType
 * @param {string} currentStage
 * @param {StateContext} context
 * @returns {Array<object>}
 */
function getRecommendedActions(entityType, currentStage, context) {
    const all = getAvailableActions(entityType, currentStage, context);

    // Separate high-priority from normal
    const high = all.filter(a => a.priority === 'high');
    const normal = all.filter(a => a.priority !== 'high');

    return [...high, ...normal];
}

/**
 * Returns true if the given action is a valid transition or in-state action
 * for the current entity state. Used for CLI validation.
 *
 * @param {string} action
 * @param {'feature'|'research'|'feedback'} entityType
 * @param {string} currentStage
 * @param {StateContext} [context]
 * @returns {boolean}
 */
function isActionValid(action, entityType, currentStage, context) {
    const ctx = context || {};
    const available = getAvailableActions(entityType, currentStage, ctx);
    return available.some(a => a.action === action);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
    // Stage definitions
    FEATURE_STAGES,
    RESEARCH_STAGES,
    FEEDBACK_STAGES,
    AGENT_STATUSES,
    ENTITY_DEFINITIONS,

    // Transition and action definitions (for introspection/testing)
    FEATURE_TRANSITIONS,
    FEATURE_ACTIONS,
    RESEARCH_TRANSITIONS,
    RESEARCH_ACTIONS,
    FEEDBACK_TRANSITIONS,
    FEEDBACK_ACTIONS,

    // Query functions
    getValidTransitions,
    getAvailableActions,
    getSessionAction,
    getRecommendedActions,
    isActionValid,

    // Internal helpers exposed for testing
    allAgentsSubmitted,
    isFleet
};
