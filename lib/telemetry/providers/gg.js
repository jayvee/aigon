'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const core = require('../core');
const pricing = require('../pricing');

const { toIsoOrNull, computeContextLoadTokens, writeNormalizedTelemetryRecord, normalisePath } = core;
const { getModelPricing, computeCost } = pricing;

function resolveGeminiChatsDir(projectPath, options = {}) {
    const absPath = normalisePath(projectPath);
    const geminiBase = path.join(os.homedir(), '.gemini', 'tmp');
    if (!fs.existsSync(geminiBase)) return null;

    // Strategy 2: scan for any dir whose .project_root matches absPath.
    // Don't restrict to slug-prefix match — Gemini may use a hash-shaped dir
    // name on some platforms; the only authoritative key is .project_root.
    let allDirs;
    try { allDirs = fs.readdirSync(geminiBase); } catch (_) { return null; }

    for (const d of allDirs) {
        const projectRootFile = path.join(geminiBase, d, '.project_root');
        try {
            if (!fs.existsSync(projectRootFile)) continue;
            const storedPath = normalisePath(fs.readFileSync(projectRootFile, 'utf8'));
            if (storedPath === absPath) {
                const chatsDir = path.join(geminiBase, d, 'chats');
                if (fs.existsSync(chatsDir)) return chatsDir;
            }
        } catch (_) { /* unreadable — skip this dir, keep scanning */ }
    }

    // Strategy 3: timing-gap fallback. On a freshly-created bench worktree
    // the `.project_root` marker may not yet be written. If options.afterMs
    // is provided, scan all chats dirs for a session whose startTime falls
    // inside the window [afterMs, now] and return its chats dir.
    if (options.afterMs != null) {
        const minMs = Number(options.afterMs);
        let bestDir = null;
        let bestStart = -Infinity;
        for (const d of allDirs) {
            const chatsDir = path.join(geminiBase, d, 'chats');
            let chatFiles;
            try {
                if (!fs.existsSync(chatsDir)) continue;
                chatFiles = fs.readdirSync(chatsDir).filter(f => f.endsWith('.json') || f.endsWith('.jsonl'));
            } catch (_) { continue; }
            for (const f of chatFiles) {
                try {
                    const firstLine = fs.readFileSync(path.join(chatsDir, f), 'utf8').split('\n')[0];
                    const data = JSON.parse(firstLine);
                    const startTs = Date.parse(data.startTime || '');
                    if (Number.isFinite(startTs) && startTs >= minMs && startTs > bestStart) {
                        bestStart = startTs;
                        bestDir = chatsDir;
                    }
                } catch (_) { /* malformed session — skip */ }
            }
        }
        if (bestDir) return bestDir;
    }

    return null;
}

/**
 * Parse a single Gemini session JSON file and extract token usage.
 * Gemini sessions have: { messages: [{ type, tokens: { input, output, cached, thoughts, tool, total }, model }] }
 */
function parseGeminiSessionFile(filePath) {
    const result = {
        input_tokens: 0,
        output_tokens: 0,
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

    let messages;
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        if (filePath.endsWith('.jsonl')) {
            // JSONL format (Gemini CLI >= 0.1.x): one JSON object per line.
            // Line 0 is the session header; subsequent lines are message events
            // or $set metadata patches. Messages may appear twice with the same
            // id (provisional + final with toolCalls) — deduplicate by id, keeping
            // the last occurrence which carries the final token counts.
            const byId = new Map();
            let header = null;
            for (const line of raw.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                const obj = JSON.parse(trimmed);
                if ('$set' in obj) {
                    if (header && obj.$set.lastUpdated) header.lastUpdated = obj.$set.lastUpdated;
                    continue;
                }
                if (!header && obj.startTime != null) {
                    header = obj;
                } else if (obj.id) {
                    byId.set(obj.id, obj);
                }
            }
            result.start_at = header ? toIsoOrNull(header.startTime) : null;
            result.end_at = header ? toIsoOrNull(header.lastUpdated) : null;
            messages = Array.from(byId.values());
        } else {
            const data = JSON.parse(raw);
            result.start_at = toIsoOrNull(data.startTime);
            result.end_at = toIsoOrNull(data.lastUpdated);
            messages = data.messages || [];
        }
    } catch (_) {
        return result;
    }
    for (const msg of messages) {
        if (msg.type === 'user' || msg.type === 'gemini') {
            result.turn_count++;
        }

        if (!msg.tokens) continue;

        const turnInput = msg.tokens.input || 0;
        const turnOutput = msg.tokens.output || 0;
        const turnCachedInput = msg.tokens.cached || 0;
        result.input_tokens += turnInput;
        result.output_tokens += turnOutput;
        result.cache_read_input_tokens += turnCachedInput;
        result.thinking_tokens += msg.tokens.thoughts || 0;

        if (msg.type === 'gemini') {
            result.turns.push({
                index: result.turns.length,
                inputTokens: turnInput,
                outputTokens: turnOutput,
                cachedInputTokens: turnCachedInput,
            });
        }

        if (msg.tokens.tool) {
            result.tool_calls += msg.tokens.tool;
        }

        if (!result.model && msg.model) {
            result.model = msg.model;
        }
    }

    result.context_load_tokens = computeContextLoadTokens(result.turns);
    result.total_tokens = result.input_tokens + result.output_tokens
        + result.cache_read_input_tokens + result.thinking_tokens;

    const pricing = getModelPricing(result.model);
    result.cost_usd = Math.round(computeCost({
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
        cache_read_input_tokens: result.cache_read_input_tokens,
    }, pricing) * 10000) / 10000;

    return result;
}

