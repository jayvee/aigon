'use strict';

const fs = require('fs');
const path = require('path');
const workflowReadModel = require('../workflow-read-model');
const { getStateRenderMeta } = require('../state-render-meta');
const { computeCardHeadline } = require('../card-headline');
const { buildCardPresentation } = require('../card-presentation');
const signalHealth = require('../signal-health');
const autoNudge = require('../auto-nudge');
const { STAGE_FOLDERS } = require('../workflow-core/paths');
const { buildResearchTmuxSessionName, tmuxSessionExists } = require('../worktree');
const { getAgentLiveness } = require('../supervisor');
const {
    normalizeDashboardStatus,
    RUNTIME_TASK_FILE_STATUSES,
    parseStatusFlags,
    maybeFlagEndedSession,
} = require('../dashboard-status-helpers');
const { getTierCache } = require('./tier-cache');
const {
    safeReadDir,
    safeStat,
    safeStatMtimeMs,
    safeStatIsoTimes,
    buildDetailFingerprint,
    listStageSpecFiles,
    collectDoneSpecs,
    buildEntityDisplayKey,
} = require('./safe-reads');
const { readComplexityFromSpec, buildProvenanceFields } = require('./spec-meta');
const { summarizeReviewSessions } = require('./set-cards');
const {
    readResearchManifests,
    computePendingCompletionSignal,
    NON_WORKING_AGENT_STATUSES,
} = require('./entity-core');

