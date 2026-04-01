'use strict';

const { ManualActionKind, ActionCategory } = require('./workflow-core/types');

const FEATURE_ENGINE_GUARDS = Object.freeze({
    allAgentsReady: 'Every agent status is ready.',
    soloAllReady: 'Single-agent non-fleet feature and that agent is ready.',
    hasWinner: 'winnerAgentId is set.',
    readyAgentSelected: 'Selected agent exists and is ready.',
    agentRecoverable: 'Agent is lost, failed, or needs_attention.',
    agentDroppable: 'More than one agent remains and target agent is lost, failed, or needs_attention.',
    agentNeedsAttention: 'Agent is lost or failed.',
    isImplementing: 'Projected lifecycle is implementing.',
    isPaused: 'Projected lifecycle is paused.',
    isEvaluating: 'Projected lifecycle is evaluating.',
    isReadyForReview: 'Projected lifecycle is ready_for_review.',
    isClosing: 'Projected lifecycle is closing.',
    isDone: 'Projected lifecycle is done.',
    default: 'Fallback target when no other hydration guard matches.',
});

const FEATURE_ENGINE_STATES = Object.freeze({
    hydrating: [
        { event: 'hydrate', to: 'done', guard: 'isDone' },
        { event: 'hydrate', to: 'ready_for_review', guard: 'isReadyForReview' },
        { event: 'hydrate', to: 'evaluating', guard: 'isEvaluating' },
        { event: 'hydrate', to: 'closing', guard: 'isClosing' },
        { event: 'hydrate', to: 'paused', guard: 'isPaused' },
        { event: 'hydrate', to: 'implementing', guard: 'isImplementing' },
        { event: 'hydrate', to: 'implementing', guard: 'default' },
    ],
    implementing: [
        { event: 'feature.pause', to: 'paused' },
        { event: 'feature.eval', to: 'evaluating', guard: 'allAgentsReady' },
        { event: 'feature.review', to: 'reviewing', guard: 'soloAllReady' },
        { event: 'feature.close', to: 'closing', guard: 'soloAllReady', effect: 'autoSelectWinner' },
        { event: 'restart-agent', to: 'implementing', guard: 'agentRecoverable', effect: 'markRestarted' },
        { event: 'force-agent-ready', to: 'implementing', guard: 'agentRecoverable', effect: 'markReady' },
        { event: 'drop-agent', to: 'implementing', guard: 'agentDroppable', effect: 'markDropped' },
        { event: 'needs-attention', to: 'implementing', guard: 'agentNeedsAttention', effect: 'markNeedsAttention' },
    ],
    paused: [
        { event: 'feature.resume', to: 'implementing' },
    ],
    reviewing: [
        { event: 'feature.review', to: 'reviewing', guard: 'soloAllReady' },
        { event: 'feature.close', to: 'closing', guard: 'soloAllReady', effect: 'autoSelectWinner' },
        { event: 'feature.pause', to: 'paused' },
    ],
    evaluating: [
        { event: 'select-winner', to: 'ready_for_review', guard: 'readyAgentSelected', effect: 'selectWinner' },
        { event: 'restart-agent', to: 'evaluating', guard: 'agentRecoverable', effect: 'markRestarted' },
        { event: 'force-agent-ready', to: 'evaluating', guard: 'agentRecoverable', effect: 'markReady' },
        { event: 'drop-agent', to: 'evaluating', guard: 'agentDroppable', effect: 'markDropped' },
        { event: 'needs-attention', to: 'evaluating', guard: 'agentNeedsAttention', effect: 'markNeedsAttention' },
    ],
    ready_for_review: [
        { event: 'feature.close', to: 'closing', guard: 'hasWinner', effect: 'requestCloseEffects' },
    ],
    closing: [
        { event: 'feature.closed', to: 'done' },
    ],
    done: [],
});

