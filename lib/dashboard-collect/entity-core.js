'use strict';

const path = require('path');
const agentStatus = require('../agent-status');
const signalHealth = require('../signal-health');
const autoNudge = require('../auto-nudge');
const featureSpecResolver = require('../feature-spec-resolver');
const workflowReadModel = require('../workflow-read-model');
const { readJsonSafe } = require('../io/json');
const {
    deriveFeatureDashboardStatus,
    RUNTIME_TASK_FILE_STATUSES,
    parseFeatureSpecFileName,
    safeTmuxSessionExists,
    resolveFeatureWorktreePath,
    parseStatusFlags,
    maybeFlagEndedSession,
} = require('../dashboard-status-helpers');
const { getAgentLiveness, captureAndDetectIdle } = require('../supervisor');
const {
    COMPLETION_SIGNAL_BY_TASK_TYPE,
    NON_WORKING_AGENT_STATUSES,
} = require('./constants');
const { safeReadDir } = require('./safe-reads');
const { getDevServerState, isDevServerPokeEligible } = require('./infra-probes');

function readJsonFilesByPattern(dir, pattern, mapEntry) {
    const result = {};
    safeReadDir(dir, file => pattern.test(file)).forEach(file => {
        const parsed = readJsonSafe(path.join(dir, file));
        if (parsed !== null) {
            const mapped = mapEntry(parsed, file);
            if (mapped && mapped.key) result[mapped.key] = mapped.value;
        }
    });
    return result;
}

function readFeatureManifests(stateDir) {
    return readJsonFilesByPattern(stateDir, /^feature-\d+\.json$/, (parsed, file) => {
        const match = file.match(/^feature-(\d+)\.json$/);
        return match ? { key: match[1], value: parsed } : null;
    });
}

function readResearchManifests(stateDir) {
    return readJsonFilesByPattern(stateDir, /^research-\d+\.json$/, (parsed, file) => {
        const match = file.match(/^research-(\d+)\.json$/);
        return match ? { key: match[1], value: parsed } : null;
    });
}

function buildFeatureAgentRow(options) {
    const {
        absRepoPath,
        parsed,
        agent,
        status,
        updatedAt,
        flags,
        hasStatusFile,
        worktreeBaseDir,
        devServerEnabled,
        caddyRoutes,
        repoAppId,
        reviewStatus,
        fileStatus,
    } = options;
    const tmux = safeTmuxSessionExists(parsed.id, agent, { repoPath: absRepoPath });
    const normalizedStatus = deriveFeatureDashboardStatus(status, {
        reviewStatus,
        tmuxRunning: tmux ? tmux.running : false,
        fileStatus,
    });
    const worktreePath = resolveFeatureWorktreePath(worktreeBaseDir, parsed.id, agent, absRepoPath);
    const flagged = maybeFlagEndedSession(absRepoPath, {
        entityType: 'feature',
        id: parsed.id,
        agent,
        status: normalizedStatus,
        flags,
        tmuxRunning: tmux ? tmux.running : false,
        worktreePath,
        hasStatusFile
    });
    const serverId = `${agent}-${parsed.id}`;
    const devServer = getDevServerState(caddyRoutes, repoAppId, serverId);
    const livenessInfo = getAgentLiveness(absRepoPath, 'feature', parsed.id, agent);
    const idleLadder = autoNudge.computeIdleLadder(absRepoPath, {
        entityType: 'feature',
        entityId: parsed.id,
        agentId: agent,
        role: 'do',
        status: flagged.status,
        updatedAt,
        flags: flagged.flags,
        tmuxRunning: tmux ? tmux.running : false,
        sessionName: tmux ? tmux.sessionName : null,
        idleAtPrompt: livenessInfo ? Boolean(livenessInfo.idleAtPrompt) : false,
        idleAtPromptDetectedAt: livenessInfo ? livenessInfo.idleAtPromptDetectedAt : null,
    });
    if (hasStatusFile) {
        signalHealth.recordMissedSignalIfDue({
            repoPath: absRepoPath,
            entityType: 'feature',
            entityId: parsed.id,
            agent,
            lastStatus: flagged.status,
            lastStatusAt: updatedAt,
            sessionName: tmux ? tmux.sessionName : null,
            expected: `advance-from-${flagged.status}`,
        });
    }
    return {
        id: agent,
        status: flagged.status,
        updatedAt,
        slashCommand: flagged.status === 'waiting' ? `aigon terminal-focus ${String(parsed.id).padStart(2, '0')} ${agent}` : null,
        tmuxSession: tmux ? tmux.sessionName : null,
        tmuxRunning: tmux ? tmux.running : false,
        attachCommand: tmux ? `tmux attach -t ${tmux.sessionName}` : null,
        worktreePath: worktreePath || null,
        flags: flagged.flags,
        liveness: livenessInfo ? livenessInfo.liveness : null,
        lastSeenAt: livenessInfo ? livenessInfo.lastSeenAt : null,
        heartbeatAgeMs: livenessInfo ? livenessInfo.heartbeatAgeMs : null,
        idleState: livenessInfo ? (livenessInfo.idleState || null) : null,
        idleAtPrompt: livenessInfo ? Boolean(livenessInfo.idleAtPrompt) : false,
        idleAtPromptDetectedAt: livenessInfo ? (livenessInfo.idleAtPromptDetectedAt || null) : null,
        idleLadder,
        devServerEligible: Boolean(devServerEnabled && worktreePath),
        devServerPokeEligible: Boolean(
            devServerEnabled &&
            worktreePath &&
            !devServer.url &&
            isDevServerPokeEligible(flagged.status, flagged.flags, tmux ? tmux.running : false)
        ),
        devServerUrl: devServer.url
    };
}

