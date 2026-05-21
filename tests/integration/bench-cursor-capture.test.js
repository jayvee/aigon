#!/usr/bin/env node
'use strict';
// Bench-mode cursor capture: parse Cursor's stream-json result event and
// compute USD cost from cu.json pricing. Without these, cursor benchmarks
// show $0.0000 forever because the 'no-telemetry-cursor' strategy reports
// all-null tokens (cursor's interactive TUI exposes nothing).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');

const perfBench = require('../../lib/perf-bench');

function writeCapture(dir, lines) {
    fs.writeFileSync(path.join(dir, '.aigon-cu-bench.jsonl'), lines.join('\n') + '\n', 'utf8');
}

test('readCursorBenchCapture: returns null when capture file missing', () => {
    withTempDir((dir) => {
        assert.strictEqual(perfBench.readCursorBenchCapture(dir), null);
    });
});

test('readCursorBenchCapture: extracts usage from final result event', () => {
    withTempDir((dir) => {
        writeCapture(dir, [
            '{"type":"system","message":"start"}',
            '{"type":"thinking","content":"..."}',
            '{"type":"tool_call","tool":"shell"}',
            '{"type":"assistant","message":{"content":"done"}}',
            '{"type":"result","subtype":"success","is_error":false,"session_id":"abc-123","usage":{"inputTokens":8268,"outputTokens":1062,"cacheReadTokens":50176,"cacheWriteTokens":0}}',
        ]);
        const u = perfBench.readCursorBenchCapture(dir);
        assert.deepStrictEqual(u, {
            inputTokens: 8268,
            outputTokens: 1062,
            cacheReadTokens: 50176,
            cacheWriteTokens: 0,
            sessionId: 'abc-123',
        });
    });
});

test('readCursorBenchCapture: scans from end (last result event wins on resume)', () => {
    withTempDir((dir) => {
        writeCapture(dir, [
            '{"type":"result","usage":{"inputTokens":100,"outputTokens":50}}',
            '{"type":"thinking"}',
            '{"type":"result","usage":{"inputTokens":9999,"outputTokens":42}}',
        ]);
        const u = perfBench.readCursorBenchCapture(dir);
        assert.strictEqual(u.inputTokens, 9999, 'must read the LAST result event');
    });
});

test('readCursorBenchCapture: tolerates malformed JSON lines', () => {
    withTempDir((dir) => {
        writeCapture(dir, [
            'not json',
            '{"type":"thinking"',  // truncated
            '{"type":"result","usage":{"inputTokens":42,"outputTokens":7}}',
        ]);
        const u = perfBench.readCursorBenchCapture(dir);
        assert.strictEqual(u.inputTokens, 42);
        assert.strictEqual(u.outputTokens, 7);
    });
});

test('readCursorBenchCapture: returns null when no result event present', () => {
    withTempDir((dir) => {
        writeCapture(dir, [
            '{"type":"thinking"}',
            '{"type":"assistant","message":{"content":"oops"}}',
        ]);
        assert.strictEqual(perfBench.readCursorBenchCapture(dir), null);
    });
});

test('computeCursorCost: returns null when pricing missing on model', () => {
    // composer-2 currently has pricing: null in cu.json (legacy, no published rate)
    const u = { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0 };
    assert.strictEqual(perfBench.computeCursorCost(u, 'composer-2'), null);
});

test('computeCursorCost: composer-2.5 ($0.5 in / $2.5 out per MTok)', () => {
    // 100k input, 50k output, no cache → 0.1*0.5 + 0.05*2.5 = 0.05 + 0.125 = 0.175
    const u = { inputTokens: 100_000, outputTokens: 50_000, cacheReadTokens: 0 };
    assert.strictEqual(perfBench.computeCursorCost(u, 'composer-2.5'), 0.175);
});

test('computeCursorCost: cache reads counted at input rate (honest overestimate)', () => {
    // 10k fresh input + 90k cache reads → bills 100k at input rate.
    // Real cursor cached input is usually ~10x cheaper, but cu.json carries
    // no cached-input price so we overestimate. Documented in the helper.
    const u = { inputTokens: 10_000, outputTokens: 1000, cacheReadTokens: 90_000 };
    // (10k+90k)/1M * 0.5 + 1k/1M * 2.5 = 0.05 + 0.0025 = 0.0525
    assert.strictEqual(perfBench.computeCursorCost(u, 'composer-2.5'), 0.0525);
});

test('computeCursorCost: composer-2.5-fast at premium rates ($3/$15)', () => {
    const u = { inputTokens: 100_000, outputTokens: 10_000, cacheReadTokens: 0 };
    // 0.1 * 3 + 0.01 * 15 = 0.3 + 0.15 = 0.45
    assert.strictEqual(perfBench.computeCursorCost(u, 'composer-2.5-fast'), 0.45);
});

test('computeCursorCost: returns null when usage or model missing', () => {
    assert.strictEqual(perfBench.computeCursorCost(null, 'composer-2.5'), null);
    assert.strictEqual(perfBench.computeCursorCost({ inputTokens: 1 }, null), null);
});

test('readBenchmarkTelemetryUsage: skips null-stub records (no-telemetry-cursor)', () => {
    withTempDir((dir) => {
        const telemetryDir = path.join(dir, '.aigon', 'telemetry');
        fs.mkdirSync(telemetryDir, { recursive: true });
        // Two records: one is a cu null-stub (no real data), one is real.
        fs.writeFileSync(path.join(telemetryDir, 'feature-07-cu-stub.json'), JSON.stringify({
            agent: 'cu',
            tokenUsage: {
                input: null, output: null, cacheReadInput: null,
                cacheCreationInput: null, thinking: null, total: null, billable: null,
            },
            costUsd: null,
        }));
        fs.writeFileSync(path.join(telemetryDir, 'feature-07-cu-real.json'), JSON.stringify({
            agent: 'cu',
            tokenUsage: { input: 100, output: 50 },
            costUsd: 0.0123,
            model: 'composer-2.5',
        }));
        const usage = perfBench.readBenchmarkTelemetryUsage({
            repoPath: dir, featureId: '07', agentId: 'cu',
        });
        assert.ok(usage, 'real record should produce a non-null total');
        assert.strictEqual(usage.sessions, 1, 'sessions counts only real record, not the stub');
        assert.strictEqual(usage.inputTokens, 100);
        assert.strictEqual(usage.costUsd, 0.0123);
    });
});

test('readBenchmarkTelemetryUsage: returns null when ALL records are stubs', () => {
    withTempDir((dir) => {
        const telemetryDir = path.join(dir, '.aigon', 'telemetry');
        fs.mkdirSync(telemetryDir, { recursive: true });
        fs.writeFileSync(path.join(telemetryDir, 'feature-07-cu-stub.json'), JSON.stringify({
            agent: 'cu',
            tokenUsage: { input: null, output: null, total: null, billable: null },
            costUsd: null,
        }));
        const usage = perfBench.readBenchmarkTelemetryUsage({
            repoPath: dir, featureId: '07', agentId: 'cu',
        });
        assert.strictEqual(usage, null, 'all-stub records → null total (not zero-everything)');
    });
});

report();
