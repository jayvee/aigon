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
const { resolveAgentPromptBody, resolveCxPromptBody } = require('../../lib/agent-prompt-resolver');

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

test('unknown verb throws', () => {
    assert.throws(() => resolveAgentPromptBody({ agentId: 'cc', verb: 'sneeze', featureId: '01', cliConfig: {} }), /unknown verb/);
});

report();
