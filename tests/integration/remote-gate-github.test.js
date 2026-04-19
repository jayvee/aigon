#!/usr/bin/env node
'use strict';
// REGRESSION (feature-close remote gate): checkGitHubGate must map PR state
// onto three outcomes — local close (no PR / no gh), block (open PR), or
// remote-finalize (merged PR). queryGitHubPrStatus powers the dashboard PR
// status endpoint; the shape is asserted here too so the endpoint keeps
// returning the normalized {provider,status,prNumber} contract.
const a = require('assert');
const { test, report } = require('../_helpers');
const { checkGitHubGate, queryGitHubPrStatus } = require('../../lib/remote-gate-github');
const j = JSON.stringify;
const ghFail = () => { throw new Error('not found'); };
const open = (n, merge = 'CLEAN', x = {}) => ({ number: n, url: `https://github.com/test/repo/pull/${n}`, state: 'OPEN', isDraft: !!x.draft, baseRefName: 'main', headRefName: 'feature-1-desc', mergeStateStatus: merge, mergedAt: null });
const merged = (n, mergedAt = '2026-01-01T00:00:00Z') => ({ ...open(n), state: 'MERGED', mergedAt });
const closed = (n) => ({ ...open(n), state: 'CLOSED' });
const x = (h = {}) => (cmd) => {
    if (cmd === 'git remote get-url origin') return h.origin ? h.origin() : 'https://github.com/test/repo.git';
    if (cmd === 'gh --version') return h.version ? h.version() : '';
    if (cmd === 'gh auth status') return h.auth ? h.auth() : '';
    if (cmd.startsWith('gh pr list --head ') && cmd.includes('--state merged')) return h.merged ? h.merged() : (h.head ? h.head() : (h.list ? h.list() : '[]'));
    if (cmd.startsWith('gh pr list --head ')) return h.head ? h.head() : (h.list ? h.list() : '[]');
    if (cmd.startsWith('gh pr list')) return h.list ? h.list() : '[]';
    return '';
};

console.log('checkGitHubGate');
for (const [desc, execFn, expect] of [
    ['non-GitHub remote → local', x({ origin: () => 'https://gitlab.com/test/repo.git' }), { ok: true, mode: 'local' }],
    ['gh missing → local', x({ version: ghFail }), { ok: true, mode: 'local' }],
    ['gh auth broken → local', x({ auth: ghFail }), { ok: true, mode: 'local' }],
    ['no PR → local', x({ list: () => '[]' }), { ok: true, mode: 'local' }],
    ['open PR → block', x({ list: () => j([open(1)]) }), { ok: false, code: 'pr_open' }],
    ['draft PR → block', x({ list: () => j([open(1, 'CLEAN', { draft: true })]) }), { ok: false, code: 'pr_open' }],
    ['blocked merge state on open → block', x({ list: () => j([open(1, 'BLOCKED')]) }), { ok: false, code: 'pr_open' }],
    ['merged PR → merged mode', x({ list: () => j([merged(1)]) }), { ok: true, mode: 'merged' }],
    ['deleted merged head branch → merged lookup fallback', x({ head: () => '[]', merged: () => j([merged(1)]) }), { ok: true, mode: 'merged' }],
    ['closed unmerged PR → local', x({ list: () => j([closed(1)]) }), { ok: true, mode: 'local' }],
    ['multiple active PRs → ambiguous', x({ list: () => j([open(1), open(2)]) }), { ok: false, code: 'ambiguous_pr' }],
    ['one closed + one open → block on open', x({ list: () => j([closed(1), open(2)]) }), { ok: false, code: 'pr_open' }],
    ['query failure → query_failed', x({ list: ghFail }), { ok: false, code: 'query_failed' }],
]) {
    test(desc, () => {
        const r = checkGitHubGate('feature-1-desc', 'main', { execFn });
        for (const [k, v] of Object.entries(expect)) a.strictEqual(r[k], v, `${k}`);
    });
}

test('multiple merged PRs for reused branch → latest merged wins', () => {
    const r = checkGitHubGate('feature-1-desc', 'main', { execFn: x({
        head: () => '[]',
        merged: () => j([merged(1, '2026-01-01T00:00:00Z'), merged(2, '2026-01-02T00:00:00Z')]),
    })});
    a.strictEqual(r.ok, true);
    a.strictEqual(r.mode, 'merged');
    a.strictEqual(r.prNumber, 2);
});

console.log('queryGitHubPrStatus');
for (const [desc, execFn, expect] of [
    ['none', x({ list: () => '[]' }), { provider: 'github', status: 'none' }],
    ['open', x({ list: () => j([open(1)]) }), { provider: 'github', status: 'open', prNumber: 1 }],
    ['draft', x({ list: () => j([open(1, 'CLEAN', { draft: true })]) }), { provider: 'github', status: 'draft', prNumber: 1 }],
    ['merged', x({ list: () => j([merged(7)]) }), { provider: 'github', status: 'merged', prNumber: 7 }],
    ['unavailable (non-GitHub remote)', x({ origin: () => 'https://gitlab.com/test/repo.git' }), { provider: null, status: 'unavailable' }],
    ['unavailable (gh missing)', x({ version: ghFail }), { provider: 'github', status: 'unavailable' }],
]) {
    test(desc, () => {
        const r = queryGitHubPrStatus('feature-1-desc', 'main', { execFn });
        for (const [k, v] of Object.entries(expect)) a.strictEqual(r[k], v, `${k}`);
    });
}

report();
