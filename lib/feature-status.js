'use strict';

/**
 * Deep feature status — computed on demand, not cached.
 *
 * Single function: collectFeatureDeepStatus(repoPath, featureId, options)
 * Returns a flat object with sections: identity, session, progress, cost, spec.
 * New sections get added as properties — nothing else changes.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const { safeTmuxSessionExists, resolveFeatureWorktreePath, detectDefaultBranch } = require('./dashboard-status-helpers');
const { shellQuote } = require('./worktree');
const workflowSnapshotAdapter = require('./workflow-snapshot-adapter');
const telemetry = require('./telemetry');
const featureSpecResolver = require('./feature-spec-resolver');
const agentRegistry = require('./agent-registry');
const { getEntityRoot } = require('./workflow-core/paths');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runGitSafe(cmd, cwd) {
    try {
        return execSync(cmd, {
            encoding: 'utf8',
            cwd: cwd || undefined,
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 5000,
        }).trim();
    } catch (_) {
        return '';
    }
}

function worktreeBaseDir(repoPath) {
    const repoName = path.basename(repoPath);
    return path.join(os.homedir(), '.aigon', 'worktrees', repoName);
}

// ---------------------------------------------------------------------------
// Stats record — persistent feature stats in .aigon/workflows/features/{id}/stats.json
// ---------------------------------------------------------------------------

function statsPath(repoPath, entityType, entityId) {
    return path.join(getEntityRoot(repoPath, entityType, entityId), 'stats.json');
}

function readStats(repoPath, entityType, entityId) {
    const p = statsPath(repoPath, entityType, entityId);
    try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (_) {
        return null;
    }
}

function writeStats(repoPath, entityType, entityId, data) {
    const p = statsPath(repoPath, entityType, entityId);
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const existing = readStats(repoPath, entityType, entityId) || {};
    const merged = Object.assign({}, existing, data, { updatedAt: new Date().toISOString() });
    const tmp = `${p}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(merged, null, 2));
    fs.renameSync(tmp, p);
    return merged;
}

// ---------------------------------------------------------------------------
// Section collectors
// ---------------------------------------------------------------------------

function collectIdentity(repoPath, featureId, snapshot) {
    const specResult = featureSpecResolver.resolveFeatureSpec(repoPath, featureId, { snapshot });
    const specPath = specResult ? specResult.path : null;
    const specName = specPath
        ? path.basename(specPath, '.md').replace(/^feature-\d+-/, '')
        : null;

    return {
        id: featureId,
        name: specName || `feature-${featureId}`,
        lifecycle: snapshot ? (snapshot.lifecycle || null) : null,
        mode: snapshot ? (snapshot.mode || null) : null,
        startedAt: snapshot ? (snapshot.createdAt || null) : null,
    };
}

function collectSession(featureId, agentId) {
    if (!agentId || agentId === 'solo') {
        return { tmuxAlive: false, sessionName: null, pid: null, uptimeSeconds: null };
    }
    const result = safeTmuxSessionExists(featureId, agentId);
    if (!result) {
        return { tmuxAlive: false, sessionName: null, pid: null, uptimeSeconds: null };
    }

    let pid = null;
    let uptimeSeconds = null;
    if (result.running && result.sessionName) {
        // Get tmux session PID and creation time
        try {
            const info = execSync(
                `tmux display-message -t ${shellQuote(result.sessionName)} -p "#{session_created} #{pane_pid}"`,
                { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }
            ).trim();
            const parts = info.split(' ');
            if (parts.length >= 1 && parts[0]) {
                const createdEpoch = parseInt(parts[0], 10);
                if (Number.isFinite(createdEpoch)) {
                    uptimeSeconds = Math.floor(Date.now() / 1000) - createdEpoch;
                }
            }
            if (parts.length >= 2 && parts[1]) {
                pid = parseInt(parts[1], 10) || null;
            }
        } catch (_) { /* tmux query failed */ }
    }

    return {
        tmuxAlive: result.running,
        sessionName: result.sessionName,
        pid,
        uptimeSeconds,
    };
}

