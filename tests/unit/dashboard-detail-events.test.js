'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { decorateDetailEvent } = require('../../lib/dashboard-detail');

describe('decorateDetailEvent', () => {
  it('adds readable labels and actor to lease events', () => {
    const decorated = decorateDetailEvent({
      type: 'lease.acquired',
      at: '2026-07-11T23:10:00.000Z',
      leaseRole: 'impl',
      holderId: 'docker-machine-b',
      user: 'testuser-b@example.com',
      agentId: 'cu',
      expiresAt: '2026-07-11T23:40:00.000Z',
    });

    assert.strictEqual(decorated.displayLabel, 'Lease acquired');
    assert.strictEqual(decorated.displayActor, 'testuser-b@example.com @ docker-machine-b (CU)');
    assert.match(decorated.message, /impl lease/);
    assert.match(decorated.message, /expires 2026-07-11T23:40:00.000Z/);
  });
});
