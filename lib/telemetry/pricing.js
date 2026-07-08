'use strict';

const agentRegistry = require('../agent-registry');

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

    // OpenCode DB stores model IDs without the `openrouter/` provider prefix
    // (e.g. `qwen/qwen3-coder:exacto`). Try matching the registry by adding it.
    const orPrefixed = `openrouter/${modelId}`;
    if (PRICING[orPrefixed]) return PRICING[orPrefixed];

    // Try prefix match (strip date suffix)
    const base = modelId.replace(/-\d{8}$/, '');
    if (PRICING[base]) return PRICING[base];

    // Family-level fallback
    if (modelId.includes('opus')) return PRICING['claude-opus-4-6'];
    if (modelId.includes('haiku')) return PRICING['claude-haiku-4-5-20251001'];
    if (modelId.includes('gemini') && modelId.includes('pro')) return PRICING['gemini-2.5-pro'];
    if (modelId.includes('gemini')) return PRICING['gemini-2.5-flash'];
    if (modelId.includes('gpt-5')) return PRICING['gpt-5'];

    // OpenRouter family fallbacks (op agent). Conservative mid-tier picks
    // chosen from op.json modelOptions; prevents costUsd: null when bench
    // runs use a model variant that isn't itself listed in the registry.
    const m = modelId.toLowerCase();
    if (m.includes('deepseek')) return PRICING['openrouter/deepseek/deepseek-v3.1-terminus'] || { input: 0.21 / 1e6, output: 0.79 / 1e6 };
    if (m.includes('qwen'))     return PRICING['openrouter/qwen/qwen3-235b-a22b-07-25']    || { input: 0.07 / 1e6, output: 0.10 / 1e6 };
    if (m.includes('grok'))     return PRICING['openrouter/x-ai/grok-code-fast-1']         || { input: 0.20 / 1e6, output: 1.50 / 1e6 };
    if (m.includes('devstral') || m.includes('mistral')) return PRICING['openrouter/mistralai/devstral-small-2507'] || { input: 0.10 / 1e6, output: 0.30 / 1e6 };
    if (m.includes('llama'))    return PRICING['openrouter/meta-llama/llama-3.3-70b-instruct'] || { input: 0.10 / 1e6, output: 0.32 / 1e6 };
    if (m.includes('nemotron')) return PRICING['openrouter/nvidia/nemotron-3-super-120b-a12b'] || { input: 0.09 / 1e6, output: 0.45 / 1e6 };
    if (m.includes('glm'))      return PRICING['openrouter/z-ai/glm-5.1'] || { input: 1.05 / 1e6, output: 3.50 / 1e6 };

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
module.exports = {
    PRICING,
    _buildPricingFromRegistry,
    getModelPricing,
    computeCost,
    CACHE_READ_DISCOUNT,
    CACHE_WRITE_PREMIUM,
};
