'use strict';

const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// remote-gate-github.js — GitHub PR gate check for feature-close
//
// v1 policy: an open, non-draft PR in a mergeable state passes the gate.
// Accepted mergeStateStatus values: CLEAN, HAS_HOOKS, UNSTABLE.
// BLOCKED, BEHIND, DIRTY, DRAFT, UNKNOWN all fail.
//
// The gate is fail-closed: if gh is missing, auth fails, or the query errors,
// feature-close stops before any side-effects.
// ---------------------------------------------------------------------------

const ACCEPTED_MERGE_STATES = new Set(['CLEAN', 'HAS_HOOKS', 'UNSTABLE']);

/**
 * Check whether the GitHub PR gate allows feature-close to proceed.
 *
 * @param {string} branchName - the feature branch name
 * @param {string} defaultBranch - the local default branch (e.g. 'main')
 * @param {object} [options]
 * @param {function} [options.execFn] - override for execSync (testing)
 * @returns {{ ok: boolean, provider: string, code?: string, message?: string, state?: string, prNumber?: number, url?: string }}
 */
function checkGitHubGate(branchName, defaultBranch, options = {}) {
    const exec = options.execFn || execSync;

    // 1. Verify gh is available
    try {
        exec('gh --version', { stdio: 'pipe', encoding: 'utf8' });
    } catch {
        return {
            ok: false,
            provider: 'github',
            code: 'gh_missing',
            message: '`gh` CLI is not installed. Install it from https://cli.github.com/ and run `gh auth login`.',
        };
    }

    // 2. Verify gh is authenticated for this repo
    try {
        exec('gh auth status', { stdio: 'pipe', encoding: 'utf8' });
    } catch {
        return {
            ok: false,
            provider: 'github',
            code: 'gh_auth',
            message: '`gh` is not authenticated. Run `gh auth login` first.',
        };
    }

    // 3. Query PRs for this branch
    let prs;
    try {
        const fields = 'number,url,state,isDraft,baseRefName,headRefName,mergeStateStatus,mergedAt';
        const raw = exec(
            `gh pr list --head "${branchName}" --json ${fields} --limit 20`,
            { encoding: 'utf8', stdio: 'pipe' },
        );
        prs = JSON.parse(raw);
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

    // 5. Narrow to active candidates (open or merged)
    const active = candidates.filter(pr => pr.state === 'OPEN' || pr.state === 'MERGED');

    if (active.length === 0) {
        // Check if there are closed-but-unmerged PRs
        const closedUnmerged = candidates.filter(pr => pr.state === 'CLOSED');
        if (closedUnmerged.length > 0) {
            return {
                ok: false,
                provider: 'github',
                code: 'closed_unmerged',
                prNumber: closedUnmerged[0].number,
                url: closedUnmerged[0].url,
                message: `PR #${closedUnmerged[0].number} is closed without being merged. Reopen or create a new PR, then re-run feature-close.`,
            };
        }
        return {
            ok: false,
            provider: 'github',
            code: 'no_pr',
            message: `No PR found for branch "${branchName}" against "${defaultBranch}".\n` +
                `   Run \`aigon feature-push <ID>\` to publish the branch, create a PR on GitHub, then re-run feature-close.`,
        };
    }

    if (active.length > 1) {
        return {
            ok: false,
            provider: 'github',
            code: 'ambiguous_pr',
            message: `Multiple active PRs found for branch "${branchName}" against "${defaultBranch}": ` +
                active.map(pr => `#${pr.number}`).join(', ') +
                `. Close duplicates so exactly one PR remains.`,
        };
    }

    // 6. Exactly one active candidate
    const pr = active[0];

    // 6a. Merged remotely — unsupported in v1
    if (pr.state === 'MERGED') {
        return {
            ok: false,
            provider: 'github',
            code: 'remote_merged_unsupported',
            prNumber: pr.number,
            url: pr.url,
            state: 'merged',
            message: `PR #${pr.number} has already been merged remotely. This v1 gate does not support remote-merged PRs.\n` +
                `   Sync your local branch state manually (e.g. git pull), then clean up with feature-cleanup or feature-reset.`,
        };
    }

    // 6b. Draft PR
    if (pr.isDraft) {
        return {
            ok: false,
            provider: 'github',
            code: 'draft',
            prNumber: pr.number,
            url: pr.url,
            state: 'open',
            message: `PR #${pr.number} is still a draft. Mark it as ready for review on GitHub, then re-run feature-close.`,
        };
    }

    // 6c. Check mergeStateStatus
    const mergeState = pr.mergeStateStatus || 'UNKNOWN';
    if (!ACCEPTED_MERGE_STATES.has(mergeState)) {
        return {
            ok: false,
            provider: 'github',
            code: 'not_mergeable',
            prNumber: pr.number,
            url: pr.url,
            state: 'open',
            message: `PR #${pr.number} is not in a mergeable state (mergeStateStatus: ${mergeState}).\n` +
                `   Resolve any blockers on GitHub, then re-run feature-close.`,
        };
    }

    // 7. Gate passes
    return {
        ok: true,
        provider: 'github',
        prNumber: pr.number,
        url: pr.url,
        state: 'open',
    };
}

module.exports = { checkGitHubGate, ACCEPTED_MERGE_STATES };
