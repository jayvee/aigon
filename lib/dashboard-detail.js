'use strict';

const fs = require('fs');
const path = require('path');
const workflowReadModel = require('./workflow-read-model');
const workflowSnapshotAdapter = require('./workflow-snapshot-adapter');
const featureSpecResolver = require('./feature-spec-resolver');
const { collectFeatureDeepStatus } = require('./feature-status');
const {
    collectEntityAgentLogs,
    collectFeaturesForResearch,
    collectResearchFindings,
    getAgentDetailRecords,
    readEntityLogExcerpts,
} = require('./dashboard-status-collector');
const { buildFeatureIndex, buildDependencyGraphAsync, buildFeatureDependencySvg } = require('./feature-dependencies');
const { STAGE_FOLDERS } = require('./workflow-core/paths');
const { buildResearchTmuxSessionName, tmuxSessionExists } = require('./worktree');
const { normalizeDashboardStatus, safeTmuxSessionExists } = require('./dashboard-status-helpers');
const { parseFrontMatter } = require('./cli-parse');
const { formatLeaseHolderLabel } = require('./feature-status');
const {
    resolveSpecAuthor,
    resolveAuthorAgentId,
    normalizeLastSpecRevision,
    emptyLastSpecRevision,
} = require('./spec-author-provenance');

function safeStatMtimeMs(filePath) {
    try {
        return fs.statSync(filePath).mtimeMs;
    } catch (_) {
        return 0;
    }
}

function nowMs() {
    return Number(process.hrtime.bigint()) / 1e6;
}

function readFrontmatterAgent(specPath) {
    if (!specPath || !fs.existsSync(specPath)) return null;
    try {
        const content = fs.readFileSync(specPath, 'utf8');
        const { data } = parseFrontMatter(content);
        return data && data.agent != null ? String(data.agent).trim() || null : null;
    } catch (_) {
        return null;
    }
}

function buildProvenanceFields(snapshot, specPath) {
    const specAuthor = resolveSpecAuthor(snapshot, readFrontmatterAgent(specPath));
    const agentKeys = snapshot && snapshot.agents ? Object.keys(snapshot.agents) : [];
    return {
        specAuthor,
        authorAgentId: resolveAuthorAgentId(snapshot, specAuthor, agentKeys),
        lastSpecRevision: snapshot && snapshot.lastSpecRevision
            ? normalizeLastSpecRevision(snapshot.lastSpecRevision)
            : emptyLastSpecRevision(),
    };
}

// Stale-while-revalidate cache: reading all 700+ feature specs on every drawer open is ~3s.
// Cache is served immediately; a background rebuild fires when it expires.
const _depGraphCache = new Map(); // repoRoot -> { featureIndex, graph, builtAt }
const DEP_GRAPH_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// F454: Track in-flight rebuilds so concurrent _getDepGraphCached callers
// don't all kick off duplicate scans of ~700 spec files.
const _depGraphRebuildInFlight = new Map();

async function _rebuildDepGraphAsync(repoRoot, featurePaths) {
    if (_depGraphRebuildInFlight.has(repoRoot)) return;
    const job = (async () => {
        try {
            const { parseFrontMatter } = require('./cli-parse');
            const featureIndex = buildFeatureIndex(featurePaths);
            const graph = await buildDependencyGraphAsync(featurePaths, { parseFrontMatter }, featureIndex);
            _depGraphCache.set(repoRoot, { featureIndex, graph, builtAt: Date.now() });
        } catch (e) { /* ignore — next request will retry */ }
        finally { _depGraphRebuildInFlight.delete(repoRoot); }
    })();
    _depGraphRebuildInFlight.set(repoRoot, job);
}

function _getDepGraphCached(repoRoot, featurePaths) {
    const now = Date.now();
    const cached = _depGraphCache.get(repoRoot);
    if (cached && (now - cached.builtAt) < DEP_GRAPH_CACHE_TTL) return cached;
    // Stale or cold — trigger background rebuild and return what we have (may be null)
    _rebuildDepGraphAsync(repoRoot, featurePaths);
    return cached || null;
}

