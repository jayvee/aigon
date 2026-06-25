#!/usr/bin/env node
// REGRESSION: spec recommendation uses complexity only; model ladder lives in agent JSON.
// F313: stale recommended_models overrides in spec frontmatter are ignored — agent template wins.
'use strict';

const assert = require('assert');
const { test, report } = require('../_helpers');
const r = require('../../lib/spec-recommendation');
const reg = require('../../lib/agent-registry');

const FM = (c) => r.parseSpecRecommendation(`---\n${c}\n---\nx`);

test('parseSpecRecommendation: extracts complexity from YAML frontmatter', () => {
    assert.strictEqual(FM('complexity: medium\nrecommended_models:\n  cc: { model: claude-haiku-4-5-20251001, effort: low }').complexity, 'medium');
});

test('parseSpecRecommendation: no recommendedModels key when only complexity is present', () => {
    assert.ok(!('recommendedModels' in FM('complexity: low')));
});

test('parseSpecRecommendation: returns null for spec with no frontmatter', () => {
    assert.strictEqual(r.parseSpecRecommendation('# no fm'), null);
});

test('parseSpecRecommendation: returns null for frontmatter with no complexity key', () => {
    assert.strictEqual(r.parseSpecRecommendation('---\nfoo: bar\n---\n'), null);
});

test('readSpecRecommendation: returns null for non-existent path', () => {
    assert.strictEqual(r.readSpecRecommendation('/nope.md'), null);
});

test('resolveAgentRecommendation: resolves model from agent complexityDefaults for medium complexity', () => {
    const mDef = reg.getAgent('cc').cli.complexityDefaults.medium;
    assert.ok(mDef.model, 'cc.cli.complexityDefaults.medium.model required');
    const fb = r.resolveAgentRecommendation('cc', FM('complexity: medium'));
    assert.deepStrictEqual([fb.model, fb.modelSource, fb.effort], [mDef.model, 'agent-default', mDef.effort]);
});

test('resolveAgentRecommendation: stale spec overrides do not change model resolution (F313)', () => {
    // Model IDs belong in agent templates, not specs — stale overrides must be ignored.
    const mDef = reg.getAgent('cc').cli.complexityDefaults.medium;
    const ignoreOverride = r.resolveAgentRecommendation(
        'cc',
        FM('complexity: medium\nrecommended_models:\n  cc: { model: claude-haiku-4-5-20251001, effort: low }'),
    );
    assert.deepStrictEqual([ignoreOverride.model, ignoreOverride.modelSource], [mDef.model, 'agent-default']);
});

test('resolveAgentRecommendation: returns modelSource=none for null spec', () => {
    assert.strictEqual(r.resolveAgentRecommendation('cc', null).modelSource, 'none');
});

test('buildRecommendationPayload: all active agent IDs present and have complexityDefaults', () => {
    const pl = r.buildRecommendationPayload(FM('complexity: medium'));
    assert.strictEqual(pl.complexity, 'medium');
    for (const id of ['cc', 'cx', 'ag', 'cu']) {
        assert.ok(id in pl.agents && reg.getAgent(id).cli.complexityDefaults?.low, `${id} needs complexityDefaults`);
    }
});

test('buildRecommendationPayload: deactivated gg is excluded', () => {
    // REGRESSION: gg has no cli.complexityDefaults after deactivation (F592) —
    // recommendations must not be built for agents that can't be launched.
    const pl = r.buildRecommendationPayload(FM('complexity: medium'));
    assert.ok(!('gg' in pl.agents), 'gg should not appear in the recommendation payload');
});

report();
