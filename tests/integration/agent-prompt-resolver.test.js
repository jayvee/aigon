#!/usr/bin/env node
// REGRESSION feature 218: cx codex launches could not find custom /prompts:
// after codex 0.117 stopped discovering them from project dirs. The resolver
// now inlines the canonical templates/generic/commands/feature-<verb>.md body
// (frontmatter stripped, $ARGUMENTS/$1 substituted) so cx stays behavior-
// equivalent to cc/gg without relying on prompt discovery. cc/gg/cu keep the
// slash-command passthrough; missing verb prompts must fall back to implement.
'use strict';

const assert = require('assert');
const { test, report } = require('../_helpers');
const {
    resolveAgentCommandPrompt,
    resolveAgentPromptBody,
    resolveCxCommandBody,
    resolveCxPromptBody,
} = require('../../lib/agent-prompt-resolver');

for (const [desc, args, expected] of [
    ['cc do substitutes {featureId}',
        { agentId: 'cc', verb: 'do', featureId: '07', cliConfig: { implementPrompt: '/aigon:feature-do {featureId}' } },
        '/aigon:feature-do 07'],
    ['cc eval appends extraArgs',
        { agentId: 'cc', verb: 'eval', featureId: '12', extraArgs: '--allow-same-model-judge',
          cliConfig: { evalPrompt: '/aigon:feature-eval {featureId}' } },
        '/aigon:feature-eval 12 --allow-same-model-judge'],
]) test(desc, () => assert.strictEqual(resolveAgentPromptBody(args), expected));

test('cx inlines stripped template body and propagates extraArgs', () => {
    const out = resolveCxPromptBody('eval', '218', '--allow-same-model-judge');
    assert.ok(out.startsWith('# aigon-feature-eval') && !out.startsWith('---\n'));
    assert.ok(!out.includes('$ARGUMENTS') && !/\$1\b/.test(out));
    assert.ok(out.includes('218') && out.includes('--allow-same-model-judge'));
});

test('generic non-cx command prompt resolves slash command for spec review', () => {
    const out = resolveAgentCommandPrompt({ agentId: 'cc', commandName: 'feature-spec-review', argsString: '12' });
    assert.strictEqual(out, '/aigon:feature-spec-review 12');
});

test('cx command prompt inlines rubric-backed feature spec review template', () => {
    const out = resolveCxCommandBody('feature-spec-review', '12');
    assert.ok(out.startsWith('# aigon-feature-spec-review'));
    assert.ok(out.includes('## Spec Review Rubric'));
    assert.ok(!out.includes('{{SPEC_REVIEW_RUBRIC}}'));
});

test('cx command prompt substitutes args in research spec review check template', () => {
    const out = resolveCxCommandBody('research-spec-review-check', 'topic-slug');
    assert.ok(out.startsWith('# aigon-research-spec-review-check'));
    assert.ok(out.includes('topic-slug'));
    assert.ok(!out.includes('$ARGUMENTS'));
});

test('unknown verb throws', () => {
    assert.throws(() => resolveAgentPromptBody({ agentId: 'cc', verb: 'sneeze', featureId: '01', cliConfig: {} }), /unknown verb/);
});

report();
