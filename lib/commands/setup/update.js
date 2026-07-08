'use strict';

module.exports = function updateCommand(_ctx, getCommand) {
    return async (args = []) => {
        process.stderr.write('⚠ "aigon update" is deprecated, use "aigon apply" — this alias will be removed in a future release.\n');
        return getCommand('apply')(args.filter(a => a !== '--pull'));
    };
};
