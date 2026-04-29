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
    runGit(`git add -- ${quoted}`);
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

module.exports = { stagePaths, stageAndCommitPaths };
