'use strict';

/**
 * F359 — aigon-state-sync.
 *
 * Lightweight git-backed sync of `.aigon/` between machines. The user
 * configures a remote URL once, then `aigon sync push` / `aigon sync pull`
 * move state via a dedicated `aigon-state` branch. State is staged in a
 * hidden helper repo at `.aigon/.sync/repo` to avoid touching the user's
 * working tree or branch.
 */

const fs = require('fs');
const path = require('path');
const core = require('./sync-core');

const SYNC_BRANCH = 'aigon-state';
const SYNC_DIR_REL = path.join('.aigon', '.sync');
const HELPER_REPO_REL = path.join(SYNC_DIR_REL, 'repo');
const META_REL = path.join(SYNC_DIR_REL, 'sync-meta.json');
const SYNC_IGNORE_REL = path.join('.aigon', '.syncignore');
const PROJECT_CONFIG_REL = path.join('.aigon', 'config.json');

const DEFAULT_SYNCIGNORE = [
    '# Defaults written by aigon sync — paths under .aigon excluded from sync.',
    '# Each line is a glob relative to .aigon/. Lines starting with # are comments.',
    'locks/',
    'sessions/',
    '.sync/',
    '*.env',
    '.env*',
    'config-hash',
    'budget-cache.json',
    'insights-cache.json',
    'recurring-state.json',
    'telemetry/',
    'server/',
    ''
].join('\n');

const { nowIso, listFilesUnder, git, makeSyncIgnoreMatcher } = core;

function repoRoot() {
    return process.cwd();
}

function projectConfigPath() {
    return path.join(repoRoot(), PROJECT_CONFIG_REL);
}

function loadProjectConfig() { return core.loadJson(projectConfigPath()); }
function saveProjectConfig(config) { core.saveJson(projectConfigPath(), config); }

function getSyncRemote() {
    const cfg = loadProjectConfig();
    return cfg.sync && cfg.sync.remote ? String(cfg.sync.remote).trim() : null;
}

function helperRepoPath() { return path.join(repoRoot(), HELPER_REPO_REL); }
function metaPath() { return path.join(repoRoot(), META_REL); }
function loadMeta() { return core.loadJson(metaPath()); }
function saveMeta(meta) { core.saveJson(metaPath(), meta); }

function ensureSyncIgnore() {
    return core.ensureSyncIgnoreAt(path.join(repoRoot(), SYNC_IGNORE_REL), DEFAULT_SYNCIGNORE);
}

function readSyncIgnorePatterns() {
    return core.readSyncIgnorePatterns(path.join(repoRoot(), SYNC_IGNORE_REL));
}

function ensureHelperRepo(remoteUrl) {
    return core.ensureHelperRepoAt(helperRepoPath(), remoteUrl);
}

function fetchSyncBranch(helper) { return core.fetchBranch(helper, SYNC_BRANCH); }

function checkoutSyncBranch(helper, opts) {
    return core.checkoutBranch(helper, SYNC_BRANCH, opts);
}

