#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, testAsync, withTempDirAsync, report } = require('../_helpers');

const CLI = path.join(__dirname, '..', '..', 'aigon-cli.js');
const MODULE_PATH = path.join(__dirname, '..', '..', 'lib', 'workflow-definitions.js');
const AVAILABLE_AGENTS = ['cc', 'gg', 'cx', 'cu'];

function withHome(homePath, fn) {
    const previousHome = process.env.HOME;
    process.env.HOME = homePath;
    delete require.cache[require.resolve(MODULE_PATH)];
    try {
        return fn(require(MODULE_PATH));
    } finally {
        delete require.cache[require.resolve(MODULE_PATH)];
        if (previousHome === undefined) {
            delete process.env.HOME;
        } else {
            process.env.HOME = previousHome;
        }
    }
}

function runCli(args, cwd, homePath) {
    return spawnSync(process.execPath, [CLI, ...args], {
        cwd,
        encoding: 'utf8',
        env: {
            ...process.env,
            HOME: homePath,
        },
    });
}

console.log('workflow-definitions');

// REGRESSION: prevents project-scope workflows from silently losing to global-scope
// definitions when the same slug exists in both directories
testAsync('project workflows override global workflows with the same slug', () => withTempDirAsync('aigon-workflow-', async (tmpDir) => {
    const repoPath = path.join(tmpDir, 'repo');
    const homePath = path.join(tmpDir, 'home');
    fs.mkdirSync(repoPath, { recursive: true });
    fs.mkdirSync(homePath, { recursive: true });

    withHome(homePath, (workflowDefinitions) => {
        workflowDefinitions.saveWorkflowDefinition('global', repoPath, {
            slug: 'team-flow',
            label: 'Global Team Flow',
            agents: ['cc', 'gg'],
            evalAgent: 'gg',
            stopAfter: 'eval',
        }, { availableAgents: AVAILABLE_AGENTS });
        workflowDefinitions.saveWorkflowDefinition('project', repoPath, {
            slug: 'team-flow',
            label: 'Project Team Flow',
            agents: ['cx'],
            reviewAgent: 'cc',
            stopAfter: 'close',
        }, { availableAgents: AVAILABLE_AGENTS });

        const resolved = workflowDefinitions.resolveWorkflowDefinition(repoPath, 'team-flow');
        assert.ok(resolved, 'expected workflow to resolve');
        assert.strictEqual(resolved.source, 'project');
        assert.deepStrictEqual(resolved.agents, ['cx']);
        assert.strictEqual(resolved.reviewAgent, 'cc');
    });
}));

// REGRESSION: prevents solo workflows from accepting evalAgent or fleet workflows
// from accepting reviewAgent, and ensures explicit CLI flags override saved values
testAsync('validation enforces solo/fleet schema constraints and explicit overrides win', () => withTempDirAsync('aigon-workflow-', async (tmpDir) => {
    const homePath = path.join(tmpDir, 'home');
    fs.mkdirSync(homePath, { recursive: true });

    withHome(homePath, (workflowDefinitions) => {
        const soloInvalid = workflowDefinitions.validateWorkflowDefinition({
            slug: 'solo-invalid',
            agents: ['cc'],
            evalAgent: 'gg',
            stopAfter: 'close',
        }, { availableAgents: AVAILABLE_AGENTS });
        assert.ok(soloInvalid.errors.some(error => error.includes('solo workflows cannot set evalAgent')));

        const fleetInvalid = workflowDefinitions.validateWorkflowDefinition({
            slug: 'fleet-invalid',
            agents: ['cc', 'gg'],
            reviewAgent: 'cx',
            stopAfter: 'eval',
        }, { availableAgents: AVAILABLE_AGENTS });
        assert.ok(fleetInvalid.errors.some(error => error.includes('fleet workflows cannot set reviewAgent')));

        const merged = workflowDefinitions.applyWorkflowDefinition({
            slug: 'arena',
            agents: ['cc', 'gg'],
            evalAgent: 'gg',
            reviewAgent: null,
            stopAfter: 'eval',
        }, {
            agents: ['cx'],
            stopAfter: 'close',
            evalAgent: null,
        });
        assert.deepStrictEqual(merged.agents, ['cx']);
        assert.strictEqual(merged.stopAfter, 'close');
        assert.strictEqual(merged.evalAgent, null);
    });
}));

