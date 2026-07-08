'use strict';

/**
 * Telemetry provider registry.
 *
 * Provider contract (each module under providers/):
 * - strategyId: string matching templates/agents/<id>.json runtime.telemetryStrategy
 * - parseTranscripts(worktreePath, options): legacy fallback parse → aggregated frontmatter shape
 *
 * Claude (cc) additionally exports captureFeatureTelemetry(featureId, featureDesc, options)
 * for the claude-transcript strategy default path.
 *
 * Registry maps strategy id → provider. Unknown strategies return null (no throw).
 */

const cc = require('./cc');
const gg = require('./gg');
const ag = require('./ag');
const cx = require('./cx');
const op = require('./op');

const BY_STRATEGY = Object.freeze({
    [cc.strategyId]: cc,
    [gg.strategyId]: gg,
    [ag.strategyId]: ag,
    [cx.strategyId]: cx,
    [op.strategyId]: op,
});

function getProviderByStrategy(strategyId) {
    if (!strategyId) return null;
    return BY_STRATEGY[strategyId] || null;
}

module.exports = {
    getProviderByStrategy,
    BY_STRATEGY,
};
