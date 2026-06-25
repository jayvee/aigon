'use strict';

// REGRESSION: F552 scoped flags and interactive fix dispatch helpers.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseDoctorScopes, sectionInScope, scopeUsageLine } = require('../../lib/doctor/scopes');
const { runFixDispatch, printManualIssues } = require('../../lib/doctor/fix-dispatch');

test('parseDoctorScopes: --auth and --auth-only set auth scope', () => {
    assert.deepEqual(parseDoctorScopes(['doctor', '--auth']).scope, 'auth');
    assert.equal(parseDoctorScopes(['--auth-only']).authOnly, true);
});

test('parseDoctorScopes: --ports forces full detail', () => {
    const p = parseDoctorScopes(['--ports']);
    assert.equal(p.scope, 'ports');
    assert.equal(p.full, true);
});

test('parseDoctorScopes: --sweep-repos is a known flag', () => {
    const p = parseDoctorScopes(['--fix', '--yes', '--sweep-repos']);
    assert.deepEqual(p.unknownScopeFlags, []);
});

test('parseDoctorScopes: unknown scope flag is reported', () => {
    const p = parseDoctorScopes(['--authh']);
    assert.deepEqual(p.unknownScopeFlags, ['--authh']);
    assert.match(scopeUsageLine(), /--auth/);
});

test('sectionInScope limits sections per scope', () => {
    assert.equal(sectionInScope('agent-auth', 'auth'), true);
    assert.equal(sectionInScope('port-health', 'auth'), false);
    assert.equal(sectionInScope('port-health', 'ports'), true);
    assert.equal(sectionInScope('prerequisites', null), true);
});

test('runFixDispatch: non-TTY lists fixes without applying', async () => {
    const log = [];
    let applied = false;
    const result = await runFixDispatch([{
        section: 'agent-auth',
        message: 'cc unauthenticated',
        label: 'login',
        command: 'claude login',
        apply: () => { applied = true; },
    }], { yes: false, isTTY: false, log: (m) => log.push(m) });
    assert.equal(applied, false);
    assert.equal(result.skipped, 1);
    assert.ok(log.some(l => /non-interactive/i.test(l)));
    assert.ok(log.some(l => /claude login/.test(l)));
});

test('runFixDispatch: --yes applies all fixes', async () => {
    let count = 0;
    const result = await runFixDispatch([
        { section: 'a', message: 'one', label: 'l', command: 'c', apply: () => { count += 1; } },
        { section: 'b', message: 'two', label: 'l', command: 'c', apply: () => { count += 1; } },
    ], { yes: true, isTTY: false, log: () => {} });
    assert.equal(count, 2);
    assert.equal(result.applied, 2);
});

test('printManualIssues lists non-auto-fixable commands', () => {
    const lines = [];
    printManualIssues([{
        section: 'git-identity',
        message: 'user.name missing',
        fix: { label: 'set identity', command: 'git config --global user.name "x"', autoFixable: false },
    }], (m) => lines.push(m));
    assert.ok(lines.some(l => /git config/.test(l)));
});
