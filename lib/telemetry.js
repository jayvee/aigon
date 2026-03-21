'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

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
    const result = {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        thinking_tokens: 0,
        total_tokens: 0,
        model: null,
        cost_usd: 0,
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

    // Check main repo's Claude project dir
    if (options.repoPath) {
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

    // Compute tokens per line changed
    const linesChanged = options.linesChanged;
    const tokensPerLineChanged = (linesChanged && linesChanged > 0)
        ? Math.round((totals.total_tokens / linesChanged) * 100) / 100
        : null;

    return {
        input_tokens: totals.input_tokens,
        output_tokens: totals.output_tokens,
        cache_creation_input_tokens: totals.cache_creation_input_tokens,
        cache_read_input_tokens: totals.cache_read_input_tokens,
        thinking_tokens: totals.thinking_tokens,
        total_tokens: totals.total_tokens,
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
}

module.exports = {
    PRICING,
    getModelPricing,
    computeCost,
    resolveClaudeProjectDir,
    parseTranscriptFile,
    findTranscriptFiles,
    captureFeatureTelemetry,
    captureSessionTelemetry,
};
