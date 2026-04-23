#!/usr/bin/env node
// Regression for feature 301: OpenCode (op) as the first post-F246 agent
// added via the registry. Asserts the registry contract carries op onto all
// derived surfaces (install, dashboard, doctor, launch) without any net-new
// hardcoded agent branching, and that the inline prompt-delivery path
// generalises beyond cx rather than re-special-casing op.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, report } = require('../_helpers');
const agentRegistry = require('../../lib/agent-registry');
const {
    resolveAgentPromptBody,
    resolveAgentCommandPrompt,
    buildReviewCheckFeedbackPrompt,
} = require('../../lib/agent-prompt-resolver');
const { buildRawAgentCommand } = require('../../lib/worktree');

test('op is registered with OpenCode CLI + router provider family', () => {
    const op = agentRegistry.getAgent('op');
    assert.ok(op, 'op.json must be loaded into the registry');
    assert.strictEqual(op.cli.command, 'opencode');
    assert.strictEqual(op.providerFamily, 'router');
    assert.strictEqual(op.capabilities.resolvesSlashCommands, false);
    assert.strictEqual(op.capabilities.transcriptTelemetry, false);
    assert.strictEqual(op.output.format, 'skill-md');
    assert.strictEqual(op.output.commandDir, '.agents/skills');
});

test('op does not hardcode a default implement/review/eval model', () => {
    const op = agentRegistry.getAgent('op');
    const models = op.cli.models || {};
    // Model ownership stays with OpenCode's own config — Aigon passes
    // `--model` only when the user explicitly selects one via the picker.
    ['research', 'implement', 'evaluate', 'review'].forEach(taskType => {
        assert.ok(!models[taskType],
            `op.cli.models.${taskType} must not hardcode a default; got ${models[taskType]}`);
    });
});

test('op alias map resolves both "op" and "opencode"', () => {
    const aliases = agentRegistry.getAgentAliasMap();
    assert.strictEqual(aliases.op, 'op');
    assert.strictEqual(aliases.opencode, 'op');
});

test('op prompt delivery inlines template body (non-slash path)', () => {
    const op = agentRegistry.getAgent('op');
    const body = resolveAgentPromptBody({
        agentId: 'op',
        verb: 'do',
        featureId: '301',
        cliConfig: op.cli,
    });
    // Inline path returns the full template markdown, not a slash command.
    assert.ok(body.startsWith('# aigon-feature-do'), body.slice(0, 80));
    assert.ok(body.includes('301'), 'feature id must be substituted');
    assert.ok(!body.includes('$ARGUMENTS'), 'placeholders must be resolved');
    assert.ok(!body.startsWith('/aigon:'), 'must not take the slash path');
});

test('op command prompt inlines rubric-backed spec review template', () => {
    const body = resolveAgentCommandPrompt({
        agentId: 'op',
        commandName: 'feature-spec-review',
        argsString: '301',
    });
    assert.ok(body.startsWith('# aigon-feature-spec-review'));
    assert.ok(body.includes('301'));
    assert.ok(!body.includes('{{SPEC_REVIEW_RUBRIC}}'));
});

test('op review-check injection uses skill path, not phantom slash command', () => {
    const op = agentRegistry.getAgent('op');
    const prompt = buildReviewCheckFeedbackPrompt('op', '301', { loadAgentConfig: () => op });
    assert.ok(prompt.includes('.agents/skills/aigon-feature-code-review-check/SKILL.md'), prompt);
    assert.ok(!/\$aigon-/.test(prompt), 'must not emit $aigon- phantom command');
    assert.ok(!/\/aigon:/.test(prompt), 'must not emit slash command');
    assert.ok(prompt.includes('aigon agent-status feedback-addressed'), prompt);
});

test('slash-invocable agents keep slash path after generalising cx check', () => {
    // REGRESSION: generalising `agentId === 'cx'` to `!resolvesSlashCommands`
    // in the prompt resolver must not regress cc/gg/cu.
    ['cc', 'gg', 'cu'].forEach(agentId => {
        const cfg = agentRegistry.getAgent(agentId);
        const body = resolveAgentPromptBody({
            agentId,
            verb: 'do',
            featureId: '42',
            cliConfig: cfg.cli,
        });
        const prefix = cfg.placeholders?.CMD_PREFIX || '/aigon:';
        assert.ok(body.startsWith(prefix),
            `${agentId} must still take the slash path, got: ${body.slice(0, 60)}`);
        assert.ok(body.includes('42'), `${agentId} must substitute feature id`);
    });
});

test('registry-derived help surfaces use generic agent placeholders, not the legacy fixed list', () => {
    // REGRESSION: feature 301 must not reintroduce `cc|gg|cx|cu` lists on help/install surfaces after adding `op`.
    const templates = require('../../lib/templates');
    assert.strictEqual(templates.COMMAND_REGISTRY['feature-do'].argHints, '<ID> [--agent=<agent-id>] [--iterate] [--max-iterations=N] [--auto-submit] [--no-auto-submit] [--dry-run]');
    assert.strictEqual(templates.COMMAND_REGISTRY['feature-spec-review'].argHints, '<ID|slug> [--agent=<agent-id>]');
    assert.strictEqual(templates.COMMAND_REGISTRY['feature-spec-review-check'].argHints, '<ID|slug> [--agent=<agent-id>]');
    assert.strictEqual(templates.COMMAND_REGISTRY['research-spec-review'].argHints, '<ID|slug> [--agent=<agent-id>]');
    assert.strictEqual(templates.COMMAND_REGISTRY['research-spec-review-check'].argHints, '<ID|slug> [--agent=<agent-id>]');

    const featureSource = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'commands', 'feature.js'), 'utf8');
    const setupSource = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'commands', 'setup.js'), 'utf8');
    assert.ok(featureSource.includes("'feature-do': (args) => {"));
    assert.ok(setupSource.includes("Run 'aigon install-agent <agent-id>' to install."));
    assert.ok(!featureSource.includes('--agent=<cc|gg|cx|cu>'));
    assert.ok(!setupSource.includes('install-agent <cc|gg|cx|cu>'));
});

test('op spec-review launch uses a command-specific inline prompt filename', () => {
    // REGRESSION: after generalising cx's inline path to op, spec-review/check launches wrote `feature-<id>-undefined.md`.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-op-inline-'));
    try {
        const cmd = buildRawAgentCommand({
            agent: 'op',
            featureId: '301',
            path: tmp,
            repoPath: process.cwd(),
            desc: 'demo',
        }, 'spec-review');
        assert.ok(cmd.includes('feature-301-feature-spec-review.md'), cmd);
        assert.ok(!cmd.includes('feature-301-undefined.md'), cmd);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

report();
