'use strict';

const { deriveAvailableActions } = require('./workflow-core');
const { snapshotToDashboardActions } = require('./workflow-snapshot-adapter');
const { FEATURE_INTERACTION_DEFINITION } = require('./feature-workflow-rules');
const { RESEARCH_INTERACTION_DEFINITION } = require('./research-workflow-rules');
const { getStateRenderMeta } = require('./state-render-meta');
const { buildFeatureUiContract } = require('./feature-ui-contract');
const { buildResearchUiContract } = require('./research-ui-contract');
const { buildSetValidActions } = require('./feature-set-workflow-rules');
const { buildFeatureSetUiContract } = require('./feature-set-ui-contract');
const { appendQuotaPausedDashboardActions } = require('./quota-dashboard-actions');
const { appendEscalationDashboardActions } = require('./feature-escalation-dashboard-actions');
const { appendFeatureAutonomousDashboardActions } = require('./feature-autonomous-dashboard-actions');
const {
    appendFeatureReviewRecoveryDashboardActions,
    appendResearchReviewRecoveryDashboardActions,
} = require('./feature-review-recovery-dashboard-actions');

const GALLERY_REPO_PATH = __dirname;
const FIXED_TIME = '2026-07-14T04:00:00.000Z';

const FEATURE_DEFINITION = FEATURE_INTERACTION_DEFINITION;
const RESEARCH_DEFINITION = RESEARCH_INTERACTION_DEFINITION;

function stageForState(state) {
    if (state === 'inbox' || state === 'backlog' || state === 'paused' || state === 'done') return state;
    if (state === 'evaluating' || state === 'ready_for_review' || state === 'closing') return 'in-evaluation';
    return 'in-progress';
}

function modeLabel(mode) {
    return mode === 'fleet' ? 'Fleet' : 'Solo';
}

function baseAgent(status, overrides = {}) {
    return {
        status,
        model: 'claude-sonnet-4-5',
        updatedAt: FIXED_TIME,
        ...overrides,
    };
}

function defaultAgents(state, mode) {
    if (['inbox', 'backlog', 'done'].includes(state)) return {};
    const active = new Set([
        'spec_review_in_progress',
        'spec_revision_in_progress',
        'implementing',
        'code_revision_in_progress',
    ]);
    const status = active.has(state) ? 'running' : 'ready';
    const ids = mode === 'fleet' ? ['cc', 'cx'] : ['cc'];
    return Object.fromEntries(ids.map(id => [id, baseAgent(status)]));
}

function makeContext(entityType, state, mode, overrides = {}) {
    const idKey = entityType === 'feature' ? 'featureId' : 'researchId';
    const agents = overrides.agents || defaultAgents(state, mode);
    const context = {
        entityType,
        [idKey]: entityType === 'feature' ? '675' : '204',
        currentSpecState: state,
        lifecycle: state,
        mode,
        agents,
        winnerAgentId: state === 'ready_for_review' ? Object.keys(agents)[0] || 'cc' : null,
        tmuxSessionStates: Object.fromEntries(Object.keys(agents).map(id => [id, 'running'])),
        updatedAt: FIXED_TIME,
        ...overrides,
    };
    delete context.gallery;
    return context;
}

function stateScenario(entityType, state, options = {}) {
    const fleetOnly = state === 'evaluating' || (entityType === 'feature' && state === 'ready_for_review');
    const mode = options.mode || (fleetOnly ? 'fleet' : 'solo_worktree');
    return {
        key: options.key || `${entityType}-${state}-${mode}`,
        entityType,
        state,
        mode,
        scenario: options.scenario || getStateRenderMeta(state).label,
        detail: options.detail || null,
        severity: options.severity || null,
        context: makeContext(entityType, state, mode, options.context || {}),
        gallery: options.gallery || {},
    };
}

function baseStateScenarios(entityType, definition) {
    return Object.keys(definition.states)
        .filter(state => state !== 'hydrating' && !definition.transientStates.has(state))
        .map(state => stateScenario(entityType, state));
}

function buildPlan(stages, currentType, currentStatus) {
    const currentIndex = stages.findIndex(stage => stage.type === currentType);
    return {
        controllerStatus: currentStatus === 'stopped' ? 'stopped' : 'running',
        stages: stages.map((stage, index) => ({
            ...stage,
            key: `${stage.type}-${index}`,
            status: index < currentIndex ? 'complete'
                : (index === currentIndex ? (currentStatus === 'stopped' ? 'waiting' : currentStatus) : 'waiting'),
        })),
    };
}

function autonomousPlan(currentType, currentStatus) {
    return buildPlan([
        { type: 'implement', label: 'Implement', agents: [{ id: 'cc' }] },
        { type: 'review', label: 'Review', agents: [{ id: 'cx' }] },
        { type: 'revision', label: 'Revise if needed', agents: [{ id: 'cc' }] },
        { type: 'close', label: 'Close', agents: [] },
    ], currentType, currentStatus);
}

function autonomousFleetPlan(currentType, currentStatus) {
    return buildPlan([
        { type: 'implement', label: 'Implement in parallel', agents: [{ id: 'cc' }, { id: 'cx' }] },
        { type: 'eval', label: 'Evaluate', agents: [{ id: 'cu' }] },
        { type: 'close', label: 'Close', agents: [] },
    ], currentType, currentStatus);
}

