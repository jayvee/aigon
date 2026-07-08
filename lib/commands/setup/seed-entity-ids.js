'use strict';

const { STAGE_FOLDERS } = require('../../workflow-core');

const FEATURE_STAGE_FOLDERS = [
    { folder: STAGE_FOLDERS.INBOX, stage: 'inbox' },
    { folder: STAGE_FOLDERS.BACKLOG, stage: 'backlog' },
    { folder: STAGE_FOLDERS.IN_PROGRESS, stage: 'in-progress' },
    { folder: STAGE_FOLDERS.IN_EVALUATION, stage: 'in-evaluation' },
    { folder: STAGE_FOLDERS.DONE, stage: 'done' },
    { folder: STAGE_FOLDERS.PAUSED, stage: 'paused' },
];

const SEED_RESET_TO_BACKLOG = new Set(['in-progress', 'in-evaluation', 'paused']);

function canonicalSeedFeatureId(id) {
    const raw = String(id);
    if (/^\d+$/.test(raw)) return String(parseInt(raw, 10)).padStart(2, '0');
    return raw;
}

function parseEntitySpecIdentity(file, entityType, stage) {
    const prefix = entityType === 'research' ? 'research' : 'feature';
    const match = file.match(new RegExp(`^${prefix}-(.+)\\.md$`));
    if (!match) return null;
    const suffix = match[1];
    if (/^\d+-/.test(suffix)) {
        return canonicalSeedFeatureId(suffix.split('-')[0]);
    }
    if (stage === 'inbox') return suffix;
    return null;
}

module.exports = {
    FEATURE_STAGE_FOLDERS,
    SEED_RESET_TO_BACKLOG,
    canonicalSeedFeatureId,
    parseEntitySpecIdentity,
};
