'use strict';

const fs = require('fs');
const path = require('path');
const workflowDefinitions = require('./workflow-definitions');
const { readFeatureAutoState } = require('./auto-session-state');
const workflowSnapshotAdapter = require('./workflow-snapshot-adapter');
const { reconcileEntitySpec } = require('./spec-reconciliation');
const { LifecycleState } = require('./workflow-core/types');
const { engineDirExists } = require('./workflow-core/entity-lifecycle');
const { getStateRenderMeta } = require('./state-render-meta');
const {
    findTmuxSessionsByPrefix,
    findFirstTmuxSessionByPrefix,
    findSpecReviewTmuxSession,
} = require('./dashboard-status-helpers');
const {
    tmuxSessionExists,
    toUnpaddedId,
    parseTmuxSessionName,
} = require('./worktree');
const { STAGE_FOLDERS } = require('./workflow-core/paths');
const { appendQuotaPausedDashboardActions } = require('./quota-dashboard-actions');
const { appendEscalationDashboardActions } = require('./feature-escalation-dashboard-actions');
const { appendFeatureAutonomousDashboardActions } = require('./feature-autonomous-dashboard-actions');
const {
    appendFeatureReviewRecoveryDashboardActions,
    appendResearchReviewRecoveryDashboardActions,
} = require('./feature-review-recovery-dashboard-actions');

// Failover action appenders registered by @aigon/pro. Same signature as
// appendQuotaPausedDashboardActions: (repoPath, entityType, entityId, snapshot, agents, validActions) => validActions
const failoverActionAppenders = [];

function registerFailoverActionAppender(fn) {
    if (typeof fn === 'function') failoverActionAppenders.push(fn);
}

const WORKFLOW_SOURCE = Object.freeze({
    SNAPSHOT: 'workflow-snapshot',
    MISSING_SNAPSHOT: 'missing-snapshot',
    // Feature 341: snapshot carries sidecar `specReview` (pendingCount>0 or
    // activeReviewers>0) but currentSpecState is still `inbox`/`backlog` —
    // the engine state did not track the spec review. Flag loudly and cite
    // `aigon doctor --fix`; do not silently degrade.
    MISSING_MIGRATION: 'missing-migration',
});

const ENTITY_WORKFLOW_DIRS = Object.freeze({
    feature: ['features', 'docs/specs/features'],
    research: ['research', 'docs/specs/research-topics'],
});

const STAGE_TO_VISIBLE_DIR = Object.freeze({
    inbox: STAGE_FOLDERS.INBOX,
    backlog: STAGE_FOLDERS.BACKLOG,
    'in-progress': STAGE_FOLDERS.IN_PROGRESS,
    'in-evaluation': STAGE_FOLDERS.IN_EVALUATION,
    done: STAGE_FOLDERS.DONE,
    paused: STAGE_FOLDERS.PAUSED,
});

const AUTONOMOUS_STAGE_LABELS = Object.freeze({
    implement: 'Implement',
    review: 'Review',
    revision: 'Revision',
    eval: 'Evaluate',
    close: 'Close',
});

const AUTONOMOUS_REASON_DEFINITIONS = Object.freeze({
    'snapshot-missing': { category: 'setup-failure', label: 'Workflow snapshot missing', recovery: 'retry-setup' },
    'review-worktree-missing': { category: 'setup-failure', label: 'Review worktree missing', recovery: 'retry-setup' },
    'review-session-start-failed': { category: 'setup-failure', label: 'Review session failed to start', recovery: 'rerun-review' },
    'eval-session-start-failed': { category: 'setup-failure', label: 'Evaluation session failed to start', recovery: 'rerun-eval' },
    'review-exited-without-signal': { category: 'reviewer-exited', label: 'Reviewer exited without signaling', recovery: 'rerun-review' },
    'review-session-timeout': { category: 'timeout', label: 'Review session start timed out', recovery: 'rerun-review' },
    'review-timeout': { category: 'timeout', label: 'Review timed out', recovery: 'rerun-review' },
    'feedback-timeout': { category: 'timeout', label: 'Feedback handling timed out', recovery: 'manual' },
    'feature-close-state-timeout': { category: 'timeout', label: 'Feature close state timed out', recovery: 'retry-close' },
    'eval-start-timeout': { category: 'timeout', label: 'Evaluation start timed out', recovery: 'rerun-eval' },
    'eval-close-timeout': { category: 'timeout', label: 'Evaluation close timed out', recovery: 'retry-close' },
    'quota-cap': { category: 'quota', label: 'Quota cap reached', recovery: 'wait-quota' },
    'review-quota-paused': { category: 'quota', label: 'Reviewer quota paused', recovery: 'rerun-review' },
    'eval-exited-without-winner': { category: 'eval-failure', label: 'Evaluation exited without a winner', recovery: 'rerun-eval' },
    'feature-close-failed': { category: 'close-failure', label: 'Feature close failed', recovery: 'retry-close' },
    'escalation-pending': { category: 'operator-input', label: 'Review escalation needs disposition', recovery: 'manual' },
    'uncaught-error': { category: 'setup-failure', label: 'AutoConductor crashed', recovery: 'manual' },
    'auto-session-lost': { category: 'setup-failure', label: 'AutoConductor session lost', recovery: 'resume-automation' },
    'implementer-session-died': { category: 'setup-failure', label: 'Implementer session died', recovery: 'resume-automation' },
    'stop-after-implement': { category: 'stopped-checkpoint', label: 'Stopped after implementation', recovery: 'manual' },
    'stop-after-review': { category: 'stopped-checkpoint', label: 'Stopped after review', recovery: 'manual' },
    'stop-after-eval': { category: 'stopped-checkpoint', label: 'Stopped after evaluation', recovery: 'manual' },
    'stopped-by-user': { category: 'stopped-by-user', label: 'Stopped by user', recovery: 'manual' },
    'feature-closed': { category: 'completed', label: 'Feature closed', recovery: 'manual' },
});

const AUTONOMOUS_REASON_FALLBACK = Object.freeze({
    category: 'unknown',
    label: 'Unknown controller state',
    recovery: 'manual',
});

const AUTONOMOUS_RUNNING_CATEGORY = Object.freeze({
    category: 'running',
    recovery: 'manual',
});

function normalizeStringArray(value) {
    return Array.isArray(value)
        ? value.map(item => String(item || '').trim()).filter(Boolean)
        : [];
}

