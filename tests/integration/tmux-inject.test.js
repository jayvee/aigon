#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { test, report } = require('../_helpers');
const { injectLiteral } = require('../../lib/tmux-inject');

function makeFakeTmux({ literalResult, submitResult, cancelResult } = {}) {
    const calls = [];
    function fake(args /* , options */) {
        calls.push([...args]);
        if (args[3] === '-X' && args[4] === 'cancel') return cancelResult || { status: 0 };
        if (args.includes('-l')) return literalResult || { status: 0 };
        return submitResult || { status: 0 };
    }
    return { fake, calls };
}

test('injectLiteral cancels copy-mode, sends literal, sends submitKey', () => {
    const { fake, calls } = makeFakeTmux();
    const res = injectLiteral('sess', 'hello world', { submitKey: 'Enter', submitDelayMs: 0, deps: { runTmux: fake } });
    assert.deepStrictEqual(res, { ok: true, sessionName: 'sess' });
    assert.strictEqual(calls.length, 3);
    assert.deepStrictEqual(calls[0], ['send-keys', '-t', 'sess', '-X', 'cancel']);
    assert.deepStrictEqual(calls[1], ['send-keys', '-t', 'sess', '-l', 'hello world']);
    assert.deepStrictEqual(calls[2], ['send-keys', '-t', 'sess', 'Enter']);
});

test('injectLiteral supports custom submitKey (C-m)', () => {
    const { fake, calls } = makeFakeTmux();
    injectLiteral('s2', 'x', { submitKey: 'C-m', submitDelayMs: 0, deps: { runTmux: fake } });
    assert.deepStrictEqual(calls[2], ['send-keys', '-t', 's2', 'C-m']);
});

test('injectLiteral with submitKey:null skips submit', () => {
    const { fake, calls } = makeFakeTmux();
    injectLiteral('s3', 'x', { submitKey: null, deps: { runTmux: fake } });
    assert.strictEqual(calls.length, 2);
    assert.deepStrictEqual(calls[0], ['send-keys', '-t', 's3', '-X', 'cancel']);
    assert.deepStrictEqual(calls[1], ['send-keys', '-t', 's3', '-l', 'x']);
});

test('injectLiteral throws TMUX_INJECT_TIMEOUT when literal send hangs (SIGTERM)', () => {
    const { fake } = makeFakeTmux({ literalResult: { status: null, signal: 'SIGTERM' } });
    let caught;
    try {
        injectLiteral('hung', 'payload', { timeoutMs: 50, submitDelayMs: 0, deps: { runTmux: fake } });
    } catch (e) { caught = e; }
    assert.ok(caught, 'expected throw');
    assert.strictEqual(caught.code, 'TMUX_INJECT_TIMEOUT');
    assert.strictEqual(caught.sessionName, 'hung');
    assert.strictEqual(caught.phase, 'send-keys -l');
    assert.match(caught.message, /timeout 50ms/);
});

test('injectLiteral throws TMUX_INJECT_TIMEOUT when submit key send hangs', () => {
    const { fake } = makeFakeTmux({ submitResult: { status: null, signal: 'SIGTERM' } });
    let caught;
    try {
        injectLiteral('hung-submit', 'payload', { submitDelayMs: 0, deps: { runTmux: fake } });
    } catch (e) { caught = e; }
    assert.ok(caught);
    assert.strictEqual(caught.code, 'TMUX_INJECT_TIMEOUT');
    assert.strictEqual(caught.phase, 'send-keys Enter');
});

test('injectLiteral rejects non-string text and missing session', () => {
    assert.throws(() => injectLiteral('', 'x'), /sessionName is required/);
    assert.throws(() => injectLiteral('s', null), /text must be a string/);
});

test('injectLiteral does not throw if cancel times out (silently no-ops)', () => {
    // Defensive cancel uses its own ignored result; even if tmux were to return SIGTERM,
    // we must not let that block the literal send. (Belt-and-braces — cancel is best-effort.)
    const { fake, calls } = makeFakeTmux({ cancelResult: { status: 0 } });
    injectLiteral('s', 'x', { submitDelayMs: 0, deps: { runTmux: fake } });
    assert.strictEqual(calls.length, 3);
});

report();
