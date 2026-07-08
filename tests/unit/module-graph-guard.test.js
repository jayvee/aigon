'use strict';

// REGRESSION: module-graph guard must detect cycles, boundary violations, and ratchet baseline semantics.
const path = require('path');
const fs = require('fs');
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

function testWorktreeTmuxContainment() {
    // REGRESSION: F632 — worktree.js must not spawn tmux; only tmux-exec owns the binary.
    const worktreeSrc = fs.readFileSync(path.join(ROOT, 'lib/worktree.js'), 'utf8');
    if (/spawnSync\(\s*['"]tmux['"]/.test(worktreeSrc) || /execSync\(\s*[`'"]tmux/.test(worktreeSrc)) {
        throw new Error('lib/worktree.js must not invoke tmux directly after F632');
    }
    const execSrc = fs.readFileSync(path.join(ROOT, 'lib/agent-sessions/hosts/tmux-exec.js'), 'utf8');
    if (!/function runTmux/.test(execSrc)) {
        throw new Error('tmux-exec.js must own runTmux');
    }
}

function testAgentsMdPathCheckHandlesGlobs() {
    // REGRESSION: AGENTS.md module-map rows may use globs (lib/commands/setup/*.js);
    // the F636 path-existence check treated the glob as a literal path and failed
    // test:core on main after the F631+F636 merge.
    const { findMissingAgentsMdModulePaths } = require('../../scripts/check-module-graph');
    const missing = findMissingAgentsMdModulePaths();
    const globFalsePositives = missing.filter((p) => p.includes('*') && fs.existsSync(path.join(ROOT, path.dirname(p))));
    if (globFalsePositives.length) {
        throw new Error(`glob module-map rows reported missing despite dir existing: ${globFalsePositives.join(', ')}`);
    }
}

function main() {
    testCanonicalCycleRotation();
    testFixtureCycleAndViolation();
    testBaselineRatchet();
    testRulesTableExists();
    testLoadOrderIsolation();
    testWorktreeTmuxContainment();
    testAgentsMdPathCheckHandlesGlobs();
    console.log('module-graph guard tests passed');
}

main();