function enrichReviewSessionsWithLiveness(absRepoPath, featureId, sessions) {
    if (!Array.isArray(sessions)) return sessions;
    return sessions.map(session => {
        if (!session.running || !session.agent || !session.session) return session;
        const livenessInfo = getAgentLiveness(absRepoPath, 'feature', featureId, session.agent);
        const idleResult = livenessInfo
            ? { idleAtPrompt: livenessInfo.idleAtPrompt, detectedAt: livenessInfo.idleAtPromptDetectedAt }
            : captureAndDetectIdle(session.session, session.agent);
        const idleAtPrompt = idleResult ? Boolean(idleResult.idleAtPrompt) : false;
        const idleAtPromptDetectedAt = idleResult ? (idleResult.detectedAt || idleResult.idleAtPromptDetectedAt || null) : null;
        const idleLadder = autoNudge.computeIdleLadder(absRepoPath, {
            entityType: 'feature',
            entityId: featureId,
            agentId: session.agent,
            role: 'review',
            status: session.status || 'in-progress',
            updatedAt: session.startedAt || new Date().toISOString(),
            flags: {},
            tmuxRunning: true,
            sessionName: session.session,
            idleAtPrompt,
            idleAtPromptDetectedAt,
        });
        return { ...session, idleLadder, idleAtPrompt, idleAtPromptDetectedAt };
    });
}

function computePendingCompletionSignal(dashboardStatus, fileStatus, taskType, snapshotAgentStatus, entityType) {
    if (!taskType) return null;
    const signal = entityType === 'research' && taskType === 'do'
        ? 'research-complete'
        : COMPLETION_SIGNAL_BY_TASK_TYPE[taskType];
    if (!signal) return null;
    const eff = fileStatus || dashboardStatus || '';
    if (signal === 'implementation-complete' || signal === 'research-complete') {
        // Do not short-circuit on snapshot `ready` alone: after `session-lost` the
        // engine may mark the slot ready while the status file still shows an open
        // `do` task — that is exactly when the escape hatch should appear (F405).
        if (['implementation-complete', 'research-complete', 'revision-complete'].includes(eff)) return null;
    } else if (signal === 'revision-complete') {
        if (snapshotAgentStatus === 'ready') return null;
        if (eff === 'revision-complete') return null;
    } else if (signal === 'review-complete') {
        if (eff === 'review-complete') return null;
    } else if (signal === 'spec-review-complete') {
        if (eff === 'spec-review-complete') return null;
    }
    return signal;
}

