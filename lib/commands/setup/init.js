'use strict';

module.exports = function initCommand(_ctx, getCommand) {
    return async (args) => {
        process.stderr.write('⚠ "aigon init" is deprecated, use "aigon apply" — this alias will be removed in a future release.\n');
        return getCommand('apply')(args);
    };
};
