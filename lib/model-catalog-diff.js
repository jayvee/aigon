'use strict';

/**
 * Weekly model-catalog diff — classifies registry modelOptions against a provider
 * catalog and proposes reviewable quarantine/archive blocks. Pure functions only;
 * no OSS CLI command. Consumed by maintainer/Pro tooling and the
 * weekly-model-catalog-intelligence recurring task.
 */

const OPENROUTER_VALUE_PREFIX = 'openrouter/';

/** @typedef {'active'|'retire-candidate'|'archive-candidate'|'unchanged'} CatalogDiffStatus */

/**
 * Normalize an OpenRouter API model id to Aigon op `value` form.
 * @param {string} providerId
 * @returns {string}
 */
function toOpenRouterRegistryValue(providerId) {
    const id = String(providerId || '').trim();
    if (!id) return '';
    if (id.startsWith(OPENROUTER_VALUE_PREFIX)) return id;
    return `${OPENROUTER_VALUE_PREFIX}${id}`;
}

/**
 * Build a lookup index from OpenRouter `GET /api/v1/models` rows.
 * @param {Array<{ id: string, name?: string, pricing?: { prompt?: string, completion?: string }, supported_parameters?: string[] }>} apiModels
 * @returns {Map<string, { value: string, label: string, supportsTools: boolean, pricing: { input: number, output: number } | null, rawId: string }>}
 */
function buildOpenRouterCatalogIndex(apiModels) {
    const index = new Map();
    if (!Array.isArray(apiModels)) return index;

    for (const row of apiModels) {
        if (!row || typeof row.id !== 'string' || !row.id.trim()) continue;
        const value = toOpenRouterRegistryValue(row.id);
        const params = Array.isArray(row.supported_parameters) ? row.supported_parameters : [];
        let pricing = null;
        if (row.pricing && row.pricing.prompt != null && row.pricing.completion != null) {
            const input = Number.parseFloat(row.pricing.prompt);
            const output = Number.parseFloat(row.pricing.completion);
            if (!Number.isNaN(input) && !Number.isNaN(output)) {
                pricing = { input, output };
            }
        }
        index.set(value, {
            value,
            label: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : row.id,
            supportsTools: params.includes('tools'),
            pricing,
            rawId: row.id,
        });
    }
    return index;
}

/**
 * @param {string[]} a
 * @param {string[]} b
 */
function supersededByEqual(a, b) {
    const left = (Array.isArray(a) ? a : []).slice().sort();
    const right = (Array.isArray(b) ? b : []).slice().sort();
    return left.length === right.length && left.every((v, i) => v === right[i]);
}

/**
 * @param {object} opt
 * @returns {object | null}
 */
function existingRetiredBlock(opt) {
    if (!opt) return null;
    return opt.quarantined || opt.archived || null;
}

/**
 * @param {{ since?: string, reason: string, evidence: string, supersededBy?: string[] }} fields
 */
function buildQuarantineProposal(fields) {
    const supersededBy = Array.isArray(fields.supersededBy)
        ? fields.supersededBy
        : fields.supersededBy
            ? [fields.supersededBy]
            : [];
    return {
        quarantined: {
            since: fields.since || new Date().toISOString().slice(0, 10),
            reason: fields.reason,
            evidence: fields.evidence,
            supersededBy,
        },
    };
}

/**
 * @param {{ since?: string, reason: string, evidence: string, supersededBy?: string[] }} fields
 */
function buildArchiveProposal(fields) {
    const supersededBy = Array.isArray(fields.supersededBy)
        ? fields.supersededBy
        : fields.supersededBy
            ? [fields.supersededBy]
            : [];
    return {
        archived: {
            since: fields.since || new Date().toISOString().slice(0, 10),
            reason: fields.reason,
            evidence: fields.evidence,
            supersededBy,
        },
    };
}

/**
 * Resolve registry value against catalog, honouring alias map (Aigon slug → canonical provider id).
 * @param {string} value
 * @param {Map<string, object>} catalogIndex
 * @param {Record<string, string>} aliasMap
 */
function resolveCatalogEntry(value, catalogIndex, aliasMap) {
    const canonical = aliasMap[value] || value;
    return catalogIndex.get(canonical) || catalogIndex.get(value) || null;
}

/**
 * Classify one registry model option against a provider catalog.
 *
 * @param {object} opt — one `cli.modelOptions` entry
 * @param {{
 *   catalogIndex: Map<string, object>,
 *   aliasMap?: Record<string, string>,
 *   supersessionBy?: Record<string, string[]>,
 *   today?: string,
 * }} ctx
 */
