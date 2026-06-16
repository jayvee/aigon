'use strict';

const { runPrerequisiteChecks, printPrerequisiteResults } = require('../../prerequisite-checks');

module.exports = function checkPrerequisitesCommand() {
    return async (args = []) => {
        const verboseFlag = args.includes('--verbose') || args.includes('-v');
        const jsonFlag = args.includes('--json');

        const results = await runPrerequisiteChecks();

        if (jsonFlag) {
            console.log(JSON.stringify(results, null, 2));
            if (!results.passed) process.exit(1);
            return;
        }

        console.log('\nPrerequisite Check\n──────────────────');
        printPrerequisiteResults(results, { verbose: verboseFlag || results.errors.length > 0 || results.warnings.length > 0 });

        if (results.errors.length === 0 && results.warnings.length === 0) {
            console.log('  ✅ All prerequisites satisfied.');
        } else if (results.errors.length === 0) {
            console.log(`\n  ✅ Core prerequisites OK — ${results.warnings.length} optional item(s) to review above.`);
        } else {
            console.error(`\n  ❌ ${results.errors.length} hard prerequisite(s) failed. Aigon will not function correctly until resolved.`);
        }

        if (!results.passed) process.exit(1);
    };
};
