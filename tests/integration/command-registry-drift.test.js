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

test('shared factory emits the spec-review quartet for both entities', () => {
    const all = require('../../lib/commands/shared').createAllCommands();
    ['feature', 'research'].forEach(type => {
        ['spec-review', 'spec-review-check', 'spec-review-record', 'spec-review-check-record'].forEach(suffix => {
            const name = `${type}-${suffix}`;
            assert.strictEqual(typeof all[name], 'function', `missing ${name}`);
        });
    });
});

report();
