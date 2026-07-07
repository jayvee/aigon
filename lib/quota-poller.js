'use strict';

/** @deprecated F616 — use lib/agent-quota-poller.js */
const poller = require('./agent-quota-poller');

function startQuotaPoller(opts = {}) {
    return poller.startAgentQuotaPoller(opts);
}

module.exports = {
    startQuotaPoller,
    triggerRefresh: poller.triggerRefresh,
    pollOnce: (opts) => poller.runTick(opts),
    MIN_REFRESH_GAP_MS: poller.MIN_REFRESH_GAP_MS,
    STARTUP_DELAY_MS: 0,
};