function _appendDependencyGraph(filePath, content) {
    // Only for feature specs
    const featureMatch = filePath.match(/\/docs\/specs\/features\/[^/]+\/feature-(\d+)-/);
    if (!featureMatch) return content;
    const featureId = featureMatch[1];

    const repoRoot = filePath.replace(/\/docs\/specs\/features\/.*$/, '');
    const featurePaths = {
        root: path.join(repoRoot, 'docs', 'specs', 'features'),
        folders: [STAGE_FOLDERS.INBOX, STAGE_FOLDERS.BACKLOG, STAGE_FOLDERS.IN_PROGRESS, STAGE_FOLDERS.IN_EVALUATION, STAGE_FOLDERS.DONE, STAGE_FOLDERS.PAUSED],
    };

    const cached = _getDepGraphCached(repoRoot, featurePaths);
    if (!cached) return content; // cache cold — skip dep graph, background build in flight

    try {
        const { featureIndex, graph } = cached;
        const isInGraph = graph.has(featureId) ||
            [...graph.values()].some(deps => deps.includes(featureId));
        if (!isInGraph) return content;

        const svg = buildFeatureDependencySvg(featureId, featureIndex, graph);
        if (svg) {
            return content + '\n## Dependency Graph\n\n' + svg + '\n';
        }
    } catch (e) {
        // Non-fatal — just return content without graph
    }
    return content;
}

function stripAnsi(str) {
    return str
        .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')     // CSI sequences (including DEC private mode ?2026h etc)
        .replace(/\x1b\][^\x07]*\x07/g, '')           // OSC sequences
        .replace(/\x1b[()][A-Z0-9]/g, '')              // charset sequences
        .replace(/\x1b[\x20-\x2f]*[\x40-\x7e]/g, '')  // other escapes
        .replace(/[\x00-\x08\x0b\x0e-\x1f\x7f]/g, '') // control chars (keep \t \n \r)
        .replace(/\n{3,}/g, '\n\n');                    // collapse 3+ blank lines to 2
}

function parseSimpleFrontMatter(content) {
    const m = content.match(/^---\n([\s\S]*?)\n---\n/);
    if (!m) return {};
    const result = {};
    m[1].split('\n').forEach(line => {
        const idx = line.indexOf(':');
        if (idx === -1) return;
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        result[key] = value;
    });
    return result;
}

function resolveDetailRepoPath(registeredRepos, options = {}) {
    const repos = Array.isArray(registeredRepos) ? registeredRepos.map(r => path.resolve(String(r))) : [];
    const explicit = String(options.repoPath || '').trim();
    const specPath = String(options.specPath || '').trim();
    const type = String(options.type || '').trim();
    const id = String(options.id || '').trim();

    if (explicit) {
        const abs = path.resolve(explicit);
        if (repos.length > 0 && !repos.includes(abs)) return null;
        return abs;
    }

    if (specPath) {
        const absSpec = path.resolve(specPath);
        const byPrefix = repos.find(repo => absSpec.startsWith(repo + path.sep));
        if (byPrefix) return byPrefix;
    }

    if (repos.length === 1) return repos[0];

    if (repos.length > 1 && id) {
        const matches = [];
        for (const repo of repos) {
            if (type === 'feature') {
                const snapshot = workflowSnapshotAdapter.readFeatureSnapshotSync(repo, id);
                const resolvedSpec = featureSpecResolver.resolveFeatureSpec(repo, id, { snapshot });
                if (snapshot || resolvedSpec.path) matches.push(repo);
                continue;
            }

            const hit = featureSpecResolver.repoHasVisibleEntitySpec(repo, type, id);
            if (hit) matches.push(repo);
        }
        return matches.length === 1 ? matches[0] : null;
    }

    return null;
}

