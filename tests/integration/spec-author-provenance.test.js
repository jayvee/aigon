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
const entityContext = require('../../lib/entity-context');
const { resolveContinuityPolicy } = require('../../lib/session-continuity-policy');

// REGRESSION: F684 — creation authorship must follow flag > env > active-session precedence without guessing.
test('resolveCreationAuthor uses deterministic precedence and leaves unknown shells authorless', () => {
    const detect = () => ({ detected: true, agentId: 'cu' });
    assert.strictEqual(entityContext.resolveCreationAuthor({ agent: 'cc' }, { AIGON_AGENT_ID: 'cx' }, detect), 'cc');
    assert.strictEqual(entityContext.resolveCreationAuthor({}, { AIGON_AGENT_ID: 'cx' }, detect), 'cx');
    assert.strictEqual(entityContext.resolveCreationAuthor({}, {}, detect), 'cu');
    assert.strictEqual(entityContext.resolveCreationAuthor({}, {}, () => ({ detected: true, agentId: 'not-an-agent' })), null);
});

// REGRESSION: F684 — invalid replacement handoffs must never overwrite the previous valid artifact.
test('author handoff validation is atomic and public context redacts native identifiers', () => withTempDir('aigon-author-handoff-', (repo) => {
    entityContext.establishOriginSession(repo, 'feature', '7', { authorAgentId: 'cx', aigonLaunched: true });
    entityContext.bindOriginNativeSession(repo, 'feature', '7', { sessionId: 'provider-secret', sessionPath: '/private/transcript' });
    const valid = {
        decisions: ['Use the existing workflow engine'], constraints: ['No transcript storage'], nonGoals: [],
        unresolvedQuestions: ['Confirm launch health'], implementationNotes: [], specReferences: ['Technical Approach'],
    };
    const first = entityContext.recordAuthorHandoff(repo, 'feature', '7', valid, { recordedBy: 'cx' });
    assert.strictEqual(first.artifactVersion, 1);
    assert.throws(() => entityContext.recordAuthorHandoff(repo, 'feature', '7', { decisions: [] }), /repair:/);
    const publicValue = entityContext.readPublicEntityContext(repo, 'feature', '7');
    assert.strictEqual(publicValue.authorHandoff.artifactVersion, 1);
    assert.strictEqual(publicValue.originSession.hasNativeSession, true);
    assert.strictEqual(JSON.stringify(publicValue).includes('provider-secret'), false);
    assert.strictEqual(JSON.stringify(publicValue).includes('/private/'), false);
    const durableRaw = fs.readFileSync(entityContext.entityContextPath(repo, 'feature', '7'), 'utf8');
    assert.strictEqual(durableRaw.includes('provider-secret'), false);
    assert.strictEqual(fs.readFileSync(entityContext.operationalEntityContextPath(repo, 'feature', '7'), 'utf8').includes('provider-secret'), true);
}));

// REGRESSION: F684 — direct sessions are never attachable and unsupported adapters deterministically fall back.
test('continuity policy selects resume only for attributed author sessions with verified task delivery', () => {
    const handoff = {
        status: 'valid', decisions: ['Keep current paths'], specReferences: ['Technical Approach'],
        unresolvedQuestions: ['implementation choice'],
    };
    const origin = {
        aigonSessionId: 'spec-draft-feature-07', source: 'direct-agent-session', authorAgentId: 'cx',
        providerSessionId: 'native-id', nativeProvenance: 'attributed', addressable: false,
    };
    const resume = resolveContinuityPolicy({
        phase: 'spec-revise', selectedAgent: 'cx', authorAgentId: 'cx', originSession: origin, authorHandoff: handoff,
        liveOriginSession: true, adapter: { continuity: { resumeById: true, taskDelivery: 'initial-argument' } },
    });
    assert.strictEqual(resume.strategy, 'resume-origin');
    assert.ok(resume.reasons.includes('adapter-resume-and-task-delivery-verified'));
    const refused = resolveContinuityPolicy({
        phase: 'spec-revise', selectedAgent: 'cx', authorAgentId: 'cx', originSession: origin, authorHandoff: handoff,
        adapter: { continuity: { resumeById: true, taskDelivery: 'unverified' } },
    });
    assert.strictEqual(refused.strategy, 'fresh-with-handoff');
    assert.ok(refused.reasons.includes('adapter-resume-unsupported'));
    const stale = resolveContinuityPolicy({
        phase: 'spec-revise', selectedAgent: 'cx', authorAgentId: 'cx',
        originSession: { ...origin, capturedAt: '2025-01-01T00:00:00.000Z' }, authorHandoff: handoff,
        now: new Date('2026-07-18T00:00:00.000Z'),
        adapter: { continuity: { resumeById: true, taskDelivery: 'initial-argument' } },
    });
    assert.strictEqual(stale.strategy, 'fresh-with-handoff');
    assert.ok(stale.reasons.includes('origin-capture-stale'));
});

// REGRESSION: F684 — a fallback checkpoint records exactly one fresh recovery decision.
test('continuation fallback checkpoint is idempotent and traceable', () => withTempDir('aigon-continuation-checkpoint-', (repo) => {
    entityContext.recordContinuityDecision(repo, 'feature', '7', {
        strategy: 'resume-origin', selectedAgent: 'cx', currentSessionId: 'continuation-1', reasons: ['phase-prefers-author'],
    });
    const checkpoint = { state: 'fallback', aigonSessionId: 'continuation-1', reason: 'context-conflict', agentId: 'cx' };
    entityContext.recordContinuityCheckpoint(repo, 'feature', '7', checkpoint);
    entityContext.recordContinuityCheckpoint(repo, 'feature', '7', checkpoint);
    const decisions = entityContext.readEntityContext(repo, 'feature', '7').continuityDecisions;
    assert.strictEqual(decisions.filter(item => item.recoveryOfSessionId === 'continuation-1').length, 1);
    assert.strictEqual(decisions[0].checkpoint.state, 'fallback');
    assert.strictEqual(decisions[1].strategy, 'fresh-with-handoff');
}));

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
