'use strict';

const fs = require('fs');
const path = require('path');
const agentStatus = require('../agent-status');
const { parseFeatureSpecFileName } = require('../dashboard-status-helpers');
const { STAGE_FOLDERS } = require('../workflow-core/paths');
const { parseFrontMatter } = require('../cli-parse');
const featureSets = require('../feature-sets');
const { AGENT_LOG_MAX_BYTES } = require('./constants');
const {
    safeReadDir,
    safeStatMtimeMs,
    stripFrontmatter,
    extractMarkdownSection,
    isAgentlessFeatureLogFile,
} = require('./safe-reads');

function readEntityLog(repoPath, entityType, entityId, agentId, options = {}) {
    const absRepo = path.resolve(repoPath);
    if (entityType === 'research') {
        const findingsPath = path.join(
            absRepo,
            'docs',
            'specs',
            'research-topics',
            'logs',
            `research-${entityId}-${agentId}-findings.md`
        );
        try {
            return {
                path: findingsPath,
                content: fs.readFileSync(findingsPath, 'utf8'),
            };
        } catch (_) {
            return null;
        }
    }

    const logsDirs = [
        path.join(absRepo, 'docs', 'specs', 'features', 'logs'),
    ];
    const worktreePath = options.worktreePath;
    if (worktreePath) {
        logsDirs.push(path.join(worktreePath, 'docs', 'specs', 'features', 'logs'));
    }

    const candidates = [];
    logsDirs.forEach(dir => {
        safeReadDir(dir)
            .filter(file => new RegExp(`^feature-${entityId}-${agentId}-.+-log\\.md$`).test(file))
            .forEach(file => candidates.push(path.join(dir, file)));
    });
    if (candidates.length === 0 && entityType === 'feature' && options.allowAgentlessFallback === true) {
        logsDirs.forEach(dir => {
            safeReadDir(dir)
                .filter(file => isAgentlessFeatureLogFile(file, entityId))
                .forEach(file => candidates.push(path.join(dir, file)));
        });
    }
    candidates.sort((left, right) => safeStatMtimeMs(right) - safeStatMtimeMs(left));
    const logPath = candidates[0];
    if (!logPath) return null;
    try {
        return {
            path: logPath,
            content: fs.readFileSync(logPath, 'utf8'),
        };
    } catch (_) {
        return null;
    }
}

function readEntityLogExcerpts(repoPath, entityType, entityId, agentId, options = {}) {
    const logEntry = readEntityLog(repoPath, entityType, entityId, agentId, options);
    if (!logEntry || !logEntry.content) return {};
    if (entityType === 'research') {
        return {
            findings: extractMarkdownSection(logEntry.content, 'Findings'),
            progress: extractMarkdownSection(logEntry.content, 'Progress'),
            summary: extractMarkdownSection(logEntry.content, 'Summary'),
        };
    }
    return {
        plan: extractMarkdownSection(logEntry.content, 'Plan'),
        progress: extractMarkdownSection(logEntry.content, 'Progress'),
        summary: extractMarkdownSection(logEntry.content, 'Summary'),
    };
}

function collectEntityAgentLogs(repoPath, featureId, agentFiles, resolvedSpecPath) {
    const absRepo = path.resolve(repoPath);
    const repoLogDir = path.join(absRepo, 'docs', 'specs', 'features', 'logs');
    const logsDirs = [repoLogDir];
    Object.values(agentFiles || {}).forEach(file => {
        if (file && file.worktreePath) {
            logsDirs.push(path.join(file.worktreePath, 'docs', 'specs', 'features', 'logs'));
        }
    });

    const expectedLogs = {};
    const parsedSpec = resolvedSpecPath ? parseFeatureSpecFileName(path.basename(resolvedSpecPath)) : null;
    const featureName = parsedSpec && parsedSpec.name ? parsedSpec.name : null;
    if (featureName) {
        Object.entries(agentFiles || {}).forEach(([agentId, file]) => {
            const baseDir = file && file.worktreePath
                ? path.join(file.worktreePath, 'docs', 'specs', 'features', 'logs')
                : repoLogDir;
            expectedLogs[agentId] = path.join(baseDir, `feature-${featureId}-${agentId}-${featureName}-log.md`);
        });
    }

    const logs = collectAgentLogs(logsDirs, featureId, expectedLogs);
    const knownAgentIds = Object.keys(agentFiles || {}).filter(id => id && id !== 'solo');
    const implementerId = knownAgentIds[0];
    if (logs.solo && knownAgentIds.length === 1 && (!logs[implementerId] || !logs[implementerId].content)) {
        logs[implementerId] = logs.solo;
        delete logs.solo;
    }
    return logs;
}

