#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0;
let failed = 0;

function test(description, fn) {
    try {
        fn();
        console.log(`  \u2713 ${description}`);
        passed++;
    } catch (err) {
        console.error(`  \u2717 ${description}`);
        console.error(`    ${err.stack || err.message}`);
        failed++;
    }
}

function withTempRepo(fn) {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-pro-schedule-'));
    try {
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
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
}

const sk = require('../../lib/scheduled-kickoff');

console.log('\n  scheduled set autonomous kickoffs');

test('addJob persists set_autonomous payload and buildSpawnArgvForJob dispatches set-autonomous-start', () => withTempRepo((repo) => {
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

test('addJob rejects unsupported set stopAfter before persistence', () => withTempRepo((repo) => {
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

test('buildPendingScheduleIndex exposes lookupSet for earliest pending set job', () => withTempRepo((repo) => {
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

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
