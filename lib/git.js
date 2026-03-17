'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

/**
 * Run a git command with stdio: inherit (for side-effecting commands like commit/checkout).
 * Logs the command before running. Re-throws on failure.
 * @param {string} command - Full git command (e.g. 'git checkout main')
 * @param {object} [options] - Additional execSync options
 */
function run(command, options = {}) {
    console.log(`Running git: ${command}`);
    try {
        execSync(command, { stdio: 'inherit', ...options });
    } catch (e) {
        console.error('❌ Git command failed.');
        throw e;
    }
}

/**
 * Get porcelain git status, filtering out .env files.
 * .env files contain pulled secrets and must never block workflows.
 * This is the SINGLE place where .env filtering lives.
 * @param {string} [cwd] - Optional working directory (for worktree status)
 * @returns {string} Filtered porcelain status, or '' if clean/error
 */
function getStatus(cwd) {
    try {
        const cmd = cwd
            ? `git -C "${cwd}" status --porcelain`
            : 'git status --porcelain';
        const raw = execSync(cmd, { encoding: 'utf8' }).trim();
        if (!raw) return '';
        return raw.split('\n').filter(line => !line.match(/\.env(\.\w+)?$/)).join('\n').trim();
    } catch (e) {
        return '';
    }
}

/**
 * Get raw porcelain git status for specific paths (no .env filtering).
 * Used for checking whether agent/config files have changed (e.g. install-agent).
 * @param {string} [paths] - Space-separated paths to check (e.g. 'docs/ AGENTS.md')
 * @param {object} [opts] - Additional execSync options
 * @returns {string} Raw porcelain status, or '' if clean/error
 */
function getStatusRaw(paths, opts) {
    try {
        const pathStr = paths ? ` ${paths}` : '';
        return execSync(`git status --porcelain${pathStr} 2>/dev/null`, { encoding: 'utf8', ...opts }).trim();
    } catch (e) {
        return '';
    }
}

/**
 * Get current branch name.
 * @param {string} [cwd] - Optional working directory
 * @returns {string} Branch name, or '' if not in a repo or detached HEAD
 */
function getCurrentBranch(cwd) {
    try {
        const cmd = cwd
            ? `git -C "${cwd}" branch --show-current`
            : 'git branch --show-current';
        return execSync(cmd, { encoding: 'utf8' }).trim();
    } catch (e) {
        return '';
    }
}

/**
 * Get current HEAD commit SHA.
 * @returns {string|null} Commit SHA, or null if not in a repo or no commits
 */
function getCurrentHead() {
    try {
        return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    } catch (e) {
        return null;
    }
}

/**
 * Detect the default branch (main or master) by checking the remote HEAD,
 * then verifying the branch exists locally.
 * @returns {string} 'main' or 'master' (or whatever the remote default is)
 */
