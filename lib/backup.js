'use strict';

/**
 * F388 — aigon-vault: unified backup & sync.
 *
 * One private git repo (the "vault") holds:
 *   - projects/{name}/  — each registered project's `.aigon/` (filtered)
 *   - settings/         — `~/.aigon/config.json` (stripped) + workflow-definitions/
 *
 * Replaces the per-project `aigon sync` (F359) and the user-profile
 * `aigon settings/profile sync` (F380). The legacy commands stay alive as
 * deprecated aliases that delegate here.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const core = require('./sync-core');

const VAULT_BRANCH = 'main';
const VAULT_DIR_NAME = '.vault';
const META_NAME = 'backup-meta.json';
const RESTORE_ARCHIVES_DIR = 'restore-archives';

// `.aigon/` files that are NOT included when backing up a project.
const PROJECT_EXCLUDES = new Set([
    'sessions',
    'locks',
    'cache',
    'server',
    '.sync',
    '.vault',
]);
const PROJECT_EXCLUDE_FILES = new Set([
    'budget-cache.json',
    'insights-cache.json',
    'recurring-state.json',
    'config-hash',
    '.syncignore',
]);

// `~/.aigon/config.json` keys stripped before backup (machine-specific).
const SETTINGS_STRIPPED_KEYS = ['repos', 'serverPort', 'sync', 'backup'];

const VALID_SCHEDULES = new Set(['daily', 'hourly', 'weekly', 'off']);
const DEFAULT_SCHEDULE = 'daily';

function homeRoot() {
    return path.join(process.env.AIGON_HOME || os.homedir(), '.aigon');
}

function vaultDir() {
    return path.join(homeRoot(), VAULT_DIR_NAME);
}

function helperRepoPath() {
    return path.join(vaultDir(), 'repo');
}

function metaPath() {
    return path.join(vaultDir(), META_NAME);
}

function logPath() {
    return path.join(homeRoot(), 'backup.log');
}

function restoreArchivesRoot() {
    return path.join(homeRoot(), RESTORE_ARCHIVES_DIR);
}

function loadGlobalConfig() {
    const p = path.join(homeRoot(), 'config.json');
    return core.loadJson(p);
}

function saveGlobalConfig(cfg) {
    core.saveJson(path.join(homeRoot(), 'config.json'), cfg);
}

function getBackupSettings() {
    const cfg = loadGlobalConfig();
    return cfg.backup && typeof cfg.backup === 'object' ? cfg.backup : {};
}

function setBackupSettings(patch) {
    const cfg = loadGlobalConfig();
    cfg.backup = Object.assign({}, cfg.backup || {}, patch);
    saveGlobalConfig(cfg);
    return cfg.backup;
}

function getRemote() {
    const b = getBackupSettings();
    return b.remote ? String(b.remote).trim() : null;
}

function getSchedule() {
    const b = getBackupSettings();
    const s = String(b.schedule || DEFAULT_SCHEDULE).toLowerCase();
    return VALID_SCHEDULES.has(s) ? s : DEFAULT_SCHEDULE;
}

function loadMeta() { return core.loadJson(metaPath()); }
function saveMeta(m) { core.saveJson(metaPath(), m); }

function ensureRemoteConfigured() {
    const remote = getRemote();
    if (!remote) {
        const e = new Error('Backup is not configured. Run: aigon backup configure');
        e.code = 'ENOBACKUP';
        throw e;
    }
    return remote;
}

function listRegisteredRepos() {
    const cfg = loadGlobalConfig();
    return Array.isArray(cfg.repos) ? cfg.repos.map(r => String(r)) : [];
}

function projectName(repoPath) {
    return path.basename(path.resolve(repoPath));
}

function isCloudSyncedPath(p) {
    const norm = path.resolve(p);
    return /\/(Library\/Mobile Documents|iCloud Drive|Dropbox|Google Drive|OneDrive)(\/|$)/i.test(norm);
}

function commandExists(bin) {
    const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' });
    return r.status === 0;
}

function ghIsAuthenticated() {
    const r = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8', stdio: 'pipe' });
    return r.status === 0;
}

// ── Telemetry retention ───────────────────────────────────────────────────

const DEFAULT_RETENTION = { compressAfterDays: 90, dropAfterDays: 365 };
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function getTelemetryRetentionConfig() {
    const b = getBackupSettings();
    const r = b.telemetryRetention && typeof b.telemetryRetention === 'object'
        ? b.telemetryRetention
        : {};
    return {
        compressAfterDays: r.compressAfterDays !== undefined ? r.compressAfterDays : DEFAULT_RETENTION.compressAfterDays,
        dropAfterDays: r.dropAfterDays !== undefined ? r.dropAfterDays : DEFAULT_RETENTION.dropAfterDays,
    };
}

function fileAgeMs(filePath, endAtIso) {
    if (endAtIso) {
        const t = Date.parse(endAtIso);
        if (!Number.isNaN(t)) return Date.now() - t;
    }
    try {
        return Date.now() - fs.statSync(filePath).mtimeMs;
    } catch (_) {
        return 0;
    }
}

function gzipFileInPlace(filePath) {
    const buf = fs.readFileSync(filePath);
    const compressed = zlib.gzipSync(buf);
    fs.writeFileSync(filePath + '.gz', compressed);
    fs.unlinkSync(filePath);
}

function applyTelemetryRetention(repoPath, retentionConfig) {
    const { compressAfterDays, dropAfterDays } = retentionConfig || getTelemetryRetentionConfig();
    const telDir = path.join(repoPath, '.aigon', 'telemetry');
    if (!fs.existsSync(telDir)) return;

    const compressMs = (compressAfterDays !== null && compressAfterDays !== 0)
        ? compressAfterDays * MS_PER_DAY : null;
    const dropMs = (dropAfterDays !== null && dropAfterDays !== 0)
        ? dropAfterDays * MS_PER_DAY : null;

    // Per-session *.json files at telemetry root level.
    for (const entry of fs.readdirSync(telDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const fp = path.join(telDir, entry.name);
        let endAt = null;
        try {
            const rec = JSON.parse(fs.readFileSync(fp, 'utf8'));
            endAt = rec && rec.endAt ? rec.endAt : null;
        } catch (_) { /* use mtime */ }
        const ageMs = fileAgeMs(fp, endAt);
        if (dropMs !== null && ageMs >= dropMs) {
            try { fs.unlinkSync(fp); } catch (_) { /* ignore */ }
        } else if (compressMs !== null && ageMs >= compressMs) {
            try { gzipFileInPlace(fp); } catch (_) { /* ignore */ }
        }
    }

    // signal-health/<YYYY-MM-DD>.jsonl — age by filename date.
    const shDir = path.join(telDir, 'signal-health');
    if (fs.existsSync(shDir)) {
        for (const entry of fs.readdirSync(shDir, { withFileTypes: true })) {
            if (!entry.isFile() || !/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(entry.name)) continue;
            const fp = path.join(shDir, entry.name);
            const dateStr = entry.name.slice(0, 10); // YYYY-MM-DD
            const ageMs = fileAgeMs(fp, dateStr + 'T23:59:59Z');
            if (dropMs !== null && ageMs >= dropMs) {
                try { fs.unlinkSync(fp); } catch (_) { /* ignore */ }
            } else if (compressMs !== null && ageMs >= compressMs) {
                try { gzipFileInPlace(fp); } catch (_) { /* ignore */ }
            }
        }
    }
}