function deriveCodeReviewParticipants(snapshot) {
    const participants = new Map();
    const addRole = (agentId, role, timestamp, status) => {
        const id = String(agentId || '').trim();
        if (!id) return;
        const existing = participants.get(id) || { id, roles: [], updatedAt: null, status: null };
        if (!existing.roles.includes(role)) existing.roles.push(role);
        if (timestamp && (!existing.updatedAt || String(timestamp) > String(existing.updatedAt))) {
            existing.updatedAt = timestamp;
        }
        if (status) existing.status = status;
        participants.set(id, existing);
    };

    const codeReview = snapshot && snapshot.codeReview ? snapshot.codeReview : null;
    if (codeReview) {
        addRole(
            codeReview.activeReviewerId || codeReview.reviewerId,
            'reviewer',
            codeReview.reviewCompletedAt || codeReview.reviewStartedAt || null,
            codeReview.reviewCompletedAt ? 'review-complete' : 'reviewing'
        );
        addRole(
            codeReview.revisionAgentId,
            'revision-agent',
            codeReview.revisionCompletedAt || codeReview.revisionStartedAt || null,
            codeReview.revisionCompletedAt ? 'revision-complete' : 'revising'
        );
    }
    addRole(snapshot && snapshot.pendingCodeReviewer, 'reviewer', snapshot && snapshot.updatedAt, 'review-pending');

    (Array.isArray(snapshot && snapshot.reviewCycles) ? snapshot.reviewCycles : [])
        .filter(cycle => cycle && cycle.type === 'code')
        .forEach(cycle => {
            addRole(
                cycle.reviewer,
                'reviewer',
                cycle.counterCompletedAt || cycle.completedAt || cycle.startedAt || null,
                'review-complete'
            );
        });

    return Array.from(participants.values())
        .map(participant => ({
            ...participant,
            role: participant.roles.includes('reviewer') ? 'reviewer' : participant.roles[0],
            status: participant.status || (participant.roles.includes('reviewer') ? 'reviewer' : 'participant'),
            source: 'codeReview',
        }))
        .sort((left, right) => left.id.localeCompare(right.id));
}

function decorateLeaseEvent(event, type) {
    if (!/^lease\.(acquired|renewed|released|taken_over)$/.test(type)) return null;
    const action = {
        'lease.acquired': 'Lease acquired',
        'lease.renewed': 'Lease renewed',
        'lease.released': 'Lease released',
        'lease.taken_over': 'Lease taken over',
    }[type];
    const role = event && event.leaseRole ? String(event.leaseRole) : 'work';
    const holder = formatLeaseHolderLabel(event || {});
    const summary = [`${role} lease`];
    if (event && event.expiresAt) summary.push(`expires ${event.expiresAt}`);
    if (event && event.ttlMs != null) summary.push(`ttl ${event.ttlMs}ms`);
    if (event && event.renewCount) summary.push(`renewal ${event.renewCount}`);
    if (event && event.priorHolderId) summary.push(`previous holder ${event.priorHolderId}`);
    return {
        ...event,
        displayLabel: action,
        displayActor: holder,
        message: summary.join(' · '),
    };
}

