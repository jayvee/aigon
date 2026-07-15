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

// F678 REGRESSION: two PAUSE_FEATURE candidates once shared an inbox/backlog
// guard, so every inbox and backlog card rendered two identical Pause buttons.
// Duplicates must be resolved in the workflow definition, never deduped in the
// browser — so assert on the legacy action source, not just the contract.
['inbox', 'backlog'].forEach((lifecycle) => {
    test(`${lifecycle} offers exactly one Pause from the action source`, () => {
        const validActions = snapshotToDashboardActions('feature', '675', {
            entityType: 'feature', featureId: '675', currentSpecState: lifecycle, lifecycle,
            mode: 'solo_worktree', agents: {}, tmuxSessionStates: {},
            updatedAt: '2026-07-14T00:00:00.000Z',
        }, lifecycle).validActions;
        const pause = validActions.filter(action => action.action === 'feature-pause');
        assert.strictEqual(pause.length, 1, `expected one Pause, got ${pause.length}`);
    });
});

// Parity sweep: every production resting state must project through the
// contract without a duplicate identity. buildFeatureUiContract throws on
// duplicates, so a producer regression fails here rather than in the browser.
test('every resting feature state projects a contract with unique action identities', () => {
    const { FEATURE_INTERACTION_DEFINITION } = require('../../lib/feature-workflow-rules');
    const states = Object.keys(FEATURE_INTERACTION_DEFINITION.stateMeta);
    assert(states.length > 0, 'no resting states discovered');
    states.forEach((lifecycle) => {
        ['solo_worktree', 'fleet'].forEach((mode) => {
            const contract = contractFor({
                entityType: 'feature', featureId: '675', currentSpecState: lifecycle, lifecycle,
                mode, agents: { cx: { status: 'ready' } }, tmuxSessionStates: { cx: 'running' },
                updatedAt: '2026-07-14T00:00:00.000Z',
            });
            const identities = contract.decisions.actions.concat(contract.tools)
                .map(action => `${action.actionId}:${action.agentId || ''}:${action.sessionId || ''}`);
            assert.strictEqual(
                new Set(identities).size,
                identities.length,
                `${lifecycle}/${mode} has duplicate action identities: ${identities.join(', ')}`,
            );
        });
    });
});

// Identity is server-owned: the renderer must never rebuild these.
test('contract identity carries kind, numeric id, machine slug, and set membership', () => {
    const contract = buildFeatureUiContract({
        id: '678',
        displayKey: 'F678',
        name: 'Adopt dashboard interaction contracts',
        specPath: 'docs/specs/features/03-in-progress/feature-678-adopt-dashboard-interaction-contracts.md',
        set: 'dashboard-ui-rollout',
        stage: 'in-progress',
        agents: [],
        validActions: [],
        cardPresentation: { severity: 'normal' },
    }, { currentSpecState: 'implementing', lifecycle: 'implementing' });
    assert.strictEqual(contract.entity.kind, 'feature');
    assert.strictEqual(contract.entity.numericId, 678);
    assert.strictEqual(contract.entity.slug, 'adopt-dashboard-interaction-contracts');
    assert.strictEqual(contract.entity.set.slug, 'dashboard-ui-rollout');
    assert.strictEqual(contract.entity.title, 'Adopt dashboard interaction contracts');
});

// Pre-F667 slug-keyed inbox specs legitimately have no number: null, not NaN.
test('slug-keyed legacy feature yields a null numericId rather than NaN', () => {
    const contract = buildFeatureUiContract({
        id: 'beer-style-filters',
        name: 'Beer style filters',
        stage: 'inbox',
        agents: [],
        validActions: [],
        cardPresentation: { severity: 'normal' },
    }, { currentSpecState: 'inbox', lifecycle: 'inbox' });
    assert.strictEqual(contract.entity.numericId, null);
    assert.strictEqual(contract.entity.id, 'beer-style-filters');
});

console.log(`\n${passed} passed, 0 failed`);
