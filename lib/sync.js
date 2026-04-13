'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const {
    loadGlobalConfig,
    saveGlobalConfig,
    DEFAULT_GLOBAL_CONFIG,
    GLOBAL_CONFIG_PATH,
} = require('./config');

const { mergeBundleIntoRepos } = require('./sync-merge');

const SYNC_SCHEMA_VERSION = 1;
const CURRENT_AIGON_VERSION = require('../package.json').version;
const EPHEMERAL_STATE_FILE_RE = /(heartbeat|\.lock$|\.tmp$|\.temp$|\.pid$)/i;

function nowIso() {
    return new Date().toISOString();
}

function resolveHostName() {
    return os.hostname() || 'unknown-host';
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonSafe(filePath, fallback = null) {
    if (!fs.existsSync(filePath)) return fallback;
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
        return fallback;
    }
}

function writeJson(filePath, value) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function toPosixPath(inputPath) {
    return inputPath.split(path.sep).join('/');
}

function normalizeOriginUrl(originUrl) {
    if (!originUrl) return null;
    let value = String(originUrl).trim();
    value = value.replace(/\.git$/i, '');
    if (/^[^@]+@[^:]+:.+$/.test(value)) {
        const idx = value.indexOf('@');
        value = value.slice(idx + 1).replace(':', '/');
    }
    value = value.replace(/^https?:\/\//i, '');
    value = value.replace(/^ssh:\/\//i, '');
    return value.replace(/\/+$/, '').toLowerCase();
}

function slugRepoId(input) {
    return String(input || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        || 'repo';
}

function runGit(repoPath, args, options = {}) {
    const result = execFileSync('git', ['-C', repoPath, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        ...options,
    });
    return typeof result === 'string' ? result.trim() : '';
}

function runGitLoose(repoPath, args) {
    try {
        return { ok: true, output: runGit(repoPath, args) };
    } catch (error) {
        const stderr = error && error.stderr ? String(error.stderr) : String(error.message || '');
        return { ok: false, output: stderr.trim() };
    }
}

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function loadWritableGlobalConfig() {
    const loaded = loadGlobalConfig();
    if (!loaded || Object.keys(loaded).length === 0) {
        return deepClone(DEFAULT_GLOBAL_CONFIG);
    }
    return loaded;
}

function getSyncConfig(config) {
    return (config && typeof config.sync === 'object' && config.sync) ? config.sync : null;
}

function saveSyncConfig(syncConfig) {
    const cfg = loadWritableGlobalConfig();
    cfg.sync = syncConfig;
    saveGlobalConfig(cfg);
}

function getDefaultSyncRepoPath(gitUrl) {
    const slug = slugRepoId(normalizeOriginUrl(gitUrl) || path.basename(gitUrl || 'sync-repo'));
    return path.join(os.homedir(), '.aigon', 'sync', slug);
}

function getRepoOriginUrl(repoPath) {
    const result = runGitLoose(repoPath, ['remote', 'get-url', 'origin']);
    return result.ok ? result.output : null;
}

function getStableRepoId(repoPath) {
    const origin = getRepoOriginUrl(repoPath);
    const normalized = normalizeOriginUrl(origin);
    if (normalized) {
        return {
            id: slugRepoId(normalized),
            originUrl: origin,
        };
    }

    const canonical = path.resolve(repoPath);
    const digest = crypto.createHash('sha1').update(canonical).digest('hex').slice(0, 12);
    return {
        id: `local-${digest}`,
        originUrl: null,
    };
}

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

function listRepoWorkflowLockFiles(repoPath) {
    const root = path.join(repoPath, '.aigon');
    if (!fs.existsSync(root)) return [];
    const files = [];
    const stack = [root];
    while (stack.length > 0) {
        const current = stack.pop();
        const entries = fs.readdirSync(current, { withFileTypes: true });
        entries.forEach((entry) => {
            const abs = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(abs);
            } else if (entry.isFile()) {
                const rel = toPosixPath(path.relative(root, abs));
                if (rel.startsWith('locks/') || rel.endsWith('/lock') || rel === 'lock') {
                    files.push(abs);
                }
            }
        });
    }
    return files;
}

function verifyNoWorkflowLocks(registeredRepos) {
    const lockFiles = [];
    Object.values(registeredRepos || {}).forEach((repo) => {
        if (!repo || !repo.path || !fs.existsSync(repo.path)) return;
        lockFiles.push(...listRepoWorkflowLockFiles(repo.path));
    });
    if (lockFiles.length > 0) {
        throw new Error(`Sync preflight failed: active lock files detected.\n${lockFiles.map(f => ` - ${f}`).join('\n')}`);
    }
}

function ensureSyncInitialized() {
    const cfg = loadWritableGlobalConfig();
    const sync = getSyncConfig(cfg);
    if (!sync || !sync.repoPath || !sync.repoUrl) {
        throw new Error(`Sync is not initialized. Run: aigon sync init <git-url>\nGlobal config: ${GLOBAL_CONFIG_PATH}`);
    }
    if (!fs.existsSync(path.join(sync.repoPath, '.git'))) {
        throw new Error(`Sync repo is missing or invalid: ${sync.repoPath}. Re-run: aigon sync init ${sync.repoUrl}`);
    }
    sync.registeredRepos = sync.registeredRepos || {};
    return sync;
}

function copyTree(srcRoot, dstRoot, shouldIncludeFile) {
    if (!fs.existsSync(srcRoot)) return;
    const files = listFilesRecursive(srcRoot);
    files.forEach((rel) => {
        if (shouldIncludeFile && !shouldIncludeFile(rel)) return;
        const src = path.join(srcRoot, rel);
        const dst = path.join(dstRoot, rel);
        ensureDir(path.dirname(dst));
        fs.copyFileSync(src, dst);
    });
}

function clearDir(dirPath) {
    fs.rmSync(dirPath, { recursive: true, force: true });
    fs.mkdirSync(dirPath, { recursive: true });
}

function copyPortableStateFromRepo(repoPath, targetAigonDir) {
    const sourceAigon = path.join(repoPath, '.aigon');
    clearDir(targetAigonDir);

    copyTree(path.join(sourceAigon, 'workflows'), path.join(targetAigonDir, 'workflows'), (rel) => {
        const base = path.basename(rel);
        return base !== 'lock';
    });

    copyTree(path.join(sourceAigon, 'telemetry'), path.join(targetAigonDir, 'telemetry'));

    copyTree(path.join(sourceAigon, 'state'), path.join(targetAigonDir, 'state'), (rel) => {
        return !EPHEMERAL_STATE_FILE_RE.test(path.basename(rel));
    });

    const configFile = path.join(sourceAigon, 'config.json');
    if (fs.existsSync(configFile)) {
        ensureDir(targetAigonDir);
        fs.copyFileSync(configFile, path.join(targetAigonDir, 'config.json'));
    }
}

function clearDerivedWorkflowFiles(repoAigonDir) {
    const workflowsRoot = path.join(repoAigonDir, 'workflows');
    listFilesRecursive(workflowsRoot).forEach((rel) => {
        const base = path.basename(rel);
        if (base === 'snapshot.json' || base === 'stats.json') {
            fs.rmSync(path.join(workflowsRoot, rel), { force: true });
        }
    });
}

function clearDisposableCaches(repoPath) {
    fs.rmSync(path.join(repoPath, '.aigon', 'cache'), { recursive: true, force: true });
}

function restorePortableStateToRepo(repoPath, sourceAigonDir) {
    const targetAigon = path.join(repoPath, '.aigon');
    ensureDir(targetAigon);

    ['workflows', 'telemetry', 'state'].forEach((dirName) => {
        const src = path.join(sourceAigonDir, dirName);
        const dst = path.join(targetAigon, dirName);
        if (!fs.existsSync(src)) return;
        clearDir(dst);
        copyTree(src, dst);
    });

    const syncedRepoConfig = readJsonSafe(path.join(sourceAigonDir, 'config.json'), null);
    if (syncedRepoConfig) {
        const localConfig = readJsonSafe(path.join(targetAigon, 'config.json'), {});
        writeJson(path.join(targetAigon, 'config.json'), { ...localConfig, ...syncedRepoConfig });
    }

    clearDerivedWorkflowFiles(targetAigon);
    clearDisposableCaches(repoPath);
}

function readSyncManifest(syncRepoPath) {
    return readJsonSafe(path.join(syncRepoPath, 'metadata', 'manifest.json'), null);
}

function writeSyncManifest(syncRepoPath, manifest) {
    writeJson(path.join(syncRepoPath, 'metadata', 'manifest.json'), manifest);
}

function readBootstrapMetadata(syncRepoPath) {
    return readJsonSafe(path.join(syncRepoPath, 'metadata', 'bootstrap.json'), null);
}

function writeBootstrapMetadata(syncRepoPath, metadata) {
    writeJson(path.join(syncRepoPath, 'metadata', 'bootstrap.json'), metadata);
}

function ensureSyncRepoScaffold(syncConfig) {
    const { repoPath, repoUrl } = syncConfig;
    ensureDir(repoPath);

    if (!fs.existsSync(path.join(repoPath, '.git'))) {
        try {
            runGit(path.dirname(repoPath), ['clone', repoUrl, repoPath]);
        } catch (_) {
            runGit(repoPath, ['init']);
            runGit(repoPath, ['remote', 'add', 'origin', repoUrl]);
        }
    }

    ensureDir(path.join(repoPath, 'repos'));
    ensureDir(path.join(repoPath, 'metadata'));

    if (!fs.existsSync(path.join(repoPath, 'README.md'))) {
        fs.writeFileSync(path.join(repoPath, 'README.md'), [
            '# Aigon Sync Repo',
            '',
            'This repository stores portable `.aigon/` state for registered repos.',
            'Generated by `aigon sync`.',
            '',
        ].join('\n'), 'utf8');
    }

    const manifest = readSyncManifest(repoPath) || {
        syncSchemaVersion: SYNC_SCHEMA_VERSION,
        writtenByAigonVersion: CURRENT_AIGON_VERSION,
        minReadableAigonVersion: CURRENT_AIGON_VERSION,
        repos: {},
        machines: {},
    };
    writeSyncManifest(repoPath, manifest);

    const bootstrap = readBootstrapMetadata(repoPath) || {
        syncSchemaVersion: SYNC_SCHEMA_VERSION,
        bootstrapped: false,
        minReadableAigonVersion: CURRENT_AIGON_VERSION,
    };
    writeBootstrapMetadata(repoPath, bootstrap);
}

function getCurrentSyncBranch(syncRepoPath) {
    const result = runGitLoose(syncRepoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (result.ok && result.output) return result.output;
    return 'main';
}

function readGitConfigValue(repoPath, key) {
    const result = runGitLoose(repoPath, ['config', '--get', key]);
    return result.ok && result.output ? result.output : null;
}

function readGlobalGitConfigValue(key) {
    try {
        const out = execFileSync('git', ['config', '--global', '--get', key], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        return String(out || '').trim() || null;
    } catch (_) {
        return null;
    }
}

function ensureSyncRepoCommitIdentity(syncRepoPath) {
    let name = readGitConfigValue(syncRepoPath, 'user.name');
    let email = readGitConfigValue(syncRepoPath, 'user.email');
    if (name && email) return;

    name = name || readGitConfigValue(process.cwd(), 'user.name') || readGlobalGitConfigValue('user.name');
    email = email || readGitConfigValue(process.cwd(), 'user.email') || readGlobalGitConfigValue('user.email');

    if (!name) name = 'Aigon Sync';
    if (!email) email = 'sync@aigon.local';

    runGitLoose(syncRepoPath, ['config', 'user.name', name]);
    runGitLoose(syncRepoPath, ['config', 'user.email', email]);
}

function enforcePushLinearity(syncRepoPath) {
    runGit(syncRepoPath, ['fetch', 'origin']);
    const upstream = runGitLoose(syncRepoPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    if (!upstream.ok || !upstream.output) {
        const branch = getCurrentSyncBranch(syncRepoPath);
        runGitLoose(syncRepoPath, ['branch', '--set-upstream-to', `origin/${branch}`, branch]);
        return;
    }

    const counts = runGit(syncRepoPath, ['rev-list', '--left-right', '--count', `HEAD...${upstream.output}`]);
    const [aheadRaw, behindRaw] = counts.split(/\s+/);
    const behind = Number(behindRaw || 0);
    if (behind > 0) {
        throw new Error('Push refused: sync repo is behind remote (non-fast-forward). Run `aigon sync pull` first.');
    }
}

function semverToTuple(version) {
    const clean = String(version || '').trim().replace(/^v/i, '').split('-')[0];
    const parts = clean.split('.').map(p => Number(p || 0));
    while (parts.length < 3) parts.push(0);
    return parts.slice(0, 3);
}

function compareSemver(a, b) {
    const aa = semverToTuple(a);
    const bb = semverToTuple(b);
    for (let i = 0; i < 3; i++) {
        if (aa[i] > bb[i]) return 1;
        if (aa[i] < bb[i]) return -1;
    }
    return 0;
}

function ensureVersionReadable(syncRepoPath) {
    const bootstrap = readBootstrapMetadata(syncRepoPath);
    if (!bootstrap || !bootstrap.minReadableAigonVersion) return;
    const minVersion = bootstrap.minReadableAigonVersion;
    if (compareSemver(CURRENT_AIGON_VERSION, minVersion) < 0) {
        throw new Error(`This repo requires aigon >= ${minVersion} but local is ${CURRENT_AIGON_VERSION}. Upgrade first.`);
    }
}

function buildManifestFromSyncConfig(syncConfig, previousManifest) {
    const host = resolveHostName();
    const manifest = previousManifest || {
        syncSchemaVersion: SYNC_SCHEMA_VERSION,
        writtenByAigonVersion: CURRENT_AIGON_VERSION,
        minReadableAigonVersion: CURRENT_AIGON_VERSION,
        repos: {},
        machines: {},
    };

    manifest.syncSchemaVersion = SYNC_SCHEMA_VERSION;
    manifest.writtenByAigonVersion = CURRENT_AIGON_VERSION;
    manifest.minReadableAigonVersion = CURRENT_AIGON_VERSION;
    manifest.repos = manifest.repos || {};
    manifest.machines = manifest.machines || {};

    Object.entries(syncConfig.registeredRepos || {}).forEach(([repoId, repo]) => {
        manifest.repos[repoId] = {
            displayName: repo.displayName,
            originUrl: repo.originUrl || null,
            registeredAt: repo.registeredAt,
        };
    });

    manifest.machines[host] = {
        ...(manifest.machines[host] || {}),
        lastPushAt: syncConfig.lastPushAt || null,
        lastPullAt: syncConfig.lastPullAt || null,
        lastExportAt: syncConfig.lastExportAt || null,
        lastBootstrapMergeAt: syncConfig.lastBootstrapMergeAt || null,
    };

    return manifest;
}

function copyRegisteredReposToSyncRepo(syncConfig) {
    const syncRepoRoot = path.join(syncConfig.repoPath, 'repos');
    ensureDir(syncRepoRoot);

    Object.entries(syncConfig.registeredRepos || {}).forEach(([repoId, repo]) => {
        if (!repo.path || !fs.existsSync(repo.path)) return;
        const targetAigon = path.join(syncRepoRoot, repoId, '.aigon');
        copyPortableStateFromRepo(repo.path, targetAigon);
    });
}

function createExportBundle(syncConfig, outputFileArg) {
    verifyNoWorkflowLocks(syncConfig.registeredRepos || {});

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-sync-export-'));
    const bundleRoot = path.join(tempRoot, 'bundle');
    ensureDir(bundleRoot);

    const reposRoot = path.join(bundleRoot, 'repos');
    ensureDir(reposRoot);

    Object.entries(syncConfig.registeredRepos || {}).forEach(([repoId, repo]) => {
        if (!repo.path || !fs.existsSync(repo.path)) return;
        copyPortableStateFromRepo(repo.path, path.join(reposRoot, repoId, '.aigon'));
    });

    const manifest = buildManifestFromSyncConfig(syncConfig, null);
    writeJson(path.join(bundleRoot, 'metadata', 'manifest.json'), manifest);
    writeJson(path.join(bundleRoot, 'metadata', 'bootstrap.json'), {
        syncSchemaVersion: SYNC_SCHEMA_VERSION,
        bootstrapped: Boolean(syncConfig.bootstrapCompleted),
        minReadableAigonVersion: syncConfig.minReadableAigonVersion || CURRENT_AIGON_VERSION,
        writtenByAigonVersion: CURRENT_AIGON_VERSION,
        exportedAt: nowIso(),
        exportedByHost: resolveHostName(),
    });

    const outputFile = outputFileArg
        ? path.resolve(String(outputFileArg))
        : path.resolve(process.cwd(), `aigon-sync-export-${nowIso().replace(/[:.]/g, '-')}.tgz`);

    ensureDir(path.dirname(outputFile));
    execFileSync('tar', ['-czf', outputFile, '-C', bundleRoot, '.'], { stdio: 'pipe' });

    fs.rmSync(tempRoot, { recursive: true, force: true });

    syncConfig.lastExportAt = nowIso();
    saveSyncConfig(syncConfig);

    return outputFile;
}

function updateSyncRepoCommitAndPush(syncConfig, commitMessage) {
    const syncRepoPath = syncConfig.repoPath;

    enforcePushLinearity(syncRepoPath);
    ensureSyncRepoCommitIdentity(syncRepoPath);

    runGit(syncRepoPath, ['add', 'repos', 'metadata', 'README.md']);

    const staged = runGitLoose(syncRepoPath, ['diff', '--cached', '--name-only']);
    if (!staged.ok || !staged.output) {
        return { committed: false };
    }

    runGit(syncRepoPath, ['commit', '-m', commitMessage]);
    const branch = getCurrentSyncBranch(syncRepoPath);
    const pushResult = runGitLoose(syncRepoPath, ['push', 'origin', branch]);
    if (!pushResult.ok) {
        if (/non-fast-forward|fetch first|rejected/.test(pushResult.output)) {
            throw new Error('Push refused: non-fast-forward update detected. Run `aigon sync pull` and retry.');
        }
        throw new Error(`Failed to push sync repo: ${pushResult.output}`);
    }

    return { committed: true };
}

function syncPush() {
    const syncConfig = ensureSyncInitialized();
    verifyNoWorkflowLocks(syncConfig.registeredRepos || {});
    ensureVersionReadable(syncConfig.repoPath);

    copyRegisteredReposToSyncRepo(syncConfig);

    syncConfig.lastPushAt = nowIso();
    syncConfig.minReadableAigonVersion = CURRENT_AIGON_VERSION;

    const manifest = buildManifestFromSyncConfig(syncConfig, readSyncManifest(syncConfig.repoPath));
    writeSyncManifest(syncConfig.repoPath, manifest);

    const bootstrap = readBootstrapMetadata(syncConfig.repoPath) || {
        syncSchemaVersion: SYNC_SCHEMA_VERSION,
        bootstrapped: false,
    };
    bootstrap.syncSchemaVersion = SYNC_SCHEMA_VERSION;
    bootstrap.writtenByAigonVersion = CURRENT_AIGON_VERSION;
    if (!bootstrap.minReadableAigonVersion) {
        bootstrap.minReadableAigonVersion = CURRENT_AIGON_VERSION;
    }
    writeBootstrapMetadata(syncConfig.repoPath, bootstrap);

    saveSyncConfig(syncConfig);
    const result = updateSyncRepoCommitAndPush(syncConfig, `chore(sync): push portable state (${resolveHostName()})`);

    return {
        committed: result.committed,
        pushedAt: syncConfig.lastPushAt,
    };
}

function syncPull() {
    const syncConfig = ensureSyncInitialized();
    verifyNoWorkflowLocks(syncConfig.registeredRepos || {});

    const pullResult = runGitLoose(syncConfig.repoPath, ['pull', '--ff-only']);
    if (!pullResult.ok) {
        if (/Not possible to fast-forward|non-fast-forward|divergent/.test(pullResult.output)) {
            throw new Error('Pull refused: non-fast-forward history detected. Resolve sync repo divergence manually.');
        }
        throw new Error(`Failed to pull sync repo: ${pullResult.output}`);
    }

    ensureVersionReadable(syncConfig.repoPath);

    Object.entries(syncConfig.registeredRepos || {}).forEach(([repoId, repo]) => {
        if (!repo.path || !fs.existsSync(repo.path)) return;
        const sourceAigon = path.join(syncConfig.repoPath, 'repos', repoId, '.aigon');
        if (!fs.existsSync(sourceAigon)) return;
        restorePortableStateToRepo(repo.path, sourceAigon);
    });

    syncConfig.lastPullAt = nowIso();
    saveSyncConfig(syncConfig);

    return {
        pulledAt: syncConfig.lastPullAt,
    };
}

function initSync(gitUrl) {
    if (!gitUrl) {
        throw new Error('Usage: aigon sync init <git-url>');
    }

    const cfg = loadWritableGlobalConfig();
    const sync = getSyncConfig(cfg) || {};
    sync.repoUrl = String(gitUrl).trim();
    sync.repoPath = sync.repoPath || getDefaultSyncRepoPath(sync.repoUrl);
    sync.initializedAt = sync.initializedAt || nowIso();
    sync.registeredRepos = sync.registeredRepos || {};
    sync.syncSchemaVersion = SYNC_SCHEMA_VERSION;
    sync.minReadableAigonVersion = sync.minReadableAigonVersion || CURRENT_AIGON_VERSION;

    ensureSyncRepoScaffold(sync);

    cfg.sync = sync;
    saveGlobalConfig(cfg);

    return sync;
}

function registerRepo(repoPathArg) {
    const sync = ensureSyncInitialized();
    const repoPath = path.resolve(repoPathArg || process.cwd());

    if (!fs.existsSync(path.join(repoPath, '.git'))) {
        throw new Error(`Not a git repo: ${repoPath}`);
    }

    const { id, originUrl } = getStableRepoId(repoPath);
    const existing = sync.registeredRepos[id] || {};

    sync.registeredRepos[id] = {
        id,
        displayName: path.basename(repoPath),
        path: repoPath,
        originUrl,
        registeredAt: existing.registeredAt || nowIso(),
        updatedAt: nowIso(),
    };

    saveSyncConfig(sync);

    return sync.registeredRepos[id];
}

function statusSnapshot() {
    const cfg = loadWritableGlobalConfig();
    const sync = getSyncConfig(cfg);
    if (!sync || !sync.repoPath || !sync.repoUrl) {
        return {
            initialized: false,
            bootstrapCompleted: false,
            registeredRepos: [],
            pendingChanges: false,
        };
    }

    const registered = Object.values(sync.registeredRepos || {});
    const pending = registered.some((repo) => {
        if (!repo.path || !fs.existsSync(repo.path)) return false;
        const localAigon = path.join(repo.path, '.aigon');
        const syncedAigon = path.join(sync.repoPath, 'repos', repo.id, '.aigon');

        const localFiles = listFilesRecursive(localAigon)
            .filter((rel) => rel.startsWith('workflows/') || rel.startsWith('telemetry/') || rel.startsWith('state/') || rel === 'config.json')
            .filter((rel) => path.basename(rel) !== 'lock')
            .filter((rel) => !EPHEMERAL_STATE_FILE_RE.test(path.basename(rel)));
        const syncedFiles = listFilesRecursive(syncedAigon)
            .filter((rel) => rel.startsWith('workflows/') || rel.startsWith('telemetry/') || rel.startsWith('state/') || rel === 'config.json')
            .filter((rel) => path.basename(rel) !== 'lock')
            .filter((rel) => !EPHEMERAL_STATE_FILE_RE.test(path.basename(rel)));

        if (localFiles.length !== syncedFiles.length) return true;
        for (let i = 0; i < localFiles.length; i++) {
            if (localFiles[i] !== syncedFiles[i]) return true;
            const localAbs = path.join(localAigon, localFiles[i]);
            const syncAbs = path.join(syncedAigon, syncedFiles[i]);
            if (!fs.existsSync(syncAbs)) return true;
            const l = fs.readFileSync(localAbs);
            const s = fs.readFileSync(syncAbs);
            if (Buffer.compare(l, s) !== 0) return true;
        }
        return false;
    });

    return {
        initialized: true,
        repoPath: sync.repoPath,
        repoUrl: sync.repoUrl,
        bootstrapCompleted: Boolean(sync.bootstrapCompleted),
        lastPushAt: sync.lastPushAt || null,
        lastPullAt: sync.lastPullAt || null,
        lastExportAt: sync.lastExportAt || null,
        lastBootstrapMergeAt: sync.lastBootstrapMergeAt || null,
        minReadableAigonVersion: sync.minReadableAigonVersion || null,
        pendingChanges: pending,
        registeredRepos: registered,
    };
}

function bootstrapMerge(bundleFile, { shouldPush = false } = {}) {
    const sync = ensureSyncInitialized();
    verifyNoWorkflowLocks(sync.registeredRepos || {});

    const bundlePath = path.resolve(String(bundleFile || ''));
    if (!bundleFile || !fs.existsSync(bundlePath)) {
        throw new Error(`Bundle file not found: ${bundleFile || '(missing)'}`);
    }

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-sync-import-'));
    try {
        execFileSync('tar', ['-xzf', bundlePath, '-C', tempRoot], { stdio: 'pipe' });
    } catch (error) {
        fs.rmSync(tempRoot, { recursive: true, force: true });
        throw new Error(`Failed to extract bundle: ${error.message}`);
    }

    const importedManifest = readJsonSafe(path.join(tempRoot, 'metadata', 'manifest.json'), {});
    const importedBootstrap = readJsonSafe(path.join(tempRoot, 'metadata', 'bootstrap.json'), {});

    const repoPathById = {};
    Object.entries(sync.registeredRepos || {}).forEach(([id, repo]) => {
        repoPathById[id] = repo.path;
    });

    const summary = mergeBundleIntoRepos({
        bundleRoot: tempRoot,
        repoPathById,
    });

    sync.bootstrapCompleted = true;
    sync.lastBootstrapMergeAt = nowIso();
    sync.minReadableAigonVersion = CURRENT_AIGON_VERSION;
    saveSyncConfig(sync);

    const bootstrapMetadata = {
        syncSchemaVersion: SYNC_SCHEMA_VERSION,
        bootstrapped: true,
        bootstrappedAt: sync.lastBootstrapMergeAt,
        bootstrappedByHost: resolveHostName(),
        minReadableAigonVersion: CURRENT_AIGON_VERSION,
        writtenByAigonVersion: CURRENT_AIGON_VERSION,
        sources: [
            {
                kind: 'import-bundle',
                host: importedBootstrap.exportedByHost || 'unknown',
                writtenByAigonVersion: importedBootstrap.writtenByAigonVersion || null,
            },
            {
                kind: 'local-state',
                host: resolveHostName(),
                writtenByAigonVersion: CURRENT_AIGON_VERSION,
            },
        ],
    };
    writeBootstrapMetadata(sync.repoPath, bootstrapMetadata);

    const mergedManifest = buildManifestFromSyncConfig(sync, readSyncManifest(sync.repoPath) || importedManifest);
    writeSyncManifest(sync.repoPath, mergedManifest);

    let pushResult = null;
    if (shouldPush) {
        pushResult = syncPush();
    }

    fs.rmSync(tempRoot, { recursive: true, force: true });

    return {
        summary,
        pushed: Boolean(pushResult),
    };
}

function printStatus(status) {
    if (!status.initialized) {
        console.log('Sync: not initialized');
        console.log('Run: aigon sync init <git-url>');
        return;
    }

    console.log('Sync: initialized');
    console.log(`  Repo: ${status.repoPath}`);
    console.log(`  URL: ${status.repoUrl}`);
    console.log(`  Bootstrap: ${status.bootstrapCompleted ? 'completed' : 'not completed'}`);
    console.log(`  Last push: ${status.lastPushAt || 'never'}`);
    console.log(`  Last pull: ${status.lastPullAt || 'never'}`);
    console.log(`  Last export: ${status.lastExportAt || 'never'}`);
    console.log(`  Last bootstrap merge: ${status.lastBootstrapMergeAt || 'never'}`);
    console.log(`  Min readable version: ${status.minReadableAigonVersion || 'n/a'}`);
    console.log(`  Pending local changes: ${status.pendingChanges ? 'yes' : 'no'}`);
    console.log(`  Registered repos (${status.registeredRepos.length}):`);
    if (status.registeredRepos.length === 0) {
        console.log('    (none)');
    } else {
        status.registeredRepos.forEach((repo) => {
            console.log(`    - ${repo.id}: ${repo.path}`);
        });
    }
}

function printUsage() {
    console.log('Usage: aigon sync <command> [options]');
    console.log('');
    console.log('Commands:');
    console.log('  init <git-url>                   Initialize sync repo and save sync config');
    console.log('  register [repo-path]             Register a local git repo for sync');
    console.log('  export [--output <file>]         Export portable state bundle for registered repos');
    console.log('  bootstrap-merge <bundle> [--push] Merge imported bundle with local state (one-time)');
    console.log('  push                             Copy portable state to sync repo and push');
    console.log('  pull                             Pull sync repo and restore portable state');
    console.log('  status                           Show sync status and pending changes');
}

async function handleSyncCommand(args = []) {
    const sub = args[0];
    const rest = args.slice(1);

    if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
        printUsage();
        return;
    }

    if (sub === 'init') {
        const gitUrl = rest[0];
        const sync = initSync(gitUrl);
        console.log(`✅ Sync initialized`);
        console.log(`   Repo URL: ${sync.repoUrl}`);
        console.log(`   Local repo: ${sync.repoPath}`);
        return;
    }

    if (sub === 'register') {
        const entry = registerRepo(rest[0]);
        console.log(`✅ Registered repo: ${entry.id}`);
        console.log(`   Path: ${entry.path}`);
        return;
    }

    if (sub === 'export') {
        let output = null;
        for (let i = 0; i < rest.length; i++) {
            if (rest[i] === '--output' && rest[i + 1]) {
                output = rest[i + 1];
                break;
            }
            if (rest[i].startsWith('--output=')) {
                output = rest[i].slice('--output='.length);
                break;
            }
        }
        const syncConfig = ensureSyncInitialized();
        const bundle = createExportBundle(syncConfig, output);
        console.log(`✅ Exported bundle: ${bundle}`);
        return;
    }

    if (sub === 'bootstrap-merge') {
        const bundleFile = rest.find(a => !a.startsWith('--'));
        const shouldPush = rest.includes('--push');
        const result = bootstrapMerge(bundleFile, { shouldPush });
        console.log(`✅ Bootstrap merge complete`);
        console.log(`   Repos merged: ${result.summary.reposMerged}`);
        if (result.summary.reposSkipped.length > 0) {
            console.log(`   Repos skipped (not registered locally): ${result.summary.reposSkipped.join(', ')}`);
        }
        if (shouldPush) {
            console.log('   Baseline pushed to sync repo');
        }
        return;
    }

    if (sub === 'push') {
        const result = syncPush();
        if (result.committed) {
            console.log(`✅ Sync push complete (${result.pushedAt})`);
        } else {
            console.log('✅ Sync push complete (no changes to commit)');
        }
        return;
    }

    if (sub === 'pull') {
        const result = syncPull();
        console.log(`✅ Sync pull complete (${result.pulledAt})`);
        return;
    }

    if (sub === 'status') {
        printStatus(statusSnapshot());
        return;
    }

    throw new Error(`Unknown sync command: ${sub}\nRun: aigon sync --help`);
}

module.exports = {
    SYNC_SCHEMA_VERSION,
    handleSyncCommand,
};
