#!/usr/bin/env node
// REGRESSION feature 313: frontmatter parser + per-agent {model,effort} fallback chain.
'use strict';
const a = require('assert');
const r = require('../../lib/spec-recommendation');
const reg = require('../../lib/agent-registry');
const FM = (c) => r.parseSpecRecommendation(`---\n${c}\n---\nx`);
a.deepStrictEqual(FM('complexity: medium\nrecommended_models:\n  cc: { model: claude-sonnet-4-6, effort: medium }\n  cu: { model: null, effort: null }').recommendedModels,
    { cc: { model: 'claude-sonnet-4-6', effort: 'medium' }, cu: { model: null, effort: null } });
a.strictEqual(r.parseSpecRecommendation('# no fm'), null);
a.strictEqual(r.readSpecRecommendation('/nope.md'), null);
const mDef = reg.getAgent('cc').cli.complexityDefaults.medium;
a.ok(mDef.model, 'cc.cli.complexityDefaults.medium.model required');
const fb = r.resolveAgentRecommendation('cc', FM('complexity: medium\nrecommended_models:\n  cc: { model: null, effort: null }'));
a.deepStrictEqual([fb.model, fb.modelSource, fb.effort], [mDef.model, 'agent-default', mDef.effort]);
const sw = r.resolveAgentRecommendation('cc', FM('complexity: medium\nrecommended_models:\n  cc: { model: claude-haiku-4-5-20251001, effort: low }'));
a.deepStrictEqual([sw.model, sw.modelSource], ['claude-haiku-4-5-20251001', 'spec']);
a.strictEqual(r.resolveAgentRecommendation('cc', null).modelSource, 'none');
const pl = r.buildRecommendationPayload(FM('complexity: medium'));
a.strictEqual(pl.complexity, 'medium');
for (const id of ['cc','cx','gg','cu']) a.ok(id in pl.agents && reg.getAgent(id).cli.complexityDefaults?.low, `${id} needs complexityDefaults`);
console.log('  ✓ feature 313 spec-recommendation tests passed');
