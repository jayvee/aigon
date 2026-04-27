'use strict';

const fs = require('fs');
const path = require('path');
const workflowEngine = require('../../workflow-core/engine');
const { FEATURE_STAGE_FOLDERS, parseEntitySpecIdentity } = require('./seed-reset');

// Maps spec-folder stage names to workflow-core lifecycle states.
const STAGE_TO_LIFECYCLE = {
    'inbox': 'inbox',
    'backlog': 'backlog',
    'in-progress': 'implementing',
    'in-evaluation': 'evaluating',
    'done': 'done',
    'paused': 'paused',
};

const RESEARCH_STAGE_FOLDERS = [
    { folder: '01-inbox', stage: 'inbox' },
    { folder: '02-backlog', stage: 'backlog' },
    { folder: '03-in-progress', stage: 'in-progress' },
    { folder: '04-in-evaluation', stage: 'in-evaluation' },
    { folder: '05-done', stage: 'done' },
    { folder: '06-paused', stage: 'paused' },
];

/**
 * Feature 341: scan inbox/backlog specs for invalid `agent:` frontmatter values.
 * Returns specs whose agent: field names an agent not in the available set,
 * or specs without agent: that match the feature's snapshot authorAgentId
 * (warning they could be declared). Doctor --fix repairs invalid values to null.
 *
 * @param {string} repoPath
 * @param {string[]} availableAgents - agent ids valid in this repo
 * @returns {Array<{specPath:string, currentValue:string, reason:string, entityType:'feature'|'research'}>}
 */
function findSpecsWithInvalidAgentField(repoPath, availableAgents) {
    const { parseFrontMatter } = require('../../cli-parse');
    const result = [];
    const avail = new Set(Array.isArray(availableAgents) ? availableAgents : []);
    const scanStages = ['01-inbox', '02-backlog'];
    const roots = [
        { root: path.join(repoPath, 'docs', 'specs', 'features'), entityType: 'feature', prefix: 'feature' },
        { root: path.join(repoPath, 'docs', 'specs', 'research-topics'), entityType: 'research', prefix: 'research' },
    ];
    for (const { root, entityType, prefix } of roots) {
        for (const stage of scanStages) {
            const dir = path.join(root, stage);
            if (!fs.existsSync(dir)) continue;
            let files;
            try { files = fs.readdirSync(dir); } catch (_) { continue; }
            for (const file of files) {
                if (!file.startsWith(`${prefix}-`) || !file.endsWith('.md')) continue;
                const specPath = path.join(dir, file);
                let raw;
                try { raw = fs.readFileSync(specPath, 'utf8'); } catch (_) { continue; }
                const parsed = parseFrontMatter(raw);
                const agentField = parsed && parsed.data && parsed.data.agent;
                if (agentField === undefined || agentField === null || agentField === '') continue;
                const agentStr = String(agentField).trim();
                if (!agentStr) continue;
                if (!avail.has(agentStr)) {
                    result.push({
                        specPath,
                        currentValue: agentStr,
                        reason: `agent: '${agentStr}' is not in available agents (${[...avail].join(', ')})`,
                        entityType,
                    });
                }
            }
        }
    }
    return result;
}

function repairInvalidAgentField(specPath) {
    let raw;
    try { raw = fs.readFileSync(specPath, 'utf8'); } catch (_) { return false; }
    // Remove the agent: line entirely — safer than rewriting to null.
    const rewritten = raw.replace(/^agent:\s*[^\n]*\n/m, '');
    if (rewritten === raw) return false;
    fs.writeFileSync(specPath, rewritten, 'utf8');
    return true;
}

function findEntitiesMissingWorkflowState(repoPath) {
    const result = { features: [], research: [] };

    // Scan features
    const featuresRoot = path.join(repoPath, 'docs', 'specs', 'features');
    FEATURE_STAGE_FOLDERS.forEach(({ folder, stage }) => {
        const dir = path.join(featuresRoot, folder);
        if (!fs.existsSync(dir)) return;
        try {
            fs.readdirSync(dir)
                .filter(f => /^feature-.+\.md$/.test(f))
                .forEach(file => {
                    const id = parseEntitySpecIdentity(file, 'feature', stage);
                    if (!id) return;
                    const snapshotPath = path.join(repoPath, '.aigon', 'workflows', 'features', id, 'snapshot.json');
                    if (!fs.existsSync(snapshotPath)) {
                        result.features.push({ id, stage, specPath: path.join(dir, file) });
                    }
                });
        } catch (_) { /* ignore */ }
    });

    // Scan research
    const researchRoot = path.join(repoPath, 'docs', 'specs', 'research-topics');
    RESEARCH_STAGE_FOLDERS.forEach(({ folder, stage }) => {
        const dir = path.join(researchRoot, folder);
        if (!fs.existsSync(dir)) return;
        try {
            fs.readdirSync(dir)
                .filter(f => /^research-.+\.md$/.test(f))
                .forEach(file => {
                    const id = parseEntitySpecIdentity(file, 'research', stage);
                    if (!id) return;
                    const snapshotPath = path.join(repoPath, '.aigon', 'workflows', 'research', id, 'snapshot.json');
                    if (!fs.existsSync(snapshotPath)) {
                        result.research.push({ id, stage, specPath: path.join(dir, file) });
                    }
                });
        } catch (_) { /* ignore */ }
    });

    return result;
}

/**
 * Bootstrap minimal workflow state (events.jsonl + snapshot.json) for entities
 * that have spec files but no workflow-core snapshots.
 *
 * @param {string} repoPath
 * @param {Array<{id:string, stage:string, specPath:string}>} entities
 * @param {'feature'|'research'} entityType
 * @returns {number} count of bootstrapped entities
 */
function bootstrapMissingWorkflowSnapshots(repoPath, entities, entityType) {
    let count = 0;

    for (const entity of entities) {
        const workflowDir = entityType === 'research' ? 'research' : 'features';
        const snapshotPath = path.join(repoPath, '.aigon', 'workflows', workflowDir, entity.id, 'snapshot.json');

        // Never overwrite existing snapshots
        if (fs.existsSync(snapshotPath)) continue;

        const lifecycle = STAGE_TO_LIFECYCLE[entity.stage] || 'backlog';
        workflowEngine.ensureEntityBootstrappedSync(repoPath, entityType, entity.id, lifecycle, entity.specPath);
        count++;
    }

    return count;
}

module.exports = {
    STAGE_TO_LIFECYCLE,
    RESEARCH_STAGE_FOLDERS,
    findSpecsWithInvalidAgentField,
    repairInvalidAgentField,
    findEntitiesMissingWorkflowState,
    bootstrapMissingWorkflowSnapshots,
};
