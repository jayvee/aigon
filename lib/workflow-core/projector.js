'use strict';

/**
 * Event-sourcing projector — rebuilds FeatureContext from an event stream.
 *
 * Ported from aigon-next/src/workflow/projector.ts.
 */

const { AgentStatus } = require('./types');
const { buildSpecReviewSummary } = require('../spec-review-state');

/**
 * Create an agents map from an array of agent IDs.
 * @param {string[]} agentIds
 * @returns {Record<string, { id: string, status: string, lastHeartbeatAt: string|null }>}
 */
function createAgents(agentIds, overrides) {
  const modelOverrides = (overrides && overrides.modelOverrides) || {};
  const effortOverrides = (overrides && overrides.effortOverrides) || {};
  return Object.fromEntries(
    agentIds.map((agentId) => [
      agentId,
      {
        id: agentId,
        status: AgentStatus.RUNNING,
        lastHeartbeatAt: null,
        restartCount: 0,
        currentAgentId: agentId,
        initialAgentId: agentId,
        previousAgentId: null,
        resumedFromAgentId: null,
        tokenExhausted: null,
        modelOverride: modelOverrides[agentId] != null ? modelOverrides[agentId] : null,
        effortOverride: effortOverrides[agentId] != null ? effortOverrides[agentId] : null,
      },
    ]),
  );
}

function createSpecReviewState() {
  return {
    pendingReviews: [],
    pendingCount: 0,
    pendingAgents: [],
    pendingLabel: '',
    activeReviewers: [],
    activeCheckers: [],
  };
}

function createNudgeState() {
  return [];
}

function appendRing(list, entry, limit = 20) {
  return [...(Array.isArray(list) ? list : []), entry].slice(-limit);
}

function refreshSpecReviewState(context) {
  const prev = context.specReview || {};
  const summary = buildSpecReviewSummary(prev.pendingReviews, {
    activeReviewers: prev.activeReviewers,
    activeCheckers: prev.activeCheckers,
  });
  context.specReview = summary;
}

function resolveCodeRevisionAgent(context) {
  const agents = context && context.agents ? Object.keys(context.agents) : [];
  if (context && context.mode === 'fleet') {
    return context.winnerAgentId || context.authorAgentId || agents[0] || null;
  }
  return agents[0] || context.authorAgentId || null;
}

/**
 * Replay an event stream to produce a FeatureContext.
 * Returns null if no `feature.started` event exists.
 *
 * @param {object[]} events
 * @returns {object|null} FeatureContext or null
 */
