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

/**
 * Read the manifest, auto-recovering from corruption (invalid JSON).
 *
 * The manifest is pure derived metadata — fully rewritten by the next
 * install-agent/apply run — so a JSON.parse failure (e.g. unresolved git
 * conflict markers left by a stash-pop conflict, see lib/feature-close.js)
 * never needs human merge resolution. Recovery backs up the broken file
 * (nothing is silently discarded) and returns null, the same contract as
 * "manifest doesn't exist yet" that every caller already handles.
 * Disk-read errors (permissions, etc.) still throw — only a parse failure
 * is treated as auto-recoverable.
 * @returns {{ manifest: object|null, recovered: boolean, backupPath: string|null }}
 */
function readManifestRecovering(repoRoot) {
    const p = manifestPath(repoRoot);
    if (!fs.existsSync(p)) return { manifest: null, recovered: false, backupPath: null };
    const raw = fs.readFileSync(p, 'utf8');
    try {
        return { manifest: JSON.parse(raw), recovered: false, backupPath: null };
    } catch (_) {
        const backupPath = `${p}.corrupt-${Date.now()}`;
        fs.renameSync(p, backupPath);
        return { manifest: null, recovered: true, backupPath };
    }
}

const SCAN_DIRS = [
    '.aigon/docs',
    '.agents',
    '.claude/commands/aigon',
    '.claude/skills',
    '.cursor/commands',
    '.cursor/rules',
    '.codex',
    '.gemini',
    '.opencode',
];

/**
 * Rebuild a manifest from whatever aigon-owned files are actually on disk.
 *
 * Used whenever the on-disk manifest is missing or was just discarded as
 * corrupt: scans the same install paths install-agent writes to and records
 * every file found, so the result reflects current disk state regardless of
 * this repo's migration history (migration 2.61.0 only ever runs once per
 * repo — re-running it via the migration runner is a no-op on repos that
 * already migrated, which silently fails to regenerate a manifest that was
 * deleted or corrupted afterward).
 */
function synthesizeManifestFromDisk(repoRoot, aigonVersion) {
    const manifest = createEmptyManifest(aigonVersion);
    const now = new Date().toISOString();

    function scanDir(dir, recursive) {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const abs = path.join(dir, entry.name);
            if (entry.isFile()) {
                try {
                    const buf = fs.readFileSync(abs);
                    const relPath = path.relative(repoRoot, abs).replace(/\\/g, '/');
                    manifest.files.push({
                        path: relPath,
                        sha256: sha256(buf),
                        version: aigonVersion,
                        installedAt: now,
                    });
                } catch (_) { /* skip unreadable files */ }
            } else if (entry.isDirectory() && recursive) {
                scanDir(abs, true);
            }
        }
    }

    for (const dir of SCAN_DIRS) {
        scanDir(path.join(repoRoot, dir), true);
    }
    // Alias files directly under .claude/ (parent of commands/aigon/), non-recursive.
    scanDir(path.join(repoRoot, '.claude'), false);

    return manifest;
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
 * @param {object} [opts]
 * @param {string} [opts.templateSha] - sha256 of the upstream template at install time (F502)
 * @param {string} [opts.templatePath] - relative path to the upstream template (F502)
 */
function recordFile(manifest, absPath, repoRoot, aigonVersion, opts = {}) {
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
    if (opts.templateSha) entry.templateSha = opts.templateSha;
    if (opts.templatePath) entry.templatePath = opts.templatePath;
    if (!manifest.files) manifest.files = [];
    const idx = manifest.files.findIndex(f => f.path === relPath);
    if (idx >= 0) {
        // Preserve templateSha/templatePath if not overridden (e.g. on
        // refreshExistingFiles paths that don't know the upstream template).
        const prev = manifest.files[idx];
        if (!entry.templateSha && prev.templateSha) entry.templateSha = prev.templateSha;
        if (!entry.templatePath && prev.templatePath) entry.templatePath = prev.templatePath;
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
    readManifestRecovering,
    synthesizeManifestFromDisk,
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
    SCAN_DIRS,
};
