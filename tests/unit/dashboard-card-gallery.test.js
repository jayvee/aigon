#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { test, report } = require('../_helpers');
const { buildDashboardCardGallery } = require('../../lib/dashboard-card-gallery');
const { ENTITY_UI_CONTRACT_VERSION } = require('../../lib/entity-ui-contract');

const gallery = buildDashboardCardGallery();

function scenario(key) {
    const match = gallery.scenarios.find(item => item.key === key);
    assert(match, `missing scenario ${key}`);
    return match;
}

function actionIds(item) {
    return item.contract.decisions.actions.concat(item.contract.tools).map(action => action.actionId);
}

test('covers every resting feature and research state', () => {
    assert.deepStrictEqual(
        gallery.coverage.feature.coveredStates.slice().sort(),
        gallery.coverage.feature.restingStates.slice().sort(),
    );
    assert.deepStrictEqual(
        gallery.coverage.research.coveredStates.slice().sort(),
        gallery.coverage.research.restingStates.slice().sort(),
    );
});

test('all entity scenarios consume the completed versioned contract', () => {
    gallery.scenarios.forEach(item => {
        assert.strictEqual(item.contract.contractVersion, ENTITY_UI_CONTRACT_VERSION, item.key);
    });
});

test('completed solo feature makes Close primary and keeps review available', () => {
    const item = scenario('feature-implementing-ready-solo');
    assert.strictEqual(item.contract.decisions.primaryActionId, 'feature-close');
    assert(actionIds(item).includes('feature-code-review'));
    assert(!JSON.stringify(item.contract).includes('Not assigned'));
});

test('completed Fleet feature offers evaluation without solo close or review', () => {
    const item = scenario('feature-implementing-ready-fleet');
    assert.strictEqual(item.contract.decisions.primaryActionId, 'feature-eval');
    assert(!actionIds(item).includes('feature-close'));
    assert(!actionIds(item).includes('feature-code-review'));
});

test('Fleet in-progress scenarios show two active agents with peekable sessions', () => {
    for (const key of ['feature-fleet-in-progress', 'research-fleet-in-progress']) {
        const item = scenario(key);
        assert.strictEqual(item.mode, 'fleet');
        assert.deepStrictEqual(item.contract.agents.map(agent => agent.status), ['running', 'running']);
        assert.strictEqual(item.contract.sessions.filter(session => session.running).length, 2);
    }
});

test('active review and revision work carries a live session for Peek', () => {
    for (const item of gallery.scenarios.filter(candidate => ['spec_review_in_progress', 'spec_revision_in_progress', 'code_review_in_progress', 'code_revision_in_progress', 'evaluating'].includes(candidate.state))) {
        if (['feature-review-session-lost', 'feature-autonomous-review-failed'].includes(item.key)) continue;
        assert(item.contract.sessions.some(session => session.running), item.key);
    }
});

test('quota-paused scenarios do not present both agents as ready', () => {
    for (const key of ['feature-quota-paused', 'research-quota-paused']) {
        const statuses = scenario(key).contract.agents.map(agent => agent.status);
        assert(statuses.includes('quota-paused'), key);
        assert(statuses.includes('running'), key);
        assert(!statuses.every(status => status === 'ready'), key);
    }
});

test('evaluation-only states are Fleet scenarios with parallel agents', () => {
    const evaluationStates = gallery.scenarios.filter(item => item.entityType !== 'set' && ['evaluating', 'ready_for_review'].includes(item.state));
    evaluationStates.forEach(item => {
        assert.strictEqual(item.mode, 'fleet', item.key);
        assert(item.contract.agents.length >= 2, item.key);
    });
});

test('completed research exposes close with optional findings review', () => {
    const item = scenario('research-findings-ready-solo');
    assert(actionIds(item).includes('research-close'));
    assert(actionIds(item).includes('research-review'));
});

test('automatic states are documented but never rendered as card scenarios', () => {
    for (const coverage of [gallery.coverage.feature, gallery.coverage.research]) {
        const rendered = new Set(gallery.scenarios
            .filter(item => item.entityType === coverage.entityType)
            .map(item => item.state));
        coverage.internalStates.forEach(item => assert(!rendered.has(item.state), item.state));
    }
});

test('feature sets cover every conductor status and derive actions from set workflow rules', () => {
    assert.deepStrictEqual(gallery.coverage.set.coveredStates.slice().sort(), gallery.coverage.set.restingStates.slice().sort());
    assert(scenario('set-running').contract.decisions.actions.some(action => action.actionId === 'set-autonomous-stop'));
    assert(scenario('set-paused-failure').contract.decisions.actions.some(action => action.actionId === 'set-autonomous-resume'));
    assert(scenario('set-complete').setPlan.members.every(member => member.status === 'complete'));
    assert.strictEqual(scenario('set-ready').setPlan.progress.complete, 0);
    assert.strictEqual(scenario('set-paused-quota').setPlan.members.find(member => member.id === '682').status, 'quota-paused');
});

