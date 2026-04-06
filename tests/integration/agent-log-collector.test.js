#!/usr/bin/env node
/**
 * Unit tests for collectAgentLogs() in lib/dashboard-status-collector.
 *
 * Covers solo / Fleet keying and the 256 KB truncation footer that powers
 * the Agent Log drawer tab (feature 225).
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    collectAgentLogs,
    AGENT_LOG_MAX_BYTES,
} = require('../../lib/dashboard-status-collector');

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

function makeTempLogsDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-log-test-'));
    return dir;
}

// REGRESSION: prevents the bug where the Agent Log drawer tab would mis-key
// solo logs under a 2-letter agent id (e.g. "da" from "dark-mode") because
// the keying heuristic only looked at the first two characters instead of
// requiring a hyphen separator. See feature 225.
test('solo log without agent infix is keyed under "solo"', () => {
    const dir = makeTempLogsDir();
    fs.writeFileSync(path.join(dir, 'feature-07-dark-mode-log.md'), '# solo log\n');
    const out = collectAgentLogs([dir], 7);
    assert.deepStrictEqual(Object.keys(out), ['solo']);
    assert.ok(out.solo.content.includes('solo log'));
    assert.ok(out.solo.path.endsWith('feature-07-dark-mode-log.md'));
});

// REGRESSION: prevents Fleet logs from being collapsed into a single entry —
// each agent must get its own keyed entry so the picker can switch between
// them without re-fetching the detail payload.
test('Fleet logs are keyed by 2-letter agent code', () => {
    const dir = makeTempLogsDir();
    fs.writeFileSync(path.join(dir, 'feature-08-cc-social-sharing-log.md'), '# cc log\n');
    fs.writeFileSync(path.join(dir, 'feature-08-gg-social-sharing-log.md'), '# gg log\n');
    const out = collectAgentLogs([dir], 8);
    assert.deepStrictEqual(Object.keys(out).sort(), ['cc', 'gg']);
    assert.ok(out.cc.content.includes('cc log'));
    assert.ok(out.gg.content.includes('gg log'));
});

// REGRESSION: prevents pathological logs from bloating the /api/detail HTTP
// payload — anything over 256 KB must be truncated with a footer pointing to
// the on-disk path.
test('logs over AGENT_LOG_MAX_BYTES are truncated with a footer', () => {
    const dir = makeTempLogsDir();
    const big = 'x'.repeat(AGENT_LOG_MAX_BYTES + 1024);
    fs.writeFileSync(path.join(dir, 'feature-09-huge-log.md'), big);
    const out = collectAgentLogs([dir], 9);
    assert.ok(out.solo, 'solo entry should exist');
    assert.ok(out.solo.content.includes('log truncated'),
        'truncated content must include the footer marker');
    assert.ok(out.solo.content.includes(out.solo.path),
        'footer should reference the on-disk path');
});

test('missing feature id returns an empty object, not an error', () => {
    const dir = makeTempLogsDir();
    fs.writeFileSync(path.join(dir, 'feature-08-cc-social-sharing-log.md'), '# cc\n');
    const out = collectAgentLogs([dir], 999);
    assert.deepStrictEqual(out, {});
});

test('non-existent dirs are skipped silently', () => {
    const out = collectAgentLogs(['/nonexistent/path/aigon/test'], 1);
    assert.deepStrictEqual(out, {});
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
