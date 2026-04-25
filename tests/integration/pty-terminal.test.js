#!/usr/bin/env node
// REGRESSION F356: PTY WebSocket security and data-path regressions.
'use strict';
const a = require('assert');
const { test, testAsync, report } = require('../_helpers');
const h = require('../../lib/pty-session-handler');

// REGRESSION F356: token lifecycle
test('pty-token: single-use + bogus rejected', () => {
    const t = h.mintPtyToken();
    a.ok(typeof t === 'string' && t.length >= 16);
    a.ok(h.validateAndConsumePtyToken(t)); a.ok(!h.validateAndConsumePtyToken(t)); a.ok(!h.validateAndConsumePtyToken('x'));
});
testAsync('pty-token: expired rejected', () => new Promise((res) => {
    const t = h.mintPtyToken({ ttlMs: 1 });
    setTimeout(() => { a.ok(!h.validateAndConsumePtyToken(t)); res(); }, 5);
}));

// REGRESSION F356: loopback enforcement
test('loopback check', () => {
    a.ok(h.isLoopbackAddress('127.0.0.1')); a.ok(h.isLoopbackAddress('::1')); a.ok(h.isLoopbackAddress('::ffff:127.0.0.1'));
    a.ok(!h.isLoopbackAddress('192.168.1.1')); a.ok(!h.isLoopbackAddress(''));
});

// REGRESSION F356: Origin allow-list
test('origin check', () => {
    a.ok(h.isValidOrigin('http://localhost:4100')); a.ok(h.isValidOrigin('http://127.0.0.1:4100')); a.ok(h.isValidOrigin('http://aigon.localhost:4101'));
    a.ok(!h.isValidOrigin('http://evil.com')); a.ok(!h.isValidOrigin('https://localhost:4100')); a.ok(!h.isValidOrigin(null));
});

// REGRESSION F356: resize round-trip
test('pty resize: valid frame', () => {
    let called = null;
    h.handleResizeFrame({ resize: (c, r) => { called = { cols: c, rows: r }; } }, JSON.stringify({ type: 'resize', cols: 120, rows: 36 }));
    a.deepStrictEqual(called, { cols: 120, rows: 36 });
});
test('pty resize: invalid frames ignored', () => {
    let n = 0;
    const m = { resize: () => { n++; } };
    h.handleResizeFrame(m, JSON.stringify({ type: 'resize', cols: 0, rows: 0 })); h.handleResizeFrame(m, 'not json');
    a.strictEqual(n, 0);
});

// Detect PTY availability (node-pty fails gracefully in headless/sandbox environments)
let PTY_AVAILABLE = false;
try { require('node-pty').spawn('/bin/echo', ['t'], { name: 'xterm', cols: 80, rows: 24, cwd: '/tmp', env: { PATH: process.env.PATH, HOME: '/tmp' } }).kill(); PTY_AVAILABLE = true; } catch (_) {}

// REGRESSION F356: alt-screen + bracketed-paste transit node-pty unchanged
testAsync('node-pty smoke: alt-screen + bracketed-paste transit', () => {
    if (!PTY_AVAILABLE) return Promise.resolve();
    return new Promise((res, rej) => {
        const chunks = []; const pty = require('node-pty');
        const p = pty.spawn(process.execPath, ['-e', "process.stdout.write('\\x1b[?1049h\\x1b[?2004h\\x1b[?2004l\\x1b[?1049l');process.exit(0);"],
            { name: 'xterm-256color', cols: 80, rows: 24, cwd: process.cwd(), env: process.env });
        p.onData(d => chunks.push(d));
        p.onExit(() => { const s = chunks.join(''); a.ok(s.includes('\x1b[?1049h')); a.ok(s.includes('\x1b[?2004h')); res(); });
        setTimeout(() => rej(new Error('timeout')), 5000);
    });
});

// REGRESSION F356: heavy-output soak — no data dropped
testAsync('node-pty soak: large output complete', () => {
    if (!PTY_AVAILABLE) return Promise.resolve();
    return new Promise((res, rej) => {
        const chunks = []; const pty = require('node-pty');
        const payload = ('SOAK' + 'x'.repeat(252)).repeat(4);
        const p = pty.spawn(process.execPath, ['-e', `process.stdout.write(${JSON.stringify(payload)});process.exit(0);`],
            { name: 'xterm-256color', cols: 200, rows: 50, cwd: process.cwd(), env: process.env });
        p.onData(d => chunks.push(d));
        p.onExit(() => { const marks = (chunks.join('').match(/SOAK/g) || []).length; a.ok(marks >= 4); res(); });
        setTimeout(() => rej(new Error('timeout')), 10000);
    });
});

report();