function collectProgress(repoPath, featureId, agentId, worktreePath) {
    const cwd = worktreePath || repoPath;
    const defaultBranch = detectDefaultBranch(cwd);
    const quoted = shellQuote(cwd);

    const defaults = {
        commitCount: 0,
        lastCommitAt: null,
        lastCommitMessage: null,
        filesChanged: 0,
        linesAdded: 0,
        linesRemoved: 0,
    };

    // Count commits ahead of default branch
    const countStr = runGitSafe(`git -C ${quoted} rev-list --count ${defaultBranch}..HEAD`, cwd);
    const commitCount = parseInt(countStr, 10) || 0;
    if (commitCount === 0) return defaults;

    // Last commit info
    const lastCommitAt = runGitSafe(`git -C ${quoted} log -1 --format=%aI`, cwd) || null;
    const lastCommitMessage = runGitSafe(`git -C ${quoted} log -1 --format=%s`, cwd) || null;

    // Diff stats against default branch
    const diffStat = runGitSafe(`git -C ${quoted} diff --stat --numstat ${defaultBranch}..HEAD`, cwd);
    let filesChanged = 0, linesAdded = 0, linesRemoved = 0;
    if (diffStat) {
        for (const line of diffStat.split('\n')) {
            const m = line.match(/^(\d+)\t(\d+)\t/);
            if (m) {
                linesAdded += parseInt(m[1], 10) || 0;
                linesRemoved += parseInt(m[2], 10) || 0;
                filesChanged += 1;
            }
        }
    }

    return { commitCount, lastCommitAt, lastCommitMessage, filesChanged, linesAdded, linesRemoved };
}

