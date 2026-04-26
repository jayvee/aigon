'use strict';

const assert = require('assert');
const { renderPattern } = require('../../lib/recurring');

// REGRESSION: createAndPrioritiseFromTemplate must apply renderPattern to the instance body
// so report paths and commit messages are not left as literal {{YYYY-WW}} (F371 weekly-agent-matrix-benchmark).
assert.strictEqual(
    renderPattern('docs/reports/agent-matrix-benchmark-{{YYYY-WW}}.md', '2026-17'),
    'docs/reports/agent-matrix-benchmark-2026-17.md',
);
assert.strictEqual(
    renderPattern('chore: agent-matrix benchmark {{YYYY-WW}}', '2026-17'),
    'chore: agent-matrix benchmark 2026-17',
);

console.log('recurring-instance-body-week-placeholder ok');
