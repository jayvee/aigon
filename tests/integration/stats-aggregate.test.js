#!/usr/bin/env node
// REGRESSION F230: stats-aggregate must scan .aigon/workflows/{features,research}/*/stats.json,
// roll up totals + perAgent (from cost.byAgent or stats.agents), cache with CACHE_VERSION,
// invalidate when any stats.json mtime exceeds cache mtime, and honor { force: true }.
// REGRESSION F291: perTriplet rollup keyed on `agent|model|effort`.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { test, report } = require('../_helpers');
const sa = require('../../lib/stats-aggregate');

function makeTmp() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-stats-'));
}

function mk(tmp, type, id, obj) {
    const d = path.join(tmp, '.aigon', 'workflows', type, id);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'stats.json'), JSON.stringify(obj));
}

test('collectAggregateStats: totals, perAgent rollup, cache, and invalidation (F230)', () => {
    const tmp = makeTmp();
    try {
        mk(tmp, 'features', '100', { completedAt: '2026-04-01T00:00:00Z', durationMs: 300000, commitCount: 3, linesAdded: 50, linesRemoved: 10, cost: { estimatedUsd: 1.5, byAgent: { cc: { costUsd: 1.0, sessions: 1 }, cx: { costUsd: 0.5, sessions: 1 } } } });
        mk(tmp, 'features', '101', { completedAt: '2026-04-02T00:00:00Z', durationMs: 1200000, commitCount: 7, agents: ['gg'], cost: { estimatedUsd: 5.0 } });
        mk(tmp, 'research', '50', { completedAt: '2026-04-03T00:00:00Z', durationMs: 60000, commitCount: 1, cost: { estimatedUsd: 0.25 } });

        const ag = sa.collectAggregateStats(tmp);
        assert.strictEqual(ag.version, sa.CACHE_VERSION);
        assert.strictEqual(ag.totals.features, 2);
        assert.strictEqual(ag.totals.research, 1);
        assert.strictEqual(Math.round(ag.totals.cost * 100) / 100, 6.75);
        assert.strictEqual(ag.totals.commits, 11);
        assert.strictEqual(ag.fastestFeature.entityId, '100');
        assert.strictEqual(ag.mostExpensive.entityId, '101');
        assert.strictEqual(ag.perAgent.cc.cost, 1);
        assert.strictEqual(ag.perAgent.cx.cost, 0.5);
        assert.strictEqual(ag.perAgent.gg.cost, 5);
        assert.strictEqual(ag.perAgent.cc.commits, 2);
        assert.strictEqual(ag.perAgent.cx.commits, 1);
        assert.strictEqual(ag.perAgent.cc.linesAdded, 33);
        assert.strictEqual(ag.perAgent.cx.linesAdded, 17);
        assert.ok(fs.existsSync(sa.cachePath(tmp)));

        assert.strictEqual(sa.collectAggregateStats(tmp).generatedAt, ag.generatedAt, 'second read is cached');
        assert.notStrictEqual(sa.rebuildAggregate(tmp).generatedAt, ag.generatedAt, 'force rebuilds');

        mk(tmp, 'features', '102', { completedAt: '2026-04-04T00:00:00Z', durationMs: 600000, commitCount: 2, cost: { estimatedUsd: 0.1 } });
        const futureTs = Date.now() / 1000 + 120;
        fs.utimesSync(path.join(tmp, '.aigon', 'workflows', 'features', '102', 'stats.json'), futureTs, futureTs);
        assert.strictEqual(sa.collectAggregateStats(tmp).totals.features, 3, 'cache invalidated when newer stats.json exists');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('collectAggregateStats: perTriplet rollup keyed on agent|model|effort (F291)', () => {
    const tmp = makeTmp();
    try {
        mk(tmp, 'features', '103', { completedAt: '2026-04-05T00:00:00Z', cost: { estimatedUsd: 0.6, byAgent: { cx: { costUsd: 0.6, sessions: 2, modelOverride: 'gpt-5.4', effortOverride: 'high' } } } });
        const ag2 = sa.rebuildAggregate(tmp);
        assert.strictEqual(ag2.perTriplet['cx|gpt-5.4|high'].effort, 'high');
        assert.strictEqual(ag2.perTriplet['cx|gpt-5.4|high'].sessions, 2);
        assert.ok(sa.CACHE_VERSION >= 2, 'CACHE_VERSION bumped when perTriplet added');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

report();