const FEATURE_ACTION_CANDIDATES = Object.freeze([
    {
        kind: ManualActionKind.FEATURE_PRIORITISE,
        label: 'Prioritise',
        eventType: null,
        recommendedOrder: 1,
        bypassMachine: true,
        category: 'lifecycle',
        guard: ({ context }) => context.currentSpecState === 'inbox',
    },
    {
        kind: ManualActionKind.FEATURE_START,
        label: 'Start',
        eventType: null,
        recommendedOrder: 1,
        bypassMachine: true,
        category: 'lifecycle',
        requiresInput: 'agentPicker',
        guard: ({ context }) => context.currentSpecState === 'backlog',
    },
    {
        kind: ManualActionKind.FEATURE_AUTOPILOT,
        label: 'Run Autopilot',
        eventType: null,
        recommendedOrder: 2,
        bypassMachine: true,
        category: 'lifecycle',
        requiresInput: 'agentPicker',
        guard: ({ context }) => {
            const agents = Object.values(context.agents || {});
            const hasActiveOrBroken = agents.some(a =>
                a.status === 'running' || a.status === 'idle' ||
                a.status === 'lost' || a.status === 'failed' || a.status === 'needs_attention');
            return (context.currentSpecState === 'backlog' || context.currentSpecState === 'implementing') &&
                !hasActiveOrBroken;
        },
    },
    {
        kind: ManualActionKind.OPEN_SESSION,
        label: ({ agentId, context }) => {
            const agent = context && context.agents ? context.agents[agentId] : null;
            if (!agent) return `Open ${agentId}`;
            if (agent.status === 'needs_attention' || agent.status === 'failed' || agent.status === 'lost') return `Restart ${agentId}`;
            return `Open ${agentId}`;
        },
        eventType: null, // Not a state transition — bypasses XState
        recommendedOrder: 5,
        perAgent: true,
        bypassMachine: true,
        category: 'session',
        guard: ({ agent }) => agent.status === 'running' || agent.status === 'idle',
    },
    {
        kind: ManualActionKind.FEATURE_STOP,
        label: ({ agentId }) => `Stop ${agentId}`,
        eventType: null,
        recommendedOrder: 15,
        perAgent: true,
        bypassMachine: true,
        category: 'agent-control',
        guard: ({ agent }) => agent.status === 'running' || agent.status === 'idle' || agent.status === 'waiting',
    },
    {
        kind: ManualActionKind.PAUSE_FEATURE,
        label: 'Pause',
        eventType: 'feature.pause',
        recommendedOrder: 40,
    },
    {
        kind: ManualActionKind.RESUME_FEATURE,
        label: 'Resume feature',
        eventType: 'feature.resume',
        recommendedOrder: 40,
    },
    {
        kind: ManualActionKind.FEATURE_EVAL,
        label: 'Evaluate',
        eventType: 'feature.eval',
        recommendedOrder: 50,
        modeFilter: 'fleet',
    },
    {
        kind: ManualActionKind.FEATURE_REVIEW,
        label: 'Review',
        eventType: 'feature.review',
        recommendedOrder: 55,
        modeFilter: 'solo',
    },
    {
        kind: ManualActionKind.SELECT_WINNER,
        label: ({ agentId }) => `Select winner ${agentId}`,
        eventType: 'select-winner',
        recommendedOrder: 60,
        perAgent: true,
    },
    {
        kind: ManualActionKind.FEATURE_CLOSE,
        label: 'Close',
        eventType: 'feature.close',
        recommendedOrder: 70,
    },
    {
        kind: ManualActionKind.RESTART_AGENT,
        label: ({ agentId }) => `Restart agent ${agentId}`,
        eventType: 'restart-agent',
        recommendedOrder: 10,
        perAgent: true,
    },
    {
        kind: ManualActionKind.FORCE_AGENT_READY,
        label: ({ agentId }) => `Force agent ${agentId} ready`,
        eventType: 'force-agent-ready',
        recommendedOrder: 20,
        perAgent: true,
    },
    {
        kind: ManualActionKind.DROP_AGENT,
        label: ({ agentId }) => `Drop agent ${agentId}`,
        eventType: 'drop-agent',
        recommendedOrder: 30,
        perAgent: true,
    },
]);

