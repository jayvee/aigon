'use strict';

/**
 * `aigon schedule …` CLI verbs.
 *
 * The server-scheduled-kickoff engine (F367) and the `agent_prompt` action
 * (F379) moved to `@aigon/pro` (feature 236). This OSS file keeps a thin
 * delegating stub mirroring the `insights` pattern.
 */

function createScheduleCommands() {
    const { isProAvailable } = require('../pro');
    if (isProAvailable()) {
        try {
            const pro = require('@aigon/pro/commands/schedule');
            if (pro && typeof pro.createScheduleCommands === 'function') {
                return pro.createScheduleCommands();
            }
        } catch (_) { /* fall through to Pro-feature notice */ }
    }

    return {
        schedule: () => {
            console.error('🔒 Scheduled features (aigon schedule) is a Pro feature — coming later.');
            console.error('   Pro is in development and not yet available for purchase.');
            process.exitCode = 1;
        },
    };
}

module.exports = { createScheduleCommands };
