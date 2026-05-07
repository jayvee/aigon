#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { test, report } = require('../_helpers');
const { fingerprint, normalize } = require('../../lib/security-scan/fingerprint');

test('normalize: strips leading/trailing whitespace and normalizes identifiers', () => {
    // "hello" and "world" are 5-char identifiers → replaced with _v_
    assert.strictEqual(normalize('  hello world  '), '_v_ _v_');
});

test('normalize: collapses internal whitespace', () => {
    assert.strictEqual(normalize('a   b\t\tc'), 'a b c');
});

test('normalize: replaces double-quoted string literals with _s_', () => {
    // identifiers replaced first, then string delimiters collapse content to _s_
    const result = normalize('const x = "secret123"');
    assert.ok(result.includes('"_s_"'), `Expected "_s_" in: ${result}`);
    assert.ok(!result.includes('secret'), 'Should not contain original string content');
});

test('normalize: replaces single-quoted string literals with _s_', () => {
    // "secret" is a 6-char identifier → replaced first, then string delimiters collapse to _s_
    const result = normalize("const x = 'secret'");
    assert.ok(result.includes("'_s_'"), `Expected '_s_' in: ${result}`);
    assert.ok(!result.includes('secret'), 'Should not contain original string content');
});

test('normalize: replaces identifier-like tokens with _v_', () => {
    const result = normalize('const myVariable = foo');
    assert.ok(result.includes('_v_'), `Expected _v_ in: ${result}`);
    assert.ok(!result.includes('myVariable'), 'Should not contain original identifier');
});

test('normalize: short tokens (1-2 chars) are not replaced', () => {
    const result = normalize('if (x > 0)');
    assert.ok(result.includes('x'), 'Short token x should be preserved');
});

test('fingerprint: returns a 64-char hex string', () => {
    const fp = fingerprint('xss', 'src/app.js', 'dangerouslySetInnerHTML={{ __html: userInput }}');
    assert.strictEqual(typeof fp, 'string');
    assert.strictEqual(fp.length, 64);
    assert.ok(/^[0-9a-f]+$/.test(fp), 'Should be lowercase hex');
});

test('fingerprint: same inputs produce same fingerprint', () => {
    const a = fingerprint('sqli', 'db.js', 'SELECT * FROM users WHERE id = ' + "'" + 'x' + "'");
    const b = fingerprint('sqli', 'db.js', 'SELECT * FROM users WHERE id = ' + "'" + 'x' + "'");
    assert.strictEqual(a, b);
});

test('fingerprint: different categories produce different fingerprints', () => {
    const a = fingerprint('xss', 'app.js', 'foo');
    const b = fingerprint('sqli', 'app.js', 'foo');
    assert.notStrictEqual(a, b);
});

test('fingerprint: different files produce different fingerprints', () => {
    const a = fingerprint('xss', 'a.js', 'foo');
    const b = fingerprint('xss', 'b.js', 'foo');
    assert.notStrictEqual(a, b);
});

test('fingerprint: normalized snippet makes fingerprint stable across identifier renaming', () => {
    // Two lines that differ only in variable name should produce the same fingerprint
    const a = fingerprint('secret', 'auth.js', 'const apiKey = "abc123"');
    const b = fingerprint('secret', 'auth.js', 'const secretToken = "xyz789"');
    assert.strictEqual(a, b, 'Fingerprints should match after normalization strips identifiers and strings');
});

report();
