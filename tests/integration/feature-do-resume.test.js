#!/usr/bin/env node
// F357: resume code path reads agentSessionId from sidecar and builds per-agent resume args.
// Covers: readLatestSidecarWithSession (found/not-found/most-recent/agent-filter),
//         resolveResumeArgs (cc/cx/gg flags, unsupported agents return null).
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { test, report } = require('../_helpers');
const { readLatestSidecarWithSession, resolveResumeArgs } = require('../../lib/session-sidecar');

const mkp = (p) => fs.mkdirSync(p, { recursive: true });

function writeSidecar(repo, name, entityId, agentId, extras = {}) {
    const d = path.join(repo, '.aigon', 'sessions');
    mkp(d);
    fs.writeFileSync(path.join(d, `${name}.json`), JSON.stringify(Object.assign({
        category: 'entity', sessionName: name, repoPath: repo, worktreePath: repo,
        createdAt: '2026-04-25T10:00:00.000Z', agent: agentId, entityType: 'f', entityId, role: 'do',
    }, extras)));
}

test('readLatestSidecarWithSession: returns sidecar when agentSessionId is present', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-res-'));
    try {
        const uuid = 'resume-uuid-1111-2222-3333-444455556666';
        writeSidecar(repo, 'aigon-f07-cc-impl', '7', 'cc', { agentSessionId: uuid, agentSessionPath: `/fake/${uuid}.jsonl` });
        const s = readLatestSidecarWithSession(repo, 'f', '7', 'cc');
        assert.ok(s, 'should find sidecar');
        assert.strictEqual(s.agentSessionId, uuid);
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});

test('readLatestSidecarWithSession: returns null when sidecar has no agentSessionId', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-res-noid-'));
    try {
        writeSidecar(repo, 'aigon-f08-cc-old', '8', 'cc');
        assert.strictEqual(readLatestSidecarWithSession(repo, 'f', '8', 'cc'), null, 'missing agentSessionId → null');
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});

test('readLatestSidecarWithSession: most-recent sidecar wins when multiple exist', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-res-multi-'));
    try {
        writeSidecar(repo, 'aigon-f09-cc-old', '9', 'cc', { createdAt: '2026-04-24T08:00:00.000Z', agentSessionId: 'old-uuid' });
        writeSidecar(repo, 'aigon-f09-cc-new', '9', 'cc', { createdAt: '2026-04-25T10:00:00.000Z', agentSessionId: 'new-uuid' });
        const s = readLatestSidecarWithSession(repo, 'f', '9', 'cc');
        assert.strictEqual(s.agentSessionId, 'new-uuid', 'should pick most recent');
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});

test('readLatestSidecarWithSession: agent filter — gg sidecar not returned for cc query', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-res-agent-'));
    try {
        writeSidecar(repo, 'aigon-f10-gg-impl', '10', 'gg', { agentSessionId: 'gemini-id' });
        assert.strictEqual(readLatestSidecarWithSession(repo, 'f', '10', 'cc'), null, 'cc query must not return gg sidecar');
        assert.ok(readLatestSidecarWithSession(repo, 'f', '10', 'gg'), 'gg query should find the sidecar');
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});

test('resolveResumeArgs: cc and gg use --resume flag (appendArgs)', () => {
    const cc = resolveResumeArgs('cc', 'test-uuid');
    assert.deepStrictEqual(cc.appendArgs, ['--resume', 'test-uuid']);
    assert.strictEqual(cc.isSubcommand, false);
    const gg = resolveResumeArgs('gg', 'gg-id');
    assert.deepStrictEqual(gg.appendArgs, ['--resume', 'gg-id']);
});

test('resolveResumeArgs: cx uses resume subcommand (prependArgs)', () => {
    const r = resolveResumeArgs('cx', 'cx-id');
    assert.deepStrictEqual(r.prependArgs, ['resume', 'cx-id']);
    assert.strictEqual(r.isSubcommand, true);
});

test('resolveResumeArgs: unsupported agent or null inputs return null', () => {
    assert.strictEqual(resolveResumeArgs('cu', 'x'), null, 'cu: unsupported → null');
    assert.strictEqual(resolveResumeArgs(null, 'x'), null, 'null agent → null');
    assert.strictEqual(resolveResumeArgs('cc', null), null, 'null sessionId → null');
});

report();