function projectContext(events) {
  let context = null;
  let lifecycle = 'backlog';

  for (const event of events) {
    const isResearch = event.type.startsWith('research.');
    const entityType = isResearch ? 'research' : 'feature';

    switch (event.type) {
      case 'feature.bootstrapped':
      case 'research.bootstrapped':
        // Bootstrapped from pre-engine state — initialise context from the event's lifecycle
        lifecycle = event.lifecycle || event.stage || 'backlog';
        context = {
          featureId: event.featureId || event.researchId,
          entityType,
          mode: event.mode || null,
          authorAgentId: event.authorAgentId != null ? event.authorAgentId : (context && context.authorAgentId) || null,
          agents: createAgents(event.agents || [], {
            modelOverrides: event.modelOverrides,
            effortOverrides: event.effortOverrides,
          }),
          winnerAgentId: null,
          effects: [],
          lastEffectError: null,
          specReview: createSpecReviewState(),
          nudges: createNudgeState(),
          agentFailover: event.agentFailover || null,
          pauseReason: event.pauseReason || null,
          reviewCycles: [],
          pendingCodeReviewer: null,
          pendingSpecReviewer: null,
          specPath: '',
          createdAt: event.at,
          updatedAt: event.at,
        };
        break;
      case 'feature.started':
      case 'research.started':
        lifecycle = 'implementing';
        context = {
          featureId: event.featureId || event.researchId,
          entityType,
          mode: event.mode,
          authorAgentId: event.authorAgentId != null ? event.authorAgentId : (context && context.authorAgentId) || null,
          agents: createAgents(event.agents, {
            modelOverrides: event.modelOverrides,
            effortOverrides: event.effortOverrides,
          }),
          winnerAgentId: null,
          effects: [],
          lastEffectError: null,
          specReview: createSpecReviewState(),
          nudges: createNudgeState(),
          agentFailover: event.agentFailover || null,
          pauseReason: null,
          reviewCycles: [],
          pendingCodeReviewer: null,
          pendingSpecReviewer: null,
          specPath: '',
          createdAt: event.at,
          updatedAt: event.at,
        };
        for (const agent of Object.values(context.agents)) {
          agent.lastHeartbeatAt = event.at;
        }
        break;
      case 'feature.paused':
      case 'research.paused':
        if (context !== null) {
          lifecycle = 'paused';
          context.pauseReason = event.reason || null;
          context.updatedAt = event.at;
        }
        break;
      case 'feature.resumed':
      case 'research.resumed':
        if (context !== null) {
          lifecycle = 'implementing';
          context.pauseReason = null;
          context.updatedAt = event.at;
        }
        break;
      case 'feature.review_requested':
      case 'research.review_requested':
        console.warn('[projector] legacy review_requested event — run `aigon doctor --fix` to migrate to *.code_review.started');
        if (context !== null) {
          lifecycle = 'code_review_in_progress';
          context.codeReview = {
            ...(context.codeReview || {}),
            activeReviewerId: event.reviewerId || event.agentId || null,
            reviewStartedAt: event.at,
            reviewCompletedAt: null,
            requestRevision: null,
          };
          context.updatedAt = event.at;
        }
        break;
      case 'feature.code_review.started':
      case 'research.code_review.started':
        if (context !== null) {
          lifecycle = 'code_review_in_progress';
          context.codeReview = {
            ...(context.codeReview || {}),
            activeReviewerId: event.reviewerId || event.agentId || null,
            reviewStartedAt: event.at,
            reviewCompletedAt: null,
            requestRevision: null,
          };
          context.pendingCodeReviewer = null;
          context.updatedAt = event.at;
        }
        break;
      case 'feature.code_review.completed':
      case 'research.code_review.completed':
        if (context !== null) {
          const requestRevision = event.requestRevision === false ? false : true;
          lifecycle = requestRevision ? 'code_revision_in_progress' : 'submitted';
          context.codeReview = {
            ...(context.codeReview || {}),
            activeReviewerId: null,
            reviewerId: event.reviewerId || event.agentId || (context.codeReview && context.codeReview.activeReviewerId) || null,
            reviewCompletedAt: event.at,
            requestRevision,
            revisionAgentId: requestRevision ? resolveCodeRevisionAgent(context) : null,
          };
          context.updatedAt = event.at;
        }
        break;
      case 'feature.code_revision.started':
      case 'research.code_revision.started':
        if (context !== null) {
          lifecycle = 'code_revision_in_progress';
          context.codeReview = {
            ...(context.codeReview || {}),
            revisionAgentId: event.revisionAgentId || resolveCodeRevisionAgent(context),
            revisionStartedAt: event.at,
            revisionCompletedAt: null,
          };
          context.updatedAt = event.at;
        }
        break;
      case 'feature.code_revision.completed':
      case 'research.code_revision.completed':
        if (context !== null) {
          const cr = context.codeReview || {};
          const revisionAgentId = event.revisionAgentId || cr.revisionAgentId || resolveCodeRevisionAgent(context);
          context.codeReview = {
            ...cr,
            revisionAgentId,
            revisionCompletedAt: event.at,
          };
          if (event.requestAnotherCycle === true && typeof event.nextReviewerId === 'string') {
            const cycles = Array.isArray(context.reviewCycles) ? context.reviewCycles : [];
            context.reviewCycles = [...cycles, {
              type: 'code',
              cycle: cycles.length + 1,
              reviewer: cr.reviewerId || cr.activeReviewerId || null,
              startedAt: cr.reviewStartedAt || null,
              completedAt: cr.reviewCompletedAt || null,
              counterStartedAt: cr.revisionStartedAt || null,
              counterCompletedAt: event.at,
            }];
            context.pendingCodeReviewer = event.nextReviewerId;
            lifecycle = 'code_review_in_progress';
          } else {
            lifecycle = 'submitted';
          }
          context.updatedAt = event.at;
        }
        break;
      case 'feature.eval_requested':
      case 'research.eval_requested':
        if (context !== null) {
          lifecycle = 'evaluating';
          context.updatedAt = event.at;
        }
        break;
      case 'winner.selected':
        if (context !== null) {
          lifecycle = 'ready_for_review';
          context.winnerAgentId = event.agentId;
          context.updatedAt = event.at;
        }
        break;
      case 'feature_close.failed':
        if (context !== null) {
          context.lastCloseFailure = {
            kind: event.kind || 'other',
            conflictFiles: Array.isArray(event.conflictFiles) ? event.conflictFiles : [],
            stderrTail: event.stderrTail || '',
            at: event.at,
          };
          context.updatedAt = event.at;
        }
        break;
      case 'feature.closed':
      case 'research.closed':
        if (context !== null) {
          lifecycle = 'done';
          context.lastCloseFailure = null;
          context.effects = context.effects.map((effect) => ({
            ...effect,
            status: 'succeeded',
            claimedAt: null,
            claimExpiredAt: null,
            lastError: null,
          }));
          context.lastEffectError = null;
          context.updatedAt = event.at;
        }
        break;
      case 'feature.close_requested':
      case 'research.close_requested':
        if (context !== null) {
          lifecycle = 'closing';
          context.lastEffectError = null;
          context.updatedAt = event.at;
        }
        break;
      case 'operator.nudge_sent':
        if (context !== null) {
          context.nudges = appendRing(context.nudges, {
            agentId: event.agentId,
            role: event.role || 'do',
            text: event.text || '',
            atISO: event.atISO || event.at,
          });
          context.updatedAt = event.atISO || event.at || context.updatedAt;
        }
        break;
      case 'effect.requested':
        if (context !== null) {
          context.effects = [
            ...context.effects.filter((e) => e.id !== event.effect.id),
            {
              ...event.effect,
              status: 'requested',
              claimedAt: null,
              claimExpiredAt: null,
              reclaimCount: 0,
              lastError: null,
            },
          ];
          context.lastEffectError = null;
          context.updatedAt = event.at;
        }
        break;
      case 'effect.claimed':
        if (context !== null) {
          context.effects = context.effects.map((e) =>
            e.id === event.effectId
              ? { ...e, status: 'claimed', claimedAt: event.at, claimExpiredAt: null, lastError: null }
              : e,
          );
          context.lastEffectError = null;
          context.updatedAt = event.at;
        }
        break;
      case 'effect.claim_expired':
        if (context !== null) {
          context.effects = context.effects.map((e) =>
            e.id === event.effectId
              ? { ...e, status: 'reclaimable', claimedAt: null, claimExpiredAt: event.at, lastError: null }
              : e,
          );
          context.lastEffectError = null;
          context.updatedAt = event.at;
        }
        break;
      case 'effect.reclaimed':
        if (context !== null) {
          context.effects = context.effects.map((e) =>
            e.id === event.effectId
              ? { ...e, status: 'claimed', claimedAt: event.at, claimExpiredAt: null, reclaimCount: e.reclaimCount + 1, lastError: null }
              : e,
          );
          context.lastEffectError = null;
          context.updatedAt = event.at;
        }
        break;
      case 'effect.succeeded':
        if (context !== null) {
          context.effects = context.effects.map((e) =>
            e.id === event.effectId
              ? { ...e, status: 'succeeded', claimedAt: null, claimExpiredAt: null, lastError: null }
              : e,
          );
          context.lastEffectError = null;
          context.updatedAt = event.at;
        }
        break;
      case 'effect.failed':
        if (context !== null) {
          context.effects = context.effects.map((e) =>
            e.id === event.effectId
              ? { ...e, status: 'failed', claimedAt: null, claimExpiredAt: null, lastError: event.error }
              : e,
          );
          context.lastEffectError = event.error;
          context.updatedAt = event.at;
        }
        break;
      case 'signal.agent_started':
        if (context !== null && context.agents[event.agentId] !== undefined) {
          if (context.agents[event.agentId].status !== 'ready') {
            context.agents[event.agentId].status = 'running';
          }
          context.agents[event.agentId].lastHeartbeatAt = event.at;
          context.updatedAt = event.at;
        }
        break;
      case 'agent.restarted':
        if (context !== null && context.agents[event.agentId] !== undefined) {
          if (context.agents[event.agentId].status !== 'ready') {
            context.agents[event.agentId].status = 'running';
          }
          context.agents[event.agentId].restartCount = (context.agents[event.agentId].restartCount || 0) + 1;
          context.agents[event.agentId].lastHeartbeatAt = event.at;
          context.updatedAt = event.at;
        }
        break;
      case 'agent.needs_attention':
        if (context !== null && context.agents[event.agentId] !== undefined) {
          context.agents[event.agentId].status = 'needs_attention';
          context.updatedAt = event.at;
        }
        break;
      case 'agent.token_exhausted':
        if (context !== null && context.agents[event.agentId] !== undefined) {
          context.agents[event.agentId].status = 'needs_attention';
          context.agents[event.agentId].tokenExhausted = {
            role: event.role || 'do',
            lastCommit: event.lastCommit || null,
            tokensConsumed: event.tokensConsumed != null ? Number(event.tokensConsumed) : null,
            limit: event.limit != null ? Number(event.limit) : null,
            source: event.source || null,
            currentAgentId: event.currentAgentId || context.agents[event.agentId].currentAgentId || event.agentId,
            at: event.at,
          };
          context.updatedAt = event.at;
        }
        break;
      case 'agent.failover_switched':
        if (context !== null && context.agents[event.agentId] !== undefined) {
          const priorCurrent = context.agents[event.agentId].currentAgentId || event.agentId;
          context.agents[event.agentId].status = 'running';
          context.agents[event.agentId].previousAgentId = priorCurrent;
          context.agents[event.agentId].resumedFromAgentId = event.previousAgentId || priorCurrent;
          context.agents[event.agentId].currentAgentId = event.replacementAgentId || priorCurrent;
          context.agents[event.agentId].tokenExhausted = null;
          context.updatedAt = event.at;
        }
        break;
      case 'signal.agent_waiting':
        if (context !== null && context.agents[event.agentId] !== undefined) {
          context.agents[event.agentId].status = 'waiting';
          context.agents[event.agentId].lastHeartbeatAt = event.at;
          context.updatedAt = event.at;
        }
        break;
      case 'signal.agent_ready':
      case 'agent.marked_ready':
      case 'agent.force_ready':
        if (context !== null && context.agents[event.agentId] !== undefined) {
          context.agents[event.agentId].status = 'ready';
          context.agents[event.agentId].lastHeartbeatAt = event.at;
          context.updatedAt = event.at;
        }
        break;
      case 'signal.agent_submitted':
        if (context !== null && context.agents[event.agentId] !== undefined) {
          context.agents[event.agentId].status = 'ready';
          context.agents[event.agentId].lastHeartbeatAt = event.at;
          context.updatedAt = event.at;
        }
        break;
      case 'signal.agent_failed':
        if (context !== null && context.agents[event.agentId] !== undefined) {
          context.agents[event.agentId].status = 'failed';
          context.agents[event.agentId].lastHeartbeatAt = event.at;
          context.updatedAt = event.at;
        }
        break;
      case 'signal.heartbeat':
        if (context !== null && context.agents[event.agentId] !== undefined) {
          context.agents[event.agentId].lastHeartbeatAt = event.at;
          context.updatedAt = event.at;
        }
        break;
      case 'signal.session_lost':
      case 'signal.heartbeat_expired':
        // Display-only: record the event timestamp but do NOT change agent status.
        // Liveness is a dashboard concern, not an engine state concern.
        if (context !== null && context.agents[event.agentId] !== undefined) {
          context.agents[event.agentId].lastHeartbeatExpiredAt = event.at;
          context.updatedAt = event.at;
        }
        break;
      case 'feature.spec_review.started':
      case 'research.spec_review.started':
      case 'spec_review.started':
        if (event.type === 'spec_review.started') {
          console.warn('[projector] legacy spec_review.started event — run `aigon doctor --fix` to migrate to feature.spec_review.started');
        }
        if (context !== null) {
          const prev = context.specReview || {};
          const activeReviewers = Array.isArray(prev.activeReviewers) ? prev.activeReviewers : [];
          const reviewerId = String(event.reviewerId || '').trim();
          if (reviewerId) {
            context.specReview = {
              ...prev,
              activeReviewers: [
                ...activeReviewers.filter((entry) => entry.agentId !== reviewerId),
                { agentId: reviewerId, startedAt: event.at },
              ],
            };
            refreshSpecReviewState(context);
            if (event.type !== 'spec_review.started') {
              lifecycle = 'spec_review_in_progress';
            }
            context.updatedAt = event.at;
          }
        }
        break;
      case 'feature.spec_review.completed':
      case 'research.spec_review.completed':
        if (context !== null) {
          const prev = context.specReview || {};
          const activeReviewers = Array.isArray(prev.activeReviewers) ? prev.activeReviewers : [];
          context.specReview = {
            ...prev,
            activeReviewers: activeReviewers.filter((entry) => entry.agentId !== event.reviewerId),
          };
          refreshSpecReviewState(context);
          lifecycle = 'backlog';
          context.updatedAt = event.at;
        }
        break;
      case 'feature.spec_review.cancelled':
      case 'research.spec_review.cancelled':
        if (context !== null) {
          const prev = context.specReview || {};
          context.specReview = {
            ...prev,
            activeReviewers: [],
            activeCheckers: [],
          };
          refreshSpecReviewState(context);
          lifecycle = 'backlog';
          context.updatedAt = event.at;
        }
        break;
      case 'feature.spec_revision.cancelled':
      case 'research.spec_revision.cancelled':
        if (context !== null) {
          const prev = context.specReview || {};
          context.specReview = {
            ...prev,
            activeReviewers: [],
            activeCheckers: [],
          };
          refreshSpecReviewState(context);
          lifecycle = 'backlog';
          context.updatedAt = event.at;
        }
        break;
      case 'feature.spec_revision.started':
      case 'research.spec_revision.started':
        if (context !== null) {
          const prev = context.specReview || {};
          const activeCheckers = Array.isArray(prev.activeCheckers) ? prev.activeCheckers : [];
          const checkerId = String(event.checkerId || event.reviewerId || '').trim();
          if (checkerId) {
            context.specReview = {
              ...prev,
              activeCheckers: [
                ...activeCheckers.filter((entry) => entry.agentId !== checkerId),
                { agentId: checkerId, startedAt: event.at },
              ],
            };
            refreshSpecReviewState(context);
            lifecycle = 'spec_revision_in_progress';
            context.updatedAt = event.at;
          }
        }
        break;
      case 'feature.spec_revision.completed':
      case 'research.spec_revision.completed':
        if (context !== null) {
          const prev = context.specReview || {};
          context.specReview = {
            ...prev,
            activeCheckers: [],
          };
          refreshSpecReviewState(context);
          if (event.requestAnotherCycle === true && typeof event.nextReviewerId === 'string') {
            context.pendingSpecReviewer = event.nextReviewerId;
            lifecycle = 'spec_review_in_progress';
          } else {
            lifecycle = 'backlog';
          }
          context.updatedAt = event.at;
        }
        break;
      case 'spec_review.check_started':
        console.warn('[projector] legacy spec_review.check_started event — run `aigon doctor --fix` to migrate to feature.spec_revision.started');
        if (context !== null) {
          const prev = context.specReview || {};
          const activeCheckers = Array.isArray(prev.activeCheckers) ? prev.activeCheckers : [];
          const checkerId = String(event.checkerId || '').trim();
          if (checkerId) {
            context.specReview = {
              ...prev,
              activeCheckers: [
                ...activeCheckers.filter((entry) => entry.agentId !== checkerId),
                { agentId: checkerId, startedAt: event.at },
              ],
            };
            refreshSpecReviewState(context);
            context.updatedAt = event.at;
          }
        }
        break;
      case 'spec_review.submitted':
        if (context !== null) {
          const prev = context.specReview || {};
          const pendingReviews = prev.pendingReviews || [];
          const activeReviewers = Array.isArray(prev.activeReviewers) ? prev.activeReviewers : [];
          context.specReview = {
            ...prev,
            pendingReviews: [
              ...pendingReviews.filter((review) => review.reviewId !== event.reviewId),
              {
                reviewId: event.reviewId,
                reviewerId: event.reviewerId,
                summary: event.summary || '',
                submittedAt: event.at,
                commitSha: event.commitSha || null,
              },
            ],
            activeReviewers: activeReviewers.filter((entry) => entry.agentId !== event.reviewerId),
          };
          refreshSpecReviewState(context);
          context.updatedAt = event.at;
        }
        break;
      case 'spec_review.acked':
        if (context !== null) {
          const prev = context.specReview || {};
          const pendingReviews = prev.pendingReviews || [];
          const ackedIds = new Set(Array.isArray(event.reviewIds) ? event.reviewIds : []);
          context.specReview = {
            ...prev,
            pendingReviews: ackedIds.size === 0
              ? []
              : pendingReviews.filter((review) => !ackedIds.has(review.reviewId)),
            activeCheckers: [],
          };
          refreshSpecReviewState(context);
          context.updatedAt = event.at;
        }
        break;
      case 'agent.dropped':
        if (context !== null && context.agents[event.agentId] !== undefined) {
          delete context.agents[event.agentId];
          context.updatedAt = event.at;
        }
        break;
    }
  }

  if (context === null) {
    return null;
  }

  if (!context.specReview) {
    context.specReview = createSpecReviewState();
  } else {
    refreshSpecReviewState(context);
  }
  if (!Object.prototype.hasOwnProperty.call(context, 'agentFailover')) {
    context.agentFailover = null;
  }
  if (!Object.prototype.hasOwnProperty.call(context, 'pauseReason')) {
    context.pauseReason = null;
  }
  if (!Array.isArray(context.reviewCycles)) {
    context.reviewCycles = [];
  }
  if (!Object.prototype.hasOwnProperty.call(context, 'pendingCodeReviewer')) {
    context.pendingCodeReviewer = null;
  }
  if (!Object.prototype.hasOwnProperty.call(context, 'pendingSpecReviewer')) {
    context.pendingSpecReviewer = null;
  }
  context.currentSpecState = lifecycle;
  return context;
}

module.exports = { projectContext };