function copyFilteredAigonInto(helper) {
    const aigonDir = path.join(repoRoot(), '.aigon');
    if (!fs.existsSync(aigonDir)) return 0;
    const patterns = readSyncIgnorePatterns();
    const isIgnored = makeSyncIgnoreMatcher(patterns);
    const files = listFilesUnder(aigonDir);
    let count = 0;
    for (const rel of files) {
        if (isIgnored(rel)) continue;
        const src = path.join(aigonDir, rel);
        const dst = path.join(helper, '.aigon', rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
        count++;
    }
    return count;
}

function ensureRemoteConfigured() {
    const remote = getSyncRemote();
    if (!remote) {
        const e = new Error('Sync is not configured. Run: aigon sync configure <git-remote-url>');
        e.code = 'ENOSYNCCONFIG';
        throw e;
    }
    return remote;
}

// ── Subcommands ─────────────────────────────────────────────────────────────

function configure(remoteUrl) {
    if (!remoteUrl) {
        throw new Error('Usage: aigon sync configure <git-remote-url>');
    }
    const cfg = loadProjectConfig();
    cfg.sync = Object.assign({}, cfg.sync || {}, { remote: remoteUrl });
    saveProjectConfig(cfg);
    const created = ensureSyncIgnore();
    ensureHelperRepo(remoteUrl);
    return { remote: remoteUrl, syncignoreCreated: created };
}

function push() {
    const remote = ensureRemoteConfigured();
    ensureSyncIgnore();
    const helper = ensureHelperRepo(remote);
    const hadRemote = fetchSyncBranch(helper);

    // Conflict gate: if the remote has commits we haven't yet observed via
    // pull or our last successful push, refuse the push. Silent overwrite of
    // another machine's work is the failure mode the spec calls out.
    const meta = loadMeta();
    if (hadRemote) {
        const remoteHead = git(helper, ['rev-parse', `origin/${SYNC_BRANCH}`], { allowFail: true });
        if (remoteHead.ok && remoteHead.stdout) {
            const seen = meta.lastSyncedRemoteSha;
            if (seen && seen !== remoteHead.stdout) {
                const e = new Error(
                    `Sync remote has new commits (was ${seen.slice(0, 8)}, now ${remoteHead.stdout.slice(0, 8)}).\n` +
                    `Run 'aigon sync pull' to integrate them, then retry 'aigon sync push'.`
                );
                e.code = 'ESYNCCONFLICT';
                throw e;
            }
            // Never pushed/pulled on this machine but remote already has history —
            // require pull first so we do not replace another machine's state.
            if (!seen) {
                const e = new Error(
                    `Remote already has ${SYNC_BRANCH} commits. Run 'aigon sync pull' before the first push on this machine.`
                );
                e.code = 'ESYNCCONFLICT';
                throw e;
            }
        }
    }

    checkoutSyncBranch(helper, { hadRemote });
    const fileCount = copyFilteredAigonInto(helper);
    git(helper, ['add', '-A']);
    const status = git(helper, ['status', '--porcelain']);
    if (!status.stdout) {
        meta.lastPushAt = nowIso();
        meta.lastPushFiles = fileCount;
        meta.lastPushNoChanges = true;
        saveMeta(meta);
        return { committed: false, pushed: false, fileCount };
    }
    const message = `aigon-sync: ${nowIso()}`;
    git(helper, ['commit', '--quiet', '-m', message]);
    const pushResult = git(helper, ['push', 'origin', `${SYNC_BRANCH}:${SYNC_BRANCH}`], { allowFail: true });
    if (!pushResult.ok) {
        if (/non-fast-forward|rejected/i.test(pushResult.stderr)) {
            const e = new Error(
                `Push rejected — remote ${SYNC_BRANCH} has diverged. Run 'aigon sync pull' first, resolve any conflicts, then retry.`
            );
            e.code = 'ESYNCCONFLICT';
            throw e;
        }
        const e = new Error(`Sync push failed: ${pushResult.stderr || 'unknown error'}`);
        throw e;
    }
    const newHead = git(helper, ['rev-parse', SYNC_BRANCH], { allowFail: true });
    meta.lastPushAt = nowIso();
    meta.lastPushMessage = message;
    meta.lastPushFiles = fileCount;
    meta.lastPushNoChanges = false;
    if (newHead.ok && newHead.stdout) meta.lastSyncedRemoteSha = newHead.stdout;
    saveMeta(meta);
    return { committed: true, pushed: true, fileCount, message };
}

function pull() {
    const remote = ensureRemoteConfigured();
    ensureSyncIgnore();
    const helper = ensureHelperRepo(remote);
    const hadRemote = fetchSyncBranch(helper);
    if (!hadRemote) {
        // Nothing on the remote yet — no-op.
        const meta = loadMeta();
        meta.lastPullAt = nowIso();
        meta.lastPullEmpty = true;
        saveMeta(meta);
        return { applied: false, reason: 'remote-empty' };
    }

    const localExists = git(helper, ['rev-parse', '--verify', SYNC_BRANCH], { allowFail: true }).ok;
    if (localExists) {
        // Detect divergence: if local has commits not in remote, refuse to FF.
        const localOnly = git(helper, ['rev-list', `origin/${SYNC_BRANCH}..${SYNC_BRANCH}`], { allowFail: true });
        const remoteOnly = git(helper, ['rev-list', `${SYNC_BRANCH}..origin/${SYNC_BRANCH}`], { allowFail: true });
        const local = localOnly.ok && localOnly.stdout ? localOnly.stdout.split('\n').length : 0;
        const remote2 = remoteOnly.ok && remoteOnly.stdout ? remoteOnly.stdout.split('\n').length : 0;
        if (local > 0 && remote2 > 0) {
            const e = new Error(
                `Sync branch has diverged: ${local} local-only and ${remote2} remote-only commits.\n` +
                `Resolve manually:\n` +
                `  cd ${helperRepoPath()} && git pull --rebase origin ${SYNC_BRANCH}\n` +
                `Then retry: aigon sync push`
            );
            e.code = 'ESYNCCONFLICT';
            throw e;
        }
    }
    // Fast-forward checkout to remote tip — keep working-tree contents so we
    // can copy them back into the live `.aigon/` below.
    checkoutSyncBranch(helper, { hadRemote: true, clearWorkingTree: false });

    // Restore the synced .aigon/ contents back into the project tree.
    const helperAigon = path.join(helper, '.aigon');
    let restored = 0;
    if (fs.existsSync(helperAigon)) {
        const files = listFilesUnder(helperAigon);
        for (const rel of files) {
            const src = path.join(helperAigon, rel);
            const dst = path.join(repoRoot(), '.aigon', rel);
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            fs.copyFileSync(src, dst);
            restored++;
        }
    }
    const meta = loadMeta();
    meta.lastPullAt = nowIso();
    meta.lastPullFiles = restored;
    meta.lastPullEmpty = false;
    const head = git(helper, ['rev-parse', SYNC_BRANCH], { allowFail: true });
    if (head.ok && head.stdout) meta.lastSyncedRemoteSha = head.stdout;
    saveMeta(meta);
    return { applied: true, fileCount: restored };
}

function status() {
    const remote = getSyncRemote();
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
        const helper = ensureHelperRepo(remote);
        summary.helperReady = true;
        const hadRemote = fetchSyncBranch(helper);
        const localExists = git(helper, ['rev-parse', '--verify', SYNC_BRANCH], { allowFail: true }).ok;
        if (hadRemote && localExists) {
            const localOnly = git(helper, ['rev-list', `origin/${SYNC_BRANCH}..${SYNC_BRANCH}`], { allowFail: true });
            const remoteOnly = git(helper, ['rev-list', `${SYNC_BRANCH}..origin/${SYNC_BRANCH}`], { allowFail: true });
            summary.localOnlyCommits = localOnly.ok && localOnly.stdout ? localOnly.stdout.split('\n').length : 0;
            summary.remoteOnlyCommits = remoteOnly.ok && remoteOnly.stdout ? remoteOnly.stdout.split('\n').length : 0;
            summary.diverged = summary.localOnlyCommits > 0 && summary.remoteOnlyCommits > 0;
        } else if (hadRemote && !localExists) {
            const remoteCount = git(helper, ['rev-list', '--count', `origin/${SYNC_BRANCH}`], { allowFail: true });
            summary.remoteOnlyCommits = remoteCount.ok ? parseInt(remoteCount.stdout, 10) || 0 : 0;
        } else if (!hadRemote && localExists) {
            const localCount = git(helper, ['rev-list', '--count', SYNC_BRANCH], { allowFail: true });
            summary.localOnlyCommits = localCount.ok ? parseInt(localCount.stdout, 10) || 0 : 0;
        }
    } catch (_) {
        summary.helperReady = false;
    }
    return summary;
}

