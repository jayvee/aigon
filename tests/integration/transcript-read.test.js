#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');
const {
    collectTranscriptRecords,
    resolveTranscriptDownload,
    formatTranscriptCliOutput,
    openTranscriptPath,
} = require('../../lib/transcript-read');

test('collectTranscriptRecords returns empty array when no sessions exist', () => withTempDir('aigon-tr-', (tmp) => {
    const records = collectTranscriptRecords(tmp, 'feature', '42', null);
    assert.deepStrictEqual(records, []);
}));

test('collectTranscriptRecords returns not-captured for agents without session strategy', () => withTempDir('aigon-tr-', (tmp) => {
    const sessionsDir = path.join(tmp, '.aigon', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, 'aigon-f42-do-cu.json'), JSON.stringify({
        sessionName: 'aigon-f42-do-cu',
        entityType: 'f',
        entityId: '42',
        agent: 'cu',
        role: 'do',
        repoPath: tmp,
        worktreePath: tmp,
        createdAt: '2026-04-28T00:00:00.000Z',
    }));
    const records = collectTranscriptRecords(tmp, 'feature', '42', null);
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].captured, false);
    assert.strictEqual(records[0].agent, 'cu');
    assert.ok(records[0].reason.includes('not supported'));
}));

test('collectTranscriptRecords returns not-captured for pre-F357 sessions missing agentSessionId', () => withTempDir('aigon-tr-', (tmp) => {
    // REGRESSION: cu/op/km, or pre-F357 sessions must return structured "not captured" response.
    const sessionsDir = path.join(tmp, '.aigon', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, 'aigon-f42-do-cc.json'), JSON.stringify({
        sessionName: 'aigon-f42-do-cc',
        entityType: 'f',
        entityId: '42',
        agent: 'cc',
        role: 'do',
        repoPath: tmp,
        worktreePath: tmp,
        createdAt: '2026-04-28T00:00:00.000Z',
        // no agentSessionId / agentSessionPath
    }));
    const records = collectTranscriptRecords(tmp, 'feature', '42', null);
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].captured, false);
    assert.ok(records[0].reason.includes('pre-F357'));
}));

test('collectTranscriptRecords returns captured record with telemetry join', () => withTempDir('aigon-tr-', (tmp) => {
    const sessionsDir = path.join(tmp, '.aigon', 'sessions');
    const telemetryDir = path.join(tmp, '.aigon', 'telemetry');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.mkdirSync(telemetryDir, { recursive: true });

    fs.writeFileSync(path.join(sessionsDir, 'aigon-f42-do-cc.json'), JSON.stringify({
        sessionName: 'aigon-f42-do-cc',
        entityType: 'f',
        entityId: '42',
        agent: 'cc',
        role: 'do',
        repoPath: tmp,
        worktreePath: tmp,
        createdAt: '2026-04-28T00:00:00.000Z',
        agentSessionId: 'uuid-123',
        agentSessionPath: '/home/user/.claude/projects/foo/uuid-123.jsonl',
    }));

    fs.writeFileSync(path.join(telemetryDir, 'feature-42-cc-uuid-123.json'), JSON.stringify({
        schemaVersion: 1,
        source: 'test',
        sessionId: 'uuid-123',
        entityType: 'feature',
        featureId: '42',
        repoPath: tmp,
        agent: 'cc',
        activity: 'implement',
        model: 'claude-sonnet-4-6',
        startAt: '2026-04-28T00:00:00Z',
        endAt: '2026-04-28T01:00:00Z',
        turnCount: 5,
        toolCalls: 3,
        tokenUsage: { input: 1000, output: 500, cacheReadInput: 0, cacheCreationInput: 0, thinking: 0, total: 1500, billable: 1500 },
        costUsd: 0.012,
    }));

    const records = collectTranscriptRecords(tmp, 'feature', '42', null);
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].captured, true);
    assert.strictEqual(records[0].agentSessionId, 'uuid-123');
    assert.strictEqual(records[0].telemetry.model, 'claude-sonnet-4-6');
    assert.strictEqual(records[0].telemetry.turnCount, 5);
    assert.strictEqual(records[0].telemetry.costUsd, 0.012);
}));

