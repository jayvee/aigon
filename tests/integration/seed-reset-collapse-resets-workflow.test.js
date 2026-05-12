#!/usr/bin/env node
'use strict';

// REGRESSION: seed-reset bug surfaced 2026-05-12 in brewboard. When a seed
// commit happened to leave a spec in 03-in-progress (or any active stage),
// the next `aigon seed-reset` would:
//   1. `aigon apply` bootstrap the workflow snapshot with lifecycle=implementing
//      (derived from folder position at clone time).
//   2. `rebuildSeedFeatureManifests({collapseActiveToBacklog: true})` move the
//      spec file back to 02-backlog/ but leave the snapshot untouched.
//   3. The dashboard then showed "Spec drift — use Reconcile" on day one.
// The fix in lib/commands/setup/seed-reset.js deletes the workflow dir at the
// same time the spec is collapsed, so the subsequent bootstrapMissingWorkflowSnapshots
// rebuilds it with the correct `backlog` lifecycle.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, report, withTempDir } = require('../_helpers');

const seedReset = require('../../lib/commands/setup/seed-reset');
const agentTrust = require('../../lib/commands/setup/agent-trust');
const workflowEngine = require('../../lib/workflow-core/engine');

function setupRepo(repoRoot) {
    const featuresRoot = path.join(repoRoot, 'docs', 'specs', 'features');
    for (const dir of ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused']) {
        fs.mkdirSync(path.join(featuresRoot, dir), { recursive: true });
    }
    fs.mkdirSync(path.join(repoRoot, '.aigon'), { recursive: true });
}

function writeSpec(repoRoot, stageFolder, filename, body = '# spec\n') {
    const dir = path.join(repoRoot, 'docs', 'specs', 'features', stageFolder);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, body);
    return filePath;
}

test('collapse-active-to-backlog also resets workflow snapshot so no drift', () => {
    withTempDir('aigon-seed-reset-drift-', (repoRoot) => {
        setupRepo(repoRoot);

        // Seed an active-stage spec — mimics the "feature 02 in 03-in-progress" state
        // that the brewboard seed HEAD had at commit ebfb113.
        const specPath = writeSpec(repoRoot, '03-in-progress', 'feature-02-brewery-import.md');

        // Pre-bootstrap the workflow snapshot the way `aigon apply` would, given
        // the spec is currently in 03-in-progress (lifecycle=implementing).
        workflowEngine.ensureEntityBootstrappedSync(
            repoRoot, 'feature', '02', 'implementing', specPath
        );
        const workflowDir = path.join(repoRoot, '.aigon', 'workflows', 'features', '02');
        assert.ok(fs.existsSync(path.join(workflowDir, 'snapshot.json')), 'pre-bootstrap snapshot exists');
        const preSnap = JSON.parse(fs.readFileSync(path.join(workflowDir, 'snapshot.json'), 'utf8'));
        assert.strictEqual(preSnap.lifecycle, 'implementing', 'pre-bootstrap lifecycle is implementing');

        // Run the collapse — this is what the seed-reset provision phase calls.
        seedReset.rebuildSeedFeatureManifests(repoRoot, { collapseActiveToBacklog: true });

        // Spec must have moved to 02-backlog.
        assert.ok(
            fs.existsSync(path.join(repoRoot, 'docs/specs/features/02-backlog/feature-02-brewery-import.md')),
            'spec moved to 02-backlog'
        );
        assert.ok(
            !fs.existsSync(path.join(repoRoot, 'docs/specs/features/03-in-progress/feature-02-brewery-import.md')),
            'spec no longer in 03-in-progress'
        );

        // Workflow dir for the collapsed feature must have been deleted, so the
        // next bootstrap call rebuilds with the correct lifecycle.
        assert.ok(!fs.existsSync(workflowDir), 'workflow dir reset to allow re-bootstrap');

        // Re-bootstrap from the post-collapse folder layout.
        const { features: missing } = agentTrust.findEntitiesMissingWorkflowState(repoRoot);
        assert.strictEqual(missing.length, 1, 'feature 02 surfaces as missing after collapse');
        assert.strictEqual(missing[0].stage, 'backlog', 'discovered at backlog stage');
        agentTrust.bootstrapMissingWorkflowSnapshots(repoRoot, missing, 'feature');

        const postSnap = JSON.parse(
            fs.readFileSync(path.join(workflowDir, 'snapshot.json'), 'utf8')
        );
        assert.strictEqual(postSnap.lifecycle, 'backlog',
            'post-collapse snapshot now agrees with the spec folder — no drift');
    });
});

test('collapse leaves backlog/inbox specs alone (no spurious workflow resets)', () => {
    withTempDir('aigon-seed-reset-drift-', (repoRoot) => {
        setupRepo(repoRoot);

        // Feature that should NOT be collapsed — it's already in backlog.
        const specPath = writeSpec(repoRoot, '02-backlog', 'feature-01-format-date.md');
        workflowEngine.ensureEntityBootstrappedSync(repoRoot, 'feature', '01', 'backlog', specPath);
        const workflowDir = path.join(repoRoot, '.aigon', 'workflows', 'features', '01');
        assert.ok(fs.existsSync(workflowDir), 'pre-bootstrap workflow dir exists');

        seedReset.rebuildSeedFeatureManifests(repoRoot, { collapseActiveToBacklog: true });

        assert.ok(fs.existsSync(workflowDir),
            'backlog spec workflow dir untouched by collapse (only active stages get reset)');
    });
});

report();
