#!/usr/bin/env node
// REGRESSION feature 313: spec frontmatter → per-agent {model, effort} recommendation.
// Covers: inline-map YAML, fallback chain (spec → agent default → none), missing
// frontmatter, required cli.complexityDefaults on supported agents.
'use strict';
const a = require('assert');
const fs = require('fs'); const path = require('path'); const os = require('os');
const { parseFrontMatter } = require('../../lib/cli-parse');
const r = require('../../lib/spec-recommendation');
const reg = require('../../lib/agent-registry');

const fm = parseFrontMatter(`---\ncomplexity: medium\nrecommended_models:\n  cc: { model: claude-sonnet-4-6, effort: medium }\n  cu: { model: null, effort: null }\n---\nx`);
a.strictEqual(fm.data.complexity, 'medium');
a.deepStrictEqual(fm.data.recommended_models.cc, { model: 'claude-sonnet-4-6', effort: 'medium' });
a.deepStrictEqual(fm.data.recommended_models.cu, { model: null, effort: null });

const rec = r.parseSpecRecommendation(`---\ncomplexity: high\nrecommended_models:\n  cc: { model: claude-opus-4-7, effort: high }\n---`);
a.strictEqual(rec.complexity, 'high');
a.strictEqual(rec.recommendedModels.cc.model, 'claude-opus-4-7');
a.strictEqual(r.parseSpecRecommendation('# no frontmatter'), null);
a.strictEqual(r.readSpecRecommendation('/nonexistent.md'), null);
const bad = r.parseSpecRecommendation(`---\ncomplexity: extremely-hard\nrecommended_models:\n  cc: { model: claude-sonnet-4-6, effort: medium }\n---`);
a.strictEqual(bad.complexity, null);
a.strictEqual(bad.recommendedModels.cc.model, 'claude-sonnet-4-6');

const cc = reg.getAgent('cc');
a.ok(cc?.cli?.complexityDefaults?.medium?.model, 'cc complexityDefaults.medium.model required');
const mDef = cc.cli.complexityDefaults.medium;

const fbRec = r.parseSpecRecommendation(`---\ncomplexity: medium\nrecommended_models:\n  cc: { model: null, effort: null }\n---`);
const fb = r.resolveAgentRecommendation('cc', fbRec);
a.strictEqual(fb.model, mDef.model); a.strictEqual(fb.modelSource, 'agent-default');
a.strictEqual(fb.effort, mDef.effort);

const sw = r.resolveAgentRecommendation('cc', r.parseSpecRecommendation(`---\ncomplexity: medium\nrecommended_models:\n  cc: { model: claude-haiku-4-5-20251001, effort: low }\n---`));
a.strictEqual(sw.model, 'claude-haiku-4-5-20251001'); a.strictEqual(sw.modelSource, 'spec');

const none = r.resolveAgentRecommendation('cc', null);
a.strictEqual(none.model, null); a.strictEqual(none.modelSource, 'none');

for (const agent of reg.getAllAgents()) {
    if (!agent.cli?.complexityDefaults) {
        a.ok(!['cc','cx','gg','cu'].includes(agent.id), `${agent.id} must declare cli.complexityDefaults`);
        continue;
    }
    for (const b of ['low','medium','high','very-high']) {
        a.ok(b in agent.cli.complexityDefaults, `${agent.id}.complexityDefaults.${b} missing`);
        const e = agent.cli.complexityDefaults[b];
        a.ok(e && 'model' in e && 'effort' in e, `${agent.id}.complexityDefaults.${b} must have model+effort`);
    }
}

const payload = r.buildRecommendationPayload(fbRec);
a.strictEqual(payload.complexity, 'medium');
for (const agent of reg.getAllAgents()) a.ok(agent.id in payload.agents, `payload.agents missing ${agent.id}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f313-'));
try {
    const p = path.join(tmp, 'feature-test.md');
    fs.writeFileSync(p, `---\ncomplexity: very-high\nrecommended_models:\n  cc: { model: claude-opus-4-7[1m], effort: xhigh }\n---\n# x\n`);
    const parsed = r.readSpecRecommendation(p);
    a.strictEqual(parsed.complexity, 'very-high');
    a.strictEqual(parsed.recommendedModels.cc.model, 'claude-opus-4-7[1m]');
    a.strictEqual(parsed.recommendedModels.cc.effort, 'xhigh');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

console.log('  ✓ feature 313 spec-recommendation tests passed');
