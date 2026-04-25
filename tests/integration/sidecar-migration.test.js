#!/usr/bin/env node
// REGRESSION (F343): migration 2.58.0 replays sidecar into events.jsonl, deletes sidecar, is idempotent.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { testAsync, withTempDirAsync, report } = require('../_helpers');
const { runPendingMigrations } = require('../../lib/migration');
const evts = (repo, id) => fs.readFileSync(path.join(repo, '.aigon', 'workflows', 'features', id, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const H = [{ agent: 'gg', status: 'complete', startedAt: '2026-04-01T10:00:00Z', completedAt: '2026-04-01T10:05:00Z', cycle: 1 }, { agent: 'cx', status: 'complete', startedAt: '2026-04-01T11:00:00Z', completedAt: '2026-04-01T11:05:00Z', cycle: 2 }];
function seed(repo, id, history, clearEvents) {
    const root = path.join(repo, '.aigon', 'workflows', 'features', id);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'review-state.json'), JSON.stringify({ current: null, history }));
    if (clearEvents) fs.writeFileSync(path.join(root, 'events.jsonl'), '');
    if (!fs.existsSync(path.join(root, 'snapshot.json'))) fs.writeFileSync(path.join(root, 'snapshot.json'), JSON.stringify({ entityType: 'feature', featureId: id, lifecycle: 'submitted', currentSpecState: 'submitted', mode: 'solo_branch', agents: {}, eventCount: 1, reviewCycles: [], createdAt: '2026-04-01T00:00:00Z', updatedAt: '2026-04-01T00:00:00Z' }));
}
testAsync('migration 2.58.0: replays sidecar as started+completed events, deletes sidecar; idempotent when events already exist', () => withTempDirAsync('aigon-mig258-', async (repo) => {
    fs.mkdirSync(path.join(repo, 'docs/specs/features/02-backlog'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'docs/specs/features/02-backlog/feature-20-mig.md'), '# mig\n');
    execSync('git init -q && git config user.email t@t && git config user.name t && git add . && git commit -qm init', { cwd: repo });
    seed(repo, '20', H, true);
    await runPendingMigrations(repo);
    const e = evts(repo, '20');
    assert.strictEqual(e.filter(x => x.type === 'feature.code_review.started').length, 2);
    assert.strictEqual(e.filter(x => x.type === 'feature.code_review.completed').length, 2);
    assert.strictEqual(fs.existsSync(path.join(repo, '.aigon', 'workflows', 'features', '20', 'review-state.json')), false, 'sidecar deleted');
    assert.ok(fs.existsSync(path.join(repo, '.aigon', 'state', 'migrations-backup', '2.58.0', 'features', '20-review-state.json')), 'backup exists');
    // Idempotency: delete manifest to force re-run; pre-existing events must not duplicate
    fs.rmSync(path.join(repo, '.aigon', 'migrations', '2.58.0', 'manifest.json'));
    seed(repo, '20', H, false); // re-seed sidecar only, keep events.jsonl
    await runPendingMigrations(repo);
    assert.strictEqual(evts(repo, '20').filter(x => x.type === 'feature.code_review.started').length, 2, 'idempotent: no duplicate events');
}));
report();
