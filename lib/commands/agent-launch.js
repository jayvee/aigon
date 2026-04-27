'use strict';

/**
 * `aigon agent-launch` — internal CLI subcommand used by the scheduler's
 * `agent_prompt` kind (F379). Moved to `@aigon/pro` with feature 236.
 *
 * OSS keeps a delegating stub so a Pro install can dispatch to the moved
 * implementation. Without Pro, the verb prints a Pro-feature notice.
 */

function createAgentLaunchCommands() {
    const { isProAvailable } = require('../pro');
    if (isProAvailable()) {
        try {
            const pro = require('@aigon/pro/commands/agent-launch');
            if (pro && typeof pro.createAgentLaunchCommands === 'function') {
                return pro.createAgentLaunchCommands();
            }
        } catch (_) { /* fall through */ }
    }

    return {
        'agent-launch': () => {
            console.error('🔒 agent-launch is a Pro feature — coming later.');
            console.error('   Pro is in development and not yet available for purchase.');
            process.exitCode = 1;
        },
    };
}

module.exports = { createAgentLaunchCommands };
