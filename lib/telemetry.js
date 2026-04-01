'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const agentRegistry = require('./agent-registry');

// ── Pricing table (per-token rates in USD) ──────────────────────────────────
// Rates are per input/output token. Cache tokens use separate rates.
// Source: https://docs.anthropic.com/en/docs/about-claude/models (Mar 2026)
const PRICING = {
    // Claude 4.x / Opus
    'claude-opus-4-6':             { input: 15 / 1e6, output: 75 / 1e6 },
    'claude-opus-4-5-20250620':    { input: 15 / 1e6, output: 75 / 1e6 },
    // Claude 4.x / Sonnet
    'claude-sonnet-4-6':           { input: 3 / 1e6, output: 15 / 1e6 },
    'claude-sonnet-4-5-20250514':  { input: 3 / 1e6, output: 15 / 1e6 },
    // Claude 4.x / Haiku
    'claude-haiku-4-5-20251001':   { input: 0.80 / 1e6, output: 4 / 1e6 },
    // Claude 3.5 (legacy)
    'claude-3-5-sonnet-20241022':  { input: 3 / 1e6, output: 15 / 1e6 },
    'claude-3-5-haiku-20241022':   { input: 0.80 / 1e6, output: 4 / 1e6 },
};

// Cache tokens are billed at 25% of input rate for reads, 25% extra for creation
const CACHE_READ_DISCOUNT = 0.10;   // 10% of input price
const CACHE_WRITE_PREMIUM = 1.25;   // 125% of input price

/**
 * Get pricing for a model ID. Falls back to sonnet pricing if unknown.
 * Handles version-suffixed model IDs (e.g. claude-sonnet-4-6-20260315).
 */
function getModelPricing(modelId) {
    if (!modelId) return PRICING['claude-sonnet-4-6'];
    if (PRICING[modelId]) return PRICING[modelId];

    // Try prefix match (strip date suffix)
    const base = modelId.replace(/-\d{8}$/, '');
    if (PRICING[base]) return PRICING[base];

    // Family-level fallback
    if (modelId.includes('opus')) return PRICING['claude-opus-4-6'];
    if (modelId.includes('haiku')) return PRICING['claude-haiku-4-5-20251001'];
    return PRICING['claude-sonnet-4-6']; // conservative default
}

/**
 * Compute cost from token usage and model pricing.
 */
function computeCost(usage, pricing) {
    const inputCost = (usage.input_tokens || 0) * pricing.input;
    const outputCost = (usage.output_tokens || 0) * pricing.output;
    const cacheReadCost = (usage.cache_read_input_tokens || 0) * pricing.input * CACHE_READ_DISCOUNT;
    const cacheWriteCost = (usage.cache_creation_input_tokens || 0) * pricing.input * CACHE_WRITE_PREMIUM;
    return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}

