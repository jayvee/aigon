'use strict';

/**
 * Aigon Action Scope Model
 *
 * Replaces scattered branch-gate checks with a declarative scope system.
 * Every CLI command and dashboard action declares its execution scope:
 *
 *   - 'main-only'     — must run from the default branch (main/master)
 *   - 'feature-local'  — must run in the correct feature's worktree
 *   - 'any'            — safe to run from any directory/branch
 *
 * The single gatekeeper `assertActionAllowed()` enforces the scope and
 * returns delegation instructions when a main-only action is triggered
 * from a worktree (instead of refusing).
 */

const path = require('path');
const { execSync, execFileSync } = require('child_process');

// ---------------------------------------------------------------------------
// Scope definitions — every command declares where it can run
// ---------------------------------------------------------------------------

const ACTION_SCOPES = {
    // Mutate shared state — merge, move specs, close features
    'feature-create':      { scope: 'main-only' },
    'feature-prioritise':   { scope: 'main-only' },
    'feature-unprioritise': { scope: 'main-only' },
    'feature-now':         { scope: 'main-only' },
    'feature-start':       { scope: 'main-only' },
    'feature-eval':        { scope: 'main-only' },
    'feature-close':       { scope: 'main-only' },
    'feature-cleanup':     { scope: 'main-only' },

    // Research equivalents
    'research-create':     { scope: 'main-only' },
    'research-prioritise': { scope: 'main-only' },
    'research-start':      { scope: 'main-only' },
    'research-close':      { scope: 'main-only' },
    'research-eval':       { scope: 'main-only' },

    // Only affect the current feature's worktree
    'feature-do':          { scope: 'feature-local' },
    'feature-push':        { scope: 'feature-local' },
    'feature-code-review': { scope: 'feature-local' },
    'feature-rebase':      { scope: 'feature-local' },
    'feature-review':      { scope: 'feature-local' },
    'research-do':         { scope: 'feature-local' },
    'research-submit':     { scope: 'feature-local' },

    // Read-only or display — safe anywhere
    'board':               { scope: 'any' },
    'dashboard':           { scope: 'any' },
    'metrics':             { scope: 'any' },
    'doctor':              { scope: 'any' },
    'config':              { scope: 'any' },
    'help':                { scope: 'any' },
    'version':             { scope: 'any' },
    'agent-status':        { scope: 'any' },
    'project-context':     { scope: 'any' },
    'check-version':       { scope: 'any' },

    // Feedback — safe anywhere (reads/writes local files)
    'feedback-create':     { scope: 'any' },
    'feedback-list':       { scope: 'any' },
    'feedback-triage':     { scope: 'any' },

    // Dev tools
    'dev-server':          { scope: 'any' },
    'install-agent':       { scope: 'any' },
    'seed-reset':          { scope: 'any' },
};

// ---------------------------------------------------------------------------
// Context detection — where are we running?
// ---------------------------------------------------------------------------

/**
 * Build the action context from the current working directory and git state.
 * @param {Object} git - Git module (lib/git.js) for branch/worktree detection
 * @returns {Object} Action context
 */
function buildActionContext(git) {
    const branch = git.getCurrentBranch();
    const defaultBranch = git.getDefaultBranch();
    const isDefaultBranch = branch === defaultBranch;

    // Detect worktree via git common dir — if it's an absolute path, we're in a worktree
    const commonDir = git.getCommonDir();
    const isWorktree = commonDir && path.isAbsolute(commonDir);
    const mainRepoPath = isWorktree ? path.dirname(commonDir) : process.cwd();

    // Parse feature ID from branch name (e.g. feature-150-cc-description)
    const featureMatch = branch.match(/^feature-(\d+)/);
    const featureId = featureMatch ? featureMatch[1] : null;

    return {
        branch,
        defaultBranch,
        isDefaultBranch,
        isWorktree,
        mainRepoPath,
        featureId,
    };
}

// ---------------------------------------------------------------------------
// Gatekeeper — single check that replaces all scattered branch guards
// ---------------------------------------------------------------------------

/**
 * Check whether an action is allowed in the current context.
 *
 * Returns:
 *   - undefined           — action is allowed, proceed normally
 *   - { delegate: path }  — action should be delegated to the main repo
 *
 * Throws:
 *   - Error if the action cannot be run and cannot be delegated
 *
 * @param {string} action - Command name (e.g. 'feature-close')
 * @param {Object} context - Result of buildActionContext()
 * @param {Object} [options] - Optional: { featureId } for feature-local validation
 * @returns {undefined|{delegate: string}}
 */
function assertActionAllowed(action, context, options = {}) {
    const def = ACTION_SCOPES[action] || { scope: 'main-only' }; // safe default

    if (def.scope === 'any') return undefined;

    if (def.scope === 'main-only') {
        if (context.isDefaultBranch) return undefined;

        // If we know the main repo path and we're in a worktree, delegate
        if (context.isWorktree && context.mainRepoPath) {
            return { delegate: context.mainRepoPath };
        }

        // Drive mode runs from the main repo on the feature branch. Allow
        // feature-close there when the current branch matches the target feature.
        if (action === 'feature-close' && !context.isWorktree && context.featureId && options.featureId) {
            const targetUnpadded = String(parseInt(options.featureId, 10));
            const contextUnpadded = String(parseInt(context.featureId, 10));
            if (targetUnpadded === contextUnpadded) {
                return undefined;
            }
        }

        // Not on default branch and not in a worktree — might be on a stale review branch.
        // Auto-checkout default branch instead of failing.
        try {
            const { execSync } = require('child_process');
            execSync(`git checkout ${context.defaultBranch}`, { stdio: 'pipe' });
            context.branch = context.defaultBranch;
        } catch (_) {
            throw new Error(
                `Must be on '${context.defaultBranch}' branch to run '${action}'. Currently on: '${context.branch}'.\n` +
                `   Run: git checkout ${context.defaultBranch}`
            );
        }
    }

    if (def.scope === 'feature-local') {
        // feature-local commands are allowed anywhere — the scope check is advisory.
        // If a target featureId is provided, validate we're in the right worktree.
        const targetFeatureId = options.featureId;
        if (targetFeatureId && context.featureId) {
            const targetUnpadded = String(parseInt(targetFeatureId, 10));
            const contextUnpadded = String(parseInt(context.featureId, 10));
            if (targetUnpadded !== contextUnpadded) {
                throw new Error(
                    `Action '${action}' targets feature ${targetFeatureId} but you're in feature ${context.featureId}'s worktree.\n` +
                    `   Switch to the correct worktree or the main repo.`
                );
            }
        }
        return undefined;
    }

    return undefined;
}

/**
 * Run an Aigon command in the target repo using the installed CLI on PATH.
 * Delegated repos are normal user projects and do not contain aigon-cli.js.
 *
 * @param {string} repoPath
 * @param {string} action
 * @param {Array<string>} args
 */
function runDelegatedAigonCommand(repoPath, action, args = []) {
    execFileSync('aigon', [action, ...args.map(arg => String(arg))], {
        cwd: repoPath,
        stdio: 'inherit',
    });
}

/**
 * Get the scope definition for an action.
 * @param {string} action
 * @returns {{ scope: string }}
 */
function getActionScope(action) {
    return ACTION_SCOPES[action] || { scope: 'main-only' };
}

module.exports = {
    ACTION_SCOPES,
    buildActionContext,
    assertActionAllowed,
    getActionScope,
    runDelegatedAigonCommand,
};
