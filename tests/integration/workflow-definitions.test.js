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

report();
