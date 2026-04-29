#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, report } = require('../_helpers');
const quotaProbe = require('../../lib/quota-probe');
const agentRegistry = require('../../lib/agent-registry');

const CASES = [
    ['cc', 'cc-anthropic-rate-limit.txt', 'anthropic-rate-limit'],
    ['cx', 'cx-openai-quota-exceeded.txt', 'openai-quota-exceeded'],
    ['gg', 'gg-resource-exhausted.txt', 'google-resource-exhausted'],
    ['op', 'op-openrouter-free-model-rate-limit.txt', 'openrouter-free-model-rate-limit'],
];

for (const [agentId, fixture, patternId] of CASES) {
    test(`quota classifier: ${agentId} ${patternId}`, () => {
        const raw = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'quota', fixture), 'utf8');
        const result = quotaProbe.classifyProbeResult(agentRegistry.getAgent(agentId), {
            ok: false,
            error: raw,
            elapsed: 123,
        });
        assert.strictEqual(result.verdict, 'depleted');
        assert.strictEqual(result.matchedPatternId, patternId);
        assert.ok(result.resetAt, 'resetAt should be extracted');
    });
}

test('quota classifier: successful PONG is available', () => {
    const result = quotaProbe.classifyProbeResult(agentRegistry.getAgent('cx'), {
        ok: true,
        output: 'PONG',
        elapsed: 50,
    });
    assert.strictEqual(result.verdict, 'available');
});

// REGRESSION (2026-04-29): opencode exited 0 with empty stdout when an
// OpenRouter "Key limit exceeded (monthly limit)" error landed only on
// stderr. The probe used to lose the stderr content and classify as
// 'unknown'; runProbe now returns stderr in the result object so the
// classifier can match it.
test('quota classifier: op key-limit error on stderr only', () => {
    const stderr = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'quota', 'op-openrouter-key-monthly-limit.txt'), 'utf8');
    const result = quotaProbe.classifyProbeResult(agentRegistry.getAgent('op'), {
        ok: false,
        error: 'empty response',
        stderr,
        elapsed: 1500,
    });
    assert.strictEqual(result.verdict, 'depleted');
    assert.strictEqual(result.matchedPatternId, 'openrouter-key-monthly-limit');
});

test('quota classifier: op insufficient-credits on stderr only', () => {
    const result = quotaProbe.classifyProbeResult(agentRegistry.getAgent('op'), {
        ok: false,
        error: 'empty response',
        stderr: 'Error: Insufficient credits to make this request',
        elapsed: 900,
    });
    assert.strictEqual(result.verdict, 'depleted');
    assert.strictEqual(result.matchedPatternId, 'openrouter-insufficient-credits');
});

report();
