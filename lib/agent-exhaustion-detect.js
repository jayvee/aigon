'use strict';

/**
 * lib/agent-exhaustion-detect.js — token-exhaustion detection utilities (OSS).
 *
 * These are pure detection helpers with no side effects. The actual failover
 * action (killing tmux sessions, spawning replacements, recording switch events)
 * lives in @aigon/pro via the supervisor's registerExhaustionHandler hook.
 */

const fs = require('fs');
const { execSync } = require('child_process');
const agentRegistry = require('./agent-registry');
const telemetry = require('./telemetry');
const { getAgentFailoverConfig } = require('./config');

function decodePaneTail(encoded) {
    if (!encoded) return '';
    try {
        return Buffer.from(String(encoded), 'base64').toString('utf8');
    } catch (_) {
        return '';
    }
}

function getAgentRuntimeId(agentState, slotAgentId) {
    return String((agentState && agentState.currentAgentId) || slotAgentId || '').trim().toLowerCase();
}

function buildTokenExhaustionSignal({ slotAgentId, agentState, statusRecord, featureId, repoPath, failoverConfig }) {
    const runtimeAgentId = getAgentRuntimeId(agentState, slotAgentId);
    const detectors = agentRegistry.getTokenExhaustionDetectors(runtimeAgentId);
    const exitCode = Number(statusRecord && statusRecord.lastExitCode);
    const paneTail = String((statusRecord && statusRecord.lastPaneTail) || '');
    const lowerTail = paneTail.toLowerCase();
    const stderrMatched = detectors.stderrPatterns.some(pattern => lowerTail.includes(String(pattern).toLowerCase()));
    const exitCodeMatched = Number.isFinite(exitCode) && detectors.exitCodes.includes(exitCode);
    const telemetryLimit = failoverConfig && failoverConfig.tokenLimits
        ? Number(failoverConfig.tokenLimits.perSessionBillableTokens)
        : null;
    let telemetryMatched = false;
    let tokensConsumed = null;
    if (Number.isFinite(telemetryLimit) && telemetryLimit > 0) {
        const agg = telemetry.aggregateNormalizedTelemetryRecords(featureId, slotAgentId, { repoPath });
        if (agg && Number(agg.billable_tokens) > telemetryLimit) {
            telemetryMatched = true;
            tokensConsumed = Number(agg.billable_tokens);
        }
    }
    if (!(stderrMatched || telemetryMatched)) return null;
    let source = null;
    if (telemetryMatched) source = 'telemetry_limit';
    else if (stderrMatched && exitCodeMatched) source = 'stderr_pattern';
    if (!source) return null;
    return {
        slotAgentId,
        currentAgentId: runtimeAgentId,
        source,
        paneTail,
        exitCode: Number.isFinite(exitCode) ? exitCode : null,
        tokensConsumed,
        limit: telemetryMatched ? telemetryLimit : null,
    };
}

function resolveFailoverConfig(repoPath, snapshot) {
    return getAgentFailoverConfig(repoPath, snapshot);
}

function chooseNextAgent(chain, currentAgentId, excluded = []) {
    const normalizedChain = Array.isArray(chain) ? chain.map(v => String(v || '').trim().toLowerCase()).filter(Boolean) : [];
    if (normalizedChain.length === 0) return null;
    const current = String(currentAgentId || '').trim().toLowerCase();
    const excludedSet = new Set(excluded.map(v => String(v || '').trim().toLowerCase()).filter(Boolean));
    const currentIndex = normalizedChain.indexOf(current);
    const searchStart = currentIndex >= 0 ? currentIndex + 1 : 0;
    for (let i = searchStart; i < normalizedChain.length; i++) {
        const candidate = normalizedChain[i];
        if (!excludedSet.has(candidate)) return candidate;
    }
    return null;
}

function getLastReachableCommit(worktreePath) {
    if (!worktreePath || !fs.existsSync(worktreePath)) return null;
    try {
        return execSync('git rev-parse --short HEAD', {
            cwd: worktreePath,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim() || null;
    } catch (_) {
        return null;
    }
}

module.exports = {
    decodePaneTail,
    getAgentRuntimeId,
    buildTokenExhaustionSignal,
    resolveFailoverConfig,
    getLastReachableCommit,
    chooseNextAgent,
};
