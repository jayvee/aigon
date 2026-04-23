'use strict';

const { ManualActionKind, ActionCategory } = require('./workflow-core/types');

const RESEARCH_ENGINE_STATES = Object.freeze({
    hydrating: [
        { event: 'hydrate', to: 'done', guard: 'isDone' },
        { event: 'hydrate', to: 'closing', guard: 'isClosing' },
        { event: 'hydrate', to: 'evaluating', guard: 'isEvaluating' },
        { event: 'hydrate', to: 'reviewing', guard: 'isReviewing' },
        { event: 'hydrate', to: 'paused', guard: 'isPaused' },
        { event: 'hydrate', to: 'implementing', guard: 'isImplementing' },
        { event: 'hydrate', to: 'backlog', guard: 'isBacklog' },
        { event: 'hydrate', to: 'backlog', guard: 'default' },
    ],
    backlog: [
        { event: 'research.start', to: 'implementing' },
    ],
    implementing: [
        { event: 'research.pause', to: 'paused' },
        { event: 'research.review', to: 'reviewing', guard: 'soloAllReady' },
        { event: 'research.eval', to: 'evaluating', guard: 'allAgentsReady' },
        { event: 'research.close', to: 'closing', guard: 'soloAllReady' },
        { event: 'restart-agent', to: 'implementing', guard: 'agentRecoverable', effect: 'markRestarted' },
        { event: 'force-agent-ready', to: 'implementing', guard: 'agentRecoverable', effect: 'markReady' },
        { event: 'drop-agent', to: 'implementing', guard: 'agentDroppable', effect: 'markDropped' },
        { event: 'needs-attention', to: 'implementing', guard: 'agentNeedsAttention', effect: 'markNeedsAttention' },
    ],
    paused: [
        { event: 'research.resume', to: 'implementing' },
    ],
    reviewing: [
        { event: 'research.review', to: 'reviewing', guard: 'soloAllReady' },
        { event: 'research.close', to: 'closing' },
        { event: 'research.pause', to: 'paused' },
    ],
    evaluating: [
        { event: 'research.eval', to: 'evaluating', guard: 'allAgentsReady' },
        { event: 'research.close', to: 'closing' },
        { event: 'restart-agent', to: 'evaluating', guard: 'agentRecoverable', effect: 'markRestarted' },
        { event: 'force-agent-ready', to: 'evaluating', guard: 'agentRecoverable', effect: 'markReady' },
        { event: 'drop-agent', to: 'evaluating', guard: 'agentDroppable', effect: 'markDropped' },
        { event: 'needs-attention', to: 'evaluating', guard: 'agentNeedsAttention', effect: 'markNeedsAttention' },
    ],
    closing: [
        { event: 'research.closed', to: 'done' },
    ],
    done: [],
});

