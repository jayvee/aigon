'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const core = require('../core');
const pricing = require('../pricing');

const { toIsoOrNull, computeContextLoadTokens } = core;
const { getModelPricing, computeCost } = pricing;

function resolveClaudeProjectDir(repoPath) {
    const absPath = path.resolve(repoPath);
    // Claude Code slugifies paths by replacing both / and . with -
    const escaped = absPath.replace(/[/.]/g, '-');
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
        turns: [],
        context_load_tokens: 0,
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
        const turnInput = usage.input_tokens || 0;
        const turnOutput = usage.output_tokens || 0;
        const turnCachedInput = usage.cache_read_input_tokens || 0;
        result.input_tokens += turnInput;
        result.output_tokens += turnOutput;
        result.cache_creation_input_tokens += usage.cache_creation_input_tokens || 0;
        result.cache_read_input_tokens += turnCachedInput;
        result.thinking_tokens += usage.thinking_tokens || usage.reasoning_tokens || 0;

        result.turns.push({
            index: result.turns.length,
            inputTokens: turnInput,
            outputTokens: turnOutput,
            cachedInputTokens: turnCachedInput,
        });

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

    result.context_load_tokens = computeContextLoadTokens(result.turns);
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

    // For solo/Drive mode (no worktree), the main repo's Claude project dir
    // contains ALL session transcripts across all features — we cannot
    // reliably attribute them to a specific feature. Skip to avoid inflated
    // totals. Only worktree mode gives us feature-scoped transcript dirs.

    // Check worktree's Claude project dir
    if (options.worktreePath) {
        candidates.push(resolveClaudeProjectDir(options.worktreePath));
    }

    // Also try common worktree path patterns
    if (options.repoPath && options.agentId) {
        const repoName = path.basename(options.repoPath);
        const wtName = `feature-${featureId}-${options.agentId}-${featureDesc}`;

        // New location: ~/.aigon/worktrees/{repoName}/
        const newWorktreeBase = path.join(os.homedir(), '.aigon', 'worktrees', repoName);
        candidates.push(resolveClaudeProjectDir(path.join(newWorktreeBase, wtName)));

        // Legacy location: ../{repoName}-worktrees/
        const legacyWorktreeBase = path.resolve(options.repoPath, '..', `${repoName}-worktrees`);
        candidates.push(resolveClaudeProjectDir(path.join(legacyWorktreeBase, wtName)));
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

function parseTranscripts(worktreePath, options = {}) {
    if (!options.featureId) return null;
    return captureFeatureTelemetry(options.featureId, options.featureDesc || '', {
        agentId: options.agentId,
        repoPath: options.repoPath,
        worktreePath,
        linesChanged: options.linesChanged,
    });
}

module.exports = {
    strategyId: 'claude-transcript',
    parseTranscripts,
    resolveClaudeProjectDir,
    parseTranscriptFile,
    parseTranscriptSession,
    findTranscriptFiles,
    captureFeatureTelemetry,
};
