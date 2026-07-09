'use strict';

const workflowEngine = require('../workflow-core/engine');
const workflowSnapshotAdapter = require('../workflow-snapshot-adapter');
const agentRegistry = require('../agent-registry');
const { getAgentCliConfig } = require('../config');
const {
    buildTmuxSessionName,
    buildAgentCommand,
    shellQuote,
    toUnpaddedId,
    addWorktreePermissions,
} = require('../worktree');
const { ensureTmuxSession } = require('./launch-shared');

async function handleLaunchCloseResolve(ctx) {
    const fs = ctx.fs || require('fs');
    const { worktreePath, absRepo, featureId, agentId, desc, repoName, lastCloseFailure } = ctx;
    const taskCwd = (worktreePath !== absRepo && fs.existsSync(worktreePath)) ? worktreePath : absRepo;
    if (taskCwd !== absRepo) {
        addWorktreePermissions([taskCwd]);
        agentRegistry.ensureAgentTrust(agentId, [taskCwd]);
    }
    const sessionName = buildTmuxSessionName(toUnpaddedId(featureId), agentId, { repo: repoName, desc, entityType: 'f', role: 'close' });
    const snapForReturn = workflowSnapshotAdapter.readWorkflowSnapshotSync(absRepo, 'feature', featureId);
    const returnSpecState = snapForReturn ? (snapForReturn.currentSpecState || snapForReturn.lifecycle || null) : null;
    if (returnSpecState && returnSpecState !== 'close_recovery_in_progress') {
        await workflowEngine.recordCloseRecoveryStarted(absRepo, featureId, {
            agentId,
            sessionName,
            source: 'dashboard',
            returnSpecState,
        });
    }
    const cliConfig = getAgentCliConfig(agentId, absRepo);
    const unsetClaudeCode = cliConfig.command === 'claude' ? 'unset CLAUDECODE && ' : '';
    const implFlag = cliConfig.implementFlag ? ` ${cliConfig.implementFlag}` : '';
    let task;
    const lcf = lastCloseFailure && typeof lastCloseFailure === 'object' ? lastCloseFailure : null;
    if (lcf && lcf.kind === 'merge-conflict' && Array.isArray(lcf.conflictFiles) && lcf.conflictFiles.length > 0) {
        const fileList = lcf.conflictFiles.join(', ');
        task = `The last close attempt failed with merge conflicts against main in these files: ${fileList}. Rebase this branch onto main (\`git rebase main\`), resolve the conflicts, commit the resolution, then run \`aigon feature-close ${featureId}\` to retry.`;
    } else if (lcf && lcf.kind === 'post-merge-gate') {
        const gateCmd = lcf.gateCommand || 'the configured post-merge gate';
        const logHint = lcf.logPath ? ` Full log: ${lcf.logPath}.` : '';
        task = `The last close attempt failed the post-merge verification gate (${gateCmd}) on merged main.${logHint} Read the log, fix whatever is failing on main (tests, lint, module graph, etc.), commit the fix to main, then run \`aigon feature-close ${featureId}\` to retry.`;
    } else if (lcf && lcf.kind === 'preauth-validation') {
        task = `The last close attempt failed pre-authorisation validation. Review the unmatched slugs in the close output, update the spec or implementation log as needed, then run \`aigon feature-close ${featureId}\` to retry.`;
    } else if (lcf && lcf.kind === 'criteria-attestation') {
        task = `The last close attempt failed criteria attestation. Every acceptance criterion needs a matching indexed line in the implementation log ## Criteria Attestation section (met / deferred / dropped), then run \`aigon feature-close ${featureId}\` to retry.`;
    } else {
        task = `Run "aigon feature-close" to see why closing this feature failed. Fix whatever is blocking (merge conflicts, security scan issues, etc.) and re-run it until it succeeds.`;
    }
    const rawCommand = `${unsetClaudeCode}${cliConfig.command}${implFlag} ${shellQuote(task)}`;
    ensureTmuxSession(sessionName, taskCwd, () => buildAgentCommand({
        agent: agentId,
        featureId,
        path: taskCwd,
        desc,
        repoPath: absRepo,
        entityType: 'feature',
        rawCommand,
    }), {
        repoPath: absRepo,
        entityType: 'f',
        entityId: featureId,
        agent: agentId,
        role: 'close',
        worktreePath: taskCwd,
    });
    return { ok: true, message: `Opened agent to resolve conflicts for F${featureId}`, sessionName };
}

module.exports = {
    handleLaunchCloseResolve,
};
