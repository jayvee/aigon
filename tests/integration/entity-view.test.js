#!/usr/bin/env node
'use strict';

// F517: integration coverage for the canonical buildEntityView read model.
// Exercises every entity type × every lifecycle stage, the spec facets, the
// session facet (via an injected AgentSessionService), and dependency blocking.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report, seedEntityDirs, writeSnap } = require('../_helpers');

const { buildEntityView } = require('../../lib/read-model/entity-view');

// A spec writer that includes frontmatter + acceptance-criteria checkboxes so
// the spec-derived facets (complexity, set, criteria) are exercised.
function writeRichSpec(repo, kind, stage, file, { complexity = 'medium', set = null, done = 0, total = 0 } = {}) {
    const lines = ['---', `complexity: ${complexity}`];
    if (set) lines.push(`set: ${set}`);
    lines.push('---', '', `# ${file}`, '', '## Acceptance Criteria', '');
    for (let i = 0; i < total; i++) lines.push(`- [${i < done ? 'x' : ' '}] criterion ${i}`);
    const full = path.join(repo, 'docs', 'specs', kind, stage, file);
    fs.writeFileSync(full, lines.join('\n') + '\n');
    return full;
}

// Stub AgentSessionService exposing only listSessions (the facet's sole call).
function stubSessionService(records) {
    return {
        listSessions(filter) {
            if (!filter || !filter.entity) return records;
            return records.filter(r =>
                r.entity
                && r.entity.type === filter.entity.type
                && r.entity.id === String(filter.entity.id));
        },
    };
}

// Feature lifecycle → expected coarse stage (mirrors LIFECYCLE_TO_STAGE).
const FEATURE_MATRIX = [
    { lifecycle: 'inbox', stage: 'inbox', folder: '01-inbox', closed: false },
    { lifecycle: 'backlog', stage: 'backlog', folder: '02-backlog', closed: false },
    { lifecycle: 'implementing', stage: 'in-progress', folder: '03-in-progress', closed: false },
    { lifecycle: 'evaluating', stage: 'in-evaluation', folder: '04-in-evaluation', closed: false },
    { lifecycle: 'done', stage: 'done', folder: '05-done', closed: true },
    { lifecycle: 'paused', stage: 'paused', folder: '06-paused', closed: false },
];

FEATURE_MATRIX.forEach(({ lifecycle, stage, folder, closed }, idx) => {
    test(`buildEntityView: feature lifecycle '${lifecycle}' → stage '${stage}', source engine`, () => withTempDir('aigon-ev-feat-', (repo) => {
        seedEntityDirs(repo, 'features');
        const id = String(60 + idx);
        writeRichSpec(repo, 'features', folder, `feature-${id}-x.md`, { complexity: 'high', total: 3, done: 1 });
        writeSnap(repo, 'features', id, lifecycle);

        const view = buildEntityView(repo, 'feature', id, { includeSessions: false, computeBlocked: false });
        assert.strictEqual(view.id, id);
        assert.strictEqual(view.type, 'feature');
        assert.strictEqual(view.lifecycle, lifecycle);
        assert.strictEqual(view.stage, stage, `stage for ${lifecycle}`);
        assert.strictEqual(view.source, 'engine');
        assert.strictEqual(view.closed, closed, `closed for ${lifecycle}`);
        assert.strictEqual(view.complexity, 'high');
        assert.deepStrictEqual(view.criteria, { total: 3, done: 1 });
        assert.strictEqual(view.name, `x`);
        assert.ok(view.snapshotPath && view.snapshotPath.endsWith(path.join('features', id, 'snapshot.json')));
    }));
});

test('buildEntityView: research lifecycle stages resolve and report type research', () => withTempDir('aigon-ev-research-', (repo) => {
    seedEntityDirs(repo, 'research-topics');
    writeRichSpec(repo, 'research-topics', '05-done', 'research-70-topic.md', { complexity: 'low' });
    // writeSnap keys the engine dir off `kind`; research snapshots live under
    // .aigon/workflows/research/<id>, so pass 'research' (not 'research-topics').
    writeSnap(repo, 'research', '70', 'done');

    const view = buildEntityView(repo, 'research', '70', { includeSessions: false, computeBlocked: false });
    assert.strictEqual(view.type, 'research');
    assert.strictEqual(view.lifecycle, 'done');
    assert.strictEqual(view.closed, true);
    assert.strictEqual(view.source, 'engine');
}));

