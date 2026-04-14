'use strict';

const { execSync } = require('child_process');

function queryPrList(exec, command) {
    return JSON.parse(exec(command, { encoding: 'utf8', stdio: 'pipe' }) || '[]');
}

function getOriginUrl(exec) {
    try {
        return exec('git remote get-url origin', { encoding: 'utf8', stdio: 'pipe' }).trim();
    } catch (_) {
        return '';
    }
}

function isGitHubRemote(originUrl) {
    return /github\.com[:/]/i.test(String(originUrl || ''));
}

/**
 * Resolve GitHub PR state for feature-close.
 *
 * @param {string} branchName - the feature branch name
 * @param {string} defaultBranch - the local default branch (e.g. 'main')
 * @param {object} [options]
 * @param {function} [options.execFn] - override for execSync (testing)
 * @returns {{ ok: boolean, provider?: string, mode?: string, code?: string, message?: string, state?: string, prNumber?: number, url?: string }}
 */
function checkGitHubGate(branchName, defaultBranch, options = {}) {
    const exec = options.execFn || execSync;

    const originUrl = getOriginUrl(exec);
    if (!isGitHubRemote(originUrl)) {
        return { ok: true, mode: 'local' };
    }

    // 1. Verify gh is available. If not, degrade to local close.
    try {
        exec('gh --version', { stdio: 'pipe', encoding: 'utf8' });
    } catch {
        return { ok: true, mode: 'local' };
    }

    // 2. Verify gh is authenticated. If not, degrade to local close.
    try {
        exec('gh auth status', { stdio: 'pipe', encoding: 'utf8' });
    } catch {
        return { ok: true, mode: 'local' };
    }

    // 3. Query PRs for this branch
    let prs;
    try {
        const fields = 'number,url,state,isDraft,baseRefName,headRefName,mergeStateStatus,mergedAt';
        prs = queryPrList(exec, `gh pr list --head "${branchName}" --json ${fields} --limit 20`);
        if (prs.length === 0) {
            const mergedPrs = queryPrList(exec, `gh pr list --state merged --json ${fields} --limit 50`);
            prs = mergedPrs.filter(pr => pr.headRefName === branchName);
        }
    } catch (e) {
        return {
            ok: false,
            provider: 'github',
            code: 'query_failed',
            message: `Failed to query GitHub PRs: ${e.message || 'unknown error'}`,
        };
    }

    // 4. Filter to PRs targeting the default branch
    const candidates = prs.filter(pr => pr.baseRefName === defaultBranch);

    const openPrs = candidates.filter(pr => pr.state === 'OPEN');
    const mergedPrs = candidates
        .filter(pr => pr.state === 'MERGED')
        .sort((a, b) => {
            const aTime = Date.parse(a.mergedAt || '') || 0;
            const bTime = Date.parse(b.mergedAt || '') || 0;
            if (bTime !== aTime) return bTime - aTime;
            return (b.number || 0) - (a.number || 0);
        });

    if (openPrs.length === 0 && mergedPrs.length === 0) {
        return { ok: true, provider: 'github', mode: 'local' };
    }

    if (openPrs.length > 1) {
        return {
            ok: false,
            provider: 'github',
            code: 'ambiguous_pr',
            message: `Multiple active PRs found for branch "${branchName}" against "${defaultBranch}": ` +
                openPrs.map(pr => `#${pr.number}`).join(', ') +
                `. Close duplicates so exactly one PR remains.`,
        };
    }

    if (openPrs.length === 1) {
        const pr = openPrs[0];

        // Any open PR blocks local close. If a PR exists, GitHub owns the
        // integration path; close may continue only after it is merged or closed.
        if (pr.isDraft) {
            return {
                ok: false,
                provider: 'github',
                code: 'pr_open',
                prNumber: pr.number,
                url: pr.url,
                state: 'open',
                message: `PR #${pr.number} is still open (draft). Merge or close the PR on GitHub before running feature-close.`,
            };
        }

        const mergeState = pr.mergeStateStatus || 'UNKNOWN';
        return {
            ok: false,
            provider: 'github',
            code: 'pr_open',
            prNumber: pr.number,
            url: pr.url,
            state: 'open',
            message: `PR #${pr.number} is still open (mergeStateStatus: ${mergeState}). Merge or close the PR on GitHub before running feature-close.`,
        };
    }

    const pr = mergedPrs[0];
    return {
        ok: true,
        provider: 'github',
        mode: 'merged',
        prNumber: pr.number,
        url: pr.url,
        state: 'merged',
    };
}

module.exports = { checkGitHubGate, queryPrList, getOriginUrl, isGitHubRemote };
