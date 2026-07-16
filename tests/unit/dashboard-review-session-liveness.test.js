#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { test, report } = require('../_helpers');
const { enrichReviewSessionsWithLiveness } = require('../../lib/dashboard-collect/entity-core');

test('completed review keeps task outcome while exposing a live terminal', () => {
    const [review] = enrichReviewSessionsWithLiveness('/tmp/aigon-review-liveness', '09', [{
        agent: null,
        session: 'repo-f9-review-op-dark-mode',
        running: false,
        status: 'complete',
    }], {
        sessionHost: { isSessionAlive: name => name === 'repo-f9-review-op-dark-mode' },
    });

    assert.strictEqual(review.status, 'complete');
    assert.strictEqual(review.running, false);
    assert.strictEqual(review.sessionRunning, true);
});

report();