// ── File walk helpers ─────────────────────────────────────────────────────

function copyProjectAigonInto(repoPath, dstDir) {
    const aigonDir = path.join(repoPath, '.aigon');
    if (!fs.existsSync(aigonDir)) return 0;
    let count = 0;
    const top = fs.readdirSync(aigonDir, { withFileTypes: true });
    for (const ent of top) {
        if (ent.isDirectory() && PROJECT_EXCLUDES.has(ent.name)) continue;
        if (ent.isFile() && PROJECT_EXCLUDE_FILES.has(ent.name)) continue;
        if (ent.isFile() && /^backup\.log/.test(ent.name)) continue;
        if (ent.isFile() && /\.log$/.test(ent.name)) continue;
        const src = path.join(aigonDir, ent.name);
        const dst = path.join(dstDir, ent.name);
        if (ent.isFile()) {
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            fs.copyFileSync(src, dst);
            count++;
        } else if (ent.isDirectory()) {
            count += copyDirRecursive(src, dst);
        }
    }
    for (const rel of getTrackedProjectPaths(repoPath)) {
        const copied = path.join(dstDir, rel);
        if (!fs.existsSync(copied)) continue;
        rmIfExists(copied);
        count--;
    }
    return count;
}

function copyDirRecursive(src, dst) {
    let n = 0;
    if (!fs.existsSync(src)) return 0;
    fs.mkdirSync(dst, { recursive: true });
    for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, ent.name);
        const d = path.join(dst, ent.name);
        if (ent.isDirectory()) {
            n += copyDirRecursive(s, d);
        } else if (ent.isFile()) {
            fs.copyFileSync(s, d);
            n++;
        }
    }
    return n;
}

function copyEntry(src, dst) {
    if (!fs.existsSync(src)) return 0;
    const stat = fs.lstatSync(src);
    if (stat.isDirectory()) return copyDirRecursive(src, dst);
    if (!stat.isFile()) return 0;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    return 1;
}

