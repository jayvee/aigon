'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const agentRegistry = require('./agent-registry');

// Default number of turns to include in the contextLoadTokens rollup.
const CONTEXT_LOAD_TURNS_DEFAULT = 3;

/**
 * Sum inputTokens across the first N turns of a turns array.
 */
function computeContextLoadTokens(turns, n = CONTEXT_LOAD_TURNS_DEFAULT) {
    if (!Array.isArray(turns) || turns.length === 0) return 0;
    return turns.slice(0, n).reduce((sum, t) => sum + (t.inputTokens || 0), 0);
}

// ── Pricing table (per-token rates in USD) ──────────────────────────────────
// Source of truth: cli.modelOptions[].pricing in templates/agents/<id>.json
// ($/M tokens stored there; converted to $/token here).
// Legacy fallback covers models that pre-date the registry fields or exist
// outside any agent's modelOptions (e.g. older API-only model IDs).
const _PRICING_LEGACY_FALLBACK = {
    // Claude 4.x legacy IDs
    'claude-opus-4-6':             { input: 15 / 1e6, output: 75 / 1e6 },
    'claude-opus-4-5-20250620':    { input: 15 / 1e6, output: 75 / 1e6 },
    'claude-sonnet-4-5-20250514':  { input: 3 / 1e6, output: 15 / 1e6 },
    // Claude 3.5 (legacy)
    'claude-3-5-sonnet-20241022':  { input: 3 / 1e6, output: 15 / 1e6 },
    'claude-3-5-haiku-20241022':   { input: 0.80 / 1e6, output: 4 / 1e6 },
    // Gemini legacy / future IDs
    'gemini-3-pro-preview':        { input: 1.25 / 1e6, output: 10 / 1e6 },
    // OpenAI base / alias
    'gpt-5':                       { input: 2 / 1e6, output: 8 / 1e6 },
};

// Build the live PRICING map: registry entries take precedence over the legacy table.
// Models with [1m] context suffix share pricing with their base model.
function _buildPricingFromRegistry() {
    const map = Object.assign({}, _PRICING_LEGACY_FALLBACK);
    try {
        for (const agent of agentRegistry.getAllAgents()) {
            for (const opt of (agent.cli?.modelOptions || [])) {
                if (!opt.value || !opt.pricing) continue;
                const { input, output } = opt.pricing;
                const perToken = { input: input / 1e6, output: output / 1e6 };
                map[opt.value] = perToken;
                // Also index the bare model ID (strip [1m] suffix) so
                // telemetry records that don't include the suffix still match.
                const bare = opt.value.replace(/\[\w+\]$/, '');
                if (bare !== opt.value && !map[bare]) map[bare] = perToken;
            }
        }
    } catch (_) { /* registry unavailable — use legacy table only */ }
    return map;
}

const PRICING = _buildPricingFromRegistry();

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
    if (modelId.includes('gemini') && modelId.includes('pro')) return PRICING['gemini-2.5-pro'];
    if (modelId.includes('gemini')) return PRICING['gemini-2.5-flash'];
    if (modelId.includes('gpt-5')) return PRICING['gpt-5'];
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

// ── Claude JSONL transcript parsing ─────────────────────────────────────────

/**
 * Resolve the Claude Code projects directory for a given repo path.
 * Claude Code stores transcripts at: ~/.claude/projects/<escaped-path>/
 * where the path has / replaced with -
 */
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

/**
 * Aggregate normalized telemetry records written by the StopHook.
 * This is the primary cost source for closed features — it avoids brittle
 * Claude project-dir slug reconstruction in findTranscriptFiles().
 *
 * Records live at: <repoPath>/.aigon/telemetry/feature-<id>-<agent>-<sessionId>.json
 * Schema is defined by writeNormalizedTelemetryRecord() above.
 *
 * @param {string|number} featureId
 * @param {string} agent - Agent code (e.g. "cc", "gg", "cx", or "solo" for any)
 * @param {Object} options
 * @param {string} [options.repoPath] - Main repo path (records are written there)
 * @param {number} [options.linesChanged] - For tokens_per_line_changed
 * @returns {Object|null} Same shape as captureFeatureTelemetry, or null if no records
 */