function decorateDetailEvent(event) {
    const type = event && event.type ? String(event.type) : '';
    const leaseEvent = decorateLeaseEvent(event, type);
    if (leaseEvent) return leaseEvent;
    const displayMap = {
        'feature.code_review.started': {
            label: 'Code review started',
            actor: event && (event.reviewerId || event.agentId),
        },
        'research.code_review.started': {
            label: 'Code review started',
            actor: event && (event.reviewerId || event.agentId),
        },
        'feature.code_review.completed': {
            label: 'Code review completed',
            actor: event && (event.reviewerId || event.agentId),
        },
        'research.code_review.completed': {
            label: 'Code review completed',
            actor: event && (event.reviewerId || event.agentId),
        },
        'feature.code_revision.started': {
            label: 'Code revision started',
            actor: event && (event.revisionAgentId || event.agentId),
        },
        'research.code_revision.started': {
            label: 'Code revision started',
            actor: event && (event.revisionAgentId || event.agentId),
        },
        'feature.code_revision.completed': {
            label: 'Code revision completed',
            actor: event && (event.revisionAgentId || event.agentId),
        },
        'research.code_revision.completed': {
            label: 'Code revision completed',
            actor: event && (event.revisionAgentId || event.agentId),
        },
        'feature.close_gate_failed': {
            label: event && event.gateKind === 'preauth-validation'
                ? 'Pre-auth validation failed'
                : 'Close gate failed',
            actor: 'system',
        },
        'feature.close_finding_advisory': {
            label: event && event.gateKind === 'preauth-validation'
                ? 'Pre-auth validation advisory'
                : (event && event.gateKind === 'review-escalation'
                    ? 'Review escalation advisory'
                    : 'Close gate advisory'),
            actor: 'system',
        },
        'feature.preauthorisations_used': {
            label: 'Pre-authorisations used',
            actor: 'system',
        },
        'feature.preauthorisation_validation_bypassed': {
            label: 'Pre-auth validation bypassed',
            actor: 'system',
        },
        'review.escalation_raised': {
            label: 'Review escalation raised',
            actor: event && event.reviewerAgentId,
        },
        'review.escalation_accepted': {
            label: 'Review escalation accepted',
            actor: 'operator',
        },
        'review.escalation_spun_off': {
            label: 'Review escalation spun off',
            actor: 'operator',
        },
        'review.escalation_reopened': {
            label: 'Review escalation reopened',
            actor: 'operator',
        },
    };
    const display = displayMap[type];
    if (!display) return event;
    const decorated = {
        ...event,
        displayLabel: display.label,
        displayActor: display.actor || event.actor || event.agent || event.agentId || 'system',
    };
    if (type === 'feature.preauthorisations_used' && Array.isArray(event.entries) && event.entries.length > 0) {
        decorated.message = event.entries
            .map((entry) => `${String(entry.sha || '').slice(0, 7)}: ${entry.slug}`)
            .join(', ');
    }
    if (type === 'feature.close_gate_failed' && event.gateKind === 'preauth-validation'
        && Array.isArray(event.unmatched) && event.unmatched.length > 0) {
        decorated.message = event.unmatched
            .map((item) => `${String(item.sha || '').slice(0, 7)}: ${item.slug}`)
            .join(', ');
    }
    if (type === 'review.escalation_raised' && event.reason) {
        decorated.message = `[${event.category}] ${event.reason}`;
    }
    if ((type === 'review.escalation_accepted' || type === 'review.escalation_reopened') && event.reason) {
        decorated.message = event.reason;
    }
    if (type === 'review.escalation_spun_off' && event.followUpFeatureId) {
        decorated.message = `Follow-up: ${event.followUpFeatureId}`;
    }
    return decorated;
}

