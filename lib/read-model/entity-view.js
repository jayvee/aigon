'use strict';

/**
 * Canonical single-entity read model (F517).
 *
 * `buildEntityView(repoPath, entityType, id, options)` answers the question
 * "what is the state of feature/research N?" in ONE place. Before F517 this
 * was re-derived across five modules (`dashboard-status-collector.js`,
 * `workflow-read-model.js`, `workflow-snapshot-adapter.js`, `feature-status.js`,
 * `dashboard-status-helpers.js`), each computing overlapping facets — closed?,
 * blocked?, agent rows, stage label, engine-vs-folder precedence. That
 * fragmentation is the direct cause of the producer/consumer drift incidents
 * documented in CLAUDE.md (F294, F397). This module is the join point;
 * consumers project from it instead of re-deriving.
 *
 * Boundaries (enforced by the F517 spec acceptance criteria):
 *   - This is a read-model / application view, NOT workflow-core. It lives
 *     outside `lib/workflow-core/` and consumes workflow-core only through its
 *     public read APIs (`require('../workflow-core')`) and the designated
 *     low-level snapshot reader (`workflow-snapshot-adapter.js`). It never
 *     reaches into `workflow-core/engine`, `workflow-core/paths`, or
 *     `workflow-core/entity-lifecycle` internals.
 *   - Session/runtime observations come exclusively through the F554
 *     `lib/agent-sessions` boundary (`createAgentSessionService`). This module
 *     never parses tmux session names, runs tmux, or reads `.aigon/sessions/*`
 *     directly.
 *   - Dashboard-specific DTO shaping (button labels, attach commands, card
 *     headlines, liveness probes) stays OUT of this module. `EntityView` is
 *     reusable by the CLI, set-conductor, board, and dashboard alike.
 *
 * @typedef {Object} EntitySessionFacet
 * @property {Array<NormalizedSession>} live   Sessions in a live-ish state
 *   (active / waiting / starting), most-recent first.
 * @property {Object<string, NormalizedSession[]>} byRole   All sessions for the
 *   entity grouped by role.
 * @property {Object<string, NormalizedSession>} primaryByRole   The primary
 *   (preferably-live, else newest) session per role.
 *
 * @typedef {Object} NormalizedSession
 * @property {string} sessionId
 * @property {string|null} role
 * @property {string|null} agentId
 * @property {string} state
 * @property {string|null} host
 * @property {string|null} startedAt
 * @property {string} category
 *
 * @typedef {Object} EntityView
 * @property {string} id            Padded/numeric entity id as supplied.
 * @property {'feature'|'research'} type
 * @property {string|null} lifecycle  Engine lifecycle (`snapshot.lifecycle`).
 * @property {string} stage         Coarse stage label (inbox/backlog/in-progress/
 *   in-evaluation/done/paused/unknown).
 * @property {boolean} closed       Engine-first done check (F397 `isEntityDone`).
 * @property {boolean} blocked      True when `blockedBy.length > 0`.
 * @property {Array<{id:string,name:string,stage:string}>} blockedBy  Unmet deps.
 * @property {Array<{id:string,status:string}>} agentRows  Minimal reusable agent
 *   projection from the snapshot (NOT the dashboard agent DTO).
 * @property {EntitySessionFacet} sessions
 * @property {string|null} specPath   Absolute spec path, or null.
 * @property {string|null} snapshotPath  Absolute snapshot path.
 * @property {string|null} complexity  Spec `complexity:` frontmatter.
 * @property {string|null} set         Spec `set:` frontmatter.
 * @property {{agentId:string|null,model:string|null,effort:string|null,authoredAt:string|null}} specAuthor
 * @property {{agentId:string|null,model:string|null,effort:string|null,revisedAt:string|null,commitSha:string|null}} lastSpecRevision
 * @property {{total:number,done:number}} criteria  Acceptance-criteria tally.
 * @property {string} name          Human-ish name (slug with dashes → spaces).
 * @property {'engine'|'folder'} source  Where lifecycle/stage came from.
 */

const fs = require('fs');
const path = require('path');

const workflowCore = require('../workflow-core');
const workflowSnapshotAdapter = require('../workflow-snapshot-adapter');
const featureSpecResolver = require('../feature-spec-resolver');
const agentSessions = require('../agent-sessions');
const { parseFrontMatter } = require('../cli-parse');
const {
    resolveSpecAuthor,
    normalizeLastSpecRevision,
    emptyLastSpecRevision,
} = require('../spec-author-provenance');
const { formatDisplayKey } = require('../spec-identity');

const LIVE_SESSION_STATES = new Set([
    agentSessions.SESSION_STATES.ACTIVE,
    agentSessions.SESSION_STATES.WAITING,
    agentSessions.SESSION_STATES.STARTING,
    agentSessions.SESSION_STATES.REQUESTED,
]);

