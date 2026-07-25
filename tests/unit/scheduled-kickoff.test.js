#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');
const sk = require('../../lib/scheduled-kickoff');

function withScheduleRepo(fn) {
    return withTempDir('aigon-pro-schedule-', (repo) => {
        const backlog = path.join(repo, 'docs', 'specs', 'features', '02-backlog');
        fs.mkdirSync(backlog, { recursive: true });
        fs.writeFileSync(path.join(backlog, 'feature-01-nightly-root.md'), [
            '---',
            'set: nightly',
            '---',
            '',
            '# Feature: nightly root',
            '',
        ].join('\n'));
        return fn(repo);
    });
}

// REGRESSION: set-autonomous schedule jobs must round-trip payload and argv for set-autonomous-start.
test('addJob persists set_autonomous payload and buildSpawnArgvForJob dispatches set-autonomous-start', () => withScheduleRepo((repo) => {
    const added = sk.addJob(repo, {
        kind: sk.SET_AUTONOMOUS_KIND,
        entityId: 'nightly',
        runAt: '2099-06-19T09:00:00Z',
        payload: {
            agents: ['cx', 'gg'],
            reviewAgent: 'cc',
            models: 'gpt-5,gpt-5-mini',
            efforts: 'high,medium',
            stopAfter: 'close',
        },
    });
    assert.strictEqual(added.ok, true, added.error);
    assert.strictEqual(added.job.kind, sk.SET_AUTONOMOUS_KIND);
    assert.strictEqual(added.job.entityId, 'nightly');
    assert.deepStrictEqual(added.job.payload.agents, ['cx', 'gg']);
    assert.strictEqual(added.job.payload.reviewAgent, 'cc');

    assert.deepStrictEqual(sk.buildSpawnArgvForJob(added.job), [
        'set-autonomous-start',
        'nightly',
        'cx',
        'gg',
        '--review-agent=cc',
        '--models=gpt-5,gpt-5-mini',
        '--efforts=high,medium',
        '--stop-after=close',
    ]);
}));

// REGRESSION: unsupported stopAfter values must be rejected before the job is persisted.
test('addJob rejects unsupported set stopAfter before persistence', () => withScheduleRepo((repo) => {
    const added = sk.addJob(repo, {
        kind: sk.SET_AUTONOMOUS_KIND,
        entityId: 'nightly',
        runAt: '2099-06-19T09:00:00Z',
        payload: { agents: ['cx'], stopAfter: 'eval' },
    });
    assert.strictEqual(added.ok, false);
    assert.match(added.error, /Only --stop-after=close/);
    assert.deepStrictEqual(sk.listJobs(repo, { includeAll: true }), []);
}));

// REGRESSION: pending schedule lookup must return the earliest runAt for a set.
test('buildPendingScheduleIndex exposes lookupSet for earliest pending set job', () => withScheduleRepo((repo) => {
    const later = sk.addJob(repo, {
        kind: sk.SET_AUTONOMOUS_KIND,
        entityId: 'nightly',
        runAt: '2099-06-20T09:00:00Z',
        payload: { agents: ['cx'], stopAfter: 'close' },
    });
    assert.strictEqual(later.ok, true, later.error);
    const earlier = sk.addJob(repo, {
        kind: sk.SET_AUTONOMOUS_KIND,
        entityId: 'nightly',
        runAt: '2099-06-19T09:00:00Z',
        payload: { agents: ['cx'], stopAfter: 'close' },
    });
    assert.strictEqual(earlier.ok, true, earlier.error);

    const idx = sk.buildPendingScheduleIndex(repo);
    assert.deepStrictEqual(idx.lookupSet('nightly'), {
        runAt: '2099-06-19T09:00:00Z',
        kind: sk.SET_AUTONOMOUS_KIND,
    });
}));

report();
