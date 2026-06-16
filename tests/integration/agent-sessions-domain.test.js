#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');
const {
    ERROR_CODES,
    SESSION_CATEGORIES,
    SESSION_EVENT_TYPES,
    SESSION_ROLES,
    SESSION_STATES,
    createAgentSessionService,
    createAgentSessionStore,
    normalizeAgentSessionRecord,
    validateAgentSessionStartRequest,
} = require('../../lib/agent-sessions');

function writeSidecar(repo, name, sidecar) {
    const dir = path.join(repo, '.aigon', 'sessions');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(sidecar, null, 2));
}

test('normalizes live entity sidecars into AgentSession records', () => {
    const record = normalizeAgentSessionRecord({
        category: 'entity',
        sessionName: 'aigon-f553-do-cx',
        repoPath: '/repo',
        worktreePath: '/repo-worktree',
        createdAt: '2026-06-16T00:00:00.000Z',
        agent: 'cx',
        tmuxId: '$12',
        shellPid: 12345,
        entityType: 'f',
        entityId: '553',
        role: 'do',
    }, 'fixture');
    assert.strictEqual(record.sessionId, 'aigon-f553-do-cx');
    assert.deepStrictEqual(record.entity, { type: 'feature', id: '553' });
    assert.strictEqual(record.agent.id, 'cx');
    assert.deepStrictEqual(record.host.handle.tmuxId, '$12');
    assert.deepStrictEqual(record.host.handle.shellPid, 12345);
    assert.strictEqual(record.sessionName, record.sessionId);
});

test('normalizes research entity aliases and repo sidecars', () => {
    const research = normalizeAgentSessionRecord({
        category: 'entity',
        sessionName: 'aigon-r12-review-gg',
        entityType: 'r',
        entityId: '12',
        role: 'review',
        agent: { id: 'gg' },
    }, 'research');
    assert.deepStrictEqual(research.entity, { type: 'research', id: '12' });

    const repo = normalizeAgentSessionRecord({
        category: 'repo',
        sessionName: 'aigon-repo-cx',
        role: 'do',
        agent: 'cx',
    }, 'repo');
    assert.strictEqual(repo.entity, null);
    assert.strictEqual(repo.role, null);
});

test('normalizes transcript binding fields', () => {
    const record = normalizeAgentSessionRecord({
        category: 'entity',
        sessionName: 'aigon-f553-do-cx',
        entityType: 'f',
        entityId: '553',
        role: 'do',
        agent: 'cx',
        agentSessionId: 'codex-session-1',
        agentSessionPath: '/tmp/codex-session-1.jsonl',
    }, 'transcript');
    assert.deepStrictEqual(record.transcriptBinding, {
        provider: 'codex',
        providerSessionId: 'codex-session-1',
        path: '/tmp/codex-session-1.jsonl',
    });
});

test('rejects invalid roles, entity types, timestamps, and missing ids', () => {
    assert.throws(() => normalizeAgentSessionRecord({
        category: 'entity',
        sessionName: 'bad-role',
        entityType: 'f',
        entityId: '1',
        role: 'bogus',
        agent: 'cx',
    }), /Invalid session role/);
    assert.throws(() => normalizeAgentSessionRecord({
        category: 'entity',
        sessionName: 'bad-entity',
        entityType: 'bug',
        entityId: '1',
        role: 'do',
        agent: 'cx',
    }), /Invalid entity type/);
    assert.throws(() => normalizeAgentSessionRecord({
        category: 'entity',
        sessionName: 'bad-time',
        entityType: 'f',
        entityId: '1',
        role: 'do',
        agent: 'cx',
        createdAt: 'not-a-date',
    }), /Malformed timestamp/);
    assert.throws(() => validateAgentSessionStartRequest({
        category: 'entity',
        entityType: 'f',
        entityId: '1',
        role: 'do',
        agent: 'cx',
    }), (err) => err.code === ERROR_CODES.INVALID_REQUEST);
});

