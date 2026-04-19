#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { test, withTempDir, report } = require('../_helpers');
const { applySpecReviewStatus, clearTierCache } = require('../../lib/dashboard-status-collector');

const DIRS = ['docs/specs/features/01-inbox', 'docs/specs/features/02-backlog', 'docs/specs/research-topics/01-inbox', 'docs/specs/research-topics/02-backlog'];
function initRepo(repo) {
    DIRS.forEach(d => fs.mkdirSync(path.join(repo, d), { recursive: true }));
    execSync('git init -q && git config user.email t@t && git config user.name t', { cwd: repo });
}
const commit = (repo, msg, body = '', allowEmpty = false) => execSync(
    `git add . && git commit -qm ${JSON.stringify(msg)}${allowEmpty ? ' --allow-empty' : ''}${body ? ' -m ' + JSON.stringify(body) : ''}`, { cwd: repo });
const mkItem = (id, stage, specPath) => [{ id, stage, specPath, updatedAt: new Date().toISOString(), validActions: [], nextActions: [] }];

// REGRESSION F278: pending spec-review badge/actions without per-entity git log scans.
test('feature backlog cards surface pending spec-review badge and actions', () => withTempDir('aigon-spec-review-', (repo) => {
    initRepo(repo);
    const specPath = path.join(repo, 'docs/specs/features/02-backlog/feature-12-test.md');
    fs.writeFileSync(specPath, '# Feature: test\n'); commit(repo, 'init');
    fs.writeFileSync(specPath, '# Feature: test\n\nReviewed.\n');
    commit(repo, 'spec-review: feature 12 — tighten acceptance criteria', 'Reviewer: gg');
    const items = mkItem('12', 'backlog', specPath);
    clearTierCache(repo); applySpecReviewStatus(repo, items, []);
    assert.strictEqual(items[0].specReview.pendingCount, 1);
    assert.deepStrictEqual(items[0].specReview.pendingAgents, ['gg']);
    assert.ok(items[0].validActions.some(a => a.action === 'feature-spec-review'));
    assert.ok(items[0].validActions.some(a => a.action === 'feature-spec-review-check'));
}));

// REGRESSION F278: --find-renames follows spec across inbox→backlog prioritise moves.
test('pending spec reviews survive visible spec renames', () => withTempDir('aigon-spec-review-', (repo) => {
    initRepo(repo);
    const inboxPath = path.join(repo, 'docs/specs/features/01-inbox/feature-test-topic.md');
    fs.writeFileSync(inboxPath, '# Feature: topic\n'); commit(repo, 'init');
    fs.writeFileSync(inboxPath, '# Feature: topic\n\nInbox review.\n');
    commit(repo, 'spec-review: feature test-topic — tighten scope', 'Reviewer: cx');
    const backlogPath = path.join(repo, 'docs/specs/features/02-backlog/feature-12-test-topic.md');
    fs.renameSync(inboxPath, backlogPath); commit(repo, 'chore: prioritise feature 12');
    const items = mkItem('12', 'backlog', backlogPath);
    clearTierCache(repo); applySpecReviewStatus(repo, items, []);
    assert.strictEqual(items[0].specReview.pendingCount, 1);
    assert.deepStrictEqual(items[0].specReview.pendingAgents, ['cx']);
}));

// REGRESSION F278: allowEmpty spec-review-check ack clears badge (no tree changes).
test('ack commit clears pending spec-review check action', () => withTempDir('aigon-spec-review-', (repo) => {
    initRepo(repo);
    const specPath = path.join(repo, 'docs/specs/research-topics/02-backlog/research-21-topic.md');
    fs.writeFileSync(specPath, '# Research: topic\n'); commit(repo, 'init');
    fs.writeFileSync(specPath, '# Research: topic\n\nReviewed.\n');
    commit(repo, 'spec-review: research 21 — tighten questions', 'Reviewer: cc');
    commit(repo, 'spec-review-check: research 21 — accepted', 'reviewed: cc', true);
    const items = mkItem('21', 'backlog', specPath);
    clearTierCache(repo); applySpecReviewStatus(repo, [], items);
    assert.strictEqual(items[0].specReview.pendingCount, 0);
    assert.ok(items[0].validActions.some(a => a.action === 'research-spec-review'));
    assert.ok(!items[0].validActions.some(a => a.action === 'research-spec-review-check'));
}));

report();
