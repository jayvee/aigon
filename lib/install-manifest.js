'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MANIFEST_PATH = '.aigon/install-manifest.json';
const MANIFEST_VERSION = '1.0';

function sha256(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

function manifestPath(repoRoot) {
    return path.join(repoRoot, MANIFEST_PATH);
}

function readManifest(repoRoot) {
    const p = manifestPath(repoRoot);
    if (!fs.existsSync(p)) return null;
    let raw;
    try {
        raw = fs.readFileSync(p, 'utf8');
    } catch (e) {
        throw new Error(`install-manifest: failed to read ${MANIFEST_PATH}: ${e.message}`);
    }
    try {
        return JSON.parse(raw);
    } catch (e) {
        throw new Error(`install-manifest: ${MANIFEST_PATH} is invalid JSON — run \`aigon doctor --fix\` to regenerate`);
    }
}

function writeManifest(repoRoot, manifest) {
    const p = manifestPath(repoRoot);
    const tmp = p + '.tmp';
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, p);
}

/**
 * Record a file write into the manifest.
 * @param {object} manifest - the manifest object (mutated in place)
 * @param {string} absPath - absolute path to the file on disk
 * @param {string} repoRoot - absolute repo root (for computing relative path)
 * @param {string} aigonVersion - aigon version string
 */
function recordFile(manifest, absPath, repoRoot, aigonVersion) {
    const relPath = path.relative(repoRoot, absPath).replace(/\\/g, '/');
    let content;
    try {
        content = fs.readFileSync(absPath);
    } catch (e) {
        return; // file may not exist (e.g. unchanged/skipped) — silently skip
    }
    const checksum = sha256(content);
    const entry = {
        path: relPath,
        sha256: checksum,
        version: aigonVersion,
        installedAt: new Date().toISOString(),
    };
    if (!manifest.files) manifest.files = [];
    const idx = manifest.files.findIndex(f => f.path === relPath);
    if (idx >= 0) {
        manifest.files[idx] = entry;
    } else {
        manifest.files.push(entry);
    }
}

/**
 * Remove a file entry from the manifest.
 */
function removeFile(manifest, relPath) {
    const norm = relPath.replace(/\\/g, '/');
    if (!manifest.files) return;
    manifest.files = manifest.files.filter(f => f.path !== norm);
}

/**
 * Return entries whose on-disk sha256 differs from the manifest.
 * @returns {Array<{path: string, expected: string, actual: string}>}
 */
function getModifiedFiles(manifest, repoRoot) {
    if (!manifest || !manifest.files) return [];
    const modified = [];
    for (const entry of manifest.files) {
        const absPath = path.join(repoRoot, entry.path);
        if (!fs.existsSync(absPath)) continue; // missing files are not "modified"
        let buf;
        try {
            buf = fs.readFileSync(absPath);
        } catch (_) {
            continue;
        }
        const actual = sha256(buf);
        if (actual !== entry.sha256) {
            modified.push({ path: entry.path, expected: entry.sha256, actual });
        }
    }
    return modified;
}

/**
 * Return entries that are in the manifest but not on disk.
 */
function getMissingFiles(manifest, repoRoot) {
    if (!manifest || !manifest.files) return [];
    return manifest.files.filter(entry => !fs.existsSync(path.join(repoRoot, entry.path)));
}

/**
 * Create a fresh empty manifest skeleton.
 */
function createEmptyManifest(aigonVersion) {
    return {
        version: MANIFEST_VERSION,
        aigonVersion,
        files: [],
    };
}

module.exports = {
    readManifest,
    writeManifest,
    recordFile,
    removeFile,
    getModifiedFiles,
    getMissingFiles,
    createEmptyManifest,
    MANIFEST_PATH,
    MANIFEST_VERSION,
};