function countDoneEntities(repoPath, entityType = 'feature') {
    const absRepo = path.resolve(repoPath);
    const doneDir = path.join(
        absRepo,
        'docs',
        'specs',
        entityType === 'research' ? 'research-topics' : 'features',
        STAGE_FOLDERS.DONE
    );
    return safeReadDir(doneDir, file => new RegExp(`^${entityType}-\\d+-.+\\.md$`).test(file)).length;
}

function getAgentDetailRecords(repoPath, entityType, entityId, snapshotAgents = []) {
    const prefixes = entityType === 'research'
        ? ['research', 'feature']
        : ['feature', 'research'];
    const discoveredAgents = new Set(Array.isArray(snapshotAgents) ? snapshotAgents : []);
    agentStatus.listAgentStatuses(repoPath, entityId, { prefixes }).forEach(record => {
        if (record && record.data && record.data.agent) discoveredAgents.add(record.data.agent);
    });

    const agentFiles = {};
    const rawAgentFiles = {};
    Array.from(discoveredAgents)
        .sort((left, right) => left.localeCompare(right))
        .forEach(agentId => {
            const record = agentStatus.readAgentStatusRecordAt(repoPath, entityId, agentId, { prefixes });
            agentFiles[agentId] = record && record.data ? record.data : {};
            rawAgentFiles[agentId] = record && record.raw
                ? record.raw
                : JSON.stringify(agentFiles[agentId] || {}, null, 2);
        });

    return { agentFiles, rawAgentFiles };
}

/**
 * Collect agent implementation logs for a feature.
 *
 * Scans each provided logs directory for files matching
 *   feature-{id}-*-log.md
 * and keys them by agent id (the 2-char code after the feature id) or by
 * the literal string `"solo"` when no agent infix is present.
 *
 * Returns: { [agentId]: { path: string, content: string | null } }
 *
 * @param {string[]} logsDirs   Directories to scan (main repo + any worktree logs dirs)
 * @param {string|number} featureId  Feature id (will be matched as a number, padded or unpadded)
 * @param {Object<string, string>} [expectedEntries]  Optional expected log paths keyed by agent id
 * @returns {Object<string, {path: string, content: string|null}>}
 */
function collectAgentLogs(logsDirs, featureId, expectedEntries = {}) {
    const out = {};
    const dirs = Array.isArray(logsDirs) ? logsDirs : [logsDirs];
    const idStr = String(featureId);
    // Accept either padded ("07") or unpadded ("7") forms in filenames.
    const idNum = Number(idStr);
    const pattern = /^feature-(\d+)-(.+?)-log\.md$/;

    // Strip YAML frontmatter if present. Log files are supposed to be pure
    // narrative markdown per CLAUDE.md, but telemetry metadata (commit counts,
    // token usage, cost) gets written as frontmatter by the feature close /
    // feature-close anyway. Rendering that frontmatter through marked.parse()
    // produces a wall of bold text at the top of the log; users care about
    // the narrative, not the metadata dump. The metadata still lives in the
    // Stats tab for anyone who wants it.
    for (const dir of dirs) {
        if (!dir || !fs.existsSync(dir)) continue;
        let entries;
        try { entries = fs.readdirSync(dir); } catch (_) { continue; }
        for (const file of entries) {
            const m = file.match(pattern);
            if (!m) continue;
            if (Number(m[1]) !== idNum) continue;
            const rest = m[2];
            // If the next token is a 2-letter agent code, key by that;
            // otherwise it's a solo log.
            const agentMatch = rest.match(/^([a-z]{2})(?:-|$)/);
            const agentId = agentMatch ? agentMatch[1] : 'solo';
            // Don't overwrite an entry already filled from an earlier dir.
            if (out[agentId] && out[agentId].content !== null) continue;
            const fullPath = path.join(dir, file);
            let content = null;
            try {
                const raw = stripFrontmatter(fs.readFileSync(fullPath, 'utf8'));
                if (Buffer.byteLength(raw, 'utf8') > AGENT_LOG_MAX_BYTES) {
                    // Truncate on a UTF-8 boundary by slicing characters until we
                    // fit, then append the footer.
                    const sliced = raw.slice(0, AGENT_LOG_MAX_BYTES);
                    content = sliced + `\n\n… (log truncated — view full file at ${fullPath})`;
                } else {
                    content = raw;
                }
            } catch (_) {
                content = null;
            }
            out[agentId] = { path: fullPath, content };
        }
    }

    Object.entries(expectedEntries || {}).forEach(([agentId, expectedPath]) => {
        if (!agentId || out[agentId]) return;
        out[agentId] = { path: expectedPath, content: null };
    });

    return out;
}

