'use strict';

const path = require('path');

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
 * Includes both `fromPath` (so the rename's source-deletion is recorded) and
 * `toPath` (the destination). Without `fromPath`, the source file lingers in
 * git history forever — the cause of accumulating duplicate spec copies across
 * lifecycle folders.
 */
function stageAndCommitSpecMove(runGit, repoPath, { fromPath, toPath, extraPaths = [], message }) {
    const paths = [fromPath, toPath, ...extraPaths].filter(Boolean);
    stageAndCommitPaths(runGit, repoPath, paths, message);
}

module.exports = { stagePaths, stageAndCommitPaths, stageAndCommitSpecMove };
