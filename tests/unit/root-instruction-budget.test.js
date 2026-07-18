'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts/check-root-instruction-budget.js');
const REAL_FILE = path.join(ROOT, 'AGENTS.md');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-root-budget-'));
let passed = 0;
let failed = 0;

function test(description, fn) {
    try {
        fn();
        console.log(`  ✓ ${description}`);
        passed++;
    } catch (error) {
        console.error(`  ✗ ${description}\n    ${error.message}`);
        failed++;
    }
}

function run(file) {
    return spawnSync(process.execPath, [SCRIPT, file], { encoding: 'utf8' });
}

// REGRESSION: the always-loaded root instructions must remain inside both static budgets.
test('accepts the repository AGENTS.md within its byte and line budgets', () => {
    const result = run(REAL_FILE);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /safety anchors/);
});

// REGRESSION: exceeding either root-instruction budget must report the measured limit breach.
test('rejects over-budget instruction files with actionable messages', () => {
    const byteHeavy = path.join(tempDir, 'byte-heavy.md');
    fs.writeFileSync(byteHeavy, `${fs.readFileSync(REAL_FILE, 'utf8')}\n${'x'.repeat(25 * 1024)}`);
    const byteResult = run(byteHeavy);
    assert.notStrictEqual(byteResult.status, 0);
    assert.match(byteResult.stderr, /bytes; limit is 24576 bytes/);

    const lineHeavy = path.join(tempDir, 'line-heavy.md');
    fs.writeFileSync(lineHeavy, `${fs.readFileSync(REAL_FILE, 'utf8')}\n${'x\n'.repeat(181)}`);
    const lineResult = run(lineHeavy);
    assert.notStrictEqual(lineResult.status, 0);
    assert.match(lineResult.stderr, /lines; limit is 180 lines/);
});

// REGRESSION: edits may not silently remove load-bearing root safety sections.
test('rejects a missing required safety anchor by name', () => {
    const missing = path.join(tempDir, 'missing-anchor.md');
    const text = fs.readFileSync(REAL_FILE, 'utf8').replace('<!-- aigon-root:oss-pro-boundary -->', '');
    fs.writeFileSync(missing, text);
    const result = run(missing);
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /missing required safety anchor\(s\): aigon-root:oss-pro-boundary/);
});

fs.rmSync(tempDir, { recursive: true, force: true });
console.log(`${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