function session(sessionName, agentId, role, label, status = 'running') {
    return {
        sessionName,
        agentId,
        role,
        label,
        status,
        running: status === 'running',
        inspectable: true,
        consoleAvailable: true,
    };
}

function sessionsForScenario(spec) {
    if (Array.isArray(spec.gallery.sessions)) return spec.gallery.sessions;
    if (spec.gallery.autonomousPlan && Array.isArray(spec.gallery.autonomousPlan.stages)) {
        const roleByType = {
            implement: spec.entityType === 'research' ? 'research' : 'implementation',
            review: 'code-review',
            revision: 'code-revision',
            eval: 'evaluation',
            close: 'close',
        };
        const planSessions = spec.gallery.autonomousPlan.stages
            .filter(stage => stage.status !== 'waiting')
            .map((stage) => {
                const agent = stage.agents && stage.agents[0];
                return {
                    ...session(
                        `${spec.entityType}-${spec.key}-${stage.type}`,
                        agent && agent.id || null,
                        roleByType[stage.type] || stage.type,
                        stage.label,
                        stage.status === 'complete' ? 'complete' : stage.status,
                    ),
                    stageType: stage.type,
                };
            });
        if (spec.gallery.autonomousController && spec.gallery.autonomousController.sessionRunning) {
            planSessions.push(session(`feature-${spec.key}-auto`, null, 'autonomous', 'Autonomous controller'));
        }
        return planSessions;
    }
    const sessions = [];
    const agents = spec.context.agents || {};
    const activeAgents = Object.entries(agents).filter(([, agent]) => ['running', 'idle', 'waiting', 'researching'].includes(agent.status));
    if (spec.state === 'implementing') {
        activeAgents.forEach(([id]) => sessions.push(session(
            `${spec.entityType}-${spec.key}-${id}`,
            id,
            spec.entityType === 'research' ? 'research' : 'implementation',
            spec.entityType === 'research' ? 'Researching' : 'Implementing',
        )));
    } else if (spec.state === 'spec_review_in_progress') {
        sessions.push(session(`${spec.entityType}-${spec.key}-spec-review`, 'cx', 'spec-review', 'Reviewing spec'));
    } else if (spec.state === 'spec_revision_in_progress') {
        sessions.push(session(`${spec.entityType}-${spec.key}-spec-revision`, 'cc', 'spec-revision', 'Revising spec'));
    } else if (spec.state === 'code_review_in_progress' && spec.key !== 'feature-review-session-lost') {
        sessions.push(session(`${spec.entityType}-${spec.key}-review`, 'cx', 'review', spec.entityType === 'research' ? 'Reviewing findings' : 'Reviewing code'));
    } else if (spec.state === 'code_revision_in_progress') {
        sessions.push(session(`${spec.entityType}-${spec.key}-revision`, 'cc', 'revision', 'Addressing review'));
    } else if (spec.state === 'evaluating') {
        sessions.push(session(`${spec.entityType}-${spec.key}-eval`, 'cu', 'evaluation', 'Evaluating'));
    }
    if (spec.gallery.autonomousController && spec.gallery.autonomousController.sessionRunning) {
        sessions.push(session(`feature-${spec.key}-auto`, null, 'autonomous', 'Autonomous run'));
    }
    return sessions;
}

