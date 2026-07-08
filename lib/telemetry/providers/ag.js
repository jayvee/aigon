'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const core = require('../core');
const { querySqliteDb } = require('../sqlite');

const { writeNormalizedTelemetryRecord, normalisePath } = core;

const ANTIGRAVITY_CLI_ROOT = path.join(os.homedir(), '.gemini', 'antigravity-cli');

function resolveAntigravityConversationId(projectPath) {
    const absPath = normalisePath(projectPath);
    const cachePath = path.join(ANTIGRAVITY_CLI_ROOT, 'cache', 'last_conversations.json');
    if (!fs.existsSync(cachePath)) return null;
    try {
        const map = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        return map[absPath] || null;
    } catch (_) {
        return null;
    }
}

function antigravityQuery(dbPath, sql) {
    return querySqliteDb(dbPath, sql);
}

function parseAntigravityConversationDb(dbPath) {
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

    const rows = antigravityQuery(dbPath, 'SELECT COUNT(*) AS c FROM steps');
    if (!rows || !rows.length) return result;
    result.turn_count = Number(rows[0].c) || 0;
    result.end_at = new Date().toISOString();
    try {
        const mtime = fs.statSync(dbPath).mtime;
        result.start_at = mtime.toISOString();
    } catch (_) { /* optional */ }

    return result;
}

/**
 * Find and parse Antigravity conversation DB for a worktree path.
 */
function parseAntigravityTranscripts(worktreePath, options = {}) {
    const conversationId = resolveAntigravityConversationId(worktreePath);
    if (!conversationId) return null;

    const dbPath = path.join(ANTIGRAVITY_CLI_ROOT, 'conversations', `${conversationId}.db`);
    if (!fs.existsSync(dbPath)) return null;

    if (options.afterMs != null) {
        try {
            if (fs.statSync(dbPath).mtimeMs < Number(options.afterMs)) return null;
        } catch (_) { return null; }
    }

    const data = parseAntigravityConversationDb(dbPath);
    if (!data.turn_count && !options.featureId) return null;

    if (options.featureId) {
        writeNormalizedTelemetryRecord({
            source: 'antigravity-transcript',
            sessionId: conversationId,
            entityType: options.entityType || 'feature',
            featureId: String(options.featureId),
            repoPath: options.repoPath || worktreePath,
            agent: 'ag',
            activity: options.activity || 'implement',
            model: data.model || 'gemini-3.5-flash',
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
                billable: null,
            },
            costUsd: null,
            turns: data.turns,
            contextLoadTokens: data.context_load_tokens,
            workflowRunId: options.workflowRunId || null,
        }, { repoPath: options.repoPath || worktreePath });
    }

    return {
        input_tokens: data.input_tokens,
        output_tokens: data.output_tokens,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: data.cache_read_input_tokens,
        thinking_tokens: data.thinking_tokens,
        total_tokens: data.total_tokens,
        billable_tokens: null,
        cost_usd: null,
        sessions: 1,
        model: data.model || 'gemini-3.5-flash',
        tokens_per_line_changed: null,
        turn_count: data.turn_count,
    };
}

function parseTranscripts(worktreePath, options = {}) {
    return parseAntigravityTranscripts(worktreePath, options);
}

module.exports = {
    strategyId: 'antigravity-transcript',
    parseTranscripts,
    resolveAntigravityConversationId,
    parseAntigravityConversationDb,
    parseAntigravityTranscripts,
};