function isProjectEntryExcluded(name, isDirectory) {
    if (isDirectory) return PROJECT_EXCLUDES.has(name);
    return PROJECT_EXCLUDE_FILES.has(name)
        || /^backup\.log/.test(name)
        || /\.log$/.test(name);
}

function preserveExcludedProjectEntries(currentAigonDir, stagedAigonDir) {
    if (fs.existsSync(stagedAigonDir)) {
        for (const ent of fs.readdirSync(stagedAigonDir, { withFileTypes: true })) {
            if (!isProjectEntryExcluded(ent.name, ent.isDirectory())) continue;
            rmIfExists(path.join(stagedAigonDir, ent.name));
        }
    }
    if (!fs.existsSync(currentAigonDir)) return;
    for (const ent of fs.readdirSync(currentAigonDir, { withFileTypes: true })) {
        if (!isProjectEntryExcluded(ent.name, ent.isDirectory())) continue;
        copyEntry(path.join(currentAigonDir, ent.name), path.join(stagedAigonDir, ent.name));
    }
}

function getTrackedProjectPaths(repoPath) {
    const result = core.git(repoPath, ['ls-files', '--', '.aigon'], { allowFail: true });
    if (!result.ok || !result.stdout) return new Set();
    return new Set(result.stdout.split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('.aigon/'))
        .map(line => line.slice('.aigon/'.length)));
}

function preserveTrackedProjectFiles(repoPath, stagedAigonDir, trackedPaths) {
    const currentAigonDir = path.join(repoPath, '.aigon');
    for (const rel of trackedPaths) {
        const current = path.join(currentAigonDir, rel);
        const staged = path.join(stagedAigonDir, rel);
        if (fs.existsSync(current)) copyEntry(current, staged);
        else rmIfExists(staged);
    }
}

function buildFileIndex(rootDir, filterTopLevel = null) {
    const out = {};
    function walk(absDir, relDir = '') {
        if (!fs.existsSync(absDir)) return;
        const entries = fs.readdirSync(absDir, { withFileTypes: true })
            .sort((a, b) => a.name.localeCompare(b.name));
        for (const ent of entries) {
            if (!relDir && filterTopLevel && !filterTopLevel(ent)) continue;
            const abs = path.join(absDir, ent.name);
            const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
            if (ent.isDirectory()) {
                walk(abs, rel);
            } else if (ent.isFile()) {
                out[rel] = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
            }
        }
    }
    walk(rootDir);
    return out;
}

function buildManagedProjectIndex(aigonDir, ignoredPaths = new Set()) {
    const index = buildFileIndex(aigonDir, (ent) => !isProjectEntryExcluded(ent.name, ent.isDirectory()));
    for (const rel of ignoredPaths) delete index[rel];
    return index;
}

function diffIndexes(localIndex, incomingIndex) {
    const paths = [...new Set([...Object.keys(localIndex), ...Object.keys(incomingIndex)])];
    const diff = { added: [], changed: [], removed: [] };
    for (const rel of paths.sort()) {
        if (!(rel in localIndex)) diff.added.push(rel);
        else if (!(rel in incomingIndex)) diff.removed.push(rel);
        else if (localIndex[rel] !== incomingIndex[rel]) diff.changed.push(rel);
    }
    return diff;
}

function restoreProjectExactly(sourceDir, repoPath, archiveDir, token, trackedPaths = getTrackedProjectPaths(repoPath)) {
    const targetDir = path.join(repoPath, '.aigon');
    const stageDir = path.join(repoPath, `.aigon.restore-${token}`);
    const rollbackDir = path.join(repoPath, `.aigon.rollback-${token}`);
    rmIfExists(stageDir);
    rmIfExists(rollbackDir);

    copyProjectAigonInto(repoPath, archiveDir);
    copyDirRecursive(sourceDir, stageDir);
    preserveExcludedProjectEntries(targetDir, stageDir);
    preserveTrackedProjectFiles(repoPath, stageDir, trackedPaths);

    const hadTarget = fs.existsSync(targetDir);
    if (hadTarget) fs.renameSync(targetDir, rollbackDir);
    try {
        fs.renameSync(stageDir, targetDir);
    } catch (error) {
        if (hadTarget && fs.existsSync(rollbackDir)) fs.renameSync(rollbackDir, targetDir);
        throw error;
    }
    rmIfExists(rollbackDir);
    return targetDir;
}

function rmIfExists(p) {
    try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) { /* ignore */ }
}

// ── Configure ─────────────────────────────────────────────────────────────

