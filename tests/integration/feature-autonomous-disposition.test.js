#!/usr/bin/env node
// REGRESSION (F530, incident F528): autonomous solo close used to fire immediately
// after `review-complete --approve`, even when the reviewer committed `fix(review):`
// changes on the implementation branch — letting reviewer-authored output merge
// without an implementor accept/revert/modify step. The gate now requires explicit
// implementor disposition whenever reviewer output exists, even on --approve.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { test, withTempDir, report, GIT_SAFE_ENV } = require('../_helpers');
const { requiresImplementorDisposition } = require('../../lib/feature-autonomous');

function gitInit(repo, env) {
    execFileSync('git', ['init', '-q'], { cwd: repo, env, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'impl@aigon.test'], { cwd: repo, env, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'Implementor'], { cwd: repo, env, stdio: 'pipe' });
}

function commit(repo, fileName, body, message, { authorEmail, authorName, when } = {}) {
    const env = {
        ...process.env,
        ...GIT_SAFE_ENV,
        GIT_AUTHOR_NAME: authorName || 'Implementor',
        GIT_AUTHOR_EMAIL: authorEmail || 'impl@aigon.test',
        GIT_COMMITTER_NAME: authorName || 'Implementor',
        GIT_COMMITTER_EMAIL: authorEmail || 'impl@aigon.test',
        ...(when ? { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } : {}),
    };
    fs.writeFileSync(path.join(repo, fileName), body);
    execFileSync('git', ['add', fileName], { cwd: repo, env, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', message], { cwd: repo, env, stdio: 'pipe' });
}

function writeSpec(repo, codeReviewBody) {
    const dir = path.join(repo, 'docs', 'specs', 'features', '03-in-progress');
    fs.mkdirSync(dir, { recursive: true });
    const specPath = path.join(dir, 'feature-528-sample.md');
    const body = [
        '---',
        'complexity: high',
        '---',
        '',
        '# Feature: sample',
        '',
        '## Summary',
        'Sample',
        '',
        codeReviewBody,
        '',
    ].join('\n');
    fs.writeFileSync(specPath, body);
    return specPath;
}

const REVIEW_STARTED = '2026-04-01T10:00:00Z';
const PRE_REVIEW = '2026-04-01T09:00:00Z';
const POST_REVIEW = '2026-04-01T11:00:00Z';

const snapshotWith = (reviewStartedAt, requestRevision) => ({
    featureId: '528',
    codeReview: {
        reviewStartedAt,
        reviewCompletedAt: '2026-04-01T12:00:00Z',
        requestRevision,
    },
});

// AC #9 (regression): F528-shaped — reviewer-authored fix(review) commit after reviewStartedAt
// triggers disposition even when verdict is --approve.
test('F528 regression: reviewer fix(review) commit after reviewStartedAt triggers disposition', () =>
    withTempDir('aigon-f530-regression-', (repo) => {
        const env = { ...process.env, ...GIT_SAFE_ENV };
        gitInit(repo, env);
        commit(repo, 'feature.js', 'impl v1', 'feat: initial impl', { when: PRE_REVIEW });
        commit(repo, 'feature.js', 'reviewer fix', 'fix(review): tighten null check', {
            authorEmail: 'reviewer@aigon.test', authorName: 'Reviewer', when: POST_REVIEW,
        });

        const specPath = writeSpec(repo, [
            '## Code Review',
            '**Reviewed by**: cc',
            '### Fixes Applied',
            '- abc1234 fix(review): tighten null check',
            '### Escalated Issues (exceptions only)',
            '- None',
        ].join('\n'));

        // Reviewer committed --approve (requestRevision=false), but reviewer output exists.
        const snapshot = snapshotWith(REVIEW_STARTED, false);
        const required = requiresImplementorDisposition({ snapshot, worktreePath: repo, specPath });
        assert.strictEqual(required, true, 'reviewer fix(review) commit must require disposition even on --approve');
    }));

// AC #10 (positive): clean approve — no reviewer commits, no ESCALATE: — closes directly.
test('clean --approve with no reviewer output does NOT require disposition', () =>
    withTempDir('aigon-f530-clean-approve-', (repo) => {
        const env = { ...process.env, ...GIT_SAFE_ENV };
        gitInit(repo, env);
        commit(repo, 'feature.js', 'impl v1', 'feat: initial impl', { when: PRE_REVIEW });
        // No commits after reviewStartedAt.

        const specPath = writeSpec(repo, [
            '## Code Review',
            '**Reviewed by**: cc',
            '### Fixes Applied',
            '- None — implementation was clean',
            '### Escalated Issues (exceptions only)',
            '- None',
        ].join('\n'));

        const snapshot = snapshotWith(REVIEW_STARTED, false);
        const required = requiresImplementorDisposition({ snapshot, worktreePath: repo, specPath });
        assert.strictEqual(required, false, 'clean approve must close immediately, no injection');
    }));

test('ESCALATE: line in spec Code Review section triggers disposition even with no reviewer commits', () =>
    withTempDir('aigon-f530-escalate-', (repo) => {
        const env = { ...process.env, ...GIT_SAFE_ENV };
        gitInit(repo, env);
        commit(repo, 'feature.js', 'impl v1', 'feat: initial impl', { when: PRE_REVIEW });

        const specPath = writeSpec(repo, [
            '## Code Review',
            '**Reviewed by**: cc',
            '### Fixes Applied',
            '- None — implementation was clean',
            '### Escalated Issues (exceptions only)',
            '- ESCALATE:architectural — proposed pattern conflicts with module boundary',
        ].join('\n'));

        const snapshot = snapshotWith(REVIEW_STARTED, false);
        const required = requiresImplementorDisposition({ snapshot, worktreePath: repo, specPath });
        assert.strictEqual(required, true);
    }));

test('bold/bulleted ESCALATE: variants match', () =>
    withTempDir('aigon-f530-escalate-bold-', (repo) => {
        const specPath = writeSpec(repo, [
            '## Code Review',
            '- **ESCALATE:ambiguous** — correct behavior is unclear',
        ].join('\n'));
        const snapshot = snapshotWith(REVIEW_STARTED, false);
        const required = requiresImplementorDisposition({ snapshot, worktreePath: null, specPath });
        assert.strictEqual(required, true);
    }));

test('"Escalated Issues: None" alone does not trigger', () =>
    withTempDir('aigon-f530-escalate-none-', (repo) => {
        const specPath = writeSpec(repo, [
            '## Code Review',
            '### Escalated Issues',
            '- None',
        ].join('\n'));
        const snapshot = snapshotWith(REVIEW_STARTED, false);
        const required = requiresImplementorDisposition({ snapshot, worktreePath: null, specPath });
        assert.strictEqual(required, false);
    }));

test('ESCALATE: outside the ## Code Review section is ignored', () =>
    withTempDir('aigon-f530-escalate-other-section-', (repo) => {
        const dir = path.join(repo, 'docs', 'specs', 'features', '03-in-progress');
        fs.mkdirSync(dir, { recursive: true });
        const specPath = path.join(dir, 'feature-528-other.md');
        fs.writeFileSync(specPath, [
            '# Feature: x',
            '',
            '## Notes',
            '- ESCALATE: this is just prose referring to escalation',
            '',
            '## Code Review',
            '- None',
        ].join('\n'));
        const snapshot = snapshotWith(REVIEW_STARTED, false);
        const required = requiresImplementorDisposition({ snapshot, worktreePath: null, specPath });
        assert.strictEqual(required, false, 'ESCALATE: outside the ## Code Review section must not gate close');
    }));

test('--request-revision verdict still uses the helper (helper is verdict-agnostic)', () =>
    withTempDir('aigon-f530-request-rev-', (repo) => {
        const env = { ...process.env, ...GIT_SAFE_ENV };
        gitInit(repo, env);
        commit(repo, 'feature.js', 'impl v1', 'feat: initial impl', { when: PRE_REVIEW });
        // No reviewer commits, no ESCALATE — helper returns false even with requestRevision=true.
        // (The autonomous loop still injects on --request-revision via a separate code path; the
        // helper itself is verdict-agnostic per AC #5.)
        const specPath = writeSpec(repo, '## Code Review\n- None');
        const snapshot = snapshotWith(REVIEW_STARTED, true);
        const required = requiresImplementorDisposition({ snapshot, worktreePath: repo, specPath });
        assert.strictEqual(required, false, 'helper does not consult requestRevision');
    }));

test('missing reviewStartedAt skips git check, falls back to ESCALATE: scan', () =>
    withTempDir('aigon-f530-no-started-', (repo) => {
        const specPath = writeSpec(repo, [
            '## Code Review',
            '- ESCALATE:blocked — missing infra',
        ].join('\n'));
        const snapshot = { codeReview: { reviewStartedAt: null, requestRevision: false } };
        assert.strictEqual(
            requiresImplementorDisposition({ snapshot, worktreePath: null, specPath }),
            true
        );
    }));

test('no worktree path + no spec path returns false (graceful degradation)', () => {
    const snapshot = snapshotWith(REVIEW_STARTED, false);
    assert.strictEqual(
        requiresImplementorDisposition({ snapshot, worktreePath: null, specPath: null }),
        false
    );
});

report();
