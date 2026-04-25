#!/usr/bin/env node
// REGRESSION F218: cx inlines template bodies (slash-command passthrough for cc/gg/cu).
// REGRESSION F277: revise injection must emit runnable commands per agent capability.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, report } = require('../_helpers');
const {
    resolveAgentCommandPrompt,
    resolveAgentPromptBody,
    resolveCxCommandBody,
    resolveCxPromptBody,
    buildReviewCheckFeedbackPrompt,
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

test('generic non-cx command prompt resolves slash command for spec review', () => {
    const out = resolveAgentCommandPrompt({ agentId: 'cc', commandName: 'feature-spec-review', argsString: '12' });
    assert.strictEqual(out, '/aigon:feature-spec-review 12');
});

for (const [desc, fn, checks] of [
    ['cx inlines stripped template body and propagates extraArgs',
        () => resolveCxPromptBody('eval', '218', '--allow-same-model-judge'),
        (out) => { assert.ok(out.startsWith('# aigon-feature-eval') && !out.startsWith('---\n')); assert.ok(!out.includes('$ARGUMENTS') && !/\$1\b/.test(out)); assert.ok(out.includes('218') && out.includes('--allow-same-model-judge')); }],
    ['cx command body inlines rubric-backed feature spec review template',
        () => resolveCxCommandBody('feature-spec-review', '12'),
        (out) => { assert.ok(out.startsWith('# aigon-feature-spec-review')); assert.ok(out.includes('## Spec Review Rubric') && !out.includes('{{SPEC_REVIEW_RUBRIC}}')); }],
    ['cx command body substitutes args in research spec revise template',
        () => resolveCxCommandBody('research-spec-revise', 'topic-slug'),
        (out) => { assert.ok(out.startsWith('# aigon-research-spec-revise')); assert.ok(out.includes('topic-slug') && !out.includes('$ARGUMENTS')); }],
]) test(desc, () => checks(fn()));

test('spec review templates explicitly forbid recursive self-invocation and generic commits', () => {
    const researchOut = resolveCxCommandBody('research-spec-review', '01 --no-launch');
    assert.ok(researchOut.includes('Do not run `aigon research-spec-review 01` again.'));
    assert.ok(researchOut.includes('Making a non-`spec-review:` commit'));

    const featureOut = resolveCxCommandBody('feature-spec-review', '12 --no-launch');
    assert.ok(featureOut.includes('Do not run `aigon feature-spec-review 12` again.'));
    assert.ok(featureOut.includes('Making a non-`spec-review:` commit'));
});

test('spec review templates explicitly forbid recursive self-invocation and generic commits', () => {
    const researchOut = resolveCxCommandBody('research-spec-review', '01 --no-launch');
    assert.ok(researchOut.includes('Do not run `aigon research-spec-review 01` again.'));
    assert.ok(researchOut.includes('Making a non-`spec-review:` commit'));

    const featureOut = resolveCxCommandBody('feature-spec-review', '12 --no-launch');
    assert.ok(featureOut.includes('Do not run `aigon feature-spec-review 12` again.'));
    assert.ok(featureOut.includes('Making a non-`spec-review:` commit'));
});

test('unknown verb throws', () => {
    assert.throws(() => resolveAgentPromptBody({ agentId: 'cc', verb: 'sneeze', featureId: '01', cliConfig: {} }), /unknown verb/);
});

const AGENTS_DIR = path.join(__dirname, '..', '..', 'templates', 'agents');
for (const file of fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.json'))) {
    const id = file.replace(/\.json$/, '');
    const cfg = JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, file), 'utf8'));
    const prompt = buildReviewCheckFeedbackPrompt(id, '07', { loadAgentConfig: () => cfg });
    test(`revise injection for '${id}' matches capability (no phantom $aigon-… for any agent)`, () => {
        assert.strictEqual(typeof cfg.capabilities?.resolvesSlashCommands, 'boolean', `${id} missing flag`);
        if (cfg.capabilities.resolvesSlashCommands) {
            const prefix = cfg.placeholders?.CMD_PREFIX || '/aigon:';
            assert.ok(prompt.includes(`${prefix}feature-code-revise 07`), prompt);
        } else {
            const dir = cfg.output?.commandDir || '.agents/skills';
            assert.ok(prompt.includes(`${dir}/`) && prompt.includes('feature-code-revise') && /\bRead\b/.test(prompt) && prompt.includes('aigon agent-status feedback-addressed'), prompt);
            assert.ok(!/\$aigon-feature-code-revise\b/.test(prompt) && !/ aigon feature-code-revise /.test(prompt), prompt);
        }
    });
}

report();