function configure(remoteUrl, opts = {}) {
    const url = remoteUrl ? String(remoteUrl).trim() : null;
    if (!url) {
        throw new Error('Usage: aigon backup configure <git-url>');
    }
    if (isCloudSyncedPath(homeRoot())) {
        // ~/.aigon shouldn't itself be cloud-synced, but warn loudly if so.
        console.warn('⚠️  ~/.aigon is inside an iCloud/Dropbox path — git + cloud sync corrupts repos. Move ~/.aigon out first.');
    }
    setBackupSettings({ remote: url, schedule: getSchedule() });
    fs.mkdirSync(vaultDir(), { recursive: true });
    core.ensureHelperRepoAt(helperRepoPath(), url);
    return { remote: url };
}

/**
 * Try to create the vault repo on GitHub via `gh`. Returns the resulting
 * git URL on success, or throws.
 */
function createVaultOnGitHub(name = 'aigon-vault') {
    if (!commandExists('gh')) {
        const e = new Error('gh CLI is not installed. Install it from https://cli.github.com or pass a git URL directly.');
        e.code = 'ENOGH';
        throw e;
    }
    if (!ghIsAuthenticated()) {
        const e = new Error('gh is not authenticated. Run: gh auth login');
        e.code = 'ENOGHAUTH';
        throw e;
    }
    const r = spawnSync('gh', ['repo', 'create', name, '--private', '--description', 'aigon backup vault'], {
        encoding: 'utf8',
    });
    if (r.status !== 0) {
        const stderr = (r.stderr || '').trim();
        throw new Error(`gh repo create failed: ${stderr || 'unknown error'}`);
    }
    // gh prints the URL on stdout (e.g. https://github.com/user/aigon-vault)
    const stdout = (r.stdout || '').trim();
    const httpsMatch = stdout.match(/https:\/\/github\.com\/[^\s]+/);
    if (!httpsMatch) {
        throw new Error(`gh repo create did not return a URL. Output: ${stdout}`);
    }
    return httpsMatch[0] + '.git';
}

// ── Push ──────────────────────────────────────────────────────────────────

function push() {
    const remote = ensureRemoteConfigured();
    fs.mkdirSync(vaultDir(), { recursive: true });
    const helper = core.ensureHelperRepoAt(helperRepoPath(), remote);

    // 1. Pull first (fast-forward only)
    const hadRemote = core.fetchBranch(helper, VAULT_BRANCH);
    if (hadRemote) {
        const localExists = core.git(helper, ['rev-parse', '--verify', VAULT_BRANCH], { allowFail: true }).ok;
        if (localExists) {
            const localOnly = core.git(helper, ['rev-list', `origin/${VAULT_BRANCH}..${VAULT_BRANCH}`], { allowFail: true });
            const remoteOnly = core.git(helper, ['rev-list', `${VAULT_BRANCH}..origin/${VAULT_BRANCH}`], { allowFail: true });
            const local = localOnly.ok && localOnly.stdout ? localOnly.stdout.split('\n').length : 0;
            const remote2 = remoteOnly.ok && remoteOnly.stdout ? remoteOnly.stdout.split('\n').length : 0;
            if (local > 0 && remote2 > 0) {
                const e = new Error(
                    'Remote has diverged from local. Pull first to integrate remote changes,\n' +
                    'then retry: aigon backup pull && aigon backup push'
                );
                e.code = 'EBACKUPCONFLICT';
                throw e;
            }
        }
        core.checkoutBranch(helper, VAULT_BRANCH, { hadRemote: true, clearWorkingTree: false });
    } else {
        core.checkoutBranch(helper, VAULT_BRANCH, { hadRemote: false, clearWorkingTree: false });
    }

    // 2. Rewrite settings and locally present projects. Preserve remote project
    // snapshots for repositories that are not cloned on this machine.
    for (const ent of fs.readdirSync(helper)) {
        if (ent === '.git' || ent === 'projects') continue;
        rmIfExists(path.join(helper, ent));
    }

    // 3. Project state.
    const repos = listRegisteredRepos();
    let totalFiles = 0;
    const projectsCopied = [];
    for (const repoPath of repos) {
        if (!fs.existsSync(repoPath)) continue;
        applyTelemetryRetention(repoPath);
        const name = projectName(repoPath);
        const dst = path.join(helper, 'projects', name);
        rmIfExists(dst);
        const n = copyProjectAigonInto(repoPath, dst);
        if (n > 0) {
            projectsCopied.push({ name, path: repoPath, files: n });
            totalFiles += n;
        }
    }

    // 4. Settings.
    const settingsDir = path.join(helper, 'settings');
    fs.mkdirSync(settingsDir, { recursive: true });
    const cfg = loadGlobalConfig();
    const stripped = Object.assign({}, cfg);
    for (const k of SETTINGS_STRIPPED_KEYS) delete stripped[k];
    fs.writeFileSync(path.join(settingsDir, 'config.json'), JSON.stringify(stripped, null, 2) + '\n', 'utf8');
    totalFiles++;

    const wfDefsSrc = path.join(homeRoot(), 'workflow-definitions');
    const wfDefsDst = path.join(settingsDir, 'workflow-definitions');
    if (fs.existsSync(wfDefsSrc)) {
        totalFiles += copyDirRecursive(wfDefsSrc, wfDefsDst);
    }

    // 5. Commit & push.
    core.git(helper, ['add', '-A']);
    const status = core.git(helper, ['status', '--porcelain']);
    const hasHead = core.git(helper, ['rev-parse', '--verify', 'HEAD'], { allowFail: true }).ok;
    if (!status.stdout && hasHead) {
        const meta = loadMeta();
        meta.lastPushAt = core.nowIso();
        meta.lastPushFiles = totalFiles;
        meta.lastPushNoChanges = true;
        meta.projectCount = projectsCopied.length;
        saveMeta(meta);
        return { committed: false, pushed: false, fileCount: totalFiles, projects: projectsCopied };
    }
    const message = `aigon backup — ${core.nowIso()}`;
    if (status.stdout) {
        core.git(helper, ['commit', '--quiet', '-m', message]);
    } else {
        core.git(helper, ['commit', '--quiet', '--allow-empty', '-m', message]);
    }
    const pushResult = core.git(helper, ['push', 'origin', `${VAULT_BRANCH}:${VAULT_BRANCH}`], { allowFail: true });
    if (!pushResult.ok) {
        if (/non-fast-forward|rejected/i.test(pushResult.stderr)) {
            const e = new Error(
                'Push rejected — remote has diverged. Run \'aigon backup pull\' first, resolve any conflicts, then retry.'
            );
            e.code = 'EBACKUPCONFLICT';
            throw e;
        }
        throw new Error(`Backup push failed: ${pushResult.stderr || 'unknown error'}`);
    }

    const newHead = core.git(helper, ['rev-parse', VAULT_BRANCH], { allowFail: true });
    const meta = loadMeta();
    meta.lastPushAt = core.nowIso();
    meta.lastPushMessage = message;
    meta.lastPushFiles = totalFiles;
    meta.lastPushNoChanges = false;
    meta.projectCount = projectsCopied.length;
    if (newHead.ok && newHead.stdout) meta.lastSha = newHead.stdout;
    saveMeta(meta);
    return { committed: true, pushed: true, fileCount: totalFiles, projects: projectsCopied, message };
}

