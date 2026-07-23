#!/usr/bin/env node
// check-template-leaks.js — fail if user-facing templates or agent placeholders
// reference aigon-internal paths or target-repo stack assumptions.
//
// Rendered install output is checked by scripts/check-rendered-template-leaks.js
// during prepublish; this source scan remains part of every test:core run.

'use strict';

const path = require('path');
const { collectTemplateSourceFiles, runStaticScan, formatFinding, ROOT } = require('../lib/template-leak-scan');

function main() {
    const { sourceFindings, placeholderFindings, allFindings } = runStaticScan();
    const sourceFiles = collectTemplateSourceFiles();
    const { SCAN_DIRS } = require('../lib/template-leak-scan');

    if (allFindings.length === 0) {
        console.log(`✓ check-template-leaks: scanned ${sourceFiles.length} files under templates/{${SCAN_DIRS.join(',')}}/ and agent placeholders — no leaks`);
        process.exit(0);
    }

    console.error(`✗ check-template-leaks: found ${allFindings.length} leak(s).\n`);
    if (sourceFindings.length) {
        console.error('Source template leaks — rewrite to user-repo concepts only, or suppress with `aigon-internal-ok` on the same line if truly intentional.\n');
    }
    if (placeholderFindings.length) {
        console.error('Agent placeholder leaks — use stack-neutral wording in templates/agents/*.json placeholders.\n');
    }
    for (const f of allFindings) {
        console.error(formatFinding(f, ROOT));
        console.error('');
    }
    process.exit(1);
}

if (require.main === module) {
    main();
}
