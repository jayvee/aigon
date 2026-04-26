#!/usr/bin/env node
// Feature 372: rankAgentsForOperation — recommender core
'use strict';
const a = require('assert');
const r = require('../../lib/spec-recommendation');

// --- Shape and basic contract ---
const results = r.rankAgentsForOperation('implement', 'medium');
a.ok(Array.isArray(results), 'returns an array');
a.ok(results.length > 0, 'non-empty for known op/complexity');

for (const item of results) {
    const keys = ['agentId', 'model', 'effort', 'score', 'rationale', 'confidence'];
    for (const k of keys) a.ok(k in item, `missing key ${k}`);
    a.ok(typeof item.agentId === 'string', 'agentId is string');
    a.ok(['low', 'medium', 'high'].includes(item.confidence), `invalid confidence: ${item.confidence}`);
    a.ok(typeof item.rationale === 'string' && item.rationale.length > 0, 'rationale is non-empty string');
    a.ok(item.score === null || typeof item.score === 'number', 'score is number or null');
}
console.log('  ✓ shape contract');

// --- No-benchmark-data path: confidence must be low with canonical rationale ---
const noDataItems = results.filter(i => i.confidence === 'low');
for (const item of noDataItems) {
    a.strictEqual(item.rationale, 'no benchmark data — qualitative only');
}
console.log('  ✓ sparse cell rationale');

// --- All four operations work without throwing ---
for (const op of ['draft', 'spec_review', 'implement', 'review']) {
    for (const cx of ['low', 'medium', 'high', 'very-high']) {
        const res = r.rankAgentsForOperation(op, cx);
        a.ok(Array.isArray(res), `not array for ${op}/${cx}`);
    }
}
console.log('  ✓ all op × complexity combos');

// --- Sort order: non-null scores before null scores ---
const allScores = results.map(i => i.score);
let seenNull = false;
for (const s of allScores) {
    if (s === null) { seenNull = true; }
    else if (seenNull) { a.fail('non-null score after null score — sort order broken'); }
}
// Among non-null, verify descending
const nonNull = allScores.filter(s => s !== null);
for (let i = 1; i < nonNull.length; i++) {
    a.ok(nonNull[i] <= nonNull[i - 1], `scores not descending at index ${i}`);
}
console.log('  ✓ sort order');

// --- excludeQuarantined flag accepted without throwing ---
const withQ = r.rankAgentsForOperation('implement', 'medium', { excludeQuarantined: false });
a.ok(Array.isArray(withQ), 'excludeQuarantined:false should return array');
console.log('  ✓ excludeQuarantined flag');

// --- excludeOverBudget is a no-op (accepted, doesn't change results or throw) ---
const withBudget = r.rankAgentsForOperation('implement', 'medium', { excludeOverBudget: true });
a.deepStrictEqual(
    withBudget.map(i => i.agentId),
    results.map(i => i.agentId),
    'excludeOverBudget should be a no-op'
);
console.log('  ✓ excludeOverBudget is no-op');

// --- rankAgentsForOperation is exported ---
a.strictEqual(typeof r.rankAgentsForOperation, 'function', 'exported from spec-recommendation');
console.log('  ✓ export');

// --- F373: rankAgentsForOperation now returns qualScore and avgCostPerSession ---
for (const item of results) {
    a.ok('qualScore' in item, `missing qualScore on ${item.agentId}`);
    a.ok('avgCostPerSession' in item, `missing avgCostPerSession on ${item.agentId}`);
    a.ok(item.qualScore === null || typeof item.qualScore === 'number', 'qualScore is number or null');
    a.ok(item.avgCostPerSession === null || typeof item.avgCostPerSession === 'number', 'avgCostPerSession is number or null');
}
console.log('  ✓ F373: qualScore + avgCostPerSession fields');

// --- F373: applyRankBadges adds badge arrays ---
a.strictEqual(typeof r.applyRankBadges, 'function', 'applyRankBadges exported');

// Simple synthetic ranked list for badge logic
const synthetic = [
    { agentId: 'cc', score: 4.5, qualScore: 5, avgCostPerSession: 0.10 },
    { agentId: 'gg', score: 4.0, qualScore: 4, avgCostPerSession: 0.05 },
    { agentId: 'cx', score: 3.8, qualScore: 3, avgCostPerSession: 0.20 },
];
const badged = r.applyRankBadges(synthetic);
a.ok(Array.isArray(badged), 'applyRankBadges returns array');
// best_value: cc (highest score = first non-null in sorted list)
a.ok(badged.find(b => b.agentId === 'cc').badges.includes('best_value'), 'cc gets best_value');
// highest_quality: cc (highest qualScore = 5)
a.ok(badged.find(b => b.agentId === 'cc').badges.includes('highest_quality'), 'cc gets highest_quality (qualScore 5)');
// fastest: gg (lowest avgCostPerSession = 0.05)
a.ok(badged.find(b => b.agentId === 'gg').badges.includes('fastest'), 'gg gets fastest');
// cx gets no badges
a.deepStrictEqual(badged.find(b => b.agentId === 'cx').badges, [], 'cx gets no badges');
console.log('  ✓ F373: applyRankBadges badge assignment');

// Empty input → no throw
a.deepStrictEqual(r.applyRankBadges([]), [], 'empty input returns []');
a.strictEqual(r.applyRankBadges(null), null, 'null input returns null');
console.log('  ✓ F373: applyRankBadges edge cases');

// No benchmark data (avgCostPerSession null) → fastest badge suppressed
const noData = [
    { agentId: 'cc', score: 4.5, qualScore: 4, avgCostPerSession: null },
    { agentId: 'gg', score: 3.0, qualScore: 3, avgCostPerSession: null },
];
r.applyRankBadges(noData);
a.ok(!noData[0].badges.includes('fastest'), 'fastest suppressed when no benchmark data');
a.ok(!noData[1].badges.includes('fastest'), 'fastest suppressed on all when no data');
console.log('  ✓ F373: fastest suppressed when no benchmark data');

console.log('  ✓ feature 372 rank-agents-for-operation tests passed');
