#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { test, report } = require('../_helpers');
const state = require('../../lib/spec-review-state');

test('entity IDs normalize and compare consistently', () => {
    for (const [input, expected] of [['07', '7'], ['007', '7'], ['42', '42'], ['my-topic', 'my-topic'], ['', ''], [null, ''], [undefined, '']]) {
        assert.strictEqual(state.normalizeEntityId(input), expected);
    }
    assert.strictEqual(state.sameEntityId('007', '7'), true);
    assert.strictEqual(state.sameEntityId('7', '8'), false);
});

test('review commit subjects parse supported actions', () => {
    for (const [subject, expected] of [
        ['spec-review: feature 42 — looks good', { entityType: 'feature', entityId: '42', isReview: true, isAck: false }],
        ['spec-revise: research 12', { entityType: 'research', entityId: '12', isReview: false, isAck: true }],
        ['spec-review-check: feature 99', { entityType: 'feature', entityId: '99', isReview: false, isAck: true }],
    ]) {
        const parsed = state.parseSpecReviewSubject(subject);
        for (const [key, value] of Object.entries(expected)) assert.strictEqual(parsed[key], value, `${subject}: ${key}`);
    }
    for (const subject of ['feat: add thing', '', null]) assert.strictEqual(state.parseSpecReviewSubject(subject), null);
});

test('reviewer IDs enforce the persisted lowercase format', () => {
    for (const id of ['cc', 'gg', 'cx', 'abcdefghij']) assert.strictEqual(state.isValidReviewerId(id), true, id);
    for (const id of ['unknown', 'CC', 'c', '', null]) assert.strictEqual(state.isValidReviewerId(id), false, String(id));
});

test('review metadata extraction ignores absent and invalid IDs', () => {
    assert.strictEqual(state.extractSpecReviewerId('Some body\nReviewer: cc\nMore text'), 'cc');
    for (const body of ['No reviewer here', 'Reviewer: unknown', 'Reviewer: CC', '']) {
        assert.strictEqual(state.extractSpecReviewerId(body), null);
    }
    assert.deepStrictEqual(state.extractReviewedAgentIds('Summary\nreviewed: cc, gg, cx\nFooter'), ['cc', 'gg', 'cx']);
    assert.deepStrictEqual(state.extractReviewedAgentIds('reviewed: cc, unknown, CC'), ['cc']);
    assert.deepStrictEqual(state.extractReviewedAgentIds('no reviewed line'), []);
});

test('spec review returns to its captured pre-review lifecycle', () => {
    assert.strictEqual(state.resolveSpecReviewRestingLifecycle({}, 'inbox'), 'inbox');
    const context = { specReviewReturnLifecycle: 'inbox' };
    assert.strictEqual(state.resolveSpecReviewRestingLifecycle(context, 'spec_review_in_progress'), 'inbox');
    assert.strictEqual(context.specReviewReturnLifecycle, null);
    assert.deepStrictEqual(
        ['inbox', 'backlog', 'spec_review_in_progress'].map(state.captureSpecReviewReturnLifecycle),
        ['inbox', 'backlog', 'backlog']
    );
});

report();
