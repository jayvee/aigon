#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { test, withTempDir, report } = require('../_helpers');
const { applySpecReviewStatus, clearTierCache } = require('../../lib/dashboard-status-collector');

function initRepo(repo) {
    [
        'docs/specs/features/01-inbox',
        'docs/specs/features/02-backlog',
        'docs/specs/research-topics/01-inbox',
        'docs/specs/research-topics/02-backlog',
    ].forEach(dir => fs.mkdirSync(path.join(repo, dir), { recursive: true }));
    execSync('git init -q', { cwd: repo });
    execSync('git config user.email t@t', { cwd: repo });
    execSync('git config user.name t', { cwd: repo });
}

function commitAll(repo, message, body = '', options = {}) {
    execSync('git add .', { cwd: repo });
    const allowEmpty = options.allowEmpty ? ' --allow-empty' : '';
    const cmd = body
        ? `git commit -qm ${JSON.stringify(message)}${allowEmpty} -m ${JSON.stringify(body)}`
        : `git commit -qm ${JSON.stringify(message)}${allowEmpty}`;
    execSync(cmd, { cwd: repo });
}

test('feature backlog cards surface pending spec-review badge and actions', () => withTempDir('aigon-spec-review-', (repo) => {
    initRepo(repo);
    const specPath = path.join(repo, 'docs/specs/features/02-backlog/feature-12-test.md');
    fs.writeFileSync(specPath, '# Feature: test\n');
    commitAll(repo, 'init');

    fs.writeFileSync(specPath, '# Feature: test\n\nReviewed.\n');
    commitAll(repo, 'spec-review: feature 12 — tighten acceptance criteria', 'Reviewer: gg');

    const items = [{ id: '12', stage: 'backlog', specPath, updatedAt: new Date().toISOString(), validActions: [], nextActions: [] }];
    clearTierCache(repo);
    applySpecReviewStatus(repo, items, []);

    assert.strictEqual(items[0].specReview.pendingCount, 1);
    assert.deepStrictEqual(items[0].specReview.pendingAgents, ['gg']);
    assert.ok(items[0].validActions.some(action => action.action === 'feature-spec-review'));
    assert.ok(items[0].validActions.some(action => action.action === 'feature-spec-review-check'));
}));

test('pending spec reviews survive visible spec renames', () => withTempDir('aigon-spec-review-', (repo) => {
    initRepo(repo);
    const inboxPath = path.join(repo, 'docs/specs/features/01-inbox/feature-test-topic.md');
    fs.writeFileSync(inboxPath, '# Feature: topic\n');
    commitAll(repo, 'init');

    fs.writeFileSync(inboxPath, '# Feature: topic\n\nInbox review.\n');
    commitAll(repo, 'spec-review: feature test-topic — tighten scope', 'Reviewer: cx');

    const backlogPath = path.join(repo, 'docs/specs/features/02-backlog/feature-12-test-topic.md');
    fs.mkdirSync(path.dirname(backlogPath), { recursive: true });
    fs.renameSync(inboxPath, backlogPath);
    commitAll(repo, 'chore: prioritise feature 12');

    const items = [{ id: '12', stage: 'backlog', specPath: backlogPath, updatedAt: new Date().toISOString(), validActions: [], nextActions: [] }];
    clearTierCache(repo);
    applySpecReviewStatus(repo, items, []);

    assert.strictEqual(items[0].specReview.pendingCount, 1);
    assert.deepStrictEqual(items[0].specReview.pendingAgents, ['cx']);
}));

test('ack commit clears pending spec-review check action', () => withTempDir('aigon-spec-review-', (repo) => {
    initRepo(repo);
    const specPath = path.join(repo, 'docs/specs/research-topics/02-backlog/research-21-topic.md');
    fs.writeFileSync(specPath, '# Research: topic\n');
    commitAll(repo, 'init');

    fs.writeFileSync(specPath, '# Research: topic\n\nReviewed.\n');
    commitAll(repo, 'spec-review: research 21 — tighten questions', 'Reviewer: cc');
    commitAll(repo, 'spec-review-check: research 21 — accepted', 'reviewed: cc', { allowEmpty: true });

    const items = [{ id: '21', stage: 'backlog', specPath, updatedAt: new Date().toISOString(), validActions: [], nextActions: [] }];
    clearTierCache(repo);
    applySpecReviewStatus(repo, [], items);

    assert.strictEqual(items[0].specReview.pendingCount, 0);
    assert.ok(items[0].validActions.some(action => action.action === 'research-spec-review'));
    assert.ok(!items[0].validActions.some(action => action.action === 'research-spec-review-check'));
}));

report();