function stageFromFolder(folder) {
    if (!folder) return 'unknown';
    // Accept either a stage folder ('03-in-progress') or a bare stage label.
    return String(folder).replace(/^\d+-/, '');
}

/**
 * Read a spec file once and extract every spec-derived facet the view needs:
 * complexity, set, name, and the acceptance-criteria tally. Honours the
 * "one spec read per call" acceptance criterion.
 */
function readSpecFacets(specPath) {
    const facets = { complexity: null, set: null, agent: null, name: null, criteria: { total: 0, done: 0 } };
    if (!specPath || !fs.existsSync(specPath)) return facets;
    let content;
    try {
        content = fs.readFileSync(specPath, 'utf8');
    } catch (_) {
        return facets;
    }
    try {
        const { data } = parseFrontMatter(content);
        if (data) {
            if (data.complexity != null) facets.complexity = String(data.complexity);
            if (data.set != null) facets.set = String(data.set);
            if (data.agent != null) facets.agent = String(data.agent).trim() || null;
        }
    } catch (_) { /* frontmatter optional */ }

    const unchecked = (content.match(/- \[ \]/g) || []).length;
    const checked = (content.match(/- \[x\]/gi) || []).length;
    facets.criteria = { total: unchecked + checked, done: checked };

    // Slug form (dashes kept) — the established name convention across the
    // dashboard (parseFeatureSpecFileName) and CLI feature-status.
    const base = path.basename(specPath, '.md');
    facets.name = base.replace(/^(feature|research)-\d+-/, '') || base;
    return facets;
}

function normalizeSession(record) {
    return {
        sessionId: record.sessionId || record.sessionName || null,
        role: record.role != null ? record.role : null,
        agentId: record.agent && record.agent.id ? record.agent.id : null,
        state: record.state || agentSessions.SESSION_STATES.UNKNOWN,
        host: record.host && record.host.kind ? record.host.kind : null,
        startedAt: record.startedAt || record.createdAt || null,
        category: record.category || agentSessions.SESSION_CATEGORIES.ENTITY,
    };
}

function sortByStartedDesc(a, b) {
    const ta = a.startedAt ? Date.parse(a.startedAt) : 0;
    const tb = b.startedAt ? Date.parse(b.startedAt) : 0;
    return tb - ta;
}

/**
 * Build the reusable session facet from the F554 AgentSessionService. Uses
 * `listSessions` (a pure sidecar-store read) so this stays a cheap read with
 * NO tmux invocation, satisfying the "one session enumeration per call" rule.
 */
function buildSessionFacet(sessionService, entityType, id) {
    const facet = { live: [], byRole: {}, primaryByRole: {} };
    let records;
    try {
        records = sessionService.listSessions({ entity: { type: entityType, id: String(id) } });
    } catch (_) {
        return facet;
    }
    const normalized = (Array.isArray(records) ? records : []).map(normalizeSession).sort(sortByStartedDesc);
    facet.live = normalized.filter(s => LIVE_SESSION_STATES.has(s.state));
    for (const session of normalized) {
        const role = session.role || 'unknown';
        if (!facet.byRole[role]) facet.byRole[role] = [];
        facet.byRole[role].push(session);
    }
    for (const [role, sessions] of Object.entries(facet.byRole)) {
        facet.primaryByRole[role] = sessions.find(s => LIVE_SESSION_STATES.has(s.state)) || sessions[0];
    }
    return facet;
}

function buildAgentRows(snapshot) {
    const statuses = workflowSnapshotAdapter.snapshotAgentStatuses(snapshot) || {};
    return Object.keys(statuses).map(agentId => ({ id: agentId, status: statuses[agentId] }));
}

/**
 * Compose the canonical view for a single entity.
 *
 * @param {string} repoPath  Absolute repo root.
 * @param {'feature'|'research'} entityType
 * @param {string} id  Entity id (numeric, padded or unpadded).
 * @param {Object} [options]
 * @param {Object} [options.snapshot]  Pre-read snapshot (skips the snapshot read).
 * @param {Object} [options.sessionService]  Injected AgentSessionService (tests).
 * @param {string} [options.folderFallback]  Stage/folder used when no engine
 *   snapshot exists (pre-start / pre-engine legacy).
 * @param {string} [options.specPath]  Pre-resolved spec path (skips the resolver
 *   read; the caller already knows the file — e.g. the dashboard collector).
 * @param {boolean} [options.includeSessions=true]  Set false on hot paths that
 *   do not need the session facet, to skip the session enumeration entirely.
 * @param {Object} [options.specIndex]  Optional spec index passed to the resolver.
 * @param {boolean} [options.computeBlocked=true]  Whether to resolve unmet deps
 *   (features only). Set false to break recursion when called *by* the
 *   dependency checker.
 * @param {Object} [options.featurePaths]  Paths object for the dependency checker.
 * @param {Function} [options.dependencyChecker]  Override for checkUnmetDependencies.
 * @returns {EntityView}
 */
