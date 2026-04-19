#!/usr/bin/env node
// REGRESSION: commit b9c39a26 / autonomous feedback injection for cx was
// an unrunnable phantom command — see F273 session log for details.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, report } = require('../_helpers');
const { buildReviewCheckFeedbackPrompt } = require('../../lib/agent-prompt-resolver');

const AGENTS_DIR = path.join(__dirname, '..', '..', 'templates', 'agents');
for (const file of fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.json'))) {
    const id = file.replace(/\.json$/, '');
    const cfg = JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, file), 'utf8'));
    const prompt = buildReviewCheckFeedbackPrompt(id, '07', { loadAgentConfig: () => cfg });
    test(`agent '${id}' injection matches capability`, () => {
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

test('injected config controls gating: true→slash, missing→fail-closed path-pointer', () => {
    const mk = (caps) => buildReviewCheckFeedbackPrompt('zz', '01', { loadAgentConfig: () => ({ capabilities: caps, cli: { reviewCheckPrompt: '/aigon:feature-review-check {featureId}' }, output: { commandDir: '.agents/skills' } }) });
    assert.ok(mk({ resolvesSlashCommands: true }).includes('/aigon:feature-review-check 01'));
    assert.ok(mk({}).includes('.agents/skills/') && !/\/aigon:/.test(mk({})));
});

report();
