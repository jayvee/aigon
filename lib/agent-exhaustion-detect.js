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
const { readAgentStatusRecordAt, writeAgentStatusAt } = require('./agent-status');

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

function buildTokenExhaustionSignal({ slotAgentId, agentState, statusRecord, featureId, repoPath, failoverConfig, livePaneTail }) {
    const runtimeAgentId = getAgentRuntimeId(agentState, slotAgentId);
    const detectors = agentRegistry.getTokenExhaustionDetectors(runtimeAgentId);
    // Distinguish "no exit code recorded" (null/undefined) from exit code 0.
    // Number(null) === 0, which would otherwise silently treat alive agents
    // as if they had exited cleanly.
    const rawExit = statusRecord ? statusRecord.lastExitCode : undefined;
    const exitCode = (rawExit === null || rawExit === undefined) ? null : Number(rawExit);
    const exitCodeKnown = exitCode !== null && Number.isFinite(exitCode);
    const paneTail = String((statusRecord && statusRecord.lastPaneTail) || '');
    const lowerTail = paneTail.toLowerCase();
    const stderrMatched = detectors.stderrPatterns.some(pattern => lowerTail.includes(String(pattern).toLowerCase()));
    const exitCodeMatched = exitCodeKnown && detectors.exitCodes.includes(exitCode);
    // Live-pane detection is DISABLED. It scanned captured tmux pane text of a
    // still-running agent for quota-message substrings, with no exit-code
    // requirement. That is fundamentally unreliable: this repo's domain *is*
    // token/quota/rate-limit management, so any agent reading, quoting, or
    // grepping the code or docs mid-implementation would print those substrings
    // and get silently failed over — sometimes within a minute of starting
    // (see F668: cc killed 68s in via `live_pane_pattern`). Trimming the
    // wordlist was whack-a-mole; the whole live-pane heuristic is removed.
    // `livePaneTail` is retained in the signature only for caller compatibility
    // and is intentionally ignored. Exhaustion now relies solely on the two
    // reliable signals below: a genuine process exit (stderr pattern + exit
    // code) and measured billable-token telemetry crossing the configured limit.
    void livePaneTail;
    const livePaneMatched = false;
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
    if (!(stderrMatched || telemetryMatched || livePaneMatched)) return null;
    let source = null;
    if (telemetryMatched) source = 'telemetry_limit';
    else if (livePaneMatched) source = 'live_pane_pattern';
    else if (stderrMatched && exitCodeMatched) source = 'stderr_pattern';
    if (!source) return null;
    return {
        slotAgentId,
        currentAgentId: runtimeAgentId,
        source,
        paneTail,
        exitCode: exitCodeKnown ? exitCode : null,
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

/**
 * Clear token-exhaustion markers on the per-slot agent status file after a
 * successful failover handoff (auto or dashboard). Keeps supervisor detection
 * from staying suppressed for the same slot on subsequent exhaustion events.
 */
function clearTokenExhaustedFlag(repoPath, featureId, agentId, runtimeAgentId, worktreePath) {
    const existing = readAgentStatusRecordAt(repoPath, featureId, agentId, { prefixes: ['feature'] });
    const current = existing && existing.data ? existing.data : {};
    const flags = { ...(current.flags || {}) };
    delete flags.tokenExhausted;
    delete flags.tokenExhaustedAt;
    delete flags.tokenExhaustedSource;
    delete flags.sessionEnded;
    delete flags.sessionEndedAt;
    writeAgentStatusAt(repoPath, featureId, agentId, {
        status: 'implementing',
        worktreePath: worktreePath || current.worktreePath || null,
        runtimeAgentId: runtimeAgentId || current.runtimeAgentId || agentId,
        lastExitCode: null,
        lastPaneTail: null,
        flags,
    }, 'feature');
}

module.exports = {
    decodePaneTail,
    getAgentRuntimeId,
    buildTokenExhaustionSignal,
    resolveFailoverConfig,
    getLastReachableCommit,
    chooseNextAgent,
    clearTokenExhaustedFlag,
};
