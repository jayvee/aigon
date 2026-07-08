'use strict';

const fs = require('fs');
const path = require('path');
const agentRegistry = require('../agent-registry');
const core = require('./core');
const cc = require('./providers/cc');
const { getProviderByStrategy } = require('./providers/registry');

const { parseTranscriptFile, parseTranscriptSession } = cc;

const {
    aggregateNormalizedTelemetryRecords,
    writeNormalizedTelemetryRecord,
} = core;

function captureSessionTelemetry(transcriptPath, options = {}) {
    const { parseFrontMatter, parseYamlScalar, upsertLogFrontmatterScalars,
            logsDir, getCurrentBranch } = options;

    if (!transcriptPath || !fs.existsSync(transcriptPath)) return;

    const data = parseTranscriptFile(transcriptPath);
    if (data.total_tokens === 0) return;

    // Resolve entity context: env vars (set by shell trap) take priority over branch name
    let featureNum, agentId, entityType = 'feature';
    const telemetryRepoPath = process.env.AIGON_PROJECT_PATH || process.cwd();

    if (process.env.AIGON_ENTITY_TYPE && process.env.AIGON_ENTITY_ID && process.env.AIGON_AGENT_ID) {
        entityType = process.env.AIGON_ENTITY_TYPE;
        featureNum = process.env.AIGON_ENTITY_ID;
        agentId = process.env.AIGON_AGENT_ID;
    } else {
        let branch;
        try { branch = getCurrentBranch(telemetryRepoPath); } catch (_) { return; }
        if (!branch) return;
        const arenaMatch = branch.match(/^feature-(\d+)-([a-z]{2})-(.+)$/);
        const soloMatch = branch.match(/^feature-(\d+)-(.+)$/);
        if (arenaMatch) {
            featureNum = arenaMatch[1];
            agentId = arenaMatch[2];
        } else if (soloMatch) {
            featureNum = soloMatch[1];
            agentId = 'solo';
        } else {
            return; // not on a feature branch and no env vars — nothing to capture
        }
    }

    // Infer activity from branch name or env context
    let activity = 'implement'; // default fallback
    if (process.env.AIGON_ACTIVITY) {
        activity = process.env.AIGON_ACTIVITY;
    } else {
        let branch;
        try { branch = getCurrentBranch(telemetryRepoPath); } catch (_) { /* use default */ }
        if (branch) {
            // spec-review must be checked before review (spec-review contains 'review')
            if (/spec-review|spec-revise|spec-check/.test(branch)) activity = 'spec_review';
            else if (/\beval\b/.test(branch)) activity = 'evaluate';
            else if (/\breview\b/.test(branch)) activity = 'review';
            else if (/\bdraft\b/.test(branch)) activity = 'draft';
        }
    }

    // Write normalized telemetry record (always — both feature and research)
    // Use AIGON_PROJECT_PATH if set (worktree agents run outside the main repo dir)
    try {
        const session = parseTranscriptSession(transcriptPath);
        const sessionId = path.basename(transcriptPath).replace(/\.jsonl$/i, '');
        const totalInputTokens = session.input_tokens + (session.cache_read_input_tokens || 0);
        writeNormalizedTelemetryRecord({
            source: 'claude-transcript',
            sessionId,
            entityType,
            featureId: featureNum,
            repoPath: telemetryRepoPath,
            agent: agentId,
            activity,
            model: session.model || data.model || 'claude',
            startAt: session.start_at,
            endAt: session.end_at || new Date().toISOString(),
            turnCount: session.turn_count,
            toolCalls: session.tool_calls,
            tokenUsage: {
                // Claude API `input_tokens` = fresh (non-cached) only; add cache_read to get total,
                // matching the cx convention so freshInputTokens = input - cacheReadInput > 0.
                input: totalInputTokens,
                output: session.output_tokens,
                cacheReadInput: session.cache_read_input_tokens,
                cacheCreationInput: session.cache_creation_input_tokens,
                thinking: session.thinking_tokens,
                total: session.total_tokens,
                billable: totalInputTokens + session.output_tokens + session.thinking_tokens,
            },
            costUsd: session.cost_usd,
            turns: session.turns,
            contextLoadTokens: session.context_load_tokens,
            workflowRunId: process.env.AIGON_WORKFLOW_RUN_ID || null,
        }, { repoPath: telemetryRepoPath });
    } catch (_) { /* best-effort */ }

    // Update log file frontmatter — only for features (research findings files are user-visible)
    if (entityType !== 'feature') return;
    if (!logsDir || !fs.existsSync(logsDir)) return;
    try {
        const padded = featureNum.padStart(2, '0');
        const allLogs = fs.readdirSync(logsDir)
            .filter(f => f.startsWith(`feature-${padded}-`) && f.endsWith('-log.md'));
        if (allLogs.length === 0) return;

        let logFile;
        if (agentId !== 'solo') {
            logFile = allLogs.find(f => f.startsWith(`feature-${padded}-${agentId}-`));
        }
        if (!logFile) {
            logFile = allLogs.find(f => !f.match(new RegExp(`^feature-${padded}-[a-z]{2}-`)));
        }
        if (!logFile) logFile = allLogs[0];
        const logPath = path.join(logsDir, logFile);

        const sessionId = path.basename(transcriptPath).replace(/\.jsonl$/i, '');
        const logContent = fs.readFileSync(logPath, 'utf8');
        const fm = parseFrontMatter(logContent).data || {};
        const seenIds = String(fm.telemetry_session_ids || '')
            .split(',').map(v => v.trim()).filter(Boolean);
        if (sessionId && seenIds.includes(sessionId)) return;

        const parseNum = (value) => {
            const parsed = typeof value === 'string' ? parseYamlScalar(value) : value;
            const n = Number(parsed);
            return Number.isFinite(n) ? n : 0;
        };

        upsertLogFrontmatterScalars(logPath, {
            telemetry_session_ids: [...seenIds, sessionId].filter(Boolean).slice(-25).join(','),
            session_count: parseNum(fm.session_count) + 1,
            input_tokens: parseNum(fm.input_tokens) + data.input_tokens,
            output_tokens: parseNum(fm.output_tokens) + data.output_tokens,
            cache_creation_input_tokens: parseNum(fm.cache_creation_input_tokens) + data.cache_creation_input_tokens,
            cache_read_input_tokens: parseNum(fm.cache_read_input_tokens) + data.cache_read_input_tokens,
            thinking_tokens: parseNum(fm.thinking_tokens) + data.thinking_tokens,
            total_tokens: parseNum(fm.total_tokens) + data.total_tokens,
            cost_usd: Math.round((parseNum(fm.cost_usd) + data.cost_usd) * 10000) / 10000,
        });
    } catch (_) { /* best-effort */ }
}