function featureVariants() {
    const readySolo = { cc: baseAgent('ready') };
    const readyFleet = { cc: baseAgent('ready'), cx: baseAgent('ready') };
    return [
        stateScenario('feature', 'backlog', {
            key: 'feature-backlog-blocked',
            scenario: 'Blocked by dependencies',
            detail: 'Start is visible but unavailable until F672 is done.',
            context: { agents: {} },
            gallery: { blockedBy: [{ id: '672', name: 'Dashboard security boundary' }] },
        }),
        stateScenario('feature', 'backlog', {
            key: 'feature-backlog-review-feedback',
            scenario: 'Spec feedback waiting',
            detail: 'Revision takes priority over starting implementation.',
            context: {
                agents: {},
                specReview: { pendingCount: 1, pendingAgents: ['cx'] },
            },
            gallery: { pendingSpecReview: true },
        }),
        stateScenario('feature', 'implementing', {
            key: 'feature-implementing-ready-solo',
            scenario: 'Implementation complete',
            detail: 'Close is the primary decision. Code review remains optional.',
            context: { agents: readySolo },
        }),
        stateScenario('feature', 'implementing', {
            key: 'feature-fleet-in-progress',
            scenario: 'Two implementations in progress',
            detail: 'Both Fleet agents are actively implementing in separate worktrees.',
            mode: 'fleet',
            context: {
                agents: {
                    cc: baseAgent('running'),
                    cx: baseAgent('running'),
                },
            },
        }),
        stateScenario('feature', 'implementing', {
            key: 'feature-implementing-ready-fleet',
            scenario: 'Fleet implementations complete',
            detail: 'Evaluation replaces solo close and review actions.',
            mode: 'fleet',
            context: { agents: readyFleet },
        }),
        stateScenario('feature', 'implementing', {
            key: 'feature-agent-needs-attention',
            scenario: 'Agent needs recovery',
            detail: 'One Fleet agent failed while another is still running.',
            severity: 'error',
            mode: 'fleet',
            context: {
                agents: {
                    cc: baseAgent('failed'),
                    cx: baseAgent('running'),
                },
            },
        }),
        stateScenario('feature', 'implementing', {
            key: 'feature-session-ended',
            scenario: 'Implementation session ended early',
            detail: 'Recovery and inspection tools come from agent runtime facts.',
            severity: 'warning',
            context: {
                agents: {
                    cc: baseAgent('running', {
                        flags: { sessionEnded: true },
                        devServerPokeEligible: true,
                    }),
                },
                specDrift: { actualStage: 'backlog', expectedStage: 'in-progress' },
            },
        }),
        stateScenario('feature', 'implementing', {
            key: 'feature-quota-paused',
            scenario: 'One Fleet agent is quota paused',
            detail: 'CC is paused until its quota resets while CX is still implementing.',
            severity: 'warning',
            mode: 'fleet',
            context: {
                agents: {
                    cc: baseAgent('quota-paused'),
                    cx: baseAgent('running'),
                },
            },
            gallery: {
                dashboardAgents: [
                    { id: 'cc', status: 'quota-paused', quotaPausedResetAt: '2026-07-14T06:00:00.000Z' },
                    { id: 'cx', status: 'running' },
                ],
                quotaPaused: true,
            },
        }),
        stateScenario('feature', 'implementing', {
            key: 'feature-token-exhausted',
            scenario: 'Agent token window exhausted',
            detail: 'Switch to the next configured agent or restart the current one.',
            severity: 'warning',
            context: {
                agents: {
                    cc: baseAgent('failed', { tokenExhausted: true }),
                },
                agentFailover: { chain: ['cc', 'cx'] },
            },
        }),
        stateScenario('feature', 'code_review_in_progress', {
            key: 'feature-review-session-lost',
            scenario: 'Review did not complete',
            detail: 'The reviewer session exited without recording a review result. Cancel or re-run the review.',
            severity: 'error',
            context: { agents: readySolo },
            gallery: {
                sessions: [session('feature-review-session-lost-review', 'cx', 'code-review', 'Review session', 'lost')],
            },
        }),
        stateScenario('feature', 'code_review_in_progress', {
            key: 'feature-autonomous-review-failed',
            scenario: 'Autonomous reviewer exited early',
            detail: 'The autonomous run reached review, but the reviewer exited without recording a result.',
            severity: 'error',
            context: { agents: readySolo },
            gallery: {
                autoState: { status: 'failed', running: false, agents: ['cc'], reason: 'review-session-lost' },
                autonomousPlan: autonomousPlan('review', 'failed'),
                autonomousController: {
                    status: 'failed',
                    running: false,
                    reason: 'review-session-lost',
                    reasonLabel: 'The review session ended without a completion signal.',
                    recommendedRecoveryKind: 'cancel-review',
                },
            },
        }),
        stateScenario('feature', 'ready', {
            key: 'feature-autonomous-stopped',
            scenario: 'Autonomous run stopped by operator',
            detail: 'Implementation is complete. Resume the run at review or continue manually.',
            severity: 'error',
            context: {
                agents: readySolo,
                codeReview: { cancelledAt: FIXED_TIME },
            },
            gallery: {
                autoState: { status: 'stopped', running: false, agents: ['cc'] },
                autonomousPlan: autonomousPlan('review', 'stopped'),
                autonomousController: {
                    status: 'stopped',
                    running: false,
                    reason: 'operator-stopped',
                    reasonLabel: 'Automation was stopped before review.',
                    recommendedRecoveryKind: 'resume-automation',
                },
            },
        }),
        stateScenario('feature', 'implementing', {
            key: 'feature-autonomous-running',
            scenario: 'Autonomous run during implementation',
            detail: 'Current stage: Implement. Review, revision, and close are still ahead.',
            context: { agents: { cc: baseAgent('running') } },
            gallery: {
                autoState: { status: 'running', running: true, agents: ['cc'] },
                autonomousPlan: autonomousPlan('implement', 'running'),
                autonomousController: { status: 'running', running: true, sessionRunning: true },
            },
        }),
        stateScenario('feature', 'code_review_in_progress', {
            key: 'feature-autonomous-reviewing',
            scenario: 'Autonomous run during review',
            detail: 'Current stage: Review. Implementation is complete; CX is reviewing before any revision or close.',
            context: { agents: readySolo, codeReview: { reviewerId: 'cx', activeReviewerId: 'cx' } },
            gallery: {
                autoState: { status: 'running', running: true, agents: ['cc'], reviewAgent: 'cx' },
                autonomousPlan: autonomousPlan('review', 'running'),
                autonomousController: { status: 'running', running: true, sessionRunning: true },
            },
        }),
        stateScenario('feature', 'code_revision_in_progress', {
            key: 'feature-autonomous-revising',
            scenario: 'Autonomous run during revision',
            detail: 'Current stage: Revise if needed. CC is addressing review feedback.',
            context: { agents: { cc: baseAgent('running') } },
            gallery: {
                autoState: { status: 'running', running: true, agents: ['cc'], reviewAgent: 'cx' },
                autonomousPlan: autonomousPlan('revision', 'running'),
                autonomousController: { status: 'running', running: true, sessionRunning: true },
            },
        }),
        stateScenario('feature', 'closing', {
            key: 'feature-autonomous-closing',
            scenario: 'Autonomous run during close',
            detail: 'Current stage: Close. Implementation and review are complete.',
            context: { agents: readySolo },
            gallery: {
                autoState: { status: 'running', running: true, agents: ['cc'], reviewAgent: 'cx', closeTriggered: true },
                autonomousPlan: autonomousPlan('close', 'running'),
                autonomousController: { status: 'running', running: true, sessionRunning: true },
            },
        }),
        stateScenario('feature', 'implementing', {
            key: 'feature-autonomous-fleet-running',
            scenario: 'Autonomous Fleet run during implementation',
            detail: 'Current stage: Implement in parallel. Evaluation and close follow.',
            mode: 'fleet',
            context: { agents: { cc: baseAgent('running'), cx: baseAgent('running') } },
            gallery: {
                autoState: { status: 'running', running: true, agents: ['cc', 'cx'], evalAgent: 'cu' },
                autonomousPlan: autonomousFleetPlan('implement', 'running'),
                autonomousController: { status: 'running', running: true, sessionRunning: true },
            },
        }),
        stateScenario('feature', 'evaluating', {
            key: 'feature-autonomous-fleet-evaluating',
            scenario: 'Autonomous Fleet run during evaluation',
            detail: 'Current stage: Evaluate. CU is comparing both implementations before close.',
            mode: 'fleet',
            context: { agents: readyFleet, evalSession: { running: true, agent: 'cu' } },
            gallery: {
                autoState: { status: 'running', running: true, agents: ['cc', 'cx'], evalAgent: 'cu' },
                autonomousPlan: autonomousFleetPlan('eval', 'running'),
                autonomousController: { status: 'running', running: true, sessionRunning: true },
            },
        }),
        stateScenario('feature', 'ready', {
            key: 'feature-review-escalation',
            scenario: 'Reviewer concern requires a decision',
            detail: 'Accept, create a follow-up, or return the feature for revision.',
            severity: 'warning',
            context: {
                agents: readySolo,
                openEscalations: [{
                    escalationId: 'esc-1',
                    category: 'architectural',
                    reason: 'The persistence boundary needs an explicit owner.',
                }],
            },
            gallery: { escalation: true },
        }),
        stateScenario('feature', 'close_recovery_in_progress', {
            key: 'feature-close-merge-conflict',
            scenario: 'Close blocked by merge conflict',
            detail: 'Resolve the conflict with an agent or reset the feature.',
            severity: 'error',
            context: {
                agents: readySolo,
                lastCloseFailure: { kind: 'merge-conflict', conflictFiles: ['lib/dashboard-server.js'] },
            },
        }),
        stateScenario('feature', 'close_recovery_in_progress', {
            key: 'feature-close-gate-failed',
            scenario: 'Post-merge gate failed',
            detail: 'Fix the merged main branch, then retry close.',
            severity: 'error',
            context: {
                agents: readySolo,
                lastCloseFailure: { kind: 'post-merge-gate', command: 'project-defined gate' },
            },
        }),
        stateScenario('feature', 'evaluating', {
            key: 'feature-evaluation-session-running',
            scenario: 'Evaluation session running',
            detail: 'Evaluation and review launch actions are suppressed while it runs.',
            mode: 'fleet',
            context: {
                agents: readyFleet,
                evalPath: '/tmp/evaluation.md',
                evalSession: { running: true, agent: 'cx' },
            },
        }),
    ];
}