function classifyRegistryModelOption(opt, ctx) {
    const { catalogIndex, aliasMap = {}, supersessionBy = {}, today = new Date().toISOString().slice(0, 10) } = ctx;
    const value = opt && typeof opt.value === 'string' ? opt.value : null;
    if (!value) return null;

    const label = typeof opt.label === 'string' && opt.label.trim() ? opt.label.trim() : value;
    const catalogEntry = resolveCatalogEntry(value, catalogIndex, aliasMap);
    const retired = existingRetiredBlock(opt);
    const hintedSupersededBy = supersessionBy[value] || supersessionBy[aliasMap[value]] || null;

    const base = { value, label };

    if (retired) {
        let candidate = null;
        if (!catalogEntry) {
            candidate = {
                status: 'archive-candidate',
                recommendedAction: 'archive',
                reason: 'Model ID no longer appears on the OpenRouter catalog.',
                evidenceSource: 'openrouter-catalog',
                proposedBlock: buildArchiveProposal({
                    since: today,
                    reason: 'Removed from OpenRouter catalog — ID no longer routable.',
                    evidence: `openrouter.ai/api/v1/models — no row for ${value}`,
                    supersededBy: hintedSupersededBy || retired.supersededBy || [],
                }),
            };
        } else if (hintedSupersededBy && !supersededByEqual(retired.supersededBy, hintedSupersededBy)) {
            candidate = {
                status: 'retire-candidate',
                recommendedAction: 'quarantine',
                reason: 'Supersession target updated since last registry retirement.',
                evidenceSource: 'supersession-hint',
                proposedBlock: buildQuarantineProposal({
                    since: today,
                    reason: `Superseded by ${hintedSupersededBy.join(', ')}.`,
                    evidence: 'Maintainer supersession map / catalog intelligence',
                    supersededBy: hintedSupersededBy,
                }),
            };
        }

        if (!candidate) {
            return {
                ...base,
                status: 'unchanged',
                recommendedAction: null,
                reason: 'Existing quarantine/archive block unchanged — no new catalog evidence.',
                evidenceSource: 'registry',
                proposedBlock: null,
            };
        }

        const proposed = candidate.proposedBlock.quarantined || candidate.proposedBlock.archived;
        const reasonChanged = proposed.reason !== retired.reason;
        const supersessionChanged = !supersededByEqual(retired.supersededBy, proposed.supersededBy);
        const upgradeToArchive = Boolean(opt.quarantined && candidate.status === 'archive-candidate');

        if (!reasonChanged && !supersessionChanged && !upgradeToArchive) {
            return {
                ...base,
                status: 'unchanged',
                recommendedAction: null,
                reason: 'Existing quarantine/archive block unchanged — no new catalog evidence.',
                evidenceSource: 'registry',
                proposedBlock: null,
            };
        }

        return { ...base, ...candidate };
    }

    if (!catalogEntry) {
        return {
            ...base,
            status: 'archive-candidate',
            recommendedAction: 'archive',
            reason: 'Model ID missing from OpenRouter catalog (STALE-ID).',
            evidenceSource: 'openrouter-catalog',
            proposedBlock: buildArchiveProposal({
                since: today,
                reason: 'Removed from OpenRouter catalog — ID no longer routable.',
                evidence: `openrouter.ai/api/v1/models — no row for ${value}`,
                supersededBy: hintedSupersededBy || [],
            }),
        };
    }

    if (!catalogEntry.supportsTools) {
        return {
            ...base,
            status: 'retire-candidate',
            recommendedAction: 'quarantine',
            reason: 'OpenRouter lists the model but reports no tool-use support.',
            evidenceSource: 'openrouter-catalog',
            proposedBlock: buildQuarantineProposal({
                since: today,
                reason: 'Provider catalog reports no tools support — unsuitable for agentic coding loops.',
                evidence: `openrouter.ai/api/v1/models supported_parameters missing "tools" for ${catalogEntry.rawId}`,
                supersededBy: hintedSupersededBy || [],
            }),
        };
    }

    if (hintedSupersededBy && hintedSupersededBy.length > 0) {
        return {
            ...base,
            status: 'retire-candidate',
            recommendedAction: 'quarantine',
            reason: `Superseded by ${hintedSupersededBy.join(', ')}.`,
            evidenceSource: 'supersession-hint',
            proposedBlock: buildQuarantineProposal({
                since: today,
                reason: `Superseded by ${hintedSupersededBy.join(', ')}.`,
                evidence: 'Maintainer supersession map / catalog intelligence',
                supersededBy: hintedSupersededBy,
            }),
        };
    }

    return {
        ...base,
        status: 'active',
        recommendedAction: null,
        reason: 'Present on OpenRouter catalog with tool support.',
        evidenceSource: 'openrouter-catalog',
        proposedBlock: null,
    };
}

/**
 * Classify all non-placeholder modelOptions for weekly catalog diff output.
 *
 * @param {object[]} modelOptions
 * @param {object} ctx — see classifyRegistryModelOption
 * @returns {object[]}
 */
function classifyModelOptions(modelOptions, ctx) {
    const opts = Array.isArray(modelOptions) ? modelOptions : [];
    return opts
        .map(opt => classifyRegistryModelOption(opt, ctx))
        .filter(Boolean);
}

/**
 * Stable markdown section for pasting into weekly catalog intelligence reports.
 * @param {object[]} classifications
 * @returns {string}
 */
function formatRetireCandidateReport(classifications) {
    const rows = Array.isArray(classifications) ? classifications : [];
    const lines = [
        '## Registry retirement classification',
        '',
        '| value | label | status | recommended action | reason | evidence |',
        '|-------|-------|--------|--------------------|--------|----------|',
    ];

    for (const row of rows) {
        const action = row.recommendedAction || '—';
        const reason = String(row.reason || '').replace(/\|/g, '\\|');
        const evidence = String(row.evidenceSource || '').replace(/\|/g, '\\|');
        lines.push(`| ${row.value} | ${row.label} | ${row.status} | ${action} | ${reason} | ${evidence} |`);
    }

    const proposals = rows.filter(r => r.proposedBlock);
    if (proposals.length) {
        lines.push('', '### Proposed registry blocks (review before applying)', '');
        for (const row of proposals) {
            lines.push(`#### ${row.value}`);
            lines.push('```json');
            lines.push(JSON.stringify(row.proposedBlock, null, 2));
            lines.push('```', '');
        }
    }

    return lines.join('\n').trimEnd();
}

module.exports = {
    toOpenRouterRegistryValue,
    buildOpenRouterCatalogIndex,
    classifyRegistryModelOption,
    classifyModelOptions,
    formatRetireCandidateReport,
    buildQuarantineProposal,
    buildArchiveProposal,
};
