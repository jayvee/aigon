'use strict';

/**
 * F380 — aigon-profile-sync.
 *
 * Mirrors `lib/sync-state.js` for the user profile (`~/.aigon/`) instead of
 * the project state (`.aigon/`). Synced files: `config.json` and
 * `workflow-definitions/`. Helper repo lives at `~/.aigon/.sync/repo`,
 * dedicated branch `aigon-profile`.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const core = require('./sync-core');

const PROFILE_BRANCH = 'aigon-profile';
const SYNC_DIR_NAME = '.sync';
const HELPER_REPO_NAME = 'repo';
const META_NAME = 'sync-meta.json';
const SYNCIGNORE_NAME = '.syncignore';
const CONFIG_NAME = 'config.json';

// Files/dirs that are part of the user profile and SHOULD be synced.
// Anything else under ~/.aigon/ is excluded by default.
const PROFILE_INCLUDES = ['config.json', 'workflow-definitions'];

const DEFAULT_PROFILE_SYNCIGNORE = [
    '# Defaults written by aigon profile sync — paths under ~/.aigon excluded from sync.',
    '# Each line is a glob relative to ~/.aigon/. Lines starting with # are comments.',
    'logs/',
    'backups/',
    '*.log',
    '*.log.*',
    'ports.json',
    'action-logs.jsonl',
    'conductor.pid',
    'radar.log',
    'dashboard.log*',
    '.sync/',
    'worktrees/',
    'instances/',
    'tmp/',
    'sync/',
    ''
].join('\n');

function profileRoot() {
    return path.join(os.homedir(), '.aigon');
}

function profileConfigPath() { return path.join(profileRoot(), CONFIG_NAME); }
function syncDirPath() { return path.join(profileRoot(), SYNC_DIR_NAME); }
function helperRepoPath() { return path.join(syncDirPath(), HELPER_REPO_NAME); }
function metaPath() { return path.join(syncDirPath(), META_NAME); }
function syncIgnorePath() { return path.join(profileRoot(), SYNCIGNORE_NAME); }

function loadProfileConfig() { return core.loadJson(profileConfigPath()); }
function saveProfileConfig(cfg) { core.saveJson(profileConfigPath(), cfg); }

function loadMeta() { return core.loadJson(metaPath()); }
function saveMeta(m) { core.saveJson(metaPath(), m); }

function getProfileRemote() {
    const cfg = loadProfileConfig();
    return cfg.sync && cfg.sync.profileRemote ? String(cfg.sync.profileRemote).trim() : null;
}

function ensureProfileSyncIgnore() {
    return core.ensureSyncIgnoreAt(syncIgnorePath(), DEFAULT_PROFILE_SYNCIGNORE);
}

function readSyncIgnorePatterns() {
    return core.readSyncIgnorePatterns(syncIgnorePath());
}

function ensureRemoteConfigured() {
    const remote = getProfileRemote();
    if (!remote) {
        const e = new Error('Profile sync is not configured. Run: aigon profile configure <git-remote-url>');
        e.code = 'ENOPROFILECONFIG';
        throw e;
    }
    return remote;
}

/**
 * Walk only the profile-included paths (config.json, workflow-definitions/),
 * filter through the syncignore matcher, and return relative paths.
 */
function listProfileFiles(rootDir) {
    const out = [];
    for (const inc of PROFILE_INCLUDES) {
        const abs = path.join(rootDir, inc);
        if (!fs.existsSync(abs)) continue;
        const stat = fs.statSync(abs);
        if (stat.isFile()) {
            out.push(inc);
        } else if (stat.isDirectory()) {
            for (const rel of core.listFilesUnder(rootDir, inc)) out.push(rel);
        }
    }
    return out;
}