function researchVariants() {
    const readySolo = { cc: baseAgent('ready', { findingsPath: '/tmp/research-204-cc.md' }) };
    const readyFleet = {
        cc: baseAgent('ready', { findingsPath: '/tmp/research-204-cc.md' }),
        cx: baseAgent('ready', { findingsPath: '/tmp/research-204-cx.md' }),
    };
    return [
        stateScenario('research', 'backlog', {
            key: 'research-backlog-review-feedback',
            scenario: 'Research brief feedback waiting',
            detail: 'Revise the brief before starting the investigation.',
            context: {
                agents: {},
                specReview: { pendingCount: 1, pendingAgents: ['cx'] },
            },
        }),
        stateScenario('research', 'implementing', {
            key: 'research-findings-ready-solo',
            scenario: 'Research complete',
            detail: 'Close is available immediately; reviewing findings is optional.',
            context: { agents: readySolo },
        }),
        stateScenario('research', 'implementing', {
            key: 'research-fleet-in-progress',
            scenario: 'Two investigations in progress',
            detail: 'Both Fleet agents are actively researching the same brief independently.',
            mode: 'fleet',
            context: {
                agents: {
                    cc: baseAgent('running'),
                    cx: baseAgent('running'),
                },
            },
        }),
        stateScenario('research', 'implementing', {
            key: 'research-findings-ready-fleet',
            scenario: 'Fleet research complete',
            detail: 'Start evaluation before choosing what to keep.',
            mode: 'fleet',
            context: { agents: readyFleet },
        }),
        stateScenario('research', 'implementing', {
            key: 'research-agent-needs-attention',
            scenario: 'Research agent failed',
            detail: 'Restart, force ready, or drop the failed Fleet agent.',
            severity: 'error',
            mode: 'fleet',
            context: {
                agents: {
                    cc: baseAgent('lost'),
                    cx: baseAgent('running'),
                },
            },
        }),
        stateScenario('research', 'implementing', {
            key: 'research-session-ended',
            scenario: 'Research session ended',
            detail: 'Inspect partial findings before marking the research complete or reopening.',
            severity: 'warning',
            context: {
                agents: {
                    cc: baseAgent('running', {
                        findingsPath: '/tmp/research-204-cc.md',
                        flags: { sessionEnded: true },
                    }),
                },
                specDrift: { actualStage: 'backlog', expectedStage: 'in-progress' },
            },
        }),
        stateScenario('research', 'implementing', {
            key: 'research-quota-paused',
            scenario: 'One research agent is quota paused',
            detail: 'CC is paused until its quota resets while CX is still researching.',
            severity: 'warning',
            mode: 'fleet',
            context: { agents: { cc: baseAgent('quota-paused'), cx: baseAgent('running') } },
            gallery: {
                dashboardAgents: [
                    { id: 'cc', status: 'quota-paused', quotaPausedResetAt: '2026-07-14T06:00:00.000Z' },
                    { id: 'cx', status: 'running' },
                ],
                quotaPaused: true,
            },
        }),
        stateScenario('research', 'ready', {
            key: 'research-review-cancelled',
            scenario: 'Findings review cancelled',
            detail: 'Re-run the review or close without another review.',
            severity: 'warning',
            context: {
                agents: readySolo,
                codeReview: { cancelledAt: FIXED_TIME },
            },
        }),
        stateScenario('research', 'evaluating', {
            key: 'research-evaluation-session-running',
            scenario: 'Research evaluation running',
            detail: 'Open the live evaluation session or inspect the completed findings.',
            mode: 'fleet',
            context: {
                agents: readyFleet,
                evalSession: { running: true, agent: 'cx' },
            },
        }),
    ];
}