function resolveAutonomousReason(reason) {
    if (!reason) return AUTONOMOUS_REASON_FALLBACK;
    return AUTONOMOUS_REASON_DEFINITIONS[reason] || AUTONOMOUS_REASON_FALLBACK;
}

function resolveAutonomousControllerDisplay(autoState) {
    const status = String(autoState && autoState.status || '').trim();
    const reason = String(autoState && autoState.reason || '').trim();
    if (reason) {
        return { ...resolveAutonomousReason(reason), reason };
    }

    if (status === 'running' || status === 'starting') {
        const workflowState = String(autoState && autoState.workflowState || '').trim();
        const workflowMeta = getStateRenderMeta(workflowState);
        const label = workflowMeta && workflowMeta.label && workflowMeta.label !== 'Unknown'
            ? workflowMeta.label
            : 'Running';
        return {
            ...AUTONOMOUS_RUNNING_CATEGORY,
            label,
            reason: workflowState || null,
        };
    }

    return AUTONOMOUS_REASON_FALLBACK;
}

/**
 * Read-only reconciliation: when workflow progress post-dates a feature-auto
 * failure (e.g. review-timeout before reviewCompletedAt), downgrade recovery.
 */
function reconcileAutonomousRecovery(autoState, snapshot) {
    if (!autoState || !snapshot) return null;
    const reason = String(autoState.reason || '').trim();
    if (!reason) return null;
    const autoTs = autoState.updatedAt || autoState.endedAt;
    const reviewCompletedAt = snapshot.codeReview && snapshot.codeReview.reviewCompletedAt;
    if (!autoTs || !reviewCompletedAt) return null;
    if (new Date(autoTs).getTime() >= new Date(reviewCompletedAt).getTime()) return null;

    const staleTimeoutReasons = new Set(['review-timeout', 'review-exited-without-signal']);
    if (!staleTimeoutReasons.has(reason)) {
        const lifecycle = snapshot.currentSpecState || snapshot.lifecycle;
        const reviewCancelled = Boolean(snapshot.codeReview && snapshot.codeReview.cancelledAt);
        if (reason === 'review-quota-paused' && lifecycle === 'ready' && reviewCancelled) {
            const baseMeta = resolveAutonomousReason(reason);
            return {
                staleFailure: true,
                recommendedRecoveryKind: 'rerun-review',
                reasonLabel: `${baseMeta.label} (review cancelled — pick a new reviewer)`,
                reasonCategory: 'stale-recovered',
            };
        }
        return null;
    }

    const baseMeta = resolveAutonomousReason(reason);
    return {
        staleFailure: true,
        recommendedRecoveryKind: 'resume-automation',
        reasonLabel: `${baseMeta.label} (review has since completed)`,
        reasonCategory: 'stale-recovered',
    };
}

function buildAutonomousController(autoState, sessionLivenessLookup = null, snapshot = null) {
    if (!autoState) return null;
    const reason = autoState.reason || null;
    const reconciliation = snapshot ? reconcileAutonomousRecovery(autoState, snapshot) : null;
    const reasonMeta = reconciliation
        ? {
            ...resolveAutonomousReason(reason),
            recovery: reconciliation.recommendedRecoveryKind,
            label: reconciliation.reasonLabel,
            category: reconciliation.reasonCategory,
        }
        : resolveAutonomousControllerDisplay(autoState);
    const sessionName = autoState.sessionName || null;
    const error = autoState.error && typeof autoState.error === 'object'
        ? (autoState.error.message || String(autoState.error))
        : (autoState.error || null);
    let sessionRunning = false;
    if (sessionName && typeof sessionLivenessLookup === 'function') {
        try {
            sessionRunning = Boolean(sessionLivenessLookup(sessionName));
        } catch (_) {
            sessionRunning = false;
        }
    }

    return {
        status: autoState.status || null,
        running: Boolean(autoState.running),
        reason,
        reasonLabel: reasonMeta.label,
        reasonCategory: reasonMeta.category,
        recommendedRecoveryKind: reasonMeta.recovery,
        staleFailureRecovered: Boolean(reconciliation && reconciliation.staleFailure),
        error,
        sessionName,
        sessionRunning,
        startedAt: autoState.startedAt || null,
        updatedAt: autoState.updatedAt || null,
        endedAt: autoState.endedAt || null,
        workflowState: autoState.workflowState || null,
        mode: autoState.mode || null,
        agents: normalizeStringArray(autoState.agents),
        reviewAgent: autoState.reviewAgent || null,
        evalAgent: autoState.evalAgent || null,
    };
}

function listWorkflowEntityIds(repoPath, entityType) {
    const workflowDirName = entityType === 'research' ? ENTITY_WORKFLOW_DIRS.research[0] : ENTITY_WORKFLOW_DIRS.feature[0];
    const workflowRoot = path.join(repoPath, '.aigon', 'workflows', workflowDirName);
    try {
        return fs.readdirSync(workflowRoot)
            .filter(dir => /^\d+$/.test(dir) && fs.existsSync(path.join(workflowRoot, dir, 'snapshot.json')))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    } catch (_) {
        return [];
    }
}

function toRelativeRepoPath(repoPath, targetPath) {
    return targetPath ? path.relative(repoPath, targetPath).replace(/\\/g, '/') : null;
}

function toSpecDrift(repoPath, specReconciliation) {
    if (!specReconciliation || specReconciliation.driftDetected !== true || specReconciliation.moved) return null;
    return {
        currentPath: toRelativeRepoPath(repoPath, specReconciliation.currentPath),
        expectedPath: toRelativeRepoPath(repoPath, specReconciliation.expectedPath),
        lifecycle: specReconciliation.lifecycle || null,
    };
}

