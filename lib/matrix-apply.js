'use strict';

/**
 * matrix-apply — apply a reviewed patch entry from a pricing- or qualitative-refresh run
 * to the corresponding agent JSON in templates/agents/.
 *
 * Refresh agents (weekly-agent-matrix-pricing-refresh, quarterly-agent-matrix-qualitative-refresh)
 * never mutate agent files directly; they write .aigon/matrix-refresh/<date>/proposed.json
 * and create feedback items. This module performs the actual write once the operator approves.
 *
 * Supported patch fields: pricing, label, quarantined, deprecated, notes, score.
 */

const fs = require('fs');
const path = require('path');

const AGENTS_DIR = path.join(__dirname, '..', 'templates', 'agents');
const REFRESH_DIR_BASENAME = '.aigon/matrix-refresh';

/**
 * Locate all proposed.json files under .aigon/matrix-refresh/, sorted newest first.
 */
function findPatchFiles(repoPath) {
    const refreshRoot = path.join(repoPath, REFRESH_DIR_BASENAME);
    if (!fs.existsSync(refreshRoot)) return [];
    const dirs = fs.readdirSync(refreshRoot)
        .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
        .sort()
        .reverse();
    return dirs
        .map(d => path.join(refreshRoot, d, 'proposed.json'))
        .filter(f => fs.existsSync(f));
}

/**
 * Find all patch entries for a given feedbackId across all patch files.
 * Returns an array of { entry, patchFile }.
 */
function findPatchEntries(repoPath, feedbackId) {
    const normalised = String(feedbackId);
    const results = [];
    for (const patchFile of findPatchFiles(repoPath)) {
        let doc;
        try {
            doc = JSON.parse(fs.readFileSync(patchFile, 'utf8'));
        } catch (_) {
            continue;
        }
        if (!Array.isArray(doc.changes)) continue;
        for (const entry of doc.changes) {
            if (String(entry.feedbackId) === normalised) {
                results.push({ entry, patchFile });
            }
        }
    }
    return results;
}

/** @deprecated use findPatchEntries */
function findPatchEntry(repoPath, feedbackId) {
    const all = findPatchEntries(repoPath, feedbackId);
    return all.length ? all[0] : null;
}

/**
 * Load agent JSON from templates/agents/<agentId>.json.
 */
function loadAgentJson(agentId) {
    const filePath = path.join(AGENTS_DIR, `${agentId}.json`);
    if (!fs.existsSync(filePath)) throw new Error(`Agent file not found: ${filePath}`);
    return { config: JSON.parse(fs.readFileSync(filePath, 'utf8')), filePath };
}

/**
 * Apply a single patch entry to the agent JSON config.
 * Mutates config in place; does not write to disk.
 */
function applyEntryToConfig(config, entry) {
    const { agentId, modelValue, changeKind, patch } = entry;

    const opts = config.cli && config.cli.modelOptions;
    if (!Array.isArray(opts)) {
        throw new Error(`Agent ${agentId} has no cli.modelOptions array`);
    }

    if (changeKind === 'new-model') {
        if (opts.some(o => o.value === modelValue)) {
            throw new Error(`Model ${modelValue} already exists in agent ${agentId}`);
        }
        const newOpt = {
            value: modelValue,
            label: patch.label || modelValue,
        };
        if (patch.pricing) newOpt.pricing = patch.pricing;
        if (patch.notes) newOpt.notes = patch.notes;
        newOpt.score = { spec: null, spec_review: null, implement: null, review: null, research: null };
        if (patch.score) Object.assign(newOpt.score, patch.score);
        newOpt.lastRefreshAt = new Date().toISOString();
        opts.push(newOpt);
        return;
    }

    const opt = opts.find(o => o.value === modelValue);
    if (!opt) {
        throw new Error(`Model ${modelValue} not found in agent ${agentId}`);
    }

    if (patch.pricing) {
        opt.pricing = { ...opt.pricing, ...patch.pricing };
    }
    if (patch.label !== undefined) {
        opt.label = patch.label;
    }
    if (patch.quarantined !== undefined) {
        opt.quarantined = patch.quarantined;
    }
    if (patch.deprecated !== undefined) {
        opt.deprecated = patch.deprecated;
    }
    if (patch.notes) {
        if (!opt.notes) opt.notes = {};
        Object.assign(opt.notes, patch.notes);
    }
    if (patch.score) {
        if (!opt.score) opt.score = {};
        Object.assign(opt.score, patch.score);
    }

    opt.lastRefreshAt = new Date().toISOString();
}

/**
 * Apply all reviewed feedback entries for a feedbackId to the agent registry.
 * Groups entries by agent file so each file is written once.
 *
 * @param {string} repoPath - Repo root directory.
 * @param {string|number} feedbackId - Feedback item ID to apply.
 * @param {{ dryRun?: boolean }} [opts]
 * @returns {Array<{ agentId, modelValue, changeKind, patchFile, filePath, dryRun }>}
 */
function applyFeedback(repoPath, feedbackId, opts = {}) {
    const found = findPatchEntries(repoPath, feedbackId);
    if (!found.length) {
        throw new Error(
            `No patch entries found for feedback #${feedbackId}. ` +
            `Check .aigon/matrix-refresh/*/proposed.json files.`
        );
    }

    // Group by agentId so we load/write each agent file once
    const byAgent = {};
    for (const { entry, patchFile } of found) {
        const { agentId, modelValue } = entry;
        if (!agentId) throw new Error('Patch entry missing agentId');
        if (modelValue === undefined) throw new Error('Patch entry missing modelValue');
        if (!byAgent[agentId]) {
            byAgent[agentId] = { entries: [], patchFile };
        }
        byAgent[agentId].entries.push(entry);
    }

    const results = [];
    for (const [agentId, { entries, patchFile }] of Object.entries(byAgent)) {
        const { config, filePath } = loadAgentJson(agentId);
        for (const entry of entries) {
            applyEntryToConfig(config, entry);
            results.push({
                agentId,
                modelValue: entry.modelValue,
                changeKind: entry.changeKind,
                patchFile,
                filePath,
                dryRun: Boolean(opts.dryRun),
            });
        }
        if (!opts.dryRun) {
            fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf8');
        }
    }

    return results;
}

module.exports = {
    applyFeedback,
    findPatchEntries,
    findPatchEntry,
    findPatchFiles,
};