/**
 * Find and parse all Gemini session files for a given worktree path.
 * Returns aggregated telemetry in the same format as captureFeatureTelemetry.
 */
function parseGeminiTranscripts(worktreePath, options = {}) {
    const chatsDir = resolveGeminiChatsDir(worktreePath, {
        afterMs: options.afterMs,
    });
    if (!chatsDir) return null;

    let files;
    try {
        files = fs.readdirSync(chatsDir)
            .filter(f => f.endsWith('.json') || f.endsWith('.jsonl'))
            .map(f => path.join(chatsDir, f));
    } catch (_) {
        return null;
    }

    if (files.length === 0) return null;

    const afterCutoff = options.afterMs != null ? Number(options.afterMs) : null;

    const totals = {
        input_tokens: 0, output_tokens: 0,
        cache_read_input_tokens: 0, thinking_tokens: 0,
        total_tokens: 0, cost_usd: 0, sessions: 0, model: null,
    };

    for (const file of files) {
        const data = parseGeminiSessionFile(file);
        if (afterCutoff != null && data.start_at) {
            const t = Date.parse(data.start_at);
            if (Number.isFinite(t) && t < afterCutoff) continue;
        }
        totals.input_tokens += data.input_tokens;
        totals.output_tokens += data.output_tokens;
        totals.cache_read_input_tokens += data.cache_read_input_tokens;
        totals.thinking_tokens += data.thinking_tokens;
        totals.total_tokens += data.total_tokens;
        totals.cost_usd += data.cost_usd;
        totals.sessions += 1;
        if (!totals.model && data.model) totals.model = data.model;

        // Write normalized record per session
        if (options.featureId) {
            const sessionId = path.basename(file).replace(/\.json$/i, '');
            writeNormalizedTelemetryRecord({
                source: 'gemini-transcript',
                sessionId,
                entityType: options.entityType || 'feature',
                featureId: String(options.featureId),
                repoPath: options.repoPath || worktreePath,
                agent: 'gg',
                activity: options.activity || 'implement',
                model: data.model || 'gemini',
                startAt: data.start_at,
                endAt: data.end_at || new Date().toISOString(),
                turnCount: data.turn_count,
                toolCalls: data.tool_calls,
                tokenUsage: {
                    input: data.input_tokens,
                    output: data.output_tokens,
                    cacheReadInput: data.cache_read_input_tokens,
                    cacheCreationInput: 0,
                    thinking: data.thinking_tokens,
                    total: data.total_tokens,
                    billable: data.input_tokens + data.output_tokens + data.thinking_tokens,
                },
                costUsd: data.cost_usd,
                turns: data.turns,
                contextLoadTokens: data.context_load_tokens,
                workflowRunId: options.workflowRunId || null,
            }, { repoPath: options.repoPath || worktreePath });
        }
    }

    if (totals.sessions === 0) return null;

    totals.cost_usd = Math.round(totals.cost_usd * 10000) / 10000;
    const billableTokens = totals.input_tokens + totals.output_tokens + totals.thinking_tokens;
    const linesChanged = options.linesChanged;
    const tokensPerLineChanged = (linesChanged && linesChanged > 0)
        ? Math.round((billableTokens / linesChanged) * 100) / 100 : null;

    return {
        input_tokens: totals.input_tokens,
        output_tokens: totals.output_tokens,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: totals.cache_read_input_tokens,
        thinking_tokens: totals.thinking_tokens,
        total_tokens: totals.total_tokens,
        billable_tokens: billableTokens,
        cost_usd: totals.cost_usd,
        sessions: totals.sessions,
        model: totals.model || 'gemini',
        tokens_per_line_changed: tokensPerLineChanged,
    };
}

function parseTranscripts(worktreePath, options = {}) {
    return parseGeminiTranscripts(worktreePath, options);
}

module.exports = {
    strategyId: 'gemini-transcript',
    parseTranscripts,
    resolveGeminiChatsDir,
    parseGeminiSessionFile,
    parseGeminiTranscripts,
};
