#!/usr/bin/env node
'use strict';

// Missing coverage: lib/spec-review-state.js — pure helpers for spec-review
// commit parsing. These are critical-path for the review cycle; a regression
// silently drops reviews or misattributes them to the wrong entity.

const assert = require('assert');
const { test, report } = require('../_helpers');
const {
    normalizeEntityId,
    sameEntityId,
    parseSpecReviewSubject,
    isValidReviewerId,
    extractSpecReviewerId,
    extractReviewedAgentIds,
} = require('../../lib/spec-review-state');

// --- normalizeEntityId ---

test('normalizeEntityId: strips leading zeros from numeric IDs', () => {
    assert.strictEqual(normalizeEntityId('07'), '7');
    assert.strictEqual(normalizeEntityId('007'), '7');
    assert.strictEqual(normalizeEntityId('42'), '42');
});

test('normalizeEntityId: passes through non-numeric slugs unchanged', () => {
    assert.strictEqual(normalizeEntityId('my-topic'), 'my-topic');
});

test('normalizeEntityId: returns empty string for empty/falsy input', () => {
    assert.strictEqual(normalizeEntityId(''), '');
    assert.strictEqual(normalizeEntityId(null), '');
    assert.strictEqual(normalizeEntityId(undefined), '');
});

// --- sameEntityId ---

test('sameEntityId: treats "07" and "7" as equal', () => {
    assert.ok(sameEntityId('07', '7'));
    assert.ok(sameEntityId('007', '7'));
});

test('sameEntityId: distinguishes different IDs', () => {
    assert.ok(!sameEntityId('7', '8'));
});

// --- parseSpecReviewSubject ---

test('parseSpecReviewSubject: parses review subject for feature', () => {
    const r = parseSpecReviewSubject('spec-review: feature 42 — looks good');
    assert.ok(r);
    assert.strictEqual(r.entityType, 'feature');
    assert.strictEqual(r.entityId, '42');
    assert.strictEqual(r.isReview, true);
    assert.strictEqual(r.isAck, false);
});

test('parseSpecReviewSubject: parses revise subject (isAck=true)', () => {
    const r = parseSpecReviewSubject('spec-revise: research 12');
    assert.ok(r);
    assert.strictEqual(r.entityType, 'research');
    assert.strictEqual(r.isAck, true);
    assert.strictEqual(r.isReview, false);
});

test('parseSpecReviewSubject: parses review-check subject (isAck=true)', () => {
    const r = parseSpecReviewSubject('spec-review-check: feature 99');
    assert.ok(r);
    assert.strictEqual(r.isAck, true);
});

test('parseSpecReviewSubject: returns null for non-matching subject', () => {
    assert.strictEqual(parseSpecReviewSubject('feat: add thing'), null);
    assert.strictEqual(parseSpecReviewSubject(''), null);
    assert.strictEqual(parseSpecReviewSubject(null), null);
});

// --- isValidReviewerId ---

test('isValidReviewerId: accepts lowercase 2-10 char IDs', () => {
    assert.ok(isValidReviewerId('cc'));
    assert.ok(isValidReviewerId('gg'));
    assert.ok(isValidReviewerId('cx'));
    assert.ok(isValidReviewerId('abcdefghij'));
});

test('isValidReviewerId: rejects "unknown" and invalid formats', () => {
    assert.ok(!isValidReviewerId('unknown'));
    assert.ok(!isValidReviewerId('CC'));
    assert.ok(!isValidReviewerId('c'));
    assert.ok(!isValidReviewerId(''));
    assert.ok(!isValidReviewerId(null));
});

// --- extractSpecReviewerId ---

test('extractSpecReviewerId: extracts reviewer from Reviewer: line', () => {
    assert.strictEqual(extractSpecReviewerId('Some body\nReviewer: cc\nMore text'), 'cc');
});

test('extractSpecReviewerId: returns null when line is absent or invalid', () => {
    assert.strictEqual(extractSpecReviewerId('No reviewer here'), null);
    assert.strictEqual(extractSpecReviewerId('Reviewer: unknown'), null);
    assert.strictEqual(extractSpecReviewerId('Reviewer: CC'), null);
    assert.strictEqual(extractSpecReviewerId(''), null);
});

// --- extractReviewedAgentIds ---

test('extractReviewedAgentIds: parses comma-separated reviewed: line', () => {
    const ids = extractReviewedAgentIds('Summary\nreviewed: cc, gg, cx\nFooter');
    assert.deepStrictEqual(ids, ['cc', 'gg', 'cx']);
});

test('extractReviewedAgentIds: filters invalid IDs from the list', () => {
    const ids = extractReviewedAgentIds('reviewed: cc, unknown, CC');
    assert.deepStrictEqual(ids, ['cc']);
});

test('extractReviewedAgentIds: returns empty array when reviewed: line absent', () => {
    assert.deepStrictEqual(extractReviewedAgentIds('no reviewed line'), []);
    assert.deepStrictEqual(extractReviewedAgentIds(''), []);
});

report();