test('store reads and writes sidecar-compatible records', () => withTempDir('aigon-agent-sessions-', (repo) => {
    writeSidecar(repo, 'aigon-f553-do-cx', {
        category: 'entity',
        sessionName: 'aigon-f553-do-cx',
        repoPath: repo,
        worktreePath: repo,
        createdAt: '2026-06-16T00:00:00.000Z',
        agent: 'cx',
        tmuxId: '$12',
        shellPid: 12345,
        entityType: 'f',
        entityId: '553',
        role: 'do',
        agentSessionId: 'codex-session-1',
        agentSessionPath: '/tmp/codex-session-1.jsonl',
    });
    const store = createAgentSessionStore({ repoPath: repo });
    const record = store.readSession('aigon-f553-do-cx');
    assert.strictEqual(record.sessionId, 'aigon-f553-do-cx');
    assert.strictEqual(record.entity.type, 'feature');

    const updated = store.writeSession({
        ...record,
        state: SESSION_STATES.WAITING,
    });
    assert.strictEqual(updated.state, SESSION_STATES.WAITING);
    const raw = JSON.parse(fs.readFileSync(path.join(repo, '.aigon', 'sessions', 'aigon-f553-do-cx.json'), 'utf8'));
    assert.strictEqual(raw.sessionName, 'aigon-f553-do-cx');
    assert.strictEqual(raw.entityType, 'f');
    assert.strictEqual(raw.tmuxId, '$12');
    assert.strictEqual(raw.agentSessionId, 'codex-session-1');
}));

test('service starts sessions with a fake host and mutates records', () => withTempDir('aigon-agent-sessions-', (repo) => {
    const host = {
        startSession(request) {
            assert.strictEqual(request.sessionId, 'aigon-f553-do-cx');
            return {
                host: { kind: 'fake', handle: { pid: 101 } },
                state: SESSION_STATES.ACTIVE,
            };
        },
    };
    const service = createAgentSessionService({
        repoPath: repo,
        host,
        now: () => new Date('2026-06-16T00:00:00.000Z'),
    });

    const started = service.startSession({
        sessionId: 'aigon-f553-do-cx',
        category: SESSION_CATEGORIES.ENTITY,
        entity: { type: 'feature', id: '553' },
        role: SESSION_ROLES.DO,
        agent: { id: 'cx', slotAgentId: 'cx' },
    });
    assert.strictEqual(started.state, SESSION_STATES.ACTIVE);
    assert.strictEqual(started.host.kind, 'fake');

    const listed = service.listSessions({ entity: { type: 'feature', id: '553' }, role: SESSION_ROLES.DO, agentId: 'cx' });
    assert.strictEqual(listed.length, 1);
    assert.strictEqual(service.findSession({ entity: { type: 'feature', id: '553' }, role: SESSION_ROLES.DO, agentId: 'cx' }).sessionId, started.sessionId);

    const rebound = service.updateTranscriptBinding(started.sessionId, {
        provider: 'codex',
        providerSessionId: 'codex-session-2',
        path: '/tmp/codex-session-2.jsonl',
    });
    assert.strictEqual(rebound.transcriptBinding.providerSessionId, 'codex-session-2');

    const waiting = service.markSessionState(started.sessionId, SESSION_STATES.WAITING, { metadata: { reason: 'operator-input' } });
    assert.strictEqual(waiting.state, SESSION_STATES.WAITING);
    assert.strictEqual(waiting.metadata.reason, 'operator-input');

    service.recordSessionEvent({
        type: SESSION_EVENT_TYPES.STATE_CHANGED,
        sessionId: started.sessionId,
        payload: { state: SESSION_STATES.WAITING },
    });
    const events = fs.readFileSync(path.join(repo, '.aigon', 'sessions', 'events.jsonl'), 'utf8').trim().split('\n');
    assert.ok(events.length >= 4);
}));

test('service rejects startSession without a host', () => withTempDir('aigon-agent-sessions-', (repo) => {
    const service = createAgentSessionService({ repoPath: repo });
    assert.throws(() => service.startSession({
        sessionId: 'aigon-f553-do-cx',
        category: SESSION_CATEGORIES.ENTITY,
        entity: { type: 'feature', id: '553' },
        role: SESSION_ROLES.DO,
        agent: { id: 'cx' },
    }), (err) => err.code === ERROR_CODES.HOST_UNAVAILABLE);
}));

test('agent-sessions boundary stays acyclic', () => {
    const dir = path.join(__dirname, '../../lib/agent-sessions');
    for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.js'))) {
        const body = fs.readFileSync(path.join(dir, file), 'utf8');
        assert.ok(!body.includes("require('../worktree") && !body.includes("require('../dashboard-server"));
        assert.ok(!body.includes("require('../dashboard-routes") && !body.includes("require('../workflow-core"));
        assert.ok(!body.includes("require('../commands"));
    }
});

report();
