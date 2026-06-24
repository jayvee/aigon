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

function handleLaunchSpecReview(ctx, options = {}) {
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
    ensureTmuxSession(sessionName, taskCwd, () => buildAgentCommand({
        agent: agentId,
        featureId,
        path: taskCwd,
        desc,
        repoPath: absRepo,
        entityType: isResearch ? 'research' : 'feature',
        launcherModel: ctx.launcherModel || null,
        launcherEffort: ctx.launcherEffort || null,
    }, taskType), {
        repoPath: absRepo,
        entityType,
        entityId: featureId,
        agent: agentId,
        role,
        worktreePath: taskCwd,
    });
    const entityTypeFull = isResearch ? 'research' : 'feature';
    const recordStart = role === 'spec-revise'
        ? workflowEngine.recordSpecRevisionStarted(absRepo, entityTypeFull, featureId, {
            checkerId: agentId,
            model: ctx.launcherModel || null,
            effort: ctx.launcherEffort || null,
        })
        : workflowEngine.recordSpecReviewStarted(absRepo, entityTypeFull, featureId, { reviewerId: agentId });
    recordStart.catch(err => {
        console.warn(`⚠️  failed to record ${role} start for ${label}${featureId}: ${err.message}`);
    });
    return { ok: true, message: `Opened ${commandName} for ${label}${featureId}`, sessionName };
}

module.exports = {
    handleLaunchSpecReview,
};
