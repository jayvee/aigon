#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, testAsync, withTempDirAsync, report } = require('../_helpers');
const wf = require('../../lib/workflow-core');
const { handleDashboardMarkComplete } = require('../../lib/dashboard-actions/mark-complete');
const {
    SESSION_EVENT_TYPES,
    createAgentSessionStore,
    dispatchSessionSignal,
    mapSessionSignalToWorkflowActions,
} = require('../../lib/agent-sessions');

function ensureFeatureSnapshot(repo, id = '01') {
    const dir = path.join(repo, '.aigon', 'workflows', 'features', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'snapshot.json'), JSON.stringify({ currentSpecState: 'implementing' }));
}

function makeDeps(repo, calls) {
    return {
        repoPath: repo,
        sessionStore: createAgentSessionStore({ repoPath: repo }),
        workflow: {
            emitSignal: async (_repo, entityId, signal, agentId, options) => {
                calls.push({ type: 'emitSignal', entityId, signal, agentId, options });
            },
            recordCodeReviewStarted: async (_repo, entityType, entityId, payload) => {
                calls.push({ type: 'recordCodeReviewStarted', entityType, entityId, payload });
            },
            recordCodeReviewCompleted: async (_repo, entityType, entityId, payload) => {
                calls.push({ type: 'recordCodeReviewCompleted', entityType, entityId, payload });
            },
            recordCodeRevisionCompleted: async (_repo, entityType, entityId, payload) => {
                calls.push({ type: 'recordCodeRevisionCompleted', entityType, entityId, payload });
            },
            recordSpecReviewCompleted: async (_repo, entityType, entityId, payload) => {
                calls.push({ type: 'recordSpecReviewCompleted', entityType, entityId, payload });
            },
            recordSpecRevisionCompleted: async (_repo, entityType, entityId, payload) => {
                calls.push({ type: 'recordSpecRevisionCompleted', entityType, entityId, payload });
            },
        },
        agentStatus: {
            writeAgentStatusAt: () => {},
            writeAwaitingInput: () => {},
        },
        now: () => new Date('2026-06-17T00:00:00.000Z'),
    };
}

test('bridge maps legacy agent-status statuses to workflow actions', () => {
    const cases = [
        ['implementing', []],
        ['reviewing', ['workflow.recordCodeReviewStarted']],
        ['review-complete', ['workflow.recordCodeReviewCompleted'], { verdict: 'approve' }],
        ['revision-complete', ['workflow.recordCodeRevisionCompleted', 'workflow.emitSignal']],
        ['implementation-complete', ['workflow.emitSignal']],
        ['research-complete', ['workflow.emitSignal'], {}, 'research'],
        ['spec-review-complete', ['workflow.recordSpecReviewCompleted'], { taskType: 'spec-review' }],
        ['spec-review-complete', ['workflow.recordSpecRevisionCompleted'], { taskType: 'spec-revise' }],
        ['waiting', ['workflow.emitSignal']],
        ['error', ['workflow.emitSignal']],
    ];
    for (const [status, expected, payload = {}, entityType = 'feature'] of cases) {
        const actions = mapSessionSignalToWorkflowActions({
            eventType: status === 'error' ? SESSION_EVENT_TYPES.TASK_FAILED : SESSION_EVENT_TYPES.STATUS_REPORTED,
            entity: { type: entityType, id: '01' },
            agent: { id: 'cx' },
            role: payload.taskType || 'do',
            status,
            source: `test/${status}`,
            payload,
        });
        assert.deepStrictEqual(actions.map((action) => action.type), expected, status);
    }
});

test('review-complete requires an explicit approve or request-revision verdict', () => {
    assert.throws(() => mapSessionSignalToWorkflowActions({
        eventType: SESSION_EVENT_TYPES.TASK_COMPLETED,
        entity: { type: 'feature', id: '01' },
        agent: { id: 'cx' },
        role: 'review',
        status: 'review-complete',
        payload: {},
    }), /requires --approve or --request-revision/);
});

