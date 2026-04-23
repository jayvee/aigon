#!/usr/bin/env node
// REGRESSION: spec recommendation uses complexity only; model ladder lives in agent JSON.
'use strict';
const a = require('assert');
const r = require('../../lib/spec-recommendation');
const reg = require('../../lib/agent-registry');
const FM = (c) => r.parseSpecRecommendation(`---\n${c}\n---\nx`);
a.strictEqual(FM('complexity: medium\nrecommended_models:\n  cc: { model: claude-haiku-4-5-20251001, effort: low }').complexity, 'medium');
a.ok(!('recommendedModels' in FM('complexity: low')));
a.strictEqual(r.parseSpecRecommendation('# no fm'), null);
a.strictEqual(r.parseSpecRecommendation('---\nfoo: bar\n---\n'), null);
a.strictEqual(r.readSpecRecommendation('/nope.md'), null);
const mDef = reg.getAgent('cc').cli.complexityDefaults.medium;
a.ok(mDef.model, 'cc.cli.complexityDefaults.medium.model required');
const fb = r.resolveAgentRecommendation('cc', FM('complexity: medium'));
a.deepStrictEqual([fb.model, fb.modelSource, fb.effort], [mDef.model, 'agent-default', mDef.effort]);
// Stale spec overrides must not change resolution (model IDs belong in agent templates, not specs).
const ignoreOverride = r.resolveAgentRecommendation(
    'cc',
    FM('complexity: medium\nrecommended_models:\n  cc: { model: claude-haiku-4-5-20251001, effort: low }'),
);
a.deepStrictEqual([ignoreOverride.model, ignoreOverride.modelSource], [mDef.model, 'agent-default']);
a.strictEqual(r.resolveAgentRecommendation('cc', null).modelSource, 'none');
const pl = r.buildRecommendationPayload(FM('complexity: medium'));
a.strictEqual(pl.complexity, 'medium');
for (const id of ['cc', 'cx', 'gg', 'cu']) a.ok(id in pl.agents && reg.getAgent(id).cli.complexityDefaults?.low, `${id} needs complexityDefaults`);
console.log('  ✓ feature 313 spec-recommendation tests passed');