function copyFilteredProfileInto(helper) {
    const root = profileRoot();
    if (!fs.existsSync(root)) return 0;
    const isIgnored = core.makeSyncIgnoreMatcher(readSyncIgnorePatterns());
    const files = listProfileFiles(root);
    let count = 0;
    for (const rel of files) {
        if (isIgnored(rel)) continue;
        const src = path.join(root, rel);
        const dst = path.join(helper, rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
        count++;
    }
    return count;
}

// ── Subcommands ─────────────────────────────────────────────────────────────

function configure(remoteUrl) {
    if (!remoteUrl) {
        throw new Error('Usage: aigon profile configure <git-remote-url>');
    }
    const cfg = loadProfileConfig();
    cfg.sync = Object.assign({}, cfg.sync || {}, { profileRemote: remoteUrl });
    saveProfileConfig(cfg);
    const created = ensureProfileSyncIgnore();
    core.ensureHelperRepoAt(helperRepoPath(), remoteUrl);
    return { remote: remoteUrl, syncignoreCreated: created };
}

function push() {
    const remote = ensureRemoteConfigured();
    ensureProfileSyncIgnore();
    const helper = core.ensureHelperRepoAt(helperRepoPath(), remote);
    const hadRemote = core.fetchBranch(helper, PROFILE_BRANCH);

    const meta = loadMeta();
    if (hadRemote) {
        const remoteHead = core.git(helper, ['rev-parse', `origin/${PROFILE_BRANCH}`], { allowFail: true });
        if (remoteHead.ok && remoteHead.stdout) {
            const seen = meta.lastSyncedRemoteSha;
            if (seen && seen !== remoteHead.stdout) {
                const e = new Error(
                    `Profile sync remote has new commits (was ${seen.slice(0, 8)}, now ${remoteHead.stdout.slice(0, 8)}).\n` +
                    `Run 'aigon profile pull' to integrate them, then retry 'aigon profile push'.`
                );
                e.code = 'EPROFILECONFLICT';
                throw e;
            }
            if (!seen) {
                const e = new Error(
                    `Remote already has ${PROFILE_BRANCH} commits. Run 'aigon profile pull' before the first push on this machine.`
                );
                e.code = 'EPROFILECONFLICT';
                throw e;
            }
        }
    }

    core.checkoutBranch(helper, PROFILE_BRANCH, { hadRemote });
    const fileCount = copyFilteredProfileInto(helper);
    core.git(helper, ['add', '-A']);
    const status = core.git(helper, ['status', '--porcelain']);
    const hasHead = core.git(helper, ['rev-parse', '--verify', 'HEAD'], { allowFail: true }).ok;
    // REGRESSION: first push with nothing to copy left the helper branch without
    // any commits, so we returned "no changes" and never created the remote branch.
    if (!status.stdout && hasHead) {
        meta.lastPushAt = core.nowIso();
        meta.lastPushFiles = fileCount;
        meta.lastPushNoChanges = true;
        saveMeta(meta);
        return { committed: false, pushed: false, fileCount };
    }
    const message = `aigon-profile-sync: ${core.nowIso()}`;
    if (status.stdout) {
        core.git(helper, ['commit', '--quiet', '-m', message]);
    } else {
        core.git(helper, ['commit', '--quiet', '--allow-empty', '-m', message]);
    }
    const pushResult = core.git(helper, ['push', 'origin', `${PROFILE_BRANCH}:${PROFILE_BRANCH}`], { allowFail: true });
    if (!pushResult.ok) {
        if (/non-fast-forward|rejected/i.test(pushResult.stderr)) {
            const e = new Error(
                `Push rejected — remote ${PROFILE_BRANCH} has diverged. Run 'aigon profile pull' first, resolve any conflicts, then retry.`
            );
            e.code = 'EPROFILECONFLICT';
            throw e;
        }
        throw new Error(`Profile sync push failed: ${pushResult.stderr || 'unknown error'}`);
    }
    const newHead = core.git(helper, ['rev-parse', PROFILE_BRANCH], { allowFail: true });
    meta.lastPushAt = core.nowIso();
    meta.lastPushMessage = message;
    meta.lastPushFiles = fileCount;
    meta.lastPushNoChanges = false;
    if (newHead.ok && newHead.stdout) meta.lastSyncedRemoteSha = newHead.stdout;
    saveMeta(meta);
    return { committed: true, pushed: true, fileCount, message };
}

function pull() {
    const remote = ensureRemoteConfigured();
    ensureProfileSyncIgnore();
    const helper = core.ensureHelperRepoAt(helperRepoPath(), remote);
    const hadRemote = core.fetchBranch(helper, PROFILE_BRANCH);
    if (!hadRemote) {
        const meta = loadMeta();
        meta.lastPullAt = core.nowIso();
        meta.lastPullEmpty = true;
        saveMeta(meta);
        return { applied: false, reason: 'remote-empty' };
    }

    const localExists = core.git(helper, ['rev-parse', '--verify', PROFILE_BRANCH], { allowFail: true }).ok;
    if (localExists) {
        const localOnly = core.git(helper, ['rev-list', `origin/${PROFILE_BRANCH}..${PROFILE_BRANCH}`], { allowFail: true });
        const remoteOnly = core.git(helper, ['rev-list', `${PROFILE_BRANCH}..origin/${PROFILE_BRANCH}`], { allowFail: true });
        const local = localOnly.ok && localOnly.stdout ? localOnly.stdout.split('\n').length : 0;
        const remote2 = remoteOnly.ok && remoteOnly.stdout ? remoteOnly.stdout.split('\n').length : 0;
        if (local > 0 && remote2 > 0) {
            const e = new Error(
                `Profile sync branch has diverged: ${local} local-only and ${remote2} remote-only commits.\n` +
                `Resolve manually:\n` +
                `  cd ${helperRepoPath()} && git pull --rebase origin ${PROFILE_BRANCH}\n` +
                `Then retry: aigon profile push`
            );
            e.code = 'EPROFILECONFLICT';
            throw e;
        }
    }
    core.checkoutBranch(helper, PROFILE_BRANCH, { hadRemote: true, clearWorkingTree: false });

    const root = profileRoot();
    fs.mkdirSync(root, { recursive: true });
    let restored = 0;
    for (const inc of PROFILE_INCLUDES) {
        const helperPath = path.join(helper, inc);
        if (!fs.existsSync(helperPath)) continue;
        const stat = fs.statSync(helperPath);
        if (stat.isFile()) {
            const dst = path.join(root, inc);
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            fs.copyFileSync(helperPath, dst);
            restored++;
        } else if (stat.isDirectory()) {
            for (const rel of core.listFilesUnder(helper, inc)) {
                const src = path.join(helper, rel);
                const dst = path.join(root, rel);
                fs.mkdirSync(path.dirname(dst), { recursive: true });
                fs.copyFileSync(src, dst);
                restored++;
            }
        }
    }
    const meta = loadMeta();
    meta.lastPullAt = core.nowIso();
    meta.lastPullFiles = restored;
    meta.lastPullEmpty = false;
    const head = core.git(helper, ['rev-parse', PROFILE_BRANCH], { allowFail: true });
    if (head.ok && head.stdout) meta.lastSyncedRemoteSha = head.stdout;
    saveMeta(meta);
    return { applied: true, fileCount: restored };
}

function status() {
    const remote = getProfileRemote();
    const meta = loadMeta();
    const summary = {
        configured: Boolean(remote),
        remote: remote || null,
        lastPushAt: meta.lastPushAt || null,
        lastPullAt: meta.lastPullAt || null,
        localOnlyCommits: 0,
        remoteOnlyCommits: 0,
        diverged: false,
        helperReady: false,
    };
    if (!remote) return summary;

    try {
        const helper = core.ensureHelperRepoAt(helperRepoPath(), remote);
        summary.helperReady = true;
        const hadRemote = core.fetchBranch(helper, PROFILE_BRANCH);
        const localExists = core.git(helper, ['rev-parse', '--verify', PROFILE_BRANCH], { allowFail: true }).ok;
        if (hadRemote && localExists) {
            const localOnly = core.git(helper, ['rev-list', `origin/${PROFILE_BRANCH}..${PROFILE_BRANCH}`], { allowFail: true });
            const remoteOnly = core.git(helper, ['rev-list', `${PROFILE_BRANCH}..origin/${PROFILE_BRANCH}`], { allowFail: true });
            summary.localOnlyCommits = localOnly.ok && localOnly.stdout ? localOnly.stdout.split('\n').length : 0;
            summary.remoteOnlyCommits = remoteOnly.ok && remoteOnly.stdout ? remoteOnly.stdout.split('\n').length : 0;
            summary.diverged = summary.localOnlyCommits > 0 && summary.remoteOnlyCommits > 0;
        } else if (hadRemote && !localExists) {
            const remoteCount = core.git(helper, ['rev-list', '--count', `origin/${PROFILE_BRANCH}`], { allowFail: true });
            summary.remoteOnlyCommits = remoteCount.ok ? parseInt(remoteCount.stdout, 10) || 0 : 0;
        } else if (!hadRemote && localExists) {
            const localCount = core.git(helper, ['rev-list', '--count', PROFILE_BRANCH], { allowFail: true });
            summary.localOnlyCommits = localCount.ok ? parseInt(localCount.stdout, 10) || 0 : 0;
        }
    } catch (_) {
        summary.helperReady = false;
    }
    return summary;
}

/**
 * Read-only summary used by `/api/profile/status` — never touches the network.
 */
function statusLocal() {
    const remote = getProfileRemote();
    const meta = loadMeta();
    return {
        configured: Boolean(remote),
        remote: remote || null,
        lastPushAt: meta.lastPushAt || null,
        lastPullAt: meta.lastPullAt || null,
    };
}

// ── CLI entry point ─────────────────────────────────────────────────────────

function printUsage() {
    console.log('Usage: aigon profile <command> [options]');
    console.log('');
    console.log('Profile (project type) commands:');
    console.log('  show                   Display current project profile and settings');
    console.log('  set <type>             Set project profile (web, api, ios, android, library, generic)');
    console.log('  detect                 Show what auto-detection would choose');
    console.log('');
    console.log('Profile sync commands (sync ~/.aigon between machines):');
    console.log('  configure <git-url>    Configure remote and create ~/.aigon/.syncignore');
    console.log('  push                   Commit ~/.aigon/ profile and push to aigon-profile branch');
    console.log('  pull                   Fetch + fast-forward merge aigon-profile from configured remote');
    console.log('  status                 Show last push/pull timestamps and divergence');
}

async function handleProfileSyncCommand(args = []) {
    const sub = args[0];
    const rest = args.slice(1);

    if (sub === 'configure') {
        const result = configure(rest[0]);
        console.log(`✅ Profile sync configured`);
        console.log(`   Remote: ${result.remote}`);
        if (result.syncignoreCreated) {
            console.log(`   Created: ~/.aigon/.syncignore (defaults)`);
        }
        return;
    }

    if (sub === 'push') {
        const result = push();
        if (!result.committed) {
            console.log('✅ Profile sync push: no changes to commit');
        } else {
            console.log(`✅ Profile sync push: ${result.fileCount} files committed`);
            console.log(`   ${result.message}`);
        }
        return;
    }

    if (sub === 'pull') {
        const result = pull();
        if (!result.applied) {
            console.log('✅ Profile sync pull: remote has no aigon-profile branch yet');
        } else {
            console.log(`✅ Profile sync pull: ${result.fileCount} files restored`);
        }
        return;
    }

    if (sub === 'status') {
        const s = status();
        if (!s.configured) {
            console.log('Profile sync: not configured');
            console.log('Run: aigon profile configure <git-remote-url>');
            return;
        }
        console.log('Profile sync: configured');
        console.log(`   Remote: ${s.remote}`);
        console.log(`   Last push: ${s.lastPushAt || 'never'}`);
        console.log(`   Last pull: ${s.lastPullAt || 'never'}`);
        console.log(`   Local-only commits: ${s.localOnlyCommits}`);
        console.log(`   Remote-only commits: ${s.remoteOnlyCommits}`);
        if (s.diverged) {
            console.log('   ⚠️  Branches have diverged — pull or rebase before pushing.');
        }
        return;
    }

    throw new Error(`Unknown profile sync command: ${sub}\nRun: aigon profile --help`);
}

module.exports = {
    PROFILE_BRANCH,
    PROFILE_INCLUDES,
    handleProfileSyncCommand,
    configure,
    push,
    pull,
    status,
    statusLocal,
    getProfileRemote,
    ensureProfileSyncIgnore,
    profileRoot,
    profileConfigPath,
    helperRepoPath,
    metaPath,
    syncIgnorePath,
    printUsage,
};
