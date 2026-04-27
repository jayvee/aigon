'use strict';

/**
 * `aigon recurring …` CLI verbs.
 *
 * The recurring-features engine moved to `@aigon/pro` (feature 236, replacing
 * F320). The OSS package keeps thin verb stubs that delegate to Pro when
 * available, mirroring the `insights` pattern at `lib/commands/misc.js`.
 *
 * When Pro is not installed, the stubs print a Pro-feature notice on stderr
 * and exit non-zero. When Pro is installed, the Pro implementation takes over
 * and the verbs behave identically to the pre-move OSS behaviour.
 */

function createRecurringCommands() {
    const { isProAvailable } = require('../pro');
    if (isProAvailable()) {
        try {
            const pro = require('@aigon/pro/commands/recurring');
            if (pro && typeof pro.createRecurringCommands === 'function') {
                return pro.createRecurringCommands();
            }
        } catch (_) { /* fall through to Pro-feature notice */ }
    }

    function notice(verb) {
        return () => {
            console.error(`🔒 Recurring features (aigon ${verb}) is a Pro feature — coming later.`);
            console.error('   Pro is in development and not yet available for purchase.');
            process.exitCode = 1;
        };
    }

    return {
        'recurring-run': notice('recurring-run'),
        'recurring-list': notice('recurring-list'),
    };
}

module.exports = { createRecurringCommands };
