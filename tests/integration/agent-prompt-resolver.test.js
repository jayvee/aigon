#!/usr/bin/env node
/**
 * Unit tests for lib/agent-prompt-resolver.
 *
 * Covers:
 *   - cc/gg/cu passthrough returns the slash-command string with
 *     {featureId} substituted (legacy behavior preserved).
 *   - cx returns the full markdown body of the canonical template
 *     with frontmatter stripped, sentinel line preserved, and
 *     $ARGUMENTS / $1 tokens replaced by the real feature id.
 *   - extraArgs propagates through both paths.
 */

'use strict';

const assert = require('assert');
const { test, report } = require('../_helpers');
const { resolveAgentPromptBody, resolveCxPromptBody } = require('../../lib/agent-prompt-resolver');

console.log('\n── agent-prompt-resolver ─────────────────────────────────');

test('cc passthrough substitutes {featureId}', () => {
    const out = resolveAgentPromptBody({
        agentId: 'cc',
        verb: 'do',
        featureId: '07',
        cliConfig: { implementPrompt: '/aigon:feature-do {featureId}' },
    });
    assert.strictEqual(out, '/aigon:feature-do 07');
});

test('cc passthrough appends extraArgs', () => {
    const out = resolveAgentPromptBody({
        agentId: 'cc',
        verb: 'eval',
        featureId: '12',
        extraArgs: '--allow-same-model-judge',
        cliConfig: { evalPrompt: '/aigon:feature-eval {featureId}' },
    });
    assert.strictEqual(out, '/aigon:feature-eval 12 --allow-same-model-judge');
});

test('cc review verb falls back to implementPrompt when reviewPrompt missing', () => {
    const out = resolveAgentPromptBody({
        agentId: 'cc',
        verb: 'review',
        featureId: '03',
        cliConfig: { implementPrompt: '/aigon:feature-do {featureId}' },
    });
    // No reviewPrompt → falls back to implementPrompt
    assert.strictEqual(out, '/aigon:feature-do 03');
});

test('cx returns markdown body with sentinel line', () => {
    const out = resolveCxPromptBody('do', '218');
    assert.ok(out.startsWith('# aigon-feature-do'),
        `Expected sentinel '# aigon-feature-do' at start, got: ${out.slice(0, 60)}`);
});

test('cx body has no description HTML comment', () => {
    const out = resolveCxPromptBody('do', '218');
    assert.ok(!out.includes('<!-- description'),
        'description comment should be stripped');
});

test('cx body has no YAML frontmatter', () => {
    const out = resolveCxPromptBody('eval', '218');
    assert.ok(!out.startsWith('---\n'),
        'YAML frontmatter should be stripped');
});

test('cx substitutes $ARGUMENTS / $1 with the feature id', () => {
    const out = resolveCxPromptBody('do', '218');
    assert.ok(!out.includes('$ARGUMENTS'),
        '$ARGUMENTS token should be substituted');
    assert.ok(!/\$1\b/.test(out),
        '$1 token should be substituted');
    assert.ok(out.includes('218'), 'feature id should appear in body');
});

test('cx eval body propagates extraArgs through $ARGUMENTS', () => {
    const out = resolveCxPromptBody('eval', '218', '--allow-same-model-judge');
    assert.ok(out.includes('--allow-same-model-judge'),
        'extraArgs should be substituted into $ARGUMENTS');
    assert.ok(out.includes('218'), 'feature id should appear in body');
});

test('cx review body uses the feature-review template', () => {
    const out = resolveCxPromptBody('review', '99');
    assert.ok(out.includes('feature-review') || out.toLowerCase().includes('review'),
        'review template body should reference review');
});

test('cx via resolveAgentPromptBody routes through cx path', () => {
    const out = resolveAgentPromptBody({
        agentId: 'cx',
        verb: 'do',
        featureId: '07',
    });
    assert.ok(out.startsWith('# aigon-feature-do'),
        'cx routing should return template body');
});

test('unknown verb throws', () => {
    assert.throws(() => {
        resolveAgentPromptBody({ agentId: 'cc', verb: 'sneeze', featureId: '01', cliConfig: {} });
    }, /unknown verb/);
});

report();