function setMembers(currentId = null, failedId = null, completedIds = [], currentStatus = 'running') {
    const completed = new Set(completedIds.map(String));
    const statusFor = (id) => {
        if (completed.has(id)) return 'complete';
        if (failedId === id) return 'failed';
        if (currentId === id) return currentStatus;
        return 'waiting';
    };
    return [
        { id: '681', name: 'Persist run checkpoints', status: statusFor('681') },
        { id: '682', name: 'Recover interrupted runs', status: statusFor('682') },
        { id: '683', name: 'Expose recovery controls', status: statusFor('683'), blockedBy: '682' },
    ];
}

function buildSetCurrentFeatureContract(options) {
    if (!options.currentFeature) return null;
    const memberStatus = options.currentMemberStatus || 'running';
    const failed = memberStatus === 'failed';
    const lifecycle = failed ? 'implementing' : (memberStatus === 'stopped' ? 'ready' : 'implementing');
    const running = memberStatus === 'running';
    const workerSession = {
        ...session(
        `feature-${options.currentFeature}-cc`,
        'cc',
        'implementation',
        running ? 'Implementing' : 'Implementation session',
        failed ? 'failed' : (running ? 'running' : 'complete'),
        ),
        stageType: 'implement',
    };
    const plan = autonomousPlan('implement', failed ? 'failed' : (running ? 'running' : 'stopped'));
    return buildFeatureUiContract({
        id: options.currentFeature,
        displayKey: `F${options.currentFeature}`,
        name: 'Recover interrupted runs',
        stage: 'in-progress',
        agents: [{ id: 'cc', status: failed ? 'failed' : (running ? 'running' : 'ready') }],
        sessions: [workerSession],
        validActions: [],
        stateRenderMeta: getStateRenderMeta(lifecycle),
        cardHeadline: { verb: failed ? 'Implementation failed' : (running ? 'Implementing' : 'Implementation complete') },
        cardPresentation: { severity: failed ? 'error' : 'normal' },
        autonomousPlan: plan,
        autonomousController: {
            status: failed ? 'failed' : (running ? 'running' : 'stopped'),
            running,
        },
    }, { currentSpecState: lifecycle, lifecycle });
}