function buildEntityView(repoPath, entityType, id, options = {}) {
    const absRepo = path.resolve(repoPath);
    const type = entityType === 'research' ? 'research' : 'feature';
    const entityId = String(id);

    // --- ONE snapshot read -------------------------------------------------
    const snapshot = options.snapshot !== undefined
        ? options.snapshot
        : workflowSnapshotAdapter.readWorkflowSnapshotSync(absRepo, type, entityId);
    const source = snapshot ? 'engine' : 'folder';
    const lifecycle = snapshot ? (snapshot.lifecycle || null) : null;
    const stage = snapshot
        ? (workflowSnapshotAdapter.snapshotToStage(snapshot) || 'unknown')
        : stageFromFolder(options.folderFallback);

    // Engine-first done check (F397). Reuse the snapshot already read above so
    // this view keeps the "one snapshot read per call" contract. Folder is
    // consulted only when no snapshot exists.
    const closed = snapshot
        ? String(snapshot.currentSpecState || snapshot.lifecycle || '').toLowerCase() === 'done'
        : workflowCore.isEntityDone(absRepo, type, entityId, options.folderFallback || null);

    // --- ONE spec read -----------------------------------------------------
    let specPath = options.specPath || null;
    if (!specPath) {
        try {
            const resolved = type === 'research'
                ? featureSpecResolver.resolveResearchSpec(absRepo, entityId, { snapshot, specIndex: options.specIndex })
                : featureSpecResolver.resolveFeatureSpec(absRepo, entityId, { snapshot, specIndex: options.specIndex });
            specPath = resolved ? resolved.path : null;
        } catch (_) {
            specPath = snapshot ? (snapshot.specPath || null) : null;
        }
    }
    const specFacets = readSpecFacets(specPath);
    const specAuthor = resolveSpecAuthor(snapshot, specFacets.agent);
    const lastSpecRevision = snapshot && snapshot.lastSpecRevision
        ? normalizeLastSpecRevision(snapshot.lastSpecRevision)
        : emptyLastSpecRevision();

    // --- ONE session enumeration (skippable on hot paths) ------------------
    let sessions = { live: [], byRole: {}, primaryByRole: {} };
    if (options.includeSessions !== false) {
        const sessionService = options.sessionService
            || agentSessions.createAgentSessionService({ repoPath: absRepo });
        sessions = buildSessionFacet(sessionService, type, entityId);
    }

    // --- Dependency / blocked (features only) ------------------------------
    let blockedBy = [];
    if (type === 'feature' && options.computeBlocked !== false && specPath) {
        const checker = options.dependencyChecker
            || require('../feature-dependencies').checkUnmetDependencies;
        const featurePaths = options.featurePaths || {
            root: path.join(absRepo, 'docs', 'specs', 'features'),
            folders: [
                workflowCore.STAGE_FOLDERS.INBOX,
                workflowCore.STAGE_FOLDERS.BACKLOG,
                workflowCore.STAGE_FOLDERS.IN_PROGRESS,
                workflowCore.STAGE_FOLDERS.IN_EVALUATION,
                workflowCore.STAGE_FOLDERS.DONE,
                workflowCore.STAGE_FOLDERS.PAUSED,
            ],
            repoPath: absRepo,
        };
        try {
            const unmet = checker(specPath, featurePaths) || [];
            blockedBy = unmet.map(d => ({
                id: d.id,
                name: d.slug ? String(d.slug).replace(/-/g, ' ') : String(d.id),
                stage: d.stage,
            }));
        } catch (_) { blockedBy = []; }
    }

    let snapshotPath = null;
    try {
        snapshotPath = workflowCore.getSnapshotPathForEntity(absRepo, type, entityId);
    } catch (_) { snapshotPath = null; }

    return {
        id: entityId,
        displayKey: /^\d+$/.test(entityId)
            ? formatDisplayKey({ kind: type, number: parseInt(entityId, 10) })
            : null,
        type,
        lifecycle,
        stage,
        closed,
        blocked: blockedBy.length > 0,
        blockedBy,
        agentRows: buildAgentRows(snapshot),
        sessions,
        specPath,
        snapshotPath,
        complexity: specFacets.complexity,
        set: specFacets.set,
        specAuthor,
        lastSpecRevision,
        criteria: specFacets.criteria,
        name: specFacets.name || `${type}-${entityId}`,
        source,
    };
}

module.exports = {
    buildEntityView,
    // Exported for unit tests and reuse.
    readSpecFacets,
    normalizeSession,
    buildSessionFacet,
};
