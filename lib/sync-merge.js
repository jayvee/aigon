'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EPHEMERAL_STATE_FILE_RE = /(heartbeat|\.lock$|\.tmp$|\.temp$|\.pid$)/i;

function listFilesRecursive(root) {
    const files = [];
    if (!fs.existsSync(root)) return files;
    const stack = [''];
    while (stack.length > 0) {
        const rel = stack.pop();
        const abs = path.join(root, rel);
        const entries = fs.readdirSync(abs, { withFileTypes: true });
        entries.forEach((entry) => {
            const entryRel = rel ? path.join(rel, entry.name) : entry.name;
            if (entry.isDirectory()) {
                stack.push(entryRel);
            } else if (entry.isFile()) {
                files.push(entryRel);
            }
        });
    }
    return files.sort();
}

function ensureDirForFile(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJsonSafe(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
        return null;
    }
}

function writeJson(filePath, value) {
    ensureDirForFile(filePath);
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function fileSha1(filePath) {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha1').update(content).digest('hex');
}

function unionArrayByIdentity(a, b) {
    const seen = new Set();
    const out = [];
    [...a, ...b].forEach((item) => {
        const key = JSON.stringify(item);
        if (!seen.has(key)) {
            seen.add(key);
            out.push(item);
        }
    });
    return out;
}

function deepMergeJson(localValue, importedValue) {
    if (Array.isArray(localValue) && Array.isArray(importedValue)) {
        return unionArrayByIdentity(localValue, importedValue);
    }
    if (
        localValue
        && importedValue
        && typeof localValue === 'object'
        && typeof importedValue === 'object'
        && !Array.isArray(localValue)
        && !Array.isArray(importedValue)
    ) {
        const merged = { ...localValue };
        Object.keys(importedValue).forEach((key) => {
            if (Object.prototype.hasOwnProperty.call(merged, key)) {
                merged[key] = deepMergeJson(merged[key], importedValue[key]);
            } else {
                merged[key] = importedValue[key];
            }
        });
        return merged;
    }
    return localValue !== undefined ? localValue : importedValue;
}

function mergeEventsJsonl(localFile, importedFile) {
    const localLines = fs.existsSync(localFile)
        ? fs.readFileSync(localFile, 'utf8').split('\n').filter(Boolean)
        : [];
    const importedLines = fs.existsSync(importedFile)
        ? fs.readFileSync(importedFile, 'utf8').split('\n').filter(Boolean)
        : [];

    const seen = new Set();
    const merged = [];

    [...localLines, ...importedLines].forEach((line) => {
        const normalized = line.trim();
        if (!normalized) return;
        const key = crypto.createHash('sha1').update(normalized).digest('hex');
        if (!seen.has(key)) {
            seen.add(key);
            merged.push(normalized);
        }
    });

    ensureDirForFile(localFile);
    fs.writeFileSync(localFile, `${merged.join('\n')}${merged.length > 0 ? '\n' : ''}`, 'utf8');
}

function mergeTelemetry(localRoot, importedRoot, summary) {
    const importedFiles = listFilesRecursive(importedRoot);
    importedFiles.forEach((rel) => {
        const src = path.join(importedRoot, rel);
        const dst = path.join(localRoot, rel);
        if (!fs.existsSync(dst)) {
            ensureDirForFile(dst);
            fs.copyFileSync(src, dst);
            summary.telemetryFilesAdded += 1;
            return;
        }

        if (fileSha1(dst) === fileSha1(src)) {
            return;
        }

        const ext = path.extname(dst);
        const base = ext ? dst.slice(0, -ext.length) : dst;
        const alt = `${base}.imported-${Date.now()}${ext}`;
        ensureDirForFile(alt);
        fs.copyFileSync(src, alt);
        summary.telemetryFilesConflictCopied += 1;
    });
}

function mergeWorkflows(localRoot, importedRoot, summary) {
    const importedFiles = listFilesRecursive(importedRoot);
    importedFiles.forEach((rel) => {
        const src = path.join(importedRoot, rel);
        const dst = path.join(localRoot, rel);
        const name = path.basename(rel);

        if (name === 'lock') {
            return;
        }

        if (name === 'events.jsonl') {
            mergeEventsJsonl(dst, src);
            summary.workflowEventLogsMerged += 1;
            return;
        }

        if (name === 'snapshot.json' || name === 'stats.json') {
            return;
        }

        if (!fs.existsSync(dst)) {
            ensureDirForFile(dst);
            fs.copyFileSync(src, dst);
            summary.workflowFilesAdded += 1;
        }
    });

    const localFiles = listFilesRecursive(localRoot);
    localFiles.forEach((rel) => {
        const name = path.basename(rel);
        if (name === 'snapshot.json' || name === 'stats.json') {
            fs.rmSync(path.join(localRoot, rel), { force: true });
            summary.derivedFilesCleared += 1;
        }
    });
}

function mergeState(localRoot, importedRoot, summary) {
    const importedFiles = listFilesRecursive(importedRoot);
    importedFiles.forEach((rel) => {
        const src = path.join(importedRoot, rel);
        const dst = path.join(localRoot, rel);
        const name = path.basename(rel);

        if (EPHEMERAL_STATE_FILE_RE.test(name)) {
            return;
        }

        if (!fs.existsSync(dst)) {
            ensureDirForFile(dst);
            fs.copyFileSync(src, dst);
            summary.stateFilesAdded += 1;
            return;
        }

        if (path.extname(name).toLowerCase() !== '.json') {
            return;
        }

        const localJson = readJsonSafe(dst);
        const importedJson = readJsonSafe(src);
        if (!localJson || !importedJson) {
            return;
        }

        const merged = deepMergeJson(localJson, importedJson);
        writeJson(dst, merged);
        summary.stateFilesMerged += 1;
    });
}

function mergeRepoConfig(localConfigPath, importedConfigPath, summary) {
    const importedJson = readJsonSafe(importedConfigPath);
    if (!importedJson) return;
    if (!fs.existsSync(localConfigPath)) {
        writeJson(localConfigPath, importedJson);
        summary.configMerged += 1;
        return;
    }
    const localJson = readJsonSafe(localConfigPath) || {};
    const merged = deepMergeJson(localJson, importedJson);
    writeJson(localConfigPath, merged);
    summary.configMerged += 1;
}

function clearRepoCache(repoPath, summary) {
    const cacheDir = path.join(repoPath, '.aigon', 'cache');
    if (fs.existsSync(cacheDir)) {
        fs.rmSync(cacheDir, { recursive: true, force: true });
        summary.cacheDirsCleared += 1;
    }
}

function mergeBundleIntoRepos({ bundleRoot, repoPathById }) {
    const reposRoot = path.join(bundleRoot, 'repos');
    const summary = {
        reposMerged: 0,
        reposSkipped: [],
        telemetryFilesAdded: 0,
        telemetryFilesConflictCopied: 0,
        workflowEventLogsMerged: 0,
        workflowFilesAdded: 0,
        stateFilesAdded: 0,
        stateFilesMerged: 0,
        configMerged: 0,
        derivedFilesCleared: 0,
        cacheDirsCleared: 0,
    };

    if (!fs.existsSync(reposRoot)) {
        return summary;
    }

    fs.readdirSync(reposRoot).forEach((repoId) => {
        const importedRepoAigon = path.join(reposRoot, repoId, '.aigon');
        if (!fs.existsSync(importedRepoAigon)) return;

        const targetRepoPath = repoPathById[repoId];
        if (!targetRepoPath || !fs.existsSync(targetRepoPath)) {
            summary.reposSkipped.push(repoId);
            return;
        }

        const targetAigon = path.join(targetRepoPath, '.aigon');
        fs.mkdirSync(targetAigon, { recursive: true });

        mergeTelemetry(
            path.join(targetAigon, 'telemetry'),
            path.join(importedRepoAigon, 'telemetry'),
            summary,
        );
        mergeWorkflows(
            path.join(targetAigon, 'workflows'),
            path.join(importedRepoAigon, 'workflows'),
            summary,
        );
        mergeState(
            path.join(targetAigon, 'state'),
            path.join(importedRepoAigon, 'state'),
            summary,
        );
        mergeRepoConfig(
            path.join(targetAigon, 'config.json'),
            path.join(importedRepoAigon, 'config.json'),
            summary,
        );
        clearRepoCache(targetRepoPath, summary);

        summary.reposMerged += 1;
    });

    return summary;
}

module.exports = {
    mergeBundleIntoRepos,
};