/**
 * Infra action candidates — bypass XState, evaluated with enriched context
 * that includes dashboard agent data (devServerPokeEligible, flags, etc.)
 * and feature-level data (evalPath, evalSession, reviewSessions).
 */
const FEATURE_INFRA_CANDIDATES = Object.freeze([
    {
        kind: ManualActionKind.DEV_SERVER_POKE,
        label: 'Start preview',
        eventType: null,
        recommendedOrder: 100,
        perAgent: true,
        bypassMachine: true,
        category: ActionCategory.INFRA,
        scope: 'per-agent',
        guard: ({ agent }) => Boolean(agent.devServerPokeEligible && !agent.devServerUrl),
        metadata: { apiEndpoint: 'dev-server/poke' },
    },
    {
        kind: ManualActionKind.MARK_SUBMITTED,
        label: 'Submit',
        eventType: null,
        recommendedOrder: 101,
        perAgent: true,
        bypassMachine: true,
        category: ActionCategory.INFRA,
        scope: 'per-agent',
        guard: ({ agent }) => Boolean(agent.flags && agent.flags.sessionEnded),
        metadata: { apiEndpoint: 'agent-flag-action', flagAction: 'mark-submitted' },
    },
    {
        kind: ManualActionKind.REOPEN_AGENT,
        label: 'Re-open',
        eventType: null,
        recommendedOrder: 102,
        perAgent: true,
        bypassMachine: true,
        category: ActionCategory.INFRA,
        scope: 'per-agent',
        guard: ({ agent }) => Boolean(agent.flags && agent.flags.sessionEnded),
        metadata: { apiEndpoint: 'agent-flag-action', flagAction: 'reopen-agent' },
    },
    {
        kind: ManualActionKind.VIEW_WORK,
        label: 'Open',
        eventType: null,
        recommendedOrder: 103,
        perAgent: true,
        bypassMachine: true,
        category: ActionCategory.INFRA,
        scope: 'per-agent',
        guard: ({ agent }) => Boolean(agent.flags && agent.flags.sessionEnded),
        metadata: { apiEndpoint: 'agent-flag-action', flagAction: 'view-work' },
    },
    {
        kind: ManualActionKind.VIEW_EVAL,
        label: 'View Eval',
        eventType: null,
        recommendedOrder: 110,
        bypassMachine: true,
        category: ActionCategory.VIEW,
        scope: 'per-feature',
        clientOnly: true,
        guard: ({ context }) => Boolean(context.evalPath),
        metadata: { clientAction: 'openDrawer' },
    },
    {
        kind: ManualActionKind.OPEN_EVAL_SESSION,
        label: 'Open Eval',
        eventType: null,
        recommendedOrder: 111,
        bypassMachine: true,
        category: ActionCategory.INFRA,
        scope: 'per-feature',
        guard: ({ context }) => Boolean(context.evalSession && context.evalSession.running),
    },
]);