function buildMissingSnapshotState(currentStage, entityType, entityId, options = {}) {
    // A spec file exists but no workflow-core snapshot is on disk.
    //
    // F397 discriminator: there are two genuinely different "no snapshot"
    // states, and the previous code conflated them.
    //  (a) PRE-START — no engine dir at all. Inbox/backlog spec was created
    //      before workflow-core was bootstrapped (legacy seed repos, or pre
    //      F296 inbox specs). Folder position IS the legitimate signal here,
    //      and synthesising pre-engine actions (Prioritise/Start) is correct.
    //  (b) DRIFT/CORRUPTION — engine dir exists but snapshot.json is missing
    //      or unreadable. The entity has been started; folder position MUST
    //      NOT be trusted as lifecycle state. Card stays inert (no actions)
    //      until `aigon doctor --fix` resolves the underlying drift.
    //
    // Dashboard: return this shape (do not throw) so one bad row does not
    // 500 the whole grid. CLI/commands use console.error + non-zero exit.
    const isDrift = options.engineDirExists === true;
    const actionStage = (!isDrift && (currentStage === 'inbox' || currentStage === 'backlog'))
        ? currentStage
        : null;
    const stageActions = (entityType && actionStage)
        ? workflowSnapshotAdapter.snapshotToDashboardActions(entityType, entityId || null, null, actionStage)
        : { nextAction: null, nextActions: [], validActions: [] };
    return {
        stage: currentStage || null,
        visibleStage: currentStage || null,
        specDrift: null,
        workflowSnapshot: null,
        snapshotStatuses: {},
        nextAction: stageActions.nextAction,
        nextActions: stageActions.nextActions,
        validActions: stageActions.validActions,
        workflowEvents: [],
        startupReadiness: null,
        readModelSource: WORKFLOW_SOURCE.MISSING_SNAPSHOT,
        // Surface the discriminator so dashboard/CLI consumers can render a
        // distinct "drift" badge without re-reading the filesystem.
        engineDirExists: isDrift,
    };
}

function getBaseDashboardState(entityType, repoPath, entityId, currentStage, snapshotOverride) {
    const snapshot = snapshotOverride === undefined
        ? (entityId
            ? (entityType === 'feature'
                ? workflowSnapshotAdapter.readFeatureSnapshotSync(repoPath, entityId)
                : workflowSnapshotAdapter.readWorkflowSnapshotSync(repoPath, entityType, entityId))
            : null)
        : snapshotOverride;
    // Detect-only on read paths: compute drift but do not move files.
    // F272 originally made dashboard reads auto-reconcile folder drift, which
    // turned every refresh into a silent filesystem mutation across every
    // registered repo. That behaviour now lives behind an explicit command
    // (`aigon repair`) and an opt-in env var for users who want auto-heal.
    // See feature-275 for the planned per-row "reconcile" UI.
    const reconcileMutates = process.env.AIGON_AUTO_RECONCILE === '1';
    const specReconciliation = snapshot && entityId
        ? reconcileEntitySpec(repoPath, entityType, entityId, { snapshot, dryRun: !reconcileMutates })
        : null;
    const specDrift = toSpecDrift(repoPath, specReconciliation);

    if (snapshot) {
        const snapshotStage = workflowSnapshotAdapter.snapshotToStage(snapshot) || currentStage || null;
        // Unprioritised specs in 01-inbox/ must stay in the inbox column. snapshotToStage maps
        // spec_review_* / spec_revision_* lifecycles to 'backlog' for prioritised work; the same
        // engine state on a slug-backed inbox spec would incorrectly bucket the card as backlog.
        // Folder position from the dashboard collector (currentStage === 'inbox') is authoritative
        // for the Kanban column until feature-prioritise moves the file to 02-backlog/.
        const stage = (currentStage === 'inbox')
            ? 'inbox'
            : (snapshotStage || currentStage || null);
        const snapshotStatuses = workflowSnapshotAdapter.snapshotAgentStatuses(snapshot);
        const snapshotActions = workflowSnapshotAdapter.snapshotToDashboardActions(entityType, entityId, snapshot, stage);
        const rawWorkflowEvents = entityId ? (
            entityType === 'feature'
                ? workflowSnapshotAdapter.readFeatureEventsSync(repoPath, entityId)
                : workflowSnapshotAdapter.readWorkflowEventsSync(repoPath, entityType, entityId)
        ) : [];
        return {
            stage,
            visibleStage: (specReconciliation && specReconciliation.visibleStage) || currentStage || stage,
            specDrift,
            workflowSnapshot: snapshot,
            snapshotStatuses,
            nextAction: snapshotActions.nextAction,
            nextActions: snapshotActions.nextActions,
            validActions: snapshotActions.validActions,
            workflowEvents: workflowSnapshotAdapter.filterAgentSignalEvents(rawWorkflowEvents),
            startupReadiness: workflowSnapshotAdapter.computeStartupReadiness(rawWorkflowEvents, snapshot),
            readModelSource: detectMissingMigration(snapshot)
                ? WORKFLOW_SOURCE.MISSING_MIGRATION
                : WORKFLOW_SOURCE.SNAPSHOT,
        };
    }

    return buildMissingSnapshotState(currentStage, entityType, entityId, {
        engineDirExists: entityId ? engineDirExists(repoPath, entityType, entityId) : false,
    });
}

/**
 * Feature 341: a snapshot carrying sidecar `specReview` state whose
 * `currentSpecState` is still a pre-review (`inbox`/`backlog`) lifecycle
 * has not had its engine-state migration applied. Flag it so the read
 * path fails loudly (dashboard badge + CLI exit cite `aigon doctor --fix`).
 */
function detectMissingMigration(snapshot) {
    if (!snapshot || !snapshot.specReview) return false;
    const state = snapshot.currentSpecState || snapshot.lifecycle;
    if (!['inbox', 'backlog'].includes(state)) return false;
    const activeReviewers = Array.isArray(snapshot.specReview.activeReviewers)
        ? snapshot.specReview.activeReviewers
        : [];
    const pendingCount = Number(snapshot.specReview.pendingCount || 0);
    return activeReviewers.length > 0 || pendingCount > 0;
}

function appendReadModelFlags(state) {
    return {
        ...state,
        workflowEngine: 'workflow-core',
        visibleStageDir: STAGE_TO_VISIBLE_DIR[state.stage] || null,
    };
}

/**
 * Derive review status and sessions from snapshot.reviewCycles[] joined with tmux.
 * Replaces the old sidecar-based readFeatureReviewState / readResearchReviewState.
 */
