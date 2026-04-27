'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function expandHomePath(filePath) {
    if (!filePath) return filePath;
    if (filePath === '~') return os.homedir();
    if (filePath.startsWith('~/')) return path.join(os.homedir(), filePath.slice(2));
    return filePath;
}

function listExistingAigonWorktrees(repoPath) {
    const repoName = path.basename(path.resolve(repoPath));
    const worktreeBase = path.join(os.homedir(), '.aigon', 'worktrees', repoName);
    if (!fs.existsSync(worktreeBase)) return [];
    return fs.readdirSync(worktreeBase, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(worktreeBase, entry.name))
        .filter(worktreePath => fs.existsSync(path.join(worktreePath, '.git')));
}

module.exports = {
    expandHomePath,
    listExistingAigonWorktrees,
};
