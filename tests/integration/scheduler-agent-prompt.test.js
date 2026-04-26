#!/usr/bin/env node
'use strict';

// Tests for F379: scheduler `agent_prompt` kind — payload validation, argv,
// schedulability short-circuit, and cron-based re-enqueue.

const assert = require('assert');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');
const sk = require('../../lib/scheduled-kickoff');
const cronParse = require('../../lib/cron-parse');
const agentRegistry = require('../../lib/agent-registry');

test('validateAgentPromptPayload accepts a well-formed agent_prompt', () => {
    const r = sk.validateAgentPromptPayload(
        { agentId: 'cc', prompt: '/security-review', label: 'security-review-weekly', cron: '0 6 * * 1' },
        agentRegistry
    );
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.normalized.agentId, 'cc');
    assert.strictEqual(r.normalized.prompt, '/security-review');
    assert.strictEqual(r.normalized.label, 'security-review-weekly');
    assert.strictEqual(r.normalized.cron, '0 6 * * 1');
});

test('validateAgentPromptPayload rejects unknown agents', () => {
    const r = sk.validateAgentPromptPayload({ agentId: 'zz', prompt: 'hi' }, agentRegistry);
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /Unknown agent/);
});

test('validateAgentPromptPayload rejects empty prompts', () => {
    const r = sk.validateAgentPromptPayload({ agentId: 'cc', prompt: '   ' }, agentRegistry);
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /prompt is required/);
});

test('validateAgentPromptPayload rejects invalid label slugs', () => {
    const r = sk.validateAgentPromptPayload({ agentId: 'cc', prompt: 'hi', label: 'Has Spaces!' }, agentRegistry);
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /label must match/);
});

test('validateAgentPromptPayload rejects labels longer than 60 chars', () => {
    const r = sk.validateAgentPromptPayload({
        agentId: 'cc', prompt: 'hi', label: 'a'.repeat(61),
    }, agentRegistry);
    assert.strictEqual(r.ok, false);
});

test('validateAgentPromptPayload auto-generates a label when omitted', () => {
    const r = sk.validateAgentPromptPayload({ agentId: 'cc', prompt: 'hi' }, agentRegistry);
    assert.strictEqual(r.ok, true);
    assert.match(r.normalized.label, /^prompt-/);
});

test('validateAgentPromptPayload rejects invalid cron expressions', () => {
    const r = sk.validateAgentPromptPayload(
        { agentId: 'cc', prompt: 'hi', cron: 'not a cron' },
        agentRegistry
    );
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /invalid cron/);
});

test('assertEntitySchedulable short-circuits agent_prompt and validates label only', () => {
    const ok = sk.assertEntitySchedulable('/tmp/no-such-repo', sk.AGENT_PROMPT_KIND, 'security-review-weekly');
    assert.strictEqual(ok.ok, true);
    const bad = sk.assertEntitySchedulable('/tmp/no-such-repo', sk.AGENT_PROMPT_KIND, 'BAD LABEL');
    assert.strictEqual(bad.ok, false);
});

test('buildAgentPromptArgv builds the agent-launch CLI command', () => {
    const argv = sk.buildAgentPromptArgv('/repo', {
        agentId: 'cc',
        prompt: '/security-review',
        label: 'security-review-weekly',
        cron: '0 6 * * 1',
    });
    assert.deepStrictEqual(argv, [
        'agent-launch',
        '--agent', 'cc',
        '--repo', '/repo',
        '--prompt', '/security-review',
        '--label', 'security-review-weekly',
    ]);
});

test('addJob persists agent_prompt with label as entityId', () => withTempDir('aigon-sk-ap-', (repo) => {
    const r = sk.addJob(repo, {
        kind: sk.AGENT_PROMPT_KIND,
        runAt: '2099-01-01T00:00:00Z',
        payload: { agentId: 'cc', prompt: '/security-review', label: 'security-weekly' },
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.job.entityId, 'security-weekly');
    assert.strictEqual(r.job.kind, sk.AGENT_PROMPT_KIND);
    assert.strictEqual(r.job.payload.cron, null);
}));

test('addJob rejects agent_prompt with malformed cron', () => withTempDir('aigon-sk-ap-', (repo) => {
    const r = sk.addJob(repo, {
        kind: sk.AGENT_PROMPT_KIND,
        runAt: '2099-01-01T00:00:00Z',
        payload: { agentId: 'cc', prompt: 'hi', label: 'x', cron: 'foo bar' },
    });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /invalid cron/);
}));

