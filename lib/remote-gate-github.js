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
 * Query normalized GitHub PR status for a branch.
 *
 * @param {string} branchName
 * @param {string} defaultBranch
 * @param {object} [options]
 * @param {function} [options.execFn] - override for execSync (testing)
 * @param {string} [options.cwd] - optional working directory for git/gh calls
 * @returns {{ provider: ('github'|null), status: 'none'|'open'|'draft'|'merged'|'unavailable', prNumber?: number, url?: string, message: string, code?: string, state?: string }}
 */
function queryGitHubPrStatus(branchName, defaultBranch, options = {}) {
    const baseExec = options.execFn || execSync;
    const exec = (command, execOptions = {}) => {
        const mergedOptions = options.cwd
            ? { ...execOptions, cwd: options.cwd }
            : execOptions;
        return baseExec(command, mergedOptions);
    };

    const originUrl = getOriginUrl(exec);
    if (!isGitHubRemote(originUrl)) {
        return {
            provider: null,
            status: 'unavailable',
            message: 'Not a GitHub remote',
        };
    }

    try {
        exec('gh --version', { stdio: 'pipe', encoding: 'utf8' });
    } catch {
        return {
            provider: 'github',
            status: 'unavailable',
            code: 'gh_missing',
            message: 'gh is not installed',
        };
    }

    try {
        exec('gh auth status', { stdio: 'pipe', encoding: 'utf8' });
    } catch {
        return {
            provider: 'github',
            status: 'unavailable',
            code: 'gh_auth_failed',
            message: 'gh auth status failed',
        };
    }

    let prs;
    try {
        const fields = 'number,url,state,isDraft,baseRefName,headRefName,mergeStateStatus,mergedAt';
        prs = queryPrList(exec, `gh pr list --head "${branchName}" --json ${fields} --limit 20`);
        if (prs.length === 0) {
            prs = queryPrList(exec, `gh pr list --head "${branchName}" --state merged --json ${fields} --limit 5`);
        }
    } catch (e) {
        return {
            provider: 'github',
            status: 'unavailable',
            code: 'query_failed',
            message: `Failed to query GitHub PRs: ${e.message || 'unknown error'}`,
        };
    }

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

    if (openPrs.length > 1) {
        return {
            provider: 'github',
            status: 'unavailable',
            code: 'ambiguous_pr',
            message: `Multiple active PRs found for branch "${branchName}" against "${defaultBranch}": ` +
                openPrs.map(pr => `#${pr.number}`).join(', ') +
                '. Close duplicates so exactly one PR remains.',
        };
    }

    if (openPrs.length === 1) {
        const pr = openPrs[0];
        const mergeState = pr.mergeStateStatus || 'UNKNOWN';
        if (pr.isDraft) {
            return {
                provider: 'github',
                status: 'draft',
                code: 'pr_open',
                prNumber: pr.number,
                url: pr.url,
                state: 'open',
                message: `PR #${pr.number} is still open (draft). Merge or close the PR on GitHub before running feature-close.`,
            };
        }
        return {
            provider: 'github',
            status: 'open',
            code: 'pr_open',
            prNumber: pr.number,
            url: pr.url,
            state: 'open',
            message: `PR #${pr.number} is still open (mergeStateStatus: ${mergeState}). Merge or close the PR on GitHub before running feature-close.`,
        };
    }

    if (mergedPrs.length > 0) {
        const pr = mergedPrs[0];
        return {
            provider: 'github',
            status: 'merged',
            prNumber: pr.number,
            url: pr.url,
            state: 'merged',
            message: `Merged PR #${pr.number}`,
        };
    }

    return {
        provider: 'github',
        status: 'none',
        message: `No PR found for branch "${branchName}" targeting "${defaultBranch}"`,
    };
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
    const prStatus = queryGitHubPrStatus(branchName, defaultBranch, options);
    if (!prStatus.provider) {
        return { ok: true, mode: 'local' };
    }
    if (prStatus.status === 'none') return { ok: true, provider: 'github', mode: 'local' };
    if (prStatus.status === 'merged') {
        return {
            ok: true,
            provider: 'github',
            mode: 'merged',
            prNumber: prStatus.prNumber,
            url: prStatus.url,
            state: 'merged',
        };
    }
    if (prStatus.status === 'open' || prStatus.status === 'draft') {
        return {
            ok: false,
            provider: 'github',
            code: 'pr_open',
            prNumber: prStatus.prNumber,
            url: prStatus.url,
            state: 'open',
            message: prStatus.message,
        };
    }
    if (prStatus.status === 'unavailable') {
        if (prStatus.code === 'query_failed' || prStatus.code === 'ambiguous_pr') {
            return {
                ok: false,
                provider: 'github',
                code: prStatus.code,
                message: prStatus.message,
            };
        }
        return { ok: true, provider: 'github', mode: 'local' };
    }
    return { ok: true, provider: 'github', mode: 'local' };
}

module.exports = { checkGitHubGate, queryGitHubPrStatus, queryPrList, getOriginUrl, isGitHubRemote };