function collectFeaturesForResearch(repoPath, researchId) {
    const id = parseInt(researchId, 10);
    if (!Number.isFinite(id) || id <= 0) return [];
    const absRepo = path.resolve(repoPath);
    const paths = featureSets.featurePathsForRepo(absRepo);
    const out = [];
    for (const folder of paths.folders) {
        const dir = path.join(paths.root, folder);
        if (!fs.existsSync(dir)) continue;
        let entries;
        try { entries = fs.readdirSync(dir); } catch (_) { continue; }
        for (const file of entries) {
            if (!file.startsWith(`${paths.prefix}-`) || !file.endsWith('.md')) continue;
            const fullPath = path.join(dir, file);
            let content;
            try { content = fs.readFileSync(fullPath, 'utf8'); } catch (_) { continue; }
            const { data } = parseFrontMatter(content);
            const ids = data && Array.isArray(data.research) ? data.research : null;
            if (!ids || !ids.includes(id)) continue;
            const idMatch = file.match(/^feature-(\d+)-(.+)\.md$/);
            const noIdMatch = !idMatch && file.match(/^feature-(.+)\.md$/);
            const featureId = idMatch ? idMatch[1] : null;
            const slug = idMatch ? idMatch[2] : (noIdMatch ? noIdMatch[1] : null);
            if (!slug) continue;
            out.push({
                id: featureId,
                name: slug.replace(/-/g, ' '),
                stage: featureSets.STAGE_BY_FOLDER[folder] || 'unknown',
                set: data && typeof data.set === 'string' ? data.set : null,
                complexity: data && data.complexity ? String(data.complexity) : null,
                specPath: fullPath,
            });
        }
    }
    out.sort((a, b) => {
        const sa = featureSets.STAGE_ORDER.indexOf(a.stage);
        const sb = featureSets.STAGE_ORDER.indexOf(b.stage);
        if (sa !== sb) return (sa === -1 ? 99 : sa) - (sb === -1 ? 99 : sb);
        const na = a.id ? parseInt(a.id, 10) : Number.POSITIVE_INFINITY;
        const nb = b.id ? parseInt(b.id, 10) : Number.POSITIVE_INFINITY;
        if (na !== nb) return na - nb;
        return a.name.localeCompare(b.name);
    });
    return out;
}

function collectResearchFindings(repoPath, researchId) {
    const absRepo = path.resolve(repoPath);
    const logsDir = path.join(absRepo, 'docs', 'specs', 'research-topics', 'logs');
    const out = {};
    if (!fs.existsSync(logsDir)) return out;
    const idNum = Number(researchId);
    const pattern = /^research-(\d+)-([a-z]{2})-findings\.md$/;
    let entries;
    try { entries = fs.readdirSync(logsDir); } catch (_) { return out; }
    for (const file of entries) {
        const m = file.match(pattern);
        if (!m || Number(m[1]) !== idNum) continue;
        const agentId = m[2];
        const fullPath = path.join(logsDir, file);
        let content = null;
        try {
            const raw = stripFrontmatter(fs.readFileSync(fullPath, 'utf8'));
            if (Buffer.byteLength(raw, 'utf8') > AGENT_LOG_MAX_BYTES) {
                content = raw.slice(0, AGENT_LOG_MAX_BYTES) + `\n\n… (truncated — view full file at ${fullPath})`;
            } else {
                content = raw;
            }
        } catch (_) { content = null; }
        out[agentId] = { path: fullPath, content };
    }
    return out;
}

module.exports = {
    readEntityLog,
    readEntityLogExcerpts,
    collectEntityAgentLogs,
    countDoneEntities,
    getAgentDetailRecords,
    collectAgentLogs,
    collectFeaturesForResearch,
    collectResearchFindings,
    AGENT_LOG_MAX_BYTES,
};
