#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report, seedEntityDirs, withRepoCwd, readJson, freshEntityModules, buildEntityCtx } = require('../_helpers');
const engine = require('../../lib/workflow-core/engine');
const { projectContext } = require('../../lib/workflow-core/projector');
const { resolveSpecAuthor, buildSpecAuthor } = require('../../lib/spec-author-provenance');
const { buildEntityView } = require('../../lib/read-model/entity-view');

// REGRESSION: F584 — --agent on create must stamp specAuthor even without AIGON_AGENT_ID.
test('entityCreate with options.agent stamps specAuthor on inbox bootstrap', () => withTempDir('aigon-spec-author-create-', (repo) => {
    seedEntityDirs(repo, 'features');
    withRepoCwd(repo, () => {
        const { utils, entity } = freshEntityModules();
        const created = entity.entityCreate(entity.FEATURE_DEF, 'authored-by-flag', buildEntityCtx(utils), {
            agent: 'cx',
            model: 'gpt-test',
            effort: 'high',
        });
        assert.ok(created);
    });
    const snapshot = readJson(path.join(repo, '.aigon/workflows/features/01/snapshot.json'));
    assert.strictEqual(snapshot.specAuthor.agentId, 'cx');
    assert.strictEqual(snapshot.specAuthor.model, 'gpt-test');
    assert.strictEqual(snapshot.specAuthor.effort, 'high');
    assert.strictEqual(snapshot.authorAgentId, 'cx');
}));

// REGRESSION: F584 — research-create must forward --agent into entityCreate bootstrap.
test('research-create --agent stamps specAuthor on bootstrap', () => withTempDir('aigon-research-author-', (repo) => {
    seedEntityDirs(repo, 'research-topics');
    withRepoCwd(repo, () => {
        const { utils, entity } = freshEntityModules();
        entity.entityCreate(entity.RESEARCH_DEF, 'topic-alpha', buildEntityCtx(utils), {
            description: 'Explore alpha',
            agent: 'gg',
        });
    });
    const snapshot = readJson(path.join(repo, '.aigon/workflows/research/01/snapshot.json'));
    assert.strictEqual(snapshot.specAuthor.agentId, 'gg');
    assert.strictEqual(snapshot.authorAgentId, 'gg');
    assert.strictEqual(snapshot.specAuthor.model, null);
}));

// REGRESSION: F584 — spec revision must not overwrite immutable specAuthor.
test('spec_revision.completed does not replace original specAuthor', () => {
    const bootAt = '2026-06-01T10:00:00.000Z';
    const events = [
        {
            type: 'feature.bootstrapped',
            featureId: '01',
            lifecycle: 'backlog',
            stage: 'backlog',
            specAuthor: buildSpecAuthor({ agentId: 'cc', model: 'claude-a', effort: null, authoredAt: bootAt }),
            authorAgentId: 'cc',
            at: bootAt,
        },
        {
            type: 'feature.spec_revision.started',
            checkerId: 'gg',
            revisionModel: 'gemini-b',
            revisionEffort: 'low',
            at: '2026-06-02T10:00:00.000Z',
        },
        {
            type: 'feature.spec_revision.completed',
            ackedBy: 'gg',
            revisedBy: 'gg',
            revisionModel: 'gemini-b',
            revisionEffort: 'low',
            lastSpecRevision: {
                agentId: 'gg',
                model: 'gemini-b',
                effort: 'low',
                revisedAt: '2026-06-02T11:00:00.000Z',
                commitSha: 'abc123',
            },
            at: '2026-06-02T11:00:00.000Z',
        },
    ];
    const context = projectContext(events);
    assert.strictEqual(context.specAuthor.agentId, 'cc');
    assert.strictEqual(context.specAuthor.model, 'claude-a');
    assert.strictEqual(context.lastSpecRevision.agentId, 'gg');
    assert.strictEqual(context.lastSpecRevision.model, 'gemini-b');
    assert.strictEqual(context.authorAgentId, 'cc');
});

// REGRESSION: F584 — legacy authorAgentId + frontmatter agent resolve without migration.
test('resolveSpecAuthor falls back to authorAgentId and frontmatter agent', () => {
    const fromSnapshot = resolveSpecAuthor({ authorAgentId: 'cx', createdAt: '2026-01-01T00:00:00.000Z' }, null);
    assert.strictEqual(fromSnapshot.agentId, 'cx');
    assert.strictEqual(fromSnapshot.model, null);
    const fromFrontmatter = resolveSpecAuthor(null, 'op');
    assert.strictEqual(fromFrontmatter.agentId, 'op');
});

// REGRESSION: F584 — entity view exposes specAuthor for dashboard cards.
test('buildEntityView includes specAuthor from snapshot', () => withTempDir('aigon-entity-view-author-', (repo) => {
    seedEntityDirs(repo, 'features');
    const specPath = path.join(repo, 'docs/specs/features/02-backlog/feature-01-view.md');
    fs.writeFileSync(specPath, '# Feature: view\n');
    engine.ensureEntityBootstrappedSync(repo, 'feature', '01', 'backlog', specPath, {
        specAuthor: buildSpecAuthor({ agentId: 'cu', model: 'composer', effort: null }),
        authorAgentId: 'cu',
    });
    const view = buildEntityView(repo, 'feature', '01', { specPath });
    assert.strictEqual(view.specAuthor.agentId, 'cu');
    assert.strictEqual(view.specAuthor.model, 'composer');
}));

report();