function deriveReviewStateFromSnapshot(repoPath, entityId, entityPrefix, currentStage, snapshot) {
    let reviewStatus = null;
    let reviewSessions = [];
    const isActiveStage = currentStage === 'in-progress' || currentStage === 'in-evaluation';
    if (!isActiveStage || !entityId || !snapshot) {
        return { reviewStatus, reviewSessions };
    }

    const reviewCycles = Array.isArray(snapshot.reviewCycles) ? snapshot.reviewCycles : [];
    const codeReview = snapshot.codeReview || null;

    if (snapshot.currentSpecState === LifecycleState.CODE_REVIEW_IN_PROGRESS && codeReview) {
        // After a loopback, the next reviewer sits on pendingCodeReviewer until code_review.started; do
        // not show the previous cycle's codeReview.reviewerId in that window.
        const agent = codeReview.activeReviewerId
            || snapshot.pendingCodeReviewer
            || codeReview.reviewerId
            || null;
        const awaitingNextSession = Boolean(
            snapshot.pendingCodeReviewer
            && !codeReview.activeReviewerId
        );
        reviewStatus = 'running';
        const sessionName = agent ? findFirstTmuxSessionByPrefix(
            `${entityPrefix}${toUnpaddedId(entityId)}-review-${agent}`,
            s => ({ session: s, agent, running: tmuxSessionExists(s) }),
        ) : null;
        reviewSessions = [{
            session: sessionName ? sessionName.session : null,
            agent,
            running: true,
            status: 'in-progress',
            startedAt: (awaitingNextSession ? null : (codeReview.reviewStartedAt || null)),
            completedAt: null,
            cycle: reviewCycles.length + 1,
            statusCls: getStateRenderMeta(LifecycleState.CODE_REVIEW_IN_PROGRESS).cls,
        }].filter(s => s.agent);
        return { reviewStatus, reviewSessions };
    }

    // Build sessions from completed reviewCycles
    const totalCycles = reviewCycles.filter(c => c.type === 'code').length;
    reviewSessions = reviewCycles.filter(c => c.type === 'code').map((c, idx) => {
        const agent = c.reviewer;
        const sessionInfo = agent ? findFirstTmuxSessionByPrefix(
            `${entityPrefix}${toUnpaddedId(entityId)}-review-${agent}`,
            s => ({ session: s, agent, running: tmuxSessionExists(s) }),
        ) : null;
        // Only the last cycle may have been approved; earlier cycles always requested revision
        const isLastCycle = idx === totalCycles - 1;
        const requestRevision = isLastCycle && codeReview
            ? (codeReview.requestRevision != null ? Boolean(codeReview.requestRevision) : null)
            : true;
        return {
            session: sessionInfo ? sessionInfo.session : null,
            agent,
            running: false,
            status: 'complete',
            startedAt: c.startedAt,
            completedAt: c.counterCompletedAt || c.completedAt,
            cycle: c.cycle,
            requestRevision,
            statusCls: getStateRenderMeta(LifecycleState.CODE_REVIEW_COMPLETE).cls,
        };
    });

    // If codeReview has a completed review but no reviewCycles entry yet (single cycle, no loopback)
    if (reviewCycles.length === 0 && codeReview && codeReview.reviewCompletedAt) {
        const agent = codeReview.reviewerId || codeReview.activeReviewerId || null;
        if (agent) {
            const sessionInfo = findFirstTmuxSessionByPrefix(
                `${entityPrefix}${toUnpaddedId(entityId)}-review-${agent}`,
                s => ({ session: s, agent, running: tmuxSessionExists(s) }),
            );
            reviewSessions = [{
                session: sessionInfo ? sessionInfo.session : null,
                agent,
                running: false,
                status: 'complete',
                startedAt: codeReview.reviewStartedAt || null,
                completedAt: codeReview.reviewCompletedAt,
                cycle: 1,
                requestRevision: codeReview.requestRevision != null ? Boolean(codeReview.requestRevision) : null,
                statusCls: getStateRenderMeta(LifecycleState.CODE_REVIEW_COMPLETE).cls,
            }];
        }
    }

    if (reviewSessions.some(s => s.running)) {
        reviewStatus = 'running';
    } else if (reviewSessions.length > 0) {
        reviewStatus = 'done';
    }

    return { reviewStatus, reviewSessions };
}

/**
 * Enrich a workflow snapshot with infra data from dashboard agent rows
 * and feature-level data (eval, review). This allows infra action guards
 * to evaluate against the enriched context.
 */
function enrichSnapshotWithInfraData(snapshot, dashboardAgents, featureData) {
    if (!snapshot) return snapshot;
    const enriched = { ...snapshot };
    if (dashboardAgents && dashboardAgents.length > 0) {
        enriched.agents = { ...enriched.agents };
        dashboardAgents.forEach(da => {
            if (enriched.agents[da.id]) {
                enriched.agents[da.id] = {
                    ...enriched.agents[da.id],
                    devServerPokeEligible: da.devServerPokeEligible || false,
                    devServerUrl: da.devServerUrl || null,
                    flags: da.flags || {},
                    findingsPath: da.findingsPath || null,
                };
            }
        });
        // F494: bridge live tmux state into the action context so the manual
        // nudge guards (FEATURE_NUDGE / RESEARCH_NUDGE) can evaluate. This
        // field is dashboard-runtime only — never written to snapshots.
        enriched.tmuxSessionStates = Object.fromEntries(
            dashboardAgents.map(da => [da.id, da.tmuxRunning ? 'running' : 'none'])
        );
    }
    if (featureData) {
        enriched.evalPath = featureData.evalPath || null;
        enriched.evalSession = featureData.evalSession || null;
        enriched.reviewSessions = featureData.reviewSessions || [];
        enriched.reviewStatus = featureData.reviewStatus || null;
    }
    return enriched;
}

function buildAutonomousPlanError(featureId, detail) {
    const repairCommand = 'aigon doctor --fix';
    const message = `Autonomous plan unavailable for feature ${featureId}: ${detail}. Run: ${repairCommand}`;
    return {
        error: {
            code: 'AUTONOMOUS_PLAN_UNAVAILABLE',
            message,
            repairCommand,
        },
        stages: [],
    };
}

