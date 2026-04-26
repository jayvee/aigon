#!/usr/bin/env node
'use strict';

// Iterate-loop validation entry point — runs the scoped (fast) validation set.
// Wall-time target: <30s for typical lib/-only diffs.
// Used by: lib/validation.js getProfileValidationCommands() for node profiles.
//          May also be invoked directly: `node scripts/iterate-validate.js`.

const { runScopedValidation, summariseResult } = require('../lib/test-loop/scoped');

(async () => {
    const result = await runScopedValidation();
    console.log(summariseResult(result));
    process.exit(result.ok ? 0 : 1);
})();