function captureGitTelemetry(featureId, featureDesc, options = {}) {
    const { agentId, baseRef, worktreePath, getFeatureGitSignals } = options;
    if (!getFeatureGitSignals) return null;

    // Build branch name for this agent
    const targetRef = (agentId && agentId !== 'solo')
        ? `feature-${featureId}-${agentId}-${featureDesc}`
        : `feature-${featureId}-${featureDesc}`;

    try {
        const signals = getFeatureGitSignals({
            baseRef: baseRef || undefined,
            targetRef,
            cwd: worktreePath || undefined,
            expectedScopeFiles: options.expectedScopeFiles || 10,
        });

        return {
            commit_count: signals.commit_count,
            lines_added: signals.lines_added,
            lines_removed: signals.lines_removed,
            lines_changed: signals.lines_changed,
            files_touched: signals.files_touched,
            fix_commit_count: signals.fix_commit_count,
            fix_commit_ratio: signals.fix_commit_ratio,
            rework_thrashing: signals.rework_thrashing,
            rework_fix_cascade: signals.rework_fix_cascade,
            rework_scope_creep: signals.rework_scope_creep,
        };
    } catch (_) {
        return null;
    }
}

function captureNoTelemetryCursor(featureId, options = {}) {
    writeNormalizedTelemetryRecord({
        source: 'no-telemetry-cursor',
        sessionId: `feature-${featureId}-cu-${Date.now()}`,
        entityType: 'feature',
        featureId: String(featureId),
        repoPath: options.repoPath || process.cwd(),
        agent: 'cu',
        activity: 'implement',
        model: 'cursor',
        startAt: null,
        endAt: new Date().toISOString(),
        turnCount: 0,
        toolCalls: 0,
        tokenUsage: {
            input: null, output: null,
            cacheReadInput: null, cacheCreationInput: null,
            thinking: null, total: null, billable: null,
        },
        costUsd: null,
    }, { repoPath: options.repoPath || process.cwd() });
    return { model: 'cursor', source: 'no-telemetry-cursor' };
}