function normalizeAutonomousWorkflow(repoPath, featureId, autoState) {
    if (!autoState || typeof autoState !== 'object') return null;

    if (autoState.workflowSlug) {
        const resolved = workflowDefinitions.resolve(autoState.workflowSlug, repoPath);
        if (!resolved) {
            return buildAutonomousPlanError(featureId, `workflow "${autoState.workflowSlug}" could not be resolved`);
        }
        return {
            workflowSlug: autoState.workflowSlug,
            workflowLabel: resolved.label || autoState.workflowSlug,
            source: 'workflow-definition',
            stages: resolved.stages,
        };
    }

    const agents = Array.isArray(autoState.agents)
        ? autoState.agents.map(agent => String(agent || '').trim()).filter(Boolean)
        : [];
    const stopAfter = String(autoState.stopAfter || '').trim();
    if (agents.length === 0) {
        return buildAutonomousPlanError(featureId, 'missing implementing agents in autonomous state');
    }
    if (!workflowDefinitions.VALID_STOP_AFTER.includes(stopAfter)) {
        return buildAutonomousPlanError(featureId, 'missing or invalid stopAfter in autonomous state');
    }

    const isFleet = String(autoState.mode || '').trim() === 'fleet' || agents.length > 1;
    const stages = [{ type: 'implement', agents: agents.slice() }];

    if (isFleet) {
        if (stopAfter === 'review') {
            return buildAutonomousPlanError(featureId, 'fleet autonomous runs cannot stop after review');
        }
        if (stopAfter === 'eval' || stopAfter === 'close') {
            const evalAgent = String(autoState.evalAgent || '').trim();
            if (!evalAgent) {
                return buildAutonomousPlanError(featureId, 'fleet autonomous run is missing evalAgent');
            }
            stages.push({ type: 'eval', agents: [evalAgent] });
        }
        if (stopAfter === 'close') stages.push({ type: 'close' });
    } else {
        const implementAgent = agents[0];
        const reviewAgent = String(autoState.reviewAgent || '').trim() || null;
        if (reviewAgent) stages.push({ type: 'review', agents: [reviewAgent] });
        if (stopAfter === 'review' && !reviewAgent) {
            return buildAutonomousPlanError(featureId, 'solo autonomous run stopping after review is missing reviewAgent');
        }
        if (stopAfter === 'close' && reviewAgent) {
            stages.push({ type: 'revision', agents: [implementAgent] });
        }
        if (stopAfter === 'close') stages.push({ type: 'close' });
    }

    return {
        workflowSlug: autoState.workflowSlug || null,
        workflowLabel: null,
        source: 'autonomous-state',
        stages,
    };
}

function isAgentReadyStatus(status) {
    // F501 backward compat: old agent status files may still hold 'submitted'.
    return status === 'ready' || status === 'submitted';
}

function isAgentFailedStatus(status) {
    return status === 'error' || status === 'failed';
}

function findAutonomousStageFailure(stageType, autoState, snapshot = null) {
    if (!autoState || autoState.status !== 'failed') return false;
    if (stageType === 'review' && snapshot && reconcileAutonomousRecovery(autoState, snapshot)) return false;
    const reason = String(autoState.reason || '').trim();
    if (!reason) return false;
    if (stageType === 'implement') return !/^(review|eval|feedback|feature-close|snapshot)/.test(reason);
    if (stageType === 'review') return /^review-/.test(reason);
    if (stageType === 'revision') return /^feedback-/.test(reason);
    if (stageType === 'eval') return /^eval-/.test(reason);
    if (stageType === 'close') return /close/.test(reason);
    return false;
}

/** One predicate per stage boundary: has the run advanced past this stage? */
function pastAutonomousStage(stageType, signals) {
    const {
        implementReady, reviewRunning, reviewComplete, feedbackAddressed,
        reviewApprovedNoRevision, evalRunning, evalComplete, closeRunning, closeComplete,
    } = signals;
    switch (stageType) {
    case 'implement':
        return implementReady || reviewRunning || reviewComplete
            || evalRunning || evalComplete || closeRunning || closeComplete;
    case 'review':
        return reviewComplete || feedbackAddressed || reviewApprovedNoRevision
            || evalRunning || evalComplete || closeRunning || closeComplete;
    case 'revision':
        return feedbackAddressed || reviewApprovedNoRevision
            || evalRunning || evalComplete || closeRunning || closeComplete;
    case 'eval':
        return evalComplete || closeRunning || closeComplete;
    case 'close':
        return closeComplete;
    default:
        return false;
    }
}

function isAutonomousStageRunning(stageType, signals, autoState) {
    const { implementFailed, reviewRunning, evalRunning, closeRunning } = signals;
    switch (stageType) {
    case 'implement':
        return !implementFailed && !pastAutonomousStage('implement', signals);
    case 'review':
        return reviewRunning;
    case 'revision':
        return Boolean(autoState.feedbackInjected) && !pastAutonomousStage('revision', signals);
    case 'eval':
        return evalRunning && !pastAutonomousStage('eval', signals);
    case 'close':
        return closeRunning && !pastAutonomousStage('close', signals);
    default:
        return false;
    }
}

/**
 * Linear progress index: furthest stage reached plus status at that boundary.
 * Per-stage status: i < index → complete; i === index → currentStatus; else waiting.
 */
function computeAutonomousProgressIndex(stages, signals, autoState, snapshot) {
    for (let i = 0; i < stages.length; i++) {
        const stageType = stages[i].type;
        // REGRESSION F654: implement stage failure includes agent-status errors
        // (dashboard/snapshot 'error'/'failed'), not just autoState.status === 'failed'.
        const failed = stageType === 'implement'
            ? signals.implementFailed
            : findAutonomousStageFailure(stageType, autoState, snapshot);
        if (failed) {
            return { progressIndex: i, currentStatus: 'failed' };
        }
        if (isAutonomousStageRunning(stageType, signals, autoState)) {
            return { progressIndex: i, currentStatus: 'running' };
        }
        if (!pastAutonomousStage(stageType, signals)) {
            return { progressIndex: i, currentStatus: 'waiting' };
        }
    }
    return { progressIndex: stages.length, currentStatus: 'complete' };
}