test('collectTranscriptRecords filters by agentId', () => withTempDir('aigon-tr-', (tmp) => {
    const sessionsDir = path.join(tmp, '.aigon', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });

    fs.writeFileSync(path.join(sessionsDir, 'aigon-f42-do-cc.json'), JSON.stringify({
        sessionName: 'aigon-f42-do-cc',
        entityType: 'f',
        entityId: '42',
        agent: 'cc',
        role: 'do',
        repoPath: tmp,
        worktreePath: tmp,
        createdAt: '2026-04-28T00:00:00.000Z',
        agentSessionId: 'uuid-123',
        agentSessionPath: '/path/to/cc.jsonl',
    }));

    fs.writeFileSync(path.join(sessionsDir, 'aigon-f42-do-gg.json'), JSON.stringify({
        sessionName: 'aigon-f42-do-gg',
        entityType: 'f',
        entityId: '42',
        agent: 'gg',
        role: 'do',
        repoPath: tmp,
        worktreePath: tmp,
        createdAt: '2026-04-28T00:00:00.000Z',
        agentSessionId: 'gem-456',
        agentSessionPath: '/path/to/gg.json',
    }));

    const records = collectTranscriptRecords(tmp, 'feature', '42', 'cc');
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].agent, 'cc');
}));

test('formatTranscriptCliOutput includes captured and not-captured rows', () => {
    const records = [
        { captured: true, agentName: 'Claude Code', agentSessionPath: '/path/cc.jsonl', telemetry: { model: 'sonnet', turnCount: 3, costUsd: 0.01 } },
        { captured: false, agentName: 'Cursor', reason: 'Transcript capture is not supported for cu.' },
    ];
    const out = formatTranscriptCliOutput(records, 'feature', '42');
    assert.ok(out.includes('Claude Code'));
    assert.ok(out.includes('/path/cc.jsonl'));
    assert.ok(out.includes('Cursor'));
    assert.ok(out.includes('not supported'));
});

test('openTranscriptPath returns ok with platform command', () => {
    // REGRESSION: EDITOR with spaces (e.g. "code -w") is not parsed by openTranscriptPath — clear for deterministic spawn.
    const prev = process.env.EDITOR;
    delete process.env.EDITOR;
    try {
        const result = openTranscriptPath('/tmp/fake-transcript.jsonl');
        assert.strictEqual(result.ok, true);
        assert.ok(result.openedWith);
    } finally {
        if (prev === undefined) delete process.env.EDITOR;
        else process.env.EDITOR = prev;
    }
});

test('resolveTranscriptDownload returns path from read-model only', () => withTempDir('aigon-tr-', (tmp) => {
    // REGRESSION: dashboard download must resolve only via collectTranscriptRecords, never trust client paths.
    const transcriptFile = path.join(tmp, 'sess.jsonl');
    fs.writeFileSync(transcriptFile, '{"msg":"x"}\n');
    const sessionsDir = path.join(tmp, '.aigon', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, 'aigon-f42-do-cc.json'), JSON.stringify({
        sessionName: 'aigon-f42-do-cc',
        entityType: 'f',
        entityId: '42',
        agent: 'cc',
        role: 'do',
        repoPath: tmp,
        worktreePath: tmp,
        createdAt: '2026-04-28T00:00:00.000Z',
        agentSessionId: 'uuid-abc',
        agentSessionPath: transcriptFile,
    }));
    const r = resolveTranscriptDownload(tmp, 'feature', '42', { agent: 'cc', sessionId: 'uuid-abc' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.absPath, transcriptFile);
    assert.strictEqual(r.downloadBaseName, 'sess.jsonl');
}));

test('resolveTranscriptDownload 404 when sessionId mismatch', () => withTempDir('aigon-tr-', (tmp) => {
    const transcriptFile = path.join(tmp, 'sess.jsonl');
    fs.writeFileSync(transcriptFile, 'x');
    const sessionsDir = path.join(tmp, '.aigon', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, 'aigon-f42-do-cc.json'), JSON.stringify({
        sessionName: 'aigon-f42-do-cc',
        entityType: 'f',
        entityId: '42',
        agent: 'cc',
        role: 'do',
        repoPath: tmp,
        worktreePath: tmp,
        createdAt: '2026-04-28T00:00:00.000Z',
        agentSessionId: 'uuid-abc',
        agentSessionPath: transcriptFile,
    }));
    const r = resolveTranscriptDownload(tmp, 'feature', '42', { agent: 'cc', sessionId: 'wrong-id' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.status, 404);
}));

report();