function collectCost(repoPath, featureId, agentId, worktreePath, entityType = 'feature', participatingAgents = []) {
    const defaults = {
        inputTokens: 0,
        cachedInputTokens: 0,
        freshInputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0,
        totalTokens: 0,
        billableTokens: 0,
        estimatedUsd: 0,
        model: null,
        sessions: 0,
        costByAgent: {},
    };

    // Try reading from telemetry JSON files first
    const telemetryDir = path.join(repoPath, '.aigon', 'telemetry');
    const prefix = entityType === 'research' ? 'research' : 'feature';

    let inputTokens = 0, cachedInputTokens = 0, outputTokens = 0, thinkingTokens = 0, totalTokens = 0, costUsd = 0, model = null, sessions = 0;
    const costByAgent = {};
    let hasRealData = false;

    function ensureAgentRow(id) {
        if (!costByAgent[id]) {
            costByAgent[id] = {
                agent: id,
                model: null,
                inputTokens: 0,
                cachedInputTokens: 0,
                freshInputTokens: 0,
                outputTokens: 0,
                thinkingTokens: 0,
                totalTokens: 0,
                billableTokens: 0,
                costUsd: 0,
                sessions: 0,
                hasRealData: false,
            };
        }
        return costByAgent[id];
    }

    if (fs.existsSync(telemetryDir)) {
        try {
            const files = fs.readdirSync(telemetryDir)
                .filter(f => f.startsWith(`${prefix}-${featureId}-`) && (f.endsWith('.json') || f.endsWith('.json.gz')));
            for (const file of files) {
                try {
                    const data = JSON.parse(telemetry.readTelemetryFile(path.join(telemetryDir, file)));
                    const input = data.tokenUsage?.input || 0;
                    const cachedInput = data.tokenUsage?.cacheReadInput || 0;
                    const output = data.tokenUsage?.output || 0;
                    const thinking = data.tokenUsage?.thinking || 0;
                    const total = data.tokenUsage?.total || 0;
                    const billable = data.tokenUsage?.billable || 0;
                    const cost = data.costUsd || 0;
                    const isFallback = data.source === 'feature-close-fallback' || (typeof data.source === 'string' && data.source.startsWith('no-telemetry'));
                    const recordHasRealData = !isFallback && (input > 0 || cachedInput > 0 || output > 0 || thinking > 0 || total > 0 || billable > 0 || cost > 0);
                    if (recordHasRealData) hasRealData = true;
                    inputTokens += input;
                    cachedInputTokens += cachedInput;
                    outputTokens += output;
                    thinkingTokens += thinking;
                    totalTokens += total;
                    costUsd += cost;
                    if (!model && data.model) model = data.model;
                    sessions += 1;
                    const agentKey = (data.agent || 'unknown').toLowerCase();
                    const row = ensureAgentRow(agentKey);
                    row.inputTokens += input;
                    row.cachedInputTokens += cachedInput;
                    row.outputTokens += output;
                    row.thinkingTokens += thinking;
                    row.totalTokens += total;
                    row.billableTokens += billable || (input + output + thinking);
                    row.costUsd += cost;
                    row.sessions += 1;
                    if (!row.model && data.model) row.model = data.model;
                    if (recordHasRealData) row.hasRealData = true;
                } catch (_) { /* skip bad files */ }
            }
        } catch (_) { /* ignore */ }
    }

    // Ensure participating agents always have a row, even with no telemetry file
    for (const id of (participatingAgents || [])) {
        if (id) ensureAgentRow(id.toLowerCase());
    }

    // Fallback: for transcript-based agents (CC/solo) with no real telemetry data yet,
    // parse the CC JSONL transcript directly. This covers features closed before the
    // close phase began writing normalized JSON records.
    if (!hasRealData && agentId && (agentRegistry.supportsTranscriptTelemetry(agentId) || agentId === 'solo') && entityType !== 'research') {
        try {
            // Derive feature description for transcript search (best-effort)
            const featureDesc = (() => {
                const logsDir = path.join(repoPath, 'docs', 'specs', 'features', 'logs');
                if (!fs.existsSync(logsDir)) return null;
                const padded = String(featureId).padStart(2, '0');
                const logFile = fs.readdirSync(logsDir).find(f => f.startsWith(`feature-${padded}-`) && f.endsWith('-log.md'));
                if (!logFile) return null;
                // Extract description from filename: feature-NN-[agent-]desc-log.md
                const m = logFile.match(/^feature-\d+-(?:[a-z]{2}-)?(.+)-log\.md$/);
                return m ? m[1] : null;
            })();
            const transcriptData = telemetry.captureFeatureTelemetry(featureId, featureDesc || '', {
                agentId: agentId !== 'solo' ? agentId : undefined,
                repoPath,
                worktreePath: worktreePath || undefined,
            });
            if (transcriptData && transcriptData.cost_usd > 0) {
                const transcriptInput = transcriptData.input_tokens || 0;
                const transcriptCached = transcriptData.cache_read_input_tokens || 0;
                const transcriptOutput = transcriptData.output_tokens || 0;
                const transcriptThinking = transcriptData.thinking_tokens || 0;
                const transcriptCost = Math.round((transcriptData.cost_usd || 0) * 10000) / 10000;
                const tcAgentId = (agentId !== 'solo' ? agentId : 'cc').toLowerCase();
                const tcRow = ensureAgentRow(tcAgentId);
                tcRow.inputTokens = transcriptInput;
                tcRow.cachedInputTokens = transcriptCached;
                tcRow.freshInputTokens = Math.max(0, transcriptInput - transcriptCached);
                tcRow.outputTokens = transcriptOutput;
                tcRow.thinkingTokens = transcriptThinking;
                tcRow.totalTokens = transcriptData.total_tokens || (transcriptInput + transcriptOutput + transcriptCached + transcriptThinking);
                tcRow.billableTokens = transcriptData.billable_tokens || (transcriptInput + transcriptOutput + transcriptThinking);
                tcRow.costUsd = transcriptCost;
                tcRow.model = transcriptData.model || null;
                tcRow.sessions = transcriptData.sessions || 1;
                tcRow.hasRealData = true;
                return {
                    inputTokens: transcriptInput,
                    cachedInputTokens: transcriptCached,
                    freshInputTokens: Math.max(0, transcriptInput - transcriptCached),
                    outputTokens: transcriptOutput,
                    thinkingTokens: transcriptThinking,
                    totalTokens: tcRow.totalTokens,
                    billableTokens: tcRow.billableTokens,
                    estimatedUsd: transcriptCost,
                    model: transcriptData.model || null,
                    sessions: transcriptData.sessions || 1,
                    costByAgent,
                };
            }
        } catch (_) { /* transcript parsing failed — use what we have */ }
    }

    if (!hasRealData && sessions === 0 && Object.keys(costByAgent).length === 0) return defaults;

    // Derive combined model label
    const models = [...new Set(Object.values(costByAgent).map(a => a.model).filter(Boolean))];
    const modelLabel = models.length === 1 ? models[0] : (models.length > 1 ? models.join(', ') : model);
    Object.values(costByAgent).forEach(agentData => {
        agentData.freshInputTokens = Math.max(0, agentData.inputTokens - agentData.cachedInputTokens);
    });
    const billableTokens = inputTokens + outputTokens + thinkingTokens;

    return {
        inputTokens,
        cachedInputTokens,
        freshInputTokens: Math.max(0, inputTokens - cachedInputTokens),
        outputTokens,
        thinkingTokens,
        totalTokens: totalTokens || (inputTokens + outputTokens + cachedInputTokens + thinkingTokens),
        billableTokens,
        estimatedUsd: Math.round(costUsd * 10000) / 10000,
        model: modelLabel,
        sessions,
        costByAgent,
    };
}

