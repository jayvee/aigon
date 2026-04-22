#!/usr/bin/env node
// REGRESSION feature 313: spec frontmatter → per-agent {model, effort} recommendation.
// Covers: inline-map YAML parsing, fallback chain (spec → agent default → none),
//         missing frontmatter returns null, cli.complexityDefaults is populated for
//         all supported agents.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { parseFrontMatter } = require('../../lib/cli-parse');
const specRec = require('../../lib/spec-recommendation');
const agentRegistry = require('../../lib/agent-registry');

// 1. parseFrontMatter now parses inline `{ key: value, key: value }` maps.
const inline = parseFrontMatter(`---
complexity: medium
recommended_models:
  cc: { model: claude-sonnet-4-6, effort: medium }
  cu: { model: null, effort: null }
---
body
`);
assert.strictEqual(inline.data.complexity, 'medium');
assert.deepStrictEqual(inline.data.recommended_models.cc, { model: 'claude-sonnet-4-6', effort: 'medium' });
assert.deepStrictEqual(inline.data.recommended_models.cu, { model: null, effort: null });

// 2. parseSpecRecommendation returns normalised shape.
const rec = specRec.parseSpecRecommendation(`---
complexity: high
recommended_models:
  cc: { model: claude-opus-4-7, effort: high }
---
body`);
assert.strictEqual(rec.complexity, 'high');
assert.strictEqual(rec.recommendedModels.cc.model, 'claude-opus-4-7');

// 3. Missing frontmatter → null (today's behaviour preserved).
assert.strictEqual(specRec.parseSpecRecommendation('# no frontmatter here'), null);
assert.strictEqual(specRec.readSpecRecommendation('/nonexistent/path.md'), null);

// 4. Invalid complexity value is dropped (but recs kept).
const invalidComplexity = specRec.parseSpecRecommendation(`---
complexity: extremely-hard
recommended_models:
  cc: { model: claude-sonnet-4-6, effort: medium }
---`);
assert.strictEqual(invalidComplexity.complexity, null);
assert.strictEqual(invalidComplexity.recommendedModels.cc.model, 'claude-sonnet-4-6');

// 5. Fallback chain: null per-agent value falls through to cli.complexityDefaults.
const cc = agentRegistry.getAgent('cc');
assert.ok(cc?.cli?.complexityDefaults, 'cc must have cli.complexityDefaults');
const mediumDefault = cc.cli.complexityDefaults.medium;
assert.ok(mediumDefault && mediumDefault.model, 'cc medium default must have a model');

const fallbackRec = specRec.parseSpecRecommendation(`---
complexity: medium
recommended_models:
  cc: { model: null, effort: null }
---`);
const fallbackResolved = specRec.resolveAgentRecommendation('cc', fallbackRec);
assert.strictEqual(fallbackResolved.model, mediumDefault.model);
assert.strictEqual(fallbackResolved.modelSource, 'agent-default');
assert.strictEqual(fallbackResolved.effort, mediumDefault.effort);

// 6. Spec value wins over agent default.
const specWinsRec = specRec.parseSpecRecommendation(`---
complexity: medium
recommended_models:
  cc: { model: claude-haiku-4-5-20251001, effort: low }
---`);
const specWins = specRec.resolveAgentRecommendation('cc', specWinsRec);
assert.strictEqual(specWins.model, 'claude-haiku-4-5-20251001');
assert.strictEqual(specWins.modelSource, 'spec');

// 7. No complexity + no spec entry → null source.
const noneResolved = specRec.resolveAgentRecommendation('cc', null);
assert.strictEqual(noneResolved.model, null);
assert.strictEqual(noneResolved.modelSource, 'none');

// 8. All supported agents declare cli.complexityDefaults with the four buckets.
const REQUIRED_BUCKETS = ['low', 'medium', 'high', 'very-high'];
for (const agent of agentRegistry.getAllAgents()) {
    // op is optional (not-yet-active) — skip if missing, but cc/cx/gg/cu must have it.
    if (!agent.cli?.complexityDefaults) {
        assert.ok(!['cc', 'cx', 'gg', 'cu'].includes(agent.id),
            `agent ${agent.id} must declare cli.complexityDefaults`);
        continue;
    }
    for (const bucket of REQUIRED_BUCKETS) {
        assert.ok(bucket in agent.cli.complexityDefaults,
            `${agent.id}.cli.complexityDefaults must have bucket "${bucket}"`);
        const entry = agent.cli.complexityDefaults[bucket];
        assert.ok(entry && typeof entry === 'object',
            `${agent.id}.complexityDefaults.${bucket} must be an object`);
        assert.ok('model' in entry && 'effort' in entry,
            `${agent.id}.complexityDefaults.${bucket} must have model+effort keys`);
    }
}

// 9. buildRecommendationPayload returns per-agent entries for every registered agent.
const payload = specRec.buildRecommendationPayload(fallbackRec);
assert.strictEqual(payload.complexity, 'medium');
for (const agent of agentRegistry.getAllAgents()) {
    assert.ok(agent.id in payload.agents,
        `payload.agents must include ${agent.id}`);
}

// 10. readSpecRecommendation round-trip through a real file.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f313-rec-'));
try {
    const specPath = path.join(tmp, 'feature-test.md');
    fs.writeFileSync(specPath, `---
complexity: very-high
recommended_models:
  cc: { model: claude-opus-4-7[1m], effort: xhigh }
---
# Feature: test
`);
    const parsed = specRec.readSpecRecommendation(specPath);
    assert.strictEqual(parsed.complexity, 'very-high');
    assert.strictEqual(parsed.recommendedModels.cc.model, 'claude-opus-4-7[1m]');
    assert.strictEqual(parsed.recommendedModels.cc.effort, 'xhigh');
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('  ✓ feature 313 spec-recommendation tests passed');