function collectResearch(repoContext, response) {
    const { absRepoPath, stateDir } = repoContext;
    const tierCache = getTierCache(absRepoPath);
    const researchRoot = path.join(absRepoPath, 'docs', 'specs', 'research-topics');
    const researchLogsDir = path.join(researchRoot, 'logs');
    const stagePriority = {
        'inbox': 0,
        'backlog': 1,
        'in-progress': 2,
        'in-evaluation': 3,
        'paused': 4,
        'done': 5,
    };

    const researchSpecFiles = listStageSpecFiles([
        { dir: path.join(researchRoot, STAGE_FOLDERS.INBOX), stage: 'inbox', pattern: /^research-.+\.md$/ },
        { dir: path.join(researchRoot, STAGE_FOLDERS.BACKLOG), stage: 'backlog', pattern: /^research-\d+-.+\.md$/ },
        { dir: path.join(researchRoot, STAGE_FOLDERS.IN_PROGRESS), stage: 'in-progress', pattern: /^research-\d+-.+\.md$/ },
        { dir: path.join(researchRoot, STAGE_FOLDERS.IN_EVALUATION), stage: 'in-evaluation', pattern: /^research-\d+-.+\.md$/ },
        { dir: path.join(researchRoot, STAGE_FOLDERS.PAUSED), stage: 'paused', pattern: /^research-\d+-.+\.md$/ },
    ]);

    const researchDoneDir = path.join(researchRoot, STAGE_FOLDERS.DONE);
    const doneDirMtime = safeStat(researchDoneDir)?.mtimeMs || 0;
    if (doneDirMtime !== tierCache.cold.researchDirMtime) {
        tierCache.cold.researchDirMtime = doneDirMtime;
        tierCache.cold.research = collectDoneSpecs(researchDoneDir, /^research-\d+-.+\.md$/, 10, { entityType: 'research' });
    }
    const doneSpecs = tierCache.cold.research;
    doneSpecs.recent.forEach(({ file }) => {
        researchSpecFiles.push({ file, stage: 'done', dir: researchDoneDir });
    });

    const dedupedResearchSpecFiles = [];
    const researchSpecByKey = new Map();
    researchSpecFiles.forEach(specEntry => {
        const match = specEntry.file.match(/^research-(\d+)-(.+)\.md$/) || specEntry.file.match(/^research-(.+)\.md$/);
        if (!match) return;
        const hasNumericId = /^\d+$/.test(match[1]);
        const dedupeKey = hasNumericId ? match[1] : specEntry.file;
        const existing = researchSpecByKey.get(dedupeKey);
        if (!existing || (stagePriority[specEntry.stage] ?? -1) > (stagePriority[existing.stage] ?? -1)) {
            researchSpecByKey.set(dedupeKey, specEntry);
        }
    });
    dedupedResearchSpecFiles.push(...researchSpecByKey.values());

    const researchManifestsById = readResearchManifests(stateDir);
    const researchLogsByAgent = {};
    safeReadDir(researchLogsDir, file => /^research-(\d+)-([a-z]{2})-findings\.md$/.test(file)).forEach(file => {
        const match = file.match(/^research-(\d+)-([a-z]{2})-findings\.md$/);
        if (!match) return;
        if (!researchLogsByAgent[match[1]]) researchLogsByAgent[match[1]] = [];
        researchLogsByAgent[match[1]].push(match[2]);
    });

    const research = [];
    dedupedResearchSpecFiles.forEach(({ file, stage, dir: specDir }) => {
        const match = file.match(/^research-(\d+)-(.+)\.md$/) || file.match(/^research-(.+)\.md$/);
        if (!match) return;
        const hasId = /^\d+$/.test(match[1]);
        const id = hasId ? match[1] : null;
        const name = hasId ? match[2] : match[1];
        const initialResearchState = workflowReadModel.getResearchDashboardState(absRepoPath, id || name, stage, []);
        const snapshot = initialResearchState.workflowSnapshot;
        const effectiveStage = initialResearchState.stage || stage;
        const agents = [];
        const isActiveStage = effectiveStage === 'in-progress' || effectiveStage === 'in-evaluation';
        const snapshotStatuses = initialResearchState.snapshotStatuses || {};

        if (id && isActiveStage) {
            const researchManifest = researchManifestsById[id] || null;
            const manifestAgents = researchManifest && Array.isArray(researchManifest.agents) && researchManifest.agents.length > 0
                ? researchManifest.agents
                : null;
            const fromLogs = researchLogsByAgent[id] ? [...new Set(researchLogsByAgent[id])] : [];
            const fromSnapshot = Object.keys(snapshotStatuses);
            const agentList = [...new Set([...(manifestAgents || []), ...fromLogs, ...fromSnapshot])];

            agentList.slice().sort((a, b) => a.localeCompare(b)).forEach(agent => {
                const sessionName = buildResearchTmuxSessionName(id, agent, { repo: path.basename(absRepoPath), role: 'do' });
                const tmuxRunning = tmuxSessionExists(sessionName);
                const statusFile = path.join(stateDir, `research-${id}-${agent}.json`);
                let normalizedStatus = 'implementing';
                let normalizedUpdatedAt = new Date().toISOString();
                let agentFlags = {};
                let hasStatusFile = false;
                let awaitingInput = null;
                let quotaPausedResetAt = null;

                try {
                    if (fs.existsSync(statusFile)) {
                        const parsedStatus = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
                        normalizedUpdatedAt = parsedStatus.updatedAt || normalizedUpdatedAt;
                        agentFlags = parseStatusFlags(parsedStatus.flags);
                        hasStatusFile = true;
                        if (parsedStatus.awaitingInput && parsedStatus.awaitingInput.message) {
                            awaitingInput = parsedStatus.awaitingInput;
                        }
                        if (parsedStatus.quotaPauseMeta && parsedStatus.quotaPauseMeta.resetAt) {
                            quotaPausedResetAt = parsedStatus.quotaPauseMeta.resetAt || null;
                        }
                        const fileNorm = normalizeDashboardStatus(parsedStatus.status);
                        if (RUNTIME_TASK_FILE_STATUSES.has(fileNorm)) {
                            normalizedStatus = fileNorm;
                        } else {
                            normalizedStatus = snapshotStatuses[agent] || fileNorm;
                        }
                    } else {
                        normalizedStatus = snapshotStatuses[agent] || 'implementing';
                    }
                } catch (_) { /* ignore */ }

                const flagged = maybeFlagEndedSession(absRepoPath, {
                    entityType: 'research',
                    id,
                    agent,
                    status: normalizedStatus,
                    flags: agentFlags,
                    tmuxRunning,
                    researchLogsDir,
                    hasStatusFile
                });
                const displayStatus = normalizedStatus === 'quota-paused' ? 'quota-paused' : flagged.status;
                const findingsFile = path.join(researchLogsDir, `research-${id}-${agent}-findings.md`);
                const RESEARCH_DONE_STATUSES = new Set(['research-complete', 'ready', 'submitted', 'implementation-complete', 'revision-complete', 'feedback-addressed']);
                const canViewFindings = RESEARCH_DONE_STATUSES.has(flagged.status) || Boolean(flagged.flags && flagged.flags.sessionEnded);
                const researchLiveness = getAgentLiveness(absRepoPath, 'research', id, agent);
                const idleLadder = autoNudge.computeIdleLadder(absRepoPath, {
                    entityType: 'research',
                    entityId: id,
                    agentId: agent,
                    role: 'do',
                    status: displayStatus,
                    updatedAt: normalizedUpdatedAt,
                    flags: flagged.flags,
                    tmuxRunning,
                    sessionName,
                    idleAtPrompt: researchLiveness ? Boolean(researchLiveness.idleAtPrompt) : false,
                    idleAtPromptDetectedAt: researchLiveness ? researchLiveness.idleAtPromptDetectedAt : null,
                });
                const researchSnapshotStatus = snapshotStatuses[agent] || null;
                // F405: escape hatch for research agents — all research agents have role 'do'
                const researchPendingSignal = hasStatusFile
                    ? computePendingCompletionSignal(displayStatus, null, 'do', researchSnapshotStatus, 'research')
                    : null;
                if (hasStatusFile) {
                    signalHealth.recordMissedSignalIfDue({
                        repoPath: absRepoPath,
                        entityType: 'research',
                        entityId: id,
                        agent,
                        lastStatus: displayStatus,
                        lastStatusAt: normalizedUpdatedAt,
                        sessionName,
                        expected: `advance-from-${displayStatus}`,
                    });
                }
                const snapResearchAgent = snapshot && snapshot.agents && snapshot.agents[agent]
                    ? snapshot.agents[agent]
                    : null;
                agents.push({
                    id: agent,
                    status: displayStatus,
                    updatedAt: normalizedUpdatedAt,
                    flags: flagged.flags,
                    liveness: researchLiveness ? researchLiveness.liveness : null,
                    lastSeenAt: researchLiveness ? researchLiveness.lastSeenAt : null,
                    heartbeatAgeMs: researchLiveness ? researchLiveness.heartbeatAgeMs : null,
                    idleState: researchLiveness ? (researchLiveness.idleState || null) : null,
                    idleAtPrompt: researchLiveness ? Boolean(researchLiveness.idleAtPrompt) : false,
                    idleAtPromptDetectedAt: researchLiveness ? (researchLiveness.idleAtPromptDetectedAt || null) : null,
                    idleLadder,
                    findingsPath: canViewFindings ? findingsFile : null,
                    slashCommand: displayStatus === 'waiting' ? `aigon terminal-focus ${String(id).padStart(2, '0')} ${agent} --research` : null,
                    tmuxSession: tmuxRunning ? sessionName : null,
                    tmuxRunning,
                    attachCommand: tmuxRunning ? `tmux attach -t ${sessionName}` : null,
                    awaitingInput,
                    pendingCompletionSignal: researchPendingSignal,
                    isWorking: tmuxRunning && !NON_WORKING_AGENT_STATUSES.has(displayStatus),
                    modelOverride: snapResearchAgent && snapResearchAgent.modelOverride != null ? snapResearchAgent.modelOverride : null,
                    effortOverride: snapResearchAgent && snapResearchAgent.effortOverride != null ? snapResearchAgent.effortOverride : null,
                    quotaPausedResetAt,
                });
                response.summary.total++;
                if (['implementation-complete', 'revision-complete', 'research-complete', 'review-complete', 'spec-review-complete'].includes(displayStatus)) {
                    response.summary.complete = (response.summary.complete || 0) + 1;
                } else {
                    response.summary[displayStatus] = (response.summary[displayStatus] || 0) + 1;
                }
            });
        }

        // F460: reuse the baseState resolved by the empty-agents call above to
        // skip a duplicate snapshot+events read for the agent-aware pass.
        const researchState = workflowReadModel.getResearchDashboardState(absRepoPath, id || name, effectiveStage, agents, { baseState: initialResearchState });

        const researchReviewSummary = summarizeReviewSessions(researchState.reviewSessions);
        const researchSpecPath = path.join(specDir, file);
        const researchTimes = snapshot
            ? {
                updatedAt: snapshot.updatedAt || new Date().toISOString(),
                createdAt: snapshot.createdAt || snapshot.updatedAt || new Date().toISOString(),
            }
            : safeStatIsoTimes(researchSpecPath);
        research.push({
            id: id || name,
            displayKey: buildEntityDisplayKey('research', id),
            name,
            stage: effectiveStage,
            complexity: readComplexityFromSpec(researchSpecPath),
            ...buildProvenanceFields(snapshot, researchSpecPath),
            specPath: researchSpecPath,
            updatedAt: researchTimes.updatedAt,
            createdAt: researchTimes.createdAt,
            agents,
            anyAwaitingInput: agents.some(a => a.awaitingInput && a.awaitingInput.message),
            anyIdleAtPrompt: agents.some(a => a.idleAtPrompt === true),
            evalStatus: researchState.evalStatus,
            evalSession: researchState.evalSession,
            reviewStatus: researchState.reviewStatus,
            reviewSessionSummary: researchReviewSummary,
            specReviewSessions: researchState.specReviewSessions,
            specRevisionSessions: researchState.specRevisionSessions,
            specCheckSessions: researchState.specCheckSessions,
            reviewState: researchState.reviewState,
            validActions: researchState.validActions,
            nextAction: researchState.nextAction,
            nextActions: researchState.nextActions,
            specDrift: researchState.specDrift,
            workflowEventCount: Array.isArray(researchState.workflowEvents) ? researchState.workflowEvents.length : 0,
            detailFingerprint: buildDetailFingerprint(
                researchTimes.updatedAt,
                safeStatMtimeMs(researchSpecPath),
                (researchState.workflowEvents || []).length,
                researchReviewSummary
            ),
            stateRenderMeta: getStateRenderMeta(snapshot && (snapshot.currentSpecState || snapshot.lifecycle)),
            cardHeadline: computeCardHeadline(
                {
                    evalStatus: researchState.evalStatus,
                    specDrift: researchState.specDrift,
                },
                snapshot || null,
                agents,
                null,
                effectiveStage,
                { entityType: 'research' }
            ),
            reviewCycles: Array.isArray(snapshot && snapshot.reviewCycles) ? snapshot.reviewCycles : [],
        });
    });

    research.forEach((row) => {
        if (!row.cardHeadline) return;
        row.cardPresentation = buildCardPresentation(row, { entityType: 'research' });
    });

    return {
        research,
        researchDoneTotal: doneSpecs.total,
    };
}

module.exports = {
    collectResearch,
};