test('processRepoDueJobs re-enqueues agent_prompt when cron is set', () => withTempDir('aigon-sk-ap-', (repo) => {
    const past = '2020-01-01T00:00:00Z';
    const cliEntry = path.join(__dirname, '../../aigon-cli.js');
    const spawns = [];
    const spawnSyncImpl = (cmd, argv) => { spawns.push(argv); return { status: 0, stdout: '', stderr: '' }; };

    const r = sk.addJob(repo, {
        kind: sk.AGENT_PROMPT_KIND,
        runAt: past,
        payload: { agentId: 'cc', prompt: '/security-review', label: 'sec-weekly', cron: '0 6 * * 1' },
    });
    assert.strictEqual(r.ok, true);

    sk.processRepoDueJobs(repo, { now: () => Date.now(), spawnSyncImpl, cliEntryPath: cliEntry });
    assert.strictEqual(spawns.length, 1, 'first fire spawned exactly once');

    // After fire, store should contain one fired + one new pending (re-armed).
    const all = sk.listJobs(repo, { includeAll: true });
    const fired = all.filter(j => j.status === 'fired');
    const pending = all.filter(j => j.status === 'pending');
    assert.strictEqual(fired.length, 1);
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].kind, sk.AGENT_PROMPT_KIND);
    assert.strictEqual(pending[0].entityId, 'sec-weekly');
    assert.strictEqual(pending[0].payload.cron, '0 6 * * 1');
    // The re-armed runAt must be strictly greater than the fired runAt.
    assert.ok(new Date(pending[0].runAt).getTime() > new Date(fired[0].runAt).getTime());
}));

test('processRepoDueJobs does NOT re-enqueue agent_prompt when cron is absent', () => withTempDir('aigon-sk-ap-', (repo) => {
    const past = '2020-01-01T00:00:00Z';
    const cliEntry = path.join(__dirname, '../../aigon-cli.js');
    const spawnSyncImpl = () => ({ status: 0, stdout: '', stderr: '' });

    sk.addJob(repo, {
        kind: sk.AGENT_PROMPT_KIND,
        runAt: past,
        payload: { agentId: 'cc', prompt: '/security-review', label: 'one-shot' },
    });
    sk.processRepoDueJobs(repo, { now: () => Date.now(), spawnSyncImpl, cliEntryPath: cliEntry });
    const all = sk.listJobs(repo, { includeAll: true });
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0].status, 'fired');
}));

test('cron parser computes next Monday 06:00 UTC', () => {
    const parsed = cronParse.parseCron('0 6 * * 1');
    // Sun 2026-04-26 12:00:00 UTC → next Monday 2026-04-27 06:00:00 UTC.
    const fromMs = Date.UTC(2026, 3, 26, 12, 0, 0);
    const next = cronParse.nextTime(parsed, fromMs);
    const d = new Date(next);
    assert.strictEqual(d.getUTCDay(), 1, 'is Monday');
    assert.strictEqual(d.getUTCHours(), 6);
    assert.strictEqual(d.getUTCMinutes(), 0);
    assert.strictEqual(d.getUTCFullYear(), 2026);
    assert.strictEqual(d.getUTCMonth(), 3); // April
    assert.strictEqual(d.getUTCDate(), 27);
});

test('cron parser supports star, range, list, and step', () => {
    const p1 = cronParse.parseCron('*/15 9-17 * * 1-5');
    const fromMs = Date.UTC(2026, 3, 27, 9, 7, 0); // Mon 09:07
    const next = cronParse.nextTime(p1, fromMs);
    const d = new Date(next);
    assert.strictEqual(d.getUTCMinutes(), 15);
    assert.strictEqual(d.getUTCHours(), 9);
});

test('agent-launch is registered in COMMAND_REGISTRY and command map', () => {
    const templates = require('../../lib/templates');
    assert.ok(templates.COMMAND_REGISTRY['agent-launch'], 'agent-launch must be in COMMAND_REGISTRY');
    assert.ok(templates.COMMANDS_DISABLE_MODEL_INVOCATION.has('agent-launch'));
    const shared = require('../../lib/commands/shared');
    const all = shared.createAllCommands();
    assert.strictEqual(typeof all['agent-launch'], 'function');
});

report();
