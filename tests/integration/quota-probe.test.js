#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, testAsync, withTempDirAsync, report } = require('../_helpers');
const quotaProbe = require('../../lib/quota-probe');
const agentRegistry = require('../../lib/agent-registry');
const probeAgent = require('../../scripts/probe-agent');

const CASES = [
    ['cc', 'cc-anthropic-rate-limit.txt', 'anthropic-rate-limit'],
    ['cx', 'cx-openai-quota-exceeded.txt', 'openai-quota-exceeded'],
    ['ag', 'gg-resource-exhausted.txt', 'google-resource-exhausted'],
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

test('quota classifier: am out-of-credits modal (no reset time)', () => {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'quota', 'am-out-of-credits.txt'), 'utf8');
    const result = quotaProbe.classifyProbeResult(agentRegistry.getAgent('am'), {
        ok: false,
        stdout: raw,
    });
    assert.strictEqual(result.verdict, 'depleted');
    assert.strictEqual(result.matchedPatternId, 'amp-out-of-credits');
});

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

testAsync('probePairAsync uses the non-blocking probe path and writes quota state', async () => withTempDirAsync(async (dir) => {
    const original = probeAgent.runProbeAsync;
    let called = false;
    try {
        probeAgent.runProbeAsync = async () => {
            called = true;
            return { ok: true, output: 'PONG', elapsed: 1, stderr: '' };
        };
        const result = await quotaProbe.probePairAsync({
            repoPath: dir,
            agentId: 'cx',
            modelValue: null,
            modelLabel: '(agent default)',
            force: true,
        });
        assert.strictEqual(called, true, 'runProbeAsync should be used');
        assert.strictEqual(result.entry.verdict, 'available');
        const state = quotaProbe.readQuotaState(dir);
        assert.strictEqual(state.agents.cx.models.__default__.verdict, 'available');
    } finally {
        probeAgent.runProbeAsync = original;
    }
}));

test('quota poller awaits probePairAsync instead of blocking the dashboard event loop', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../lib/agent-quota-poller.js'), 'utf8');
    assert.ok(src.includes('await quotaProbe.probePairAsync'), 'unified poller must use async probes');
    assert.ok(!src.includes('quotaProbe.probePair({ repoPath'), 'unified poller must not call the synchronous probe path');
});

test('quota poller background tick probes default model only', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../lib/agent-quota-poller.js'), 'utf8');
    assert.ok(src.includes('allModels'), 'background quota poll must distinguish model scope');
    assert.ok(src.includes('cacheIsFresh'), 'unified poller must gate startup polls on cache age');
});

test('quota classifier: ag auth-required is unauthenticated', () => {
    const result = quotaProbe.classifyProbeResult(agentRegistry.getAgent('ag'), {
        ok: false,
        stderr: 'Waiting for authentication — complete Google sign-in in your browser',
        elapsed: 2000,
    });
    assert.strictEqual(result.verdict, 'unauthenticated');
    assert.strictEqual(result.matchedPatternId, 'antigravity-auth-required');
});

test('quota shouldProbe backs off unauthenticated probes for hours', () => {
    const cfg = {
        pollIntervalSeconds: 1800,
        maxBackoffSeconds: 3600,
        authFailureBackoffSeconds: 21600,
    };
    const recent = {
        verdict: 'unauthenticated',
        lastProbedAt: new Date().toISOString(),
    };
    assert.strictEqual(quotaProbe.shouldProbe(recent, cfg), false);
    const stale = {
        verdict: 'unauthenticated',
        lastProbedAt: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(),
    };
    assert.strictEqual(quotaProbe.shouldProbe(stale, cfg), true);
});

test('ag is never probed or polled automatically (no browser sign-in hijack)', () => {
    const probeSrc = fs.readFileSync(path.join(__dirname, '../../scripts/probe-agent.js'), 'utf8');
    const budgetSrc = fs.readFileSync(path.join(__dirname, '../../lib/budget-poller.js'), 'utf8');
    const pollerSrc = fs.readFileSync(path.join(__dirname, '../../lib/agent-quota-poller.js'), 'utf8');
    // probe-agent must never build an `agy` command — buildCmd returns null for ag.
    assert.ok(!/return \[['"]agy['"]/.test(probeSrc), 'probe-agent must not spawn agy');
    // Budget poller must not include ag in its automated agent set.
    assert.ok(!/budgetAgents = \[[^\]]*['"]ag['"]/.test(pollerSrc), 'unified poller must not list ag as a budget agent');
    // Budget scrape module must not export an interactive Antigravity poll helper.
    assert.ok(!/pollAntigravityBudget/.test(budgetSrc), 'budget scrape must not launch interactive agy');
});

test('quota polling defaults to 30 minutes and allows that interval at runtime', () => {
    assert.strictEqual(quotaProbe.DEFAULT_POLL_INTERVAL_SECONDS, 1800);
    const configSrc = fs.readFileSync(path.join(__dirname, '../../lib/config-core.js'), 'utf8');
    const pollerSrc = fs.readFileSync(path.join(__dirname, '../../lib/agent-quota-poller.js'), 'utf8');
    assert.ok(configSrc.includes('pollIntervalSeconds: 1800'), 'global config default should be 30 minutes');
    assert.ok(pollerSrc.includes('60 * 60 * 1000'), 'runtime clamp should allow the 30-minute default');
});

report();