function getDefaultBranch() {
    let defaultBranch;
    try {
        defaultBranch = execSync(
            'git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || echo refs/heads/main',
            { encoding: 'utf8' }
        ).trim()
            .replace('refs/remotes/origin/', '')
            .replace('refs/heads/', '');
    } catch (e) {
        defaultBranch = 'main';
    }
    try {
        execSync(`git rev-parse --verify ${defaultBranch}`, { encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
        defaultBranch = 'master';
    }
    return defaultBranch;
}

/**
 * Check whether a branch exists locally.
 * @param {string} branchName
 * @returns {boolean}
 */
function branchExists(branchName) {
    try {
        execSync(`git rev-parse --verify ${branchName}`, { encoding: 'utf8', stdio: 'pipe' });
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * List all branches (local).
 * @returns {string[]} Array of branch names (current branch marker stripped)
 */
function listBranches() {
    try {
        const output = execSync('git branch --list', { encoding: 'utf8' });
        return output.split('\n').map(b => b.trim().replace(/^[*+]\s+/, '')).filter(Boolean);
    } catch (e) {
        return [];
    }
}

/**
 * Get the git common directory path.
 * Returns an absolute path when inside a worktree, or a relative '.git' in the main repo.
 * @returns {string|null}
 */
function getCommonDir() {
    try {
        return execSync('git rev-parse --git-common-dir', { stdio: 'pipe' }).toString().trim();
    } catch (e) {
        return null;
    }
}

/**
 * List all worktree paths (excludes the current working directory).
 * Returns raw path strings for callers that need to apply their own filtering.
 * @returns {string[]} Array of absolute worktree paths
 */
function listWorktreePaths() {
    const paths = [];
    try {
        const wtOutput = execSync('git worktree list', { encoding: 'utf8' });
        wtOutput.split('\n').forEach(line => {
            const wtMatch = line.match(/^([^\s]+)\s+/);
            if (!wtMatch) return;
            const wtPath = wtMatch[1];
            if (wtPath === process.cwd()) return;
            paths.push(wtPath);
        });
    } catch (e) {
        // Not in a git repo or no worktrees
    }
    return paths;
}

/**
 * List all feature worktrees (excludes the main/current worktree).
 * Equivalent to the old findWorktrees() in utils.js.
 * @returns {Array<{path: string, featureId: string, agent: string, desc: string, mtime: Date}>}
 */
function listWorktrees() {
    const worktrees = [];
    try {
        const wtOutput = execSync('git worktree list', { encoding: 'utf8' });
        wtOutput.split('\n').forEach(line => {
            const wtMatch = line.match(/^([^\s]+)\s+/);
            if (!wtMatch) return;
            const wtPath = wtMatch[1];
            if (wtPath === process.cwd()) return;

            const featureMatch = path.basename(wtPath).match(/^feature-(\d+)-(\w+)-(.+)$/);
            if (featureMatch) {
                worktrees.push({
                    path: wtPath,
                    featureId: featureMatch[1],
                    agent: featureMatch[2],
                    desc: featureMatch[3],
                    mtime: fs.existsSync(wtPath) ? fs.statSync(wtPath).mtime : new Date(0)
                });
            }
        });
    } catch (e) {
        // Not in a git repo or no worktrees
    }
    return worktrees;
}

/**
 * Filter worktrees by feature ID, handling padded/unpadded comparison.
 * Equivalent to the old filterByFeatureId() in utils.js.
 * @param {Array} worktrees - Result from listWorktrees()
 * @param {string|number} featureId
 * @returns {Array}
 */
function filterWorktreesByFeature(worktrees, featureId) {
    const paddedId = String(featureId).padStart(2, '0');
    const unpaddedId = String(parseInt(featureId, 10));
    return worktrees.filter(wt =>
        wt.featureId === paddedId || wt.featureId === unpaddedId
    );
}

/**
 * Get files changed between two commits.
 * @param {string} fromSha
 * @param {string} toSha
 * @returns {string[]}
 */
function getChangedFiles(fromSha, toSha) {
    if (!fromSha || !toSha || fromSha === toSha) return [];
    try {
        const output = execSync(`git diff --name-only ${fromSha}..${toSha}`, { encoding: 'utf8' }).trim();
        if (!output) return [];
        return output.split('\n').map(line => line.trim()).filter(Boolean);
    } catch (e) {
        return [];
    }
}

/**
 * Get commit summaries (short hash + subject) between two commits.
 * @param {string} fromSha
 * @param {string} toSha
 * @returns {string[]}
 */
function getCommitSummaries(fromSha, toSha) {
    if (!fromSha || !toSha || fromSha === toSha) return [];
    try {
        const output = execSync(`git log --format=%h\\ %s --reverse ${fromSha}..${toSha}`, { encoding: 'utf8' }).trim();
        if (!output) return [];
        return output.split('\n').map(line => line.trim()).filter(Boolean);
    } catch (e) {
        return [];
    }
}

/**
 * Get a diff for context (recent committed changes, or staged changes as fallback).
 * Tries HEAD~1..HEAD first, then --cached, then returns ''.
 * @param {number} [maxLength] - Truncate at this many characters (default 5000)
 * @returns {string}
 */
function getRecentDiff(maxLength) {
    const limit = maxLength || 5000;
    try {
        const out = execSync(
            'git diff HEAD~1 HEAD 2>/dev/null || git diff --cached 2>/dev/null || echo ""',
            { encoding: 'utf8', timeout: 10000 }
        );
        return out.slice(0, limit);
    } catch (e) {
        return '';
    }
}

/**
 * Commit all dirty files with a given message, if there are any uncommitted changes.
 * Generic version of the old ensureRalphCommit() from validation.js.
 * @param {string} message - Commit message
 * @returns {{ ok: boolean, committed: boolean, autoCommitted: boolean, message: string }}
 */
function ensureCommit(message) {
    const statusBefore = getStatus();
    if (!statusBefore) {
        return {
            ok: true,
            committed: false,
            autoCommitted: false,
            message: 'No uncommitted changes.'
        };
    }

    const addResult = spawnSync('git', ['add', '-A'], { stdio: 'inherit' });
    if (addResult.error || addResult.status !== 0) {
        return {
            ok: false,
            committed: false,
            autoCommitted: false,
            message: addResult.error ? addResult.error.message : `git add failed with status ${addResult.status}`
        };
    }

    const commitResult = spawnSync('git', ['commit', '-m', message], { stdio: 'inherit' });
    if (commitResult.error) {
        return {
            ok: false,
            committed: false,
            autoCommitted: false,
            message: commitResult.error.message
        };
    }
    if (commitResult.status !== 0) {
        const remaining = getStatus();
        if (!remaining) {
            return {
                ok: true,
                committed: false,
                autoCommitted: false,
                message: 'No additional commit needed.'
            };
        }
        return {
            ok: false,
            committed: false,
            autoCommitted: false,
            message: `git commit failed with status ${commitResult.status}`
        };
    }

    return {
        ok: true,
        committed: true,
        autoCommitted: true,
        message: `Auto-committed: ${message}`
    };
}

module.exports = {
    getRecentDiff,
    listWorktreePaths,
    run,
    getStatus,
    getStatusRaw,
    getCurrentBranch,
    getCurrentHead,
    getDefaultBranch,
    branchExists,
    listBranches,
    getCommonDir,
    listWorktrees,
    filterWorktreesByFeature,
    getChangedFiles,
    getCommitSummaries,
    ensureCommit,
};