function buildAutonomousStagePlan(options) {
    const {
        repoPath,
        featureId,
        currentStage,
        snapshot,
        dashboardAgents,
        autoState,
        review,
        evaluation,
    } = options;

    if (!autoState) return null;
    const resolved = normalizeAutonomousWorkflow(repoPath, featureId, autoState);
    if (!resolved) return null;
    if (resolved.error) return resolved;

    const dashboardAgentMap = new Map((dashboardAgents || []).map(agent => [agent.id, agent]));
    const reviewAgent = String(autoState.reviewAgent || '').trim() || null;
    const evalAgent = String(autoState.evalAgent || '').trim() || null;
    const implementStatuses = (resolved.stages[0]?.agents || [])
        .map(agent => {
            const agentId = typeof agent === 'string' ? agent : agent.id;
            const dashboardStatus = dashboardAgentMap.get(agentId)?.status || null;
            const snapshotStatus = snapshot?.agents?.[agentId]?.status || null;
            return dashboardStatus || snapshotStatus || null;
        })
        .filter(Boolean);
    const implementReady = implementStatuses.length > 0 && implementStatuses.every(isAgentReadyStatus);
    const implementFailed = implementStatuses.some(isAgentFailedStatus) || findAutonomousStageFailure('implement', autoState, snapshot);
    const reviewRunning = Boolean(
        review?.reviewStatus === 'running'
        || (review?.reviewSessions || []).some(session => session.running && (!reviewAgent || session.agent === reviewAgent))
    );
    const reviewCurrentlyActive = Boolean(
        review?.reviewState?.current?.status === 'in-progress'
        && (!reviewAgent || review?.reviewState?.current?.agent === reviewAgent)
    );
    const reviewComplete = !reviewCurrentlyActive && Boolean(
        review?.reviewStatus === 'done'
        || (review?.reviewState?.history || []).some(entry => !reviewAgent || entry.agent === reviewAgent)
    );
    const feedbackAddressed = (resolved.stages[0]?.agents || []).some(agent => {
        const agentId = typeof agent === 'string' ? agent : agent.id;
        const status = dashboardAgentMap.get(agentId)?.status || snapshot?.agents?.[agentId]?.status || null;
        return status === 'feedback-addressed' || status === 'revision-complete';
    });
    // Approved review (no revision requested) skips the revision stage —
    // mark it complete so the headline doesn't render "Starting revision".
    const reviewApprovedNoRevision = Boolean(
        snapshot?.codeReview?.reviewCompletedAt
        && snapshot?.codeReview?.requestRevision === false
    );
    const evalRunning = Boolean(
        evaluation?.evalStatus === 'evaluating'
        || (evaluation?.evalSession && evaluation.evalSession.running)
        || autoState.evalTriggered
    );
    const evalComplete = Boolean(
        evaluation?.winnerAgent
        || snapshot?.winnerAgentId
        || autoState.closeTriggered
        || currentStage === 'done'
    );
    const closeRunning = Boolean(
        autoState.closeTriggered
        || snapshot?.lifecycle === LifecycleState.CLOSING
    );
    const closeComplete = Boolean(
        currentStage === 'done'
        || snapshot?.currentSpecState === 'done'
        || snapshot?.lifecycle === 'done'
        || autoState.status === 'completed'
    );

    const signals = {
        implementReady,
        implementFailed,
        reviewRunning,
        reviewComplete,
        feedbackAddressed,
        reviewApprovedNoRevision,
        evalRunning,
        evalComplete,
        closeRunning,
        closeComplete,
    };
    const { progressIndex, currentStatus } = computeAutonomousProgressIndex(
        resolved.stages, signals, autoState, snapshot,
    );

    const stages = resolved.stages.map((rawStage, index) => {
        const type = rawStage.type;
        const agents = Array.isArray(rawStage.agents)
            ? rawStage.agents.map(agent => workflowDefinitions.normalizeStageAgent(agent))
            : [];
        let status;
        if (index < progressIndex) status = 'complete';
        else if (index === progressIndex) status = currentStatus;
        else status = 'waiting';

        return {
            key: `${type}-${index}`,
            type,
            label: AUTONOMOUS_STAGE_LABELS[type] || type,
            status,
            agents: agents.map(agent => ({
                id: agent.id,
                model: agent.model,
                effort: agent.effort,
            })),
        };
    });

    return {
        workflowSlug: resolved.workflowSlug,
        workflowLabel: resolved.workflowLabel,
        source: resolved.source,
        mode: autoState.mode || null,
        controllerStatus: autoState.status || null,
        stages,
    };
}

