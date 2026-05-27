#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');
const {
    copySessionToDurable,
    finaliseEntityTranscripts,
    renameTranscriptDirSync,
    findDurablePath,
    resolveTranscriptEntityDir,
} = require('../../lib/transcript-store');

// ── helpers ──────────────────────────────────────────────────────────────────

function makeSession(sessionsDir, name, overrides = {}) {
    const sidecar = Object.assign({
        sessionName: name,
        entityType: 'f',
        entityId: '42',
        agent: 'cc',
        repoPath: '/tmp/repo',
        worktreePath: '/tmp/repo',
        createdAt: '2026-04-28T00:00:00.000Z',
        agentSessionId: 'uuid-abc',
        agentSessionPath: null,
    }, overrides);
    fs.writeFileSync(path.join(sessionsDir, `${name}.json`), JSON.stringify(sidecar));
    return sidecar;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// REGRESSION: feature-close → transcript copied to hot tier
test('finaliseEntityTranscripts copies session body to hot tier', () => withTempDir('aigon-ts-', (tmp) => {
    const sessionsDir = path.join(tmp, '.aigon', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });

    // Write a fake native transcript body
    const nativeBody = path.join(tmp, 'uuid-abc.jsonl');
    fs.writeFileSync(nativeBody, '{"type":"message"}\n');

    makeSession(sessionsDir, 'aigon-f42-do-cc', {
        entityType: 'f', entityId: '42', agent: 'cc',
        agentSessionId: 'uuid-abc', agentSessionPath: nativeBody,
    });

    const result = finaliseEntityTranscripts(tmp, 'feature', '42');
    assert.strictEqual(result.copied, 1);

    // Durable body must exist
    const durablePath = findDurablePath(tmp, 'feature', '42', 'cc', 'uuid-abc');
    assert.ok(durablePath, 'durable path should be found');
    assert.ok(fs.existsSync(durablePath), 'durable file must exist on disk');

    // Native body must NOT be deleted (copy, not move)
    assert.ok(fs.existsSync(nativeBody), 'native body must remain after copy');

    // .meta.json must exist alongside
    const metaPath = durablePath.replace(/(\.[^.]+)$/, '.meta.json');
    assert.ok(fs.existsSync(metaPath), '.meta.json must exist');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    assert.strictEqual(meta.schemaVersion, 1);
    assert.strictEqual(meta.agentSessionId, 'uuid-abc');
    assert.ok(meta.nativeBodyBytes > 0);
    assert.strictEqual(meta.complete, true);
    assert.strictEqual(meta.finalisedBy, 'feature-close');
}));

// REGRESSION: prioritise → slug directory renamed to numeric ID
test('renameTranscriptDirSync renames slug dir to numeric id', () => withTempDir('aigon-ts-', (tmp) => {
    const repoPath = tmp;
    // Create a slug-keyed transcript dir with a file inside
    const slugDir = resolveTranscriptEntityDir(repoPath, 'feature', 'my-cool-feature');
    fs.mkdirSync(slugDir, { recursive: true });
    fs.writeFileSync(path.join(slugDir, 'implement-uuid.jsonl'), 'data');

    renameTranscriptDirSync(repoPath, 'feature', 'my-cool-feature', '42');

    // Slug dir must be gone
    assert.ok(!fs.existsSync(slugDir), 'slug dir must no longer exist');

    // Numeric dir must exist and contain the file
    const numDir = resolveTranscriptEntityDir(repoPath, 'feature', '42');
    assert.ok(fs.existsSync(numDir), 'numeric dir must exist');
    assert.ok(fs.existsSync(path.join(numDir, 'implement-uuid.jsonl')), 'file must be present under numeric dir');
}));

// Edge cases: missing source body, missing slug dir, missing durable copy.
test('edge cases: missing source body, missing slug dir, missing durable copy', () => withTempDir('aigon-ts-', (tmp) => {
    const { durableBodyPath, metaPath } = copySessionToDurable(tmp, 'feature', '1', 'cc', {
        agentSessionId: 'uuid-missing',
        agentSessionPath: '/nonexistent/path/uuid-missing.jsonl',
        sessionName: 'aigon-f1-do-cc',
    }, null);
    assert.strictEqual(durableBodyPath, null);
    assert.ok(fs.existsSync(metaPath));
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    assert.strictEqual(meta.complete, false);
    assert.strictEqual(meta.nativeBodyBytes, 0);

    renameTranscriptDirSync(tmp, 'feature', 'nonexistent-slug', '99'); // must not throw
    assert.ok(!fs.existsSync(resolveTranscriptEntityDir(tmp, 'feature', '99')));

    assert.strictEqual(findDurablePath(tmp, 'feature', '42', 'cc', 'uuid-none'), null);
}));

report();
