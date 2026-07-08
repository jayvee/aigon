'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function readTelemetryFile(filePath) {
    if (filePath.endsWith('.gz')) {
        return zlib.gunzipSync(fs.readFileSync(filePath)).toString('utf8');
    }
    return fs.readFileSync(filePath, 'utf8');
}

// Default number of turns to include in the contextLoadTokens rollup.
const CONTEXT_LOAD_TURNS_DEFAULT = 3;

/**
 * Sum inputTokens across the first N turns of a turns array.
 */
function computeContextLoadTokens(turns, n = CONTEXT_LOAD_TURNS_DEFAULT) {
    if (!Array.isArray(turns) || turns.length === 0) return 0;
    return turns.slice(0, n).reduce((sum, t) => sum + (t.inputTokens || 0), 0);
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

    const entityType = record.entityType === 'research' ? 'research' : 'feature';
    const featureId = String(record.featureId);
    const agent = String(record.agent || 'unknown').toLowerCase();
    const sessionId = String(record.sessionId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    const safeSessionId = sessionId.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filename = `${entityType}-${featureId}-${agent}-${safeSessionId}.json`;
    const outputPath = path.join(telemetryDir, filename);

    const activity = record.activity || 'implement';
    const normalized = {
        schemaVersion: 1,
        source: record.source || 'unknown',
        sessionId,
        entityType,
        featureId,
        repoPath: path.resolve(record.repoPath || repoPath),
        agent,
        activity,
        model: record.model || `${agent}-cli`,
        startAt: toIsoOrNull(record.startAt),
        endAt: toIsoOrNull(record.endAt),
        turnCount: Number.isFinite(Number(record.turnCount)) ? Number(record.turnCount) : 0,
        toolCalls: Number.isFinite(Number(record.toolCalls)) ? Number(record.toolCalls) : 0,
        tokenUsage: {
            input: record.tokenUsage?.input === null ? null : Number(record.tokenUsage?.input || 0),
            output: record.tokenUsage?.output === null ? null : Number(record.tokenUsage?.output || 0),
            cacheReadInput: record.tokenUsage?.cacheReadInput === null ? null : Number(record.tokenUsage?.cacheReadInput || 0),
            cacheCreationInput: record.tokenUsage?.cacheCreationInput === null ? null : Number(record.tokenUsage?.cacheCreationInput || 0),
            thinking: record.tokenUsage?.thinking === null ? null : Number(record.tokenUsage?.thinking || 0),
            total: record.tokenUsage?.total === null ? null : Number(record.tokenUsage?.total || 0),
            billable: record.tokenUsage?.billable === null ? null : Number(record.tokenUsage?.billable || 0),
        },
        costUsd: record.costUsd === null ? null : (Number.isFinite(Number(record.costUsd)) ? Number(record.costUsd) : 0),
        workflowRunId: record.workflowRunId || null,
        turns: Array.isArray(record.turns) ? record.turns : [],
        contextLoadTokens: Number.isFinite(Number(record.contextLoadTokens)) ? Number(record.contextLoadTokens) : 0,
    };

    fs.writeFileSync(outputPath, JSON.stringify(normalized, null, 2) + '\n');
    return outputPath;
}

function isFallbackTelemetryRecord(record) {
    return record && (
        record.source === 'feature-close-fallback' ||
        (typeof record.source === 'string' && record.source.startsWith('no-telemetry'))
    );
}

function telemetryRecordHasRealData(record) {
    if (!record || isFallbackTelemetryRecord(record)) return false;
    const usage = record.tokenUsage || {};
    return (Number(usage.input) || 0) > 0 ||
        (Number(usage.output) || 0) > 0 ||
        (Number(usage.cacheReadInput) || 0) > 0 ||
        (Number(usage.cacheCreationInput) || 0) > 0 ||
        (Number(usage.thinking) || 0) > 0 ||
        (Number(usage.total) || 0) > 0 ||
        (Number(usage.billable) || 0) > 0 ||
        (Number(record.costUsd) || 0) > 0;
}

function getEffectiveNormalizedTelemetryRecords(featureId, options = {}) {
    const repoPath = options.repoPath || process.cwd();
    const telemetryDir = resolveTelemetryDir(repoPath);
    if (!fs.existsSync(telemetryDir)) return [];

    const entityType = options.entityType === 'research' ? 'research' : 'feature';
    const featureIdStr = String(featureId);
    const agentLower = options.agent ? String(options.agent).toLowerCase() : null;
    const matchAnyAgent = !agentLower || agentLower === 'solo';
    let files;
    try {
        files = fs.readdirSync(telemetryDir);
    } catch (_) { return []; }

    const records = [];
    for (const file of files) {
        if (!file.endsWith('.json') && !file.endsWith('.json.gz')) continue;
        let record;
        try {
            record = JSON.parse(readTelemetryFile(path.join(telemetryDir, file)));
        } catch (_) { continue; }
        if (!record || (record.entityType || 'feature') !== entityType) continue;
        if (String(record.featureId) !== featureIdStr) continue;
        const recordAgent = String(record.agent || '').toLowerCase();
        if (!matchAnyAgent && recordAgent !== agentLower) continue;
        if (options.afterMs != null) {
            const minMs = Number(options.afterMs);
            const recMs = record.startAt ? new Date(record.startAt).getTime()
                        : record.endAt   ? new Date(record.endAt).getTime()
                        : null;
            if (recMs == null || recMs < minMs) continue;
        }
        records.push(record);
    }

    const realKeys = new Set();
    const realAgents = new Set();
    for (const record of records) {
        if (!telemetryRecordHasRealData(record)) continue;
        const agent = String(record.agent || '').toLowerCase();
        realAgents.add(agent);
        if (record.workflowRunId) realKeys.add(`${agent}\0${record.workflowRunId}`);
    }

    return records.filter(record => {
        if (!isFallbackTelemetryRecord(record)) return true;
        const agent = String(record.agent || '').toLowerCase();
        if (record.workflowRunId && realKeys.has(`${agent}\0${record.workflowRunId}`)) return false;
        if (!record.workflowRunId && realAgents.has(agent)) return false;
        return true;
    });
}

function aggregateNormalizedTelemetryRecords(featureId, agent, options = {}) {
    const repoPath = options.repoPath || process.cwd();
    const telemetryDir = resolveTelemetryDir(repoPath);
    if (!fs.existsSync(telemetryDir)) return null;

    const records = getEffectiveNormalizedTelemetryRecords(featureId, {
        repoPath,
        agent,
        afterMs: options.afterMs,
    });

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

    let hasRealData = false;
    for (const record of records) {
        const usage = record.tokenUsage || {};
        const input = Number(usage.input) || 0;
        const output = Number(usage.output) || 0;
        const cacheCreate = Number(usage.cacheCreationInput) || 0;
        const cacheRead = Number(usage.cacheReadInput) || 0;
        const thinking = Number(usage.thinking) || 0;
        const total = Number(usage.total) || (input + output + cacheCreate + cacheRead + thinking);
        const cost = Number(record.costUsd) || 0;
        const hasRecordData = input > 0 || output > 0 || thinking > 0 || cacheCreate > 0 || cacheRead > 0 || cost > 0;

        if (!hasRecordData) continue;

        totals.input_tokens += input;
        totals.output_tokens += output;
        totals.cache_creation_input_tokens += cacheCreate;
        totals.cache_read_input_tokens += cacheRead;
        totals.thinking_tokens += thinking;
        totals.total_tokens += total;
        totals.cost_usd += cost;
        totals.sessions += 1;
        hasRealData = true;
        if (!totals.model && record.model) totals.model = record.model;
    }

    if (totals.sessions === 0 || !hasRealData) return null;

    totals.cost_usd = Math.round(totals.cost_usd * 10000) / 10000;
    const billableTokens = totals.input_tokens + totals.output_tokens + totals.thinking_tokens;
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

function normalisePath(p) {
    if (!p) return '';
    return path.resolve(String(p).trim()).replace(/\/+$/, '');
}

module.exports = {
    readTelemetryFile,
    CONTEXT_LOAD_TURNS_DEFAULT,
    computeContextLoadTokens,
    toIsoOrNull,
    resolveTelemetryDir,
    writeNormalizedTelemetryRecord,
    isFallbackTelemetryRecord,
    telemetryRecordHasRealData,
    getEffectiveNormalizedTelemetryRecords,
    aggregateNormalizedTelemetryRecords,
    normalisePath,
};
