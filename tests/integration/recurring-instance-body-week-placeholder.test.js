'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { renderPattern, renderTemplateString, getISOQuarter, getISOMonth, scanTemplates } = require('../../lib/recurring');

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
assert.strictEqual(getISOMonth(new Date(Date.UTC(2026, 3, 26))), '2026-04');
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
        isoMonth: '2026-04',
        isoDate: '2026-04-26',
    }),
    '.aigon/matrix-refresh/2026-04-26/x-2026-Q2.md',
);
assert.strictEqual(
    renderTemplateString('Monthly Report {{YYYY-MM}}.pdf', { isoMonth: '2026-04' }),
    'Monthly Report 2026-04.pdf',
);

// Test scanTemplates for monthly schedule
const tempRecurringDir = path.join(__dirname, '../../docs/specs/recurring-temp');
const tempMonthlyTemplatePath = path.join(tempRecurringDir, 'temp-monthly-competitive-refresh.md');

// Ensure temp directory exists and is empty
if (fs.existsSync(tempRecurringDir)) {
    fs.readdirSync(tempRecurringDir).forEach(f => fs.unlinkSync(path.join(tempRecurringDir, f)));
    fs.rmdirSync(tempRecurringDir);
}
fs.mkdirSync(tempRecurringDir, { recursive: true });

fs.writeFileSync(tempMonthlyTemplatePath, `---
schedule: monthly
name_pattern: Monthly Competitive Scan {{YYYY-MM}}
recurring_slug: temp-monthly-competitive-refresh
---
# Monthly Scan
`);

const scannedTemp = scanTemplates(tempRecurringDir);
assert.ok(
    scannedTemp.some(t => t.recurringSlug === 'temp-monthly-competitive-refresh' && t.schedule === 'monthly' && t.namePattern === 'Monthly Competitive Scan {{YYYY-MM}}'),
    'monthly competitive refresh template must be accepted by scanTemplates',
);

// Clean up temporary file and directory
fs.unlinkSync(tempMonthlyTemplatePath);
fs.rmdirSync(tempRecurringDir);

console.log('recurring-instance-body-week-placeholder ok');
