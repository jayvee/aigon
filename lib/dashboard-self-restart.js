'use strict';

const { spawn } = require('child_process');

/**
 * feature 234/652: detached self-restart after lib/*.js merge. Shared by the
 * /api/action handler and the poll-loop backstop so both paths broadcast SSE
 * and spawn identically.
 */
function scheduleDashboardSelfRestart(options = {}) {
    const {
        broadcast,
        log,
        warn,
        cliEntryPath,
        delayMs = 100,
        execPath = process.execPath,
        cwd = process.cwd(),
    } = options;

    if (typeof broadcast === 'function') {
        try {
            broadcast();
        } catch (e) {
            const msg = `server-restarting broadcast failed: ${e.message}`;
            if (typeof warn === 'function') warn(`⚠️  ${msg}`);
            else if (typeof log === 'function') log(msg);
        }
    }

    setTimeout(() => {
        try {
            const child = spawn(execPath, [cliEntryPath, 'server', 'restart'], {
                detached: true,
                stdio: 'ignore',
                cwd,
            });
            child.unref();
        } catch (e) {
            const msg = `Failed to spawn detached restart: ${e.message}. Run 'aigon server restart' manually.`;
            if (typeof warn === 'function') warn(`⚠️  ${msg}`);
            else if (typeof log === 'function') log(msg);
        }
        setTimeout(() => process.exit(0), 50);
    }, delayMs);
}

module.exports = {
    scheduleDashboardSelfRestart,
};
