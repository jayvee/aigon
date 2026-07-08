'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const core = require('../core');
const pricing = require('../pricing');

const { toIsoOrNull, computeContextLoadTokens, writeNormalizedTelemetryRecord } = core;
const { getModelPricing, computeCost } = pricing;

function parseCodexSessionFile(filePath) {
    const result = {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        thinking_tokens: 0,
        total_tokens: 0,
        model: null,
        model_provider: null,
        cost_usd: 0,
        turn_count: 0,
        tool_calls: 0,
        start_at: null,
        end_at: null,
        cwd: null,
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
    let prevUsage = null;
    let lastUsage = null;

    for (const line of lines) {
        let record;
        try { record = JSON.parse(line); } catch (_) { continue; }

        const ts = record.timestamp;
        const isoTs = toIsoOrNull(ts);
        if (isoTs && !result.start_at) result.start_at = isoTs;
        if (isoTs) result.end_at = isoTs;

        if (record.type === 'session_meta' && record.payload) {
            result.cwd = record.payload.cwd || null;
            result.model_provider = record.payload.model_provider || null;
        }

        if (record.type === 'response_item') {
            result.turn_count++;
        }

        const payload = record.payload || {};
        const info = payload.info || {};
        if (info.total_token_usage) {
            const cur = info.total_token_usage;
            // Emit per-turn delta against the previous cumulative snapshot
            const prev = prevUsage || { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0 };
            const deltaInput = Math.max(0, (cur.input_tokens || 0) - (prev.input_tokens || 0));
            const deltaOutput = Math.max(0, (cur.output_tokens || 0) - (prev.output_tokens || 0));
            const deltaCached = Math.max(0, (cur.cached_input_tokens || 0) - (prev.cached_input_tokens || 0));
            if (deltaInput > 0 || deltaOutput > 0) {
                result.turns.push({
                    index: result.turns.length,
                    inputTokens: deltaInput,
                    outputTokens: deltaOutput,
                    cachedInputTokens: deltaCached,
                });
            }
            prevUsage = cur;
            lastUsage = cur;
        }
    }

    if (lastUsage) {
        result.input_tokens = lastUsage.input_tokens || 0;
        result.output_tokens = lastUsage.output_tokens || 0;
        result.cache_read_input_tokens = lastUsage.cached_input_tokens || 0;
        result.thinking_tokens = lastUsage.reasoning_output_tokens || 0;
        result.total_tokens = lastUsage.total_tokens || 0;
    }

    result.context_load_tokens = computeContextLoadTokens(result.turns);

    // Use GPT-5 pricing for Codex/OpenAI
    const pricing = getModelPricing('gpt-5');
    result.cost_usd = Math.round(computeCost({
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
        cache_read_input_tokens: result.cache_read_input_tokens,
    }, pricing) * 10000) / 10000;

    return result;
}

/**
 * Find all Codex session files matching a worktree path (by cwd in session_meta).
 * Scans ~/.codex/sessions/ recursively for .jsonl files where session_meta.cwd
 * matches the expected worktree path.
 */
function findCodexSessionFiles(worktreePath, minMtimeMs = null) {
    const sessionsBase = path.join(os.homedir(), '.codex', 'sessions');
    if (!fs.existsSync(sessionsBase)) return [];

    const absWorktree = path.resolve(worktreePath);
    const matches = [];

    function scanDir(dir) {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                scanDir(full);
            } else if (entry.name.endsWith('.jsonl')) {
                // Quick check: extract cwd from session_meta using a regex on the first
                // chunk. The first line can be very large (contains base_instructions),
                // but the cwd field appears early in the payload, so 4KB is sufficient.
                try {
                    const fd = fs.openSync(full, 'r');
                    const buf = Buffer.alloc(4096);
                    const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
                    fs.closeSync(fd);
                    const head = buf.toString('utf8', 0, bytesRead);
                    if (head.includes('"session_meta"')) {
                        const cwdMatch = head.match(/"cwd"\s*:\s*"([^"]+)"/);
                        if (cwdMatch && path.resolve(cwdMatch[1]) === absWorktree) {
                            if (minMtimeMs != null) {
                                const stat = fs.statSync(full);
                                if (stat.mtimeMs < minMtimeMs) {
                                    continue;
                                }
                            }
                            matches.push(full);
                        }
                    }
                } catch (_) {}
            }
        }
    }

    scanDir(sessionsBase);
    return matches;
}

/**
 * Find and parse all Codex session files for a given worktree path.
 * Returns aggregated telemetry in the same format as captureFeatureTelemetry.
 */
function parseCodexTranscripts(worktreePath, options = {}) {
    const files = findCodexSessionFiles(worktreePath, options.afterMs != null ? Number(options.afterMs) : null);
    if (files.length === 0) return null;

    const totals = {
        input_tokens: 0, output_tokens: 0,
        cache_read_input_tokens: 0, thinking_tokens: 0,
        total_tokens: 0, cost_usd: 0, sessions: 0, model: null,
    };

    for (const file of files) {
        const data = parseCodexSessionFile(file);
        totals.input_tokens += data.input_tokens;
        totals.output_tokens += data.output_tokens;
        totals.cache_read_input_tokens += data.cache_read_input_tokens;
        totals.thinking_tokens += data.thinking_tokens;
        totals.total_tokens += data.total_tokens;
        totals.cost_usd += data.cost_usd;
        totals.sessions += 1;
        if (!totals.model && data.model_provider) {
            totals.model = `${data.model_provider}-codex`;
        }

        // Write normalized record per session
        if (options.featureId) {
            const sessionId = path.basename(file).replace(/\.jsonl$/i, '');
            writeNormalizedTelemetryRecord({
                source: 'codex-transcript',
                sessionId,
                entityType: options.entityType || 'feature',
                featureId: String(options.featureId),
                repoPath: options.repoPath || worktreePath,
                agent: 'cx',
                activity: options.activity || 'implement',
                model: data.model_provider ? `${data.model_provider}-codex` : 'codex',
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
        model: totals.model || 'codex',
        tokens_per_line_changed: tokensPerLineChanged,
    };
}

function parseTranscripts(worktreePath, options = {}) {
    return parseCodexTranscripts(worktreePath, options);
}

module.exports = {
    strategyId: 'codex-transcript',
    parseTranscripts,
    parseCodexSessionFile,
    findCodexSessionFiles,
    parseCodexTranscripts,
};
