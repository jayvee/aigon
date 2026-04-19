'use strict';

const fs = require('fs');
const path = require('path');
const utils = require('./utils');

function resolveFeedbackRoot(repoPath = process.cwd()) {
    return path.join(repoPath, 'docs', 'specs', 'feedback');
}

function normalizeFeedbackStatus(value) {
    if (value === undefined || value === null) return null;
    const normalized = String(value).trim().toLowerCase();
    const aliasMap = {
        'inbox': 'inbox',
        'triaged': 'triaged',
        'actionable': 'actionable',
        'done': 'done',
        'wont-fix': 'wont-fix',
        'wontfix': 'wont-fix',
        'wont_fix': 'wont-fix',
        'duplicate': 'duplicate'
    };
    return aliasMap[normalized] || null;
}

function getFeedbackFolderFromStatus(status) {
    return utils.FEEDBACK_STATUS_TO_FOLDER[normalizeFeedbackStatus(status)] || null;
}

function normalizeFeedbackSeverity(value) {
    if (value === undefined || value === null) return null;
    const normalized = String(value).trim().toLowerCase();
    if (!normalized || normalized === 'none' || normalized === 'null') {
        return null;
    }
    return normalized;
}

function normalizeTag(value) {
    if (value === undefined || value === null) return null;
    const normalized = String(value).trim().toLowerCase().replace(/\s+/g, '-');
    return normalized || null;
}

function parseTagListValue(value) {
    if (value === undefined || value === null) return null;
    const rawValues = Array.isArray(value) ? value : [value];
    const tags = [];
    let shouldClear = false;

    rawValues.forEach(entry => {
        const text = String(entry).trim();
        if (!text) return;
        if (text.toLowerCase() === 'none' || text.toLowerCase() === 'null') {
            shouldClear = true;
            return;
        }
        text.split(',').forEach(part => {
            const tag = normalizeTag(part);
            if (tag) tags.push(tag);
        });
    });

    if (shouldClear) {
        return [];
    }
    return [...new Set(tags)];
}

function normalizeTagList(value) {
    if (value === undefined || value === null) return [];
    const tags = parseTagListValue(value);
    if (!tags) return [];
    return tags;
}

function serializeFeedbackFrontMatter(metadata) {
    const reporter = metadata.reporter || {};
    const source = metadata.source || {};
    const lines = [
        '---',
        `id: ${Number.isFinite(metadata.id) ? metadata.id : 0}`,
        `title: ${utils.serializeYamlScalar(metadata.title || '')}`,
        `status: ${utils.serializeYamlScalar(normalizeFeedbackStatus(metadata.status) || 'inbox')}`,
        `type: ${utils.serializeYamlScalar(metadata.type || 'unknown')}`,
        'reporter:',
        `  name: ${utils.serializeYamlScalar(reporter.name || '')}`,
        `  identifier: ${utils.serializeYamlScalar(reporter.identifier || '')}`,
        'source:',
        `  channel: ${utils.serializeYamlScalar(source.channel || '')}`,
        `  reference: ${utils.serializeYamlScalar(source.reference || '')}`
    ];

    if (source.url) {
        lines.push(`  url: ${utils.serializeYamlScalar(source.url)}`);
    }
    if (metadata.severity) {
        lines.push(`severity: ${utils.serializeYamlScalar(metadata.severity)}`);
    }
    if (Array.isArray(metadata.tags) && metadata.tags.length > 0) {
        lines.push(`tags: ${utils.serializeYamlScalar(metadata.tags)}`);
    }
    if (Number.isFinite(metadata.votes)) {
        lines.push(`votes: ${metadata.votes}`);
    }
    if (Number.isFinite(metadata.duplicate_of) && metadata.duplicate_of > 0) {
        lines.push(`duplicate_of: ${metadata.duplicate_of}`);
    }
    if (Array.isArray(metadata.linked_features) && metadata.linked_features.length > 0) {
        lines.push(`linked_features: ${utils.serializeYamlScalar(metadata.linked_features)}`);
    }
    if (Array.isArray(metadata.linked_research) && metadata.linked_research.length > 0) {
        lines.push(`linked_research: ${utils.serializeYamlScalar(metadata.linked_research)}`);
    }

    lines.push('---');
    return lines.join('\n');
}

function extractFeedbackSummary(body) {
    return utils.extractMarkdownSection(body, 'Summary');
}

