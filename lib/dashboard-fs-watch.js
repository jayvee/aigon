'use strict';

/**
 * F621: debounced filesystem watchers that trigger targeted repo status refresh.
 * Thin layer only — `fs event → debounce → pollRepoStatus(repoPath)`.
 */

const fs = require('fs');
const path = require('path');
const { STAGE_FOLDERS } = require('./workflow-core/paths');

const DEBOUNCE_MS = 400;
const EDITOR_NOISE_RE = /(?:\.swp$|~$|\.tmp$|\.DS_Store$)/;
const POLL_SIDE_EFFECT_RE = /(?:^heartbeat-|nudge-recovery-pending-|\.lock$|\/telemetry\/|\/cache\/)/;

// Keep in sync with utils.FEEDBACK_STATUS_TO_FOLDER — do not require utils here
// (utils → dashboard-server → dashboard-fs-watch circular dependency).
const FEEDBACK_STAGE_DIRS = Object.freeze([
    '01-inbox',
    '02-triaged',
    '03-actionable',
    '04-done',
    '05-wont-fix',
    '06-duplicate',
]);

/**
 * Agent status files the collector reads live under the primary repo
 * `.aigon/state/` (not per-worktree checkouts). Worktrees are created and
 * destroyed dynamically under `~/.aigon/worktrees/<repo>/` — we do not watch
 * those paths; the 60s safety-net interval poll covers tmux liveness there.
 */

function resolveFeatureSpecStageDirs(absRepoPath) {
    const root = path.join(absRepoPath, 'docs', 'specs', 'features');
    return Object.values(STAGE_FOLDERS).map((stage) => path.join(root, stage));
}

function resolveResearchSpecStageDirs(absRepoPath) {
    const root = path.join(absRepoPath, 'docs', 'specs', 'research-topics');
    return Object.values(STAGE_FOLDERS).map((stage) => path.join(root, stage));
}

function resolveFeedbackSpecStageDirs(absRepoPath) {
    const root = path.join(absRepoPath, 'docs', 'specs', 'feedback');
    return FEEDBACK_STAGE_DIRS.map((stage) => path.join(root, stage));
}

function resolveWorkflowEntityDirs(absRepoPath) {
    const dirs = [];
    for (const kind of ['features', 'research']) {
        const parent = path.join(absRepoPath, '.aigon', 'workflows', kind);
        if (!fs.existsSync(parent)) continue;
        try {
            for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
                if (entry.isDirectory()) dirs.push(path.join(parent, entry.name));
            }
        } catch (_) { /* best-effort */ }
    }
    return dirs;
}

/**
 * Directories whose changes should trigger a repo status refresh.
 * @param {string} absRepoPath
 * @returns {string[]}
 */
function resolveRepoWatchPaths(absRepoPath) {
    const paths = [
        path.join(absRepoPath, '.aigon', 'state'),
        ...resolveFeatureSpecStageDirs(absRepoPath),
        ...resolveResearchSpecStageDirs(absRepoPath),
        ...resolveFeedbackSpecStageDirs(absRepoPath),
        ...resolveWorkflowEntityDirs(absRepoPath),
    ];
    const seen = new Set();
    const out = [];
    for (const dir of paths) {
        const resolved = path.resolve(dir);
        if (seen.has(resolved)) continue;
        seen.add(resolved);
        if (fs.existsSync(resolved)) out.push(resolved);
    }
    return out;
}

function resolveRecursiveWatchRoots(absRepoPath) {
    const roots = [];
    for (const rel of [
        path.join('.aigon', 'state'),
        path.join('.aigon', 'workflows'),
        path.join('docs', 'specs', 'features'),
        path.join('docs', 'specs', 'research-topics'),
        path.join('docs', 'specs', 'feedback'),
    ]) {
        const full = path.join(absRepoPath, rel);
        if (fs.existsSync(full)) roots.push(full);
    }
    return roots;
}

function shouldIgnoreWatchPath(filenameOrRel) {
    if (!filenameOrRel) return false;
    const base = path.basename(String(filenameOrRel));
    if (EDITOR_NOISE_RE.test(base)) return true;
    if (POLL_SIDE_EFFECT_RE.test(String(filenameOrRel))) return true;
    if (POLL_SIDE_EFFECT_RE.test(base)) return true;
    return false;
}

