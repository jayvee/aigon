#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { testAsync, withTempDirAsync, report } = require('../_helpers');
const { runPendingMigrations, _internals } = require('../../lib/migration');
const { detectMissingMigration } = require('../../lib/workflow-read-model');

// Pre-F341 snapshot shape: specReview sidecar on lifecycle: backlog with active reviewers.
// detectMissingMigration() returns true for this shape; migration 2.56.0 should fix it.
function preF341Snapshot(id) {
    return {
        entityType: 'feature',
        featureId: String(id),
        lifecycle: 'backlog',
        currentSpecState: 'backlog',
        specReview: {
            activeReviewers: [{ agentId: 'gg', startedAt: '2026-04-01T10:00:00Z' }],
            pendingCount: 0,
        },
        mode: 'solo_branch',
        agents: {},
        createdAt: '2026-04-01T10:00:00Z',
        updatedAt: '2026-04-01T10:00:00Z',
    };
}

function writeSnapshot(repoPath, idDir, snapshot) {
    const dir = path.join(repoPath, '.aigon', 'workflows', 'features', String(idDir));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'snapshot.json'), JSON.stringify(snapshot, null, 2) + '\n');
}

function readSnapshot(repoPath, idDir) {
    const p = path.join(repoPath, '.aigon', 'workflows', 'features', String(idDir), 'snapshot.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// REGRESSION: F353 — doctor --fix must call runPendingMigrations so that pre-F341 snapshots
// (specReview sidecar on lifecycle:backlog) get rewritten to spec_review_in_progress.
testAsync('runPendingMigrations rewrites pre-F341 snapshot and is idempotent', () => withTempDirAsync('aigon-f353-mig-', async (tmp) => {
    writeSnapshot(tmp, '77', preF341Snapshot('77'));

    // First run: migration 2.56.0 should apply and rewrite snapshot
    const first = await runPendingMigrations(tmp);
    const applied = first.filter(r => r.status === 'success');
    assert.ok(applied.some(r => r.version === '2.56.0'), `expected 2.56.0 to be applied; got ${JSON.stringify(first)}`);

    const after = readSnapshot(tmp, '77');
    assert.strictEqual(after.lifecycle, 'spec_review_in_progress',
        `expected lifecycle=spec_review_in_progress after migration; got ${after.lifecycle}`);
    assert.strictEqual(after.currentSpecState, 'spec_review_in_progress',
        `expected currentSpecState=spec_review_in_progress; got ${after.currentSpecState}`);

    // Second run: all migrations should be skipped (idempotent)
    const second = await runPendingMigrations(tmp);
    const nonSkipped = second.filter(r => r.status !== 'skipped');
    assert.strictEqual(nonSkipped.length, 0,
        `expected all migrations skipped on second run; got ${JSON.stringify(nonSkipped)}`);
}));

// REGRESSION: F353 — detect-only path must report pending migrations without applying them.
testAsync('detect-only path counts pending migrations via _internals', () => withTempDirAsync('aigon-f353-detect-', async (tmp) => {
    // No manifests yet — all registered migrations should show as pending
    const pendingBefore = [..._internals.migrations.values()]
        .filter(({ version }) => {
            const m = _internals.readManifest(tmp, version);
            return !m || m.status !== 'success';
        });
    assert.ok(pendingBefore.length > 0, 'expected at least one pending migration before any run');

    // After running migrations, all should be applied (no pending)
    await runPendingMigrations(tmp);
    const pendingAfter = [..._internals.migrations.values()]
        .filter(({ version }) => {
            const m = _internals.readManifest(tmp, version);
            return !m || m.status !== 'success';
        });
    assert.strictEqual(pendingAfter.length, 0, 'expected no pending migrations after runPendingMigrations');
}));

// DRIFT PREVENTION: for every snapshot shape that triggers detectMissingMigration (MISSING_MIGRATION),
// at least one registered migration must exist that resolves it. If a new MISSING_MIGRATION trigger
// is added without a corresponding migration, this test must fail.
testAsync('drift prevention: every detectMissingMigration trigger has a registered migration', () => withTempDirAsync('aigon-f353-drift-', async (tmp) => {
    // Shapes that detectMissingMigration returns true for
    const triggerShapes = [
        // activeReviewers case
        { lifecycle: 'backlog', currentSpecState: 'backlog', specReview: { activeReviewers: [{ agentId: 'gg' }] } },
        // pendingCount case
        { lifecycle: 'inbox', currentSpecState: 'inbox', specReview: { activeReviewers: [], pendingCount: 1 } },
    ];

    for (const shape of triggerShapes) {
        assert.ok(detectMissingMigration(shape), `expected detectMissingMigration to return true for: ${JSON.stringify(shape)}`);
    }

    // Migration 2.56.0 must be registered — it is the producer that resolves the specReview/backlog gap
    assert.ok(_internals.migrations.has('2.56.0'),
        'migration 2.56.0 must be registered to resolve MISSING_MIGRATION trigger shapes');

    // Running migrations against the trigger shape must resolve it (no longer triggers MISSING_MIGRATION)
    writeSnapshot(tmp, '88', { ...triggerShapes[0], entityType: 'feature', featureId: '88' });
    await runPendingMigrations(tmp);
    const resolved = readSnapshot(tmp, '88');
    assert.ok(!detectMissingMigration(resolved),
        `expected detectMissingMigration to return false after migration; got lifecycle=${resolved.lifecycle}`);
}));

report();
