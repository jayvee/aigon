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

report();
