'use strict';

/**
 * F380 — shared engine for git-backed state sync.
 *
 * Both `lib/sync-state.js` (project `.aigon/`) and `lib/profile-state.js`
 * (user `~/.aigon/`) follow the same pattern: a hidden helper repo, a
 * dedicated branch, push/pull to a configured remote, syncignore filter.
 * This module hosts the reusable helpers.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function nowIso() {
    return new Date().toISOString();
}

function loadJson(p) {
    if (!fs.existsSync(p)) return {};
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return {}; }
}

function saveJson(p, obj) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function ensureSyncIgnoreAt(absPath, defaultContent) {
    if (fs.existsSync(absPath)) return false;
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, defaultContent, 'utf8');
    return true;
}

function readSyncIgnorePatterns(absPath) {
    if (!fs.existsSync(absPath)) return [];
    return fs.readFileSync(absPath, 'utf8')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));
}

function patternToRegex(pattern) {
    let pat = pattern.replace(/\\/g, '/');
    const trailingSlash = pat.endsWith('/');
    if (trailingSlash) pat = pat.slice(0, -1);
    const escaped = pat
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '[^/]*');
    return new RegExp(`^${escaped}(/|$)`);
}

function makeSyncIgnoreMatcher(patterns) {
    const regexes = patterns.map(patternToRegex);
    return function isIgnored(relPath) {
        const norm = relPath.replace(/\\/g, '/');
        for (const re of regexes) {
            if (re.test(norm)) return true;
            const parts = norm.split('/');
            for (let i = 0; i < parts.length; i++) {
                if (re.test(parts.slice(i).join('/'))) return true;
            }
        }
        return false;
    };
}

function listFilesUnder(rootDir, prefix = '') {
    const out = [];
    const abs = path.join(rootDir, prefix);
    if (!fs.existsSync(abs)) return out;
    const entries = fs.readdirSync(abs, { withFileTypes: true });
    for (const ent of entries) {
        const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
        if (ent.isDirectory()) {
            out.push(...listFilesUnder(rootDir, rel));
        } else if (ent.isFile()) {
            out.push(rel);
        }
    }
    return out;
}

function git(cwd, args, { input, allowFail = false } = {}) {
    const result = spawnSync('git', args, {
        cwd,
        encoding: 'utf8',
        input,
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (!allowFail && (result.error || result.status !== 0)) {
        const stderr = (result.stderr || '').trim();
        const message = result.error ? result.error.message : `git ${args.join(' ')} failed (${result.status}): ${stderr}`;
        const e = new Error(message);
        e.stderr = stderr;
        e.code = result.status;
        throw e;
    }
    return {
        ok: !result.error && result.status === 0,
        stdout: (result.stdout || '').trim(),
        stderr: (result.stderr || '').trim(),
        status: result.status,
    };
}

function ensureHelperRepoAt(helperPath, remoteUrl) {
    fs.mkdirSync(helperPath, { recursive: true });
    if (!fs.existsSync(path.join(helperPath, '.git'))) {
        git(helperPath, ['init', '--quiet']);
        git(helperPath, ['config', 'user.email', 'aigon-sync@local']);
        git(helperPath, ['config', 'user.name', 'aigon-sync']);
    }
    if (remoteUrl) {
        const current = git(helperPath, ['remote', 'get-url', 'origin'], { allowFail: true });
        if (!current.ok) {
            git(helperPath, ['remote', 'add', 'origin', remoteUrl]);
        } else if (current.stdout !== remoteUrl) {
            git(helperPath, ['remote', 'set-url', 'origin', remoteUrl]);
        }
    }
    return helperPath;
}

function fetchBranch(helperPath, branch) {
    const r = git(helperPath, ['fetch', 'origin', branch], { allowFail: true });
    return r.ok;
}

/**
 * @param {string} helperPath
 * @param {string} branch
 * @param {object} opts
 * @param {boolean} opts.hadRemote
 * @param {boolean} [opts.clearWorkingTree=true]
 */
function checkoutBranch(helperPath, branch, { hadRemote, clearWorkingTree = true }) {
    const localBranchExists = git(helperPath, ['rev-parse', '--verify', branch], { allowFail: true }).ok;
    const remoteRef = git(helperPath, ['rev-parse', '--verify', `origin/${branch}`], { allowFail: true });

    if (hadRemote && remoteRef.ok) {
        if (localBranchExists) {
            git(helperPath, ['checkout', '--quiet', branch]);
            git(helperPath, ['reset', '--hard', `origin/${branch}`]);
        } else {
            git(helperPath, ['checkout', '--quiet', '-B', branch, `origin/${branch}`]);
        }
    } else if (localBranchExists) {
        git(helperPath, ['checkout', '--quiet', branch]);
    } else {
        git(helperPath, ['checkout', '--quiet', '--orphan', branch]);
        const r = git(helperPath, ['rm', '-rf', '--cached', '.'], { allowFail: true });
        void r;
    }
    if (clearWorkingTree) {
        for (const ent of fs.readdirSync(helperPath)) {
            if (ent === '.git') continue;
            fs.rmSync(path.join(helperPath, ent), { recursive: true, force: true });
        }
    }
}

module.exports = {
    nowIso,
    loadJson,
    saveJson,
    ensureSyncIgnoreAt,
    readSyncIgnorePatterns,
    patternToRegex,
    makeSyncIgnoreMatcher,
    listFilesUnder,
    git,
    ensureHelperRepoAt,
    fetchBranch,
    checkoutBranch,
};
