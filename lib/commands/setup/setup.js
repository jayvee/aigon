'use strict';

const { runWizard } = require('../../onboarding/wizard');

module.exports = function setupCommand() {
    return async (args = []) => {
        await runWizard(args);
    };
};
