'use strict';

const workflowEngine = require('../workflow-core/engine');
const agentRegistry = require('../agent-registry');
const {
    buildTmuxSessionName,
    buildAgentCommand,
    toUnpaddedId,
    addWorktreePermissions,
} = require('../worktree');
const { ensureTmuxSession } = require('./launch-shared');
const workflowSnapshotAdapter = require('../workflow-snapshot-adapter');
const entityContext = require('../entity-context');
const { resolveContinuityPolicy } = require('../session-continuity-policy');

async function handleLaunchSpecReview(ctx, options = {}) {
    const {
        absRepo,
        featureId,
        agentId,
        desc,
        isResearch,
        repoName,
    } = ctx;
    const commandName = options.commandName;
    const role = options.role;
    const taskType = options.taskType;
    const taskCwd = absRepo;
    addWorktreePermissions([taskCwd]);
    agentRegistry.ensureAgentTrust(agentId, [taskCwd]);
    const label = isResearch ? 'R' : 'F';
    const entityType = isResearch ? 'r' : 'f';
    const sessionName = buildTmuxSessionName(toUnpaddedId(featureId), agentId, {
        repo: repoName,
        desc,
        entityType,
        role,
    });
    const entityTypeFull = isResearch ? 'research' : 'feature';
    const recordStart = role === 'spec-revise'
        ? workflowEngine.recordSpecRevisionStarted(absRepo, entityTypeFull, featureId, {
            checkerId: agentId,
            model: ctx.launcherModel || null,
            effort: ctx.launcherEffort || null,
        })
        : workflowEngine.recordSpecReviewStarted(absRepo, entityTypeFull, featureId, { reviewerId: agentId });

    // The session must never get ahead of the engine. Otherwise a refresh can
    // show a plain backlog card while the revision agent is already working.
    await recordStart;

    const snapshot = workflowSnapshotAdapter.readWorkflowSnapshotSync(absRepo, entityTypeFull, featureId);
    const continuity = entityContext.readEntityContext(absRepo, entityTypeFull, featureId) || {};
    const continuityDecision = role === 'spec-revise' ? resolveContinuityPolicy({
        phase: 'spec-revise', selectedAgent: agentId,
        authorAgentId: snapshot && snapshot.authorAgentId,
        originSession: continuity.originSession,
        authorHandoff: continuity.authorHandoff,
    }) : null;
    let continuityInstructions = '';
    if (continuityDecision) {
        continuityDecision.currentSessionId = `spec-revise-${entityTypeFull}-${String(featureId).padStart(2, '0')}-${Date.now()}`;
        continuityDecision.role = 'spec-revise';
        entityContext.recordContinuityDecision(absRepo, entityTypeFull, featureId, continuityDecision);
        if (continuity.authorHandoff && continuity.authorHandoff.status === 'valid') {
            continuityInstructions += `## Author handoff (current files are authoritative)\n${JSON.stringify(continuity.authorHandoff, null, 2)}`;
        }
        if (continuityDecision.strategy === 'resume-origin') {
            continuityInstructions += `\n\n## Continuation checkpoint\nAfter reconciling the current checkout, run exactly one:\n`;
            continuityInstructions += `aigon agent-status continuation-ready ${featureId} ${agentId} --session=${continuityDecision.currentSessionId}\n`;
            continuityInstructions += `aigon agent-status continuation-fallback ${featureId} ${agentId} --session=${continuityDecision.currentSessionId} --reason=<context-missing|context-conflict|task-delivery-failed>`;
        }
    }

    ensureTmuxSession(sessionName, taskCwd, () => buildAgentCommand({
        agent: agentId,
        featureId,
        path: taskCwd,
        desc,
        repoPath: absRepo,
        entityType: isResearch ? 'research' : 'feature',
        launcherModel: ctx.launcherModel || null,
        launcherEffort: ctx.launcherEffort || null,
        continuityInstructions,
        resumeProviderSessionId: continuityDecision && continuityDecision.strategy === 'resume-origin' && continuity.originSession
            ? continuity.originSession.providerSessionId
            : null,
    }, taskType), {
        repoPath: absRepo,
        entityType,
        entityId: featureId,
        agent: agentId,
        role,
        worktreePath: taskCwd,
    });
    return { ok: true, message: `Opened ${commandName} for ${label}${featureId}`, sessionName, continuityDecision };
}

module.exports = {
    handleLaunchSpecReview,
};
