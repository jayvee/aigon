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
 * Refresh checksums for entries already tracked in the manifest.
 * This is used after install/update paths that intentionally rewrite or merge
 * Aigon-managed files, so stale bootstrap manifests do not keep reporting
 * normal installer output as external edits.
 */
function refreshExistingFiles(manifest, repoRoot, aigonVersion) {
    if (!manifest || !Array.isArray(manifest.files)) return;
    const trackedPaths = manifest.files.map(entry => entry.path);
    trackedPaths.forEach(relPath => {
        const absPath = path.join(repoRoot, relPath);
        if (fs.existsSync(absPath)) {
            recordFile(manifest, absPath, repoRoot, aigonVersion);
        }
    });
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
        agents: [],
        files: [],
    };
}

/**
 * Record that an agent has been installed. Idempotent.
 */
function recordAgent(manifest, agentId, aigonVersion) {
    if (!manifest.agents) manifest.agents = [];
    if (!manifest.agents.includes(agentId)) {
        manifest.agents.push(agentId);
    }
    if (!manifest.agentInstalls) manifest.agentInstalls = {};
    manifest.agentInstalls[agentId] = {
        version: aigonVersion,
        installedAt: new Date().toISOString(),
    };
}

/**
 * Derive list of installed agents. Prefers manifest.agents (F502); falls back
 * to inferring from file paths for older manifests written before F502.
 */
function getInstalledAgents(manifest) {
    if (!manifest) return [];
    if (Array.isArray(manifest.agents) && manifest.agents.length > 0) {
        return [...manifest.agents];
    }
    const files = (manifest.files || []).map(f => f.path);
    const agents = new Set();
    if (files.some(p => p.startsWith('.claude/commands/aigon/') || p.startsWith('.claude/skills/aigon/'))) agents.add('cc');
    if (files.some(p => p.startsWith('.cursor/commands/') || p.startsWith('.cursor/rules/aigon'))) agents.add('cu');
    if (files.some(p => p.startsWith('.gemini/commands/aigon/'))) agents.add('gg');
    if (files.some(p => p.startsWith('.agents/skills/aigon-'))) {
        // Could be cx, km, op — leave conservative: trust manifest.agents in
        // newer manifests; for legacy, fall back to checking for agent-specific
        // marker files (e.g. .codex/config.toml ⇒ cx).
        if (files.some(p => p === '.codex/config.toml')) agents.add('cx');
        if (files.some(p => p.startsWith('.opencode/'))) agents.add('op');
        // Kimi has no other discriminator; assume km if .agents/skills exists
        // and no other agent claimed it.
        if (!files.some(p => p === '.codex/config.toml' || p.startsWith('.opencode/'))) {
            agents.add('km');
        }
    }
    return [...agents];
}

module.exports = {
    readManifest,
    writeManifest,
    recordFile,
    removeFile,
    refreshExistingFiles,
    getModifiedFiles,
    getMissingFiles,
    createEmptyManifest,
    recordAgent,
    getInstalledAgents,
    MANIFEST_PATH,
    MANIFEST_VERSION,
};
