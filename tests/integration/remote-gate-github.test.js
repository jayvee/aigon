#!/usr/bin/env node
'use strict';
const a = require('assert');
const { test, report } = require('../_helpers');
const { checkGitHubGate, queryGitHubPrStatus } = require('../../lib/remote-gate-github');
const j = JSON.stringify;
const ghFail = () => { throw new Error('not found'); };
const open = (n, merge = 'CLEAN', x = {}) => ({ number: n, url: `https://github.com/test/repo/pull/${n}`, state: 'OPEN', isDraft: !!x.draft, baseRefName: 'main', headRefName: 'feature-1-desc', mergeStateStatus: merge, mergedAt: null });
const merged = (n) => ({ ...open(n), state: 'MERGED', mergedAt: '2026-01-01T00:00:00Z' });
const closed = (n) => ({ ...open(n), state: 'CLOSED' });
const x = (h = {}) => (cmd) => {
    if (cmd === 'git remote get-url origin') return h.origin ? h.origin() : 'https://github.com/test/repo.git';
    if (cmd === 'gh --version') return h.version ? h.version() : '';
    if (cmd === 'gh auth status') return h.auth ? h.auth() : '';
    if (cmd.startsWith('gh pr list --head ')) return h.head ? h.head() : (h.list ? h.list() : '[]');
    if (cmd.startsWith('gh pr list --state merged ')) return h.merged ? h.merged() : (h.list ? h.list() : '[]');
    if (cmd.startsWith('gh pr list')) return h.list ? h.list() : '[]';
    return '';
};

console.log('remote-gate-github');
test('non-GitHub remote -> local', () => { const r = checkGitHubGate('f', 'main', { execFn: x({ origin: () => 'https://gitlab.com/test/repo.git' }) }); a.ok(r.ok); a.strictEqual(r.mode, 'local'); });
test('gh missing -> local', () => { const r = checkGitHubGate('f', 'main', { execFn: x({ version: ghFail }) }); a.ok(r.ok); a.strictEqual(r.mode, 'local'); });
test('gh auth broken -> local', () => { const r = checkGitHubGate('f', 'main', { execFn: x({ auth: ghFail }) }); a.ok(r.ok); a.strictEqual(r.mode, 'local'); });
test('no PR -> local', () => { const r = checkGitHubGate('f', 'main', { execFn: x({ list: () => '[]' }) }); a.ok(r.ok); a.strictEqual(r.mode, 'local'); });
test('open PR -> block', () => { const r = checkGitHubGate('feature-1-desc', 'main', { execFn: x({ list: () => j([open(1)]) }) }); a.ok(!r.ok); a.strictEqual(r.code, 'pr_open'); });
test('draft PR -> block', () => { const r = checkGitHubGate('feature-1-desc', 'main', { execFn: x({ list: () => j([open(1, 'CLEAN', { draft: true })]) }) }); a.ok(!r.ok); a.strictEqual(r.code, 'pr_open'); });
test('blocked merge state on open PR -> block', () => { const r = checkGitHubGate('feature-1-desc', 'main', { execFn: x({ list: () => j([open(1, 'BLOCKED')]) }) }); a.ok(!r.ok); a.strictEqual(r.code, 'pr_open'); });
test('merged PR -> merged mode', () => { const r = checkGitHubGate('feature-1-desc', 'main', { execFn: x({ list: () => j([merged(1)]) }) }); a.ok(r.ok); a.strictEqual(r.mode, 'merged'); });
test('deleted merged head branch falls back to merged lookup', () => { const r = checkGitHubGate('feature-1-desc', 'main', { execFn: x({ head: () => '[]', merged: () => j([merged(1)]) }) }); a.ok(r.ok); a.strictEqual(r.mode, 'merged'); });
test('closed unmerged PR -> local', () => { const r = checkGitHubGate('feature-1-desc', 'main', { execFn: x({ list: () => j([closed(1)]) }) }); a.ok(r.ok); a.strictEqual(r.mode, 'local'); });
test('multiple active PRs -> ambiguous', () => { const r = checkGitHubGate('feature-1-desc', 'main', { execFn: x({ list: () => j([open(1), open(2)]) }) }); a.ok(!r.ok); a.strictEqual(r.code, 'ambiguous_pr'); });
test('multiple merged PRs for reused branch -> latest merged wins', () => {
    const newer = { ...merged(2), mergedAt: '2026-01-02T00:00:00Z' };
    const older = { ...merged(1), mergedAt: '2026-01-01T00:00:00Z' };
    const r = checkGitHubGate('feature-1-desc', 'main', { execFn: x({ head: () => '[]', merged: () => j([older, newer]) }) });
    a.ok(r.ok);
    a.strictEqual(r.mode, 'merged');
    a.strictEqual(r.prNumber, 2);
});
test('one closed + one open -> block on open', () => { const r = checkGitHubGate('feature-1-desc', 'main', { execFn: x({ list: () => j([closed(1), open(2)]) }) }); a.ok(!r.ok); a.strictEqual(r.code, 'pr_open'); });
test('query failure -> query_failed', () => { const r = checkGitHubGate('f', 'main', { execFn: x({ list: ghFail }) }); a.ok(!r.ok); a.strictEqual(r.code, 'query_failed'); });

console.log('query-github-pr-status');
// REGRESSION: ensures queryGitHubPrStatus returns the correct normalized
// status for each PR state — the dashboard endpoint depends on these shapes
test('status none', () => {
    const r = queryGitHubPrStatus('feature-1-desc', 'main', { execFn: x({ list: () => '[]' }) });
    a.strictEqual(r.provider, 'github');
    a.strictEqual(r.status, 'none');
});
test('status open', () => {
    const r = queryGitHubPrStatus('feature-1-desc', 'main', { execFn: x({ list: () => j([open(1)]) }) });
    a.strictEqual(r.provider, 'github');
    a.strictEqual(r.status, 'open');
    a.strictEqual(r.prNumber, 1);
});
test('status draft', () => {
    const r = queryGitHubPrStatus('feature-1-desc', 'main', { execFn: x({ list: () => j([open(1, 'CLEAN', { draft: true })]) }) });
    a.strictEqual(r.provider, 'github');
    a.strictEqual(r.status, 'draft');
    a.strictEqual(r.prNumber, 1);
});
test('status merged', () => {
    const r = queryGitHubPrStatus('feature-1-desc', 'main', { execFn: x({ list: () => j([merged(7)]) }) });
    a.strictEqual(r.provider, 'github');
    a.strictEqual(r.status, 'merged');
    a.strictEqual(r.prNumber, 7);
});
test('status unavailable (non-GitHub remote)', () => {
    const r = queryGitHubPrStatus('feature-1-desc', 'main', { execFn: x({ origin: () => 'https://gitlab.com/test/repo.git' }) });
    a.strictEqual(r.provider, null);
    a.strictEqual(r.status, 'unavailable');
});
test('status unavailable (gh missing)', () => {
    const r = queryGitHubPrStatus('feature-1-desc', 'main', { execFn: x({ version: ghFail }) });
    a.strictEqual(r.provider, 'github');
    a.strictEqual(r.status, 'unavailable');
});
report();
