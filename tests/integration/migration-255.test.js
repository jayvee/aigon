#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { testAsync, withTempDirAsync, report } = require('../_helpers');
const { runPendingMigrations } = require('../../lib/migration');

function makeRepo(dir) {
    const { execSync } = require('child_process');
    fs.mkdirSync(dir, { recursive: true });
    execSync('git init -q && git config user.email t@t && git config user.name t && git commit --allow-empty -qm init', { cwd: dir });
}

function seedSnapshot(repo, entityDir, id, overrides = {}) {
    const dir = path.join(repo, '.aigon', 'workflows', entityDir, String(id));
    fs.mkdirSync(dir, { recursive: true });
    const snap = Object.assign({
        featureId: String(id),
        entityType: entityDir === 'features' ? 'feature' : 'research',
        lifecycle: 'implementing',
        currentSpecState: 'in-progress',
        mode: 'solo_branch',
        agents: {},
        winnerAgentId: null,
        effects: [],
        specReview: { pendingReviews: [], pendingCount: 0 },
    }, overrides);
    fs.writeFileSync(path.join(dir, 'snapshot.json'), JSON.stringify(snap, null, 2));
    return path.join(dir, 'snapshot.json');
}

testAsync('migration 2.55.0 rewrites counter-review stage type in snapshots', () => withTempDirAsync('aigon-mig-255-', async (repo) => {
    makeRepo(repo);
    const snapPath = seedSnapshot(repo, 'features', '10', {
        workflowStage: { type: 'counter-review' },
        currentStage: 'counter-review',
    });

    // Seed raw JSON with old terminology
    const raw = JSON.stringify({
        featureId: '10', lifecycle: 'implementing', currentSpecState: 'in-progress',
        workflowStage: { type: 'counter-review' },
        status: 'spec-review-check-pending',
        events: [{ type: 'spec.review.checked' }, { type: 'code.review.checked' }],
    }, null, 2);
    fs.writeFileSync(snapPath, raw);

    await runPendingMigrations(repo);

    const after = fs.readFileSync(snapPath, 'utf8');
    assert.ok(!after.includes('counter-review'), 'counter-review should be gone');
    assert.ok(!after.includes('review-check-pending'), 'review-check-pending should be gone');
    assert.ok(!after.includes('spec.review.checked'), 'spec.review.checked event should be gone');
    assert.ok(!after.includes('code.review.checked'), 'code.review.checked event should be gone');
    assert.ok(after.includes('"revision"'), 'revision should appear');
    assert.ok(after.includes('revision-pending'), 'revision-pending should appear');
    assert.ok(after.includes('"spec.revised"'), 'spec.revised event should appear');
    assert.ok(after.includes('"code.revised"'), 'code.revised event should appear');
}));

testAsync('migration 2.55.0 is idempotent — running twice produces no further changes', () => withTempDirAsync('aigon-mig-255-idem-', async (repo) => {
    makeRepo(repo);
    const snapPath = seedSnapshot(repo, 'features', '11', {});
    const raw = JSON.stringify({
        featureId: '11', lifecycle: 'implementing',
        workflowStage: { type: 'counter-review' },
        status: 'code-review-check-pending',
    }, null, 2);
    fs.writeFileSync(snapPath, raw);

    await runPendingMigrations(repo);
    const afterFirst = fs.readFileSync(snapPath, 'utf8');

    // Reset migration manifest to allow re-running
    const manifestDir = path.join(repo, '.aigon', 'migrations');
    if (fs.existsSync(manifestDir)) {
        fs.rmSync(manifestDir, { recursive: true });
    }

    await runPendingMigrations(repo);
    const afterSecond = fs.readFileSync(snapPath, 'utf8');

    assert.strictEqual(afterFirst, afterSecond, 'second run must not change the file');
}));

report();
