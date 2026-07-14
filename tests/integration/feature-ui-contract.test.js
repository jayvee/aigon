'use strict';

const assert = require('assert');
const { snapshotToDashboardActions } = require('../../lib/workflow-snapshot-adapter');
const { buildFeatureUiContract } = require('../../lib/feature-ui-contract');

let passed = 0;
function test(name, fn) {
    try {
        fn();
        passed += 1;
        console.log(`  ✓ ${name}`);
    } catch (error) {
        console.error(`  ✗ ${name}`);
        throw error;
    }
}

function contractFor(context) {
    const stage = context.currentSpecState === 'evaluating' ? 'in-evaluation'
        : context.currentSpecState === 'done' ? 'done'
            : 'in-progress';
    const validActions = snapshotToDashboardActions('feature', '675', context, stage).validActions;
    return buildFeatureUiContract({
        id: '675',
        displayKey: 'F675',
        name: 'contract',
        stage,
        agents: Object.entries(context.agents).map(([id, agent]) => ({ id, ...agent })),
        validActions,
        cardHeadline: { text: 'State' },
        cardPresentation: { severity: 'normal' },
    }, context);
}

test('ready solo exposes Close primary, optional review, and non-primary tools', () => {
    const contract = contractFor({
        entityType: 'feature', featureId: '675', currentSpecState: 'implementing', lifecycle: 'implementing',
        mode: 'solo_worktree', agents: { cx: { status: 'ready' } }, tmuxSessionStates: { cx: 'running' },
        updatedAt: '2026-07-14T00:00:00.000Z',
    });
    assert.strictEqual(contract.decisions.primaryActionId, 'feature-close');
    assert(contract.decisions.actions.some(action => action.actionId === 'feature-code-review'));
    ['open-session', 'feature-push', 'feature-nudge', 'feature-reset'].forEach(actionId => {
        assert(contract.tools.some(action => action.actionId === actionId), `missing ${actionId}`);
    });
    assert(!JSON.stringify(contract).includes('Not assigned'));
});

test('ready fleet exposes Evaluate without solo close or review', () => {
    const contract = contractFor({
        entityType: 'feature', featureId: '675', currentSpecState: 'implementing', lifecycle: 'implementing',
        mode: 'fleet', agents: { cc: { status: 'ready' }, cx: { status: 'ready' } }, tmuxSessionStates: {},
        updatedAt: '2026-07-14T00:00:00.000Z',
    });
    assert.strictEqual(contract.decisions.primaryActionId, 'feature-eval');
    assert(!contract.decisions.actions.some(action => action.actionId === 'feature-close'));
    assert(!contract.decisions.actions.some(action => action.actionId === 'feature-code-review'));
});

test('done exposes no lifecycle or session mutation actions', () => {
    const contract = contractFor({
        entityType: 'feature', featureId: '675', currentSpecState: 'done', lifecycle: 'done',
        mode: 'solo_worktree', agents: { cx: { status: 'ready' } }, tmuxSessionStates: { cx: 'running' },
        updatedAt: '2026-07-14T00:00:00.000Z',
    });
    assert.strictEqual(contract.decisions.primaryActionId, null);
    assert.deepStrictEqual(contract.decisions.actions, []);
    assert.deepStrictEqual(contract.tools, []);
});

test('session Peek remains a nested affordance instead of a new card action', () => {
    const contract = buildFeatureUiContract({
        id: '675',
        displayKey: 'F675',
        name: 'contract',
        stage: 'in-progress',
        agents: [],
        sessions: [{ sessionName: 'feature-675-cx', status: 'running' }],
        validActions: [],
        cardPresentation: { severity: 'normal' },
    }, { currentSpecState: 'implementing', lifecycle: 'implementing' });
    assert.strictEqual(contract.sessions[0].affordances[0].actionId, 'peek-session');
    assert(!contract.tools.some(action => action.actionId === 'peek-session'));
});

console.log(`\n${passed} passed, 0 failed`);
