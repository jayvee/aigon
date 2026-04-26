'use strict';

const assert = require('assert');
const path = require('path');
const { renderPattern, renderTemplateString, getISOQuarter, scanTemplates } = require('../../lib/recurring');

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

// REGRESSION: quarterly-agent-matrix-qualitative-refresh must scan (schedule quarterly + {{YYYY-Q}} name_pattern).
assert.strictEqual(getISOQuarter(new Date(Date.UTC(2026, 3, 26))), '2026-Q2');
const recurringDir = path.join(__dirname, '../../docs/specs/recurring');
const scanned = scanTemplates(recurringDir);
assert.ok(
    scanned.some(t => t.recurringSlug === 'quarterly-agent-matrix-qualitative-refresh' && t.schedule === 'quarterly'),
    'quarterly qualitative refresh template must be accepted by scanTemplates',
);
assert.strictEqual(
    renderTemplateString('.aigon/matrix-refresh/{{YYYY-MM-DD}}/x-{{YYYY-Q}}.md', {
        isoWeek: '2026-W17',
        isoQuarter: '2026-Q2',
        isoDate: '2026-04-26',
    }),
    '.aigon/matrix-refresh/2026-04-26/x-2026-Q2.md',
);

console.log('recurring-instance-body-week-placeholder ok');
