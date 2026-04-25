'use strict';

// REGRESSION F292: createFeatureCommands / createResearchCommands used
// hardcoded whitelists that drifted silently when new handlers were added
// (2026-04-21 — four *-spec-review-record handlers invisible to the CLI).
// The wrappers now auto-filter the factory output; this test enforces that
// every factory handler is exposed, and that the shared entity-commands
// factory continues to emit the spec-review quartet for both entities.

const assert = require('assert');
const { test, report } = require('../_helpers');

function buildMinimalCtx() {
    return {
        utils: require('../../lib/utils'),
        hooks: require('../../lib/hooks'),
        version: require('../../lib/version'),
        specCrud: require('../../lib/spec-crud'),
        git: require('../../lib/git'),
        board: require('../../lib/board'),
        feedback: require('../../lib/feedback'),
        validation: require('../../lib/validation'),
    };
}

const handlers = cmds => Object.entries(cmds).filter(([, h]) => typeof h === 'function').map(([n]) => n).sort();

function assertWrapperExposesFactory(mod, wrapperFn, label) {
    const factory = handlers(mod(buildMinimalCtx()));
    const exposed = handlers(wrapperFn());
    assert.deepStrictEqual(exposed, factory, `${label} dropped handlers. factory=[${factory}] exposed=[${exposed}]`);
}

test('createResearchCommands exposes every factory handler', () => {
    const m = require('../../lib/commands/research');
    assertWrapperExposesFactory(m, m.createResearchCommands, 'createResearchCommands');
});

test('createFeatureCommands exposes every factory handler', () => {
    const m = require('../../lib/commands/feature');
    assertWrapperExposesFactory(m, m.createFeatureCommands, 'createFeatureCommands');
});

test('shared factory emits the spec-review sextet for both entities', () => {
    const all = require('../../lib/commands/shared').createAllCommands();
    ['feature', 'research'].forEach(type => {
        ['spec-review', 'spec-revise', 'spec-review-record', 'spec-revise-record'].forEach(suffix => {
            const name = `${type}-${suffix}`;
            assert.strictEqual(typeof all[name], 'function', `missing ${name}`);
        });
    });
});

test('canonical code-review and code-revise commands are registered with correct aliases', () => {
    const templates = require('../../lib/templates');
    const all = require('../../lib/commands/shared').createAllCommands();
    assert.ok(Object.hasOwn(templates.COMMAND_REGISTRY, 'feature-code-review'));
    assert.ok(Object.hasOwn(templates.COMMAND_REGISTRY, 'feature-code-revise'));
    assert.strictEqual(templates.COMMAND_ALIASES.afr, 'feature-code-review');
    assert.strictEqual(templates.COMMAND_ALIASES.afrv, 'feature-code-revise');
    assert.strictEqual(typeof all['feature-code-review'], 'function');
    assert.strictEqual(typeof all['feature-code-revise'], 'function');
    assert.strictEqual(typeof all['feature-review'], 'function');
    // Old review-check names must be gone
    assert.strictEqual(typeof all['feature-review-check'], 'undefined');
    assert.strictEqual(typeof all['feature-code-review-check'], 'undefined');
});

report();
