#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { test, withTempDir, report } = require('../_helpers');
const srs = require('../../lib/spec-review-state');
const { applySpecReviewStatus, clearTierCache } = require('../../lib/dashboard-status-collector');

function init(repo) {
    ['docs/specs/features/02-backlog', 'docs/specs/features/05-done', 'docs/specs/research-topics/02-backlog']
        .forEach(d => fs.mkdirSync(path.join(repo, d), { recursive: true }));
    execSync('git init -q && git config user.email t@t && git config user.name t', { cwd: repo });
}
const mk = (id, stage, specPath) => ({ id, stage, specPath, updatedAt: new Date().toISOString(), validActions: [], nextActions: [] });
// REGRESSION F283: JSON store replaces git-log scan. Covers submit→pending, ack→cleared,
// Done→never-pending, invalid reviewerId rejected, label uniqueness + CHECK gating.
test('spec-review JSON store end-to-end (feature + research)', () => withTempDir('aigon-srs-', (repo) => {
    init(repo);
    const f = path.join(repo, 'docs/specs/features/02-backlog/feature-12-x.md');
    const d = path.join(repo, 'docs/specs/features/05-done/feature-33-d.md');
    const r = path.join(repo, 'docs/specs/research-topics/02-backlog/research-41-y.md');
    [f, d, r].forEach(p => fs.writeFileSync(p, '# x\n'));
    for (const bad of ['unknown', '', 'NotLower'])
        assert.throws(() => srs.recordSubmission(repo, 'feature', '1', { reviewerId: bad, summary: '' }), /invalid reviewerId/);

    // Pre-submit: no pending, no CHECK action on either card
    const before = [mk('12', 'backlog', f), mk('33', 'done', d)];
    clearTierCache(repo); applySpecReviewStatus(repo, before, [mk('41', 'backlog', r)]);
    assert.ok(!before[0].validActions.some(a => a.action === 'feature-spec-review-check'));

    // Submit on feature + research, Done feature tracked separately
    srs.recordSubmission(repo, 'feature', '12', { reviewerId: 'gg', summary: 's' });
    srs.recordSubmission(repo, 'feature', '33', { reviewerId: 'gg', summary: 's' });
    srs.recordSubmission(repo, 'research', '41', { reviewerId: 'cx', summary: 's' });
    const items = [mk('12', 'backlog', f), mk('33', 'done', d)];
    const rItems = [mk('41', 'backlog', r)];
    clearTierCache(repo); applySpecReviewStatus(repo, items, rItems);
    assert.strictEqual(items[0].specReview.pendingCount, 1);
    assert.deepStrictEqual(items[0].specReview.pendingAgents, ['gg']);
    assert.strictEqual(items[1].specReview.pendingCount, 0, 'Done suppresses badge');
    for (const [item, t] of [[items[0], 'feature'], [rItems[0], 'research']]) {
        const acts = item.validActions.filter(a => a.action && a.action.includes('-spec-review'));
        assert.strictEqual(new Set(acts.map(a => a.label)).size, acts.length, `dup labels ${t}`);
        assert.ok(acts.some(a => a.action === `${t}-spec-review`));
        assert.ok(acts.some(a => a.action === `${t}-spec-review-check`));
    }

    // Ack clears pending
    srs.recordAck(repo, 'feature', '12', { ackedBy: 'cc', notes: 'ok' });
    const after = mk('12', 'backlog', f);
    clearTierCache(repo); applySpecReviewStatus(repo, [after], []);
    assert.strictEqual(after.specReview.pendingCount, 0);
    assert.ok(!after.validActions.some(a => a.action === 'feature-spec-review-check'));
}));

// REGRESSION F283: one-shot backfill from legacy spec-review commits; idempotent.
test('migrateFromGitHistory backfills once', () => withTempDir('aigon-srs-', (repo) => {
    init(repo);
    fs.writeFileSync(path.join(repo, 'docs/specs/features/02-backlog/feature-77-m.md'), '# m\n');
    execSync('git add . && git commit -qm init', { cwd: repo });
    execSync(`git commit --allow-empty -qm "spec-review: feature 77 — tighten" -m "Reviewer: cx"`, { cwd: repo });
    const res = srs.migrateFromGitHistory(repo);
    assert.strictEqual(res.migrated, true); assert.strictEqual(res.backfilled, 1);
    assert.strictEqual(srs.readState(repo, 'feature', '77').reviews[0].reviewerId, 'cx');
    assert.strictEqual(srs.migrateFromGitHistory(repo).migrated, false);
}));
report();
