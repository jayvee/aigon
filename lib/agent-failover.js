'use strict';

/**
 * lib/agent-failover.js — Pro-tier failover action engine.
 *
 * This module contains the full failover implementation: tmux session
 * kill/respawn, prompt handoff building, and token-exhausted flag clearing.
 * The detection side (buildTokenExhaustionSignal, chooseNextAgent) lives in
 * the OSS aigon package (lib/agent-exhaustion-detect.js) since those utilities
 * are also needed by OSS workflow rules.
 *
 * Registered into the OSS supervisor via api.helpers.registerExhaustionHandler()
 * at startup. The OSS supervisor emits agent.token_exhausted events; Pro emits
 * agent.failover_switched and manages the tmux lifecycle.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Pull detection utilities and shared helpers from the OSS package.
const {
    chooseNextAgent,
    getAgentRuntimeId,
    getLastReachableCommit,
    resolveFailoverConfig,
    clearTokenExhaustedFlag,
} = require('./agent-exhaustion-detect');
const workflowEngine = require('./workflow-core');
const { readAgentStatusRecordAt } = require('./agent-status');
const { resolveAgentPromptBody } = require('./agent-prompt-resolver');
const {
    buildAgentCommand,
    buildTmuxSessionName,
    createDetachedTmuxSession,
    runTmux,
} = require('./worktree');
const { resolveFeatureWorktreePath } = require('./dashboard-status-helpers');
const { getAgentCliConfig } = require('./config');
const workflowSnapshotAdapter = require('./workflow-snapshot-adapter');

function buildFailoverPrompt(basePrompt, payload) {
    const suffix = [
        '',
        '## Failover Handoff',
        `- Previous slot: ${payload.slotAgentId}`,
        `- Previous implementation agent: ${payload.previousAgentId || payload.slotAgentId}`,
        `- Replacement agent: ${payload.replacementAgentId}`,
        `- Last reachable commit: ${payload.lastCommit || 'none'}`,
        '- Continue from the current branch and worktree state.',
        '- Do not reset the branch, discard work, or re-plan the feature from scratch.',
    ].join('\n');
    return `${basePrompt.trimEnd()}\n${suffix}\n`;
}

function resolveSlotWorktreePath(repoPath, featureId, agentId) {
    const record = readAgentStatusRecordAt(repoPath, featureId, agentId, { prefixes: ['feature'] });
    if (record && record.data && record.data.worktreePath) {
        return record.data.worktreePath;
    }
    return resolveFeatureWorktreePath(
        path.join(os.homedir(), '.aigon', 'worktrees', path.basename(repoPath)),
        featureId,
        agentId,
        repoPath,
    );
}

/**
 * Switch a feature's agent slot to the next agent in the failover chain.
 * Kills the current tmux session, spawns a replacement, records the
 * agent.failover_switched event, and clears the token-exhausted flag.
 *
 * Used by both the auto-failover exhaustion handler and the manual
 * /api/feature-failover dashboard endpoint.
 */
async function switchFeatureAgent(repoPath, featureId, snapshot, slotAgentId, replacementAgentId, source, options = {}) {
    const agentState = snapshot.agents && snapshot.agents[slotAgentId];
    if (!agentState) return false;
    const worktreePath = resolveSlotWorktreePath(repoPath, featureId, slotAgentId);
    if (!worktreePath || !fs.existsSync(worktreePath)) return false;
    const lastCommit = getLastReachableCommit(worktreePath);
    const descMatch = path.basename(worktreePath).match(/^feature-\d+-[a-z0-9]+-(.+)$/);
    const desc = descMatch ? descMatch[1] : null;
    const replacementCliConfig = getAgentCliConfig(replacementAgentId, repoPath);
    const basePrompt = resolveAgentPromptBody({
        agentId: replacementAgentId,
        verb: 'do',
        featureId,
        cliConfig: replacementCliConfig,
    });
    const promptOverride = buildFailoverPrompt(basePrompt, {
        slotAgentId,
        previousAgentId: getAgentRuntimeId(agentState, slotAgentId),
        replacementAgentId,
        lastCommit,
    });
    const sessionName = buildTmuxSessionName(featureId, slotAgentId, { repo: path.basename(repoPath), role: 'do', desc });
    try { runTmux(['kill-session', '-t', sessionName], { stdio: 'ignore' }); } catch (_) { /* ignore */ }
    const command = buildAgentCommand({
        agent: replacementAgentId,
        slotAgentId,
        featureId,
        path: worktreePath,
        desc,
        repoPath,
        snapshot,
        promptOverride,
        launcherModel: options.launcherModel != null
            ? options.launcherModel
            : (replacementCliConfig.models?.implement || null),
        launcherEffort: options.launcherEffort != null
            ? options.launcherEffort
            : null,
    });
    createDetachedTmuxSession(sessionName, worktreePath, command, {
        repoPath,
        entityType: 'f',
        entityId: featureId,
        agent: slotAgentId,
        role: 'do',
        worktreePath,
    });
    await workflowEngine.recordAgentFailoverSwitch(repoPath, featureId, {
        agentId: slotAgentId,
        previousAgentId: getAgentRuntimeId(agentState, slotAgentId),
        replacementAgentId,
        source,
        lastCommit,
    });
    clearTokenExhaustedFlag(repoPath, featureId, slotAgentId, replacementAgentId, worktreePath);
    return true;
}

/**
 * Exhaustion handler registered with the OSS supervisor via
 * api.helpers.registerExhaustionHandler(). Called when a token-exhaustion
 * signal is detected and failoverConfig.policy === 'switch'.
 */