function setScenario(key, scenario, status, options = {}) {
    const autonomous = options.autonomous || (status === 'idle' ? null : {
        status,
        members: ['681', '682', '683'],
        completed: options.completed || [],
        currentFeature: options.currentFeature || null,
    });
    const setState = {
        slug: 'autonomous-recovery',
        status,
        isComplete: Boolean(options.isComplete),
        autonomous,
        inboxMemberCount: options.inboxMemberCount || 0,
        reviewableMemberCount: options.reviewableMemberCount || 0,
        launchableSpecReviewMemberCount: options.launchableSpecReviewMemberCount || 0,
        pendingSpecReviseMemberCount: options.pendingSpecReviseMemberCount || 0,
    };
    const validActions = buildSetValidActions(setState, { requiresPro: false, proAvailable: true });
    const members = options.members || setMembers(
        options.currentFeature,
        options.failedFeature,
        options.completed || [],
        options.currentMemberStatus || 'running',
    );
    const completed = members.filter(member => member.status === 'complete').length;
    const setSessions = options.sessionRunning
        ? [session('set-autonomous-recovery-auto', options.sessionAgentId || null, options.sessionRole || 'set-conductor', options.sessionLabel || 'Set conductor')]
        : [];
    const currentFeatureContract = buildSetCurrentFeatureContract(options);
    // Mirror the production set spec-cycle facts (lib/dashboard-collect/set-cards.js
    // buildSetSpecCycleSummary): status is a workflow fact, never tmux liveness.
    const pendingRevise = Number(options.pendingSpecReviseMemberCount) || 0;
    const launchableReview = Number(options.launchableSpecReviewMemberCount) || 0;
    const specReviewRunning = options.sessionRole === 'set-spec-review';
    const specRevisionRunning = options.sessionRole === 'set-spec-revision';
    const reviewStatus = specReviewRunning ? 'running'
        : (pendingRevise > 0 ? 'feedback-waiting' : (launchableReview > 0 ? 'ready' : 'inactive'));
    const revisionStatus = specRevisionRunning ? 'running' : (pendingRevise > 0 ? 'needed' : 'inactive');
    const specCycle = {
        review: {
            status: reviewStatus,
            label: reviewStatus === 'running' ? 'Spec review: running'
                : reviewStatus === 'feedback-waiting' ? `Spec review: feedback waiting (${pendingRevise})`
                : reviewStatus === 'ready' ? `Spec review: ready (${launchableReview})`
                : 'Spec review: inactive',
            memberCount: 0,
            pendingCount: pendingRevise,
            completedAt: null,
            commitSha: null,
            session: specReviewRunning ? { sessionName: setSessions[0].sessionName, agent: options.sessionAgentId } : null,
        },
        revision: {
            status: revisionStatus,
            label: revisionStatus === 'running' ? 'Spec revision: running'
                : revisionStatus === 'needed' ? `Spec revision: needed (${pendingRevise})`
                : 'Spec revision: inactive',
            memberCount: 0,
            pendingCount: pendingRevise,
            completedAt: null,
            commitSha: null,
            session: specRevisionRunning ? { sessionName: setSessions[0].sessionName, agent: options.sessionAgentId } : null,
        },
    };
    const setCard = {
        slug: 'autonomous-recovery',
        goal: 'Autonomous recovery',
        status,
        isComplete: Boolean(options.isComplete),
        specCycle,
        progress: { merged: completed, total: members.length, percent: members.length ? Math.round((completed / members.length) * 100) : 0 },
        currentFeature: options.currentFeature ? { id: options.currentFeature, label: 'Recover interrupted runs', stage: 'in-progress' } : null,
        currentFeatureContract,
        autonomous: autonomous ? {
            ...autonomous,
            sessionName: setSessions[0] && setSessions[0].sessionName || null,
            running: status === 'running',
        } : null,
        specReview: options.sessionRole === 'set-spec-review' ? {
            sessionName: setSessions[0] && setSessions[0].sessionName,
            agent: options.sessionAgentId,
            running: true,
        } : null,
        specRevision: options.sessionRole === 'set-spec-revision' ? {
            sessionName: setSessions[0] && setSessions[0].sessionName,
            agent: options.sessionAgentId,
            running: true,
        } : null,
        lastEvent: { label: scenario, at: FIXED_TIME },
        depGraph: {
            nodes: members.map(member => ({
                id: member.id,
                featureId: member.id === 'new' ? null : member.id,
                label: member.name,
                stage: member.status,
                state: member.status === 'complete' ? 'done' : (member.status === 'running' ? 'in-progress' : member.status),
                isCurrent: member.id === options.currentFeature,
            })),
            edges: [{ from: '682', to: '681' }, { from: '683', to: '682' }],
        },
        validActions,
    };
    const contract = buildFeatureSetUiContract(setCard);
    return {
        key,
        entityType: 'set',
        mode: 'set',
        modeLabel: 'Set',
        scenario,
        detail: options.detail || null,
        state: status,
        stateLabel: options.stateLabel || status.replace(/-/g, ' '),
        lane: options.lane || (options.isComplete ? 'done' : (status === 'idle' ? 'backlog' : 'in-progress')),
        contract,
        dashboardActions: validActions,
        engineActions: contract.decisions.actions.concat(contract.tools).map(action => ({ actionId: action.actionId, label: action.label })),
        unmappedEngineActions: [],
        duplicateActions: duplicateActionIds(validActions),
        setPlan: contract.plan,
    };
}

function setScenarios() {
    return [
        setScenario('set-inbox-members', 'Set contains inbox features', 'idle', {
            detail: 'Prioritise the inbox members or review all set specs first.',
            inboxMemberCount: 2,
            reviewableMemberCount: 3,
            launchableSpecReviewMemberCount: 3,
            members: [
                { id: 'new', name: 'Persist run checkpoints', status: 'inbox' },
                { id: 'new', name: 'Recover interrupted runs', status: 'inbox' },
                { id: '683', name: 'Expose recovery controls', status: 'backlog' },
            ],
        }),
        setScenario('set-spec-review-running', 'Set spec review running', 'idle', {
            detail: 'CX is reviewing the member specs together before implementation starts.',
            reviewableMemberCount: 3,
            sessionRunning: true,
            sessionRole: 'set-spec-review',
            sessionLabel: 'Reviewing set specs',
            sessionAgentId: 'cx',
            stateLabel: 'Spec review',
        }),
        setScenario('set-spec-revision-needed', 'Set specs need revision', 'idle', {
            detail: 'Review feedback is waiting across two member specs.',
            pendingSpecReviseMemberCount: 2,
            stateLabel: 'Spec feedback waiting',
            severity: 'warning',
        }),
        setScenario('set-spec-revision-running', 'Set spec revision running', 'idle', {
            detail: 'CX is revising the member specs together after review feedback.',
            pendingSpecReviseMemberCount: 2,
            sessionRunning: true,
            sessionRole: 'set-spec-revision',
            sessionLabel: 'Revising set specs',
            sessionAgentId: 'cx',
            stateLabel: 'Spec revision',
        }),
        setScenario('set-ready', 'Set ready to start', 'idle', {
            detail: 'All member specs are prioritised and dependency order is known.',
            stateLabel: 'Ready',
        }),
        setScenario('set-running', 'Set autonomous run in progress', 'running', {
            detail: 'F681 is complete. F682 is running now; F683 follows after it closes.',
            completed: ['681'],
            currentFeature: '682',
            sessionRunning: true,
            stateLabel: 'Running',
        }),
        setScenario('set-paused-failure', 'Set paused after a feature failed', 'paused-on-failure', {
            detail: 'F682 failed. Resume with the same agents or choose a new assignment.',
            completed: ['681'],
            currentFeature: '682',
            failedFeature: '682',
            stateLabel: 'Paused after failure',
            severity: 'error',
        }),
        setScenario('set-paused-quota', 'Set paused for agent quota', 'paused-on-quota', {
            detail: 'The current feature is preserved and can resume after quota resets.',
            completed: ['681'],
            currentFeature: '682',
            currentMemberStatus: 'quota-paused',
            stateLabel: 'Paused for quota',
        }),
        setScenario('set-stopped', 'Set autonomous run stopped by operator', 'stopped', {
            detail: 'F681 is complete. Resume from F682 or restart with different agents.',
            completed: ['681'],
            currentFeature: '682',
            currentMemberStatus: 'stopped',
            stateLabel: 'Stopped',
        }),
        setScenario('set-complete', 'Set complete', 'done', {
            detail: 'All three member features are closed.',
            isComplete: true,
            completed: ['681', '682', '683'],
            members: setMembers(null, null, ['681', '682', '683']),
            stateLabel: 'Complete',
            lane: 'done',
        }),
    ];
}

