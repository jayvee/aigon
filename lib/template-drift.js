'use strict';

/**
 * Template-vs-installed drift detection (F502).
 *
 * Three layers wired into the CLI:
 *   - Layer 1: cheap startup warning when templates have changed since install.
 *   - Layer 2: silent auto-reinstall on aigon version bump.
 *   - Layer 3: CI test that pins committed manifest to current templates.
 *
 * This module exposes the read-only helpers used by all three layers; the
 * write paths live in lib/commands/setup.js (install-agent / doctor).
 *
 * Cost note: layer 1 calls `detectStaleTemplates()` on every CLI invocation.
 * It MUST short-circuit on the cached fingerprint when templates/ has not
 * been touched since the last check — see `loadCache` / `saveCache`.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const installManifestLib = require('./install-manifest');

const CACHE_PATH = '.aigon/state/template-drift-cache.json';

function sha256OfFile(absPath) {
    try {
        return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
    } catch (_) {
        return null;
    }
}

/**
 * Walk a directory recursively and return the latest mtime + file count.
 * Used as a coarse fingerprint to skip drift work when nothing changed.
 */
function dirFingerprint(dir) {
    let latestMtimeMs = 0;
    let fileCount = 0;
    function walk(d) {
        let entries;
        try {
            entries = fs.readdirSync(d, { withFileTypes: true });
        } catch (_) {
            return;
        }
        for (const e of entries) {
            const abs = path.join(d, e.name);
            if (e.isDirectory()) {
                walk(abs);
            } else if (e.isFile()) {
                fileCount++;
                try {
                    const st = fs.statSync(abs);
                    if (st.mtimeMs > latestMtimeMs) latestMtimeMs = st.mtimeMs;
                } catch (_) { /* ignore */ }
            }
        }
    }
    walk(dir);
    return { latestMtimeMs, fileCount };
}

function loadCache(repoRoot) {
    const p = path.join(repoRoot, CACHE_PATH);
    if (!fs.existsSync(p)) return null;
    try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (_) {
        return null;
    }
}

function saveCache(repoRoot, cache) {
    const p = path.join(repoRoot, CACHE_PATH);
    try {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, JSON.stringify(cache, null, 2) + '\n', 'utf8');
    } catch (_) {
        // Cache write is best-effort: a read-only repo or permission issue
        // should not fail the CLI.
    }
}

/**
 * Map an agent id to the set of template-source paths it consumes. Used to
 * scope drift checks to actually-installed agents.
 *
 * Shape: { templates: ['templates/generic/commands', ...] }
 */
function getAgentTemplateSources(repoRoot) {
    return {
        // Shared by every agent — slash command source of truth.
        commands: path.join(repoRoot, 'templates', 'generic', 'commands'),
        // Aigon-owned docs vendored to .aigon/docs/.
        docs: path.join(repoRoot, 'templates', 'docs'),
        // Per-agent template files (cc.md / cu.md etc).
        agents: path.join(repoRoot, 'templates', 'agents'),
    };
}

/**
 * For each manifest entry under .claude/commands/aigon/, .cursor/commands/,
 * .gemini/commands/aigon/, .agents/skills/aigon-* (etc), find the upstream
 * template file and compare its sha256 against the manifest's recorded sha.
 *
 * Returns: { byAgent: { [agentId]: [{ path, templatePath, status }] } }
 *   status: 'OK' | 'STALE_TEMPLATE' | 'HAND_EDITED'
 *
 * STALE_TEMPLATE = manifest sha != current template sha (template moved on)
 * HAND_EDITED    = manifest sha != on-disk sha (user edited installed copy)
 *
 * A file can be both. We report STALE_TEMPLATE first since that's the
 * common "templates moved on, please reinstall" case.
 */