const RESEARCH_ACTION_CANDIDATES = Object.freeze([
    {
        kind: ManualActionKind.RESEARCH_PRIORITISE,
        label: 'Prioritise',
        eventType: null,
        recommendedOrder: 1,
        bypassMachine: true,
        category: 'lifecycle',
        guard: ({ context }) => context.currentSpecState === 'inbox',
    },
    {
        kind: ManualActionKind.OPEN_SESSION,
        label: ({ agentId, context }) => {
            const agent = context && context.agents ? context.agents[agentId] : null;
            if (!agent) return `Open ${agentId}`;
            if (agent.status === 'needs_attention' || agent.status === 'failed' || agent.status === 'lost') return `Restart ${agentId}`;
            return `Open ${agentId}`;
        },
        eventType: null,
        recommendedOrder: 5,
        perAgent: true,
        bypassMachine: true,
        category: 'session',
        guard: ({ agent }) => agent.status === 'running' || agent.status === 'idle',
    },
    {
        kind: ManualActionKind.RESEARCH_STOP,
        label: ({ agentId }) => `Stop ${agentId}`,
        eventType: null,
        recommendedOrder: 15,
        perAgent: true,
        bypassMachine: true,
        category: 'agent-control',
        guard: ({ agent }) => agent.status === 'running' || agent.status === 'idle' || agent.status === 'waiting',
    },
    {
        kind: ManualActionKind.RESEARCH_START,
        label: 'Start research',
        eventType: 'research.start',
        recommendedOrder: 10,
    },
    {
        kind: ManualActionKind.PAUSE_RESEARCH,
        label: 'Pause',
        eventType: null,
        recommendedOrder: 40,
        bypassMachine: true,
        category: ActionCategory.LIFECYCLE,
        guard: ({ context }) => ['inbox', 'backlog'].includes(context.currentSpecState),
    },
    {
        kind: ManualActionKind.RESUME_RESEARCH,
        label: 'Resume research',
        eventType: null,
        recommendedOrder: 40,
        bypassMachine: true,
        category: ActionCategory.LIFECYCLE,
        guard: ({ context }) => {
            const agentCount = Object.keys(context.agents || {}).length;
            return context.currentSpecState === 'paused' && agentCount === 0;
        },
    },
    {
        kind: ManualActionKind.RESEARCH_SPEC_REVIEW,
        label: 'Review spec',
        eventType: null,
        recommendedOrder: 45,
        bypassMachine: true,
        requiresInput: 'agentPicker',
        category: ActionCategory.SPEC_REVIEW,
        guard: ({ context }) => ['inbox', 'backlog'].includes(context.currentSpecState),
    },
    {
        kind: ManualActionKind.RESEARCH_SPEC_REVIEW_CHECK,
        label: 'Check spec review',
        eventType: null,
        recommendedOrder: 46,
        bypassMachine: true,
        requiresInput: 'agentPicker',
        category: ActionCategory.SPEC_REVIEW,
        guard: ({ context }) => ['inbox', 'backlog'].includes(context.currentSpecState)
            && Boolean(context.specReview && context.specReview.pendingCount > 0),
    },
    {
        kind: ManualActionKind.RESEARCH_REVIEW,
        label: 'Review findings',
        eventType: 'research.review',
        recommendedOrder: 53,
        mode: 'agent',
        modeFilter: 'solo',
    },
    {
        kind: ManualActionKind.RESEARCH_EVAL,
        label: 'Start evaluation',
        eventType: 'research.eval',
        recommendedOrder: 50,
        mode: 'agent',
        modeFilter: 'fleet',
    },
    {
        kind: ManualActionKind.RESEARCH_CLOSE,
        label: 'Close research',
        eventType: 'research.close',
        recommendedOrder: 70,
    },
    {
        kind: ManualActionKind.RESEARCH_RESET,
        label: 'Reset research',
        eventType: null,
        recommendedOrder: 80,
        bypassMachine: true,
        category: ActionCategory.LIFECYCLE,
        guard: ({ context }) => ['implementing', 'reviewing', 'evaluating', 'paused', 'closing'].includes(context.currentSpecState),
        metadata: {
            confirmationMessage: 'Close running sessions, remove research findings and state artifacts, clear research workflow engine state, and move the spec back to Backlog. This cannot be undone.',
        },
    },
    {
        kind: ManualActionKind.RESEARCH_DELETE,
        label: 'Delete',
        eventType: null,
        recommendedOrder: 90,
        bypassMachine: true,
        category: ActionCategory.LIFECYCLE,
        guard: ({ context }) => {
            const agentCount = Object.keys(context.agents || {}).length;
            return ['inbox', 'backlog'].includes(context.currentSpecState)
                || (context.currentSpecState === 'paused' && agentCount === 0);
        },
        metadata: {
            destructive: true,
            confirmationMessage: 'Delete this research spec and its workflow state? This cannot be undone.',
        },
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
 * Infra action candidates for research entities.
 */
const RESEARCH_INFRA_CANDIDATES = Object.freeze([
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
    {
        kind: ManualActionKind.VIEW_FINDINGS,
        label: ({ agentId }) => `View ${agentId} findings`,
        eventType: null,
        recommendedOrder: 100,
        perAgent: true,
        bypassMachine: true,
        category: ActionCategory.VIEW,
        scope: 'per-agent',
        clientOnly: true,
        guard: ({ agent }) => Boolean(agent.findingsPath),
        metadata: { clientAction: 'openPeekPanel' },
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
        kind: ManualActionKind.RECONCILE_SPEC_DRIFT,
        label: 'Reconcile spec',
        eventType: null,
        recommendedOrder: 104,
        bypassMachine: true,
        category: ActionCategory.INFRA,
        scope: 'per-feature',
        guard: ({ context }) => Boolean(context.specDrift),
        metadata: { apiEndpoint: 'spec-reconcile' },
    },
]);

module.exports = {
    RESEARCH_ENGINE_STATES,
    RESEARCH_ACTION_CANDIDATES,
    RESEARCH_INFRA_CANDIDATES,
};
