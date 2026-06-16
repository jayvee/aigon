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

function handleLaunchReview(ctx) {
    const fs = ctx.fs || require('fs');
    const { worktreePath, absRepo, featureId, agentId, desc, isResearch, repoName, launcherModel, launcherEffort } = ctx;
    const taskCwd = (worktreePath !== absRepo && fs.existsSync(worktreePath)) ? worktreePath : absRepo;
    if (taskCwd !== absRepo) {
        addWorktreePermissions([taskCwd]);
        agentRegistry.ensureAgentTrust(agentId, [taskCwd]);
    }
    const entityType = isResearch ? 'r' : 'f';
    const label = isResearch ? 'R' : 'F';
    const sessionName = buildTmuxSessionName(toUnpaddedId(featureId), agentId, { repo: repoName, desc, entityType, role: 'review' });
    const commandType = isResearch ? 'research-review' : 'review';
    ensureTmuxSession(sessionName, taskCwd, () => buildAgentCommand({
        agent: agentId,
        featureId,
        path: taskCwd,
        desc,
        repoPath: absRepo,
        entityType: isResearch ? 'research' : 'feature',
        launcherModel: launcherModel || null,
        launcherEffort: launcherEffort || null,
    }, commandType), {
        repoPath: absRepo,
        entityType,
        entityId: featureId,
        agent: agentId,
        role: 'review',
        worktreePath: taskCwd,
    });
    workflowEngine.recordCodeReviewStarted(absRepo, isResearch ? 'research' : 'feature', String(featureId).padStart(2, '0'), {
        reviewerId: agentId,
        source: 'dashboard/review-launch',
    }).catch(err => {
        console.warn(`⚠️  failed to record code review start for ${label}${featureId}: ${err.message}`);
    });
    return { ok: true, message: `Opened review for ${label}${featureId}`, sessionName };
}

module.exports = {
    handleLaunchReview,
};
