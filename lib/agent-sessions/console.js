'use strict';

// Console snapshot / operator-delivery DTOs for agent sessions (F554).
//
// A SessionHost captures a host-native view of the live console (for tmux, a
// `capture-pane` dump). These helpers normalize that into a stable shape that
// dashboard routes and CLI commands can consume without knowing the host.

const DEFAULT_SNAPSHOT_LINES = 200;

/**
 * @typedef {Object} ConsoleSnapshot
 * @property {string} sessionName  Aigon session name / id.
 * @property {boolean} alive        Whether the host session is currently running.
 * @property {string[]} lines       Trailing console lines (most recent last).
 * @property {string} text          Raw joined text of `lines`.
 * @property {string=} uptime       Optional human-readable uptime.
 * @property {string=} lastActivity Optional human-readable last-activity.
 * @property {string=} capturedAt   ISO timestamp of capture.
 */

/**
 * Build a normalized console snapshot DTO.
 * @param {Object} input
 * @returns {ConsoleSnapshot}
 */
function createConsoleSnapshot(input = {}) {
    const sessionName = input.sessionName != null ? String(input.sessionName) : '';
    const alive = input.alive === true;
    let lines = Array.isArray(input.lines)
        ? input.lines.map((line) => String(line))
        : (input.text != null ? String(input.text).split('\n') : []);
    const limit = Number.isFinite(input.maxLines) && input.maxLines > 0
        ? Math.floor(input.maxLines)
        : null;
    if (limit && lines.length > limit) {
        lines = lines.slice(-limit);
    }
    const snapshot = {
        sessionName,
        alive,
        lines,
        text: input.text != null ? String(input.text) : lines.join('\n'),
    };
    if (input.uptime !== undefined) snapshot.uptime = input.uptime;
    if (input.lastActivity !== undefined) snapshot.lastActivity = input.lastActivity;
    if (input.capturedAt !== undefined) snapshot.capturedAt = input.capturedAt;
    return snapshot;
}

/**
 * Snapshot DTO for a session that is not running.
 * @param {string} sessionName
 * @returns {ConsoleSnapshot}
 */
function createDeadConsoleSnapshot(sessionName = '') {
    return {
        sessionName: sessionName != null ? String(sessionName) : '',
        alive: false,
        lines: [],
        text: '',
    };
}

/**
 * @typedef {Object} OperatorMessageResult
 * @property {boolean} ok           Whether delivery + submit completed.
 * @property {string} sessionName   Target session.
 * @property {string=} paneTail      Trailing console text after delivery.
 * @property {string=} error         Error message when ok=false.
 */

/**
 * Build a normalized operator-message delivery result DTO.
 * @param {Object} input
 * @returns {OperatorMessageResult}
 */
function createOperatorMessageResult(input = {}) {
    const result = {
        ok: input.ok === true,
        sessionName: input.sessionName != null ? String(input.sessionName) : '',
    };
    if (input.paneTail !== undefined) result.paneTail = input.paneTail;
    if (input.error !== undefined) result.error = input.error;
    return result;
}

module.exports = {
    DEFAULT_SNAPSHOT_LINES,
    createConsoleSnapshot,
    createDeadConsoleSnapshot,
    createOperatorMessageResult,
};
