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
const { spawnSync } = require('child_process');

const core = require('./sync-core');

const VAULT_BRANCH = 'main';
const VAULT_DIR_NAME = '.vault';
const META_NAME = 'backup-meta.json';

// `.aigon/` files that are NOT included when backing up a project.
const PROJECT_EXCLUDES = new Set([
    'sessions',
    'locks',
    'telemetry',
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
const SETTINGS_STRIPPED_KEYS = ['repos', 'serverPort', 'sync'];

const VALID_SCHEDULES = new Set(['daily', 'hourly', 'weekly', 'off']);
const DEFAULT_SCHEDULE = 'daily';

function homeRoot() {
    return path.join(os.homedir(), '.aigon');
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

/** @param {string} line */
function backupInfo(line) {
    if (process.env.AIGON_BACKUP_QUIET === '1') {
        return;
    }
    console.log(line);
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

/**
 * If url is a standard github.com SSH remote, return the equivalent HTTPS URL
 * so Git can use the GitHub credential helper / `gh` auth instead of ssh-agent
 * and SSH key passphrases.
 * @param {string} url
 * @returns {string}
 */
function normalizeGitHubSshToHttps(url) {
    const s = String(url || '').trim();
    if (!s) return s;
    const m = s.match(/^git@github\.com:([^/]+)\/(.+)$/i);
    if (!m) return s;
    let repo = m[2].trim();
    if (!repo.toLowerCase().endsWith('.git')) {
        repo += '.git';
    }
    return `https://github.com/${m[1]}/${repo}`;
}

/**
 * Rewrite legacy SSH vault URL to HTTPS in config + helper repo, once per process
 * as needed. Idempotent.
 */
function migrateGitHubSshRemoteIfNeeded() {
    const remote = getRemote();
    if (!remote) return;
    const next = normalizeGitHubSshToHttps(remote);
    if (next === remote) return;
    setBackupSettings({ remote: next });
    const helper = helperRepoPath();
    if (fs.existsSync(path.join(helper, '.git'))) {
        core.ensureHelperRepoAt(helper, next);
    }
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

function rmIfExists(p) {
    try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) { /* ignore */ }
}

// ── Configure ─────────────────────────────────────────────────────────────

function configure(remoteUrl, opts = {}) {
    const url = remoteUrl ? String(remoteUrl).trim() : null;
    if (!url) {
        throw new Error('Usage: aigon backup configure <git-url>');
    }
    const normalized = normalizeGitHubSshToHttps(url);
    if (normalized !== url) {
        console.log(`ℹ️  Using HTTPS remote (no SSH key passphrase): ${normalized}`);
    }
    if (isCloudSyncedPath(homeRoot())) {
        // ~/.aigon shouldn't itself be cloud-synced, but warn loudly if so.
        console.warn('⚠️  ~/.aigon is inside an iCloud/Dropbox path — git + cloud sync corrupts repos. Move ~/.aigon out first.');
    }
    setBackupSettings({ remote: normalized, schedule: getSchedule() });
    fs.mkdirSync(vaultDir(), { recursive: true });
    core.ensureHelperRepoAt(helperRepoPath(), normalized);
    return { remote: normalized };
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
    migrateGitHubSshRemoteIfNeeded();
    const remote = ensureRemoteConfigured();
    const helper = helperRepoPath();
    backupInfo('');
    backupInfo('━━━ Aigon vault backup (push) ━━━');
    backupInfo(`  Vault remote: ${remote}`);
    backupInfo(`  Local clone:  ${helper}`);
    backupInfo(`  Branch:       ${VAULT_BRANCH}`);
    fs.mkdirSync(vaultDir(), { recursive: true });
    core.ensureHelperRepoAt(helper, remote);

    // 1. Pull first (fast-forward only)
    backupInfo('');
    backupInfo('(1) Syncing with remote: git fetch + checkout ' + VAULT_BRANCH);
    const hadRemote = core.fetchBranch(helper, VAULT_BRANCH);
    if (!hadRemote) {
        backupInfo('  No commits on remote yet (first push to this vault).');
    } else {
        const fetchLog = core.git(helper, ['log', '-1', '--oneline', `origin/${VAULT_BRANCH}`], { allowFail: true });
        if (fetchLog.ok && fetchLog.stdout) {
            backupInfo('  origin/' + VAULT_BRANCH + ' at: ' + fetchLog.stdout.trim());
        }
    }
    if (hadRemote) {
        const localExists = core.git(helper, ['rev-parse', '--verify', VAULT_BRANCH], { allowFail: true }).ok;
        if (localExists) {
            const localOnly = core.git(helper, ['rev-list', `origin/${VAULT_BRANCH}..${VAULT_BRANCH}`], { allowFail: true });
            const remoteOnly = core.git(helper, ['rev-list', `${VAULT_BRANCH}..origin/${VAULT_BRANCH}`], { allowFail: true });
            const local = localOnly.ok && localOnly.stdout ? localOnly.stdout.split('\n').filter(Boolean).length : 0;
            const remote2 = remoteOnly.ok && remoteOnly.stdout ? remoteOnly.stdout.split('\n').filter(Boolean).length : 0;
            if (local > 0 && remote2 > 0) {
                const e = new Error(
                    'Remote has diverged from local. Pull first to integrate remote changes,\n' +
                    'then retry: aigon backup pull && aigon backup push'
                );
                e.code = 'EBACKUPCONFLICT';
                throw e;
            }
        }
        core.checkoutBranch(helper, VAULT_BRANCH, { hadRemote: true });
    } else {
        core.checkoutBranch(helper, VAULT_BRANCH, { hadRemote: false });
    }

    // 2. Wipe everything except .git, then rewrite from scratch.
    backupInfo('');
    backupInfo('(2) Rebuilding snapshot: removing previous tree (keeps .git), then recopying from this machine');
    for (const ent of fs.readdirSync(helper)) {
        if (ent === '.git') continue;
        rmIfExists(path.join(helper, ent));
    }

    // 3. Project state.
    const repos = listRegisteredRepos();
    let totalFiles = 0;
    const projectsCopied = [];
    backupInfo('');
    backupInfo('(3) Copying each registered project\'s .aigon/ into the vault (filtered: no sessions, caches, …)');
    backupInfo(`  Registered repositories: ${repos.length}`);
    for (const repoPath of repos) {
        const name = projectName(repoPath);
        if (!fs.existsSync(repoPath)) {
            backupInfo(`  SKIP  ${name}  — path not on disk: ${repoPath}`);
            continue;
        }
        const dst = path.join(helper, 'projects', name);
        const n = copyProjectAigonInto(repoPath, dst);
        if (n > 0) {
            projectsCopied.push({ name, path: repoPath, files: n });
            totalFiles += n;
            backupInfo(`  copy  ${name}  — ${n} file(s)  ← ${repoPath}`);
        } else {
            backupInfo(`  copy  ${name}  — 0 file(s)  ← ${repoPath}  (empty or only excluded paths)`);
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
    let wfFileCount = 0;
    if (fs.existsSync(wfDefsSrc)) {
        wfFileCount = copyDirRecursive(wfDefsSrc, wfDefsDst);
        totalFiles += wfFileCount;
    }
    backupInfo('');
    backupInfo('(4) Global settings for this user');
    backupInfo(`  Wrote: settings/config.json  (keys like repos/serverPort omitted — re-bound on restore)`);
    if (wfFileCount > 0) {
        backupInfo(`  Wrote: settings/workflow-definitions/  (${wfFileCount} file(s))`);
    } else {
        backupInfo('  No ~/.aigon/workflow-definitions/  on disk — skipped');
    }

    // 5. Commit & push.
    backupInfo('');
    backupInfo('(5) Commit and push to the remote');
    core.git(helper, ['add', '-A']);
    const status = core.git(helper, ['status', '--porcelain']);
    const hasHead = core.git(helper, ['rev-parse', '--verify', 'HEAD'], { allowFail: true }).ok;
    if (!status.stdout && hasHead) {
        backupInfo('  git status: no differences vs last commit — your vault already matched this snapshot.');
        backupInfo(`  (Still copied ${totalFiles} file(s) for ${projectsCopied.length} project(s) with data; tree identical to HEAD.)`);
        const meta = loadMeta();
        meta.lastPushAt = core.nowIso();
        meta.lastPushFiles = totalFiles;
        meta.lastPushNoChanges = true;
        meta.projectCount = projectsCopied.length;
        saveMeta(meta);
        backupInfo('');
        backupInfo('✅ Done — no new commit. Nothing changed since the last successful backup.');
        return { committed: false, pushed: false, fileCount: totalFiles, projects: projectsCopied };
    }
    if (status.stdout) {
        const changes = status.stdout.split('\n').filter(Boolean);
        backupInfo(`  Staging: ${changes.length} path(s) changed, added, or removed vs last commit`);
    } else {
        backupInfo('  Staging: first commit on this branch (or empty allow-empty body)');
    }
    const message = `aigon backup — ${core.nowIso()}`;
    if (status.stdout) {
        core.git(helper, ['commit', '--quiet', '-m', message]);
    } else {
        core.git(helper, ['commit', '--quiet', '--allow-empty', '-m', message]);
    }
    const showOut = core.git(helper, ['show', '-1', '--stat', '--format=fuller'], { allowFail: true });
    if (showOut.ok && showOut.stdout) {
        backupInfo('');
        backupInfo('Latest local commit:');
        for (const line of showOut.stdout.trimEnd().split('\n')) {
            backupInfo('  ' + line);
        }
    }
    backupInfo('');
    backupInfo(`  git push origin ${VAULT_BRANCH} …`);
    const pushResult = core.git(helper, ['push', 'origin', `${VAULT_BRANCH}:${VAULT_BRANCH}`], { allowFail: true });
    if (pushResult.stdout && pushResult.stdout.trim()) {
        for (const line of pushResult.stdout.trimEnd().split('\n')) {
            backupInfo('  ' + line);
        }
    }
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
    const shortHash = newHead.ok && newHead.stdout
        ? newHead.stdout.trim().slice(0, 7)
        : '(unknown)';
    const meta = loadMeta();
    meta.lastPushAt = core.nowIso();
    meta.lastPushMessage = message;
    meta.lastPushFiles = totalFiles;
    meta.lastPushNoChanges = false;
    meta.projectCount = projectsCopied.length;
    if (newHead.ok && newHead.stdout) meta.lastSha = newHead.stdout;
    saveMeta(meta);
    backupInfo('  push: OK  (fast-forward to remote)');
    backupInfo('');
    backupInfo('━━━ Success ━━━');
    backupInfo(`  Snapshot:  ${totalFiles} file(s)  ·  ${projectsCopied.length} project(s) with data  ·  commit ${shortHash}`);
    backupInfo(`  Remote:    ${remote}  ·  ${VAULT_BRANCH}`);
    backupInfo('  The vault repo on the server should now show this commit (e.g. on GitHub: latest on `main`).');
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
    for (const root of PROJECT_SCAN_ROOTS) {
        if (!fs.existsSync(root)) continue;
        const candidate = path.join(root, name);
        if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, '.git'))) {
            return candidate;
        }
    }
    return null;
}

function pull() {
    migrateGitHubSshRemoteIfNeeded();
    const remote = ensureRemoteConfigured();
    const helper = helperRepoPath();
    backupInfo('');
    backupInfo('━━━ Aigon vault restore (pull) ━━━');
    backupInfo(`  Vault remote: ${remote}`);
    backupInfo(`  Local clone:  ${helper}`);
    fs.mkdirSync(vaultDir(), { recursive: true });
    core.ensureHelperRepoAt(helper, remote);
    backupInfo('');
    backupInfo('(1) Fetching latest from remote');
    const hadRemote = core.fetchBranch(helper, VAULT_BRANCH);
    if (!hadRemote) {
        backupInfo('  Remote has no ' + VAULT_BRANCH + ' yet — nothing to restore. Push from another machine first.');
        const meta = loadMeta();
        meta.lastPullAt = core.nowIso();
        meta.lastPullEmpty = true;
        saveMeta(meta);
        backupInfo('');
        backupInfo('✅ Done — vault is empty (nothing to restore).');
        return { applied: false, reason: 'remote-empty' };
    }
    const tip = core.git(helper, ['log', '-1', '--oneline', `origin/${VAULT_BRANCH}`], { allowFail: true });
    if (tip.ok && tip.stdout) {
        backupInfo('  Fetched: ' + tip.stdout.trim());
    }

    const localExists = core.git(helper, ['rev-parse', '--verify', VAULT_BRANCH], { allowFail: true }).ok;
    if (localExists) {
        const localOnly = core.git(helper, ['rev-list', `origin/${VAULT_BRANCH}..${VAULT_BRANCH}`], { allowFail: true });
        const remoteOnly = core.git(helper, ['rev-list', `${VAULT_BRANCH}..origin/${VAULT_BRANCH}`], { allowFail: true });
        const local = localOnly.ok && localOnly.stdout ? localOnly.stdout.split('\n').filter(Boolean).length : 0;
        const remote2 = remoteOnly.ok && remoteOnly.stdout ? remoteOnly.stdout.split('\n').filter(Boolean).length : 0;
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

    backupInfo('');
    backupInfo('(2) Checking out remote tree and merging into ~/.aigon');

    // Restore settings.
    const settingsConfig = path.join(helper, 'settings', 'config.json');
    if (fs.existsSync(settingsConfig)) {
        let incoming = {};
        try { incoming = JSON.parse(fs.readFileSync(settingsConfig, 'utf8')); } catch (_) { incoming = {}; }
        const local = loadGlobalConfig();
        const merged = Object.assign({}, incoming, {
            repos: local.repos || [],
            serverPort: local.serverPort,
        });
        if (local.sync) merged.sync = local.sync;
        if (merged.serverPort === undefined) delete merged.serverPort;
        saveGlobalConfig(merged);
        backupInfo('  Merged vault/settings/config.json  →  ~/.aigon/config.json  (kept your repos, server port, and sync as local).');
    } else {
        backupInfo('  No settings/config.json in vault — left local config unchanged.');
    }
    const wfDefsSrc = path.join(helper, 'settings', 'workflow-definitions');
    const wfDefsDst = path.join(homeRoot(), 'workflow-definitions');
    if (fs.existsSync(wfDefsSrc)) {
        const wn = copyDirRecursive(wfDefsSrc, wfDefsDst);
        backupInfo(`  Wrote settings/workflow-definitions/  →  ~/.aigon/workflow-definitions/  (${wn} file(s))`);
    }

    // Restore projects.
    const projectsRoot = path.join(helper, 'projects');
    backupInfo('');
    backupInfo('(3) Restoring each project tree from vault into local .aigon/ (by folder name match)');
    const restored = [];
    const notFound = [];
    if (fs.existsSync(projectsRoot)) {
        const vaultProjects = fs.readdirSync(projectsRoot, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name);
        const _names = vaultProjects.length <= 12
            ? vaultProjects.join(', ')
            : (vaultProjects.slice(0, 10).join(', ') + ', … +' + (vaultProjects.length - 10));
        backupInfo(`  Vault projects/ folders: ${vaultProjects.length}  [${_names}]`);
        for (const ent of fs.readdirSync(projectsRoot, { withFileTypes: true })) {
            if (!ent.isDirectory()) continue;
            const name = ent.name;
            const local = findProjectOnDisk(name);
            if (!local) {
                notFound.push(name);
                backupInfo(`  WARN  no local repo matched name "${name}"  — skipped (add project or clone under ~/src, ~/code, …)`);
                continue;
            }
            const src = path.join(projectsRoot, name);
            const dst = path.join(local, '.aigon');
            let fileN = 0;
            for (const sub of fs.readdirSync(src, { withFileTypes: true })) {
                const s = path.join(src, sub.name);
                const d = path.join(dst, sub.name);
                if (sub.isDirectory()) {
                    fs.mkdirSync(d, { recursive: true });
                    fileN += copyDirRecursive(s, d);
                } else if (sub.isFile()) {
                    fs.mkdirSync(path.dirname(d), { recursive: true });
                    fs.copyFileSync(s, d);
                    fileN++;
                }
            }
            // Auto-register with the dashboard.
            try {
                const repos = listRegisteredRepos();
                if (!repos.map(r => path.resolve(r)).includes(path.resolve(local))) {
                    const cfg = loadGlobalConfig();
                    cfg.repos = (cfg.repos || []).concat([local]);
                    saveGlobalConfig(cfg);
                    backupInfo(`  + registered new repo: ${local}`);
                }
            } catch (_) { /* ignore */ }
            restored.push({ name, path: local });
            backupInfo(`  restore  ${name}  — ${fileN} file(s)  →  ${path.join(local, '.aigon')}`);
        }
    } else {
        backupInfo('  (no projects/ in vault — settings-only restore)');
    }

    const head = core.git(helper, ['rev-parse', VAULT_BRANCH], { allowFail: true });
    const meta = loadMeta();
    meta.lastPullAt = core.nowIso();
    meta.lastPullEmpty = false;
    if (head.ok && head.stdout) meta.lastSha = head.stdout;
    saveMeta(meta);
    backupInfo('');
    backupInfo('━━━ Success ━━━');
    backupInfo(`  Restored: ${restored.length} project(s)  ·  not found locally: ${notFound.length}`);
    if (head.ok && head.stdout) {
        backupInfo('  Local vault HEAD: ' + head.stdout.trim().slice(0, 7));
    }
    return { applied: true, restored, notFound };
}

// ── Status ────────────────────────────────────────────────────────────────

function status() {
    migrateGitHubSshRemoteIfNeeded();
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
    const prevQ = process.env.AIGON_BACKUP_QUIET;
    process.env.AIGON_BACKUP_QUIET = '1';
    try {
        const result = push();
        appendBackupLog(`scheduled-push ok files=${result.fileCount} projects=${(result.projects || []).length}`);
        return { ran: true, ok: true, result };
    } catch (e) {
        appendBackupLog(`scheduled-push failed: ${e.message}`);
        return { ran: true, ok: false, error: e.message, code: e.code };
    } finally {
        if (prevQ === undefined) {
            delete process.env.AIGON_BACKUP_QUIET;
        } else {
            process.env.AIGON_BACKUP_QUIET = prevQ;
        }
    }
}

// ── CLI entry point ───────────────────────────────────────────────────────

function printUsage() {
    console.log('Usage: aigon backup <command> [options]');
    console.log('');
    console.log('Commands:');
    console.log('  configure [<git-url>]      Configure the vault (interactive; GitHub git@ → https)');
    console.log('  push                       Pull, then push project state + settings to the vault');
    console.log('  pull                       Fetch + restore settings and project state from the vault');
    console.log('  status                     Show remote, last push/pull, schedule, project count');
    console.log('  schedule <daily|hourly|weekly|off>  Set scheduled push cadence (default: daily)');
    console.log('');
    console.log('push/pull/status print step-by-step progress. Suppress with:  AIGON_BACKUP_QUIET=1 aigon …');
    console.log('(Scheduled auto-push in the server uses quiet mode; see ~/.aigon/backup.log for one-line result.)');
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
            message: 'Git URL for the vault repo (HTTPS works with `gh auth login` — no SSH key passphrase)',
            placeholder: 'https://github.com/you/aigon-vault.git',
        });
        if (clack.isCancel(url) || !url) { clack.cancel('Cancelled.'); return null; }
        remote = String(url).trim();
    }
    const { remote: stored } = configure(remote);
    clack.outro(`✅ Vault configured: ${stored}`);
    return stored;
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
        push();
        return;
    }

    if (sub === 'pull') {
        pull();
        return;
    }

    if (sub === 'status') {
        const s = status();
        if (!s.configured) {
            console.log('Backup: not configured');
            console.log('  Run: aigon backup configure <git-url>');
            return;
        }
        const m = loadMeta();
        const hp = helperRepoPath();
        console.log('');
        console.log('━━━ Aigon vault status ━━━');
        console.log('  Configured:     yes');
        console.log(`  Remote:         ${s.remote}`);
        console.log(`  Local clone:     ${hp}`);
        console.log(`  Branch:         ${VAULT_BRANCH}`);
        console.log(`  Dashboard reg.: ${s.registeredRepos} repository path(s) in ~/.aigon/config.json`);
        console.log(`  Last push:      ${s.lastPushAt || 'never'}`);
        if (m.lastPushMessage) {
            console.log(`  Last message:   ${m.lastPushMessage}`);
        }
        if (m.lastSha) {
            console.log(`  Last commit id:  ${m.lastSha.trim()}`);
        }
        console.log(`  Last pull:      ${s.lastPullAt || 'never'}`);
        console.log(`  Auto-push:      ${s.schedule}${s.scheduleActive ? ' (on — server will push on schedule if running)' : ' (inactive: schedule off or no server)'}`);
        console.log(`  Project slots:  ${s.projectCount}  (in last known snapshot; see push output for current)`);
        const rev = core.git(hp, ['rev-parse', '--short', 'HEAD'], { allowFail: true });
        const oref = core.git(hp, ['rev-parse', '--verify', `origin/${VAULT_BRANCH}`], { allowFail: true });
        if (rev.ok && rev.stdout) {
            let syncNote = 'no origin ref yet (never fetched or new clone)';
            if (oref.ok && oref.stdout) {
                const b = core.git(hp, ['rev-list', '--count', `${VAULT_BRANCH}..origin/${VAULT_BRANCH}`], { allowFail: true });
                const a = core.git(hp, ['rev-list', '--count', `origin/${VAULT_BRANCH}..${VAULT_BRANCH}`], { allowFail: true });
                const nBehind = b.ok && b.stdout ? parseInt(b.stdout, 10) : 0;
                const nAhead = a.ok && a.stdout ? parseInt(a.stdout, 10) : 0;
                if (nBehind === 0 && nAhead === 0) syncNote = 'in sync with origin';
                else if (nAhead > 0 && nBehind === 0) syncNote = `${nAhead} commit(s) ahead of origin (ready to push)`;
                else if (nBehind > 0 && nAhead === 0) syncNote = `${nBehind} commit(s) behind origin (run: aigon backup pull)`;
                else if (nBehind > 0 && nAhead > 0) syncNote = `diverged (${nAhead} local / ${nBehind} remote) — fix manually in ${hp}`;
            }
            console.log(`  Local HEAD:     ${rev.stdout.trim()}  (${syncNote})`);
        }
        console.log(`  Full log:       ${logPath()}`);
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
    handleBackupCommand,
    configure,
    createVaultOnGitHub,
    push,
    pull,
    status,
    setSchedule,
    getSchedule,
    getRemote,
    normalizeGitHubSshToHttps,
    isScheduledPushDue,
    runScheduledPushIfDue,
    helperRepoPath,
    metaPath,
    logPath,
};
