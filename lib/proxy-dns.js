'use strict';

// Leaf DNS/port helpers — no imports from config, instance-identity, or proxy.

const DASHBOARD_DYNAMIC_PORT_START = 4101;
const DASHBOARD_DYNAMIC_PORT_END = 4199;

/**
 * Sanitize a string for use as a DNS label.
 * @param {string} name
 * @returns {string}
 */
function sanitizeForDns(name) {
    return String(name || '')
        .toLowerCase()
        .replace(/^@[^/]+\//, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-');
}

/**
 * Build the Caddy hostname for a given app/server context.
 * @param {string} appId
 * @param {string|null} serverId
 * @returns {string}
 */
function buildCaddyHostname(appId, serverId) {
    if (serverId) return `${serverId}.${appId}.localhost`;
    return `${appId}.localhost`;
}

/**
 * Derive a dev-server serverId from a branch/directory name.
 * @param {string} name
 * @returns {string|null}
 */
function deriveServerIdFromBranch(name) {
    const m = name.match(/^feature-(\d+)-([a-z]+)-/);
    if (m) return `${m[2]}-${m[1]}`;
    return null;
}

/**
 * Hash a branch name to a port in the dynamic dashboard port range.
 * @param {string} branchName
 * @returns {number}
 */
function hashBranchToPort(branchName) {
    let hash = 0;
    for (let i = 0; i < branchName.length; i++) {
        hash = ((hash << 5) - hash + branchName.charCodeAt(i)) | 0;
    }
    const range = DASHBOARD_DYNAMIC_PORT_END - DASHBOARD_DYNAMIC_PORT_START + 1;
    return DASHBOARD_DYNAMIC_PORT_START + (Math.abs(hash) % range);
}

module.exports = {
    DASHBOARD_DYNAMIC_PORT_START,
    DASHBOARD_DYNAMIC_PORT_END,
    sanitizeForDns,
    buildCaddyHostname,
    deriveServerIdFromBranch,
    hashBranchToPort,
};