// ── CLI entry point ─────────────────────────────────────────────────────────

function printUsage() {
    console.log('Usage: aigon sync <command> [options]');
    console.log('');
    console.log('Commands:');
    console.log('  configure <git-url>   Configure remote and create .aigon/.syncignore');
    console.log('  push                  Commit current .aigon/ state and push to aigon-state branch');
    console.log('  pull                  Fetch + fast-forward merge aigon-state from configured remote');
    console.log('  status                Show last push/pull timestamps and divergence');
}

async function handleSyncCommand(args = []) {
    const sub = args[0];
    const rest = args.slice(1);

    if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
        printUsage();
        return;
    }

    if (sub === 'configure') {
        const result = configure(rest[0]);
        console.log(`✅ Sync configured`);
        console.log(`   Remote: ${result.remote}`);
        if (result.syncignoreCreated) {
            console.log(`   Created: .aigon/.syncignore (defaults)`);
        }
        return;
    }

    if (sub === 'push') {
        const result = push();
        if (!result.committed) {
            console.log('✅ Sync push: no changes to commit');
        } else {
            console.log(`✅ Sync push: ${result.fileCount} files committed`);
            console.log(`   ${result.message}`);
        }
        return;
    }

    if (sub === 'pull') {
        const result = pull();
        if (!result.applied) {
            console.log('✅ Sync pull: remote has no aigon-state branch yet');
        } else {
            console.log(`✅ Sync pull: ${result.fileCount} files restored`);
        }
        return;
    }

    if (sub === 'status') {
        const s = status();
        if (!s.configured) {
            console.log('Sync: not configured');
            console.log('Run: aigon sync configure <git-remote-url>');
            return;
        }
        console.log('Sync: configured');
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

    throw new Error(`Unknown sync command: ${sub}\nRun: aigon sync --help`);
}

