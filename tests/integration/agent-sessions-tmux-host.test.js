#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { test, report } = require('../_helpers');
const { createTmuxSessionHost } = require('../../lib/agent-sessions/hosts');
const {
    VALID_TMUX_ROLES,
    buildTmuxSessionName,
    parseTmuxSessionName,
} = require('../../lib/agent-sessions/names');

// --- 1. Session name round-trip for every current role ----------------------

test('tmux session name round-trips for all current roles', () => {
    const roleAgentRoles = ['do', 'eval', 'review', 'revise', 'spec-review', 'spec-revise', 'spec-check', 'close'];
    for (const role of roleAgentRoles) {
        const name = buildTmuxSessionName('42', 'cx', { repo: 'aigon', role, entityType: 'f', desc: 'demo-feature' });
        const parsed = parseTmuxSessionName(name);
        assert.ok(parsed, `parse failed for role ${role}: ${name}`);
        assert.strictEqual(parsed.type, 'f', `type for ${role}`);
        assert.strictEqual(parsed.id, '42', `id for ${role}`);
        // eval omits the agent suffix in the legacy form; parser reports agent null there.
        if (role === 'eval') {
            assert.strictEqual(parsed.role, 'eval');
        } else {
            assert.strictEqual(parsed.role, role, `role for ${role}`);
            assert.strictEqual(parsed.agent, 'cx', `agent for ${role}`);
        }
    }
    // 'auto' is agent-less.
    const autoName = buildTmuxSessionName('42', null, { repo: 'aigon', role: 'auto', entityType: 'f' });
    const autoParsed = parseTmuxSessionName(autoName);
    assert.strictEqual(autoParsed.role, 'auto');
    assert.strictEqual(autoParsed.agent, null);
    assert.deepStrictEqual([...VALID_TMUX_ROLES].sort(), [
        'auto', 'close', 'do', 'eval', 'review', 'revise', 'spec-check', 'spec-review', 'spec-revise',
    ]);
});

// --- 2. deliverOperatorMessage prefers tmuxId; falls back to name ------------

function recordingTmux(handler) {
    const ops = [];
    const runTmux = (args, opts = {}) => {
        ops.push({ args, input: opts.input || null });
        return handler(args, opts) || { status: 0, stdout: '', stderr: '' };
    };
    return { ops, runTmux };
}

test('deliverOperatorMessage prefers tmuxId and falls back to the sidecar name', () => {
    for (const [tmuxId, target] of [['$77', '$77'], [null, 'aigon-f42-do-cx']]) {
        let captureCount = 0;
        const { ops, runTmux } = recordingTmux((args) => {
            if (args[0] === 'list-sessions') return { status: 0, stdout: '$77\n$78', stderr: '' };
            if (args[0] === 'capture-pane') {
                captureCount += 1;
                return { status: 0, stdout: captureCount === 1 ? '> hello' : '⠼ Thinking...', stderr: '' };
            }
            return { status: 0, stdout: '', stderr: '' };
        });
        const host = createTmuxSessionHost({ runTmux });
        const result = host.deliverOperatorMessage(
            { sessionName: 'aigon-f42-do-cx', tmuxId }, 'hello',
            { transport: { submitKey: 'Enter', submitAttempts: 1, retryDelayMs: 0, successPatterns: ['Thinking...'], promptPlaceholder: '' } }
        );
        assert.strictEqual(result.ok, true);
        const paste = ops.find(op => op.args[0] === 'paste-buffer');
        assert.strictEqual(paste.args[paste.args.indexOf('-t') + 1], target);
        assert.strictEqual(ops.some(op => op.args[0] === 'list-sessions'), Boolean(tmuxId));
    }
});

// --- 3. getConsoleSnapshot returns a normalized DTO --------------------------

test('getConsoleSnapshot returns alive snapshot with lines, dead when missing', () => {
    const aliveHost = createTmuxSessionHost({
        tmuxSessionExists: () => true,
        runTmux: (args) => args[0] === 'capture-pane'
            ? { status: 0, stdout: 'line a\nline b\nline c', stderr: '' }
            : { status: 0, stdout: '', stderr: '' },
    });
    const snap = aliveHost.getConsoleSnapshot('aigon-f42-do-cx');
    assert.strictEqual(snap.alive, true);
    assert.deepStrictEqual(snap.lines, ['line a', 'line b', 'line c']);

    const deadHost = createTmuxSessionHost({ tmuxSessionExists: () => false, runTmux: () => ({ status: 0, stdout: '' }) });
    const dead = deadHost.getConsoleSnapshot('aigon-f42-do-cx');
    assert.strictEqual(dead.alive, false);
    assert.deepStrictEqual(dead.lines, []);
});

// --- 3b. startSession issues the expected tmux new-session + returns ids ------

