'use strict';

/**
 * Telemetry package public facade (F634).
 * Static imports: core only — keeps the module graph from multiplying
 * feature-status → telemetry → agent-registry cycle paths.
 * Provider parsers load on first access to a provider export.
 */

const core = require('./core');

function lazyProp(exports, name, mod, key) {
    Object.defineProperty(exports, name, {
        enumerable: true,
        configurable: true,
        get() {
            const m = require(mod);
            const val = key ? m[key] : m;
            Object.defineProperty(exports, name, { enumerable: true, value: val });
            return val;
        },
    });
}

const exportsObj = { ...core };

lazyProp(exportsObj, 'PRICING', './pricing', 'PRICING');
lazyProp(exportsObj, 'getModelPricing', './pricing', 'getModelPricing');
lazyProp(exportsObj, 'computeCost', './pricing', 'computeCost');
lazyProp(exportsObj, '_buildPricingFromRegistry', './pricing', '_buildPricingFromRegistry');

lazyProp(exportsObj, 'captureFeatureTelemetry', './providers/cc', 'captureFeatureTelemetry');
lazyProp(exportsObj, 'captureSessionTelemetry', './capture', 'captureSessionTelemetry');
lazyProp(exportsObj, 'captureGitTelemetry', './capture', 'captureGitTelemetry');
lazyProp(exportsObj, 'captureAgentTelemetry', './capture', 'captureAgentTelemetry');
lazyProp(exportsObj, 'captureAllAgentsTelemetry', './capture', 'captureAllAgentsTelemetry');
lazyProp(exportsObj, 'writeAgentFallbackSession', './capture', 'writeAgentFallbackSession');

lazyProp(exportsObj, 'resolveClaudeProjectDir', './providers/cc', 'resolveClaudeProjectDir');
lazyProp(exportsObj, 'parseTranscriptFile', './providers/cc', 'parseTranscriptFile');
lazyProp(exportsObj, 'parseTranscriptSession', './providers/cc', 'parseTranscriptSession');
lazyProp(exportsObj, 'findTranscriptFiles', './providers/cc', 'findTranscriptFiles');

lazyProp(exportsObj, 'resolveGeminiChatsDir', './providers/gg', 'resolveGeminiChatsDir');
lazyProp(exportsObj, 'parseGeminiSessionFile', './providers/gg', 'parseGeminiSessionFile');
lazyProp(exportsObj, 'parseGeminiTranscripts', './providers/gg', 'parseGeminiTranscripts');

lazyProp(exportsObj, 'resolveAntigravityConversationId', './providers/ag', 'resolveAntigravityConversationId');
lazyProp(exportsObj, 'parseAntigravityConversationDb', './providers/ag', 'parseAntigravityConversationDb');
lazyProp(exportsObj, 'parseAntigravityTranscripts', './providers/ag', 'parseAntigravityTranscripts');

lazyProp(exportsObj, 'parseCodexSessionFile', './providers/cx', 'parseCodexSessionFile');
lazyProp(exportsObj, 'findCodexSessionFiles', './providers/cx', 'findCodexSessionFiles');
lazyProp(exportsObj, 'parseCodexTranscripts', './providers/cx', 'parseCodexTranscripts');

lazyProp(exportsObj, 'parseOpenCodeDb', './providers/op', 'parseOpenCodeDb');
lazyProp(exportsObj, 'OPENCODE_DB_PATH', './providers/op', 'OPENCODE_DB_PATH');

lazyProp(exportsObj, 'getProviderByStrategy', './providers/registry', 'getProviderByStrategy');

module.exports = exportsObj;
