'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync, spawnSync } = require('child_process');

const ENV_LOCAL_GITIGNORE_ENTRIES = ['.env.local', '.env*.local'];
const ENV_LOCAL_FILE_REGEX = /^\.env(?:\..+)?\.local$/;
const SECURITY_HOOKS_PATH = '.githooks';
const PRE_COMMIT_HOOK_NAME = 'pre-commit';
const PRE_COMMIT_HOOK_CONTENT = `#!/bin/sh
set -eu

STAGED_FILES="$(git diff --cached --name-only --diff-filter=ACMR || true)"
BLOCKED_FILES="$(printf '%s\\n' "$STAGED_FILES" | grep -E '(^|/)\\.env$|(^|/)\\.env(\\..+)?\\.local$' || true)"

if [ -n "$BLOCKED_FILES" ]; then
  echo "ERROR: Refusing to commit environment files that may contain secrets."
  echo "$BLOCKED_FILES"
  echo "Remove from commit with: git reset HEAD <file>"
  exit 1
fi

exit 0
`;

function quoteShellArg(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

// Wrap an aigon command in a login shell so hooks resolve the binary correctly
// regardless of the parent process PATH (e.g. macOS Dock launch).
const _userShell = process.env.SHELL || '/bin/bash';
function wrapAigonCommand(rawCmd) {
    const inner = rawCmd.replace(/"/g, '\\"');
    return `${_userShell} -l -c "${inner}"`;
}

function _isAlreadyWrapped(cmd) {
    return /^[^ ]+ -l -c "aigon /.test(cmd);
}

function _normalizeAigonCmd(cmd) {
    if (cmd.startsWith('aigon ') || cmd === 'aigon') return cmd;
    // Absolute path form: /path/to/aigon args → aigon args
    return cmd.replace(/^(?:\/[^\s]+\/aigon)(?= |$)/, 'aigon');
}

function migrateAigonHookCommand(cmd) {
    if (!cmd) return cmd;
    if (_isAlreadyWrapped(cmd)) return cmd;
    const isAigonCmd = cmd.startsWith('aigon ') || /^(?:\/[^\s]+\/aigon)/.test(cmd);
    if (!isAigonCmd) return cmd;
    return wrapAigonCommand(_normalizeAigonCmd(cmd));
}

/** Paths from `git status --porcelain` (v1) for explicit `git add` — avoids blanket `git add -A` (F307). */
function pathsFromGitStatusPorcelain(porcelain) {
    const out = new Set();
    // Do not trim the whole blob — leading space in column 1 is meaningful XY status padding.
    for (const line of (porcelain || '').split('\n')) {
        if (!line.trim()) continue;
        if (line.length < 4) continue;
        const body = line.slice(3);
        if (body.includes(' -> ')) {
            const [from, to] = body.split(' -> ');
            if (from) out.add(from.trim());
            if (to) out.add(to.trim());
        } else {
            out.add(body.trim());
        }
    }
    return [...out];
}

function gitAddPathsFromPorcelain(repoPath, porcelain) {
    const paths = pathsFromGitStatusPorcelain(porcelain);
    if (paths.length === 0) return false;
    execFileSync('git', ['add', '--', ...paths], { cwd: repoPath, stdio: 'pipe' });
    return true;
}

function readGitignoreContent(repoPath = process.cwd()) {
    const gitignorePath = path.join(repoPath, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
        return { gitignorePath, content: '', exists: false };
    }
    return { gitignorePath, content: fs.readFileSync(gitignorePath, 'utf8'), exists: true };
}

function hasGitignoreEntry(content, entry) {
    return content.split('\n').some(line => line.trim() === entry);
}

function getEnvLocalGitignoreStatus(repoPath = process.cwd()) {
    const { content } = readGitignoreContent(repoPath);
    const missingEntries = ENV_LOCAL_GITIGNORE_ENTRIES.filter(entry => !hasGitignoreEntry(content, entry));
    return {
        hasAllEntries: missingEntries.length === 0,
        missingEntries,
    };
}

function ensureEnvLocalGitignore(repoPath = process.cwd()) {
    const { gitignorePath, content, exists } = readGitignoreContent(repoPath);
    let updated = content;
    const addedEntries = [];

    for (const entry of ENV_LOCAL_GITIGNORE_ENTRIES) {
        if (hasGitignoreEntry(updated, entry)) continue;
        if (updated.length > 0 && !updated.endsWith('\n')) updated += '\n';
        updated += `${entry}\n`;
        addedEntries.push(entry);
    }

    if (!exists && updated.length === 0) {
        fs.writeFileSync(gitignorePath, ENV_LOCAL_GITIGNORE_ENTRIES.join('\n') + '\n');
        return { created: true, addedEntries: [...ENV_LOCAL_GITIGNORE_ENTRIES] };
    }
    if (addedEntries.length > 0 || !exists) {
        fs.writeFileSync(gitignorePath, updated);
    }

    return { created: !exists, addedEntries };
}

function ensureLocalGitExclude(repoPath, entries) {
    const excludePath = path.join(repoPath, '.git', 'info', 'exclude');
    const existing = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, 'utf8') : '';
    let updated = existing;
    const addedEntries = [];

    entries.forEach(entry => {
        const normalised = entry.replace(/\/+$/, '');
        const hasEntry = updated.split('\n').some(line => line.trim().replace(/\/+$/, '') === normalised);
        if (hasEntry) return;
        if (updated.length > 0 && !updated.endsWith('\n')) updated += '\n';
        updated += `${entry}\n`;
        addedEntries.push(entry);
    });

    if (addedEntries.length > 0) {
        fs.mkdirSync(path.dirname(excludePath), { recursive: true });
        fs.writeFileSync(excludePath, updated);
    }

    return { addedEntries, path: excludePath };
}

function getInstalledVersionAt(repoPath) {
    const versionPath = path.join(repoPath, '.aigon', 'version');
    if (!fs.existsSync(versionPath)) return null;
    return fs.readFileSync(versionPath, 'utf8').trim();
}

function getTrackedEnvLocalFiles(repoPath = process.cwd()) {
    try {
        const tracked = execSync('git ls-files', { cwd: repoPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        return tracked
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .filter(filePath => ENV_LOCAL_FILE_REGEX.test(path.basename(filePath)));
    } catch (e) {
        return [];
    }
}

function untrackFiles(repoPath, files) {
    if (!files || files.length === 0) return { ok: true };
    try {
        spawnSync('git', ['rm', '--cached', '--', ...files], { // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
            cwd: repoPath,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

function ensurePreCommitHook(repoPath = process.cwd()) {
    const hooksDir = path.join(repoPath, SECURITY_HOOKS_PATH);
    const hookPath = path.join(hooksDir, PRE_COMMIT_HOOK_NAME);
    const existed = fs.existsSync(hookPath);
    let updated = false;

    fs.mkdirSync(hooksDir, { recursive: true });
    const existingContent = existed ? fs.readFileSync(hookPath, 'utf8') : '';
    if (!existed || existingContent !== PRE_COMMIT_HOOK_CONTENT) {
        fs.writeFileSync(hookPath, PRE_COMMIT_HOOK_CONTENT, { mode: 0o755 });
        updated = true;
    }

    // Keep executable even if content is unchanged.
    try { fs.chmodSync(hookPath, 0o755); } catch (e) { /* ignore chmod failures */ }

    return { created: !existed, updated, path: hookPath };
}

function readHooksPath(repoPath = process.cwd()) {
    try {
        const value = execSync('git config --get core.hooksPath', {
            cwd: repoPath,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        return value || null;
    } catch (e) {
        return null;
    }
}

function isHooksPathConfigured(repoPath = process.cwd()) {
    const hooksPath = readHooksPath(repoPath);
    if (!hooksPath) return false;

    const normalized = hooksPath.replace(/\\/g, '/');
    if (normalized === SECURITY_HOOKS_PATH || normalized === `./${SECURITY_HOOKS_PATH}`) {
        return true;
    }

    const expected = path.resolve(repoPath, SECURITY_HOOKS_PATH).replace(/\\/g, '/');
    const resolved = path.resolve(repoPath, hooksPath).replace(/\\/g, '/');
    return expected === resolved;
}

function isInsideGitRepo(repoPath = process.cwd()) {
    try {
        execSync('git rev-parse --is-inside-work-tree', {
            cwd: repoPath,
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        return true;
    } catch (e) {
        return false;
    }
}

function ensureHooksPathConfigured(repoPath = process.cwd()) {
    if (!isInsideGitRepo(repoPath)) {
        return { ok: true, skipped: true };
    }
    try {
        execSync(`git config core.hooksPath ${JSON.stringify(SECURITY_HOOKS_PATH)}`, {
            cwd: repoPath,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { ok: true, value: SECURITY_HOOKS_PATH };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

module.exports = {
    ENV_LOCAL_GITIGNORE_ENTRIES,
    ENV_LOCAL_FILE_REGEX,
    SECURITY_HOOKS_PATH,
    PRE_COMMIT_HOOK_NAME,
    PRE_COMMIT_HOOK_CONTENT,
    quoteShellArg,
    wrapAigonCommand,
    _isAlreadyWrapped,
    _normalizeAigonCmd,
    migrateAigonHookCommand,
    readGitignoreContent,
    hasGitignoreEntry,
    getEnvLocalGitignoreStatus,
    ensureEnvLocalGitignore,
    ensureLocalGitExclude,
    getInstalledVersionAt,
    getTrackedEnvLocalFiles,
    untrackFiles,
    ensurePreCommitHook,
    readHooksPath,
    isHooksPathConfigured,
    isInsideGitRepo,
    ensureHooksPathConfigured,
    pathsFromGitStatusPorcelain,
    gitAddPathsFromPorcelain,
};
