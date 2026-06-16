'use strict';

module.exports = function uninstallCommand() {
    return () => {
        console.error('Unknown command: uninstall. Did you mean: aigon remove?');
        console.error('  (aigon remove deletes Aigon-managed files from this repo.)');
        console.error('  (npm uninstall -g @senlabsai/aigon uninstalls the CLI globally.)');
        process.exit(1);
    };
};
