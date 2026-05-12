#!/usr/bin/env node
// REGRESSION (F530, incident F528): reviewer-authored fix(review) commits or
// ESCALATE: lines must force implementor disposition even on --approve. The
// close-gate uses isExplicitCodeRevisionComplete (requires revisionCompletedAt).
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { test, withTempDir, report, GIT_SAFE_ENV } = require('../_helpers');
const {
    requiresImplementorDisposition,
    isCodeRevisionComplete,
    isExplicitCodeRevisionComplete,
} = require('../../lib/feature-autonomous');

const REVIEW_STARTED = '2026-04-01T10:00:00Z';
const PRE_REVIEW = '2026-04-01T09:00:00Z';
const POST_REVIEW = '2026-04-01T11:00:00Z';
const REVIEW_COMPLETED = '2026-04-01T12:00:00Z';

function initRepoWithImpl(repo) {
    const env = { ...process.env, ...GIT_SAFE_ENV };
    execFileSync('git', ['init', '-q'], { cwd: repo, env, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'impl@aigon.test'], { cwd: repo, env, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'Implementor'], { cwd: repo, env, stdio: 'pipe' });
    commit(repo, 'feature.js', 'impl v1', 'feat: initial impl', { when: PRE_REVIEW });
}

function commit(repo, fileName, body, message, { authorEmail, authorName, when } = {}) {
    const env = {
        ...process.env, ...GIT_SAFE_ENV,
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

function reviewerFix(repo) {
    commit(repo, 'feature.js', 'reviewer fix', 'fix(review): tighten null check', {
        authorEmail: 'reviewer@aigon.test', authorName: 'Reviewer', when: POST_REVIEW,
    });
}

function writeSpec(repo, codeReviewBody) {
    const dir = path.join(repo, 'docs', 'specs', 'features', '03-in-progress');
    fs.mkdirSync(dir, { recursive: true });
    const specPath = path.join(dir, 'feature-528-sample.md');
    fs.writeFileSync(specPath,
        `---\ncomplexity: high\n---\n\n# Feature: sample\n\n## Summary\nSample\n\n${codeReviewBody}\n`);
    return specPath;
}

const snapshot = (reviewStartedAt, requestRevision, revisionCompletedAt = null) => ({
    featureId: '528',
    codeReview: { reviewStartedAt, reviewCompletedAt: REVIEW_COMPLETED, requestRevision, revisionCompletedAt },
});

// Core regression: reviewer fix(review) commit after reviewStartedAt requires disposition
// even on --approve. Also exercises the close-gate (isExplicitCodeRevisionComplete) — without
// revisionCompletedAt the gate holds; with it the gate releases. Legacy isCodeRevisionComplete
// returns true on requestRevision=false (the bug surface F530 covers).
test('F528 regression: reviewer fix(review) commit gates close until explicit revision-complete', () =>
    withTempDir('aigon-f530-regression-', (repo) => {
        initRepoWithImpl(repo);
        reviewerFix(repo);
        const specPath = writeSpec(repo, '## Code Review\n- abc fix(review): tighten');

        const blocked = snapshot(REVIEW_STARTED, false, null);
        assert.strictEqual(requiresImplementorDisposition({ snapshot: blocked, worktreePath: repo, specPath }), true);
        assert.strictEqual(isCodeRevisionComplete(blocked, repo, '528', 'cc'), true, 'legacy short-circuits on approve');
        assert.strictEqual(isExplicitCodeRevisionComplete(blocked, repo, '528', 'cc'), false, 'gate holds until implementor signals');

        const released = snapshot(REVIEW_STARTED, false, '2026-04-01T13:00:00Z');
        assert.strictEqual(isExplicitCodeRevisionComplete(released, repo, '528', 'cc'), true);
    }));

// Clean approve: no reviewer commits, no ESCALATE — gate closes immediately.
test('clean approve closes immediately (no disposition required)', () =>
    withTempDir('aigon-f530-clean-approve-', (repo) => {
        initRepoWithImpl(repo);
        const specPath = writeSpec(repo, '## Code Review\n- None — implementation was clean');
        const snap = snapshot(REVIEW_STARTED, false);
        assert.strictEqual(requiresImplementorDisposition({ snapshot: snap, worktreePath: repo, specPath }), false);
        assert.strictEqual(isCodeRevisionComplete(snap, repo, '528', 'cc'), true);
    }));

// ESCALATE: variants — bold/bulleted forms in ## Code Review trigger; "None" alone doesn't;
// ESCALATE: outside the section is ignored.
test('ESCALATE: matches in ## Code Review only, supports bold/bulleted variants', () =>
    withTempDir('aigon-f530-escalate-', (repo) => {
        const cases = [
            ['## Code Review\n- ESCALATE:arch — conflicts with module boundary', true],
            ['## Code Review\n- **ESCALATE:ambiguous** — correct behavior unclear', true],
            ['## Code Review\n### Escalated Issues\n- None', false],
            ['## Notes\n- ESCALATE: prose mention\n\n## Code Review\n- None', false],
        ];
        for (const [body, expected] of cases) {
            const specPath = writeSpec(repo, body);
            const snap = snapshot(REVIEW_STARTED, false);
            assert.strictEqual(
                requiresImplementorDisposition({ snapshot: snap, worktreePath: null, specPath }),
                expected,
                `ESCALATE match for body: ${body.slice(0, 40)}`,
            );
        }
    }));

// Helper invariants: verdict-agnostic, missing reviewStartedAt falls back to ESCALATE: scan,
// no inputs returns false (graceful degradation).
test('helper edge cases: verdict-agnostic, missing reviewStartedAt, null inputs', () =>
    withTempDir('aigon-f530-edge-', (repo) => {
        initRepoWithImpl(repo);
        // --request-revision verdict: helper itself returns false (autonomous loop injects via separate path).
        const noReviewerOutput = writeSpec(repo, '## Code Review\n- None');
        assert.strictEqual(
            requiresImplementorDisposition({ snapshot: snapshot(REVIEW_STARTED, true), worktreePath: repo, specPath: noReviewerOutput }),
            false,
        );
        // Missing reviewStartedAt → skips git check, ESCALATE: scan still fires.
        const escalateSpec = writeSpec(repo, '## Code Review\n- ESCALATE:blocked — missing infra');
        assert.strictEqual(
            requiresImplementorDisposition({
                snapshot: { codeReview: { reviewStartedAt: null, requestRevision: false } },
                worktreePath: null, specPath: escalateSpec,
            }),
            true,
        );
        // No worktree + no spec path: false.
        assert.strictEqual(
            requiresImplementorDisposition({ snapshot: snapshot(REVIEW_STARTED, false), worktreePath: null, specPath: null }),
            false,
        );
        // code_revision_complete lifecycle satisfies the explicit gate.
        assert.strictEqual(
            isExplicitCodeRevisionComplete(
                { currentSpecState: 'code_revision_complete', codeReview: { requestRevision: false, reviewCompletedAt: REVIEW_COMPLETED } },
                '/no/repo', '528', 'cc',
            ),
            true,
        );
    }));

report();