function aggregateNormalizedTelemetryRecords(featureId, agent, options = {}) {
    const repoPath = options.repoPath || process.cwd();
    const telemetryDir = resolveTelemetryDir(repoPath);
    if (!fs.existsSync(telemetryDir)) return null;

    const featureIdStr = String(featureId);
    const agentLower = String(agent || '').toLowerCase();
    // 'solo' (legacy) means "no agent code recorded" — accept any agent for this feature.
    const matchAnyAgent = agentLower === 'solo' || agentLower === '';

    let files;
    try {
        files = fs.readdirSync(telemetryDir);
    } catch (_) { return null; }

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
    for (const file of files) {
        if (!file.endsWith('.json')) continue;
        let record;
        try {
            record = JSON.parse(fs.readFileSync(path.join(telemetryDir, file), 'utf8'));
        } catch (_) { continue; }
        if (!record || record.entityType === 'research') continue;
        if (String(record.featureId) !== featureIdStr) continue;
        const recordAgent = String(record.agent || '').toLowerCase();
        if (!matchAnyAgent && recordAgent !== agentLower) continue;

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

// ── Gemini transcript parsing ────────────────────────────────────────────────

const crypto = require('crypto');

/**
 * Resolve the Gemini chats directory for a given worktree/project path.
 * Gemini stores transcripts at: ~/.gemini/tmp/{slug-or-hash}/chats/
 * The directory name is either a SHA256 hash of the path or a basename slug.
 */
function resolveGeminiChatsDir(projectPath) {
    const absPath = path.resolve(projectPath);
    const geminiBase = path.join(os.homedir(), '.gemini', 'tmp');

    // Strategy 1: SHA256 hash of the absolute path (deterministic, always try first)
    const pathHash = crypto.createHash('sha256').update(absPath).digest('hex');
    const hashDir = path.join(geminiBase, pathHash, 'chats');
    if (fs.existsSync(hashDir)) return hashDir;

    // Strategy 2: scan all dirs in ~/.gemini/tmp/ and match by .project_root content
    // Gemini uses basename slug but appends -1, -2 etc. when slug already exists
    try {
        const slug = path.basename(absPath);
        const dirs = fs.readdirSync(geminiBase)
            .filter(d => d === slug || d.startsWith(slug + '-'));
        for (const d of dirs) {
            const projectRootFile = path.join(geminiBase, d, '.project_root');
            if (fs.existsSync(projectRootFile)) {
                const storedPath = fs.readFileSync(projectRootFile, 'utf8').trim();
                if (storedPath === absPath) {
                    const chatsDir = path.join(geminiBase, d, 'chats');
                    if (fs.existsSync(chatsDir)) return chatsDir;
                }
            }
        }
    } catch (_) { /* non-fatal */ }

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

    let data;
    try {
        data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
        return result;
    }

    result.start_at = toIsoOrNull(data.startTime);
    result.end_at = toIsoOrNull(data.lastUpdated);

    const messages = data.messages || [];
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
    const chatsDir = resolveGeminiChatsDir(worktreePath);
    if (!chatsDir) return null;

    let files;
    try {
        files = fs.readdirSync(chatsDir)
            .filter(f => f.endsWith('.json'))
            .map(f => path.join(chatsDir, f));
    } catch (_) {
        return null;
    }

    if (files.length === 0) return null;

    const totals = {
        input_tokens: 0, output_tokens: 0,
        cache_read_input_tokens: 0, thinking_tokens: 0,
        total_tokens: 0, cost_usd: 0, sessions: 0, model: null,
    };

    for (const file of files) {
        const data = parseGeminiSessionFile(file);
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

// ── Codex transcript parsing ─────────────────────────────────────────────────

/**
 * Parse a single Codex session JSONL file and extract token usage.
 * Codex sessions have cumulative `total_token_usage` in `event_msg` payloads.
 * We take the last occurrence (highest cumulative values).
 */
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
                input: session.input_tokens,
                output: session.output_tokens,
                cacheReadInput: session.cache_read_input_tokens,
                cacheCreationInput: session.cache_creation_input_tokens,
                thinking: session.thinking_tokens,
                total: session.total_tokens,
                billable: session.input_tokens + session.output_tokens + session.thinking_tokens,
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

// ── Git-based telemetry (universal, all agents) ─────────────────────────────

/**
 * Capture git-based telemetry for a specific agent's branch/worktree.
 * Works for any agent (cc, gg, cx, cu) — no transcript parsing required.
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
 * Capture telemetry for a single agent: git stats (always) + transcript telemetry (cc/gg/cx/cu).
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
 * @param {number} [options.afterMs] - when set, Codex transcript scan only includes session files newer than this (see parseCodexTranscripts)
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
    const linesChanged = gitData ? (gitData.lines_changed || 0) : 0;

    // Primary path: aggregate normalized telemetry records written by the
    // StopHook during each session. This avoids brittle Claude project-dir
    // slug reconstruction (findTranscriptFiles / resolveClaudeProjectDir).
    // Records are written for cc/gg/cx by their respective StopHook handlers.
    if (hasTranscript) {
        const aggregated = aggregateNormalizedTelemetryRecords(featureId, agentId, {
            repoPath: options.repoPath,
            linesChanged,
        });
        if (aggregated) {
            Object.assign(result, aggregated);
            return Object.keys(result).length > 0 ? result : null;
        }
    }

    // Fallback: legacy per-agent transcript parsing for sessions that
    // pre-date StopHook record writing, or when records are missing.
    // Dispatched by `runtime.telemetryStrategy` from templates/agents/<id>.json.
    const tStrat = agentRegistry.getTelemetryStrategy(agentId);
    if (tStrat === 'gemini-transcript' && hasTranscript) {
        // Gemini: parse from ~/.gemini/tmp/{slug-or-hash}/chats/
        const worktree = options.worktreePath || options.repoPath;
        if (worktree) {
            const transcriptData = parseGeminiTranscripts(worktree, {
                featureId, entityType: 'feature',
                repoPath: options.repoPath, linesChanged,
            });
            if (transcriptData) Object.assign(result, transcriptData);
        }
    } else if (tStrat === 'codex-transcript' && hasTranscript) {
        // Codex: parse from ~/.codex/sessions/ matched by worktree cwd
        const worktree = options.worktreePath || options.repoPath;
        if (worktree) {
            const cxOpts = {
                featureId, entityType: 'feature',
                repoPath: options.repoPath, linesChanged,
            };
            if (options.afterMs != null) cxOpts.afterMs = options.afterMs;
            const transcriptData = parseCodexTranscripts(worktree, cxOpts);
            if (transcriptData) Object.assign(result, transcriptData);
        }
    } else if (tStrat === 'no-telemetry-cursor') {
        // Cursor: no accessible token data — mark as n/a permanently
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
        result.model = 'cursor';
        result.source = 'no-telemetry-cursor';
    } else if (hasTranscript) {
        // Claude Code (cc) and solo: parse Claude JSONL transcripts
        const transcriptData = captureFeatureTelemetry(featureId, featureDesc, {
            agentId: agentId !== 'solo' ? agentId : undefined,
            repoPath: options.repoPath,
            worktreePath: options.worktreePath,
            linesChanged,
        });
        if (transcriptData) {
            Object.assign(result, transcriptData);
        }
    } else {
        // Unknown agent without transcript support: set model only
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
    PRICING,
    CONTEXT_LOAD_TURNS_DEFAULT,
    computeContextLoadTokens,
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
    aggregateNormalizedTelemetryRecords,
    resolveTelemetryDir,
    writeNormalizedTelemetryRecord,
    writeAgentFallbackSession,
    // Gemini
    resolveGeminiChatsDir,
    parseGeminiSessionFile,
    parseGeminiTranscripts,
    // Codex
    parseCodexSessionFile,
    findCodexSessionFiles,
    parseCodexTranscripts,
};
