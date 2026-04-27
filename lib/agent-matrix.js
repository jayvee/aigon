'use strict';

/**
 * Agent capability matrix — read-only registry projection (F370).
 *
 * Returns a flat array of MatrixRow, one per concrete (agent, modelValue) pair
 * across all registered agents. Null-value "Default" options are included so
 * the UI can show an agent row even when no concrete model is set.
 *
 * The five operations are: spec, spec_review, implement, review, research.
 */

const agentRegistry = require('./agent-registry');

const OPERATIONS = ['research', 'spec', 'spec_review', 'implement', 'review'];

const OPERATION_LABELS = {
    research:     'Research',
    spec:         'Spec',
    spec_review:  'Spec Review',
    implement:    'Implement',
    review:       'Code Review',
};

/**
 * Build the full matrix.
 *
 * @returns {MatrixRow[]}
 *
 * MatrixRow shape:
 *   agentId          string
 *   agentDisplayName string
 *   modelValue       string | null
 *   modelLabel       string
 *   pricing          { inputPerM: number, outputPerM: number } | null
 *   notes            { spec?, spec_review?, implement?, review?, research? }
 *   score            { spec?: number|null, spec_review?: number|null,
 *                      implement?: number|null, review?: number|null,
 *                      research?: number|null }
 *   lastRefreshAt    string | null
 *   quarantined      object | null
 */
function buildMatrix() {
    const rows = [];

    for (const agent of agentRegistry.getAllAgents()) {
        const options = agent.cli?.modelOptions;
        if (!Array.isArray(options) || options.length === 0) continue;

        for (const opt of options) {
            rows.push({
                agentId: agent.id,
                agentDisplayName: agent.displayName || agent.name,
                modelValue: opt.value,
                modelLabel: opt.label || opt.value || 'Default',
                pricing: opt.pricing
                    ? { inputPerM: opt.pricing.input, outputPerM: opt.pricing.output }
                    : null,
                notes: opt.notes || {},
                score: opt.score || {},
                lastRefreshAt: opt.lastRefreshAt || null,
                quarantined: opt.quarantined || null,
            });
        }
    }

    return rows;
}

/**
 * Return matrix rows grouped by agentId.
 */
function buildMatrixByAgent() {
    const rows = buildMatrix();
    const groups = {};
    for (const row of rows) {
        if (!groups[row.agentId]) groups[row.agentId] = [];
        groups[row.agentId].push(row);
    }
    return groups;
}

module.exports = {
    OPERATIONS,
    OPERATION_LABELS,
    buildMatrix,
    buildMatrixByAgent,
};