testAsync('session events are persisted before workflow dispatch and duplicate completions are idempotent', () => withTempDirAsync('aigon-f555-bridge-', async (repo) => {
    ensureFeatureSnapshot(repo, '01');
    const calls = [];
    const deps = makeDeps(repo, calls);
    await dispatchSessionSignal({
        entityType: 'feature',
        entityId: '01',
        agentId: 'cx',
        sessionId: 'session-01',
        status: 'implementation-complete',
        source: 'test',
        payload: { taskType: 'do' },
    }, deps);
    await dispatchSessionSignal({
        entityType: 'feature',
        entityId: '01',
        agentId: 'cx',
        sessionId: 'session-01',
        status: 'implementation-complete',
        source: 'test',
        payload: { taskType: 'do' },
    }, deps);
    assert.strictEqual(calls.length, 1, 'duplicate completion only dispatches workflow once');
    const eventsPath = path.join(repo, '.aigon', 'sessions', 'events.jsonl');
    const events = fs.readFileSync(eventsPath, 'utf8').trim().split('\n').map(JSON.parse);
    assert.strictEqual(events.length, 2, 'both session facts remain append-only');
    assert.strictEqual(events[0].eventType, 'agent_session.task_completed');
    assert.strictEqual(events[0].status, 'implementation-complete');
}));

testAsync('session start permits no snapshot but implementing status rejects it', () => withTempDirAsync('aigon-f555-started-', async (repo) => {
    const calls = [];
    await dispatchSessionSignal({
        entityType: 'feature',
        entityId: '01',
        agentId: 'cx',
        sessionId: 'session-01',
        eventType: 'agent_session.started',
        source: 'test',
    }, makeDeps(repo, calls));
    assert.deepStrictEqual(calls, []);
    await assert.rejects(() => dispatchSessionSignal({
        entityType: 'feature', entityId: '01', agentId: 'cx', status: 'implementing',
    }, makeDeps(repo, calls)), /workflow state is not initialized/);
}));

testAsync('integration: session task completion matches old implementation-complete ready state', () => withTempDirAsync('aigon-f555-integration-', async (repo) => {
    fs.mkdirSync(path.join(repo, 'docs', 'specs', 'features', '03-in-progress'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'docs', 'specs', 'features', '03-in-progress', 'feature-01-test.md'), '# Feature: test\n');
    await wf.startFeature(repo, '01', 'solo_worktree', ['cx']);
    await dispatchSessionSignal({
        entityType: 'feature',
        entityId: '01',
        agentId: 'cx',
        sessionId: 'session-01',
        status: 'implementation-complete',
        source: 'test/integration',
        payload: { taskType: 'do' },
    }, {
        repoPath: repo,
        sessionStore: createAgentSessionStore({ repoPath: repo }),
        agentStatus: {
            writeAgentStatusAt: () => {},
            writeAwaitingInput: () => {},
        },
    });
    const snapshot = JSON.parse(fs.readFileSync(path.join(repo, '.aigon', 'workflows', 'features', '01', 'snapshot.json'), 'utf8'));
    assert.strictEqual(snapshot.agents.cx.status, 'ready');
}));

testAsync('dashboard mark-complete uses the same session-signal bridge path', () => withTempDirAsync('aigon-f555-dashboard-', async (repo) => {
    fs.mkdirSync(path.join(repo, 'docs', 'specs', 'features', '03-in-progress'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'docs', 'specs', 'features', '03-in-progress', 'feature-01-test.md'), '# Feature: test\n');
    await wf.startFeature(repo, '01', 'solo_worktree', ['cx']);
    const result = await handleDashboardMarkComplete({
        repoPath: repo,
        entityType: 'feature',
        entityId: '01',
        agentId: 'cx',
        signal: 'implementation-complete',
    });
    assert.strictEqual(result.ok, true);
    const eventsPath = path.join(repo, '.aigon', 'sessions', 'events.jsonl');
    const event = JSON.parse(fs.readFileSync(eventsPath, 'utf8').trim().split('\n')[0]);
    assert.strictEqual(event.eventType, 'agent_session.task_completed');
    assert.strictEqual(event.source, 'dashboard/mark-complete');
    const snapshot = JSON.parse(fs.readFileSync(path.join(repo, '.aigon', 'workflows', 'features', '01', 'snapshot.json'), 'utf8'));
    assert.strictEqual(snapshot.agents.cx.status, 'ready');
}));

report();
