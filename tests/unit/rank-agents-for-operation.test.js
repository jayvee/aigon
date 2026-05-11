#!/usr/bin/env node
// F372: rankAgentsForOperation — recommender core.
// F373: qualScore, avgCostPerSession, and applyRankBadges.
'use strict';

const assert = require('assert');
const { test, report } = require('../_helpers');
const r = require('../../lib/spec-recommendation');

test('rankAgentsForOperation: shape contract — required keys and valid field types', () => {
    const results = r.rankAgentsForOperation('implement', 'medium');
    assert.ok(Array.isArray(results), 'returns an array');
    assert.ok(results.length > 0, 'non-empty for known op/complexity');
    for (const item of results) {
        for (const k of ['agentId', 'model', 'effort', 'score', 'rationale', 'confidence']) {
            assert.ok(k in item, `missing key ${k}`);
        }
        assert.ok(typeof item.agentId === 'string', 'agentId is string');
        assert.ok(['low', 'medium', 'high'].includes(item.confidence), `invalid confidence: ${item.confidence}`);
        assert.ok(typeof item.rationale === 'string' && item.rationale.length > 0, 'rationale is non-empty string');
        assert.ok(item.score === null || typeof item.score === 'number', 'score is number or null');
    }
});

test('rankAgentsForOperation: sparse cell rationale is canonical when confidence is low', () => {
    const results = r.rankAgentsForOperation('implement', 'medium');
    for (const item of results.filter(i => i.confidence === 'low')) {
        assert.strictEqual(item.rationale, 'no benchmark data — qualitative only');
    }
});

test('rankAgentsForOperation: all op × complexity combos run without throwing', () => {
    for (const op of ['draft', 'spec_review', 'implement', 'review']) {
        for (const cx of ['low', 'medium', 'high', 'very-high']) {
            const res = r.rankAgentsForOperation(op, cx);
            assert.ok(Array.isArray(res), `not array for ${op}/${cx}`);
        }
    }
});

test('rankAgentsForOperation: sort order — non-null scores before null, then descending', () => {
    const results = r.rankAgentsForOperation('implement', 'medium');
    const allScores = results.map(i => i.score);
    let seenNull = false;
    for (const s of allScores) {
        if (s === null) { seenNull = true; }
        else if (seenNull) { assert.fail('non-null score after null score — sort order broken'); }
    }
    const nonNull = allScores.filter(s => s !== null);
    for (let i = 1; i < nonNull.length; i++) {
        assert.ok(nonNull[i] <= nonNull[i - 1], `scores not descending at index ${i}`);
    }
});

test('rankAgentsForOperation: excludeQuarantined and excludeOverBudget flags accepted', () => {
    const results = r.rankAgentsForOperation('implement', 'medium');
    const withQ = r.rankAgentsForOperation('implement', 'medium', { excludeQuarantined: false });
    assert.ok(Array.isArray(withQ), 'excludeQuarantined:false should return array');
    const withBudget = r.rankAgentsForOperation('implement', 'medium', { excludeOverBudget: true });
    assert.deepStrictEqual(
        withBudget.map(i => i.agentId),
        results.map(i => i.agentId),
        'excludeOverBudget should be a no-op',
    );
});

test('rankAgentsForOperation (F373): qualScore and avgCostPerSession fields on every item', () => {
    const results = r.rankAgentsForOperation('implement', 'medium');
    for (const item of results) {
        assert.ok('qualScore' in item, `missing qualScore on ${item.agentId}`);
        assert.ok('avgCostPerSession' in item, `missing avgCostPerSession on ${item.agentId}`);
        assert.ok(item.qualScore === null || typeof item.qualScore === 'number', 'qualScore is number or null');
        assert.ok(item.avgCostPerSession === null || typeof item.avgCostPerSession === 'number', 'avgCostPerSession is number or null');
    }
});

test('applyRankBadges (F373): best_value, highest_quality, fastest assigned correctly', () => {
    assert.strictEqual(typeof r.applyRankBadges, 'function', 'applyRankBadges exported');
    const synthetic = [
        { agentId: 'cc', score: 4.5, qualScore: 5, avgCostPerSession: 0.10 },
        { agentId: 'gg', score: 4.0, qualScore: 4, avgCostPerSession: 0.05 },
        { agentId: 'cx', score: 3.8, qualScore: 3, avgCostPerSession: 0.20 },
    ];
    const badged = r.applyRankBadges(synthetic);
    assert.ok(Array.isArray(badged), 'applyRankBadges returns array');
    assert.ok(badged.find(b => b.agentId === 'cc').badges.includes('best_value'), 'cc gets best_value');
    assert.ok(badged.find(b => b.agentId === 'cc').badges.includes('highest_quality'), 'cc gets highest_quality');
    assert.ok(badged.find(b => b.agentId === 'gg').badges.includes('fastest'), 'gg gets fastest');
    assert.deepStrictEqual(badged.find(b => b.agentId === 'cx').badges, [], 'cx gets no badges');
});

test('applyRankBadges (F373): edge cases — empty array and null input', () => {
    assert.deepStrictEqual(r.applyRankBadges([]), [], 'empty input returns []');
    assert.strictEqual(r.applyRankBadges(null), null, 'null input returns null');
});

test('applyRankBadges (F373): fastest badge suppressed when all avgCostPerSession are null', () => {
    const noData = [
        { agentId: 'cc', score: 4.5, qualScore: 4, avgCostPerSession: null },
        { agentId: 'gg', score: 3.0, qualScore: 3, avgCostPerSession: null },
    ];
    r.applyRankBadges(noData);
    assert.ok(!noData[0].badges.includes('fastest'), 'fastest suppressed when no benchmark data');
    assert.ok(!noData[1].badges.includes('fastest'), 'fastest suppressed on all when no data');
});

report();
