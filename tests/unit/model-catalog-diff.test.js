#!/usr/bin/env node
'use strict';

// REGRESSION: weekly catalog diff must classify stale OpenRouter IDs with explicit
// retire/archive proposals — feature 655.

const assert = require('assert');
const { test, report } = require('../_helpers');
const catalogDiff = require('../../lib/model-catalog-diff');

function catalog(rows) {
    return catalogDiff.buildOpenRouterCatalogIndex(rows);
}

function classify(opt, catalogIndex, extra = {}) {
    return catalogDiff.classifyRegistryModelOption(opt, { catalogIndex, ...extra });
}

test('missing provider ID → archive-candidate with proposed archived block', () => {
    const index = catalog([
        { id: 'qwen/qwen3-coder', name: 'Qwen3 Coder', supported_parameters: ['tools'] },
    ]);
    const result = classify(
        { value: 'openrouter/meta-llama/llama-4-scout', label: 'Llama 4 Scout' },
        index,
    );
    assert.strictEqual(result.status, 'archive-candidate');
    assert.strictEqual(result.recommendedAction, 'archive');
    assert.ok(result.proposedBlock.archived);
    assert.ok(result.proposedBlock.archived.reason.includes('Removed from OpenRouter'));
});

test('provider ID present but no tool support → retire-candidate', () => {
    const index = catalog([
        { id: 'z-ai/glm-4.5-air', name: 'GLM 4.5 Air', supported_parameters: ['temperature'] },
    ]);
    const result = classify(
        { value: 'openrouter/z-ai/glm-4.5-air', label: 'GLM 4.5 Air' },
        index,
    );
    assert.strictEqual(result.status, 'retire-candidate');
    assert.strictEqual(result.recommendedAction, 'quarantine');
    assert.ok(result.proposedBlock.quarantined);
    assert.ok(result.proposedBlock.quarantined.reason.includes('tools'));
});

test('superseded-by newer ID → retire-candidate with supersededBy', () => {
    const index = catalog([
        { id: 'x-ai/grok-code-fast-1', name: 'Grok Code Fast 1', supported_parameters: ['tools'] },
        { id: 'x-ai/grok-4-fast', name: 'Grok 4 Fast', supported_parameters: ['tools'] },
    ]);
    const result = classify(
        { value: 'openrouter/x-ai/grok-code-fast-1', label: 'Grok Code Fast 1' },
        index,
        { supersessionBy: { 'openrouter/x-ai/grok-code-fast-1': ['openrouter/x-ai/grok-4-fast'] } },
    );
    assert.strictEqual(result.status, 'retire-candidate');
    assert.deepStrictEqual(result.proposedBlock.quarantined.supersededBy, ['openrouter/x-ai/grok-4-fast']);
});

test('already-quarantined unchanged when catalog evidence is stable', () => {
    const index = catalog([
        { id: 'deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro', supported_parameters: ['tools'] },
    ]);
    const result = classify(
        {
            value: 'openrouter/deepseek/deepseek-v4-pro',
            label: 'DeepSeek V4 Pro',
            quarantined: {
                since: '2026-05-11',
                reason: 'Compaction loop',
                evidence: 'issue #22329',
                supersededBy: ['openrouter/deepseek/deepseek-v3.1-terminus'],
            },
        },
        index,
    );
    assert.strictEqual(result.status, 'unchanged');
    assert.strictEqual(result.proposedBlock, null);
});

test('active unchanged when present on catalog with tools', () => {
    const index = catalog([
        { id: 'deepseek/deepseek-v3.1-terminus', name: 'DeepSeek V3.1 Terminus', supported_parameters: ['tools'] },
    ]);
    const result = classify(
        { value: 'openrouter/deepseek/deepseek-v3.1-terminus', label: 'DeepSeek V3.1 Terminus' },
        index,
    );
    assert.strictEqual(result.status, 'active');
    assert.strictEqual(result.proposedBlock, null);
});

test('formatRetireCandidateReport emits stable markdown table and JSON blocks', () => {
    const index = catalog([]);
    const rows = catalogDiff.classifyModelOptions(
        [{ value: 'openrouter/example/stale', label: 'Stale Example' }],
        { catalogIndex: index },
    );
    const md = catalogDiff.formatRetireCandidateReport(rows);
    assert.ok(md.includes('## Registry retirement classification'));
    assert.ok(md.includes('archive-candidate'));
    assert.ok(md.includes('```json'));
    assert.ok(md.includes('"archived"'));
});

report();