function resolveFsWatchEnabled(repoPath, globalConfig, loadProjectConfig) {
    const globalVal = globalConfig && globalConfig.dashboard && globalConfig.dashboard.fsWatch;
    if (globalVal === false) return false;
    if (!repoPath || typeof loadProjectConfig !== 'function') return true;
    try {
        const project = loadProjectConfig(repoPath) || {};
        if (project.dashboard && project.dashboard.fsWatch === false) return false;
    } catch (_) { /* default enabled */ }
    return true;
}

function supportsRecursiveWatch() {
    return process.platform === 'darwin';
}

/**
 * @param {{
 *   log?: Function,
 *   pollRepoStatus: (repoPath: string) => Promise<void>|void,
 *   readRepos: () => string[],
 *   loadGlobalConfig?: () => object,
 *   loadProjectConfig?: (repoPath: string) => object,
 *   debounceMs?: number,
 * }} options
 */
function createDashboardFsWatch(options = {}) {
    const log = typeof options.log === 'function' ? options.log : () => {};
    const pollRepoStatus = options.pollRepoStatus;
    const readRepos = options.readRepos;
    const loadGlobalConfig = options.loadGlobalConfig || (() => ({}));
    const loadProjectConfig = options.loadProjectConfig || (() => ({}));
    const debounceMs = Number.isFinite(options.debounceMs) ? options.debounceMs : DEBOUNCE_MS;

    /** @type {Map<string, { handles: import('fs').FSWatcher[], debounceTimer: NodeJS.Timeout|null, failed: boolean, failedLogged: boolean, workflowParents: string[] }>} */
    const byRepo = new Map();

    function scheduleRepoPoll(repoPath) {
        const key = path.resolve(String(repoPath || ''));
        if (!key) return;
        let entry = byRepo.get(key);
        if (!entry || entry.failed) return;
        if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
        entry.debounceTimer = setTimeout(() => {
            entry.debounceTimer = null;
            Promise.resolve(pollRepoStatus(key)).catch((err) => {
                log(`[fs-watch] poll failed for ${path.basename(key)}: ${err && err.message ? err.message : err}`);
            });
        }, debounceMs);
        if (typeof entry.debounceTimer.unref === 'function') entry.debounceTimer.unref();
    }

    function attachWatcher(repoPath, watchPath, onEvent) {
        const handle = fs.watch(watchPath, { persistent: false }, onEvent);
        handle.on('error', (err) => {
            const key = path.resolve(repoPath);
            const entry = byRepo.get(key);
            if (entry && !entry.failedLogged) {
                entry.failedLogged = true;
                entry.failed = true;
                log(`[fs-watch] watcher error for ${path.basename(key)} (${watchPath}): ${err && err.message ? err.message : err} — falling back to interval poll`);
            }
            try { handle.close(); } catch (_) { /* ignore */ }
        });
        return handle;
    }

    function refreshWorkflowEntityWatchers(repoPath, entry) {
        if (supportsRecursiveWatch()) return;
        const absRepoPath = path.resolve(repoPath);
        const desired = new Set(resolveWorkflowEntityDirs(absRepoPath));
        const existing = entry.workflowEntityWatchPaths || new Set();
        for (const dir of desired) {
            if (existing.has(dir)) continue;
            try {
                const handle = attachWatcher(absRepoPath, dir, (_eventType, filename) => {
                    if (shouldIgnoreWatchPath(filename)) return;
                    scheduleRepoPoll(absRepoPath);
                });
                entry.handles.push(handle);
                existing.add(dir);
            } catch (_) { /* entity dir may have vanished */ }
        }
        entry.workflowEntityWatchPaths = existing;
    }

    function watchRepo(repoPath) {
        const absRepoPath = path.resolve(String(repoPath || ''));
        if (!absRepoPath) return { status: 'skipped' };
        unwatchRepo(absRepoPath);

        const globalConfig = loadGlobalConfig();
        if (!resolveFsWatchEnabled(absRepoPath, globalConfig, loadProjectConfig)) {
            return { status: 'disabled' };
        }

        const entry = {
            handles: [],
            debounceTimer: null,
            failed: false,
            failedLogged: false,
            workflowParents: [],
            workflowEntityWatchPaths: new Set(),
        };
        byRepo.set(absRepoPath, entry);

        try {
            if (supportsRecursiveWatch()) {
                for (const root of resolveRecursiveWatchRoots(absRepoPath)) {
                    const handle = attachWatcher(absRepoPath, root, (_eventType, filename) => {
                        if (shouldIgnoreWatchPath(filename)) return;
                        scheduleRepoPoll(absRepoPath);
                    });
                    entry.handles.push(handle);
                }
            } else {
                for (const watchPath of resolveRepoWatchPaths(absRepoPath)) {
                    const handle = attachWatcher(absRepoPath, watchPath, (_eventType, filename) => {
                        if (shouldIgnoreWatchPath(filename)) return;
                        scheduleRepoPoll(absRepoPath);
                    });
                    entry.handles.push(handle);
                }
                for (const parent of [
                    path.join(absRepoPath, '.aigon', 'workflows', 'features'),
                    path.join(absRepoPath, '.aigon', 'workflows', 'research'),
                ]) {
                    if (!fs.existsSync(parent)) continue;
                    entry.workflowParents.push(parent);
                    const handle = attachWatcher(absRepoPath, parent, (eventType, filename) => {
                        if (filename && shouldIgnoreWatchPath(filename)) return;
                        refreshWorkflowEntityWatchers(absRepoPath, entry);
                        if (eventType === 'rename' || filename) scheduleRepoPoll(absRepoPath);
                    });
                    entry.handles.push(handle);
                }
                refreshWorkflowEntityWatchers(absRepoPath, entry);
            }
        } catch (err) {
            entry.failed = true;
            entry.failedLogged = true;
            log(`[fs-watch] failed to watch ${path.basename(absRepoPath)}: ${err && err.message ? err.message : err}`);
            return { status: 'failed', error: err && err.message ? err.message : String(err) };
        }

        if (entry.handles.length === 0) {
            return { status: 'empty' };
        }
        return { status: 'ok', watchCount: entry.handles.length };
    }

    function unwatchRepo(repoPath) {
        const key = path.resolve(String(repoPath || ''));
        const entry = byRepo.get(key);
        if (!entry) return;
        if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
        for (const handle of entry.handles) {
            try { handle.close(); } catch (_) { /* ignore */ }
        }
        byRepo.delete(key);
    }

    function start() {
        const globalConfig = loadGlobalConfig();
        if (!resolveFsWatchEnabled(null, globalConfig, loadProjectConfig)) {
            log('[fs-watch] disabled by config (dashboard.fsWatch=false)');
            return { mode: 'disabled-config' };
        }
        if (!supportsRecursiveWatch()) {
            log('[fs-watch] enabled (non-recursive Linux fallback, debounce=' + debounceMs + 'ms)');
        } else {
            log('[fs-watch] enabled (recursive, debounce=' + debounceMs + 'ms)');
        }
        const repos = (readRepos() || []).map((r) => path.resolve(String(r.path || r || ''))).filter(Boolean);
        const watched = [];
        const failed = [];
        const disabled = [];
        for (const repoPath of repos) {
            const result = watchRepo(repoPath);
            if (result.status === 'ok') watched.push(path.basename(repoPath));
            else if (result.status === 'failed') failed.push(path.basename(repoPath));
            else if (result.status === 'disabled') disabled.push(path.basename(repoPath));
        }
        if (watched.length) log(`[fs-watch] watching repos: ${watched.join(', ')}`);
        if (disabled.length) log(`[fs-watch] skipped (per-repo config): ${disabled.join(', ')}`);
        if (failed.length) log(`[fs-watch] failed (interval poll fallback): ${failed.join(', ')}`);
        return { mode: 'enabled', watched, failed, disabled };
    }

    function stop() {
        for (const key of [...byRepo.keys()]) unwatchRepo(key);
    }

    function addRepo(repoPath) {
        return watchRepo(repoPath);
    }

    function removeRepo(repoPath) {
        unwatchRepo(repoPath);
    }

    function isGloballyEnabled() {
        return resolveFsWatchEnabled(null, loadGlobalConfig(), loadProjectConfig);
    }

    return {
        start,
        stop,
        addRepo,
        removeRepo,
        scheduleRepoPoll,
        isGloballyEnabled,
        resolveRepoWatchPaths,
        shouldIgnoreWatchPath,
    };
}

module.exports = {
    DEBOUNCE_MS,
    createDashboardFsWatch,
    resolveRepoWatchPaths,
    resolveFsWatchEnabled,
    shouldIgnoreWatchPath,
    supportsRecursiveWatch,
};
