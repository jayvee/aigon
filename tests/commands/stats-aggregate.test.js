#!/usr/bin/env node
// REGRESSION feature 230: stats-aggregate must scan .aigon/workflows/{features,research}/*/stats.json,
// roll up totals + perAgent (from cost.byAgent or stats.agents), cache with CACHE_VERSION,
// invalidate when any stats.json mtime exceeds cache mtime, and honor { force: true }.
const a = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
const sa = require('../../lib/stats-aggregate');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-stats-'));
const mk = (type, id, obj) => { const d = path.join(tmp, '.aigon', 'workflows', type, id); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'stats.json'), JSON.stringify(obj)); };
mk('features', '100', { completedAt: '2026-04-01T00:00:00Z', durationMs: 300000, commitCount: 3, linesAdded: 50, linesRemoved: 10, cost: { estimatedUsd: 1.5, byAgent: { cc: { costUsd: 1.0, sessions: 1 }, cx: { costUsd: 0.5, sessions: 1 } } } });
mk('features', '101', { completedAt: '2026-04-02T00:00:00Z', durationMs: 1200000, commitCount: 7, agents: ['gg'], cost: { estimatedUsd: 5.0 } });
mk('research', '50', { completedAt: '2026-04-03T00:00:00Z', durationMs: 60000, commitCount: 1, cost: { estimatedUsd: 0.25 } });
const ag = sa.collectAggregateStats(tmp);
a.strictEqual(ag.version, sa.CACHE_VERSION); a.strictEqual(ag.totals.features, 2); a.strictEqual(ag.totals.research, 1);
a.strictEqual(Math.round(ag.totals.cost * 100) / 100, 6.75); a.strictEqual(ag.totals.commits, 11);
a.strictEqual(ag.fastestFeature.entityId, '100'); a.strictEqual(ag.mostExpensive.entityId, '101');
a.strictEqual(ag.perAgent.cc.cost, 1); a.strictEqual(ag.perAgent.cx.cost, 0.5); a.strictEqual(ag.perAgent.gg.cost, 5);
a.strictEqual(ag.perAgent.cc.commits, 2); a.strictEqual(ag.perAgent.cx.commits, 1);
a.strictEqual(ag.perAgent.cc.linesAdded, 33); a.strictEqual(ag.perAgent.cx.linesAdded, 17);
a.ok(fs.existsSync(sa.cachePath(tmp)));
a.strictEqual(sa.collectAggregateStats(tmp).generatedAt, ag.generatedAt, 'second read is cached');
a.notStrictEqual(sa.rebuildAggregate(tmp).generatedAt, ag.generatedAt, 'force rebuilds');
mk('features', '102', { completedAt: '2026-04-04T00:00:00Z', durationMs: 600000, commitCount: 2, cost: { estimatedUsd: 0.1 } });
const f = Date.now() / 1000 + 120; fs.utimesSync(path.join(tmp, '.aigon', 'workflows', 'features', '102', 'stats.json'), f, f);
a.strictEqual(sa.collectAggregateStats(tmp).totals.features, 3, 'cache invalidated when newer stats.json exists');
// REGRESSION feature 291: perTriplet rollup keyed on `agent|model|effort`
mk('features', '103', { completedAt:'2026-04-05T00:00:00Z', cost:{ estimatedUsd:0.6, byAgent:{ cx:{costUsd:0.6,sessions:2,modelOverride:'gpt-5.4',effortOverride:'high'} } } });
const ag2 = sa.rebuildAggregate(tmp);
a.strictEqual(ag2.perTriplet['cx|gpt-5.4|high'].effort, 'high');
a.strictEqual(ag2.perTriplet['cx|gpt-5.4|high'].sessions, 2);
a.ok(sa.CACHE_VERSION >= 2, 'CACHE_VERSION bumped when perTriplet added');
fs.rmSync(tmp, { recursive: true, force: true });
console.log('  ✓ stats-aggregate regression tests passed');
