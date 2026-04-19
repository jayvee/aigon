#!/usr/bin/env node
// REGRESSION feature 218: cx codex launches could not find custom /prompts:
// after codex 0.117 stopped discovering them from project dirs. The resolver
// now inlines the canonical templates/generic/commands/feature-<verb>.md body
// (frontmatter stripped, $ARGUMENTS/$1 substituted) so cx stays behavior-
// equivalent to cc/gg without relying on prompt discovery. cc/gg/cu keep the
// slash-command passthrough; missing verb prompts must fall back to implement.
//
// REGRESSION commit b9c39a26 / F277: autonomous feedback injection for cx
// was an unrunnable $aigon-feature-review-check phantom command. Every agent's
// injected review-check prompt must be runnable by that agent — slash agents
// get /aigon:feature-review-check, skill-file agents get a path-pointer with
// Read instructions and NEVER emit $aigon-… or raw `aigon feature-review-check`.
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

const AGENTS_DIR = path.join(__dirname, '..', '..', 'templates', 'agents');
for (const file of fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.json'))) {
    const id = file.replace(/\.json$/, '');
    const cfg = JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, file), 'utf8'));
    const prompt = buildReviewCheckFeedbackPrompt(id, '07', { loadAgentConfig: () => cfg });
    test(`review-check injection for '${id}' matches capability (no phantom $aigon-… for any agent)`, () => {
        assert.strictEqual(typeof cfg.capabilities?.resolvesSlashCommands, 'boolean', `${id} missing flag`);
        if (cfg.capabilities.resolvesSlashCommands) {
            const prefix = cfg.placeholders?.CMD_PREFIX || '/aigon:';
            assert.ok(prompt.includes(`${prefix}feature-review-check 07`), prompt);
        } else {
            const dir = cfg.output?.commandDir || '.agents/skills';
            assert.ok(prompt.includes(`${dir}/`) && /\bRead\b/.test(prompt) && prompt.includes('aigon agent-status feedback-addressed'), prompt);
            assert.ok(!/\$aigon-feature-review-check\b/.test(prompt) && !/ aigon feature-review-check /.test(prompt), prompt);
        }
    });
}

test('review-check injection gate: capability true→slash, missing→fail-closed path-pointer', () => {
    const mk = (caps) => buildReviewCheckFeedbackPrompt('zz', '01', { loadAgentConfig: () => ({ capabilities: caps, cli: { reviewCheckPrompt: '/aigon:feature-review-check {featureId}' }, output: { commandDir: '.agents/skills' } }) });
    assert.ok(mk({ resolvesSlashCommands: true }).includes('/aigon:feature-review-check 01'));
    assert.ok(mk({}).includes('.agents/skills/') && !/\/aigon:/.test(mk({})));
});

report();