function toIsoOrNull(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function resolveTelemetryDir(repoPath = process.cwd()) {
    return path.join(path.resolve(repoPath), '.aigon', 'telemetry');
}

function writeNormalizedTelemetryRecord(record, options = {}) {
    if (!record || !record.featureId || !record.agent) return null;
    const repoPath = options.repoPath || record.repoPath || process.cwd();
    const telemetryDir = resolveTelemetryDir(repoPath);
    fs.mkdirSync(telemetryDir, { recursive: true });

    const featureId = String(record.featureId);
    const agent = String(record.agent || 'unknown').toLowerCase();
    const sessionId = String(record.sessionId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    const safeSessionId = sessionId.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filename = `feature-${featureId}-${agent}-${safeSessionId}.json`;
    const outputPath = path.join(telemetryDir, filename);

    const normalized = {
        schemaVersion: 1,
        source: record.source || 'unknown',
        sessionId,
        featureId,
        repoPath: path.resolve(record.repoPath || repoPath),
        agent,
        model: record.model || `${agent}-cli`,
        startAt: toIsoOrNull(record.startAt),
        endAt: toIsoOrNull(record.endAt),
        turnCount: Number.isFinite(Number(record.turnCount)) ? Number(record.turnCount) : 0,
        toolCalls: Number.isFinite(Number(record.toolCalls)) ? Number(record.toolCalls) : 0,
        tokenUsage: {
            input: Number(record.tokenUsage?.input || 0),
            output: Number(record.tokenUsage?.output || 0),
            cacheReadInput: Number(record.tokenUsage?.cacheReadInput || 0),
            cacheCreationInput: Number(record.tokenUsage?.cacheCreationInput || 0),
            thinking: Number(record.tokenUsage?.thinking || 0),
            total: Number(record.tokenUsage?.total || 0),
            billable: Number(record.tokenUsage?.billable || 0),
        },
        costUsd: Number.isFinite(Number(record.costUsd)) ? Number(record.costUsd) : 0,
    };

    fs.writeFileSync(outputPath, JSON.stringify(normalized, null, 2) + '\n');
    return outputPath;
}

// ── Claude JSONL transcript parsing ─────────────────────────────────────────

/**
 * Resolve the Claude Code projects directory for a given repo path.
 * Claude Code stores transcripts at: ~/.claude/projects/<escaped-path>/
 * where the path has / replaced with -
 */
function resolveClaudeProjectDir(repoPath) {
    const absPath = path.resolve(repoPath);
    const escaped = absPath.replace(/\//g, '-');
    return path.join(os.homedir(), '.claude', 'projects', escaped);
}

/**
 * Parse a Claude Code JSONL transcript file and extract token usage.
 * Returns { input_tokens, output_tokens, cache_creation_input_tokens,
 *           cache_read_input_tokens, total_tokens, model, cost_usd }
 */
function parseTranscriptFile(filePath) {
    const session = parseTranscriptSession(filePath);
    return {
        input_tokens: session.input_tokens,
        output_tokens: session.output_tokens,
        cache_creation_input_tokens: session.cache_creation_input_tokens,
        cache_read_input_tokens: session.cache_read_input_tokens,
        thinking_tokens: session.thinking_tokens,
        total_tokens: session.total_tokens,
        model: session.model,
        cost_usd: session.cost_usd,
    };
}

function parseTranscriptSession(filePath) {
    const result = {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        thinking_tokens: 0,
        total_tokens: 0,
        model: null,
        cost_usd: 0,
        turn_count: 0,
        tool_calls: 0,
        start_at: null,
        end_at: null,
    };

    let content;
    try {
        content = fs.readFileSync(filePath, 'utf8');
    } catch (_) {
        return result;
    }

    const lines = content.split('\n').filter(Boolean);
    for (const line of lines) {
        let record;
        try { record = JSON.parse(line); } catch (_) { continue; }

        if (record.type === 'assistant' || record.type === 'user') {
            result.turn_count++;
        }

        const ts = record.timestamp || record.ts || record.created_at || record.createdAt || null;
        const isoTs = toIsoOrNull(ts);
        if (isoTs && !result.start_at) result.start_at = isoTs;
        if (isoTs) result.end_at = isoTs;

        if (record.type !== 'assistant') continue;

        const msg = record.message;
        if (!msg || !msg.usage) continue;

        const usage = msg.usage;
        result.input_tokens += usage.input_tokens || 0;
        result.output_tokens += usage.output_tokens || 0;
        result.cache_creation_input_tokens += usage.cache_creation_input_tokens || 0;
        result.cache_read_input_tokens += usage.cache_read_input_tokens || 0;
        result.thinking_tokens += usage.thinking_tokens || usage.reasoning_tokens || 0;

        if (!result.model && msg.model) {
            result.model = msg.model;
        }

        if (Array.isArray(msg.content)) {
            for (const item of msg.content) {
                if (!item || typeof item !== 'object') continue;
                if (item.type === 'tool_use') result.tool_calls++;
            }
        }
        if (record.tool_name || record.toolName || record.type === 'tool_use') {
            result.tool_calls++;
        }
    }

    result.total_tokens = result.input_tokens + result.output_tokens
        + result.cache_creation_input_tokens + result.cache_read_input_tokens
        + result.thinking_tokens;

    // Compute cost from the dominant model
    const pricing = getModelPricing(result.model);
    result.cost_usd = Math.round(computeCost(result, pricing) * 10000) / 10000; // 4 decimal places

    return result;
}

/**
 * Find all JSONL transcript files associated with a feature's worktree or branch.
 * Claude Code creates a project dir per working directory, so worktrees get their own.
 *
 * @param {string} featureId - Feature number (e.g. "123")
 * @param {string} featureDesc - Feature slug (e.g. "aade-telemetry")
 * @param {Object} options
 * @param {string} [options.agentId] - Agent code (e.g. "cc")
 * @param {string} [options.repoPath] - Main repo path
 * @param {string} [options.worktreePath] - Worktree path (if applicable)
 * @returns {string[]} Array of JSONL file paths
 */
function findTranscriptFiles(featureId, featureDesc, options = {}) {
    const paths = new Set();
    const candidates = [];

    // When a worktreePath is provided (Fleet/worktree mode), ONLY check
    // worktree-specific dirs — NOT the main repo dir. The main repo dir
    // contains eval session transcripts that must not be attributed to
    // implementation agents.
    const hasWorktree = !!options.worktreePath;

    // Check main repo's Claude project dir (only for solo/Drive mode)
    if (options.repoPath && !hasWorktree) {
        candidates.push(resolveClaudeProjectDir(options.repoPath));
    }

    // Check worktree's Claude project dir
    if (options.worktreePath) {
        candidates.push(resolveClaudeProjectDir(options.worktreePath));
    }

    // Also try common worktree path patterns
    if (options.repoPath && options.agentId) {
        const worktreeBase = path.join(path.dirname(options.repoPath),
            path.basename(options.repoPath) + '-worktrees');
        const wtName = `feature-${featureId}-${options.agentId}-${featureDesc}`;
        candidates.push(resolveClaudeProjectDir(path.join(worktreeBase, wtName)));

        // Also check the -worktrees sibling pattern used by aigon
        const siblingWt = path.resolve(options.repoPath, '..', `${path.basename(options.repoPath)}-worktrees`, wtName);
        candidates.push(resolveClaudeProjectDir(siblingWt));
    }

    for (const dir of candidates) {
        if (!fs.existsSync(dir)) continue;
        try {
            const files = fs.readdirSync(dir)
                .filter(f => f.endsWith('.jsonl'))
                .map(f => path.join(dir, f));
            files.forEach(f => paths.add(f));
        } catch (_) {}
    }

    return [...paths];
}

/**
 * Capture telemetry for a feature by parsing all associated Claude Code transcripts.
 * Returns a flat object suitable for writing to log frontmatter.
 *
 * @param {string} featureId
 * @param {string} featureDesc
 * @param {Object} options - Same as findTranscriptFiles options, plus:
 * @param {number} [options.linesChanged] - For computing tokens_per_line_changed
 * @returns {Object} Telemetry fields for log frontmatter
 */
function captureFeatureTelemetry(featureId, featureDesc, options = {}) {
    const transcripts = findTranscriptFiles(featureId, featureDesc, options);
    if (transcripts.length === 0) return null;

    const totals = {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        thinking_tokens: 0,
        total_tokens: 0,
        cost_usd: 0,
        sessions: 0,
        model: null,
    };

    for (const file of transcripts) {
        const data = parseTranscriptFile(file);
        totals.input_tokens += data.input_tokens;
        totals.output_tokens += data.output_tokens;
        totals.cache_creation_input_tokens += data.cache_creation_input_tokens;
        totals.cache_read_input_tokens += data.cache_read_input_tokens;
        totals.thinking_tokens += data.thinking_tokens;
        totals.total_tokens += data.total_tokens;
        totals.cost_usd += data.cost_usd;
        totals.sessions += 1;
        if (!totals.model && data.model) totals.model = data.model;
    }

    // Round cost to 4 decimal places
    totals.cost_usd = Math.round(totals.cost_usd * 10000) / 10000;

    // Billable tokens = input + output + thinking (what you actually "use")
    // total_tokens includes cache reads/writes which inflate the number
    const billableTokens = totals.input_tokens + totals.output_tokens + totals.thinking_tokens;

    // Compute tokens per line changed using billable tokens only
    const linesChanged = options.linesChanged;
    const tokensPerLineChanged = (linesChanged && linesChanged > 0)
        ? Math.round((billableTokens / linesChanged) * 100) / 100
        : null;

    return {
        input_tokens: totals.input_tokens,
        output_tokens: totals.output_tokens,
        cache_creation_input_tokens: totals.cache_creation_input_tokens,
        cache_read_input_tokens: totals.cache_read_input_tokens,
        thinking_tokens: totals.thinking_tokens,
        total_tokens: totals.total_tokens,
        billable_tokens: billableTokens,
        cost_usd: totals.cost_usd,
        sessions: totals.sessions,
        model: totals.model || 'unknown',
        tokens_per_line_changed: tokensPerLineChanged,
    };
}

/**
 * Capture telemetry from a single transcript file and upsert into log frontmatter.
 * Used by the SessionEnd hook for incremental capture. Deduplicates by session ID.
 *
 * @param {string} transcriptPath - Path to the JSONL transcript file
 * @param {Object} options
 * @param {Function} options.parseFrontMatter - Frontmatter parser from utils
 * @param {Function} options.parseYamlScalar - YAML scalar parser from utils
 * @param {Function} options.serializeYamlScalar - YAML scalar serializer from utils
 * @param {Function} options.upsertLogFrontmatterScalars - Frontmatter upsert from utils
 * @param {string} options.logsDir - Path to feature logs directory
 * @param {Function} options.getCurrentBranch - Git branch getter
 */
function captureSessionTelemetry(transcriptPath, options = {}) {
    const { parseFrontMatter, parseYamlScalar, upsertLogFrontmatterScalars,
            logsDir, getCurrentBranch } = options;

    if (!transcriptPath || !fs.existsSync(transcriptPath)) return;

    const data = parseTranscriptFile(transcriptPath);
    if (data.total_tokens === 0) return;

    // Resolve feature context from branch name
    let branch;
    try { branch = getCurrentBranch(); } catch (_) { return; }
    if (!branch) return;

    const arenaMatch = branch.match(/^feature-(\d+)-([a-z]{2})-(.+)$/);
    const soloMatch = branch.match(/^feature-(\d+)-(.+)$/);
    let featureNum, agentId;
    if (arenaMatch) {
        featureNum = arenaMatch[1];
        agentId = arenaMatch[2];
    } else if (soloMatch) {
        featureNum = soloMatch[1];
        agentId = 'solo';
    } else {
        return; // not on a feature branch
    }

    // Find the log file
    if (!logsDir || !fs.existsSync(logsDir)) return;
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

    // Session deduplication
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

    const nextIds = [...seenIds, sessionId].filter(Boolean).slice(-25);
    const fields = {
        telemetry_session_ids: nextIds.join(','),
        session_count: parseNum(fm.session_count) + 1,
        input_tokens: parseNum(fm.input_tokens) + data.input_tokens,
        output_tokens: parseNum(fm.output_tokens) + data.output_tokens,
        cache_creation_input_tokens: parseNum(fm.cache_creation_input_tokens) + data.cache_creation_input_tokens,
        cache_read_input_tokens: parseNum(fm.cache_read_input_tokens) + data.cache_read_input_tokens,
        thinking_tokens: parseNum(fm.thinking_tokens) + data.thinking_tokens,
        total_tokens: parseNum(fm.total_tokens) + data.total_tokens,
        cost_usd: Math.round((parseNum(fm.cost_usd) + data.cost_usd) * 10000) / 10000,
    };

    upsertLogFrontmatterScalars(logPath, fields);

    try {
        const session = parseTranscriptSession(transcriptPath);
        writeNormalizedTelemetryRecord({
            source: 'claude-transcript',
            sessionId,
            featureId: featureNum,
            repoPath: process.cwd(),
            agent: agentId,
            model: session.model || data.model || 'claude',
            startAt: session.start_at,
            endAt: session.end_at || new Date().toISOString(),
            turnCount: session.turn_count,
            toolCalls: session.tool_calls,
            tokenUsage: {
                input: session.input_tokens,
                output: session.output_tokens,
                cacheReadInput: session.cache_read_input_tokens,
                cacheCreationInput: session.cache_creation_input_tokens,
                thinking: session.thinking_tokens,
                total: session.total_tokens,
                billable: session.input_tokens + session.output_tokens + session.thinking_tokens,
            },
            costUsd: session.cost_usd,
        }, { repoPath: process.cwd() });
    } catch (_) { /* best-effort */ }
}

// ── Git-based telemetry (universal, all agents) ─────────────────────────────

/**
 * Capture git-based telemetry for a specific agent's branch/worktree.
 * Works for any agent (cc, gg, cx, cu, mv) — no transcript parsing required.
 *
 * @param {string} featureId - Feature number (e.g. "151")
 * @param {string} featureDesc - Feature slug (e.g. "multi-agent-telemetry")
 * @param {Object} options
 * @param {string} [options.agentId] - Agent code (e.g. "cc", "gg")
 * @param {string} [options.baseRef] - Base ref for diff (default: main/master)
 * @param {string} [options.worktreePath] - Worktree path (for cwd)
 * @param {Function} options.getFeatureGitSignals - Git signals function from lib/git.js
 * @returns {Object|null} Git telemetry fields for log frontmatter
 */
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

/**
 * Capture telemetry for a single agent: git stats (always) + transcript telemetry (cc only).
 * Returns a combined object suitable for log frontmatter.
 *
 * @param {string} featureId
 * @param {string} featureDesc
 * @param {string} agentId - Agent code (e.g. "cc", "gg", "solo")
 * @param {Object} options
 * @param {string} [options.repoPath] - Main repo path
 * @param {string} [options.worktreePath] - Agent's worktree path
 * @param {string} [options.baseRef] - Base ref for git diff
 * @param {Function} options.getFeatureGitSignals - Git signals function
 * @param {number} [options.expectedScopeFiles]
 * @returns {Object} Combined telemetry fields
 */
function captureAgentTelemetry(featureId, featureDesc, agentId, options = {}) {
    const result = {};

    // 1. Git-based telemetry (universal — all agents)
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

    // 2. Transcript-based telemetry (agents with transcript capture capability)
    const hasTranscript = agentRegistry.supportsTranscriptTelemetry(agentId) || agentId === 'solo';
    if (hasTranscript) {
        const transcriptData = captureFeatureTelemetry(featureId, featureDesc, {
            agentId: hasTranscript ? agentId : undefined,
            repoPath: options.repoPath,
            worktreePath: options.worktreePath,
            linesChanged: gitData ? (gitData.lines_changed || 0) : 0,
        });
        if (transcriptData) {
            Object.assign(result, transcriptData);
        }
    } else {
        // Non-cc agents: set model but no cost/token fields
        result.model = `${agentId}-cli`;
    }

    return Object.keys(result).length > 0 ? result : null;
}

/**
 * Capture telemetry for ALL agents that participated in a feature.
 * Returns a map of agentId → telemetry data.
 *
 * @param {string} featureId
 * @param {string} featureDesc
 * @param {string[]} agents - Array of agent IDs (e.g. ["cc", "gg"])
 * @param {Object} options
 * @param {string} [options.repoPath] - Main repo path
 * @param {string} [options.baseRef] - Base ref for git diff
 * @param {Function} options.getFeatureGitSignals - Git signals function
 * @param {Function} options.getWorktreePath - (agentId) => worktree path or null
 * @param {number} [options.expectedScopeFiles]
 * @returns {Object} Map of agentId → telemetry fields
 */
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
        featureId: String(featureId),
        repoPath: options.repoPath || process.cwd(),
        agent: agent || 'solo',
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
    PRICING,
    getModelPricing,
    computeCost,
    resolveClaudeProjectDir,
    parseTranscriptFile,
    parseTranscriptSession,
    findTranscriptFiles,
    captureFeatureTelemetry,
    captureSessionTelemetry,
    captureGitTelemetry,
    captureAgentTelemetry,
    captureAllAgentsTelemetry,
    resolveTelemetryDir,
    writeNormalizedTelemetryRecord,
    writeAgentFallbackSession,
};
