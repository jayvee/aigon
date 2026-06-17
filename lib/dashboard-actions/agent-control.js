'use strict';

const path = require('path');
const os = require('os');
const workflowEngine = require('../workflow-core/engine');
const { createAgentSessionService } = require('../agent-sessions');
const { getDefaultAgent, getAgentCliConfig } = require('../config');
const agentRegistry = require('../agent-registry');
const {
    buildTmuxSessionName,
    buildResearchTmuxSessionName,
    createDetachedTmuxSession,
    runTmux,
    openTerminalAppWithCommand,
    buildAgentCommand,
    buildResearchAgentCommand,
    shellQuote,
} = require('../worktree');
const {
    resolveFeatureWorktreePath,
    detectDefaultBranch,
    worktreeHasImplementationCommits,
    hasResearchFindingsProgress,
} = require('../dashboard-status-helpers');
const { injectLiteral: tmuxInjectLiteral } = require('../tmux-inject');

function handleAskSession(payload) {
    const repoPath = String(payload.repoPath || '').trim();
    const prompt = String(payload.prompt || payload.message || '').trim();
    if (!repoPath) {
        return { ok: false, status: 400, error: 'repoPath is required' };
    }
    const absRepo = path.resolve(repoPath);
    const agentId = String(payload.agentId || getDefaultAgent(absRepo)).trim();
    const repoName = path.basename(absRepo);
    const sessionName = `ask-${repoName}-${agentId}`;
    const cliConfig = getAgentCliConfig(agentId, absRepo);
    const agentBin = cliConfig.command || agentId;
    const flags = cliConfig.implementFlag || '';
    const promptFlagToken = agentRegistry.getPromptFlag(agentId) || '';
    const promptArg = prompt ? ' ' + (promptFlagToken ? `${promptFlagToken} ` : '') + shellQuote(prompt) : '';
    const agentCmd = flags ? `${agentBin} ${flags}${promptArg}` : `${agentBin}${promptArg}`;
    const tmuxSessionExists = payload.tmuxSessionExists;
    if (tmuxSessionExists(sessionName)) {
        if (prompt) {
            tmuxInjectLiteral(sessionName, prompt, { submitKey: 'Enter' });
        }
        openTerminalAppWithCommand(absRepo, `tmux attach -t ${shellQuote(sessionName)}`, sessionName);
        return { ok: true, status: 200, payload: { ok: true, message: `Attached to existing session ${sessionName}`, sessionName } };
    }
    createDetachedTmuxSession(sessionName, absRepo, agentCmd, {
        category: 'repo',
        repoPath: absRepo,
        agent: agentId,
        worktreePath: absRepo,
    });
    openTerminalAppWithCommand(absRepo, `tmux attach -t ${shellQuote(sessionName)}`, sessionName);
    return { ok: true, status: 200, payload: { ok: true, message: `Started ask session for ${repoName} (${agentId})`, sessionName } };
}

async function handleAgentFlag(payload) {
    const action = String(payload.action || '').trim();
    const entityType = String(payload.entityType || 'feature').trim();
    const id = String(payload.id || '').trim();
    const agent = String(payload.agentId || '').trim();
    const repoPath = String(payload.repoPath || '').trim();
    if (!id || !agent) {
        return { ok: false, status: 400, error: 'id and agentId are required' };
    }
    const worktreeBase = path.join(os.homedir(), '.aigon', 'worktrees', path.basename(repoPath));
    const worktreePath = entityType === 'feature'
        ? resolveFeatureWorktreePath(worktreeBase, id, agent, repoPath)
        : repoPath;

    if (action === 'mark-submitted') {
        const hasEvidence = entityType === 'research'
            ? hasResearchFindingsProgress(path.join(repoPath, 'docs', 'specs', 'research-topics', 'logs'), id, agent)
            : worktreeHasImplementationCommits(worktreePath);
        if (!hasEvidence) {
            const evidenceLabel = entityType === 'research' ? 'findings' : 'implementation commits';
            return { ok: false, status: 409, error: `Cannot mark ${agent} complete for ${entityType} ${id} without ${evidenceLabel}.` };
        }
        const service = createAgentSessionService({ repoPath, host: null });
        await service.recordSessionSignal({
            entityType,
            entityId: id,
            agentId: agent,
            status: entityType === 'research' ? 'research-complete' : 'implementation-complete',
            source: 'dashboard/agent-control/mark-submitted',
            payload: { taskType: 'do', worktreePath },
        });
        return { ok: true, refreshStatus: true, status: 200, payload: { ok: true, message: `Marked ${agent} as complete` } };
    }

    if (action === 'reopen-agent') {
        const sessionName = entityType === 'research'
            ? buildResearchTmuxSessionName(id, agent, { repo: path.basename(repoPath), role: 'do' })
            : buildTmuxSessionName(id, agent, { repo: path.basename(repoPath), role: 'do' });
        const desc = worktreePath ? (() => {
            const m = path.basename(worktreePath).match(/^feature-\d+-[a-z]{2}-(.+)$/);
            return m ? m[1] : undefined;
        })() : undefined;
        const command = entityType === 'research'
            ? buildResearchAgentCommand(agent, id, 'do', repoPath)
            : buildAgentCommand({ agent, featureId: id, path: worktreePath || repoPath, desc, repoPath });

        try { runTmux(['kill-session', '-t', sessionName], { stdio: 'ignore' }); } catch (_) { /* ignore */ }
        createDetachedTmuxSession(sessionName, worktreePath || repoPath, command, {
            repoPath,
            entityType: entityType === 'research' ? 'r' : 'f',
            entityId: id,
            agent,
            role: 'do',
            worktreePath: worktreePath || repoPath,
        });
        await createAgentSessionService({ repoPath, host: null }).recordSessionSignal({
            entityType,
            entityId: id,
            agentId: agent,
            role: 'do',
            eventType: 'agent_session.started',
            source: 'dashboard/agent-control/reopen-agent',
            payload: { worktreePath: worktreePath || repoPath },
        });
        await workflowEngine.restartEntityAgent(repoPath, entityType, id, agent);
        return { ok: true, refreshStatus: true, status: 200, payload: { ok: true, message: `Re-opened agent ${agent}` } };
    }

    if (action === 'switch-agent') {
        return { ok: false, status: 403, error: 'switch-agent requires aigon-pro', payload: { proRequired: true } };
    }

    if (action === 'view-work') {
        const terminalCwd = worktreePath || repoPath;
        const diffCmd = entityType === 'research'
            ? 'git --no-pager status; echo; git --no-pager log --oneline -n 20'
            : `git --no-pager status; echo; git --no-pager log --oneline -n 20; echo; git --no-pager diff --stat ${detectDefaultBranch(terminalCwd)}...HEAD`;
        openTerminalAppWithCommand(terminalCwd, diffCmd, `view-work-${entityType}-${id}-${agent}`);
        return { ok: true, status: 200, payload: { ok: true, message: 'Opened worktree diff in terminal' } };
    }

    return { ok: false, status: 400, error: `Unsupported action: ${action}` };
}

async function handleDashboardAgentControl(request) {
    if (request.control === 'ask-session') {
        return handleAskSession(request);
    }
    return handleAgentFlag(request);
}

module.exports = {
    handleDashboardAgentControl,
};
