#!/usr/bin/env node
/**
 * Unit tests for isolated helper logic used by the CLI.
 *
 * Runs with: node aigon-cli.test.js
 * Or: npm test
 */

'use strict';

const assert = require('assert');

// ---------------------------------------------------------------------------
// Re-implement the units under test in isolation so the test file doesn't
// need to load the full CLI (which has side-effects like reading configs).
// ---------------------------------------------------------------------------

const PROVIDER_FAMILIES = {
    cc: 'anthropic',
    cu: 'varies',
    gg: 'google',
    cx: 'openai',
};

function isSameProviderFamily(agentA, agentB) {
    const familyA = PROVIDER_FAMILIES[agentA];
    const familyB = PROVIDER_FAMILIES[agentB];
    if (!familyA || !familyB) return false;
    if (familyA === 'varies' || familyB === 'varies') return false;
    return familyA === familyB;
}

function toUnpaddedId(id) {
    const parsed = parseInt(String(id), 10);
    return Number.isNaN(parsed) ? String(id) : String(parsed);
}

function buildTmuxSessionName(featureId, agentId) {
    return `aigon-f${toUnpaddedId(featureId)}-${agentId || 'solo'}`;
}

function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

// ---------------------------------------------------------------------------
// Conductor: log front matter parsing helpers (re-implemented for testing)
// ---------------------------------------------------------------------------

/**
 * Extract status and updated fields from log front matter content.
 * Returns { status, updatedIso } or null if no front matter found.
 */
function parseLogFrontMatter(content) {
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
    if (!fmMatch) return null;
    const body = fmMatch[1];
    const sm = body.match(/status:\s*(\S+)/);
    const um = body.match(/updated:\s*(\S+)/);
    return {
        status: sm ? sm[1] : null,
        updatedIso: um ? um[1] : null,
    };
}

/**
 * Format elapsed time from an ISO timestamp string.
 * Returns "just now" if < 1 minute, else "<N>m ago".
 */
