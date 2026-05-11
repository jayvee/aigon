#!/usr/bin/env node
'use strict';

// Merged: bench-refresh (splitByStale + buildLastRunMap) + bench-hydrate
// (hydrateBenchVerdicts + mergeBenchVerdictsIntoQuota). Both test the
// .aigon/benchmarks/*.json indexing surface.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');
const { splitByStale, buildLastRunMap } = require('../../lib/commands/bench');
const benchHydrate = require('../../lib/bench-hydrate');

const NOW = Date.now();
const DAY_MS = 86_400_000;

function writeBenchFile(repo, fname, content) {
    const d = path.join(repo, '.aigon', 'benchmarks');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, fname), JSON.stringify(content));
}

// --- splitByStale ---

test('splitByStale: pair with no prior result is stale', () => {
    const pairs = [{ agentId: 'gg', modelValue: 'gemini-2.5-flash', modelLabel: 'Gemini 2.5 Flash' }];
    const { stale, fresh } = splitByStale(pairs, {}, { gg: 30 });
    assert.strictEqual(stale.length, 1);
    assert.strictEqual(fresh.length, 0);
});

test('splitByStale: thresholds — 10d fresh, 31d stale, 60d threshold for cc/cx', () => {
    const pairs = [
        { agentId: 'gg', modelValue: 'gemini-2.5-flash' },
        { agentId: 'gg', modelValue: 'gemini-2.5-pro' },
        { agentId: 'cc', modelValue: 'claude-sonnet-4-6' },
    ];
    const lastRunMap = {
        'gg::gemini-2.5-flash': NOW - 10 * DAY_MS,   // fresh @ 30d
        'gg::gemini-2.5-pro': NOW - 31 * DAY_MS,     // stale @ 30d
        'cc::claude-sonnet-4-6': NOW - 45 * DAY_MS,  // fresh @ 60d
    };
    const { stale, fresh } = splitByStale(pairs, lastRunMap, { gg: 30, cc: 60 });
    assert.strictEqual(stale.length, 1);
    assert.strictEqual(stale[0].modelValue, 'gemini-2.5-pro');
    assert.strictEqual(fresh.length, 2);
});

test('splitByStale: per-agent threshold override', () => {
    const pairs = [
        { agentId: 'op', modelValue: 'openrouter/deepseek/deepseek-v3.1-terminus' },
        { agentId: 'gg', modelValue: 'gemini-2.5-flash' },
    ];
    const lastRunMap = {
        'op::openrouter/deepseek/deepseek-v3.1-terminus': NOW - 20 * DAY_MS,
        'gg::gemini-2.5-flash': NOW - 20 * DAY_MS,
    };
    const { stale, fresh } = splitByStale(pairs, lastRunMap, { op: 15, gg: 30 });
    assert.strictEqual(stale.length, 1);
    assert.strictEqual(stale[0].agentId, 'op');
    assert.strictEqual(fresh.length, 1);
    assert.strictEqual(fresh[0].agentId, 'gg');
});

// --- buildLastRunMap ---

test('buildLastRunMap: empty benchmarks dir returns {}', () => {
    withTempDir((repo) => {
        assert.deepStrictEqual(buildLastRunMap(repo), {});
    });
});

test('buildLastRunMap: reads all-*.json, picks newest timestamp per pair', () => {
    withTempDir((repo) => {
        writeBenchFile(repo, 'all-brewboard-2026-04-28.json', {
            timestamp: '2026-04-28T00:00:00Z',
            pairs: [
                { agentId: 'gg', modelValue: 'gemini-2.5-flash' },
                { agentId: 'op', modelValue: 'openrouter/deepseek/deepseek-chat-v3.1' },
            ],
        });
        writeBenchFile(repo, 'all-brewboard-2026-04-29.json', {
            timestamp: '2026-04-29T00:00:00Z',
            pairs: [{ agentId: 'gg', modelValue: 'gemini-2.5-flash' }],
        });
        const map = buildLastRunMap(repo);
        assert.strictEqual(map['gg::gemini-2.5-flash'], new Date('2026-04-29T00:00:00Z').getTime());
        assert.strictEqual(map['op::openrouter/deepseek/deepseek-chat-v3.1'], new Date('2026-04-28T00:00:00Z').getTime());
        assert.strictEqual(map['cc::unknown'], undefined);
    });
});

// --- hydrateBenchVerdicts + mergeBenchVerdictsIntoQuota ---

test('hydrateBenchVerdicts: empty / verdicts / precedence / merge into quota state', () => {
    withTempDir((repo) => {
        assert.deepStrictEqual(benchHydrate.hydrateBenchVerdicts(repo), {});
        // Older all-pairs (passed), newer all-pairs (failed) — newer sweep wins.
        writeBenchFile(repo, 'all-2026-04-28.json', { timestamp: '2026-04-28T00:00:00Z', pairs: [{ agentId: 'cc', modelValue: 'm', ok: true }] });
        writeBenchFile(repo, 'all-2026-04-29.json', { timestamp: '2026-04-29T00:00:00Z', pairs: [
            { agentId: 'cc', modelValue: 'm', ok: false },
            { agentId: 'op', modelValue: 'p', ok: true, totalMs: 100 },
        ] });
        // Per-run more recent than newest all-pairs — all-pairs still wins for cc::m.
        writeBenchFile(repo, 'brewboard-07-2026-04-30.json', { agent: 'cc', model: 'm', timestamp: '2026-04-30Z', ok: true });
        // Per-run fills pair not covered by any all-pairs file.
        writeBenchFile(repo, 'brewboard-07-2026-04-29.json', { agent: 'gg', model: 'only', timestamp: '2026-04-29Z', ok: true, totalMs: 7 });

        const idx = benchHydrate.hydrateBenchVerdicts(repo);
        assert.strictEqual(idx['cc::m'].benchVerdict, 'failed');
        assert.strictEqual(idx['op::p'].benchTotalMs, 100);
        assert.strictEqual(idx['gg::only'].benchVerdict, 'passed');

        const state = { schemaVersion: 1, agents: { op: { models: {
            p: { verdict: 'available', probeOk: true },
            none: { verdict: 'available', probeOk: true },
        } } } };
        benchHydrate.mergeBenchVerdictsIntoQuota(state, repo);
        assert.strictEqual(state.agents.op.models.p.benchVerdict, 'passed');
        assert.strictEqual(state.agents.op.models.none.benchVerdict, 'unknown');
    });
});

report();
