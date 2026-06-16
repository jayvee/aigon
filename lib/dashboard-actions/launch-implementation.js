'use strict';

const stateMachine = require('../state-queries');
const {
    buildTmuxSessionName,
    buildResearchTmuxSessionName,
    createDetachedTmuxSession,
    runTmux,
    openTerminalAppWithCommand,
    shellQuote,
    buildAgentCommand,
    buildResearchAgentCommand,
} = require('../worktree');

function handleLaunchImplementation(ctx) {
    const { worktreePath, absRepo, featureId, agentId, desc, isResearch, repoName, latestStatus, launcherModel, launcherEffort } = ctx;
    const safeTmuxSessionExists = ctx.safeTmuxSessionExists;
    const sessionName = isResearch
        ? buildResearchTmuxSessionName(featureId, agentId, { repo: repoName, role: 'do' })
        : buildTmuxSessionName(featureId, agentId, { repo: repoName, desc, role: 'do' });
    const tmuxInfo = safeTmuxSessionExists(featureId, agentId, { isResearch });
    const tmuxSessionState = tmuxInfo && tmuxInfo.running ? 'running' : 'none';

    let cachedAgentStatus = 'idle';
    if (latestStatus && latestStatus.repos) {
        outer: for (const repo of latestStatus.repos) {
            for (const entity of [...(repo.features || []), ...(repo.research || [])]) {
                if (String(entity.id) === String(featureId)) {
                    const a = (entity.agents || []).find(ag => ag.id === agentId);
                    if (a) { cachedAgentStatus = a.status || 'idle'; break outer; }
                }
            }
        }
    }

    const { action: sessionAction } = stateMachine.getSessionAction(agentId, {
        tmuxSessionStates: { [agentId]: tmuxSessionState },
        agentStatuses: { [agentId]: cachedAgentStatus }
    });
    const launchExtras = { launcherModel: launcherModel || null, launcherEffort: launcherEffort || null };
    const agentCmd = isResearch
        ? buildResearchAgentCommand(agentId, featureId, 'do', absRepo, launchExtras)
        : buildAgentCommand(Object.assign({
            agent: agentId,
            featureId,
            path: worktreePath,
            desc,
            repoPath: absRepo,
        }, launchExtras));

    if (sessionAction === 'attach') {
        const s = tmuxInfo.sessionName;
        openTerminalAppWithCommand(worktreePath, `tmux attach -t ${shellQuote(s)}`, s);
        return { ok: true, message: `Attached to ${s}`, sessionName: s };
    }
    if (sessionAction === 'send-keys') {
        const s = tmuxInfo.sessionName;
        runTmux(['send-keys', '-t', s, agentCmd, 'Enter'], { stdio: 'ignore' });
        openTerminalAppWithCommand(worktreePath, `tmux attach -t ${shellQuote(s)}`, s);
        return { ok: true, message: `Restarted agent in ${s}`, sessionName: s };
    }
    createDetachedTmuxSession(sessionName, worktreePath, agentCmd, {
        repoPath: absRepo,
        entityType: isResearch ? 'r' : 'f',
        entityId: featureId,
        agent: agentId,
        role: 'do',
        worktreePath,
    });
    openTerminalAppWithCommand(worktreePath, `tmux attach -t ${shellQuote(sessionName)}`, sessionName);
    const label = isResearch ? `R${featureId}` : `F${featureId}`;
    return { ok: true, message: `Opened worktree for ${label} ${agentId}`, sessionName };
}

module.exports = {
    handleLaunchImplementation,
};
