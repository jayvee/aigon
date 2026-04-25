#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { test, withTempDir, report, seedEntityDirs, withRepoCwd } = require('../_helpers');
const engine = require('../../lib/workflow-core/engine');
function freshEntityModules() {
    delete require.cache[require.resolve('../../lib/templates')];
    delete require.cache[require.resolve('../../lib/utils')];
    delete require.cache[require.resolve('../../lib/entity')];
    return {
        utils: require('../../lib/utils'),
        entity: require('../../lib/entity'),
    };
}
function buildCtx(utils) {
    return { utils, git: { getCurrentBranch: () => 'main', getDefaultBranch: () => 'main', getCommonDir: () => null, runGit: () => {} }, board: { loadBoardMapping: () => null } };
}
const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const normalizePath = (filePath) => (fs.realpathSync.native ? fs.realpathSync.native(filePath) : fs.realpathSync(filePath));
const wrm = require('../../lib/workflow-read-model');
function freshRequire(modPath) {
    delete require.cache[require.resolve(modPath)];
    return require(modPath);
}
function runEntityChild(repo, body) {
    const entityModulePath = path.join(__dirname, '../../lib/entity');
    const utilsModulePath = path.join(__dirname, '../../lib/utils');
    const templatesModulePath = path.join(__dirname, '../../lib/templates');
    const script = `
        delete require.cache[require.resolve(${JSON.stringify(templatesModulePath)})];
        delete require.cache[require.resolve(${JSON.stringify(utilsModulePath)})];
        delete require.cache[require.resolve(${JSON.stringify(entityModulePath)})];
        const entity = require(${JSON.stringify(entityModulePath)});
        const utils = require(${JSON.stringify(utilsModulePath)});
        const ctx = { utils, git: { getCurrentBranch: () => 'main', getDefaultBranch: () => 'main', getCommonDir: () => null, runGit: () => {} }, board: { loadBoardMapping: () => null } };
        (async () => { ${body} })().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
    `;
    return execFileSync(process.execPath, ['-e', script], { cwd: repo, stdio: 'pipe' });
}
// REGRESSION: F296 must not leave a snapshotless inbox spec behind when create bootstrapping fails.
test('entityCreate bootstraps inbox workflow state and rolls back the spec on bootstrap failure', () => withTempDir('aigon-f296-create-', (repo) => {
    seedEntityDirs(repo, 'features');
    withRepoCwd(repo, () => {
        const { utils, entity } = freshEntityModules();
        const created = entity.entityCreate(entity.FEATURE_DEF, 'foo', buildCtx(utils));
        assert.ok(created);
        assert.ok(fs.existsSync(path.join(repo, 'docs/specs/features/01-inbox/feature-foo.md')));
        const snapshot = readJson(path.join(repo, '.aigon/workflows/features/foo/snapshot.json'));
        assert.strictEqual(snapshot.featureId, 'foo');
        assert.strictEqual(snapshot.currentSpecState, 'inbox');
        assert.strictEqual(normalizePath(snapshot.specPath), normalizePath(path.join(repo, 'docs/specs/features/01-inbox/feature-foo.md')));
        const original = engine.ensureEntityBootstrappedSync;
        const originalError = console.error;
        const errors = [];
        console.error = (...args) => { errors.push(args.join(' ')); };
        engine.ensureEntityBootstrappedSync = () => { throw new Error('bootstrap exploded'); };
        try {
            const failed = entity.entityCreate(entity.FEATURE_DEF, 'bar', buildCtx(utils));
            assert.strictEqual(failed, null);
        } finally {
            engine.ensureEntityBootstrappedSync = original;
            console.error = originalError;
        }
        assert.ok(!fs.existsSync(path.join(repo, 'docs/specs/features/01-inbox/feature-bar.md')));
        assert.ok(!fs.existsSync(path.join(repo, '.aigon/workflows/features/bar')));
        assert.ok(errors.some((line) => line.includes('bootstrap exploded')));
    });
}));
// REGRESSION: spec-review-check needs the original create-time author from workflow bootstrap state.
test('entityCreate stores authorAgentId on the inbox workflow snapshot when created by an agent', () => withTempDir('aigon-author-bootstrap-', (repo) => {
    seedEntityDirs(repo, 'features');
    const prevAgentId = process.env.AIGON_AGENT_ID;
    process.env.AIGON_AGENT_ID = 'cx';
    try {
        withRepoCwd(repo, () => {
            const { utils, entity } = freshEntityModules();
            const created = entity.entityCreate(entity.FEATURE_DEF, 'authored-by-cx', buildCtx(utils));
            assert.ok(created);
        });
    } finally {
        if (prevAgentId == null) delete process.env.AIGON_AGENT_ID;
        else process.env.AIGON_AGENT_ID = prevAgentId;
    }
    const snapshot = readJson(path.join(repo, '.aigon/workflows/features/authored-by-cx/snapshot.json'));
    const events = fs.readFileSync(path.join(repo, '.aigon/workflows/features/authored-by-cx/events.jsonl'), 'utf8');
    assert.strictEqual(snapshot.authorAgentId, 'cx');
    assert.ok(events.includes('"authorAgentId":"cx"'));
}));
// REGRESSION: F296 re-keys slug inbox workflow state to the numeric backlog id instead of silently minting a fresh snapshot.
test('entityPrioritise migrates slug-keyed workflow state to the numeric id', () => withTempDir('aigon-f296-prio-', (repo) => {
    seedEntityDirs(repo, 'features');
    const specPath = path.join(repo, 'docs/specs/features/01-inbox/feature-foo.md');
    fs.writeFileSync(specPath, '# Feature: foo\n');
    engine.ensureEntityBootstrappedSync(repo, 'feature', 'foo', 'inbox', specPath);
    withRepoCwd(repo, () => {
        const { utils, entity } = freshEntityModules();
        entity.entityPrioritise(entity.FEATURE_DEF, 'foo', buildCtx(utils));
    });
    assert.ok(!fs.existsSync(path.join(repo, '.aigon/workflows/features/foo')));
    assert.ok(fs.existsSync(path.join(repo, '.aigon/workflows/features/01/snapshot.json')));
    const snapshot = readJson(path.join(repo, '.aigon/workflows/features/01/snapshot.json'));
    const events = fs.readFileSync(path.join(repo, '.aigon/workflows/features/01/events.jsonl'), 'utf8');
    assert.strictEqual(snapshot.featureId, '01');
    assert.strictEqual(snapshot.currentSpecState, 'backlog');
    assert.strictEqual(normalizePath(snapshot.specPath), normalizePath(path.join(repo, 'docs/specs/features/02-backlog/feature-01-foo.md')));
    assert.ok(events.includes('"featureId":"01"'));
    assert.ok(events.includes('"lifecycle":"backlog"'));
    assert.ok(!events.includes('"featureId":"foo"'));
}));
// REGRESSION: F296 doctor migration must scan research 01-inbox, not only backlog-and-later stages.
test('findEntitiesMissingWorkflowState discovers snapshotless research inbox specs', () => withTempDir('aigon-f296-rinbox-', (repo) => {
    seedEntityDirs(repo, 'research-topics');
    const specPath = path.join(repo, 'docs/specs/research-topics/01-inbox/research-wizardry.md');
    fs.writeFileSync(specPath, '# Research: wizardry\n');
    const setup = freshRequire('../../lib/commands/setup')._test;
    const missing = setup.findEntitiesMissingWorkflowState(repo);
    assert.deepStrictEqual(missing.research, [{ id: 'wizardry', stage: 'inbox', specPath }]);
    assert.strictEqual(setup.bootstrapMissingWorkflowSnapshots(repo, missing.research, 'research'), 1);
    const snapshot = readJson(path.join(repo, '.aigon/workflows/research/wizardry/snapshot.json'));
    assert.strictEqual(snapshot.researchId, 'wizardry');
    assert.strictEqual(snapshot.currentSpecState, 'inbox');
}));
// REGRESSION: F296 moves legacy inbox migration to explicit doctor/init bootstrap, not dashboard reads.
test('bootstrapMissingWorkflowSnapshots migrates slug-keyed inbox specs', () => withTempDir('aigon-f296-doctor-', (repo) => {
    seedEntityDirs(repo, 'features');
    const specPath = path.join(repo, 'docs/specs/features/01-inbox/feature-foo.md');
    fs.writeFileSync(specPath, '# Feature: foo\n');
    const setup = freshRequire('../../lib/commands/setup')._test;
    const missing = setup.findEntitiesMissingWorkflowState(repo);
    assert.deepStrictEqual(missing.features, [{ id: 'foo', stage: 'inbox', specPath }]);
    assert.strictEqual(setup.bootstrapMissingWorkflowSnapshots(repo, missing.features, 'feature'), 1);
    const snapshot = readJson(path.join(repo, '.aigon/workflows/features/foo/snapshot.json'));
    assert.strictEqual(snapshot.featureId, 'foo');
    assert.strictEqual(snapshot.currentSpecState, 'inbox');
}));
// REGRESSION: F296 inbox cards derive actions from a real slug-backed snapshot, not the missing-snapshot fallback.
test('workflow read model exposes prioritise for slug-backed inbox snapshots', () => withTempDir('aigon-f296-read-', (repo) => {
    seedEntityDirs(repo, 'features');
    const inboxSpecPath = path.join(repo, 'docs/specs/features/01-inbox/feature-foo.md');
    const backlogSpecPath = path.join(repo, 'docs/specs/features/02-backlog/feature-01-bar.md');
    fs.writeFileSync(inboxSpecPath, '# Feature: foo\n');
    fs.writeFileSync(backlogSpecPath, '# Feature: bar\n');
    engine.ensureEntityBootstrappedSync(repo, 'feature', 'foo', 'inbox', inboxSpecPath);
    engine.ensureEntityBootstrappedSync(repo, 'feature', '01', 'backlog', backlogSpecPath);
    const inboxState = wrm.getFeatureDashboardState(repo, 'foo', 'inbox', []);
    const backlogState = wrm.getFeatureDashboardState(repo, '01', 'backlog', []);
    assert.strictEqual(inboxState.readModelSource, wrm.WORKFLOW_SOURCE.SNAPSHOT);
    assert.ok(inboxState.validActions.some((action) => action.action === 'feature-prioritise'));
    assert.strictEqual(backlogState.readModelSource, wrm.WORKFLOW_SOURCE.SNAPSHOT);
    assert.ok(backlogState.validActions.some((action) => action.action === 'feature-start'));
}));
// REGRESSION: pre-start inbox/backlog items must expose pause/delete actions from workflow snapshots.
test('workflow read model exposes pause and delete for pre-start feature and research items', () => withTempDir('aigon-prestart-actions-', (repo) => {
    seedEntityDirs(repo, 'features');
    seedEntityDirs(repo, 'research-topics');
    const featureInboxPath = path.join(repo, 'docs/specs/features/01-inbox/feature-foo.md');
    const featureBacklogPath = path.join(repo, 'docs/specs/features/02-backlog/feature-01-bar.md');
    const researchInboxPath = path.join(repo, 'docs/specs/research-topics/01-inbox/research-wizardry.md');
    const researchBacklogPath = path.join(repo, 'docs/specs/research-topics/02-backlog/research-02-deep-dive.md');
    fs.writeFileSync(featureInboxPath, '# Feature: foo\n');
    fs.writeFileSync(featureBacklogPath, '# Feature: bar\n');
    fs.writeFileSync(researchInboxPath, '# Research: wizardry\n');
    fs.writeFileSync(researchBacklogPath, '# Research: deep dive\n');
    engine.ensureEntityBootstrappedSync(repo, 'feature', 'foo', 'inbox', featureInboxPath);
    engine.ensureEntityBootstrappedSync(repo, 'feature', '01', 'backlog', featureBacklogPath);
    engine.ensureEntityBootstrappedSync(repo, 'research', 'wizardry', 'inbox', researchInboxPath);
    engine.ensureEntityBootstrappedSync(repo, 'research', '02', 'backlog', researchBacklogPath);
    const featureInbox = wrm.getFeatureDashboardState(repo, 'foo', 'inbox', []);
    const featureBacklog = wrm.getFeatureDashboardState(repo, '01', 'backlog', []);
    const researchInbox = wrm.getResearchDashboardState(repo, 'wizardry', 'inbox', []);
    const researchBacklog = wrm.getResearchDashboardState(repo, '02', 'backlog', []);
    assert.ok(featureInbox.validActions.some((action) => action.action === 'feature-pause'));
    assert.ok(featureInbox.validActions.some((action) => action.action === 'feature-delete'));
    assert.ok(featureBacklog.validActions.some((action) => action.action === 'feature-pause'));
    assert.ok(featureBacklog.validActions.some((action) => action.action === 'feature-delete'));
    assert.ok(researchInbox.validActions.some((action) => action.action === 'research-pause'));
    assert.ok(researchInbox.validActions.some((action) => action.action === 'research-delete'));
    assert.ok(researchBacklog.validActions.some((action) => action.action === 'research-pause'));
    assert.ok(researchBacklog.validActions.some((action) => action.action === 'research-delete'));
}));
// REGRESSION: pre-start pause/resume must round-trip backlog features without resuming them into implementing.
test('pausePrestartEntity and resumePrestartEntity preserve feature backlog state', () => withTempDir('aigon-prestart-feature-pause-', (repo) => {
    seedEntityDirs(repo, 'features');
    const specPath = path.join(repo, 'docs/specs/features/02-backlog/feature-01-foo.md');
    fs.writeFileSync(specPath, '# Feature: foo\n');
    engine.ensureEntityBootstrappedSync(repo, 'feature', '01', 'backlog', specPath);
    runEntityChild(repo, "await entity.pausePrestartEntity(entity.FEATURE_DEF, '01', ctx); await entity.resumePrestartEntity(entity.FEATURE_DEF, '01', ctx);");
    assert.ok(fs.existsSync(path.join(repo, 'docs/specs/features/02-backlog/feature-01-foo.md')));
    const snapshot = readJson(path.join(repo, '.aigon/workflows/features/01/snapshot.json'));
    assert.strictEqual(snapshot.currentSpecState, 'backlog');
    assert.strictEqual(snapshot.pauseReason, null);
}));
// REGRESSION: pre-start delete must remove research specs and workflow state cleanly.
test('entityDelete removes a backlog research topic and its workflow snapshot', () => withTempDir('aigon-research-delete-', (repo) => {
    seedEntityDirs(repo, 'research-topics');
    const specPath = path.join(repo, 'docs/specs/research-topics/02-backlog/research-02-deep-dive.md');
    fs.writeFileSync(specPath, '# Research: deep dive\n');
    engine.ensureEntityBootstrappedSync(repo, 'research', '02', 'backlog', specPath);
    runEntityChild(repo, "await entity.entityDelete(entity.RESEARCH_DEF, '02', ctx);");
    assert.ok(!fs.existsSync(specPath));
    assert.ok(!fs.existsSync(path.join(repo, '.aigon/workflows/research/02')));
}));
// REGRESSION: deleting a feature must fail loudly when other specs still depend on it.
test('entityDelete blocks deleting a feature that other specs depend on', () => withTempDir('aigon-feature-delete-deps-', (repo) => {
    seedEntityDirs(repo, 'features');
    const basePath = path.join(repo, 'docs/specs/features/02-backlog/feature-01-core.md');
    const dependentPath = path.join(repo, 'docs/specs/features/02-backlog/feature-02-ui.md');
    fs.writeFileSync(basePath, '# Feature: core\n');
    fs.writeFileSync(dependentPath, '---\ndepends_on: [01]\n---\n\n# Feature: ui\n');
    engine.ensureEntityBootstrappedSync(repo, 'feature', '01', 'backlog', basePath);
    engine.ensureEntityBootstrappedSync(repo, 'feature', '02', 'backlog', dependentPath);
    let output = '';
    try {
        runEntityChild(repo, "await entity.entityDelete(entity.FEATURE_DEF, '01', ctx);");
    } catch (error) {
        output = String(error.stderr || '') + String(error.stdout || '');
    }
    assert.ok(fs.existsSync(basePath));
    assert.ok(fs.existsSync(path.join(repo, '.aigon/workflows/features/01/snapshot.json')));
    assert.match(output, /depends_on/);
}));
report();
