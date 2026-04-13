#!/usr/bin/env node
// REGRESSION: prevents the remote branch gate from silently passing when it
// should block, or blocking when it should pass. The gate decision table is
// the critical safety boundary for feature 255.
'use strict';
const a = require('assert');
const { test, report } = require('../_helpers');
const { checkGitHubGate } = require('../../lib/remote-gate-github');

const ghOk = () => '';
const ghFail = () => { throw new Error('not found'); };
const prJson = (prs) => JSON.stringify(prs);
const openPr = (n, merge = 'CLEAN', opts = {}) => ({
    number: n, url: `https://github.com/test/repo/pull/${n}`, state: 'OPEN',
    isDraft: opts.draft || false, baseRefName: 'main', headRefName: 'feature-1-desc',
    mergeStateStatus: merge, mergedAt: null,
});
const mergedPr = (n) => ({ ...openPr(n), state: 'MERGED', mergedAt: '2026-01-01T00:00:00Z' });
const closedPr = (n) => ({ ...openPr(n), state: 'CLOSED' });

const mockExec = (handlers) => (cmd) => {
    if (cmd === 'gh --version') return handlers.version ? handlers.version() : ghOk();
    if (cmd === 'gh auth status') return handlers.auth ? handlers.auth() : ghOk();
    if (cmd.startsWith('gh pr list')) return handlers.prList ? handlers.prList() : '[]';
    return '';
};

console.log('remote-gate-github');

test('gh missing → gh_missing', () => {
    const r = checkGitHubGate('f', 'main', { execFn: mockExec({ version: ghFail }) });
    a.strictEqual(r.ok, false); a.strictEqual(r.code, 'gh_missing');
});

test('gh not authed → gh_auth', () => {
    const r = checkGitHubGate('f', 'main', { execFn: mockExec({ auth: ghFail }) });
    a.strictEqual(r.ok, false); a.strictEqual(r.code, 'gh_auth');
});

test('no PR → no_pr', () => {
    const r = checkGitHubGate('f', 'main', { execFn: mockExec({ prList: () => '[]' }) });
    a.strictEqual(r.ok, false); a.strictEqual(r.code, 'no_pr');
});

test('open mergeable PR → passes', () => {
    const r = checkGitHubGate('feature-1-desc', 'main', { execFn: mockExec({ prList: () => prJson([openPr(1)]) }) });
    a.strictEqual(r.ok, true); a.strictEqual(r.prNumber, 1);
});

test('draft PR → draft', () => {
    const r = checkGitHubGate('feature-1-desc', 'main', { execFn: mockExec({ prList: () => prJson([openPr(1, 'CLEAN', { draft: true })]) }) });
    a.strictEqual(r.ok, false); a.strictEqual(r.code, 'draft');
});

test('BLOCKED merge state → not_mergeable', () => {
    const r = checkGitHubGate('feature-1-desc', 'main', { execFn: mockExec({ prList: () => prJson([openPr(1, 'BLOCKED')]) }) });
    a.strictEqual(r.ok, false); a.strictEqual(r.code, 'not_mergeable');
});

test('merged PR → remote_merged_unsupported', () => {
    const r = checkGitHubGate('feature-1-desc', 'main', { execFn: mockExec({ prList: () => prJson([mergedPr(1)]) }) });
    a.strictEqual(r.ok, false); a.strictEqual(r.code, 'remote_merged_unsupported');
});

test('closed unmerged PR → closed_unmerged', () => {
    const r = checkGitHubGate('feature-1-desc', 'main', { execFn: mockExec({ prList: () => prJson([closedPr(1)]) }) });
    a.strictEqual(r.ok, false); a.strictEqual(r.code, 'closed_unmerged');
});

test('multiple active PRs → ambiguous_pr', () => {
    const r = checkGitHubGate('feature-1-desc', 'main', { execFn: mockExec({ prList: () => prJson([openPr(1), openPr(2)]) }) });
    a.strictEqual(r.ok, false); a.strictEqual(r.code, 'ambiguous_pr');
});

test('one closed + one open → passes (not ambiguous)', () => {
    const r = checkGitHubGate('feature-1-desc', 'main', { execFn: mockExec({ prList: () => prJson([closedPr(1), openPr(2)]) }) });
    a.strictEqual(r.ok, true); a.strictEqual(r.prNumber, 2);
});

test('query failure → query_failed', () => {
    const r = checkGitHubGate('f', 'main', { execFn: mockExec({ prList: ghFail }) });
    a.strictEqual(r.ok, false); a.strictEqual(r.code, 'query_failed');
});

report();
