#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const engine = require('../../lib/workflow-core/engine');
const { testAsync, withTempDirAsync, report, GIT_SAFE_ENV } = require('../_helpers');
const CLI_PATH = path.join(__dirname, '..', '..', 'aigon-cli.js');
const write = (root, rel, body) => { const file = path.join(root, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); };
const readJson = (root, rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const readEvents = (root, rel, type) => fs.readFileSync(path.join(root, rel), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).filter((e) => e.type === type);
const git = (cwd, cmd) => execSync(cmd, { cwd, env: { ...process.env, ...GIT_SAFE_ENV } });
const cli = (args, cwd, env = {}, preload = null) => new Promise((resolve) => {
    const child = spawn(process.execPath, [...(preload ? ['--require', preload] : []), CLI_PATH, ...args], { cwd, env: { ...process.env, ...GIT_SAFE_ENV, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', (d) => { stdout += d; }); child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
});
const initResearchRepo = (repo) => (write(repo, 'docs/specs/research-topics/03-in-progress/research-34-race-submit.md', '# Research\n'), write(repo, 'docs/specs/research-topics/logs/research-34-cc-findings.md', '# cc\n'), write(repo, 'docs/specs/research-topics/logs/research-34-gg-findings.md', '# gg\n'), engine.startResearch(repo, '34', 'fleet', ['cc', 'gg']));
function initFeatureRepo(repo) {
    write(repo, 'docs/specs/features/03-in-progress/feature-01-submit-race.md', '# Feature\n'); write(repo, 'docs/specs/features/logs/feature-01-cc-submit-race-log.md', '# cc\n'); write(repo, 'docs/specs/features/logs/feature-01-gg-submit-race-log.md', '# gg\n'); write(repo, 'src/implementation.js', 'module.exports = "v1";\n');
    git(repo, 'git init -q'); git(repo, 'git config user.email test@aigon.test'); git(repo, 'git config user.name "Aigon Test"'); git(repo, 'git checkout -qb main'); git(repo, 'git add .'); git(repo, 'git commit -qm "chore: init"');
    git(repo, 'git checkout -qb feature-01-cx-submit-race'); write(repo, 'src/implementation.js', 'module.exports = "v2";\n'); git(repo, 'git add src/implementation.js'); git(repo, 'git commit -qm "feat: add implementation"');
    return engine.startFeature(repo, '01', 'fleet', ['cc', 'gg']);
}

testAsync('submit signals survive concurrent CLI submits', () => withTempDirAsync('aigon-submit-race-', async (repo) => {
    // REGRESSION: concurrent submit commands used to lose a workflow event on EEXIST while still writing a stale status cache.
    await initResearchRepo(repo);
    const [ccResearch, ggResearch] = await Promise.all([cli(['agent-status', 'submitted', '34', 'cc'], repo), cli(['agent-status', 'submitted', '34', 'gg'], repo)]);
    assert.strictEqual(ccResearch.status, 0, ccResearch.stderr || ccResearch.stdout); assert.strictEqual(ggResearch.status, 0, ggResearch.stderr || ggResearch.stdout);
    assert.strictEqual(readEvents(repo, '.aigon/workflows/research/34/events.jsonl', 'signal.agent_ready').length, 2); assert.deepStrictEqual(Object.values(readJson(repo, '.aigon/workflows/research/34/snapshot.json').agents).map((a) => a.status), ['ready', 'ready']);
    await initFeatureRepo(repo);
    const envFor = (agent) => ({ AIGON_TEST_MODE: '1', AIGON_ENTITY_TYPE: 'feature', AIGON_ENTITY_ID: '01', AIGON_AGENT_ID: agent, AIGON_PROJECT_PATH: repo, AIGON_FORCE_PRO: 'true' });
    const [ccFeature, ggFeature] = await Promise.all([cli(['agent-status', 'submitted'], repo, envFor('cc')), cli(['agent-status', 'submitted'], repo, envFor('gg'))]);
    assert.strictEqual(ccFeature.status, 0, ccFeature.stderr || ccFeature.stdout); assert.strictEqual(ggFeature.status, 0, ggFeature.stderr || ggFeature.stdout);
    assert.strictEqual(readEvents(repo, '.aigon/workflows/features/01/events.jsonl', 'signal.agent_ready').length, 2); assert.deepStrictEqual(Object.values(readJson(repo, '.aigon/workflows/features/01/snapshot.json').agents).map((a) => a.status), ['ready', 'ready']);
}));

testAsync('explicit feature agent-status submitted works from main (no branch evidence gate)', () => withTempDirAsync('aigon-explicit-feat-main-', async (repo) => {
    // REGRESSION: F339 explicit `agent-status submitted <id> <agent>` must succeed from default branch; evidence scan is empty on main.
    await initFeatureRepo(repo);
    git(repo, 'git checkout -q main');
    const r = await cli(['agent-status', 'submitted', '01', 'cc'], repo, { AIGON_TEST_MODE: '1', AIGON_FORCE_PRO: 'true' });
    assert.strictEqual(r.status, 0, r.stderr || r.stdout);
    assert.strictEqual(readEvents(repo, '.aigon/workflows/features/01/events.jsonl', 'signal.agent_ready').length, 1);
    assert.deepStrictEqual(readJson(repo, '.aigon/workflows/features/01/snapshot.json').agents.cc.status, 'ready');
}));

testAsync('explicit research submit succeeds when a done feature with same ID exists', () => withTempDirAsync('aigon-research-done-feature-collision-', async (repo) => {
    // REGRESSION: F339 disambiguation errored immediately when both feature-N (done) and
    // research-N (active) snapshots existed. Fix: read lifecycle and prefer the active one.
    await initResearchRepo(repo); // creates research-34 as active fleet
    write(repo, 'docs/specs/research-topics/logs/research-34-cc-findings.md', '# findings\n');
    // Simulate a done feature-34 (write snapshot directly — bypasses lifecycle engine)
    const featureSnapDir = path.join(repo, '.aigon', 'workflows', 'features', '34');
    fs.mkdirSync(featureSnapDir, { recursive: true });
    fs.writeFileSync(path.join(featureSnapDir, 'snapshot.json'), JSON.stringify({ featureId: '34', lifecycle: 'done', agents: {}, currentSpecState: 'done' }));
    const r = await cli(['agent-status', 'submitted', '34', 'cc'], repo, { AIGON_TEST_MODE: '1', AIGON_FORCE_PRO: 'true' });
    assert.strictEqual(r.status, 0, r.stderr || r.stdout);
    assert.match(r.stdout, /research-34-cc/);
    assert.deepStrictEqual(readJson(repo, '.aigon/workflows/research/34/snapshot.json').agents.cc.status, 'ready');
}));

testAsync('submit command fails before writing stale cache when engine write fails', () => withTempDirAsync('aigon-submit-fail-', async (repo) => {
    await initResearchRepo(repo);
    const preload = path.join(repo, 'force-submit-failure.js');
    write(repo, 'force-submit-failure.js', `const engine = require(${JSON.stringify(path.join(__dirname, '..', '..', 'lib', 'workflow-core', 'engine.js'))}); engine.emitSignal = async () => { throw new Error('forced signal failure'); };`);
    const result = await cli(['agent-status', 'submitted', '34', 'cc'], repo, {}, preload);
    assert.notStrictEqual(result.status, 0); assert.match(result.stderr || result.stdout, /Failed to record submitted state for research 34 \(cc\): forced signal failure/);
    assert.ok(!fs.existsSync(path.join(repo, '.aigon', 'state', 'research-34-cc.json'))); assert.strictEqual(readEvents(repo, '.aigon/workflows/research/34/events.jsonl', 'signal.agent_ready').length, 0);
}));

report();
