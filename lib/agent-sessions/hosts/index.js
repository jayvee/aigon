'use strict';

// Small SessionHost registry (F554).
//
// Today there is exactly one host implementation (tmux). The registry exists so
// callers (AgentSessionService, worktree compatibility facade) resolve a host by
// kind rather than importing the tmux module directly, leaving room for a future
// host swap without touching call sites.

const { createTmuxSessionHost } = require('./tmux');

const DEFAULT_HOST_KIND = 'tmux';

const FACTORIES = Object.freeze({
    tmux: createTmuxSessionHost,
});

let defaultHostSingleton = null;

/**
 * Resolve a SessionHost by kind. Returns a fresh host instance.
 * @param {string} [kind]
 * @param {Object} [deps]
 */
function createHost(kind = DEFAULT_HOST_KIND, deps = {}) {
    const factory = FACTORIES[kind];
    if (!factory) {
        throw new Error(`Unknown SessionHost kind: ${kind}`);
    }
    return factory(deps);
}

/**
 * Get the process-wide default tmux host (lazily constructed, memoized).
 */
function getDefaultHost() {
    if (!defaultHostSingleton) {
        defaultHostSingleton = createTmuxSessionHost();
    }
    return defaultHostSingleton;
}

module.exports = {
    DEFAULT_HOST_KIND,
    createHost,
    createTmuxSessionHost,
    getDefaultHost,
};