function appendCrossCuttingActions(spec, validActions) {
    const { entityType, context, gallery } = spec;
    let actions = validActions;
    const dashboardAgents = gallery.dashboardAgents
        || Object.entries(context.agents || {}).map(([id, agent]) => ({ id, ...agent }));

    if (gallery.quotaPaused) {
        actions = appendQuotaPausedDashboardActions(
            GALLERY_REPO_PATH,
            entityType,
            entityType === 'feature' ? '675' : '204',
            context,
            dashboardAgents,
            actions,
        );
    }
    if (entityType === 'feature' && gallery.escalation) {
        actions = appendEscalationDashboardActions('675', context, actions);
    }
    if (entityType === 'feature' && gallery.autoState) {
        actions = appendFeatureAutonomousDashboardActions(GALLERY_REPO_PATH, '675', gallery.autoState, actions);
        actions = appendFeatureReviewRecoveryDashboardActions(
            GALLERY_REPO_PATH,
            '675',
            gallery.autoState,
            context,
            actions,
            gallery.autonomousController || null,
        );
    } else if (entityType === 'feature' && context.currentSpecState === 'code_review_in_progress') {
        actions = appendFeatureReviewRecoveryDashboardActions(
            GALLERY_REPO_PATH,
            '675',
            null,
            context,
            actions,
            null,
        );
    }
    if (entityType === 'research') {
        actions = appendResearchReviewRecoveryDashboardActions(context, actions);
    }
    return actions;
}

function duplicateActionIds(actions) {
    const counts = new Map();
    actions.forEach(action => {
        const key = `${action.action || action.actionId}:${action.agentId || ''}`;
        counts.set(key, (counts.get(key) || 0) + 1);
    });
    return Array.from(counts.entries()).filter(([, count]) => count > 1).map(([id, count]) => ({ id, count }));
}

function uniqueContractActions(actions) {
    const identities = new Set();
    return actions.filter((action) => {
        const identity = `${action.action || action.actionId}:${action.agentId || ''}`;
        if (identities.has(identity)) return false;
        identities.add(identity);
        return true;
    });
}

