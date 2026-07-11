'use strict';

const path = require('path');
const { execSync } = require('child_process');

/**
 * True when `targetPath` is tracked in git (mirrors lib/entity.js).
 */
function isGitTracked(repoPath, targetPath) {
    try {
        const relPath = path.relative(repoPath, targetPath);
        execSync(`git ls-files --error-unmatch -- ${JSON.stringify(relPath)}`, {
            cwd: repoPath,
            stdio: 'pipe',
        });
        return true;
    } catch (_) {
        return false;
    }
}

/**
 * Stage an explicit list of paths. Used for auto-commits that must not sweep
 * unrelated changes under a spec directory.
 */
function stagePaths(runGit, repoPath, paths) {
    const uniquePaths = [...new Set((paths || []).filter(Boolean))];
    if (uniquePaths.length === 0) return;
    const quoted = uniquePaths.map(p => JSON.stringify(path.relative(repoPath, p))).join(' ');
    // Use -A for explicit paths so moved/deleted sources (e.g. lifecycle spec
    // "fromPath") are staged without failing when the old path no longer exists.
    runGit(`git add -A -- ${quoted}`);
}

/**
 * True when at least one of `paths` has staged changes (index differs from
 * HEAD). `git diff --cached --quiet` exits 0 when there is nothing staged and 1
 * when there is — so a throw means "there are changes to commit".
 */
function hasStagedChanges(repoPath, paths) {
    const quoted = paths.map(p => JSON.stringify(path.relative(repoPath, p))).join(' ');
    try {
        execSync(`git diff --cached --quiet -- ${quoted}`, { cwd: repoPath, stdio: 'pipe' });
        return false;
    } catch (_) {
        return true;
    }
}

/**
 * Commit paths that are **already staged** (e.g. after `git rm`) without
 * re-running `git add`, which fails when the working-tree file is gone.
 *
 * Idempotent: when nothing is staged for `paths`, the desired end state (those
 * paths committed) is already true, so this is a no-op rather than a fatal
 * "nothing to commit" error. Spec lifecycle moves reach this path repeatedly —
 * a retried start, or the git-branch storage poller's reconcile committing the
 * move first — and treating "already committed" as failure aborted the whole
 * operation (start/reset), stranding features in `startup_failed`.
 */
function commitStagedPaths(runGit, repoPath, paths, message) {
    const uniquePaths = [...new Set((paths || []).filter(Boolean))];
    if (uniquePaths.length === 0) return;
    if (!hasStagedChanges(repoPath, uniquePaths)) return;
    const quoted = uniquePaths.map(p => JSON.stringify(path.relative(repoPath, p))).join(' ');
    runGit(`git commit -m ${JSON.stringify(message)} -- ${quoted}`);
}

/**
 * Stage paths then commit **only those paths**, leaving unrelated staged index
 * entries untouched (pairs with selective `stagePaths` staging).
 */
function stageAndCommitPaths(runGit, repoPath, paths, message) {
    stagePaths(runGit, repoPath, paths);
    commitStagedPaths(runGit, repoPath, paths, message);
}

/**
 * Stage and commit a spec lifecycle move (prioritise / start / close / reset).
 * Tracked sources include `fromPath` so the rename's source-deletion is recorded.
 * Never-tracked sources (e.g. feature-create without a manual commit) omit
 * `fromPath` — passing it to git commit would fatal with "pathspec did not match".
 */
function stageAndCommitSpecMove(runGit, repoPath, { fromPath, toPath, extraPaths = [], message }) {
    const paths = [];
    if (fromPath && isGitTracked(repoPath, fromPath)) {
        paths.push(fromPath);
    }
    if (toPath) paths.push(toPath);
    paths.push(...extraPaths);
    stageAndCommitPaths(runGit, repoPath, paths.filter(Boolean), message);
}

module.exports = { isGitTracked, stagePaths, commitStagedPaths, stageAndCommitPaths, stageAndCommitSpecMove };