function normalizeFeedbackMetadata(data, defaults = {}) {
    const reporterDefaults = defaults.reporter && typeof defaults.reporter === 'object' ? defaults.reporter : {};
    const sourceDefaults = defaults.source && typeof defaults.source === 'object' ? defaults.source : {};
    const reporterData = data.reporter && typeof data.reporter === 'object' ? data.reporter : {};
    const sourceData = data.source && typeof data.source === 'object' ? data.source : {};

    const idCandidate = data.id !== undefined ? parseInt(data.id, 10) : parseInt(defaults.id, 10);
    const status = normalizeFeedbackStatus(data.status) ||
        normalizeFeedbackStatus(defaults.status) ||
        'inbox';
    const type = String(data.type !== undefined ? data.type : (defaults.type || 'unknown')).trim() || 'unknown';

    const metadata = {
        id: Number.isFinite(idCandidate) ? idCandidate : 0,
        title: String(data.title !== undefined ? data.title : (defaults.title || '')),
        status,
        type,
        reporter: {
            name: String(reporterData.name !== undefined ? reporterData.name : (reporterDefaults.name || '')),
            identifier: String(reporterData.identifier !== undefined ? reporterData.identifier : (reporterDefaults.identifier || ''))
        },
        source: {
            channel: String(sourceData.channel !== undefined ? sourceData.channel : (sourceDefaults.channel || '')),
            reference: String(sourceData.reference !== undefined ? sourceData.reference : (sourceDefaults.reference || ''))
        }
    };

    const sourceUrl = sourceData.url !== undefined ? sourceData.url : sourceDefaults.url;
    if (sourceUrl) {
        metadata.source.url = String(sourceUrl);
    }

    const severityValue = data.severity !== undefined ? data.severity : defaults.severity;
    const severity = normalizeFeedbackSeverity(severityValue);
    if (severity) {
        metadata.severity = severity;
    }

    const tagsValue = data.tags !== undefined ? data.tags : defaults.tags;
    const tags = normalizeTagList(tagsValue);
    if (tags.length > 0) {
        metadata.tags = tags;
    }

    const votesValue = data.votes !== undefined ? data.votes : defaults.votes;
    const votes = parseInt(votesValue, 10);
    if (Number.isFinite(votes)) {
        metadata.votes = votes;
    }

    const duplicateValue = data.duplicate_of !== undefined ? data.duplicate_of : defaults.duplicate_of;
    const duplicateOf = parseInt(duplicateValue, 10);
    if (Number.isFinite(duplicateOf) && duplicateOf > 0) {
        metadata.duplicate_of = duplicateOf;
    }

    const linkedFeaturesValue = data.linked_features !== undefined ? data.linked_features : defaults.linked_features;
    const linkedFeatures = utils.parseNumericArray(linkedFeaturesValue);
    if (linkedFeatures.length > 0) {
        metadata.linked_features = linkedFeatures;
    }

    const linkedResearchValue = data.linked_research !== undefined ? data.linked_research : defaults.linked_research;
    const linkedResearch = utils.parseNumericArray(linkedResearchValue);
    if (linkedResearch.length > 0) {
        metadata.linked_research = linkedResearch;
    }

    return metadata;
}

function buildFeedbackDocumentContent(metadata, body) {
    const normalizedBody = body ? body.replace(/^\r?\n/, '') : '';
    const ensuredBody = normalizedBody ? (normalizedBody.endsWith('\n') ? normalizedBody : `${normalizedBody}\n`) : '';
    return `${serializeFeedbackFrontMatter(metadata)}\n\n${ensuredBody}`;
}

function readFeedbackDocument(fileObj, options = {}) {
    const content = fs.readFileSync(fileObj.fullPath, 'utf8');
    const parsed = utils.parseFrontMatter(content);
    const fileMatch = fileObj.file.match(/^feedback-(\d+)-(.*)\.md$/);
    const fallbackId = fileMatch ? parseInt(fileMatch[1], 10) : 0;
    const fallbackTitle = fileMatch ? fileMatch[2].replace(/-/g, ' ') : '';
    const fallbackStatus = normalizeFeedbackStatus(options.defaultStatus) || 'inbox';

    const metadata = normalizeFeedbackMetadata(parsed.data, {
        id: fallbackId,
        title: fallbackTitle,
        status: fallbackStatus,
        type: 'unknown',
        reporter: { name: '', identifier: '' },
        source: { channel: '', reference: '' }
    });
    const summary = extractFeedbackSummary(parsed.body);

    return {
        ...fileObj,
        metadata,
        body: parsed.body,
        summary
    };
}

