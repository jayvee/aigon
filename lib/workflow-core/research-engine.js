'use strict';

const fsSync = require('fs');
const path = require('path');
const { projectContext } = require('./projector');
const { deriveAvailableActions } = require('./actions');
const {
  getEventsPathForEntity,
  getSnapshotPathForEntity,
  getLockPathForEntity,
  getSpecPathForEntity,
} = require('./paths');

function now() {
  return new Date().toISOString();
}

function snapshotFromContext(context, eventCount) {
  return {
    researchId: context.featureId,
    entityType: 'research',
    lifecycle: context.currentSpecState,
    mode: context.mode,
    agents: context.agents,
    currentSpecState: context.currentSpecState,
    specPath: context.specPath,
    effects: context.effects,
    lastEffectError: context.lastEffectError,
    availableActions: deriveAvailableActions(context, 'research'),
    eventCount,
    createdAt: context.createdAt,
    updatedAt: context.updatedAt,
  };
}

function computeSpecPath(repoPath, researchId, lifecycle) {
  return getSpecPathForEntity(repoPath, 'research', researchId, lifecycle);
}

function requireContext(context, researchId) {
  if (context === null) {
    throw new Error(`Research ${researchId} does not exist`);
  }
  return context;
}

// --- Sync file helpers ---

function readEventsSync(eventsPath) {
  try {
    const content = fsSync.readFileSync(eventsPath, 'utf8');
    return content.split('\n').filter(Boolean).map(line => JSON.parse(line));
  } catch (_) {
    return [];
  }
}

function appendEventsSync(eventsPath, events) {
  fsSync.mkdirSync(path.dirname(eventsPath), { recursive: true });
  for (const event of events) {
    fsSync.appendFileSync(eventsPath, `${JSON.stringify(event)}\n`, 'utf8');
  }
}

function writeSnapshotSync(snapshotPath, snapshot) {
  fsSync.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fsSync.writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

function moveSpecProjectionSync(fromPath, toPath) {
  if (!fromPath || !toPath || fromPath === toPath) return;
  fsSync.mkdirSync(path.dirname(toPath), { recursive: true });
  if (fsSync.existsSync(toPath)) return;
  if (fsSync.existsSync(fromPath)) {
    fsSync.renameSync(fromPath, toPath);
  }
}

function withLockSync(lockPath, work) {
  fsSync.mkdirSync(path.dirname(lockPath), { recursive: true });
  const fd = fsSync.openSync(lockPath, 'wx');
  try {
    return work();
  } finally {
    fsSync.closeSync(fd);
    try { fsSync.rmSync(lockPath, { force: true }); } catch (_) { /* ignore */ }
  }
}

// --- Core engine operations ---

function materialize(repoPath, researchId, events) {
  const context = requireContext(projectContext(events), researchId);
  const materialized = {
    ...context,
    entityType: 'research',
    specPath: computeSpecPath(repoPath, researchId, context.currentSpecState),
  };
  return snapshotFromContext(materialized, events.length);
}

function applyEvents(repoPath, researchId, newEvents) {
  const eventsPath = getEventsPathForEntity(repoPath, 'research', researchId);
  const snapshotPath = getSnapshotPathForEntity(repoPath, 'research', researchId);
  const previousContext = projectContext(readEventsSync(eventsPath));
  appendEventsSync(eventsPath, newEvents);
  const snapshot = materialize(repoPath, researchId, readEventsSync(eventsPath));

  if (previousContext && previousContext.currentSpecState !== snapshot.currentSpecState) {
    moveSpecProjectionSync(
      computeSpecPath(repoPath, researchId, previousContext.currentSpecState),
      snapshot.specPath,
    );
  } else if (!previousContext && newEvents.some(e => e.type === 'research.started')) {
    moveSpecProjectionSync(
      computeSpecPath(repoPath, researchId, 'backlog'),
      snapshot.specPath,
    );
  }

  writeSnapshotSync(snapshotPath, snapshot);
  return snapshot;
}

// --- Public API ---

function startResearchSync(repoPath, researchId, mode, agents = []) {
  const lockPath = getLockPathForEntity(repoPath, 'research', researchId);
  return withLockSync(lockPath, () => {
    const existing = readEventsSync(getEventsPathForEntity(repoPath, 'research', researchId));
    if (existing.length > 0) {
      const snapshot = materialize(repoPath, researchId, existing);
      writeSnapshotSync(getSnapshotPathForEntity(repoPath, 'research', researchId), snapshot);
      return snapshot;
    }
    return applyEvents(repoPath, researchId, [{
      type: 'research.started',
      researchId,
      mode,
      agents,
      at: now(),
    }]);
  });
}

function requestResearchEvalSync(repoPath, researchId) {
  const lockPath = getLockPathForEntity(repoPath, 'research', researchId);
  return withLockSync(lockPath, () => {
    const events = readEventsSync(getEventsPathForEntity(repoPath, 'research', researchId));
    if (events.length === 0) {
      throw new Error(`Research ${researchId} has no engine events — run research-start first`);
    }
    const snapshot = materialize(repoPath, researchId, events);
    if (snapshot.currentSpecState === 'evaluating' || snapshot.currentSpecState === 'closing' || snapshot.currentSpecState === 'done') {
      writeSnapshotSync(getSnapshotPathForEntity(repoPath, 'research', researchId), snapshot);
      return snapshot;
    }
    return applyEvents(repoPath, researchId, [{ type: 'research.eval_requested', at: now() }]);
  });
}

function closeResearchSync(repoPath, researchId) {
  const lockPath = getLockPathForEntity(repoPath, 'research', researchId);
  return withLockSync(lockPath, () => {
    const events = readEventsSync(getEventsPathForEntity(repoPath, 'research', researchId));
    if (events.length === 0) {
      throw new Error(`Research ${researchId} has no engine events — run research-start first`);
    }
    const snapshot = materialize(repoPath, researchId, events);
    if (snapshot.currentSpecState === 'done') {
      writeSnapshotSync(getSnapshotPathForEntity(repoPath, 'research', researchId), snapshot);
      return snapshot;
    }
    applyEvents(repoPath, researchId, [{ type: 'research.close_requested', at: now() }]);
    return applyEvents(repoPath, researchId, [{ type: 'research.closed', at: now() }]);
  });
}

function showResearchSync(repoPath, researchId) {
  const events = readEventsSync(getEventsPathForEntity(repoPath, 'research', researchId));
  return materialize(repoPath, researchId, events);
}

module.exports = {
  startResearchSync,
  requestResearchEvalSync,
  closeResearchSync,
  showResearchSync,
};
