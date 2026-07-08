'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const core = require('../core');
const pricing = require('../pricing');
const { sqlEscape, querySqliteDb } = require('../sqlite');

const { toIsoOrNull, computeContextLoadTokens, writeNormalizedTelemetryRecord, normalisePath } = core;
const { getModelPricing, computeCost } = pricing;

const OPENCODE_DB_PATH = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');

function opencodeQuery(sql) {
    return querySqliteDb(OPENCODE_DB_PATH, sql, { maxBuffer: 64 * 1024 * 1024 });
}

function parseOpenCodeDb(worktreePath, options = {}) {
    if (!fs.existsSync(OPENCODE_DB_PATH)) return null;

    const absWorktree = normalisePath(worktreePath);
    const afterMs = options.afterMs != null ? Number(options.afterMs) : 0;

    // opencode registers project.worktree as the git root, not the worktree subdir.
    // When running from a git worktree, session.directory holds the actual CWD.
    // Try exact project match first; fall back to session.directory match.
    let sessions = null;

    const projects = opencodeQuery(
        `SELECT id FROM project WHERE worktree = '${sqlEscape(absWorktree)}'`
    );
    if (projects && projects.length > 0) {
        const projectIds = projects.map(p => `'${sqlEscape(p.id)}'`).join(',');
        sessions = opencodeQuery(
            `SELECT id, time_created FROM session ` +
            `WHERE project_id IN (${projectIds}) AND time_created >= ${afterMs}`
        );
    }

    // Fallback: match by session.directory (worktree subdir path)
    if (!sessions || sessions.length === 0) {
        sessions = opencodeQuery(
            `SELECT id, time_created FROM session ` +
            `WHERE directory = '${sqlEscape(absWorktree)}' AND time_created >= ${afterMs}`
        );
    }

    // Second fallback: git root = parent two levels up from worktree path (.aigon/worktrees/<seed>/<branch>)
    if (!sessions || sessions.length === 0) {
        const gitRoot = normalisePath(path.resolve(absWorktree, '..', '..', '..', '..'));
        const rootProjects = opencodeQuery(
            `SELECT id FROM project WHERE worktree = '${sqlEscape(gitRoot)}'`
        );
        if (rootProjects && rootProjects.length > 0) {
            const rootProjectIds = rootProjects.map(p => `'${sqlEscape(p.id)}'`).join(',');
            sessions = opencodeQuery(
                `SELECT id, time_created FROM session ` +
                `WHERE project_id IN (${rootProjectIds}) ` +
                `AND directory = '${sqlEscape(absWorktree)}' ` +
                `AND time_created >= ${afterMs}`
            );
        }
    }

    if (!sessions || sessions.length === 0) return null;

    const totals = {
        input_tokens: 0, output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        thinking_tokens: 0,
        total_tokens: 0, cost_usd: 0, sessions: 0, model: null,
    };

    for (const sess of sessions) {
        const messages = opencodeQuery(
            `SELECT data, time_created FROM message ` +
            `WHERE session_id = '${sqlEscape(sess.id)}' ` +
            `AND json_extract(data, '$.tokens') IS NOT NULL ` +
            `AND json_extract(data, '$.role') = 'assistant'`
        );
        if (!messages || messages.length === 0) continue;

        const sessAgg = {
            input_tokens: 0, output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            thinking_tokens: 0,
            total_tokens: 0,
            model: null,
            start_at: null,
            end_at: null,
            turn_count: 0,
            tool_calls: 0,
            turns: [],
        };

        for (const row of messages) {
            let parsed;
            try { parsed = JSON.parse(row.data); } catch (_) { continue; }
            const tokens = parsed.tokens || {};
            const cache = tokens.cache || {};
            const turnInput = Number(tokens.input) || 0;
            const turnOutput = Number(tokens.output) || 0;
            const turnCacheRead = Number(cache.read) || 0;
            const turnCacheWrite = Number(cache.write) || 0;
            const turnReasoning = Number(tokens.reasoning) || 0;

            sessAgg.input_tokens += turnInput;
            sessAgg.output_tokens += turnOutput;
            sessAgg.cache_read_input_tokens += turnCacheRead;
            sessAgg.cache_creation_input_tokens += turnCacheWrite;
            sessAgg.thinking_tokens += turnReasoning;
            sessAgg.total_tokens += Number(tokens.total) || 0;
            sessAgg.turn_count += 1;
            if (!sessAgg.model && parsed.modelID) sessAgg.model = parsed.modelID;

            const created = parsed.time?.created || row.time_created;
            const completed = parsed.time?.completed || created;
            const startIso = toIsoOrNull(created);
            const endIso = toIsoOrNull(completed);
            if (startIso && !sessAgg.start_at) sessAgg.start_at = startIso;
            if (endIso) sessAgg.end_at = endIso;

            sessAgg.turns.push({
                index: sessAgg.turns.length,
                inputTokens: turnInput,
                outputTokens: turnOutput,
                cachedInputTokens: turnCacheRead,
            });
        }

        if (sessAgg.turn_count === 0) continue;

        const pricing = getModelPricing(sessAgg.model);
        const sessCost = Math.round(computeCost({
            input_tokens: sessAgg.input_tokens,
            output_tokens: sessAgg.output_tokens,
            cache_read_input_tokens: sessAgg.cache_read_input_tokens,
            cache_creation_input_tokens: sessAgg.cache_creation_input_tokens,
        }, pricing) * 10000) / 10000;

        totals.input_tokens += sessAgg.input_tokens;
        totals.output_tokens += sessAgg.output_tokens;
        totals.cache_read_input_tokens += sessAgg.cache_read_input_tokens;
        totals.cache_creation_input_tokens += sessAgg.cache_creation_input_tokens;
        totals.thinking_tokens += sessAgg.thinking_tokens;
        totals.total_tokens += sessAgg.total_tokens;
        totals.cost_usd += sessCost;
        totals.sessions += 1;
        if (!totals.model && sessAgg.model) totals.model = sessAgg.model;

        if (options.featureId) {
            writeNormalizedTelemetryRecord({
                source: 'opencode-db',
                sessionId: sess.id,
                entityType: options.entityType || 'feature',
                featureId: String(options.featureId),
                repoPath: options.repoPath || worktreePath,
                agent: 'op',
                activity: options.activity || 'implement',
                model: sessAgg.model || 'opencode',
                startAt: sessAgg.start_at,
                endAt: sessAgg.end_at || new Date().toISOString(),
                turnCount: sessAgg.turn_count,
                toolCalls: sessAgg.tool_calls,
                tokenUsage: {
                    input: sessAgg.input_tokens,
                    output: sessAgg.output_tokens,
                    cacheReadInput: sessAgg.cache_read_input_tokens,
                    cacheCreationInput: sessAgg.cache_creation_input_tokens,
                    thinking: sessAgg.thinking_tokens,
                    total: sessAgg.total_tokens,
                    billable: sessAgg.input_tokens + sessAgg.output_tokens + sessAgg.thinking_tokens,
                },
                costUsd: sessCost,
                turns: sessAgg.turns,
                contextLoadTokens: computeContextLoadTokens(sessAgg.turns),
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
        cache_creation_input_tokens: totals.cache_creation_input_tokens,
        cache_read_input_tokens: totals.cache_read_input_tokens,
        thinking_tokens: totals.thinking_tokens,
        total_tokens: totals.total_tokens,
        billable_tokens: billableTokens,
        cost_usd: totals.cost_usd,
        sessions: totals.sessions,
        model: totals.model || 'opencode',
        tokens_per_line_changed: tokensPerLineChanged,
    };
}

function parseTranscripts(worktreePath, options = {}) {
    return parseOpenCodeDb(worktreePath, options);
}

module.exports = {
    strategyId: 'opencode-db',
    parseTranscripts,
    parseOpenCodeDb,
    OPENCODE_DB_PATH,
};
