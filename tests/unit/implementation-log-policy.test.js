'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
    isImplementationLogRequired,
    discoverImplementationLogFiles,
    checkImplementationLogEvidence,
    snapshotModeToLogMode,
} = require('../../lib/implementation-log-policy');
const pp = require('../../lib/profile-placeholders');

function withTempDir(name, fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
    try {
        return fn(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

// REGRESSION: F685 default policy requires solo branch logs; never still opts out.
test('resolveImplementationLogVariant default requires solo branch minimal log', () => {
    assert.strictEqual(pp.resolveImplementationLogVariant('drive', undefined), 'minimal');
    assert.strictEqual(pp.resolveImplementationLogVariant('drive', 'fleet-only'), 'minimal');
    assert.strictEqual(pp.resolveImplementationLogVariant('drive', 'never'), 'skip');
    assert.strictEqual(pp.shouldWriteImplementationLogStarter({ mode: 'drive', loggingLevel: 'fleet-only' }), true);
    assert.strictEqual(pp.shouldWriteImplementationLogStarter({ mode: 'drive', loggingLevel: 'never' }), false);
});

test('isImplementationLogRequired respects never opt-out', () => {
    assert.strictEqual(isImplementationLogRequired('drive', undefined), true);
    assert.strictEqual(isImplementationLogRequired('drive', 'never'), false);
    assert.strictEqual(isImplementationLogRequired('fleet', 'never'), false);
});

test('discoverImplementationLogFiles keeps solo vs agent-specific names distinct', () => withTempDir('aigon-ilog-', (repo) => {
    const logsDir = path.join(repo, 'docs', 'specs', 'features', 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(path.join(logsDir, 'feature-01-solo-feature-log.md'), '# log\n');
    fs.writeFileSync(path.join(logsDir, 'feature-01-cc-other-log.md'), '# fleet\n');

    const solo = discoverImplementationLogFiles(repo, '1', 'solo');
    assert.deepStrictEqual(solo, ['feature-01-solo-feature-log.md']);

    const agent = discoverImplementationLogFiles(repo, '1', 'cc');
    assert.deepStrictEqual(agent, ['feature-01-cc-other-log.md']);
}));

test('checkImplementationLogEvidence detects missing required log', () => withTempDir('aigon-ilog-miss-', (repo) => {
    const result = checkImplementationLogEvidence({
        repoPath: repo,
        featureId: '42',
        agentId: 'solo',
        loggingLevel: undefined,
        mode: 'drive',
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.required, true);
    assert.match(result.expectedPattern, /feature-42-\*-log\.md/);
}));

test('checkImplementationLogEvidence passes when solo log exists', () => withTempDir('aigon-ilog-ok-', (repo) => {
    const logsDir = path.join(repo, 'docs', 'specs', 'features', 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const logPath = path.join(logsDir, 'feature-42-demo-log.md');
    fs.writeFileSync(logPath, 'Implemented demo.\n');

    const result = checkImplementationLogEvidence({
        repoPath: repo,
        featureId: '42',
        agentId: 'solo',
        loggingLevel: undefined,
        mode: 'drive',
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.logPath, logPath);
}));

test('snapshotModeToLogMode maps workflow modes', () => {
    assert.strictEqual(snapshotModeToLogMode('solo_branch'), 'drive');
    assert.strictEqual(snapshotModeToLogMode('solo_worktree'), 'drive-wt');
    assert.strictEqual(snapshotModeToLogMode('fleet'), 'fleet');
});
