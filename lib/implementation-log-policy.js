'use strict';

const fs = require('fs');
const path = require('path');
const { loadProjectConfig } = require('./config');
const {
    detectImplementationLogMode,
    resolveImplementationLogVariant,
} = require('./profile-placeholders');
const { resolveImplementationLogSearchRoots } = require('./review-escalation');
const {
    resolveCloseIntegrityPolicy,
    isCloseFindingBlocking,
} = require('./close-integrity-policy');
const wf = require('./workflow-core');

function snapshotModeToLogMode(snapshotMode) {
    if (snapshotMode === 'fleet') return 'fleet';
    if (snapshotMode === 'solo_worktree') return 'drive-wt';
    return 'drive';
}

function isImplementationLogRequired(mode, loggingLevel) {
    return resolveImplementationLogVariant(mode, loggingLevel) !== 'skip';
}

function discoverImplementationLogFiles(repoRoot, featureId, agentId = 'solo') {
    const logsDir = path.join(repoRoot, 'docs', 'specs', 'features', 'logs');
    if (!fs.existsSync(logsDir)) return [];
    const num = String(featureId).padStart(2, '0');
    const logPattern = agentId === 'solo'
        ? `feature-${num}-`
        : `feature-${num}-${agentId}-`;
    try {
        const logFiles = fs.readdirSync(logsDir)
            .filter((f) => f.startsWith(logPattern) && f.endsWith('-log.md'));
        if (agentId === 'solo') {
            return logFiles.filter((f) => !f.match(new RegExp(`^feature-${num}-[a-z]{2}-`)));
        }
        return logFiles;
    } catch (_) {
        return [];
    }
}

function buildExpectedLogPattern(featureId, agentId, mode) {
    const num = String(featureId).padStart(2, '0');
    if (mode === 'fleet' || mode === 'drive-wt') {
        const id = agentId && agentId !== 'solo' ? agentId : '<agent>';
        return `docs/specs/features/logs/feature-${num}-${id}-*-log.md`;
    }
    return `docs/specs/features/logs/feature-${num}-*-log.md`;
}

function findImplementationLogPath(repoPath, featureId, options = {}) {
    const agentId = options.agentId || 'solo';
    const roots = options.searchRoots
        || resolveImplementationLogSearchRoots(repoPath, featureId, options);
    for (const root of roots) {
        const files = discoverImplementationLogFiles(root, featureId, agentId);
        if (files.length > 0) {
            return path.join(root, 'docs', 'specs', 'features', 'logs', files[0]);
        }
    }
    return null;
}

function resolveLogAgentId(snapshot, mode) {
    if (mode === 'drive') return 'solo';
    const agents = snapshot && snapshot.agents ? Object.keys(snapshot.agents) : [];
    if (snapshot && snapshot.winnerAgentId) return snapshot.winnerAgentId;
    if (snapshot && snapshot.authorAgentId) return snapshot.authorAgentId;
    const concrete = agents.find((id) => id !== 'solo');
    return concrete || 'solo';
}

function checkImplementationLogEvidence(opts) {
    const {
        repoPath,
        featureId,
        agentId,
        loggingLevel,
        mode,
        scanCwd,
        worktreePath,
        snapshot,
    } = opts;
    const logMode = mode
        ?? (snapshot && snapshot.mode ? snapshotModeToLogMode(snapshot.mode) : null)
        ?? detectImplementationLogMode(scanCwd || worktreePath || repoPath);
    if (!isImplementationLogRequired(logMode, loggingLevel)) {
        return {
            ok: true,
            required: false,
            reason: loggingLevel === 'never' ? 'logging_level is "never"' : 'not required in this mode',
        };
    }
    const resolvedAgentId = agentId || resolveLogAgentId(snapshot, logMode);
    const logPath = findImplementationLogPath(repoPath, featureId, {
        agentId: resolvedAgentId,
        cwd: scanCwd,
        worktreePath,
    });
    if (!logPath) {
        const expectedPattern = buildExpectedLogPattern(featureId, resolvedAgentId, logMode);
        return {
            ok: false,
            required: true,
            expectedPattern,
            reason: `required implementation log missing (expected ${expectedPattern})`,
        };
    }
    return { ok: true, required: true, logPath };
}

function formatImplementationLogBlockMessage(featureId, evidence) {
    const id = String(featureId || '').trim().padStart(2, '0');
    return `Implementation log required for feature ${id}. Create ${evidence.expectedPattern} with at least one line, commit it, then retry.`;
}

async function recordImplementationLogFailure(repoPath, featureId, payload) {
    const at = new Date().toISOString();
    const gateFailedEvent = {
        type: 'feature.close_gate_failed',
        featureId: String(featureId),
        gateKind: 'implementation-log',
        expectedPattern: payload.expectedPattern || null,
        outputTail: payload.outputTail || '',
        exitCode: 1,
        at,
    };
    const events = [gateFailedEvent];
    if (!payload.alreadyInRecovery) {
        events.push({
            type: 'feature.close_recovery.started',
            agentId: process.env.AIGON_AGENT_ID || null,
            source: 'cli',
            returnSpecState: payload.returnSpecState || 'ready',
            at,
        });
    }
    await wf.persistEntityEvents(repoPath, 'feature', String(featureId), events);
}

async function runImplementationLogCloseGuard(repoPath, featureId, options = {}) {
    const snapshot = options.snapshot || await wf.showFeatureOrNull(repoPath, featureId);
    const config = options.config || loadProjectConfig(repoPath);
    const logMode = snapshotModeToLogMode(snapshot && snapshot.mode);
    const evidence = checkImplementationLogEvidence({
        repoPath,
        featureId,
        loggingLevel: config.logging_level,
        mode: logMode,
        worktreePath: options.worktreePath,
        snapshot,
    });
    if (evidence.ok || !evidence.required) return { ok: true };

    const policy = options.integrityPolicy || resolveCloseIntegrityPolicy(config);
    const message = formatImplementationLogBlockMessage(featureId, evidence);
    if (!isCloseFindingBlocking(policy, 'implementation-log')) {
        await wf.persistEntityEvents(repoPath, 'feature', String(featureId), [{
            type: 'feature.close_finding_advisory',
            featureId: String(featureId),
            gateKind: 'implementation-log',
            expectedPattern: evidence.expectedPattern,
            outputTail: message,
            at: new Date().toISOString(),
        }]);
        console.warn(`⚠️  ${message}`);
        console.warn('   Advisory only under current featureClose integrity policy; close will continue.');
        return { ok: true, advisory: true, evidence };
    }

    const returnSpecState = (snapshot && snapshot.currentSpecState) || 'ready';
    await recordImplementationLogFailure(repoPath, featureId, {
        expectedPattern: evidence.expectedPattern,
        outputTail: message,
        returnSpecState: returnSpecState === 'close_recovery_in_progress' ? 'ready' : returnSpecState,
        alreadyInRecovery: snapshot && snapshot.currentSpecState === 'close_recovery_in_progress',
    });
    console.error(`❌ ${message}`);
    return { ok: false, evidence };
}

module.exports = {
    snapshotModeToLogMode,
    isImplementationLogRequired,
    discoverImplementationLogFiles,
    buildExpectedLogPattern,
    findImplementationLogPath,
    resolveLogAgentId,
    checkImplementationLogEvidence,
    formatImplementationLogBlockMessage,
    recordImplementationLogFailure,
    runImplementationLogCloseGuard,
};
