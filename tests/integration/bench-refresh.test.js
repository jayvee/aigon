#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');
const { splitByStale, buildLastRunMap } = require('../../lib/commands/bench');

const NOW = Date.now();
const DAY_MS = 86_400_000;

function writeAllFile(repo, fname, timestamp, pairs) {
    const dir = path.join(repo, '.aigon', 'benchmarks');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, fname), JSON.stringify({ timestamp, pairs }));
}

test('splitByStale: pair with no prior result is stale', () => {
    const pairs = [{ agentId: 'gg', modelValue: 'gemini-2.5-flash', modelLabel: 'Gemini 2.5 Flash' }];
    const { stale, fresh } = splitByStale(pairs, {}, { gg: 30 });
    assert.strictEqual(stale.length, 1);
    assert.strictEqual(fresh.length, 0);
});

test('splitByStale: pair run 10 days ago is fresh at 30-day threshold', () => {
    const pairs = [{ agentId: 'gg', modelValue: 'gemini-2.5-flash', modelLabel: 'Gemini 2.5 Flash' }];
    const lastRunMap = { 'gg::gemini-2.5-flash': NOW - 10 * DAY_MS };
    const { stale, fresh } = splitByStale(pairs, lastRunMap, { gg: 30 });
    assert.strictEqual(stale.length, 0);
    assert.strictEqual(fresh.length, 1);
});

test('splitByStale: pair run 31 days ago is stale at 30-day threshold', () => {
    const pairs = [{ agentId: 'gg', modelValue: 'gemini-2.5-flash', modelLabel: 'Gemini 2.5 Flash' }];
    const lastRunMap = { 'gg::gemini-2.5-flash': NOW - 31 * DAY_MS };
    const { stale, fresh } = splitByStale(pairs, lastRunMap, { gg: 30 });
    assert.strictEqual(stale.length, 1);
    assert.strictEqual(fresh.length, 0);
});

test('splitByStale: cc/cx default to 60-day threshold', () => {
    const pairs = [
        { agentId: 'cc', modelValue: 'claude-sonnet-4-6', modelLabel: 'Sonnet' },
        { agentId: 'cx', modelValue: 'codex-mini', modelLabel: 'Codex Mini' },
    ];
    // 45 days ago — stale at 30d, fresh at 60d
    const lastRunMap = {
        'cc::claude-sonnet-4-6': NOW - 45 * DAY_MS,
        'cx::codex-mini': NOW - 45 * DAY_MS,
    };
    const { stale, fresh } = splitByStale(pairs, lastRunMap, { cc: 60, cx: 60 });
    assert.strictEqual(stale.length, 0);
    assert.strictEqual(fresh.length, 2);
});

test('splitByStale: threshold override per agent', () => {
    const pairs = [
        { agentId: 'op', modelValue: 'openrouter/deepseek/deepseek-v3.1-terminus', modelLabel: 'DeepSeek' },
        { agentId: 'gg', modelValue: 'gemini-2.5-flash', modelLabel: 'Gemini Flash' },
    ];
    // op last run 20 days ago, gg last run 20 days ago
    const lastRunMap = {
        'op::openrouter/deepseek/deepseek-v3.1-terminus': NOW - 20 * DAY_MS,
        'gg::gemini-2.5-flash': NOW - 20 * DAY_MS,
    };
    // op threshold = 15d (stale), gg threshold = 30d (fresh)
    const { stale, fresh } = splitByStale(pairs, lastRunMap, { op: 15, gg: 30 });
    assert.strictEqual(stale.length, 1);
    assert.strictEqual(stale[0].agentId, 'op');
    assert.strictEqual(fresh.length, 1);
    assert.strictEqual(fresh[0].agentId, 'gg');
});

test('buildLastRunMap: empty benchmarks dir returns {}', () => {
    withTempDir((repo) => {
        const map = buildLastRunMap(repo);
        assert.deepStrictEqual(map, {});
    });
});

test('buildLastRunMap: reads all-*.json and picks newest timestamp per pair', () => {
    withTempDir((repo) => {
        writeAllFile(repo, 'all-brewboard-2026-04-28.json', '2026-04-28T00:00:00Z', [
            { agentId: 'gg', modelValue: 'gemini-2.5-flash' },
            { agentId: 'op', modelValue: 'openrouter/deepseek/deepseek-chat-v3.1' },
        ]);
        writeAllFile(repo, 'all-brewboard-2026-04-29.json', '2026-04-29T00:00:00Z', [
            { agentId: 'gg', modelValue: 'gemini-2.5-flash' },
        ]);
        const map = buildLastRunMap(repo);
        // gg::gemini-2.5-flash: newest is 2026-04-29
        assert.strictEqual(map['gg::gemini-2.5-flash'], new Date('2026-04-29T00:00:00Z').getTime());
        // op pair only appears in first file
        assert.strictEqual(map['op::openrouter/deepseek/deepseek-chat-v3.1'], new Date('2026-04-28T00:00:00Z').getTime());
        // unknown pair absent
        assert.strictEqual(map['cc::unknown'], undefined);
    });
});

report();
