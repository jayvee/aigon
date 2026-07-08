'use strict';

const PROBE_TTLS_MS = {
    caddyRoutes: 120 * 1000,
    devServer: 60 * 1000,
    gitRemote: 300 * 1000,
    defaultBranch: 300 * 1000,
    scheduleIndex: 60 * 1000,
    storageStatus: 60 * 1000,
};

const DRIVE_BRANCH_LIVE_STATUSES = new Set([
    'implementing', 'waiting', 'reviewing', 'addressing-code-review',
    'feedback-addressed', 'awaiting-input',
]);

const COMPLETION_SIGNAL_BY_TASK_TYPE = {
    'do': 'implementation-complete',
    'revise': 'revision-complete',
    'review': 'review-complete',
    'spec-review': 'spec-review-complete',
    'spec-revise': 'spec-review-complete',
    'spec-check': 'spec-review-complete',
};

/** F405: statuses where tmux is up but the agent is not in a completion/idle UI state */
const NON_WORKING_AGENT_STATUSES = new Set([
    'implementation-complete', 'revision-complete', 'research-complete',
    'review-complete', 'spec-review-complete', 'waiting', 'quota-paused',
    'ready', 'feedback-addressed',
]);

const AGENT_LOG_MAX_BYTES = 256 * 1024;

module.exports = {
    PROBE_TTLS_MS,
    DRIVE_BRANCH_LIVE_STATUSES,
    COMPLETION_SIGNAL_BY_TASK_TYPE,
    NON_WORKING_AGENT_STATUSES,
    AGENT_LOG_MAX_BYTES,
};
