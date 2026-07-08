'use strict';

// REGRESSION: module-graph guard must detect cycles, boundary violations, and ratchet baseline semantics.
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const {
    buildGraph,
    findCycles,
    findViolations,
    canonicalCycle,
    diffBaseline,
    RULES,
} = require('../../scripts/check-module-graph');

function testCanonicalCycleRotation() {
    const c = canonicalCycle(['lib/b.js', 'lib/c.js', 'lib/a.js']);
    if (c !== 'lib/a.js -> lib/b.js -> lib/c.js -> lib/a.js') {
        throw new Error(`canonicalCycle failed: ${c}`);
    }
}

function testFixtureCycleAndViolation() {
    const graph = new Map([
        ['lib/a.js', ['lib/b.js']],
        ['lib/b.js', ['lib/a.js']],
        ['lib/feature-x.js', ['lib/commands/feature.js']],
        ['lib/feature-y.js', ['lib/workflow-core/engine.js']],
    ]);
    const cycles = findCycles(graph);
    if (!cycles.includes('lib/a.js -> lib/b.js -> lib/a.js')) {
        throw new Error(`expected a<->b cycle, got: ${cycles.join(', ')}`);
    }
    const violations = findViolations(graph);
    const hasBarrelViolation = violations.some(v => v.startsWith('workflow-core-barrel:'));
    const hasCommandsViolation = violations.some(v => v.startsWith('commands-one-way:'));
    if (!hasBarrelViolation || !hasCommandsViolation) {
        throw new Error(`expected boundary violations, got: ${violations.join(', ')}`);
    }
}

function testBaselineRatchet() {
    const current = {
        cycles: ['lib/a.js -> lib/b.js -> lib/a.js'],
        violations: ['commands-one-way:lib/x.js->lib/commands/y.js'],
    };
    const baseline = {
        cycles: ['lib/a.js -> lib/b.js -> lib/a.js', 'lib/old.js -> lib/old.js -> lib/old.js'],
        violations: ['commands-one-way:lib/x.js->lib/commands/y.js'],
    };
    const diff = diffBaseline(current, baseline);
    if (diff.newCycles.length !== 0) throw new Error('expected no new cycles');
    if (diff.staleCycles.length !== 1) throw new Error('expected one stale cycle');
    if (diff.newViol.length !== 0) throw new Error('expected no new violations');
    if (diff.staleViol.length !== 0) throw new Error('expected no stale violations');
}

function testRulesTableExists() {
    if (!Array.isArray(RULES) || RULES.length < 4) {
        throw new Error('expected declarative RULES table with boundary rules');
    }
}

function testLoadOrderIsolation() {
    const modules = [
        'config-core',
        'config',
        'instance-identity',
        'proxy-dns',
        'proxy',
        'global-config-migration',
        'agent-registry',
        'profile-placeholders',
    ];
    for (const mod of modules) {
        require(path.join(ROOT, 'lib', mod));
    }
}

function main() {
    testCanonicalCycleRotation();
    testFixtureCycleAndViolation();
    testBaselineRatchet();
    testRulesTableExists();
    testLoadOrderIsolation();
    console.log('module-graph guard tests passed');
}

main();
