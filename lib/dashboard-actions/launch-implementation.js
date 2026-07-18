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
const workflowSnapshotAdapter = require('../workflow-snapshot-adapter');
const entityContext = require('../entity-context');
const { resolveContinuityPolicy } = require('../session-continuity-policy');

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
    const entityTypeFull = isResearch ? 'research' : 'feature';
    const snapshot = workflowSnapshotAdapter.readWorkflowSnapshotSync(absRepo, entityTypeFull, featureId);
    const continuity = entityContext.readEntityContext(absRepo, entityTypeFull, featureId) || {};
    const continuityDecision = resolveContinuityPolicy({
        phase: 'implementation', selectedAgent: agentId,
        authorAgentId: snapshot && snapshot.authorAgentId,
        originSession: continuity.originSession,
        authorHandoff: continuity.authorHandoff,
    });
    continuityDecision.currentSessionId = `implementation-${entityTypeFull}-${String(featureId).padStart(2, '0')}-${Date.now()}`;
    continuityDecision.role = 'do';
    entityContext.recordContinuityDecision(absRepo, entityTypeFull, featureId, continuityDecision);
    let continuityInstructions = '';
    if (continuity.authorHandoff && continuity.authorHandoff.status === 'valid') {
        continuityInstructions += `## Author handoff (current files are authoritative)\n${JSON.stringify(continuity.authorHandoff, null, 2)}`;
    }
    if (continuityDecision.strategy === 'resume-origin') {
        continuityInstructions += `\n\n## Continuation checkpoint\nAfter reconciling the current checkout, run exactly one:\n`;
        continuityInstructions += `aigon agent-status continuation-ready ${featureId} ${agentId} --session=${continuityDecision.currentSessionId}\n`;
        continuityInstructions += `aigon agent-status continuation-fallback ${featureId} ${agentId} --session=${continuityDecision.currentSessionId} --reason=<context-missing|context-conflict|task-delivery-failed>`;
    }
    const launchExtras = {
        launcherModel: launcherModel || null,
        launcherEffort: launcherEffort || null,
        continuityInstructions,
        resumeProviderSessionId: continuityDecision.strategy === 'resume-origin' && continuity.originSession
            ? continuity.originSession.providerSessionId
            : null,
    };
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
        return { ok: true, message: `Attached to ${s}`, sessionName: s, continuityDecision };
    }
    if (sessionAction === 'send-keys') {
        const s = tmuxInfo.sessionName;
        runTmux(['send-keys', '-t', s, agentCmd, 'Enter'], { stdio: 'ignore' });
        openTerminalAppWithCommand(worktreePath, `tmux attach -t ${shellQuote(s)}`, s);
        return { ok: true, message: `Restarted agent in ${s}`, sessionName: s, continuityDecision };
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
    return { ok: true, message: `Opened worktree for ${label} ${agentId}`, sessionName, continuityDecision };
}

module.exports = {
    handleLaunchImplementation,
};