function getFeatureDashboardState(repoPath, featureId, currentStage, agents, options) {
    // F460: callers (e.g. dashboard-status-collector) that resolve the read-model
    // twice per row — first to discover stage, then again with built agents —
    // can pass `options.baseState` from the first call to skip a second
    // snapshot+events read. The base state is invariant across the
    // empty-agents → full-agents bridge.
    const baseState = (options && options.baseState)
        ? options.baseState
        : getBaseDashboardState('feature', repoPath, featureId, currentStage);
    const snapshot = baseState.workflowSnapshot;
    const actionContext = snapshot ? { ...snapshot, specDrift: baseState.specDrift } : snapshot;
    const specReviewSessions = readSpecReviewSessions(repoPath, 'feature', featureId, baseState.stage, snapshot);
    const specCheckSessions = readSpecCheckSessions(repoPath, 'feature', featureId, baseState.stage, snapshot);
    const specRevisionSessions = specCheckSessions;

    // Compute review + eval state first so we can enrich the context
    const repoBaseName = path.basename(repoPath);
    const review = snapshot
        ? { ...deriveReviewStateFromSnapshot(repoPath, featureId, `${repoBaseName}-f`, baseState.stage, snapshot), reviewState: { current: null, history: [] } }
        : { reviewStatus: null, reviewSessions: [], reviewState: { current: null, history: [] } };
    const evaluation = snapshot ? readFeatureEvalState(repoPath, featureId, baseState.stage, snapshot) : {
        evalStatus: null,
        winnerAgent: null,
        evalPath: null,
        evalSession: null,
    };
    // Read the auto sidecar once. The controller DTO must surface even for
    // `done` features (a `completed`/`failed` controller is still meaningful),
    // but the action/plan derivation below must keep its original
    // `stage !== 'done'` gate — feeding a non-null autoState into
    // buildAutonomousStagePlan / the action appenders for done features would
    // change autonomousPlan + action-menu behavior, both out of scope here.
    const controllerAutoState = readFeatureAutoState(repoPath, featureId);
    const autoState = baseState.stage !== 'done' ? controllerAutoState : null;
    const autonomousController = buildAutonomousController(controllerAutoState, (sessionName) => tmuxSessionExists(sessionName), snapshot);

    // Enrich snapshot with infra data for unified action derivation
    const enrichedSnapshot = enrichSnapshotWithInfraData(actionContext, agents, {
        evalPath: evaluation.evalPath,
        evalSession: evaluation.evalSession,
        reviewSessions: review.reviewSessions,
        reviewStatus: review.reviewStatus,
    });

    const snapshotActions = snapshot
        ? workflowSnapshotAdapter.snapshotToDashboardActions('feature', featureId, enrichedSnapshot, baseState.stage)
        : { nextAction: null, nextActions: [], validActions: [] };
    const quotaMerged = snapshot
        ? appendQuotaPausedDashboardActions(repoPath, 'feature', featureId, enrichedSnapshot, agents, snapshotActions.validActions)
        : baseState.validActions;
    let escalationMerged = snapshot
        ? appendEscalationDashboardActions(featureId, snapshot, quotaMerged)
        : quotaMerged;
    if (snapshot && failoverActionAppenders.length > 0) {
        for (const appender of failoverActionAppenders) {
            try { escalationMerged = appender(repoPath, 'feature', featureId, enrichedSnapshot, agents, escalationMerged); } catch (_) { /* ignore appender errors */ }
        }
    }
    const autonomousMerged = snapshot
        ? appendFeatureAutonomousDashboardActions(repoPath, featureId, autoState, escalationMerged)
        : escalationMerged;
    const recoveryMerged = snapshot
        ? appendFeatureReviewRecoveryDashboardActions(repoPath, featureId, autoState, snapshot, autonomousMerged, autonomousController)
        : autonomousMerged;
    const quotaNext = snapshot && recoveryMerged.length > 0
        ? { command: recoveryMerged[0].command, reason: recoveryMerged[0].reason }
        : null;
    return appendReadModelFlags({
        ...baseState,
        nextAction: snapshot ? (quotaNext || snapshotActions.nextAction) : baseState.nextAction,
        nextActions: snapshot ? recoveryMerged : baseState.nextActions,
        validActions: snapshot ? recoveryMerged : baseState.validActions,
        winnerAgentId: snapshot ? snapshot.winnerAgentId || null : null,
        winnerAgent: evaluation.winnerAgent || (snapshot ? snapshot.winnerAgentId : null) || null,
        evalStatus: evaluation.evalStatus,
        evalPath: evaluation.evalPath,
        evalSession: evaluation.evalSession,
        reviewStatus: review.reviewStatus,
        reviewSessions: review.reviewSessions,
        specReviewSessions,
        specRevisionSessions,
        specCheckSessions,
        reviewState: review.reviewState,
        autonomousPlan: buildAutonomousStagePlan({
            repoPath,
            featureId,
            currentStage: baseState.stage,
            snapshot,
            dashboardAgents: agents,
            autoState,
            review,
            evaluation,
        }),
        autonomousController,
        nudges: snapshot && Array.isArray(snapshot.nudges) ? snapshot.nudges.slice() : [],
    });
}

function getResearchDashboardState(repoPath, researchId, currentStage, agents, options) {
    // F460: see getFeatureDashboardState — `options.baseState` lets the
    // collector reuse a prior baseState across the empty-agents → full-agents
    // bridge to avoid a duplicated snapshot+events read.
    const baseState = (options && options.baseState)
        ? options.baseState
        : getBaseDashboardState('research', repoPath, researchId, currentStage);
    const snapshot = baseState.workflowSnapshot;
    const actionContext = snapshot ? { ...snapshot, specDrift: baseState.specDrift } : snapshot;
    const specReviewSessions = readSpecReviewSessions(repoPath, 'research', researchId, baseState.stage, snapshot);
    const specCheckSessions = readSpecCheckSessions(repoPath, 'research', researchId, baseState.stage, snapshot);
    const specRevisionSessions = specCheckSessions;

    // Compute review + eval state first so we can enrich the context
    const resRepoBaseName = path.basename(repoPath);
    const review = snapshot
        ? { ...deriveReviewStateFromSnapshot(repoPath, researchId, `${resRepoBaseName}-r`, baseState.stage, snapshot), reviewState: { current: null, history: [] } }
        : { reviewStatus: null, reviewSessions: [], reviewState: { current: null, history: [] } };
    const evaluation = snapshot ? readResearchEvalState(repoPath, researchId, baseState.stage, snapshot) : {
        evalStatus: null,
        evalSession: null,
    };

    // Enrich snapshot with infra data (findings, flags) and review/eval data for unified action derivation
    const enrichedSnapshot = enrichSnapshotWithInfraData(actionContext, agents, {
        evalSession: evaluation.evalSession,
        reviewSessions: review.reviewSessions,
    });

    const snapshotActions = snapshot
        ? workflowSnapshotAdapter.snapshotToDashboardActions('research', researchId, enrichedSnapshot, baseState.stage)
        : { nextAction: null, nextActions: [], validActions: [] };
    const quotaMergedResearch = snapshot
        ? appendQuotaPausedDashboardActions(repoPath, 'research', researchId, enrichedSnapshot, agents, snapshotActions.validActions)
        : baseState.validActions;
    const recoveryMergedResearch = snapshot
        ? appendResearchReviewRecoveryDashboardActions(snapshot, quotaMergedResearch)
        : quotaMergedResearch;
    const quotaNextResearch = snapshot && recoveryMergedResearch.length > 0
        ? { command: recoveryMergedResearch[0].command, reason: recoveryMergedResearch[0].reason }
        : null;
    return appendReadModelFlags({
        ...baseState,
        nextAction: snapshot ? (quotaNextResearch || snapshotActions.nextAction) : baseState.nextAction,
        nextActions: snapshot ? recoveryMergedResearch : baseState.nextActions,
        validActions: snapshot ? recoveryMergedResearch : baseState.validActions,
        evalStatus: evaluation.evalStatus,
        evalSession: evaluation.evalSession,
        reviewStatus: review.reviewStatus,
        reviewSessions: review.reviewSessions,
        specReviewSessions,
        specRevisionSessions,
        specCheckSessions,
        reviewState: review.reviewState,
        nudges: snapshot && Array.isArray(snapshot.nudges) ? snapshot.nudges.slice() : [],
    });
}