testAsync('version 2 workflows validate ordered stages and derive execution runtime', () => withTempDirAsync('aigon-workflow-', async (tmpDir) => {
    const homePath = path.join(tmpDir, 'home');
    fs.mkdirSync(homePath, { recursive: true });

    withHome(homePath, (workflowDefinitions) => {
        const valid = workflowDefinitions.validateWorkflowDefinition({
            slug: 'review-loop',
            version: 2,
            stages: [
                { type: 'implement', agents: ['cc'] },
                { type: 'review', agents: ['gg'] },
                { type: 'counter-review', agents: ['cc'] },
                { type: 'close' },
            ],
        }, { availableAgents: AVAILABLE_AGENTS });
        assert.deepStrictEqual(valid.errors, []);

        const runtime = workflowDefinitions.applyWorkflowDefinition(valid.normalized);
        assert.strictEqual(runtime.version, 2);
        assert.deepStrictEqual(runtime.agents, ['cc']);
        assert.strictEqual(runtime.reviewAgent, 'gg');
        assert.strictEqual(runtime.stopAfterStage, 'close');
        assert.deepStrictEqual(runtime.stages.map(stage => stage.type), ['implement', 'review', 'counter-review', 'close']);

        const invalid = workflowDefinitions.validateWorkflowDefinition({
            slug: 'bad-order',
            version: 2,
            stages: [
                { type: 'review', agents: ['gg'] },
                { type: 'implement', agents: ['cc'] },
            ],
        }, { availableAgents: AVAILABLE_AGENTS });
        assert.ok(invalid.errors.some(error => error.includes('must begin with an implement stage')));
        assert.ok(invalid.errors.some(error => error.includes('invalid stage ordering')));
    });
}));

// REGRESSION: prevents CLI create/list/show/delete from breaking when workflow
// storage directories are missing, or when built-in slugs are used with delete
testAsync('workflow CLI supports create/list/show/delete round-trips', () => withTempDirAsync('aigon-workflow-', async (tmpDir) => {
    const repoPath = path.join(tmpDir, 'repo');
    const homePath = path.join(tmpDir, 'home');
    fs.mkdirSync(repoPath, { recursive: true });
    fs.mkdirSync(homePath, { recursive: true });

    const create = runCli(['workflow', 'create', 'demo', '--agents', 'cc', '--review-agent', 'gg', '--stop-after', 'close'], repoPath, homePath);
    assert.strictEqual(create.status, 0, create.stderr);
    assert.match(create.stdout, /Saved project workflow: demo/);
    assert.ok(fs.existsSync(path.join(repoPath, '.aigon', 'workflow-definitions', 'demo.json')));

    const list = runCli(['workflow', 'list'], repoPath, homePath);
    assert.strictEqual(list.status, 0, list.stderr);
    assert.match(list.stdout, /\bsolo\b/);
    assert.match(list.stdout, /\bdemo\b/);
    assert.match(list.stdout, /\bproject\b/);

    const show = runCli(['workflow', 'show', 'demo'], repoPath, homePath);
    assert.strictEqual(show.status, 0, show.stderr);
    const shown = JSON.parse(show.stdout);
    assert.strictEqual(shown.slug, 'demo');
    assert.strictEqual(shown.source, 'project');
    assert.deepStrictEqual(shown.agents, ['cc']);
    assert.strictEqual(shown.reviewAgent, 'gg');

    const deleteBuiltin = runCli(['workflow', 'delete', 'solo'], repoPath, homePath);
    assert.strictEqual(deleteBuiltin.status, 1);
    assert.match(deleteBuiltin.stderr, /built-in and read-only/);

    const remove = runCli(['workflow', 'delete', 'demo'], repoPath, homePath);
    assert.strictEqual(remove.status, 0, remove.stderr);
    assert.match(remove.stdout, /Deleted project workflow: demo/);
    assert.ok(!fs.existsSync(path.join(repoPath, '.aigon', 'workflow-definitions', 'demo.json')));
}));

testAsync('workflow CLI supports version 2 stage-based definitions', () => withTempDirAsync('aigon-workflow-', async (tmpDir) => {
    const repoPath = path.join(tmpDir, 'repo');
    const homePath = path.join(tmpDir, 'home');
    fs.mkdirSync(repoPath, { recursive: true });
    fs.mkdirSync(homePath, { recursive: true });

    const create = runCli([
        'workflow', 'create', 'reviewed-close',
        '--version', '2',
        '--stage', 'implement:cc',
        '--stage', 'review:gg',
        '--stage', 'counter-review:cc',
        '--stage', 'close',
    ], repoPath, homePath);
    assert.strictEqual(create.status, 0, create.stderr);
    assert.match(create.stdout, /Saved project workflow: reviewed-close/);
    assert.match(create.stdout, /version=2 stages=/);

    const show = runCli(['workflow', 'show', 'reviewed-close'], repoPath, homePath);
    assert.strictEqual(show.status, 0, show.stderr);
    const shown = JSON.parse(show.stdout);
    assert.strictEqual(shown.version, 2);
    assert.deepStrictEqual(shown.stages, [
        { type: 'implement', agents: ['cc'] },
        { type: 'review', agents: ['gg'] },
        { type: 'counter-review', agents: ['cc'] },
        { type: 'close', agents: [] },
    ]);
});

report();