function buildFeatureAgentsFromSnapshot(options) {
    const {
        absRepoPath,
        featureId,
        snapshotStatuses,
        snapshotAgents,
        updatedAt,
        stateDir,
        worktreeBaseDir,
        devServerEnabled,
        caddyRoutes,
        repoAppId,
        reviewStatus,
    } = options;
    const parsed = { id: featureId };
    const agentMap = snapshotAgents || {};
    return Object.keys(snapshotStatuses)
        .sort((a, b) => a.localeCompare(b))
        .map(agent => {
            let agentFlags = {};
            let hasStatusFile = false;
            let awaitingInput = null;
            let fileStatus = null;
            let taskType = null;
            let fileUpdatedAt = null;
            let quotaPausedResetAt = null;
            // REGRESSION: workflow dirs use unpadded numeric ids; status files use
            // canonical padded ids — try both (same as agent-status.readAgentStatus).
            for (const cid of agentStatus.candidateIds(featureId)) {
                const statusData = readJsonSafe(path.join(stateDir, `feature-${cid}-${agent}.json`));
                if (statusData) {
                    agentFlags = parseStatusFlags(statusData.flags);
                    hasStatusFile = true;
                    fileStatus = statusData.status || null;
                    fileUpdatedAt = statusData.updatedAt || null;
                    taskType = statusData.taskType || null;
                    if (statusData.quotaPauseMeta && statusData.quotaPauseMeta.resetAt) {
                        quotaPausedResetAt = statusData.quotaPauseMeta.resetAt || null;
                    }
                    if (statusData.awaitingInput && statusData.awaitingInput.message) {
                        awaitingInput = statusData.awaitingInput;
                    }
                    break;
                }
            }

            const row = buildFeatureAgentRow({
                absRepoPath,
                parsed,
                agent,
                status: snapshotStatuses[agent] || 'implementing',
                updatedAt: fileUpdatedAt || updatedAt || new Date().toISOString(),
                flags: agentFlags,
                hasStatusFile,
                stateDir,
                worktreeBaseDir,
                devServerEnabled,
                caddyRoutes,
                repoAppId,
                reviewStatus,
                fileStatus,
            });
            row.awaitingInput = awaitingInput;
            // Surface per-feature {model, effort} overrides captured at start time
            // so dashboard cards can display the intended triplet next to the
            // agent badge. Null when the agent uses project defaults.
            const snapAgent = agentMap[agent] || {};
            row.modelOverride = snapAgent.modelOverride != null ? snapAgent.modelOverride : null;
            row.effortOverride = snapAgent.effortOverride != null ? snapAgent.effortOverride : null;
            // Runtime vs slot identity. After a failover, the slot keeps its
            // original id (e.g. cx) but `currentAgentId` becomes the new
            // runtime (e.g. cu). The frontend uses this to render "Cursor (was
            // cx)" instead of staying labelled as the original agent.
            row.runtimeAgentId = snapAgent.currentAgentId != null ? snapAgent.currentAgentId : agent;
            row.previousAgentId = snapAgent.previousAgentId != null ? snapAgent.previousAgentId : null;
            row.tokenExhausted = snapAgent.tokenExhausted ? { source: snapAgent.tokenExhausted.source || null, at: snapAgent.tokenExhausted.at || null } : null;
            row.quotaPausedResetAt = quotaPausedResetAt;
            // F405: escape hatch — show "Mark X complete" when agent status file exists
            // but the expected completion signal has not been recorded.
            const snapshotAgentStatus = snapshotStatuses[agent] || null;
            row.pendingCompletionSignal = hasStatusFile
                ? computePendingCompletionSignal(row.status, fileStatus, taskType, snapshotAgentStatus, 'feature')
                : null;
            // isWorking mirrors the ● Running spinner: tmux session exists and the
            // agent is not in a terminal/completion status. The escape hatch (Mark X
            // complete) is hidden while the session is running — it is only useful
            // after the session has ended without emitting a completion signal.
            row.isWorking = row.tmuxRunning && !NON_WORKING_AGENT_STATUSES.has(row.status);
            return row;
        });
}

function listWorkflowFeatureIds(absRepoPath) {
    return workflowReadModel.listWorkflowEntityIds(absRepoPath, 'feature');
}

function workflowFeatureIdsCovers(workflowFeatureIds, featureId) {
    if (workflowFeatureIds.has(featureId)) return true;
    const raw = String(featureId);
    if (!/^\d+$/.test(raw)) return false;
    const padded = String(parseInt(raw, 10)).padStart(2, '0');
    const unpadded = String(parseInt(raw, 10));
    return workflowFeatureIds.has(padded) || workflowFeatureIds.has(unpadded);
}

function resolveFeatureIdentity(absRepoPath, featureId, manifestsByFeatureId, snapshot, specIndex = null) {
    const manifest = manifestsByFeatureId[featureId] || null;
    const resolvedSpec = featureSpecResolver.resolveFeatureSpec(absRepoPath, featureId, { snapshot, specIndex });
    if (resolvedSpec.path) {
        const parsed = parseFeatureSpecFileName(path.basename(resolvedSpec.path));
        if (parsed) {
            return {
                id: featureId,
                name: parsed.name,
                specPath: resolvedSpec.path,
            };
        }
    }

    if (manifest && manifest.name) {
        return {
            id: featureId,
            name: manifest.name,
            specPath: resolvedSpec.path || manifest.specPath || (snapshot ? snapshot.specPath : null),
        };
    }

    return {
        id: featureId,
        name: `feature-${featureId}`,
        specPath: resolvedSpec.path || (snapshot ? snapshot.specPath : null),
    };
}

module.exports = {
    readJsonFilesByPattern,
    readFeatureManifests,
    readResearchManifests,
    buildFeatureAgentRow,
    enrichReviewSessionsWithLiveness,
    computePendingCompletionSignal,
    buildFeatureAgentsFromSnapshot,
    listWorkflowFeatureIds,
    workflowFeatureIdsCovers,
    resolveFeatureIdentity,
    NON_WORKING_AGENT_STATUSES,
};
