#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { test, report } = require('../_helpers');
const { computeCardHeadline } = require('../../lib/card-headline');
const { buildCardPresentation } = require('../../lib/card-presentation');

const NOW = Date.parse('2026-07-09T00:00:00Z');
const isoMinusSec = sec => new Date(NOW - sec * 1000).toISOString();

function present(entity, snap, agents, plan, lane, entityType) {
    const row = {
        ...entity,
        agents: agents || [],
        reviewSessionSummary: entity.reviewSessionSummary || entity.reviewSessions || [],
        reviewCycles: entity.reviewCycles || [],
        autonomousPlan: plan || entity.autonomousPlan || null,
        autonomousController: entity.autonomousController || null,
        cardHeadline: computeCardHeadline(entity, snap, agents || [], plan || null, lane, {
            entityType: entityType || 'feature',
            now: NOW,
        }),
    };
    row.cardPresentation = buildCardPresentation(row, { entityType: entityType || 'feature' });
    return row;
}

test('close failure suppresses duplicate panels and builds timeline', () => {
    const row = present(
        {
            lastCloseFailure: { kind: 'test-failed', reason: 'npm test failed', at: isoMinusSec(3600) },
            reviewSessions: [{ agent: 'cc', running: false, requestRevision: false }],
            agents: [
                { id: 'cu', status: 'ready' },
                { id: 'cc', status: 'review-complete' },
            ],
        },
        { currentSpecState: 'ready' },
        [
            { id: 'cu', status: 'ready' },
            { id: 'cc', status: 'review-complete' },
        ],
        null,
        'in-progress'
    );
    assert.strictEqual(row.cardHeadline.verb, 'Close failed');
    assert.strictEqual(row.cardPresentation.severity, 'error');
    assert.strictEqual(row.cardPresentation.suppress.closeFailurePanel, true);
    assert.strictEqual(row.cardPresentation.suppress.readyToClose, true);
    assert.strictEqual(row.cardPresentation.suppress.reviewerPanels, true);
    assert.ok(row.cardPresentation.contextLine.includes('review approval'));
    assert.ok(row.cardPresentation.timeline.some(t => t.label === 'Close failed' && t.status === 'failed'));
    assert.ok(row.cardPresentation.showRecoveryActions);
});

test('autonomous failure stays dominant when no close failure', () => {
    const row = present(
        {
            autonomousController: {
                status: 'failed',
                reasonLabel: 'Reviewer exited without signaling',
                updatedAt: isoMinusSec(120),
                sessionName: 'mock-auto',
                sessionRunning: false,
            },
        },
        { currentSpecState: 'code_review_in_progress' },
        [],
        { stages: [{ type: 'review', status: 'failed', agents: [{ id: 'gg' }] }] },
        'in-progress'
    );
    assert.strictEqual(row.cardHeadline.verb, 'Autonomous failed');
    assert.strictEqual(row.cardPresentation.suppress.autonomousController, true);
});

test('merge conflict close failure surfaces files in headline context', () => {
    const row = present(
        {
            lastCloseFailure: {
                kind: 'merge-conflict',
                conflictFiles: ['lib/commands/setup.js'],
                at: isoMinusSec(60),
            },
        },
        { currentSpecState: 'ready' },
        [],
        null,
        'in-progress'
    );
    assert.ok(row.cardPresentation.contextLine.includes('lib/commands/setup.js'));
    assert.strictEqual(row.cardPresentation.suppress.closeFailurePanel, true);
});

test('running implement state keeps reviewer panels visible', () => {
    const row = present(
        {},
        { currentSpecState: 'implementing' },
        [{ id: 'cu', status: 'implementing', isWorking: true, statusChangedAt: isoMinusSec(30) }],
        null,
        'in-progress'
    );
    assert.strictEqual(row.cardPresentation.severity, 'running');
    assert.strictEqual(row.cardPresentation.suppress.reviewerPanels, false);
    assert.strictEqual(row.cardPresentation.compactAgents, false);
});

report();