test('startSession creates a detached session and returns durable ids', () => {
    const { ops, runTmux } = recordingTmux((args) => {
        if (args[0] === 'display-message') return { status: 0, stdout: '$314__AIGON_SEP__99117', stderr: '' };
        return { status: 0, stdout: '', stderr: '' };
    });
    const host = createTmuxSessionHost({ runTmux });
    const result = host.startSession({
        sessionId: 'aigon-f42-do-cx',
        sessionName: 'aigon-f42-do-cx',
        cwd: '/tmp/wt',
        command: 'echo hi && claude',
        agent: { id: 'cx' },
        entityType: 'f',
        entityId: '42',
        role: 'do',
    });
    // new-session is the first op with -d -s <name> -c <cwd> and a bash -lc wrapper.
    const create = ops[0];
    assert.strictEqual(create.args[0], 'new-session');
    assert.strictEqual(create.args[create.args.indexOf('-s') + 1], 'aigon-f42-do-cx');
    assert.strictEqual(create.args[create.args.indexOf('-c') + 1], '/tmp/wt');
    assert.ok(create.args[create.args.length - 1].startsWith('bash -lc '));
    // durable ids parsed from display-message.
    assert.strictEqual(result.tmuxId, '$314');
    assert.strictEqual(result.shellPid, 99117);
    assert.strictEqual(result.host.kind, 'tmux');
    assert.strictEqual(result.host.handle.tmuxId, '$314');
});

// --- 4. openConsole builds the attach command --------------------------------

test('openConsole builds a tmux attach command', () => {
    const host = createTmuxSessionHost({ runTmux: () => ({ status: 0, stdout: '' }) });
    const { command, sessionName } = host.openConsole({ sessionName: 'aigon-f42-do-cx' });
    assert.strictEqual(sessionName, 'aigon-f42-do-cx');
    assert.match(command, /^tmux attach -t /);
    assert.ok(command.includes('aigon-f42-do-cx'));
});

// --- 5. Codex wrapped-composer nudge confirmation (F649) ---------------------

const CODEX_LONG_NUDGE = 'Please continue with the review and finish the remaining acceptance criteria for this feature';

// REGRESSION: Codex reflows long nudges across bordered composer lines — verbatim includes() fails.
const CODEX_WRAPPED_COMPOSER_PANE = [
    'some prior output',
    '┌──────────────────────────────────────────────┐',
    '│ › Please continue with the review and finish │',
    '│   the remaining acceptance criteria for this │',
    '│   feature                                    │',
    '└──────────────────────────────────────────────┘',
].join('\n');

test('deliverOperatorMessage submits Enter for Codex wrapped composer and succeeds', () => {
    let captureCount = 0;
    const { ops, runTmux } = recordingTmux((args) => {
        if (args[0] === 'capture-pane') {
            captureCount += 1;
            if (captureCount === 1) {
                return { status: 0, stdout: CODEX_WRAPPED_COMPOSER_PANE, stderr: '' };
            }
            return { status: 0, stdout: '⠼ Thinking...\n› ', stderr: '' };
        }
        return { status: 0, stdout: '', stderr: '' };
    });
    const host = createTmuxSessionHost({ runTmux });
    const transport = { submitKey: 'Enter', submitAttempts: 2, retryDelayMs: 0, successPatterns: [], promptPlaceholder: '' };
    const result = host.deliverOperatorMessage(
        { sessionName: 'aigon-f633-review-cx', tmuxId: null },
        CODEX_LONG_NUDGE,
        { transport }
    );
    assert.strictEqual(result.ok, true);
    const sendKeys = ops.filter(op => op.args[0] === 'send-keys');
    assert.ok(sendKeys.length >= 1, 'submit key must be sent after paste');
    assert.strictEqual(sendKeys[0].args[sendKeys[0].args.indexOf('-t') + 1], 'aigon-f633-review-cx');
    assert.strictEqual(sendKeys[0].args[sendKeys[0].args.length - 1], 'C-m');
});

test('deliverOperatorMessage still submits when paste echo is uncertain but submit clears composer', () => {
    let captureCount = 0;
    const garbledPane = '┌──────┐\n│ › ?? │\n└──────┘';
    const { ops, runTmux } = recordingTmux((args) => {
        if (args[0] === 'capture-pane') {
            captureCount += 1;
            if (captureCount === 1) return { status: 0, stdout: garbledPane, stderr: '' };
            return { status: 0, stdout: '⠼ Working...\n› ', stderr: '' };
        }
        return { status: 0, stdout: '', stderr: '' };
    });
    const host = createTmuxSessionHost({ runTmux });
    const result = host.deliverOperatorMessage(
        { sessionName: 'aigon-f42-do-cx', tmuxId: null },
        'hello',
        { transport: { submitKey: 'Enter', submitAttempts: 1, retryDelayMs: 0, successPatterns: [], promptPlaceholder: '' } }
    );
    assert.strictEqual(result.ok, true);
    assert.ok(ops.some(op => op.args[0] === 'send-keys'), 'submit must run even when echo match is uncertain');
});

test('deliverOperatorMessage throws with paneTail only after submit attempts fail', () => {
    let captureCount = 0;
    const { runTmux } = recordingTmux((args) => {
        if (args[0] === 'capture-pane') {
            captureCount += 1;
            return { status: 0, stdout: CODEX_WRAPPED_COMPOSER_PANE, stderr: '' };
        }
        return { status: 0, stdout: '', stderr: '' };
    });
    const host = createTmuxSessionHost({ runTmux });
    let thrown = null;
    try {
        host.deliverOperatorMessage(
            { sessionName: 'aigon-f633-review-cx', tmuxId: null },
            CODEX_LONG_NUDGE,
            { transport: { submitKey: 'Enter', submitAttempts: 1, retryDelayMs: 0, successPatterns: [], promptPlaceholder: '' } }
        );
    } catch (err) {
        thrown = err;
    }
    assert.ok(thrown, 'expected delivery to fail when submit cannot clear composer');
    assert.ok(thrown.paneTail, 'error must include pane context for telemetry');
    assert.ok(captureCount >= 2, 'submit path must capture pane after Enter');
});

report();
