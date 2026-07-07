'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DASHBOARD_DEFAULT_PORT = 4100;

function realpathSafe(p) {
    try {
        return fs.realpathSync(p);
    } catch (_) {
        return path.resolve(p);
    }
}

/**
 * Realpath-resolved directory containing the executing aigon-cli.js.
 * @param {string} [cliEntryPath]
 * @returns {string}
 */
function resolveAigonCodeRoot(cliEntryPath) {
    const entry = cliEntryPath || path.join(__dirname, '..', 'aigon-cli.js');
    return realpathSafe(path.dirname(entry));
}

function resolveWorktreesBase() {
    return path.join(os.homedir(), '.aigon', 'worktrees');
}

/**
 * True when `p` lives under ~/.aigon/worktrees/.
 * @param {string} p
 * @returns {boolean}
 */
function isWorktreePath(p) {
    const abs = realpathSafe(p);
    const base = realpathSafe(resolveWorktreesBase());
    return abs === base || abs.startsWith(base + path.sep);
}

/**
 * Ephemeral instances use a temp or overridden AIGON_HOME (e2e, fixtures).
 * @param {string} [aigonHome]
 * @returns {boolean}
 */
function isEphemeralProfile(aigonHome) {
    if (process.env.AIGON_E2E_SERVER === '1') return true;
    const home = aigonHome || process.env.AIGON_HOME || os.homedir();
    const realHome = realpathSafe(home);
    const defaultHome = realpathSafe(os.homedir());
    if (realHome !== defaultHome) return true;
    const tmpBase = realpathSafe(os.tmpdir());
    return realHome.startsWith(tmpBase + path.sep);
}

function pathsEqual(a, b) {
    return realpathSafe(a) === realpathSafe(b);
}

/**
 * Registered main aigon checkout — first global-repo entry with aigon-cli.js
 * that is not itself a worktree path.
 * @returns {string|null}
 */
function resolveRegisteredMainCheckout() {
    const { readConductorReposFromGlobalConfig } = require('./config');
    const repos = readConductorReposFromGlobalConfig();
    for (const repo of repos) {
        const abs = path.resolve(String(repo));
        if (!fs.existsSync(path.join(abs, 'aigon-cli.js'))) continue;
        if (isWorktreePath(abs)) continue;
        return realpathSafe(abs);
    }
    return null;
}

function deriveInstanceId(codeRoot, profileHome, isPrimary) {
    if (isPrimary) return 'main';
    const { deriveServerIdFromBranch, sanitizeForDns } = require('./proxy');
    if (isWorktreePath(codeRoot)) {
        const base = path.basename(codeRoot);
        return deriveServerIdFromBranch(base) || sanitizeForDns(base);
    }
    if (isEphemeralProfile(profileHome)) {
        if (process.env.PORT) return `e2e-${process.env.PORT}`;
        return sanitizeForDns(`ephemeral-${path.basename(profileHome)}`);
    }
    return sanitizeForDns(path.basename(codeRoot));
}

/**
 * Single resolver for dashboard instance identity (port, Caddy host, registry slot).
 * Code root of aigon-cli.js is the axis — cwd is only used for mixed-invocation guard.
 *
 * @param {{ forcePrimary?: boolean, cwd?: string, codeRoot?: string }} [options]
 * @returns {{
 *   codeRoot: string,
 *   profileHome: string,
 *   port: number,
 *   caddyHost: string,
 *   caddyServerId: string|null,
 *   isPrimary: boolean,
 *   primaryEligible: boolean,
 *   isMixedInvocation: boolean,
 *   instanceId: string,
 *   isEphemeral: boolean,
 *   isWorktreeCode: boolean,
 *   isWorktreeCwd: boolean,
 *   canWritePrimaryCaddyRoute: boolean,
 * }}
 */
function resolveInstanceIdentity(options = {}) {
    const { getAigonHome } = require('./global-config-migration');
    const { hashBranchToPort, buildCaddyHostname } = require('./proxy');
    const forcePrimary = options.forcePrimary === true;
    const cwd = options.cwd || process.cwd();
    const codeRoot = options.codeRoot
        ? realpathSafe(options.codeRoot)
        : resolveAigonCodeRoot(options.cliEntryPath);
    const profileHome = getAigonHome();
    const isWorktreeCode = isWorktreePath(codeRoot);
    const isEphemeral = isEphemeralProfile(profileHome);
    const isWorktreeCwd = isWorktreePath(cwd);
    const mainCheckout = resolveRegisteredMainCheckout();

    let primaryEligible = !isWorktreeCode && !isEphemeral;
    if (primaryEligible && mainCheckout) {
        primaryEligible = pathsEqual(codeRoot, mainCheckout);
    }

    const isMixedInvocation = primaryEligible && isWorktreeCwd && !forcePrimary;
    let isPrimary = primaryEligible && !isWorktreeCwd;
    if (forcePrimary && primaryEligible) isPrimary = true;

    const instanceId = deriveInstanceId(codeRoot, profileHome, isPrimary);
    const port = isPrimary ? DASHBOARD_DEFAULT_PORT : hashBranchToPort(instanceId);
    const caddyServerId = isPrimary ? null : instanceId;
    const caddyHost = buildCaddyHostname('aigon', caddyServerId);

    return {
        codeRoot,
        profileHome,
        port,
        caddyHost,
        caddyServerId,
        isPrimary,
        primaryEligible,
        isMixedInvocation,
        instanceId,
        isEphemeral,
        isWorktreeCode,
        isWorktreeCwd,
        canWritePrimaryCaddyRoute: isPrimary,
    };
}

function formatMixedInvocationHint(subcommand) {
    return [
        `❌ Refusing to ${subcommand} the primary dashboard from a worktree directory.`,
        '   Primary dashboard commands must run from the main checkout (or pass --primary explicitly).',
        '   For an isolated preview in this worktree, use: aigon preview <id>  (coming in feature 601)',
    ].join('\n');
}

module.exports = {
    DASHBOARD_DEFAULT_PORT,
    resolveAigonCodeRoot,
    resolveWorktreesBase,
    isWorktreePath,
    isEphemeralProfile,
    resolveRegisteredMainCheckout,
    resolveInstanceIdentity,
    formatMixedInvocationHint,
};