function classifyManifestEntries(manifest, repoRoot) {
    const byAgent = {};
    if (!manifest || !Array.isArray(manifest.files)) return { byAgent };

    const installedAgents = installManifestLib.getInstalledAgents(manifest);
    const templatesDir = path.join(repoRoot, 'templates', 'generic', 'commands');

    function bucketFor(relPath) {
        if (relPath.startsWith('.claude/commands/aigon/') || relPath.startsWith('.claude/skills/aigon/')) return 'cc';
        if (relPath.startsWith('.cursor/commands/') || relPath.startsWith('.cursor/rules/aigon')) return 'cu';
        if (relPath.startsWith('.gemini/commands/aigon/')) return 'gg';
        if (relPath.startsWith('.agents/skills/aigon-')) {
            // .agents/skills is shared by km/cx/op. Without per-file owner
            // metadata we group them under the first installed agent that
            // uses .agents/skills. This is good enough for L1's per-agent
            // warning; the doctor table reports the path anyway.
            for (const a of ['km', 'cx', 'op']) {
                if (installedAgents.includes(a)) return a;
            }
            return null;
        }
        return null;
    }

    for (const entry of manifest.files) {
        const agentId = bucketFor(entry.path);
        if (!agentId) continue;
        if (!installedAgents.includes(agentId)) continue;

        const absPath = path.join(repoRoot, entry.path);
        const diskSha = fs.existsSync(absPath) ? sha256OfFile(absPath) : null;
        const handEdited = diskSha && diskSha !== entry.sha256;

        // Map installed file → upstream template (best-effort, command paths only).
        let templatePath = null;
        let templateSha = null;
        const cmdMatch = entry.path.match(/(?:\.claude\/commands\/aigon|\.cursor\/commands|\.gemini\/commands\/aigon|\.agents\/skills)\/(?:aigon-)?([^/]+?)(?:\/SKILL\.md|\.toml|\.md)?$/);
        if (cmdMatch) {
            const cmdName = cmdMatch[1].replace(/\.md$/, '').replace(/^aigon-/, '');
            const candidate = path.join(templatesDir, cmdName + '.md');
            if (fs.existsSync(candidate)) {
                templatePath = path.relative(repoRoot, candidate);
                templateSha = sha256OfFile(candidate);
            }
        }

        // STALE_TEMPLATE = template content changed since install. We compare
        // template sha against the SHA of the installed file at install time
        // (entry.sha256) only as a coarse signal; in practice the template
        // and the installed file differ in formatting (toml vs md, etc), so
        // the stronger signal is template mtime > entry installedAt.
        let status = 'OK';
        if (templatePath) {
            try {
                const tStat = fs.statSync(path.join(repoRoot, templatePath));
                const installedAt = entry.installedAt ? new Date(entry.installedAt).getTime() : 0;
                if (tStat.mtimeMs > installedAt) status = 'STALE_TEMPLATE';
            } catch (_) { /* template missing — leave OK */ }
        }
        if (handEdited && status === 'OK') status = 'HAND_EDITED';

        if (!byAgent[agentId]) byAgent[agentId] = [];
        byAgent[agentId].push({
            path: entry.path,
            templatePath,
            templateSha,
            installedSha: entry.sha256,
            diskSha,
            status,
            handEdited: !!handEdited,
        });
    }
    return { byAgent };
}

/**
 * Layer 1's hot path. Returns a per-agent summary of stale templates.
 * Uses an mtime fingerprint cache so the steady-state cost is a single stat
 * tree on `templates/`.
 *
 * Returns: { byAgent: { [agentId]: { count, files: string[] } }, fromCache: boolean }
 */
function detectStaleTemplates(repoRoot) {
    const empty = { byAgent: {}, fromCache: false };

    let manifest;
    try {
        manifest = installManifestLib.readManifest(repoRoot);
    } catch (_) {
        return empty;
    }
    if (!manifest) return empty;

    const sources = getAgentTemplateSources(repoRoot);
    const fp = dirFingerprint(sources.commands);
    const cache = loadCache(repoRoot);
    if (cache
        && cache.templatesMtimeMs === fp.latestMtimeMs
        && cache.fileCount === fp.fileCount
        && cache.aigonVersion === manifest.aigonVersion
        && cache.byAgent) {
        return { byAgent: cache.byAgent, fromCache: true };
    }

    const { byAgent: classified } = classifyManifestEntries(manifest, repoRoot);
    const summary = {};
    for (const [agentId, entries] of Object.entries(classified)) {
        const stale = entries.filter(e => e.status === 'STALE_TEMPLATE').map(e => path.basename(e.path));
        if (stale.length > 0) {
            summary[agentId] = { count: stale.length, files: stale };
        }
    }

    saveCache(repoRoot, {
        templatesMtimeMs: fp.latestMtimeMs,
        fileCount: fp.fileCount,
        aigonVersion: manifest.aigonVersion,
        lastCheckedAt: new Date().toISOString(),
        byAgent: summary,
    });

    return { byAgent: summary, fromCache: false };
}

/**
 * Format the L1 warning lines. Pure function for test ergonomics.
 */
function formatDriftWarning(byAgent) {
    const lines = [];
    for (const [agentId, info] of Object.entries(byAgent)) {
        const files = info.files.slice(0, 3);
        const more = info.count > 3 ? ` (+${info.count - 3} more)` : '';
        lines.push(`⚠️  ${agentId}: ${info.count} template${info.count === 1 ? '' : 's'} updated since install (${files.join(', ')}${more}). Run aigon install-agent --all`);
    }
    return lines;
}

/**
 * Invalidate the cache (e.g. after install-agent runs).
 */
function clearCache(repoRoot) {
    const p = path.join(repoRoot, CACHE_PATH);
    try { fs.unlinkSync(p); } catch (_) { /* missing is fine */ }
}

module.exports = {
    detectStaleTemplates,
    classifyManifestEntries,
    formatDriftWarning,
    clearCache,
    getAgentTemplateSources,
    CACHE_PATH,
};
