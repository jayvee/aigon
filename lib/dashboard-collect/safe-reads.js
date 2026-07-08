'use strict';

const fs = require('fs');
const path = require('path');
const { formatDisplayKey } = require('../spec-identity');

function buildEntityDisplayKey(kind, id) {
    if (id == null || !/^\d+$/.test(String(id))) return null;
    return formatDisplayKey({ kind, number: parseInt(String(id), 10) });
}

function safeReadDir(dir, predicate = null) {
    if (!fs.existsSync(dir)) return [];
    try {
        const entries = fs.readdirSync(dir);
        return predicate ? entries.filter(predicate) : entries;
    } catch (_) {
        return [];
    }
}

function safeStatMtimeMs(filePath) {
    try {
        return fs.statSync(filePath).mtimeMs;
    } catch (_) {
        return 0;
    }
}

function safeStat(filePath) {
    try {
        return fs.statSync(filePath);
    } catch (_) {
        return null;
    }
}

function safeStatIsoTimes(filePath) {
    try {
        const stat = fs.statSync(filePath);
        return {
            updatedAt: stat.mtime.toISOString(),
            createdAt: stat.birthtime.toISOString()
        };
    } catch (_) {
        const now = new Date().toISOString();
        return { updatedAt: now, createdAt: now };
    }
}

function buildDetailFingerprint(...parts) {
    return parts
        .map(part => {
            if (part == null) return '';
            if (typeof part === 'object') return JSON.stringify(part);
            return String(part);
        })
        .join('|');
}

function listStageSpecFiles(stageDirs) {
    const specFiles = [];
    stageDirs.forEach(({ dir, stage, pattern }) => {
        safeReadDir(dir, file => pattern.test(file))
            .sort((a, b) => safeStatMtimeMs(path.join(dir, b)) - safeStatMtimeMs(path.join(dir, a)))
            .forEach(file => specFiles.push({ file, stage, dir }));
    });
    return specFiles;
}

function collectDoneSpecs(doneDir, pattern, limit = 10, options = {}) {
    // F459: done specs are immutable on disk — enumerate `05-done/` only.
    // No snapshot.json / events.jsonl reads (dominant cost at 600+ features).
    // Recent order: numeric id descending (prioritise order ≈ chronological).
    // Engine-first lifecycle remains `isEntityDone()` elsewhere (F397).
    const entityType = options.entityType || 'feature';
    const idRe = new RegExp(`^${entityType}-(\\d+)-.+\\.md$`);
    const files = safeReadDir(doneDir, file => pattern.test(file));
    const sorted = files
        .map(file => {
            const m = file.match(idRe);
            return { file, numId: m ? Number(m[1]) : -1 };
        })
        .sort((a, b) => b.numId - a.numId)
        .map(({ file }) => ({ file }));

    return {
        total: sorted.length,
        all: sorted,
        recent: sorted.slice(0, limit),
    };
}

function stripFrontmatter(raw) {
    return String(raw || '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

function extractMarkdownSection(content, heading) {
    if (!content || !heading) return '';
    const escaped = String(heading).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^##\\s+${escaped}\\s*\\r?\\n([\\s\\S]*?)(?=^##\\s+|$)`, 'im');
    const match = String(content).match(re);
    return match ? match[1].trim() : '';
}

function isAgentlessFeatureLogFile(file, featureId) {
    const m = String(file || '').match(/^feature-(\d+)-(.+?)-log\.md$/);
    if (!m || Number(m[1]) !== Number(featureId)) return false;
    return !/^([a-z]{2})(?:-|$)/.test(m[2]);
}

module.exports = {
    buildEntityDisplayKey,
    safeReadDir,
    safeStatMtimeMs,
    safeStat,
    safeStatIsoTimes,
    buildDetailFingerprint,
    listStageSpecFiles,
    collectDoneSpecs,
    stripFrontmatter,
    extractMarkdownSection,
    isAgentlessFeatureLogFile,
};