function collectSpec(repoPath, featureId, snapshot) {
    const specResult = featureSpecResolver.resolveFeatureSpec(repoPath, featureId, { snapshot });
    const specPath = specResult ? specResult.path : null;

    let criteriaTotal = 0, criteriaDone = 0;
    if (specPath && fs.existsSync(specPath)) {
        try {
            const content = fs.readFileSync(specPath, 'utf8');
            const unchecked = (content.match(/- \[ \]/g) || []).length;
            const checked = (content.match(/- \[x\]/gi) || []).length;
            criteriaTotal = unchecked + checked;
            criteriaDone = checked;
        } catch (_) { /* ignore */ }
    }

    // Find log path
    const logsDir = path.join(repoPath, 'docs', 'specs', 'features', 'logs');
    let logPath = null;
    if (fs.existsSync(logsDir)) {
        try {
            const padded = String(featureId).padStart(2, '0');
            const logFile = fs.readdirSync(logsDir)
                .find(f => f.startsWith(`feature-${padded}-`) && f.endsWith('-log.md'));
            if (logFile) logPath = path.join(logsDir, logFile);
        } catch (_) { /* ignore */ }
    }

    return { criteriaTotal, criteriaDone, specPath, logPath };
}

// ---------------------------------------------------------------------------
// Main collector
// ---------------------------------------------------------------------------

/**
 * Compute deep status for a feature (or research) on demand.
 *
 * @param {string} repoPath - Absolute path to the repo root
 * @param {string} featureId - Numeric feature ID (e.g. "199")
 * @param {Object} [options]
 * @param {string} [options.entityType] - 'feature' or 'research' (default: 'feature')
 * @returns {Object} Deep status object
 */
function relativePath(absRepo, p) {
    if (!p) return null;
    if (p.startsWith(absRepo)) return path.relative(absRepo, p);
    // Worktree paths are outside the repo — show relative to home
    const home = os.homedir();
    if (p.startsWith(home)) return '~' + p.slice(home.length);
    return p;
}