function buildScenario(spec, index) {
    const entityId = spec.entityType === 'feature' ? '675' : '204';
    const engineActions = deriveAvailableActions(spec.context, spec.entityType);
    let dashboardActions = snapshotToDashboardActions(
        spec.entityType,
        entityId,
        spec.context,
        stageForState(spec.state),
    ).validActions;
    dashboardActions = appendCrossCuttingActions(spec, dashboardActions);
    const contractActions = uniqueContractActions(dashboardActions);

    const stateMeta = getStateRenderMeta(spec.state);
    const agentRows = Object.entries(spec.context.agents || {}).map(([id, agent]) => ({ id, ...agent }));
    const sessions = sessionsForScenario(spec);
    let contract;
    if (spec.entityType === 'feature') {
        contract = buildFeatureUiContract({
            id: entityId,
            displayKey: `F${entityId}`,
            name: 'Unify dashboard interaction contract',
            stage: stageForState(spec.state),
            agents: agentRows,
            sessions,
            validActions: contractActions,
            blockedBy: spec.gallery.blockedBy || [],
            specReviewSessions: spec.gallery.pendingSpecReview ? [{ status: 'pending', agent: 'cx' }] : [],
            stateRenderMeta: stateMeta,
            cardHeadline: { verb: spec.scenario, detail: spec.detail },
            cardPresentation: {
                severity: spec.severity || (spec.state === 'paused' ? 'warning' : 'normal'),
                contextLine: spec.detail,
            },
            evalSession: spec.context.evalSession || null,
            specDrift: spec.context.specDrift || null,
            autonomousController: spec.gallery.autonomousController || null,
            autonomousPlan: spec.gallery.autonomousPlan || null,
        }, spec.context, { blockers: [] });
    } else {
        contract = buildResearchUiContract({
            id: entityId,
            displayKey: `R${entityId}`,
            name: 'Evaluate retrieval strategies',
            stage: stageForState(spec.state),
            agents: agentRows,
            sessions,
            validActions: contractActions,
            stateRenderMeta: stateMeta,
            cardHeadline: { verb: spec.scenario, detail: spec.detail },
            cardPresentation: {
                severity: spec.severity || (spec.state === 'paused' ? 'warning' : 'normal'),
                contextLine: spec.detail,
            },
            evalSession: spec.context.evalSession || null,
            specDrift: spec.context.specDrift || null,
        }, spec.context, { blockers: [] });
    }

    const mappedKinds = new Set(dashboardActions.map(action => action.kind).filter(Boolean));
    const unmappedEngineActions = engineActions
        .filter(action => !(action.metadata && action.metadata.uiVisibility === 'internal'))
        .filter(action => !mappedKinds.has(action.kind))
        .map(action => ({
            actionId: action.kind,
            label: typeof action.label === 'string' ? action.label : action.kind,
            agentId: action.agentId || null,
            reason: 'Available from the engine but absent from the dashboard action mapping.',
        }));

    return {
        key: spec.key,
        order: index,
        entityType: spec.entityType,
        mode: spec.mode,
        modeLabel: modeLabel(spec.mode),
        scenario: spec.scenario,
        detail: spec.detail,
        state: spec.state,
        stateLabel: stateMeta.label,
        lane: stageForState(spec.state),
        contract,
        dashboardActions,
        engineActions: engineActions.map(action => ({
            actionId: action.kind,
            label: action.label,
            agentId: action.agentId || null,
            category: action.category || null,
        })),
        unmappedEngineActions,
        duplicateActions: duplicateActionIds(dashboardActions),
        autonomousPlan: contract.plan,
        autonomousController: spec.gallery.autonomousController || null,
    };
}

function uniqueActionCatalog(definition) {
    const seen = new Set();
    return definition.actions
        .filter(action => !(action.metadata && action.metadata.uiVisibility === 'internal'))
        .reduce((catalog, action) => {
            if (seen.has(action.kind)) return catalog;
            seen.add(action.kind);
            catalog.push({
                actionId: action.kind,
                category: action.category || 'lifecycle',
                perAgent: Boolean(action.perAgent),
                requiresInput: action.requiresInput || null,
            });
            return catalog;
        }, []);
}

function buildCoverage(entityType, definition, scenarios) {
    const restingStates = Object.keys(definition.states)
        .filter(state => state !== 'hydrating' && !definition.transientStates.has(state));
    const scenarioStates = new Set(scenarios.map(scenario => scenario.state));
    const mappedKinds = new Set(scenarios.flatMap(scenario => scenario.dashboardActions.map(action => action.kind).filter(Boolean)));
    const engineKinds = new Set(scenarios.flatMap(scenario => scenario.engineActions.map(action => action.actionId)));
    const catalog = uniqueActionCatalog(definition).map(action => ({
        ...action,
        exercisedByGallery: engineKinds.has(action.actionId),
        mappedToDashboard: mappedKinds.has(action.actionId),
    }));
    return {
        entityType,
        definitionVersion: definition.definitionVersion,
        restingStates,
        coveredStates: restingStates.filter(state => scenarioStates.has(state)),
        internalStates: [
            { state: 'hydrating', reason: 'Initial routing state; it never renders a card.' },
            ...Array.from(definition.transientStates).map(state => ({
                state,
                reason: 'Automatic transition state; it never rests long enough to render a card.',
            })),
        ],
        actionCatalog: catalog,
        unmappedActionKinds: catalog.filter(action => action.exercisedByGallery && !action.mappedToDashboard),
    };
}

function buildDashboardCardGallery() {
    const featureSpecs = [...baseStateScenarios('feature', FEATURE_DEFINITION), ...featureVariants()];
    const researchSpecs = [...baseStateScenarios('research', RESEARCH_DEFINITION), ...researchVariants()];
    const featureScenarios = featureSpecs.map(buildScenario);
    const researchScenarios = researchSpecs.map(buildScenario);
    const featureSetScenarios = setScenarios();
    return {
        generatedAt: FIXED_TIME,
        title: 'Feature, research, and feature set card states',
        note: 'All scenarios are projected through the versioned feature, research, or feature-set interaction contract.',
        contractGaps: [],
        scenarios: [...featureScenarios, ...researchScenarios, ...featureSetScenarios],
        coverage: {
            feature: buildCoverage('feature', FEATURE_DEFINITION, featureScenarios),
            research: buildCoverage('research', RESEARCH_DEFINITION, researchScenarios),
            set: {
                entityType: 'set',
                definitionVersion: 2,
                restingStates: ['idle', 'running', 'paused-on-failure', 'paused-on-quota', 'stopped', 'done'],
                coveredStates: Array.from(new Set(featureSetScenarios.map(scenario => scenario.state))),
                internalStates: [],
                actionCatalog: Array.from(new Map(featureSetScenarios.flatMap(scenario => scenario.dashboardActions).map(action => [action.action, {
                    actionId: action.action,
                    category: action.category || 'lifecycle',
                    exercisedByGallery: true,
                    mappedToDashboard: true,
                }])).values()),
                unmappedActionKinds: [],
            },
        },
    };
}

module.exports = {
    buildDashboardCardGallery,
    stageForState,
};