// ── Pull / restore ────────────────────────────────────────────────────────

const PROJECT_SCAN_ROOTS = [
    path.join(os.homedir(), 'src'),
    path.join(os.homedir(), 'code'),
    path.join(os.homedir(), 'Developer'),
    process.cwd(),
];

function findProjectOnDisk(name) {
    for (const repoPath of listRegisteredRepos()) {
        if (projectName(repoPath) !== name) continue;
        if (fs.existsSync(repoPath) && fs.existsSync(path.join(repoPath, '.git'))) return repoPath;
    }
    for (const root of PROJECT_SCAN_ROOTS) {
        if (!fs.existsSync(root)) continue;
        const candidate = path.join(root, name);
        if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, '.git'))) {
            return candidate;
        }
    }
    return null;
}

function buildPullPlan(helper) {
    const projectsRoot = path.join(helper, 'projects');
    const projects = [];
    const notFound = [];
    if (!fs.existsSync(projectsRoot)) return { projects, notFound };
    for (const ent of fs.readdirSync(projectsRoot, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        const local = findProjectOnDisk(ent.name);
        if (!local) {
            notFound.push(ent.name);
            continue;
        }
        const sourceDir = path.join(projectsRoot, ent.name);
        const trackedPaths = getTrackedProjectPaths(local);
        const localIndex = buildManagedProjectIndex(path.join(local, '.aigon'), trackedPaths);
        const incomingIndex = buildManagedProjectIndex(sourceDir, trackedPaths);
        projects.push({
            name: ent.name,
            path: local,
            sourceDir,
            trackedPaths,
            diff: diffIndexes(localIndex, incomingIndex),
        });
    }
    return { projects, notFound };
}

function restoreWorkflowDefinitionsExactly(sourceDir, archiveDir, token) {
    const targetDir = path.join(homeRoot(), 'workflow-definitions');
    const stageDir = path.join(homeRoot(), `.workflow-definitions.restore-${token}`);
    const rollbackDir = path.join(homeRoot(), `.workflow-definitions.rollback-${token}`);
    rmIfExists(stageDir);
    rmIfExists(rollbackDir);
    if (fs.existsSync(targetDir)) copyDirRecursive(targetDir, archiveDir);
    fs.mkdirSync(stageDir, { recursive: true });
    if (fs.existsSync(sourceDir)) copyDirRecursive(sourceDir, stageDir);
    const hadTarget = fs.existsSync(targetDir);
    if (hadTarget) fs.renameSync(targetDir, rollbackDir);
    try {
        fs.renameSync(stageDir, targetDir);
    } catch (error) {
        if (hadTarget && fs.existsSync(rollbackDir)) fs.renameSync(rollbackDir, targetDir);
        throw error;
    }
    rmIfExists(rollbackDir);
}

function pull(options = {}) {
    const remote = ensureRemoteConfigured();
    fs.mkdirSync(vaultDir(), { recursive: true });
    const helper = core.ensureHelperRepoAt(helperRepoPath(), remote);
    const hadRemote = core.fetchBranch(helper, VAULT_BRANCH);
    if (!hadRemote) {
        const meta = loadMeta();
        meta.lastPullAt = core.nowIso();
        meta.lastPullEmpty = true;
        saveMeta(meta);
        return { applied: false, reason: 'remote-empty' };
    }

    const localExists = core.git(helper, ['rev-parse', '--verify', VAULT_BRANCH], { allowFail: true }).ok;
    if (localExists) {
        const localOnly = core.git(helper, ['rev-list', `origin/${VAULT_BRANCH}..${VAULT_BRANCH}`], { allowFail: true });
        const remoteOnly = core.git(helper, ['rev-list', `${VAULT_BRANCH}..origin/${VAULT_BRANCH}`], { allowFail: true });
        const local = localOnly.ok && localOnly.stdout ? localOnly.stdout.split('\n').length : 0;
        const remote2 = remoteOnly.ok && remoteOnly.stdout ? remoteOnly.stdout.split('\n').length : 0;
        if (local > 0 && remote2 > 0) {
            const e = new Error(
                `Vault branch has diverged: ${local} local-only and ${remote2} remote-only commits.\n` +
                `Resolve manually:\n  cd ${helperRepoPath()} && git pull --rebase origin ${VAULT_BRANCH}`
            );
            e.code = 'EBACKUPCONFLICT';
            throw e;
        }
    }
    core.checkoutBranch(helper, VAULT_BRANCH, { hadRemote: true, clearWorkingTree: false });

    const head = core.git(helper, ['rev-parse', VAULT_BRANCH], { allowFail: true });
    const plan = buildPullPlan(helper);
    plan.remoteSha = head.ok ? head.stdout : null;
    if (options.dryRun) {
        return { applied: false, dryRun: true, plan };
    }

    const token = new Date().toISOString().replace(/[:.]/g, '-');
    const archiveRoot = path.join(restoreArchivesRoot(), token);
    fs.mkdirSync(archiveRoot, { recursive: true });
    const configBeforeRestore = loadGlobalConfig();
    core.saveJson(path.join(archiveRoot, 'settings', 'config.json'), configBeforeRestore);
    setBackupSettings({ schedule: 'off' });

    // Restore settings.
    const settingsConfig = path.join(helper, 'settings', 'config.json');
    if (fs.existsSync(settingsConfig)) {
        let incoming = {};
        try { incoming = JSON.parse(fs.readFileSync(settingsConfig, 'utf8')); } catch (_) { incoming = {}; }
        const local = loadGlobalConfig();
        const merged = Object.assign({}, incoming);
        for (const key of SETTINGS_STRIPPED_KEYS) {
            if (Object.prototype.hasOwnProperty.call(local, key)) merged[key] = local[key];
            else delete merged[key];
        }
        saveGlobalConfig(merged);
    }
    const wfDefsSrc = path.join(helper, 'settings', 'workflow-definitions');
    restoreWorkflowDefinitionsExactly(
        wfDefsSrc,
        path.join(archiveRoot, 'settings', 'workflow-definitions'),
        token
    );

    // Restore projects.
    const restored = [];
    for (const project of plan.projects) {
        restoreProjectExactly(
            project.sourceDir,
            project.path,
            path.join(archiveRoot, 'projects', project.name),
            token,
            project.trackedPaths
        );
        // Auto-register with the dashboard.
        try {
            const repos = listRegisteredRepos();
            if (!repos.map(r => path.resolve(r)).includes(path.resolve(project.path))) {
                const cfg = loadGlobalConfig();
                cfg.repos = (cfg.repos || []).concat([project.path]);
                saveGlobalConfig(cfg);
            }
        } catch (_) { /* ignore */ }
        restored.push({ name: project.name, path: project.path });
    }
    const meta = loadMeta();
    meta.lastPullAt = core.nowIso();
    meta.lastPullEmpty = false;
    meta.lastRestoreArchive = archiveRoot;
    if (head.ok && head.stdout) meta.lastSha = head.stdout;
    saveMeta(meta);
    return { applied: true, restored, notFound: plan.notFound, plan, archiveRoot };
}

// ── Status ────────────────────────────────────────────────────────────────

function status() {
    const remote = getRemote();
    const meta = loadMeta();
    const schedule = getSchedule();
    const cfg = loadGlobalConfig();
    let projectCount = meta.projectCount || 0;
    if (!projectCount && fs.existsSync(path.join(helperRepoPath(), 'projects'))) {
        try {
            projectCount = fs.readdirSync(path.join(helperRepoPath(), 'projects'), { withFileTypes: true })
                .filter(e => e.isDirectory()).length;
        } catch (_) { projectCount = 0; }
    }
    return {
        configured: Boolean(remote),
        remote: remote || null,
        lastPushAt: meta.lastPushAt || null,
        lastPullAt: meta.lastPullAt || null,
        schedule,
        scheduleActive: Boolean(remote) && schedule !== 'off',
        projectCount,
        registeredRepos: Array.isArray(cfg.repos) ? cfg.repos.length : 0,
    };
}

// ── Schedule ──────────────────────────────────────────────────────────────

function setSchedule(cadence) {
    const c = String(cadence || '').toLowerCase();
    if (!VALID_SCHEDULES.has(c)) {
        throw new Error(`Invalid schedule: ${cadence}. Valid: ${[...VALID_SCHEDULES].join(', ')}`);
    }
    setBackupSettings({ schedule: c });
    return c;
}

const SCHEDULE_INTERVAL_MS = {
    hourly: 60 * 60 * 1000,
    daily: 24 * 60 * 60 * 1000,
    weekly: 7 * 24 * 60 * 60 * 1000,
};
function isScheduledPushDue() {
    const remote = getRemote();
    if (!remote) return false;
    const sched = getSchedule();
    if (sched === 'off') return false;
    const meta = loadMeta();
    if (!meta.lastPushAt) return true;
    const last = Date.parse(meta.lastPushAt);
    if (Number.isNaN(last)) return true;
    const interval = SCHEDULE_INTERVAL_MS[sched] || SCHEDULE_INTERVAL_MS.daily;
    return Date.now() - last >= interval;
}

function appendBackupLog(line) {
    try {
        fs.mkdirSync(homeRoot(), { recursive: true });
        fs.appendFileSync(logPath(), `[${core.nowIso()}] ${line}\n`, 'utf8');
    } catch (_) { /* ignore */ }
}

/**
 * Run a scheduled push if due. Safe to call from the dashboard server
 * (logs only — never throws).
 */
function runScheduledPushIfDue() {
    if (!isScheduledPushDue()) return { ran: false, reason: 'not-due' };
    try {
        const result = push();
        appendBackupLog(`scheduled-push ok files=${result.fileCount} projects=${(result.projects || []).length}`);
        return { ran: true, ok: true, result };
    } catch (e) {
        appendBackupLog(`scheduled-push failed: ${e.message}`);
        return { ran: true, ok: false, error: e.message, code: e.code };
    }
}

// ── CLI entry point ───────────────────────────────────────────────────────

function printUsage() {
    console.log('Usage: aigon backup <command> [options]');
    console.log('');
    console.log('Commands:');
    console.log('  configure [<git-url>]      Configure the vault remote (interactive without arg)');
    console.log('  push                       Pull, then push project state + settings to the vault');
    console.log('  pull [--dry-run]           Preview or restore settings and project state from the vault');
    console.log('  status                     Show remote, last push/pull, schedule, project count');
    console.log('  schedule <daily|hourly|weekly|off>  Set scheduled push cadence (default: daily)');
}

async function interactiveConfigure() {
    let clack;
    try { clack = require('@clack/prompts'); } catch (_) { clack = null; }
    const isTTY = process.stdin.isTTY && process.stdout.isTTY;
    if (!clack || !isTTY) {
        throw new Error('Interactive configure requires a TTY. Pass a git URL: aigon backup configure <git-url>');
    }
    clack.intro('🔒 Aigon Vault setup');
    let remote = null;
    if (commandExists('gh') && ghIsAuthenticated()) {
        const useGh = await clack.confirm({
            message: 'Create a new private GitHub repo for the vault? (gh detected)',
            initialValue: true,
        });
        if (clack.isCancel(useGh)) { clack.cancel('Cancelled.'); return null; }
        if (useGh) {
            const nameAns = await clack.text({
                message: 'Repo name',
                placeholder: 'aigon-vault',
                defaultValue: 'aigon-vault',
            });
            if (clack.isCancel(nameAns)) { clack.cancel('Cancelled.'); return null; }
            const name = String(nameAns || 'aigon-vault').trim() || 'aigon-vault';
            const spin = clack.spinner();
            spin.start(`Creating ${name} on GitHub…`);
            try {
                remote = createVaultOnGitHub(name);
                spin.stop(`✅ Created ${remote}`);
            } catch (e) {
                spin.stop(`❌ ${e.message}`);
                remote = null;
            }
        }
    }
    if (!remote) {
        const url = await clack.text({
            message: 'Git URL for the vault repo',
            placeholder: 'git@github.com:you/aigon-vault.git',
        });
        if (clack.isCancel(url) || !url) { clack.cancel('Cancelled.'); return null; }
        remote = String(url).trim();
    }
    configure(remote);
    clack.outro(`✅ Vault configured: ${remote}`);
    return remote;
}

async function handleBackupCommand(args = []) {
    const sub = args[0];
    const rest = args.slice(1);

    if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
        printUsage();
        return;
    }

    if (sub === 'configure') {
        if (rest[0]) {
            const result = configure(rest[0]);
            console.log(`✅ Vault configured`);
            console.log(`   Remote: ${result.remote}`);
            return;
        }
        const remote = await interactiveConfigure();
        if (!remote) process.exitCode = 1;
        return;
    }

    if (sub === 'push') {
        const result = push();
        if (!result.committed) {
            console.log('✅ Backup push: no changes to commit');
        } else {
            console.log(`✅ Backup push: ${result.fileCount} files, ${(result.projects || []).length} projects`);
            console.log(`   ${result.message}`);
        }
        return;
    }

    if (sub === 'pull') {
        const result = pull({ dryRun: rest.includes('--dry-run') });
        if (!result.applied) {
            if (result.dryRun) {
                console.log('Backup pull dry run — no project or settings state changed');
                console.log(`   Remote SHA: ${result.plan.remoteSha || 'unknown'}`);
                for (const project of result.plan.projects) {
                    const diff = project.diff;
                    console.log(`   ${project.name}: +${diff.added.length} ~${diff.changed.length} -${diff.removed.length}`);
                }
                return;
            }
            console.log('✅ Backup pull: vault is empty (nothing to restore yet)');
            return;
        }
        console.log(`✅ Backup pull: ${result.restored.length} project(s) restored`);
        console.log(`   Pre-restore archive: ${result.archiveRoot}`);
        console.log('   Backup schedule: off (re-enable deliberately after verification)');
        for (const r of result.restored) {
            console.log(`   ✓ ${r.name} → ${r.path}`);
        }
        if (result.notFound.length) {
            console.log('');
            console.log(`⚠️  ${result.notFound.length} project(s) not found locally:`);
            for (const name of result.notFound) {
                console.log(`   • ${name} — clone it, then run: aigon server add <path>`);
            }
        }
        return;
    }

    if (sub === 'status') {
        const s = status();
        if (!s.configured) {
            console.log('Backup: not configured');
            console.log('Run: aigon backup configure');
            return;
        }
        console.log('Backup: configured');
        console.log(`   Remote: ${s.remote}`);
        console.log(`   Last push: ${s.lastPushAt || 'never'}`);
        console.log(`   Last pull: ${s.lastPullAt || 'never'}`);
        console.log(`   Schedule: ${s.schedule}${s.scheduleActive ? '' : ' (inactive)'}`);
        console.log(`   Projects in vault: ${s.projectCount}`);
        return;
    }

    if (sub === 'schedule') {
        if (!rest[0]) {
            console.log(`Backup schedule: ${getSchedule()}`);
            console.log(`Valid: ${[...VALID_SCHEDULES].join(', ')}`);
            return;
        }
        const c = setSchedule(rest[0]);
        console.log(`✅ Backup schedule: ${c}`);
        return;
    }

    throw new Error(`Unknown backup command: ${sub}\nRun: aigon backup --help`);
}

module.exports = {
    VAULT_BRANCH,
    DEFAULT_SCHEDULE,
    VALID_SCHEDULES,
    PROJECT_EXCLUDES,
    SETTINGS_STRIPPED_KEYS,
    DEFAULT_RETENTION,
    handleBackupCommand,
    configure,
    createVaultOnGitHub,
    push,
    pull,
    status,
    setSchedule,
    getSchedule,
    getRemote,
    isScheduledPushDue,
    runScheduledPushIfDue,
    applyTelemetryRetention,
    getTelemetryRetentionConfig,
    buildFileIndex,
    buildManagedProjectIndex,
    diffIndexes,
    buildPullPlan,
    restoreProjectExactly,
    restoreWorkflowDefinitionsExactly,
    getTrackedProjectPaths,
    preserveTrackedProjectFiles,
    helperRepoPath,
    metaPath,
    logPath,
};
