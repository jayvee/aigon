#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const engine = require('../../lib/workflow-core/engine');
const { testAsync, withTempDirAsync, report, GIT_SAFE_ENV } = require('../_helpers');

const CLI_PATH = path.join(__dirname, '..', '..', 'aigon-cli.js');

function mkdirp(repoPath, relativePath) {
    fs.mkdirSync(path.join(repoPath, relativePath), { recursive: true });
}

function writeFile(repoPath, relativePath, content) {
    const fullPath = path.join(repoPath, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
}

function readWorkflowEvents(repoPath, entityType, id) {
    const folder = entityType === 'research' ? 'research' : 'features';
    const eventsPath = path.join(repoPath, '.aigon', 'workflows', folder, id, 'events.jsonl');
    return fs.readFileSync(eventsPath, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

function readSnapshot(repoPath, entityType, id) {
    const folder = entityType === 'research' ? 'research' : 'features';
    const snapshotPath = path.join(repoPath, '.aigon', 'workflows', folder, id, 'snapshot.json');
    return JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
}

function initGitRepo(repoPath) {
    execSync('git init -q', { cwd: repoPath, env: { ...process.env, ...GIT_SAFE_ENV } });
    execSync('git config user.email test@aigon.test', { cwd: repoPath });
    execSync('git config user.name "Aigon Test"', { cwd: repoPath });
    execSync('git checkout -qb main', { cwd: repoPath, env: { ...process.env, ...GIT_SAFE_ENV } });
}

function runGit(repoPath, command) {
    execSync(command, { cwd: repoPath, env: { ...process.env, ...GIT_SAFE_ENV } });
}

function runCli(args, cwd, extraEnv = {}, preloadPath = null) {
    return new Promise((resolve) => {
        const nodeArgs = [];
        if (preloadPath) {
            nodeArgs.push('--require', preloadPath);
        }
        nodeArgs.push(CLI_PATH, ...args);
        const child = spawn(process.execPath, nodeArgs, {
            cwd,
            env: { ...process.env, ...GIT_SAFE_ENV, ...extraEnv },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => { stdout += String(chunk); });
        child.stderr.on('data', (chunk) => { stderr += String(chunk); });
        child.on('close', (status) => resolve({ status, stdout, stderr }));
    });
}

async function withResearchRepo(body) {
    return withTempDirAsync('aigon-submit-research-', async (repoPath) => {
        mkdirp(repoPath, 'docs/specs/research-topics/03-in-progress');
        mkdirp(repoPath, 'docs/specs/research-topics/logs');
        mkdirp(repoPath, '.aigon/state');
        writeFile(repoPath, 'docs/specs/research-topics/03-in-progress/research-34-race-submit.md', '# Research: race submit\n');
        writeFile(repoPath, 'docs/specs/research-topics/logs/research-34-cc-findings.md', '# cc\n');
        writeFile(repoPath, 'docs/specs/research-topics/logs/research-34-gg-findings.md', '# gg\n');
        await engine.startResearch(repoPath, '34', 'fleet', ['cc', 'gg']);
        return body(repoPath);
    });
}

async function withFeatureRepo(body) {
    return withTempDirAsync('aigon-submit-feature-', async (repoPath) => {
        mkdirp(repoPath, 'docs/specs/features/03-in-progress');
        mkdirp(repoPath, 'docs/specs/features/logs');
        mkdirp(repoPath, '.aigon/state');
        writeFile(repoPath, 'docs/specs/features/03-in-progress/feature-01-submit-race.md', '# Feature: submit race\n');
        writeFile(repoPath, 'docs/specs/features/logs/feature-01-cc-submit-race-log.md', '# cc log\n');
        writeFile(repoPath, 'docs/specs/features/logs/feature-01-gg-submit-race-log.md', '# gg log\n');
        writeFile(repoPath, 'src/implementation.js', 'module.exports = "submit-race";\n');
        initGitRepo(repoPath);
        runGit(repoPath, 'git add .');
        runGit(repoPath, 'git commit -qm "chore: init"');
        runGit(repoPath, 'git checkout -qb feature-01-cx-submit-race');
        writeFile(repoPath, 'src/implementation.js', 'module.exports = "submit-race-v2";\n');
        runGit(repoPath, 'git add src/implementation.js');
        runGit(repoPath, 'git commit -qm "feat: add implementation"');
        await engine.startFeature(repoPath, '01', 'fleet', ['cc', 'gg']);
        return body(repoPath);
    });
}

testAsync('parallel research-submit records both submissions', () => withResearchRepo(async (repoPath) => {
    // REGRESSION: concurrent research-submit calls used to drop one
    // signal.agent_submitted event on EEXIST and still print success because
    // the status-file cache wrote first. This covers the real CLI race.
    const [cc, gg] = await Promise.all([
        runCli(['research-submit', '34', 'cc'], repoPath),
        runCli(['research-submit', '34', 'gg'], repoPath),
    ]);

    assert.strictEqual(cc.status, 0, cc.stderr || cc.stdout);
    assert.strictEqual(gg.status, 0, gg.stderr || gg.stdout);

    const submitEvents = readWorkflowEvents(repoPath, 'research', '34')
        .filter((event) => event.type === 'signal.agent_submitted');
    assert.strictEqual(submitEvents.length, 2);

    const snapshot = readSnapshot(repoPath, 'research', '34');
    assert.strictEqual(snapshot.agents.cc.status, 'ready');
    assert.strictEqual(snapshot.agents.gg.status, 'ready');
    assert.ok(fs.existsSync(path.join(repoPath, '.aigon', 'state', 'research-34-cc.json')));
    assert.ok(fs.existsSync(path.join(repoPath, '.aigon', 'state', 'research-34-gg.json')));
}));

testAsync('parallel agent-status submitted records both feature submissions', () => withFeatureRepo(async (repoPath) => {
    const envFor = (agentId) => ({
        AIGON_TEST_MODE: '1',
        AIGON_ENTITY_TYPE: 'feature',
        AIGON_ENTITY_ID: '01',
        AIGON_AGENT_ID: agentId,
        AIGON_PROJECT_PATH: repoPath,
        AIGON_FORCE_PRO: 'true',
    });

    const [cc, gg] = await Promise.all([
        runCli(['agent-status', 'submitted'], repoPath, envFor('cc')),
        runCli(['agent-status', 'submitted'], repoPath, envFor('gg')),
    ]);

    assert.strictEqual(cc.status, 0, cc.stderr || cc.stdout);
    assert.strictEqual(gg.status, 0, gg.stderr || gg.stdout);

    const readyEvents = readWorkflowEvents(repoPath, 'feature', '01')
        .filter((event) => event.type === 'signal.agent_ready');
    assert.strictEqual(readyEvents.length, 2);

    const snapshot = readSnapshot(repoPath, 'feature', '01');
    assert.strictEqual(snapshot.agents.cc.status, 'ready');
    assert.strictEqual(snapshot.agents.gg.status, 'ready');
    assert.ok(fs.existsSync(path.join(repoPath, '.aigon', 'state', 'feature-01-cc.json')));
    assert.ok(fs.existsSync(path.join(repoPath, '.aigon', 'state', 'feature-01-gg.json')));
}));

testAsync('research-submit fails before writing stale status cache when engine signal fails', () => withResearchRepo(async (repoPath) => {
    const preloadPath = path.join(repoPath, 'force-submit-failure.js');
    writeFile(
        repoPath,
        'force-submit-failure.js',
        `const engine = require(${JSON.stringify(path.join(__dirname, '..', '..', 'lib', 'workflow-core', 'engine.js'))});
engine.emitSignal = async () => { throw new Error('forced signal failure'); };
`
    );

    const result = await runCli(['research-submit', '34', 'cc'], repoPath, {}, preloadPath);
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr || result.stdout, /Failed to submit research 34 \(cc\): forced signal failure/);
    assert.ok(!fs.existsSync(path.join(repoPath, '.aigon', 'state', 'research-34-cc.json')));

    const submitEvents = readWorkflowEvents(repoPath, 'research', '34')
        .filter((event) => event.type === 'signal.agent_submitted');
    assert.strictEqual(submitEvents.length, 0);
  }));

report();
