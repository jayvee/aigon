'use strict';

const { execSync } = require('child_process');

/**
 * Paths touched by commits on `branchName` since it diverged from `baseBranch`.
 * Used to flag stray files in close auto-commit (files never part of the feature's work).
 *
 * @param {string} repoPath
 * @param {string} branchName
 * @param {string} baseBranch
 * @returns {Set<string>}
 */
function listFeatureBranchTouchedPaths(repoPath, branchName, baseBranch) {
    try {
        const out = execSync(
            `git -C ${JSON.stringify(repoPath)} log --name-only --pretty=format: ${baseBranch}..${branchName}`,
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
        );
        const paths = new Set();
        for (const line of String(out || '').split('\n')) {
            const trimmed = line.trim();
            if (trimmed) paths.add(trimmed);
        }
        return paths;
    } catch (_) {
        return new Set();
    }
}

/**
 * Classify pending close-commit paths as feature-related or stray.
 *
 * @param {Set<string>|string[]} featureTouchedPaths - paths modified on the feature branch
 * @param {string[]} pendingPaths - uncommitted paths about to be staged
 * @returns {{ related: string[], stray: string[] }}
 */
function classifyPendingCommitFiles(featureTouchedPaths, pendingPaths) {
    const touched = featureTouchedPaths instanceof Set
        ? featureTouchedPaths
        : new Set(featureTouchedPaths || []);
    const related = [];
    const stray = [];
    for (const file of pendingPaths || []) {
        if (!file) continue;
        if (touched.has(file)) {
            related.push(file);
        } else {
            stray.push(file);
        }
    }
    return { related, stray };
}

/**
 * Print the file list about to be committed and loudly flag strays.
 *
 * @param {{ related: string[], stray: string[] }} classification
 * @param {string} [label] - e.g. branch or worktree path for context
 */
function printCloseCommitFileWarnings(classification, label) {
    const { related, stray } = classification;
    const all = [...related, ...stray];
    if (all.length === 0) return;

    const context = label ? ` (${label})` : '';
    console.log(`\n📋 Files to include in close auto-commit${context}:`);
    related.forEach((f) => console.log(`   ${f}`));
    if (stray.length > 0) {
        console.warn('');
        console.warn(`⚠️  stray, not part of this feature's changes (${stray.length}):`);
        stray.forEach((f) => console.warn(`⚠️     ${f}`));
        console.warn('⚠️  These files were never modified on the feature branch — review before merging.');
        console.warn('');
    }
}

module.exports = {
    listFeatureBranchTouchedPaths,
    classifyPendingCommitFiles,
    printCloseCommitFileWarnings,
};