test('set spec review and revision sessions expose Peek', () => {
    for (const key of ['set-spec-review-running', 'set-spec-revision-running']) {
        const item = scenario(key);
        const live = item.contract.sessions.find(session => session.running && session.inspectable);
        assert(live, key);
        assert.strictEqual(live.affordances[0].actionId, 'peek-session', key);
    }
});

test('autonomous run cards show completed, current, and upcoming stages', () => {
    const soloReview = scenario('feature-autonomous-reviewing').autonomousPlan.stages.map(stage => stage.status);
    assert.deepStrictEqual(soloReview, ['complete', 'running', 'waiting', 'waiting']);
    const fleetEval = scenario('feature-autonomous-fleet-evaluating').autonomousPlan.stages.map(stage => stage.status);
    assert.deepStrictEqual(fleetEval, ['complete', 'running', 'waiting']);
});

test('manual and autonomous review failures are distinct scenarios', () => {
    const manual = scenario('feature-review-session-lost');
    assert.strictEqual(manual.autonomousPlan, null);
    assert(!actionIds(manual).includes('autonomous-recover'));
    const autonomous = scenario('feature-autonomous-review-failed');
    assert.strictEqual(autonomous.autonomousPlan.stages.find(stage => stage.type === 'review').status, 'failed');
    assert(actionIds(autonomous).includes('autonomous-recover'));
});

test('scenario copy avoids submission and generic automation terminology', () => {
    const copy = gallery.scenarios.flatMap(item => [item.scenario, item.detail]).filter(Boolean).join(' ');
    assert(!/\bsubmit|\bsubmission/i.test(copy));
    assert(!/\bautomation\b/i.test(copy));
});

test('all operator-visible engine actions have dashboard mappings', () => {
    assert.deepStrictEqual(gallery.coverage.feature.unmappedActionKinds, []);
    assert.deepStrictEqual(gallery.coverage.research.unmappedActionKinds, []);
});

test('feature, research, and set structural contract gaps are closed', () => {
    assert.deepStrictEqual(gallery.contractGaps, []);
});

test('autonomous plans own worker sessions instead of duplicating agent activity', () => {
    const item = scenario('feature-autonomous-reviewing');
    const owned = new Set(item.contract.plan.ownedSessionIds);
    assert(owned.has('feature-feature-autonomous-reviewing-implement'));
    assert(owned.has('feature-feature-autonomous-reviewing-review'));
    assert.strictEqual(item.contract.plan.controllerSessionId, 'feature-feature-autonomous-reviewing-auto');
});

test('completed autonomous stages retain snapshot Peek', () => {
    const item = scenario('feature-autonomous-reviewing');
    const implement = item.contract.plan.stages.find(stage => stage.type === 'implement');
    const session = item.contract.sessions.find(candidate => candidate.sessionId === implement.sessionIds[0]);
    assert(session);
    assert.strictEqual(session.affordances[0].interaction.mode, 'snapshot');
    const failed = scenario('feature-autonomous-review-failed');
    const failedSession = failed.contract.sessions.find(candidate => candidate.status === 'failed');
    assert(failedSession);
    assert.strictEqual(failedSession.affordances[0].interaction.mode, 'snapshot');
});

test('running sets embed the current feature autonomous contract', () => {
    const current = scenario('set-running').contract.plan.currentFeatureContract;
    assert(current);
    assert.strictEqual(current.entity.displayKey, 'F682');
    assert.deepStrictEqual(current.plan.stages.map(stage => stage.type), ['implement', 'review', 'revision', 'close']);
    assert(current.plan.stages.find(stage => stage.type === 'implement').sessionIds.length > 0);
});

test('every defined action is exercised by at least one gallery scenario', () => {
    for (const coverage of Object.values(gallery.coverage)) {
        const unexercised = coverage.actionCatalog.filter(item => !item.exercisedByGallery);
        assert.deepStrictEqual(unexercised, [], `${coverage.entityType}: ${unexercised.map(item => item.actionId).join(', ')}`);
    }
});

test('done cards expose no decisions or tools', () => {
    for (const key of ['feature-done-solo_worktree', 'research-done-solo_worktree']) {
        const item = scenario(key);
        assert.deepStrictEqual(item.contract.decisions.actions, []);
        assert.deepStrictEqual(item.contract.tools, []);
    }
});

report();