function readFeatureEvalState(repoPath, featureId, currentStage, snapshot) {
    let evalStatus = null;
    let winnerAgent = snapshot && snapshot.winnerAgentId ? snapshot.winnerAgentId : null;
    let evalPath = null;
    let evalSession = null;

    const lifecycle = snapshot && snapshot.lifecycle ? snapshot.lifecycle : null;

    // `closing` maps to the in-evaluation kanban column/folder but is not fleet
    // evaluation — solo close must not surface evalStatus "evaluating".
    if (lifecycle === LifecycleState.CLOSING) {
        return {
            evalStatus: null,
            winnerAgent: snapshot && snapshot.winnerAgentId ? snapshot.winnerAgentId : null,
            evalPath: null,
            evalSession: null,
        };
    }

    const isInEvaluation = currentStage === 'in-evaluation'
        || lifecycle === LifecycleState.EVALUATING
        || lifecycle === LifecycleState.READY_FOR_REVIEW;

    if (isInEvaluation && featureId) {
        evalStatus = 'evaluating';
        const evalFile = path.join(repoPath, 'docs', 'specs', 'features', 'evaluations', `feature-${featureId}-eval.md`);
        if (fs.existsSync(evalFile)) {
            evalPath = evalFile;
            try {
                const content = fs.readFileSync(evalFile, 'utf8');
                const winnerMatch = content.match(/\*\*Winner[:\s]*\*?\*?\s*(.+)/i);
                if (winnerMatch) {
                    const value = winnerMatch[1].replace(/\*+/g, '').trim();
                    if (value && !value.includes('to be determined') && !value.includes('TBD') && value !== '()') {
                        evalStatus = 'pick winner';
                        winnerAgent = value.split(/[\s(]/)[0].toLowerCase() || winnerAgent;
                    }
                }
            } catch (_) { /* ignore */ }
        }
    }

    if (currentStage === 'in-evaluation' && featureId) {
        const repoBaseName = path.basename(repoPath);
        const evalPrefix = `${repoBaseName}-f${toUnpaddedId(featureId)}-eval`;
        evalSession = findFirstTmuxSessionByPrefix(evalPrefix, session => {
            const parsed = parseTmuxSessionName(session);
            const evalAgent = parsed && parsed.role === 'eval' && parsed.agent ? parsed.agent : null;
            return { session, agent: evalAgent, running: tmuxSessionExists(session) };
        });
    }

    return { evalStatus, winnerAgent, evalPath, evalSession };
}

function readResearchEvalState(repoPath, researchId, currentStage, snapshot) {
    let evalStatus = null;
    let evalSession = null;

    const lifecycle = snapshot && snapshot.lifecycle ? snapshot.lifecycle : null;
    const isInEvaluation = currentStage === 'in-evaluation'
        || lifecycle === LifecycleState.EVALUATING;

    if (isInEvaluation && researchId) {
        evalStatus = 'evaluating';
        const repoBaseName = path.basename(repoPath);
        const evalPrefix = `${repoBaseName}-r${toUnpaddedId(researchId)}-eval`;
        evalSession = findFirstTmuxSessionByPrefix(evalPrefix, session => {
            let evalAgent = null;
            const parsed = parseTmuxSessionName(session);
            if (parsed && parsed.role === 'eval' && parsed.agent) evalAgent = parsed.agent;
            return { session, agent: evalAgent, running: tmuxSessionExists(session) };
        });
    }

    return { evalStatus, evalSession };
}


function withSpecReviewSessionRunning(row) {
    const session = row.session;
    return {
        ...row,
        sessionRunning: Boolean(session && tmuxSessionExists(session)),
    };
}

function readSpecReviewSessions(repoPath, entityType, entityId, currentStage, snapshot) {
    const isActiveStage = currentStage === 'inbox' || currentStage === 'backlog';
    if (!isActiveStage || !entityId || !snapshot || !snapshot.specReview) return [];

    const { activeReviewers = [], pendingReviews = [] } = snapshot.specReview;

    const active = activeReviewers
        .filter(entry => entry && entry.agentId)
        // A reviewer that's already submitted is in pendingReviews — exclude from active.
        .filter(entry => !pendingReviews.some(review => review && review.reviewerId === entry.agentId))
        .map(entry => withSpecReviewSessionRunning({
            session: findSpecReviewTmuxSession(repoPath, entityType, entityId, 'spec-review', entry.agentId),
            agent: entry.agentId,
            running: true,
            status: 'reviewing',
            source: 'active-reviewer',
            startedAt: entry.startedAt || null,
        }));

    const pending = pendingReviews
        .filter(review => review && review.reviewerId)
        .map(review => withSpecReviewSessionRunning({
            session: findSpecReviewTmuxSession(repoPath, entityType, entityId, 'spec-review', review.reviewerId),
            agent: review.reviewerId,
            running: false,
            status: 'pending',
            source: 'pending-review',
            reviewId: review.reviewId || null,
            summary: review.summary || '',
            submittedAt: review.submittedAt || null,
            commitSha: review.commitSha || null,
        }));

    return [...active, ...pending].sort((left, right) => {
        if (left.running !== right.running) return left.running ? -1 : 1;
        return String(left.agent || '').localeCompare(String(right.agent || ''));
    });
}

function readSpecCheckSessions(repoPath, entityType, entityId, currentStage, snapshot) {
    const isActiveStage = currentStage === 'inbox' || currentStage === 'backlog';
    if (!isActiveStage || !entityId || !snapshot || !snapshot.specReview) return [];

    const { activeCheckers = [] } = snapshot.specReview;
    return activeCheckers
        .filter(entry => entry && entry.agentId)
        .map(entry => withSpecReviewSessionRunning({
            session: findSpecReviewTmuxSession(repoPath, entityType, entityId, 'spec-revise', entry.agentId)
                || findSpecReviewTmuxSession(repoPath, entityType, entityId, 'spec-check', entry.agentId),
            agent: entry.agentId,
            running: true,
            status: 'addressing-spec-review',
            source: 'active-checker',
            startedAt: entry.startedAt || null,
        }))
        .sort((left, right) => String(left.agent || '').localeCompare(String(right.agent || '')));
}

module.exports = {
    WORKFLOW_SOURCE,
    detectMissingMigration,
    listWorkflowEntityIds,
    getFeatureDashboardState,
    getResearchDashboardState,
    readFeatureEvalState,
    readResearchEvalState,
    buildAutonomousController,
    reconcileAutonomousRecovery,
    readSpecReviewSessions,
    readSpecCheckSessions,
    findSpecReviewTmuxSession,
    registerFailoverActionAppender,
};
