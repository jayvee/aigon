'use strict';

const { ManualActionKind } = require('./workflow-core/types');

const RESEARCH_ENGINE_STATES = Object.freeze({
    hydrating: [
        { event: 'hydrate', to: 'done', guard: 'isDone' },
        { event: 'hydrate', to: 'closing', guard: 'isClosing' },
        { event: 'hydrate', to: 'evaluating', guard: 'isEvaluating' },
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
        { event: 'research.eval', to: 'evaluating' },
        { event: 'research.close', to: 'closing' },
        { event: 'restart-agent', to: 'implementing', guard: 'agentRecoverable', effect: 'markRestarted' },
        { event: 'force-agent-ready', to: 'implementing', guard: 'agentRecoverable', effect: 'markReady' },
        { event: 'drop-agent', to: 'implementing', guard: 'agentDroppable', effect: 'markDropped' },
        { event: 'needs-attention', to: 'implementing', guard: 'agentNeedsAttention', effect: 'markNeedsAttention' },
    ],
    paused: [
        { event: 'research.resume', to: 'implementing' },
    ],
    evaluating: [
        { event: 'research.eval', to: 'evaluating' },
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
        kind: ManualActionKind.RESEARCH_START,
        label: 'Start research',
        eventType: 'research.start',
        recommendedOrder: 10,
    },
    {
        kind: ManualActionKind.RESEARCH_EVAL,
        label: 'Start evaluation',
        eventType: 'research.eval',
        recommendedOrder: 50,
    },
    {
        kind: ManualActionKind.RESEARCH_CLOSE,
        label: 'Close research',
        eventType: 'research.close',
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

module.exports = {
    RESEARCH_ENGINE_STATES,
    RESEARCH_ACTION_CANDIDATES,
};