/**
 * Read-path decoration: a feature is "suspended" on this machine when the
 * snapshot says it has a worktree but the worktree path is not present
 * locally. Two signals are honoured:
 *   1. snapshot.worktreePath set and missing on disk
 *   2. snapshot.mode is a worktree-using mode ('solo_worktree' / 'fleet') and
 *      no live local worktree was found (caller passes worktreeMap result)
 *
 * Nothing is written to the snapshot — this is read-side only so the synced
 * state stays clean across machines.
 *
 * @param {string} repoPath - workspace root.
 * @param {string|number} featureId - numeric feature id.
 * @param {{ hasLocalWorktree?: boolean }} [opts] - caller's local-worktree signal.
 * @returns {boolean}
 */
function isFeatureSuspended(repoPath, featureId, opts = {}) {
    if (!featureId) return false;
    const numericId = String(parseInt(String(featureId), 10) || featureId);
    const candidates = [
        path.join(repoPath, '.aigon', 'workflows', 'features', String(featureId), 'snapshot.json'),
        path.join(repoPath, '.aigon', 'workflows', 'features', numericId, 'snapshot.json'),
        path.join(repoPath, '.aigon', 'workflows', 'features', String(numericId).padStart(2, '0'), 'snapshot.json'),
    ];
    const snapshotPath = candidates.find(p => fs.existsSync(p));
    if (!snapshotPath) return false;
    let snap;
    try { snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')); } catch (_) { return false; }
    if (!snap || snap.lifecycle !== 'in-progress') return false;

    if (snap.worktreePath && typeof snap.worktreePath === 'string') {
        if (!fs.existsSync(snap.worktreePath)) return true;
    }
    if (Array.isArray(snap.sessions)) {
        const hasMissingSessionWorktree = snap.sessions.some(s => s && s.worktreePath && !fs.existsSync(s.worktreePath));
        if (hasMissingSessionWorktree) return true;
    }
    const mode = String(snap.mode || '').trim();
    if ((mode === 'solo_worktree' || mode === 'fleet') && opts.hasLocalWorktree === false) {
        return true;
    }
    return false;
}

module.exports = {
    SYNC_BRANCH,
    handleSyncCommand,
    configure,
    push,
    pull,
    status,
    ensureSyncIgnore,
    readSyncIgnorePatterns,
    makeSyncIgnoreMatcher,
    isFeatureSuspended,
};
