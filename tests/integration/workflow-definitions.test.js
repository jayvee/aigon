#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const { test, testAsync, withTempDir, withTempDirAsync, report } = require('../_helpers');
const workflowDefs = require('../../lib/workflow-definitions');
const { createWorkflowCommands } = require('../../lib/commands/workflow');

test('built-in workflows validate and have unique slugs', () => {
    const slugs = workflowDefs.BUILT_IN_WORKFLOWS.map(d => d.slug);
    assert.strictEqual(new Set(slugs).size, slugs.length, 'built-in slugs must be unique');
    workflowDefs.BUILT_IN_WORKFLOWS.forEach(def => {
        assert.strictEqual(workflowDefs.validateWorkflow(def), true);
    });
});

test('built-in workflows resolve to usable autonomous inputs', () => {
    workflowDefs.BUILT_IN_WORKFLOWS.forEach(def => {
        const resolved = workflowDefs.resolveAutonomousInputs(def);
        assert.ok(Array.isArray(resolved.agents) && resolved.agents.length >= 1,
            `${def.slug} must resolve to at least one implementation agent`);
        assert.ok(['implement', 'eval', 'review', 'close'].includes(resolved.stopAfter),
            `${def.slug} must resolve to a valid stopAfter`);
        if (resolved.reviewAgent) {
            assert.strictEqual(resolved.agents.length, 1,
                `${def.slug} uses review so must have exactly 1 implementer`);
        }
        if (resolved.evalAgent) {
            assert.ok(resolved.agents.length >= 2,
                `${def.slug} uses eval so must have at least 2 implementers`);
        }
    });
});

test('validation rejects stages that do not begin with implement', () => {
    assert.throws(() => workflowDefs.validateWorkflow({
        slug: 'bad',
        stages: [{ type: 'review', agents: ['cc'] }, { type: 'close' }],
    }), /First stage must be "implement"/);
});

test('validation rejects close that is not the final stage', () => {
    assert.throws(() => workflowDefs.validateWorkflow({
        slug: 'bad',
        stages: [{ type: 'implement', agents: ['cc'] }, { type: 'close' }, { type: 'review', agents: ['gg'] }],
    }), /"close" must be the final stage/);
});

test('validation rejects combining review with eval', () => {
    assert.throws(() => workflowDefs.validateWorkflow({
        slug: 'bad',
        stages: [
            { type: 'implement', agents: ['cc', 'gg'] },
            { type: 'review', agents: ['gg'] },
            { type: 'eval', agents: ['cc'] },
        ],
    }), /cannot be combined/);
});

test('validation rejects eval with fewer than two implementers', () => {
    assert.throws(() => workflowDefs.validateWorkflow({
        slug: 'bad',
        stages: [
            { type: 'implement', agents: ['cc'] },
            { type: 'eval', agents: ['gg'] },
        ],
    }), /at least two implementing agents/);
});

test('validation rejects review with multiple implementers', () => {
    assert.throws(() => workflowDefs.validateWorkflow({
        slug: 'bad',
        stages: [
            { type: 'implement', agents: ['cc', 'gg'] },
            { type: 'review', agents: ['cu'] },
        ],
    }), /exactly one implementing agent/);
});

test('validation rejects invalid slug', () => {
    assert.throws(() => workflowDefs.validateWorkflow({
        slug: 'Bad Slug',
        stages: [{ type: 'implement', agents: ['cc'] }, { type: 'close' }],
    }), /slug must match/);
});

test('validation accepts optional models and params maps', () => {
    assert.strictEqual(workflowDefs.validateWorkflow({
        slug: 'with-models',
        stages: [
            { type: 'implement', agents: ['cc'], models: { cc: 'sonnet' }, params: { cc: { foo: 'bar' } } },
            { type: 'close' },
        ],
    }), true);
});

test('project workflow storage round-trips through saveProject / loadProject', () => withTempDir('aigon-wf-', (repoDir) => {
    const def = {
        slug: 'custom-test',
        label: 'Custom',
        description: 'local override',
        stages: [{ type: 'implement', agents: ['cu'] }, { type: 'close' }],
    };
    const filePath = workflowDefs.saveProject(repoDir, def);
    assert.ok(fs.existsSync(filePath));
    const loaded = workflowDefs.loadProject(repoDir);
    assert.strictEqual(loaded.length, 1);
    assert.strictEqual(loaded[0].slug, 'custom-test');
    assert.strictEqual(loaded[0].source, 'project');
    const resolved = workflowDefs.resolve('custom-test', repoDir);
    assert.strictEqual(resolved.source, 'project');
    assert.strictEqual(workflowDefs.deleteProject(repoDir, 'custom-test'), true);
    assert.strictEqual(workflowDefs.loadProject(repoDir).length, 0);
}));

test('loadAll merges built-in + project with project winning on slug collision', () => withTempDir('aigon-wf-', (repoDir) => {
    const builtInSlug = workflowDefs.BUILT_IN_WORKFLOWS[0].slug;
    const override = {
        slug: builtInSlug,
        label: 'Custom override',
        description: 'overridden',
        stages: [{ type: 'implement', agents: ['cu'] }, { type: 'close' }],
    };
    workflowDefs.saveProject(repoDir, override);
    const all = workflowDefs.loadAll(repoDir);
    const match = all.find(d => d.slug === builtInSlug);
    assert.strictEqual(match.source, 'project');
    assert.strictEqual(match.overrides, 'built-in');
    assert.deepStrictEqual(match.stages[0].agents, ['cu']);
}));

testAsync('CLI workflow create/list/delete works via handler', () => withTempDirAsync('aigon-wf-', async (repoDir) => {
    const { execSync } = require('child_process');
    execSync('git init -b main', { cwd: repoDir, stdio: 'pipe' });
    const originalCwd = process.cwd();
    process.chdir(repoDir);
    try {
        const { workflow } = createWorkflowCommands();
        let output = '';
        const origLog = console.log;
        const origErr = console.error;
        console.log = (msg) => { output += msg + '\n'; };
        console.error = (msg) => { output += msg + '\n'; };
        try {
            await workflow(['create', 'mine', '--implement=cu']);
            await workflow(['list']);
            assert.ok(output.includes('mine'), 'list should show custom slug');
            assert.ok(output.includes('project'), 'list should show project source');
            await workflow(['delete', 'mine']);
            assert.ok(output.includes('Deleted workflow'), 'delete should succeed');
        } finally {
            console.log = origLog;
            console.error = origErr;
        }
    } finally {
        process.chdir(originalCwd);
    }
}));

testAsync('CLI rejects overwriting built-in slug', () => withTempDirAsync('aigon-wf-', async (repoDir) => {
    const { execSync } = require('child_process');
    execSync('git init -b main', { cwd: repoDir, stdio: 'pipe' });
    const originalCwd = process.cwd();
    process.chdir(repoDir);
    try {
        const { workflow } = createWorkflowCommands();
        let errOutput = '';
        const origErr = console.error;
        console.error = (msg) => { errOutput += msg + '\n'; };
        const originalExitCode = process.exitCode;
        try {
            const builtInSlug = workflowDefs.BUILT_IN_WORKFLOWS[0].slug;
            await workflow(['create', builtInSlug, '--implement=cu']);
            assert.ok(errOutput.includes('built-in'), 'should reject built-in slug overwrite');
        } finally {
            console.error = origErr;
            process.exitCode = originalExitCode;
        }
    } finally {
        process.chdir(originalCwd);
    }
}));

report();