function formatElapsed(isoStr, nowMs) {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '';
    const diffMs = nowMs - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    return diffMin < 1 ? 'just now' : `${diffMin}m ago`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(description, fn) {
    try {
        fn();
        console.log(`  ✓ ${description}`);
        passed++;
    } catch (err) {
        console.error(`  ✗ ${description}`);
        console.error(`    ${err.message}`);
        failed++;
    }
}

console.log('\nProvider Family Map');
test('cc maps to anthropic', () => assert.strictEqual(PROVIDER_FAMILIES.cc, 'anthropic'));
test('gg maps to google',    () => assert.strictEqual(PROVIDER_FAMILIES.gg, 'google'));
test('cx maps to openai',    () => assert.strictEqual(PROVIDER_FAMILIES.cx, 'openai'));
test('cu maps to varies',    () => assert.strictEqual(PROVIDER_FAMILIES.cu, 'varies'));

console.log('\nisSameProviderFamily — same family');
test('cc vs cc → true (anthropic/anthropic)',  () => assert.strictEqual(isSameProviderFamily('cc', 'cc'), true));
test('gg vs gg → true (google/google)',        () => assert.strictEqual(isSameProviderFamily('gg', 'gg'), true));
test('cx vs cx → true (openai/openai)',        () => assert.strictEqual(isSameProviderFamily('cx', 'cx'), true));

console.log('\nisSameProviderFamily — different family');
test('cc vs gg → false (anthropic/google)',    () => assert.strictEqual(isSameProviderFamily('cc', 'gg'), false));
test('cc vs cx → false (anthropic/openai)',    () => assert.strictEqual(isSameProviderFamily('cc', 'cx'), false));
test('gg vs cx → false (google/openai)',       () => assert.strictEqual(isSameProviderFamily('gg', 'cx'), false));
test('cx vs gg → false (openai/google)',       () => assert.strictEqual(isSameProviderFamily('cx', 'gg'), false));

console.log('\nisSameProviderFamily — varies (Cursor) never triggers');
test('cu vs cc → false (varies never matches)',  () => assert.strictEqual(isSameProviderFamily('cu', 'cc'), false));
test('cc vs cu → false (varies never matches)',  () => assert.strictEqual(isSameProviderFamily('cc', 'cu'), false));
test('cu vs cu → false (varies vs varies)',      () => assert.strictEqual(isSameProviderFamily('cu', 'cu'), false));

console.log('\nisSameProviderFamily — unknown agents');
test('unknown vs cc → false',   () => assert.strictEqual(isSameProviderFamily('xx', 'cc'), false));
test('cc vs unknown → false',   () => assert.strictEqual(isSameProviderFamily('cc', 'zz'), false));
test('unknown vs unknown → false', () => assert.strictEqual(isSameProviderFamily('aa', 'bb'), false));

console.log('\ntmux session helpers');
test('toUnpaddedId removes leading zeros', () => assert.strictEqual(toUnpaddedId('040'), '40'));
test('toUnpaddedId keeps non-numeric IDs unchanged', () => assert.strictEqual(toUnpaddedId('abc'), 'abc'));
test('buildTmuxSessionName uses unpadded feature ID', () => assert.strictEqual(buildTmuxSessionName('040', 'cx'), 'aigon-f40-cx'));
test('buildTmuxSessionName defaults agent to solo', () => assert.strictEqual(buildTmuxSessionName('40'), 'aigon-f40-solo'));
test('shellQuote escapes apostrophes safely', () => assert.strictEqual(shellQuote("it's"), "'it'\\''s'"));

console.log('\nconductor: log front matter parsing');
test('parses status from front matter', () => {
    const content = '---\nstatus: submitted\nupdated: 2026-03-11T10:30:00.000Z\n---\n# Log\n';
    const fm = parseLogFrontMatter(content);
    assert.strictEqual(fm.status, 'submitted');
});
test('parses updated from front matter', () => {
    const content = '---\nstatus: implementing\nupdated: 2026-03-11T10:30:00.000Z\n---\n';
    const fm = parseLogFrontMatter(content);
    assert.strictEqual(fm.updatedIso, '2026-03-11T10:30:00.000Z');
});
test('returns null when no front matter', () => {
    const content = '# Log without front matter\n\nSome content here.';
    assert.strictEqual(parseLogFrontMatter(content), null);
});
test('status is null when field missing from front matter', () => {
    const content = '---\nupdated: 2026-03-11T10:30:00.000Z\n---\n';
    const fm = parseLogFrontMatter(content);
    assert.strictEqual(fm.status, null);
});

console.log('\nconductor: elapsed time formatting');
test('formats time as "just now" when under 1 minute', () => {
    const now = new Date('2026-03-11T10:30:30.000Z').getTime();
    const iso = '2026-03-11T10:30:10.000Z'; // 20 seconds ago
    assert.strictEqual(formatElapsed(iso, now), 'just now');
});
test('formats time as "Nm ago" for N full minutes', () => {
    const now = new Date('2026-03-11T10:32:00.000Z').getTime();
    const iso = '2026-03-11T10:30:00.000Z'; // 2 minutes ago
    assert.strictEqual(formatElapsed(iso, now), '2m ago');
});
test('formats time as "1m ago" at exactly 1 minute', () => {
    const now = new Date('2026-03-11T10:31:00.000Z').getTime();
    const iso = '2026-03-11T10:30:00.000Z'; // exactly 1 minute ago
    assert.strictEqual(formatElapsed(iso, now), '1m ago');
});
test('returns empty string for invalid ISO timestamp', () => {
    assert.strictEqual(formatElapsed('not-a-date', Date.now()), '');
});

console.log('');
if (failed === 0) {
    console.log(`All ${passed} tests passed.\n`);
    process.exit(0);
} else {
    console.error(`${failed} test(s) failed (${passed} passed).\n`);
    process.exit(1);
}
