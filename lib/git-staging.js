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
 * Stage paths then commit **only those paths**, leaving unrelated staged index
 * entries untouched (pairs with selective `stagePaths` staging).
 */
function stageAndCommitPaths(runGit, repoPath, paths, message) {
    stagePaths(runGit, repoPath, paths);
    const uniquePaths = [...new Set((paths || []).filter(Boolean))];
    if (uniquePaths.length === 0) return;
    const quoted = uniquePaths.map(p => JSON.stringify(path.relative(repoPath, p))).join(' ');
    runGit(`git commit -m ${JSON.stringify(message)} -- ${quoted}`);
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

module.exports = { isGitTracked, stagePaths, stageAndCommitPaths, stageAndCommitSpecMove };