test('buildEntityView: pre-engine entity (no snapshot) falls back to folder stage', () => withTempDir('aigon-ev-folder-', (repo) => {
    seedEntityDirs(repo, 'features');
    writeRichSpec(repo, 'features', '02-backlog', 'feature-80-pre.md', { complexity: 'medium', set: 'demo-set' });

    const view = buildEntityView(repo, 'feature', '80', {
        folderFallback: '02-backlog',
        includeSessions: false,
        computeBlocked: false,
    });
    assert.strictEqual(view.source, 'folder');
    assert.strictEqual(view.lifecycle, null);
    assert.strictEqual(view.stage, 'backlog');
    assert.strictEqual(view.set, 'demo-set');
}));

test('buildEntityView: session facet groups by role with live/primary projections', () => withTempDir('aigon-ev-sessions-', (repo) => {
    seedEntityDirs(repo, 'features');
    writeRichSpec(repo, 'features', '03-in-progress', 'feature-90-s.md', { complexity: 'high' });
    writeSnap(repo, 'features', '90', 'implementing');

    const sessions = [
        { sessionId: 's1', category: 'entity', entity: { type: 'feature', id: '90' }, role: 'do', agent: { id: 'cc' }, state: 'active', startedAt: '2026-04-01T10:00:00Z' },
        { sessionId: 's2', category: 'entity', entity: { type: 'feature', id: '90' }, role: 'do', agent: { id: 'cx' }, state: 'stopped', startedAt: '2026-04-01T09:00:00Z' },
        { sessionId: 's3', category: 'entity', entity: { type: 'feature', id: '90' }, role: 'review', agent: { id: 'gg' }, state: 'waiting', startedAt: '2026-04-01T11:00:00Z' },
        { sessionId: 'other', category: 'entity', entity: { type: 'feature', id: '91' }, role: 'do', agent: { id: 'cc' }, state: 'active' },
    ];
    const view = buildEntityView(repo, 'feature', '90', {
        sessionService: stubSessionService(sessions),
        computeBlocked: false,
    });
    // Only the entity's own sessions, live ones first.
    assert.strictEqual(view.sessions.live.length, 2, 'two live sessions (active + waiting)');
    assert.deepStrictEqual(Object.keys(view.sessions.byRole).sort(), ['do', 'review']);
    assert.strictEqual(view.sessions.byRole.do.length, 2);
    // Primary 'do' prefers the live (active) session over the stopped one.
    assert.strictEqual(view.sessions.primaryByRole.do.sessionId, 's1');
    assert.strictEqual(view.sessions.primaryByRole.do.agentId, 'cc');
}));

test('buildEntityView: blocked is true when a dependency is not engine-done', () => withTempDir('aigon-ev-blocked-', (repo) => {
    seedEntityDirs(repo, 'features');
    // Dependency 100 is implementing (not done).
    writeRichSpec(repo, 'features', '03-in-progress', 'feature-100-dep.md', { complexity: 'low' });
    writeSnap(repo, 'features', '100', 'implementing');
    // Dependent 101 depends on 100.
    const depPath = path.join(repo, 'docs', 'specs', 'features', '02-backlog', 'feature-101-dependent.md');
    fs.writeFileSync(depPath, '---\ncomplexity: low\ndepends_on: [100]\n---\n# dependent\n');

    const view = buildEntityView(repo, 'feature', '101', {
        specPath: depPath,
        folderFallback: '02-backlog',
        includeSessions: false,
    });
    assert.strictEqual(view.blocked, true);
    assert.strictEqual(view.blockedBy.length, 1);
    assert.strictEqual(view.blockedBy[0].id, '100');
    assert.strictEqual(view.blockedBy[0].stage, 'in-progress');
}));

test('buildEntityView: blocked is false once the dependency is engine-done', () => withTempDir('aigon-ev-unblocked-', (repo) => {
    seedEntityDirs(repo, 'features');
    writeRichSpec(repo, 'features', '05-done', 'feature-110-dep.md', { complexity: 'low' });
    writeSnap(repo, 'features', '110', 'done');
    const depPath = path.join(repo, 'docs', 'specs', 'features', '02-backlog', 'feature-111-dependent.md');
    fs.writeFileSync(depPath, '---\ncomplexity: low\ndepends_on: [110]\n---\n# dependent\n');

    const view = buildEntityView(repo, 'feature', '111', {
        specPath: depPath,
        folderFallback: '02-backlog',
        includeSessions: false,
    });
    assert.strictEqual(view.blocked, false);
    assert.deepStrictEqual(view.blockedBy, []);
}));

report();
