#!/usr/bin/env node
'use strict';

// REGRESSION F685: missing required implementation logs block completion and surface at close.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { testAsync, withTempDirAsync } = require('../_helpers');
const engine = require('../../lib/workflow-core/engine');
const wf = require('../../lib/workflow-core');
const { runImplementationLogCloseGuard } = require('../../lib/implementation-log-policy');
const { resolveCloseIntegrityPolicy, isCloseFindingBlocking } = require('../../lib/close-integrity-policy');
const { CLOSE_INTEGRITY_GATES } = require('../../lib/close-integrity-policy');

const REPO_DIRS = [
    'docs/specs/features/03-in-progress',
    'docs/specs/features/logs',
    '.aigon/workflows/features',
    '.aigon/state',
];

function withTempRepo(fn) {
    return withTempDirAsync('aigon-ilog-gate-', async (dir) => {
        for (const sub of REPO_DIRS) fs.mkdirSync(path.join(dir, sub), { recursive: true });
        return fn(dir);
    });
}

function writeSpec(repo, id, name) {
    const specPath = path.join(repo, 'docs', 'specs', 'features', '03-in-progress', `feature-${id}-${name}.md`);
    fs.writeFileSync(specPath, `---\ncomplexity: low\n---\n# Feature: ${name}\n\n## Validation\nx\n`);
    return specPath;
}

testAsync('CLOSE_INTEGRITY_GATES includes implementation-log', () => {
    assert.ok(CLOSE_INTEGRITY_GATES.includes('implementation-log'));
});

testAsync('REGRESSION F685: close guard is advisory by default when log missing', () => withTempRepo(async (repo) => {
    writeSpec(repo, '01', 'no-log');
    await engine.startFeature(repo, '01', 'solo_branch', ['solo']);
    await engine.signalAgentReady(repo, '01', 'solo');

    const policy = resolveCloseIntegrityPolicy({});
    assert.strictEqual(isCloseFindingBlocking(policy, 'implementation-log'), false);

    const result = await runImplementationLogCloseGuard(repo, '01', { integrityPolicy: policy });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.advisory, true);
}));

testAsync('REGRESSION F685: close guard blocks when implementation-log gate is blocking', () => withTempRepo(async (repo) => {
    writeSpec(repo, '02', 'no-log-block');
    await engine.startFeature(repo, '02', 'solo_branch', ['solo']);
    await engine.signalAgentReady(repo, '02', 'solo');

    const policy = resolveCloseIntegrityPolicy({ featureClose: { blockingGates: ['implementation-log'] } });
    assert.strictEqual(isCloseFindingBlocking(policy, 'implementation-log'), true);

    const result = await runImplementationLogCloseGuard(repo, '02', { integrityPolicy: policy });
    assert.strictEqual(result.ok, false);

    const snapshot = await wf.showFeatureOrNull(repo, '02');
    assert.strictEqual(snapshot.lastCloseFailure.kind, 'implementation-log');
}));

testAsync('REGRESSION F685: close guard passes when solo branch log exists', () => withTempRepo(async (repo) => {
    writeSpec(repo, '03', 'has-log');
    const logsDir = path.join(repo, 'docs', 'specs', 'features', 'logs');
    fs.writeFileSync(path.join(logsDir, 'feature-03-has-log-log.md'), '## Status\nShipped.\n');
    await engine.startFeature(repo, '03', 'solo_branch', ['solo']);
    await engine.signalAgentReady(repo, '03', 'solo');

    const policy = resolveCloseIntegrityPolicy({ featureClose: { integrityPolicy: 'blocking' } });
    const result = await runImplementationLogCloseGuard(repo, '03', { integrityPolicy: policy });
    assert.strictEqual(result.ok, true);
}));

testAsync('REGRESSION F685: never logging_level skips close guard', () => withTempRepo(async (repo) => {
    writeSpec(repo, '04', 'never-log');
    fs.writeFileSync(path.join(repo, '.aigon', 'config.json'), JSON.stringify({ logging_level: 'never' }, null, 2));
    await engine.startFeature(repo, '04', 'solo_branch', ['solo']);
    await engine.signalAgentReady(repo, '04', 'solo');

    const policy = resolveCloseIntegrityPolicy({ featureClose: { integrityPolicy: 'blocking' } });
    const result = await runImplementationLogCloseGuard(repo, '04', {
        integrityPolicy: policy,
        config: { logging_level: 'never' },
    });
    assert.strictEqual(result.ok, true);
}));