const FEATURE_STAGE_TRANSITIONS = Object.freeze([
    { from: 'inbox', to: 'backlog', action: 'feature-prioritise', label: 'Prioritise', uiTrigger: 'drag-drop, Prioritise button' },
    { from: 'backlog', to: 'in-progress', action: 'feature-start', label: 'Start', requiresInput: 'agentPicker', uiTrigger: 'Start button' },
    { from: 'in-progress', to: 'in-evaluation', action: 'feature-eval', label: 'Evaluate', guardName: 'fleetAndAllAgentsSubmitted', uiTrigger: 'Evaluate button' },
    { from: 'in-evaluation', to: 'done', action: 'feature-close', label: 'Accept & Close', uiTrigger: 'Close button' },
    { from: 'inbox', to: 'paused', action: 'feature-pause', label: 'Pause', uiTrigger: 'Drag to Paused' },
    { from: 'backlog', to: 'paused', action: 'feature-pause', label: 'Pause', uiTrigger: 'Drag to Paused' },
    { from: 'in-progress', to: 'paused', action: 'feature-pause', label: 'Pause', uiTrigger: 'Drag to Paused' },
    { from: 'paused', to: 'backlog', action: 'feature-resume', label: 'Resume', uiTrigger: 'Drag to Backlog' },
    { from: 'paused', to: 'inbox', action: 'feature-resume', label: 'Resume to Inbox', uiTrigger: 'Drag to Inbox' },
]);

const FEATURE_STAGE_ACTIONS = Object.freeze([
    { stage: 'in-progress', action: 'feature-open', perAgent: true, mode: 'terminal', guardName: 'agentIdleOrErrorOrMissing', labelType: 'agent-open' },
    { stage: 'in-progress', action: 'feature-attach', perAgent: true, mode: 'terminal', guardName: 'agentImplementingOrSubmittedWithTmux', labelType: 'agent-view' },
    { stage: 'in-progress', action: 'feature-open', perAgent: true, mode: 'terminal', guardName: 'agentImplementingWithoutTmux', labelType: 'agent-start' },
    { stage: 'in-progress', action: 'feature-open', perAgent: true, mode: 'terminal', guardName: 'agentSubmittedWithoutTmux', label: 'Open' },
    { stage: 'in-progress', action: 'feature-focus', perAgent: true, mode: 'terminal', priority: 'high', guardName: 'agentWaiting', labelType: 'agent-focus' },
    { stage: 'in-progress', action: 'feature-stop', perAgent: true, mode: 'fire-and-forget', guardName: 'agentImplementingOrWaiting', labelType: 'agent-stop' },
    { stage: 'in-progress', action: 'feature-close', mode: 'fire-and-forget', priority: 'high', guardName: 'soloAndAllAgentsSubmitted', label: 'Accept & Close' },
    { stage: 'in-progress', action: 'feature-review', mode: 'agent', guardName: 'soloAndAllAgentsSubmitted', label: 'Run Review' },
    { stage: 'in-progress', action: 'feature-eval', mode: 'agent', priority: 'high', guardName: 'fleetAndAllAgentsSubmitted', label: 'Run Evaluation' },
    { stage: 'in-evaluation', action: 'feature-eval', mode: 'agent', priority: 'high', guardName: 'isFleet', label: 'Continue Evaluation' },
    { stage: 'in-evaluation', action: 'feature-review', mode: 'agent', guardName: 'isSolo', label: 'Run Review' },
    { stage: 'backlog', action: 'feature-start', mode: 'terminal', requiresInput: 'agentPicker', label: 'Start feature' },
    { stage: 'backlog', action: 'feature-autopilot', mode: 'terminal', requiresInput: 'agentPicker', label: 'Run Autopilot' },
]);

function getFeatureEngineStateRules() {
    return FEATURE_ENGINE_STATES;
}

function getFeatureActionCandidates() {
    return FEATURE_ACTION_CANDIDATES;
}

function getFeatureStageTransitions() {
    return FEATURE_STAGE_TRANSITIONS;
}

function getFeatureStageActions() {
    return FEATURE_STAGE_ACTIONS;
}

module.exports = {
    FEATURE_ENGINE_GUARDS,
    FEATURE_ENGINE_STATES,
    FEATURE_ACTION_CANDIDATES,
    FEATURE_INFRA_CANDIDATES,
    FEATURE_STAGE_TRANSITIONS,
    FEATURE_STAGE_ACTIONS,
    getFeatureEngineStateRules,
    getFeatureActionCandidates,
    getFeatureStageTransitions,
    getFeatureStageActions,
};
