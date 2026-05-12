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

function writeSidecar(tmp, agent, overrides = {}) {
    const sessionsDir = path.join(tmp, '.aigon', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    const name = `aigon-f42-do-${agent}`;
    fs.writeFileSync(path.join(sessionsDir, `${name}.json`), JSON.stringify({
        sessionName: name, entityType: 'f', entityId: '42', agent, role: 'do',
        repoPath: tmp, worktreePath: tmp, createdAt: '2026-04-28T00:00:00.000Z',
        ...overrides,
    }));
}

test('collectTranscriptRecords: empty when no sessions, not-captured for unsupported agents and pre-F357 sessions', () => withTempDir('aigon-tr-', (tmp) => {
    assert.deepStrictEqual(collectTranscriptRecords(tmp, 'feature', '42', null), []);

    writeSidecar(tmp, 'cu');                       // no session strategy
    writeSidecar(tmp, 'cc');                       // pre-F357: no agentSessionId
    const records = collectTranscriptRecords(tmp, 'feature', '42', null);
    const byAgent = Object.fromEntries(records.map(r => [r.agent, r]));
    assert.strictEqual(byAgent.cu.captured, false);
    assert.ok(byAgent.cu.reason.includes('not supported'));
    assert.strictEqual(byAgent.cc.captured, false);
    assert.ok(byAgent.cc.reason.includes('pre-F357'));
}));

test('collectTranscriptRecords: captured record joins telemetry by sessionId', () => withTempDir('aigon-tr-', (tmp) => {
    writeSidecar(tmp, 'cc', { agentSessionId: 'uuid-123', agentSessionPath: '/home/user/cc.jsonl' });
    fs.mkdirSync(path.join(tmp, '.aigon', 'telemetry'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.aigon', 'telemetry', 'feature-42-cc-uuid-123.json'), JSON.stringify({
        schemaVersion: 1, source: 'test', sessionId: 'uuid-123',
        entityType: 'feature', featureId: '42', repoPath: tmp, agent: 'cc',
        activity: 'implement', model: 'claude-sonnet-4-6',
        startAt: '2026-04-28T00:00:00Z', endAt: '2026-04-28T01:00:00Z',
        turnCount: 5, toolCalls: 3,
        tokenUsage: { input: 1000, output: 500, cacheReadInput: 0, cacheCreationInput: 0, thinking: 0, total: 1500, billable: 1500 },
        costUsd: 0.012,
    }));
    const [r] = collectTranscriptRecords(tmp, 'feature', '42', null);
    assert.strictEqual(r.captured, true);
    assert.strictEqual(r.agentSessionId, 'uuid-123');
    assert.strictEqual(r.telemetry.model, 'claude-sonnet-4-6');
    assert.strictEqual(r.telemetry.turnCount, 5);
    assert.strictEqual(r.telemetry.costUsd, 0.012);
}));

test('collectTranscriptRecords filters by agentId', () => withTempDir('aigon-tr-', (tmp) => {
    writeSidecar(tmp, 'cc', { agentSessionId: 'u1', agentSessionPath: '/p/cc.jsonl' });
    writeSidecar(tmp, 'gg', { agentSessionId: 'u2', agentSessionPath: '/p/gg.json' });
    const records = collectTranscriptRecords(tmp, 'feature', '42', 'cc');
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].agent, 'cc');
}));

test('formatTranscriptCliOutput includes captured and not-captured rows', () => {
    const out = formatTranscriptCliOutput([
        { captured: true, agentName: 'Claude Code', agentSessionPath: '/path/cc.jsonl', telemetry: { model: 'sonnet', turnCount: 3, costUsd: 0.01 } },
        { captured: false, agentName: 'Cursor', reason: 'Transcript capture is not supported for cu.' },
    ], 'feature', '42');
    assert.ok(out.includes('Claude Code') && out.includes('/path/cc.jsonl'));
    assert.ok(out.includes('Cursor') && out.includes('not supported'));
});

test('openTranscriptPath returns ok with platform command (EDITOR-with-spaces ignored)', () => {
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

test('resolveTranscriptDownload: resolves via read-model, 404 on sessionId mismatch', () => withTempDir('aigon-tr-', (tmp) => {
    const transcriptFile = path.join(tmp, 'sess.jsonl');
    fs.writeFileSync(transcriptFile, '{"msg":"x"}\n');
    writeSidecar(tmp, 'cc', { agentSessionId: 'uuid-abc', agentSessionPath: transcriptFile });

    const ok = resolveTranscriptDownload(tmp, 'feature', '42', { agent: 'cc', sessionId: 'uuid-abc' });
    assert.strictEqual(ok.ok, true);
    assert.strictEqual(ok.absPath, transcriptFile);
    assert.strictEqual(ok.downloadBaseName, 'sess.jsonl');

    const bad = resolveTranscriptDownload(tmp, 'feature', '42', { agent: 'cc', sessionId: 'wrong-id' });
    assert.strictEqual(bad.ok, false);
    assert.strictEqual(bad.status, 404);
}));

report();
