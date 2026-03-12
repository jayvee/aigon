'use strict';

const utils = require('./utils');

module.exports = {
    parseHooksFile: utils.parseHooksFile,
    getDefinedHooks: utils.getDefinedHooks,
    executeHook: utils.executeHook,
    runPreHook: utils.runPreHook,
    runPostHook: utils.runPostHook,
};