function collectFeedbackItems(optionsOrFolders = utils.PATHS.feedback.folders) {
    const options = Array.isArray(optionsOrFolders)
        ? { folders: optionsOrFolders }
        : (optionsOrFolders || {});
    const repoPath = options.repoPath || process.cwd();
    const folders = Array.isArray(options.folders) && options.folders.length > 0
        ? options.folders
        : Object.values(utils.FEEDBACK_STATUS_TO_FOLDER);
    const feedbackRoot = resolveFeedbackRoot(repoPath);
    const items = [];

    folders.forEach(folder => {
        const folderPath = path.join(feedbackRoot, folder);
        if (!fs.existsSync(folderPath)) return;

        const files = fs.readdirSync(folderPath)
            .filter(file => file.startsWith('feedback-') && file.endsWith('.md'))
            .sort();

        files.forEach(file => {
            const fullPath = path.join(folderPath, file);
            items.push(readFeedbackDocument({ file, folder, fullPath }, { defaultStatus: 'inbox' }));
        });
    });

    items.sort((a, b) => {
        const mtimeA = fs.statSync(a.fullPath).mtimeMs;
        const mtimeB = fs.statSync(b.fullPath).mtimeMs;
        return mtimeB - mtimeA;
    });

    return items;
}

function tokenizeText(value) {
    return new Set(
        String(value || '')
            .toLowerCase()
            .match(/[a-z0-9]+/g) || []
    );
}

function jaccardSimilarity(setA, setB) {
    if (setA.size === 0 || setB.size === 0) return 0;
    let intersection = 0;
    setA.forEach(token => {
        if (setB.has(token)) intersection++;
    });
    const union = new Set([...setA, ...setB]).size;
    return union === 0 ? 0 : intersection / union;
}

function findDuplicateFeedbackCandidates(targetItem, allItems, limit = 3) {
    const targetTitleTokens = tokenizeText(targetItem.metadata.title);
    const targetSummaryTokens = tokenizeText(targetItem.summary);
    const targetCombinedTokens = new Set([...targetTitleTokens, ...targetSummaryTokens]);

    return allItems
        .filter(item => item.fullPath !== targetItem.fullPath && item.metadata.id !== targetItem.metadata.id)
        .map(item => {
            const titleTokens = tokenizeText(item.metadata.title);
            const summaryTokens = tokenizeText(item.summary);
            const combinedTokens = new Set([...titleTokens, ...summaryTokens]);

            const titleScore = jaccardSimilarity(targetTitleTokens, titleTokens);
            const summaryScore = jaccardSimilarity(targetSummaryTokens, summaryTokens);
            const combinedScore = jaccardSimilarity(targetCombinedTokens, combinedTokens);
            const weightedScore = (titleScore * 0.7) + (summaryScore * 0.3);
            const score = Math.max(weightedScore, combinedScore);

            return {
                id: item.metadata.id,
                title: item.metadata.title,
                status: item.metadata.status,
                score,
                file: item.file
            };
        })
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}

function buildFeedbackTriageRecommendation(metadata, duplicateCandidates) {
    const topDuplicate = duplicateCandidates[0];
    if (metadata.duplicate_of) {
        return {
            action: 'mark-duplicate',
            reason: `duplicate_of is set (#${metadata.duplicate_of})`
        };
    }
    if (topDuplicate && topDuplicate.score >= 0.72) {
        return {
            action: 'mark-duplicate',
            reason: `high similarity to #${topDuplicate.id} (${Math.round(topDuplicate.score * 100)}%)`
        };
    }
    if (metadata.status === 'wont-fix') {
        return {
            action: 'wont-fix',
            reason: 'status is already set to wont-fix'
        };
    }

    const severity = normalizeFeedbackSeverity(metadata.severity);
    const type = String(metadata.type || '').toLowerCase();
    if (severity === 'high' || severity === 'critical') {
        if (['bug', 'performance', 'reliability'].includes(type)) {
            return {
                action: 'promote-to-feature',
                reason: 'high-severity defect should be routed into implementation'
            };
        }
        if (['feature-request', 'ux', 'usability'].includes(type)) {
            return {
                action: 'promote-to-feature',
                reason: 'high-impact request should become actionable'
            };
        }
        return {
            action: 'promote-to-research',
            reason: 'high-severity signal needs investigation before implementation'
        };
    }

    return {
        action: 'keep',
        reason: 'no strong duplicate or escalation signal'
    };
}

function formatFeedbackFieldValue(value) {
    if (value === undefined || value === null || value === '') return 'unset';
    if (Array.isArray(value)) {
        return value.length ? value.join(', ') : 'none';
    }
    return String(value);
}

module.exports = {
    resolveFeedbackRoot,
    normalizeFeedbackStatus,
    getFeedbackFolderFromStatus,
    normalizeFeedbackSeverity,
    normalizeTag,
    parseTagListValue,
    normalizeTagList,
    serializeFeedbackFrontMatter,
    extractFeedbackSummary,
    normalizeFeedbackMetadata,
    buildFeedbackDocumentContent,
    readFeedbackDocument,
    collectFeedbackItems,
    tokenizeText,
    jaccardSimilarity,
    findDuplicateFeedbackCandidates,
    buildFeedbackTriageRecommendation,
    formatFeedbackFieldValue,
};