function captureAgentTelemetry(featureId, featureDesc, agentId, options = {}) {
    const result = {};

    const gitData = captureGitTelemetry(featureId, featureDesc, {
        agentId: agentId !== 'solo' ? agentId : undefined,
        baseRef: options.baseRef,
        worktreePath: options.worktreePath,
        getFeatureGitSignals: options.getFeatureGitSignals,
        expectedScopeFiles: options.expectedScopeFiles,
    });
    if (gitData) {
        Object.assign(result, gitData);
    }

    const hasTranscript = agentRegistry.supportsTranscriptTelemetry(agentId) || agentId === 'solo';
    const linesChanged = gitData ? (gitData.lines_changed || 0) : 0;

    if (hasTranscript) {
        const aggregated = aggregateNormalizedTelemetryRecords(featureId, agentId, {
            repoPath: options.repoPath,
            linesChanged,
            afterMs: options.afterMs,
        });
        if (aggregated) {
            Object.assign(result, aggregated);
            return Object.keys(result).length > 0 ? result : null;
        }
    }

    const tStrat = agentRegistry.getTelemetryStrategy(agentId);
    const worktree = options.worktreePath || options.repoPath;

    if (tStrat === 'no-telemetry-cursor') {
        Object.assign(result, captureNoTelemetryCursor(featureId, options));
    } else if (tStrat && hasTranscript && worktree) {
        const provider = getProviderByStrategy(tStrat);
        if (provider && typeof provider.parseTranscripts === 'function') {
            const parseOpts = {
                featureId,
                entityType: 'feature',
                repoPath: options.repoPath,
                linesChanged,
            };
            if (options.afterMs != null) parseOpts.afterMs = options.afterMs;
            const transcriptData = provider.parseTranscripts(worktree, parseOpts);
            if (transcriptData) Object.assign(result, transcriptData);
        }
    } else if (hasTranscript) {
        const transcriptData = cc.captureFeatureTelemetry(featureId, featureDesc, {
            agentId: agentId !== 'solo' ? agentId : undefined,
            repoPath: options.repoPath,
            worktreePath: options.worktreePath,
            linesChanged,
        });
        if (transcriptData) {
            Object.assign(result, transcriptData);
        }
    } else {
        result.model = `${agentId}-cli`;
    }

    return Object.keys(result).length > 0 ? result : null;
}

function captureAllAgentsTelemetry(featureId, featureDesc, agents, options = {}) {
    const results = {};
    const agentList = agents && agents.length > 0 ? agents : ['solo'];

    for (const agentId of agentList) {
        const worktreePath = options.getWorktreePath
            ? options.getWorktreePath(agentId)
            : options.worktreePath;

        const data = captureAgentTelemetry(featureId, featureDesc, agentId, {
            repoPath: options.repoPath,
            worktreePath,
            baseRef: options.baseRef,
            getFeatureGitSignals: options.getFeatureGitSignals,
            expectedScopeFiles: options.expectedScopeFiles,
        });

        if (data) {
            results[agentId] = data;
        } else {
            // Emit a fallback record so every agent has at least a trace
            writeAgentFallbackSession(featureId, agentId, {
                repoPath: options.repoPath || process.cwd(),
                source: 'feature-close-fallback',
                model: `${agentId}-cli`,
                endAt: new Date().toISOString(),
                sessionId: `feature-${featureId}-${agentId}-${Date.now()}`,
            });
            results[agentId] = null;
        }
    }

    return results;
}

function writeAgentFallbackSession(featureId, agent, options = {}) {
    const ts = options.endAt || new Date().toISOString();
    return writeNormalizedTelemetryRecord({
        source: options.source || 'agent-fallback',
        sessionId: options.sessionId || `close-${Date.now()}`,
        entityType: options.entityType || 'feature',
        featureId: String(featureId),
        repoPath: options.repoPath || process.cwd(),
        agent: agent || 'solo',
        activity: options.activity || 'implement',
        model: options.model || `${agent || 'solo'}-cli`,
        startAt: options.startAt || ts,
        endAt: ts,
        turnCount: options.turnCount || 0,
        toolCalls: options.toolCalls || 0,
        tokenUsage: {
            input: 0,
            output: 0,
            cacheReadInput: 0,
            cacheCreationInput: 0,
            thinking: 0,
            total: 0,
            billable: 0,
        },
        costUsd: options.costUsd || 0,
    }, { repoPath: options.repoPath || process.cwd() });
}

module.exports = {
    captureSessionTelemetry,
    captureGitTelemetry,
    captureAgentTelemetry,
    captureAllAgentsTelemetry,
    writeAgentFallbackSession,
};
