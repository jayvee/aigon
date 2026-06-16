'use strict';

module.exports = function updateCommand(_ctx, commands) {
    return async (args = []) => {
        process.stderr.write('⚠ "aigon update" is deprecated, use "aigon apply" — this alias will be removed in a future release.\n');
        return commands['apply'](args.filter(a => a !== '--pull'));
    };
};