function buildDetailPayload(repoPath, type, id, specPathHint, options = {}) {
    const absRepo = path.resolve(repoPath);
    const perfEnabled = process.env.AIGON_DASH_TIMING === '1';
    const perfStart = perfEnabled ? nowMs() : 0;
    const perfSteps = [];
    const markPerf = perfEnabled
        ? (step, startMs) => { perfSteps.push({ step, ms: Math.round((nowMs() - startMs) * 100) / 100 }); }
        : null;

    // Read engine snapshot for agent list.
    let t = perfEnabled ? nowMs() : 0;
    const snapshot = (type === 'feature' || type === 'research')
        ? workflowSnapshotAdapter.readWorkflowSnapshotSync(absRepo, type, id)
        : null;
    if (markPerf) markPerf('snapshot', t);
    const manifest = snapshot ? {
        agents: Object.keys(snapshot.agents || {}),
        createdAt: snapshot.createdAt || null,
        updatedAt: snapshot.updatedAt || null,
        authorAgentId: snapshot.authorAgentId || null,
        winnerAgentId: snapshot.winnerAgentId || null,
        lifecycle: snapshot.lifecycle || null,
    } : {};

    t = perfEnabled ? nowMs() : 0;
    const { agentFiles, rawAgentFiles } = getAgentDetailRecords(
        absRepo,
        type,
        id,
        snapshot && snapshot.agents ? Object.keys(snapshot.agents) : []
    );
    const implementationAgentIds = Object.keys(agentFiles || {});
    const codeReviewParticipants = (type === 'feature' || type === 'research')
        ? deriveCodeReviewParticipants(snapshot)
        : [];
    codeReviewParticipants.forEach(participant => {
        const existing = agentFiles[participant.id] || {};
        const roles = Array.from(new Set([
            ...(Array.isArray(existing.roles) ? existing.roles : (existing.role ? [existing.role] : [])),
            ...participant.roles,
        ].filter(Boolean)));
        agentFiles[participant.id] = {
            ...existing,
            agent: existing.agent || participant.id,
            status: existing.status || participant.status,
            updatedAt: existing.updatedAt || participant.updatedAt || (snapshot && snapshot.updatedAt) || null,
            role: roles.includes('reviewer') ? 'reviewer' : roles[0],
            roles,
            source: existing.source || participant.source,
            synthetic: Object.keys(existing).length === 0 ? true : existing.synthetic,
        };
        if (!rawAgentFiles[participant.id]) {
            rawAgentFiles[participant.id] = JSON.stringify(agentFiles[participant.id] || {}, null, 2);
        }
    });
    if (markPerf) markPerf('agent-status', t);
    const logExcerpts = {};
    t = perfEnabled ? nowMs() : 0;
    Object.entries(agentFiles).forEach(([agentId, parsed]) => {
        logExcerpts[agentId] = readEntityLogExcerpts(absRepo, type, id, agentId, {
            worktreePath: parsed && parsed.worktreePath ? parsed.worktreePath : null,
            allowAgentlessFallback: type === 'feature' && implementationAgentIds.length === 1,
        });
    });
    if (markPerf) markPerf('log-excerpts', t);

    t = perfEnabled ? nowMs() : 0;
    const resolvedSpec = type === 'research'
        ? featureSpecResolver.resolveResearchSpec(absRepo, id, { snapshot })
        : featureSpecResolver.resolveFeatureSpec(absRepo, id, { snapshot });
    if (markPerf) markPerf('resolve-spec', t);
    let resolvedSpecPath = String(specPathHint || '').trim();
    if (!resolvedSpecPath && resolvedSpec && resolvedSpec.path) resolvedSpecPath = resolvedSpec.path;
    if (specPathHint && resolvedSpec && resolvedSpec.path && path.resolve(specPathHint) !== path.resolve(resolvedSpec.path)) {
        const err = new Error(`Spec path does not match ${type} ${id}`);
        err.statusCode = 400;
        throw err;
    }
    Object.assign(manifest, buildProvenanceFields(snapshot, resolvedSpecPath));

    const evalPath = type === 'feature'
        ? path.join(absRepo, 'docs', 'specs', 'features', 'evaluations', `feature-${id}-eval.md`)
        : null;
    t = perfEnabled ? nowMs() : 0;
    const rawWorkflowEvents = (type === 'feature' || type === 'research')
        ? workflowSnapshotAdapter.readWorkflowEventsSync(absRepo, type, id)
        : [];
    const workflowEvents = (type === 'feature' || type === 'research')
        ? workflowSnapshotAdapter.filterAgentSignalEvents(rawWorkflowEvents)
        : [];
    const startupReadiness = (type === 'feature' || type === 'research')
        ? workflowSnapshotAdapter.computeStartupReadiness(rawWorkflowEvents, snapshot)
        : null;
    if (markPerf) markPerf('workflow-events', t);
    let detailEvents = workflowEvents;

    if (type === 'feature') {
        const stage = snapshot
            ? (workflowSnapshotAdapter.snapshotToStage(snapshot) || (resolvedSpec && resolvedSpec.stage) || 'inbox')
            : ((resolvedSpec && resolvedSpec.stage)
                || (resolvedSpecPath.includes(`/${STAGE_FOLDERS.IN_EVALUATION}/`) ? 'in-evaluation'
                    : resolvedSpecPath.includes(`/${STAGE_FOLDERS.IN_PROGRESS}/`) ? 'in-progress'
                    : resolvedSpecPath.includes(`/${STAGE_FOLDERS.BACKLOG}/`) ? 'backlog'
                    : resolvedSpecPath.includes(`/${STAGE_FOLDERS.PAUSED}/`) ? 'paused'
                    : resolvedSpecPath.includes(`/${STAGE_FOLDERS.DONE}/`) ? 'done'
                    : 'inbox'));
        const featureAgents = Object.entries(agentFiles).map(([agentId, file]) => {
            const tmuxInfo = safeTmuxSessionExists(id, agentId) || { sessionName: null, running: false };
            return {
                id: agentId,
                status: normalizeDashboardStatus(file.status),
                updatedAt: file.updatedAt || null,
                tmuxSession: tmuxInfo.sessionName,
                tmuxRunning: tmuxInfo.running,
            };
        });
        t = perfEnabled ? nowMs() : 0;
        const featureState = workflowReadModel.getFeatureDashboardState(absRepo, id, stage, featureAgents);
        if (markPerf) markPerf('feature-read-model', t);
        manifest.stage = stage;
        manifest.name = resolvedSpec && resolvedSpec.slug ? resolvedSpec.slug : null;
        manifest.currentSpecState = snapshot ? (snapshot.currentSpecState || snapshot.lifecycle || null) : null;
        manifest.startupReadiness = startupReadiness;
        manifest.detailFingerprint = [
            manifest.updatedAt || '',
            resolvedSpecPath ? safeStatMtimeMs(resolvedSpecPath) : '',
            (workflowEvents || []).length,
            JSON.stringify(startupReadiness || {}),
            JSON.stringify(featureState.reviewSessions || []),
        ].join('|');
        manifest.reviewSessions = featureState.reviewSessions || [];
        manifest.autonomousPlan = featureState.autonomousPlan || null;
        const runtimeEvents = [];
        if (featureState.reviewState) {
            manifest.review = featureState.reviewState;
        }

        const currentReview = featureState.reviewState && featureState.reviewState.current;
        if (currentReview) {
            runtimeEvents.push({
                type: 'review.running',
                agentId: currentReview.agent,
                at: currentReview.startedAt || new Date().toISOString(),
            });
        }
        (featureState.reviewState && featureState.reviewState.history || []).forEach(entry => {
            runtimeEvents.push({
                type: 'review.completed',
                agentId: entry.agent,
                at: entry.completedAt || entry.startedAt || new Date().toISOString(),
            });
        });

        if (featureState.evalSession) {
            runtimeEvents.push({
                type: featureState.evalSession.running ? 'eval.running' : 'eval.completed',
                agentId: featureState.evalSession.agent || 'system',
                at: new Date().toISOString(),
            });
        }

        if (featureState.winnerAgent) {
            runtimeEvents.push({
                type: 'winner.selected',
                agentId: featureState.winnerAgent,
                at: (() => {
                    try {
                        return featureState.evalPath ? fs.statSync(featureState.evalPath).mtime.toISOString() : new Date().toISOString();
                    } catch (_) {
                        return new Date().toISOString();
                    }
                })(),
            });
        }

        detailEvents = [...workflowEvents, ...runtimeEvents]
            .sort((left, right) => String(left.at || '').localeCompare(String(right.at || '')));
    }

    // Collect full agent log markdown for the Agent Log drawer tab.
    // Features: implementation log files. Research: per-agent findings files.
    let agentLogs = {};
    if (type === 'feature') {
        try {
            agentLogs = collectEntityAgentLogs(absRepo, id, agentFiles, resolvedSpecPath);
        } catch (_) {
            agentLogs = {};
        }
    } else if (type === 'research') {
        try {
            agentLogs = collectResearchFindings(absRepo, id);
        } catch (_) {
            agentLogs = {};
        }
        const stage = snapshot
            ? (workflowSnapshotAdapter.snapshotToStage(snapshot) || (resolvedSpec && resolvedSpec.stage) || 'inbox')
            : ((resolvedSpec && resolvedSpec.stage) || 'inbox');
        const researchAgents = Object.entries(agentFiles).map(([agentId, file]) => {
            const sessionName = buildResearchTmuxSessionName(id, agentId);
            const running = tmuxSessionExists(sessionName);
            return {
                id: agentId,
                status: normalizeDashboardStatus(file.status),
                updatedAt: file.updatedAt || null,
                tmuxSession: running ? sessionName : null,
                tmuxRunning: running,
            };
        });
        t = perfEnabled ? nowMs() : 0;
        const researchState = workflowReadModel.getResearchDashboardState(absRepo, id, stage, researchAgents);
        if (markPerf) markPerf('research-read-model', t);
        manifest.stage = stage;
        manifest.name = resolvedSpec && resolvedSpec.slug ? resolvedSpec.slug : null;
        manifest.currentSpecState = snapshot ? (snapshot.currentSpecState || snapshot.lifecycle || null) : null;
        manifest.startupReadiness = startupReadiness;
        manifest.detailFingerprint = [
            manifest.updatedAt || '',
            resolvedSpecPath ? safeStatMtimeMs(resolvedSpecPath) : '',
            (workflowEvents || []).length,
            JSON.stringify(startupReadiness || {}),
            JSON.stringify(researchState.reviewSessions || []),
        ].join('|');
        manifest.reviewSessions = researchState.reviewSessions || [];
        manifest.autonomousPlan = null;
    }

    let relatedFeatures = [];
    if (type === 'research') {
        t = perfEnabled ? nowMs() : 0;
        try {
            relatedFeatures = collectFeaturesForResearch(absRepo, id);
        } catch (_) {
            relatedFeatures = [];
        }
        if (markPerf) markPerf('related-features', t);
    }

    detailEvents = (Array.isArray(detailEvents) ? detailEvents : []).map(decorateDetailEvent);

    if (markPerf) {
        const detailPerf = {
            entityType: type,
            entityId: String(id),
            repoPath: absRepo,
            totalMs: Math.round((nowMs() - perfStart) * 100) / 100,
            steps: perfSteps,
            agentCount: Object.keys(agentFiles || {}).length,
            workflowEventCount: (workflowEvents || []).length,
        };
        if (typeof options.onPerf === 'function') {
            try { options.onPerf(detailPerf); } catch (_) { /* non-fatal */ }
        }
    }

    return {
        id: String(id),
        type,
        repoPath: absRepo,
        name: manifest.name || null,
        stage: manifest.stage || null,
        currentSpecState: manifest.currentSpecState || null,
        updatedAt: manifest.updatedAt || null,
        authorAgentId: manifest.authorAgentId || null,
        specAuthor: manifest.specAuthor || null,
        lastSpecRevision: manifest.lastSpecRevision || null,
        detailFingerprint: manifest.detailFingerprint || null,
        reviewSessions: manifest.reviewSessions || [],
        autonomousPlan: manifest.autonomousPlan || null,
        startupReadiness,
        manifest,
        rawManifest: snapshot ? JSON.stringify(snapshot, null, 2) : JSON.stringify({}, null, 2),
        events: detailEvents,
        workflowEvents,
        participantAgents: codeReviewParticipants,
        agentFiles,
        rawAgentFiles,
        logExcerpts,
        agentLogs,
        relatedFeatures,
        evalPath: evalPath && fs.existsSync(evalPath) ? evalPath : null,
        specPath: resolvedSpecPath || null,
        criteriaAttestation: [],
        openEscalations: snapshot && Array.isArray(snapshot.openEscalations) ? snapshot.openEscalations : [],
    };
}

// inferDashboardNextCommand and inferDashboardNextActions removed —
// actions now come exclusively from workflow-core engine snapshots via
// workflowReadModel.getFeatureDashboardState().

// F521: every setting carries a scope tag.
//   'user'   — global only. Project overrides are ignored. No per-repo column.
//   'shared' — global default with optional per-repo override (legacy default).
//   'repo'   — per-repo only; no meaningful global default (usually auto-detected).
// The user-scope list is also authoritative in lib/config.js (USER_SCOPE_KEYS);
// the schema-scope test asserts the two stay in sync.

module.exports = {
    parseSimpleFrontMatter,
    resolveDetailRepoPath,
    decorateDetailEvent,
    buildDetailPayload,
    appendDependencyGraph: _appendDependencyGraph,
};
