#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');
const workflowReadModel = require('../../lib/workflow-read-model');
const board = require('../../lib/board');

const FEATURE_FOLDERS = ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused'];
const RESEARCH_FOLDERS = ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused'];

function seedRepo(repoDir) {
    FEATURE_FOLDERS.forEach(folder => fs.mkdirSync(path.join(repoDir, 'docs', 'specs', 'features', folder), { recursive: true }));
    RESEARCH_FOLDERS.forEach(folder => fs.mkdirSync(path.join(repoDir, 'docs', 'specs', 'research-topics', folder), { recursive: true }));
}

function writeFeatureSpec(repoDir, folder, fileName) {
    const specPath = path.join(repoDir, 'docs', 'specs', 'features', folder, fileName);
    fs.mkdirSync(path.dirname(specPath), { recursive: true });
    fs.writeFileSync(specPath, `# ${fileName}\n`);
    return specPath;
}

function writeResearchSpec(repoDir, folder, fileName) {
    const specPath = path.join(repoDir, 'docs', 'specs', 'research-topics', folder, fileName);
    fs.mkdirSync(path.dirname(specPath), { recursive: true });
    fs.writeFileSync(specPath, `# ${fileName}\n`);
    return specPath;
}

function writeFeatureSnapshot(repoDir, featureId, lifecycle, agentStatus = 'running') {
    const workflowDir = path.join(repoDir, '.aigon', 'workflows', 'features', String(featureId));
    fs.mkdirSync(workflowDir, { recursive: true });
    fs.writeFileSync(path.join(workflowDir, 'snapshot.json'), JSON.stringify({
        entityType: 'feature',
        featureId: String(featureId),
        currentSpecState: lifecycle,
        lifecycle,
        mode: 'solo_branch',
        agents: { cx: { status: agentStatus } },
        winnerAgentId: null,
        createdAt: '2026-04-01T10:00:00.000Z',
        updatedAt: '2026-04-01T10:05:00.000Z',
    }));
}

function writeResearchSnapshot(repoDir, researchId, lifecycle, agentStatus = 'running') {
    const workflowDir = path.join(repoDir, '.aigon', 'workflows', 'research', String(researchId));
    fs.mkdirSync(workflowDir, { recursive: true });
    fs.writeFileSync(path.join(workflowDir, 'snapshot.json'), JSON.stringify({
        entityType: 'research',
        researchId: String(researchId),
        currentSpecState: lifecycle,
        lifecycle,
        mode: 'solo_branch',
        agents: { cx: { status: agentStatus } },
        createdAt: '2026-04-01T10:00:00.000Z',
        updatedAt: '2026-04-01T10:05:00.000Z',
    }));
}

test('feature read model prefers snapshot lifecycle over visible folder stage', () => withTempDir('aigon-read-model-', (repoDir) => {
    seedRepo(repoDir);
    writeFeatureSpec(repoDir, '02-backlog', 'feature-12-snapshot-stage.md');
    writeFeatureSnapshot(repoDir, '12', 'implementing');

    const state = workflowReadModel.getFeatureDashboardState(repoDir, '12', 'backlog', []);
    assert.strictEqual(state.stage, 'in-progress');
    assert.strictEqual(state.readModelSource, workflowReadModel.WORKFLOW_SOURCE.SNAPSHOT);
    assert.ok(state.validActions.length > 0, 'snapshot-backed feature should keep workflow actions');
}));

test('legacy numeric feature without snapshot stays visible but read-only', () => withTempDir('aigon-read-model-', (repoDir) => {
    seedRepo(repoDir);
    writeFeatureSpec(repoDir, '02-backlog', 'feature-13-legacy-feature.md');

    const state = workflowReadModel.getFeatureDashboardState(repoDir, '13', 'backlog', []);
    assert.strictEqual(state.stage, 'backlog');
    assert.strictEqual(state.readModelSource, workflowReadModel.WORKFLOW_SOURCE.LEGACY_MISSING_WORKFLOW);
    assert.strictEqual(state.readOnly, true);
    assert.strictEqual(state.missingWorkflowState, true);
    assert.strictEqual(state.validActions.length, 0);
}));

test('no-id inbox feature stays on compatibility path without legacy marker', () => withTempDir('aigon-read-model-', (repoDir) => {
    seedRepo(repoDir);
    writeFeatureSpec(repoDir, '01-inbox', 'feature-untriaged-idea.md');

    const state = workflowReadModel.getFeatureDashboardState(repoDir, 'untriaged-idea', 'inbox', []);
    assert.strictEqual(state.stage, 'inbox');
    assert.strictEqual(state.readModelSource, workflowReadModel.WORKFLOW_SOURCE.COMPAT_INBOX);
    assert.strictEqual(state.readOnly, false);
    assert.strictEqual(state.missingWorkflowState, false);
    assert.strictEqual(state.validActions.length, 0);
}));

test('research read model also prefers snapshot lifecycle over visible folder stage', () => withTempDir('aigon-read-model-', (repoDir) => {
    seedRepo(repoDir);
    writeResearchSpec(repoDir, '02-backlog', 'research-21-snapshot-stage.md');
    writeResearchSnapshot(repoDir, '21', 'implementing');

    const state = workflowReadModel.getResearchDashboardState(repoDir, '21', 'backlog', []);
    assert.strictEqual(state.stage, 'in-progress');
    assert.strictEqual(state.readModelSource, workflowReadModel.WORKFLOW_SOURCE.SNAPSHOT);
    assert.ok(state.validActions.length > 0, 'snapshot-backed research should keep workflow actions');
}));

test('board re-buckets snapshot-backed features into the snapshot-derived column', () => withTempDir('aigon-read-model-', (repoDir) => {
    seedRepo(repoDir);
    writeFeatureSpec(repoDir, '02-backlog', 'feature-14-board-stage.md');
    writeFeatureSpec(repoDir, '02-backlog', 'feature-15-legacy-board.md');
    writeFeatureSnapshot(repoDir, '14', 'implementing');

    const items = board.collectBoardItems({
        root: path.join(repoDir, 'docs', 'specs', 'features'),
        prefix: 'feature',
        folders: FEATURE_FOLDERS,
    }, new Set(FEATURE_FOLDERS), repoDir);

    const backlogIds = (items['02-backlog'] || []).map(item => item.id);
    const inProgressIds = (items['03-in-progress'] || []).map(item => item.id);
    assert.ok(!backlogIds.includes('14'));
    assert.ok(inProgressIds.includes('14'));
    const legacyItem = (items['02-backlog'] || []).find(item => item.id === '15');
    assert.ok(legacyItem, 'legacy feature should remain visible in backlog');
    assert.strictEqual(legacyItem.missingWorkflowState, true);
    assert.strictEqual(legacyItem.boardAction, null);
}));

report();