async function handleExhaustion({ repoPath, entityId, agentId, signal, snapshot, failoverConfig }) {
    const replacementAgentId = chooseNextAgent(
        failoverConfig.chain,
        signal.currentAgentId,
        [signal.currentAgentId],
    );
    if (!replacementAgentId) return; // chain exhausted — auto-switch not possible
    await switchFeatureAgent(repoPath, entityId, snapshot, agentId, replacementAgentId, signal.source);
}

/**
 * Failover action appender for the dashboard validActions list.
 * Registered via api.helpers.registerFailoverActionAppender().
 * Injects a switch-agent entry for each agent slot with tokenExhausted set.
 */
function appendFailoverDashboardActions(repoPath, entityType, entityId, snapshot, dashboardAgents, validActions) {
    if (entityType !== 'feature' || !Array.isArray(dashboardAgents)) {
        return Array.isArray(validActions) ? validActions : [];
    }
    const base = Array.isArray(validActions) ? validActions.slice() : [];
    const haveSwitch = new Set(base.filter(a => a.action === 'switch-agent').map(a => a.agentId));

    for (const agentRow of dashboardAgents) {
        if (!agentRow || !agentRow.id) continue;
        const agentId = agentRow.id;
        if (haveSwitch.has(agentId)) continue;
        const agentSnap = snapshot && snapshot.agents ? snapshot.agents[agentId] : null;
        if (!agentSnap || !agentSnap.tokenExhausted) continue;
        const failoverConfig = resolveFailoverConfig(repoPath, snapshot);
        const runtimeAgentId = getAgentRuntimeId(agentSnap, agentId);
        const nextAgentId = chooseNextAgent(failoverConfig.chain, runtimeAgentId, [runtimeAgentId]);
        const chainExhausted = !nextAgentId;
        const label = nextAgentId ? `Failover now → ${nextAgentId}` : 'Failover now';
        base.push({
            command: `aigon feature-failover ${entityId} ${agentId}`,
            label,
            reason: chainExhausted ? 'No agents left in failover chain' : `Switch ${agentId} to ${nextAgentId}`,
            action: 'switch-agent',
            kind: 'switch-agent',
            agentId,
            mode: null,
            category: 'agent-control',
            type: 'action',
            to: null,
            priority: 'normal',
            requiresInput: null,
            scope: null,
            metadata: {
                nextAgentId: nextAgentId || null,
                chainExhausted,
                flagAction: 'switch-agent',
            },
            clientOnly: false,
        });
        haveSwitch.add(agentId);
    }
    return base;
}

/**
 * Dashboard API handler for POST /api/feature-failover.
 * Registered in Pro's register(api) function.
 */
function createFailoverRouteHandler(helpers) {
    const { resolveRequestedRepoPath, sendJson } = helpers;
    return function handleFailoverRequest(req, res, ctx) {
        return ctx.readJsonBody()
            .catch(() => { sendJson(res, 400, { error: 'Invalid JSON body' }); return null; })
            .then(async (payload) => {
                if (!payload) return;
                const featureId = String(payload.featureId || '').trim();
                const agentId = String(payload.agentId || '').trim();
                if (!featureId || !agentId) {
                    sendJson(res, 400, { error: 'featureId and agentId are required' });
                    return;
                }
                const repoResolution = resolveRequestedRepoPath(String(payload.repoPath || '').trim());
                if (!repoResolution.ok) {
                    sendJson(res, repoResolution.status || 400, { error: repoResolution.error || 'Invalid repoPath' });
                    return;
                }
                const repoPath = repoResolution.repoPath;
                try {
                    const snapshotForSwitch = workflowSnapshotAdapter.readFeatureSnapshotSync(repoPath, featureId);
                    const agentState = snapshotForSwitch && snapshotForSwitch.agents
                        ? snapshotForSwitch.agents[agentId]
                        : null;
                    if (!snapshotForSwitch || !agentState) {
                        sendJson(res, 404, { error: `Agent ${agentId} not found on feature ${featureId}` });
                        return;
                    }
                    if (!agentState.tokenExhausted) {
                        sendJson(res, 409, { error: 'Switch is only allowed after token exhaustion is recorded for this agent slot' });
                        return;
                    }
                    const failoverConfig = resolveFailoverConfig(repoPath, snapshotForSwitch);
                    const runtimeAgentId = getAgentRuntimeId(agentState, agentId);
                    const replacementAgentId = chooseNextAgent(
                        failoverConfig.chain,
                        runtimeAgentId,
                        [runtimeAgentId],
                    );
                    if (!replacementAgentId) {
                        sendJson(res, 409, { error: `No failover candidate available for ${agentId} (chain exhausted)` });
                        return;
                    }
                    const switched = await switchFeatureAgent(
                        repoPath,
                        featureId,
                        snapshotForSwitch,
                        agentId,
                        replacementAgentId,
                        'manual',
                    );
                    if (!switched) {
                        sendJson(res, 500, { error: 'Switch failed — worktree not found or inaccessible' });
                        return;
                    }
                    sendJson(res, 200, {
                        ok: true,
                        message: `Switched ${agentId} → ${replacementAgentId}`,
                        replacementAgentId,
                    });
                } catch (e) {
                    sendJson(res, 500, { error: e.message });
                }
            });
    };
}

module.exports = {
    buildFailoverPrompt,
    clearTokenExhaustedFlag,
    switchFeatureAgent,
    handleExhaustion,
    appendFailoverDashboardActions,
    createFailoverRouteHandler,
    // Re-export detection utilities for convenience and test access
    chooseNextAgent,
    getAgentRuntimeId,
    getLastReachableCommit,
};