function collectFeatureDeepStatus(repoPath, featureId, options = {}) {
    const entityType = options.entityType || 'feature';
    const currentCheckoutPath = options.currentCheckoutPath ? path.resolve(options.currentCheckoutPath) : null;
    const absRepo = path.resolve(repoPath);

    // Read workflow snapshot
    const snapshot = workflowSnapshotAdapter.readWorkflowSnapshotSync(absRepo, entityType, featureId);
    const lifecycle = snapshot ? (snapshot.lifecycle || null) : null;
    const isDone = lifecycle === 'done' || lifecycle === 'closed';

    // Read persisted stats record
    const stats = readStats(absRepo, entityType, featureId);

    // Determine primary agent
    const agents = snapshot && snapshot.agents ? Object.keys(snapshot.agents) : [];
    let primaryAgent = agents[0] || null;

    // For done features with no agent in snapshot, infer from the log filename (legacy close path)
    if (!primaryAgent && isDone && entityType !== 'research') {
        try {
            const logsDir = path.join(absRepo, 'docs', 'specs', 'features', 'logs');
            if (fs.existsSync(logsDir)) {
                const padded = String(featureId).padStart(2, '0');
                const logFile = fs.readdirSync(logsDir).find(f => f.startsWith(`feature-${padded}-`) && f.endsWith('-log.md'));
                if (logFile) {
                    const m = logFile.match(/^feature-\d+-([a-z]{2})-/);
                    if (m) primaryAgent = m[1];
                }
            }
        } catch (_) { /* best-effort */ }
    }

    // Resolve worktree path (only useful for in-progress features)
    const wtBase = worktreeBaseDir(absRepo);
    const worktreePath = (!isDone && primaryAgent)
        ? resolveFeatureWorktreePath(wtBase, featureId, primaryAgent, absRepo)
        : null;

    // Collect identity (always from snapshot)
    const identity = collectIdentity(absRepo, featureId, snapshot);

    // Session: for done features, show "Completed"; for in-progress, show live tmux
    let session;
    if (isDone) {
        session = {
            completed: true,
            tmuxAlive: false,
            localSessionActive: false,
            sessionName: null,
            pid: null,
            uptimeSeconds: null,
            completedAt: (stats && stats.completedAt) || null,
            durationMs: (stats && stats.durationMs) || null,
        };
    } else {
        session = collectSession(featureId, primaryAgent);
        if (!session.tmuxAlive && currentCheckoutPath && worktreePath && path.resolve(worktreePath) === currentCheckoutPath) {
            session.localSessionActive = true;
        }
    }

    // Progress: use stats record as base, overlay live data for in-progress features
    let progress;
    if (stats && (stats.commitCount != null || stats.filesChanged != null)) {
        progress = {
            commitCount: stats.commitCount || 0,
            lastCommitAt: stats.lastCommitAt || null,
            lastCommitMessage: stats.lastCommitMessage || null,
            filesChanged: stats.filesChanged || 0,
            linesAdded: stats.linesAdded || 0,
            linesRemoved: stats.linesRemoved || 0,
        };
    }
    // For in-progress features with a worktree, overlay live git data
    if (!isDone && worktreePath) {
        const liveProgress = collectProgress(absRepo, featureId, primaryAgent, worktreePath);
        if (liveProgress.commitCount > 0) {
            progress = liveProgress;
        }
    }
    if (!progress) {
        progress = collectProgress(absRepo, featureId, primaryAgent, worktreePath);
    }

    // Cost: use stats record if available and complete, otherwise collect live
    let cost;
    if (stats && stats.cost && stats.cost.totalTokens != null) {
        cost = stats.cost;
    } else {
        cost = collectCost(absRepo, featureId, primaryAgent, worktreePath, entityType, agents);
    }

    const spec = collectSpec(absRepo, featureId, snapshot);

    // Per-agent sessions (for multi-agent / Fleet)
    const agentSessions = {};
    if (!isDone) {
        for (const agentId of agents) {
            agentSessions[agentId] = collectSession(featureId, agentId);
        }
    }

    // Make paths relative
    if (spec.specPath) spec.specPath = relativePath(absRepo, spec.specPath);
    if (spec.logPath) spec.logPath = relativePath(absRepo, spec.logPath);
    const relativeWorktreePath = relativePath(absRepo, worktreePath);

    return {
        ...identity,
        agents: agents.length > 0 ? agents : (primaryAgent ? [primaryAgent] : []),
        primaryAgent,
        session,
        agentSessions,
        progress,
        cost,
        spec,
        worktreePath: relativeWorktreePath,
        collectedAt: new Date().toISOString(),
    };
}

module.exports = {
    collectFeatureDeepStatus,
    readStats,
    writeStats,
};
