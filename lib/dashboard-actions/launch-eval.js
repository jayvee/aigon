'use strict';

const {
    buildTmuxSessionName,
    buildAgentCommand,
    buildResearchAgentCommand,
    toUnpaddedId,
} = require('../worktree');
const { ensureTmuxSession } = require('./launch-shared');

function handleLaunchEval(ctx) {
    const fs = ctx.fs || require('fs');
    const { worktreePath, absRepo, featureId, agentId, desc, isResearch, repoName, launcherModel, launcherEffort } = ctx;
    const label = isResearch ? 'R' : 'F';
    const taskCwd = isResearch
        ? ((worktreePath !== absRepo && fs.existsSync(worktreePath)) ? worktreePath : absRepo)
        : absRepo;
    const sessionName = buildTmuxSessionName(toUnpaddedId(featureId), agentId, { repo: repoName, desc, entityType: label.toLowerCase(), role: 'eval' });
    ensureTmuxSession(sessionName, taskCwd, () =>
        isResearch ? buildResearchAgentCommand(agentId, featureId, 'eval', absRepo, {
            launcherModel: launcherModel || null,
            launcherEffort: launcherEffort || null,
        })
                   : buildAgentCommand({
                       agent: agentId,
                       featureId,
                       path: taskCwd,
                       desc,
                       repoPath: absRepo,
                       launcherModel: launcherModel || null,
                       launcherEffort: launcherEffort || null,
                   }, 'evaluate'), {
        repoPath: absRepo,
        entityType: label.toLowerCase(),
        entityId: featureId,
        agent: agentId,
        role: 'eval',
        worktreePath: taskCwd,
    });
    return { ok: true, message: `Opened eval for ${label}${featureId}`, sessionName };
}

module.exports = {
    handleLaunchEval,
};
