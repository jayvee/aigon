'use strict';

const { runTmux } = require('./worktree');

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_SUBMIT_DELAY_MS = 100;
const DEFAULT_GUARD_TIMEOUT_MS = 2000;

function sleepMs(ms) {
    if (!(ms > 0)) return;
    const end = Date.now() + ms;
    while (Date.now() < end) { /* busy-wait — matches lib/nudge.js sleepMs */ }
}

function isTimeoutResult(result) {
    if (!result) return false;
    return result.signal === 'SIGTERM' || result.signal === 'SIGKILL';
}

function makeTimeoutError(sessionName, phase, timeoutMs) {
    const err = new Error(
        `tmux ${phase} hung against session "${sessionName}" (timeout ${timeoutMs}ms). `
        + 'Pane may be unresponsive (e.g. stuck in copy-mode or backpressured).'
    );
    err.code = 'TMUX_INJECT_TIMEOUT';
    err.sessionName = sessionName;
    err.phase = phase;
    return err;
}

/**
 * Inject literal text into a tmux pane and (optionally) submit it.
 *
 * Defensively exits copy-mode/view-mode first via `send-keys -X cancel`. Without
 * that guard, `tmux send-keys -l` blocks indefinitely when the target pane has
 * been put into copy-mode (commonly by mouse-wheel scroll). All callers across
 * the codebase used to inline that bug — keep new call sites going through here.
 *
 * @param {string} sessionName - tmux session/pane target
 * @param {string} text - literal text to send
 * @param {object} [options]
 * @param {string|null} [options.submitKey='Enter'] - key to send after the literal text; pass null to skip submit
 * @param {number} [options.submitDelayMs=100] - pause between literal text and submit key
 * @param {number} [options.timeoutMs=5000] - per-call tmux timeout for the literal write
 * @param {object} [options.deps] - { runTmux } injection point for tests
 * @returns {{ ok: true, sessionName: string }}
 * @throws {Error} with code 'TMUX_INJECT_TIMEOUT' if any tmux call hangs
 */
function injectLiteral(sessionName, text, options = {}) {
    if (!sessionName || typeof sessionName !== 'string') {
        throw new Error('injectLiteral: sessionName is required');
    }
    if (typeof text !== 'string') {
        throw new Error('injectLiteral: text must be a string');
    }

    const submitKey = Object.prototype.hasOwnProperty.call(options, 'submitKey')
        ? options.submitKey
        : 'Enter';
    const submitDelayMs = Number.isFinite(options.submitDelayMs)
        ? options.submitDelayMs
        : DEFAULT_SUBMIT_DELAY_MS;
    const timeoutMs = Number.isFinite(options.timeoutMs)
        ? options.timeoutMs
        : DEFAULT_TIMEOUT_MS;
    const deps = options.deps || {};
    const tmuxFn = typeof deps.runTmux === 'function' ? deps.runTmux : runTmux;

    // Guard: exit any active mode (copy/view) so send-keys -l can deliver.
    // tmux silently no-ops `-X cancel` when the pane is not in a mode.
    tmuxFn(
        ['send-keys', '-t', sessionName, '-X', 'cancel'],
        { stdio: 'ignore', timeout: DEFAULT_GUARD_TIMEOUT_MS }
    );

    const literalRes = tmuxFn(
        ['send-keys', '-t', sessionName, '-l', text],
        { stdio: 'ignore', timeout: timeoutMs }
    );
    if (isTimeoutResult(literalRes)) {
        throw makeTimeoutError(sessionName, 'send-keys -l', timeoutMs);
    }

    if (submitKey) {
        sleepMs(submitDelayMs);
        const submitRes = tmuxFn(
            ['send-keys', '-t', sessionName, submitKey],
            { stdio: 'ignore', timeout: DEFAULT_GUARD_TIMEOUT_MS }
        );
        if (isTimeoutResult(submitRes)) {
            throw makeTimeoutError(sessionName, `send-keys ${submitKey}`, DEFAULT_GUARD_TIMEOUT_MS);
        }
    }

    return { ok: true, sessionName };
}

module.exports = {
    injectLiteral,
    DEFAULT_TIMEOUT_MS,
    DEFAULT_SUBMIT_DELAY_MS,
};
