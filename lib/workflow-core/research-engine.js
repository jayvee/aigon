'use strict';

const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { createActor } = require('xstate');
const { researchMachine } = require('./machine');
const { readEvents, appendEvent } = require('./event-store');
const { writeSnapshot } = require('./snapshot-store');
const { withFeatureLock } = require('./lock');
const { projectContext } = require('./projector');
const { deriveAvailableActions } = require('./actions');
const {
  getResearchEventsPath,
  getResearchSnapshotPath,
  getResearchLockPath,
  getResearchSpecPath,
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
  return getResearchSpecPath(repoPath, researchId, lifecycle);
}

async function ensureDir(targetPath) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
}

async function moveSpecProjection(fromPath, toPath) {
  if (!fromPath || !toPath || fromPath === toPath) return;
  await ensureDir(toPath);
  try {
    await fs.access(toPath);
    return;
  } catch (_) { /* continue */ }
  try {
    await fs.access(fromPath);
  } catch (_) {
    return;
  }
  await fs.rename(fromPath, toPath);
}

function requireContext(context, researchId) {
  if (context === null) {
    throw new Error(`Research ${researchId} does not exist`);
  }
  return context;
}

function applyTransition(context, event) {
  const actor = createActor(researchMachine, { input: context });
  actor.start();
  const snapshot = actor.getSnapshot();

  function sendIfAllowed(machineEvent) {
    if (!snapshot.can(machineEvent)) {
      throw new Error(`Event ${machineEvent.type} is invalid for research ${context.featureId}`);
    }
    actor.send(machineEvent);
  }

  switch (event.type) {
    case 'research.paused':
      sendIfAllowed({ type: 'research.pause', at: event.at });
      break;
    case 'research.resumed':
      sendIfAllowed({ type: 'research.resume', at: event.at });
      break;
    case 'research.eval_requested':
      sendIfAllowed({ type: 'research.eval', at: event.at });
      break;
    case 'research.close_requested':
      sendIfAllowed({ type: 'research.close', at: event.at });
      break;
    case 'research.closed':
      sendIfAllowed({ type: 'research.closed', at: event.at });
      break;
    default:
      break;
  }

  const nextSnapshot = actor.getSnapshot();
  return {
    ...nextSnapshot.context,
    entityType: 'research',
    updatedAt: event.at,
    currentSpecState: nextSnapshot.value,
  };
}

async function loadCurrentUnlocked(repoPath, researchId, eventsPath) {
  eventsPath = eventsPath || getResearchEventsPath(repoPath, researchId);
  const events = await readEvents(eventsPath);
  const context = projectContext(events);
  return { events, context };
}

async function applyEventsUnlocked(repoPath, researchId, newEvents, eventsPath, snapshotPath) {
  eventsPath = eventsPath || getResearchEventsPath(repoPath, researchId);
  snapshotPath = snapshotPath || getResearchSnapshotPath(repoPath, researchId);

  const previousEvents = await readEvents(eventsPath);
  const previousContextRaw = projectContext(previousEvents);
  const previousContext = previousContextRaw
    ? { ...previousContextRaw, specPath: computeSpecPath(repoPath, researchId, previousContextRaw.currentSpecState) }
    : null;

  for (const event of newEvents) {
    await appendEvent(eventsPath, event);
  }

  const allEvents = await readEvents(eventsPath);
  const projected = requireContext(projectContext(allEvents), researchId);
  let nextContext = {
    ...projected,
    entityType: 'research',
    specPath: computeSpecPath(repoPath, researchId, projected.currentSpecState),
  };

  for (const event of newEvents) {
    nextContext = applyTransition(nextContext, event);
    nextContext.specPath = computeSpecPath(repoPath, researchId, nextContext.currentSpecState);
  }

  if (
    previousContext &&
    previousContext.currentSpecState !== nextContext.currentSpecState
  ) {
    await moveSpecProjection(previousContext.specPath, nextContext.specPath);
  } else if (!previousContext && newEvents.some((event) => event.type === 'research.started')) {
    await moveSpecProjection(
      computeSpecPath(repoPath, researchId, 'backlog'),
      nextContext.specPath,
    );
  }

  const snapshot = snapshotFromContext(nextContext, allEvents.length);
  await writeSnapshot(snapshotPath, snapshot);
  return snapshot;
}

async function startResearch(repoPath, researchId, mode, agents = []) {
  const eventsPath = getResearchEventsPath(repoPath, researchId);
  const lockPath = getResearchLockPath(repoPath, researchId);
  const snapshotPath = getResearchSnapshotPath(repoPath, researchId);
  return withFeatureLock(lockPath, async () => {
    const { events, context } = await loadCurrentUnlocked(repoPath, researchId, eventsPath);
    if (context) {
      const snapshot = snapshotFromContext(
        { ...context, entityType: 'research', specPath: computeSpecPath(repoPath, researchId, context.currentSpecState) },
        events.length,
      );
      await writeSnapshot(snapshotPath, snapshot);
      return snapshot;
    }
    return applyEventsUnlocked(repoPath, researchId, [{
      type: 'research.started',
      researchId,
      mode,
      agents,
      at: now(),
    }], eventsPath, snapshotPath);
  });
}

async function requestResearchEval(repoPath, researchId) {
  const eventsPath = getResearchEventsPath(repoPath, researchId);
  const lockPath = getResearchLockPath(repoPath, researchId);
  const snapshotPath = getResearchSnapshotPath(repoPath, researchId);
  return withFeatureLock(lockPath, async () => {
    const { events, context } = await loadCurrentUnlocked(repoPath, researchId, eventsPath);
    const current = requireContext(context, researchId);
    if (current.currentSpecState === 'evaluating' || current.currentSpecState === 'closing' || current.currentSpecState === 'done') {
      return snapshotFromContext(
        { ...current, entityType: 'research', specPath: computeSpecPath(repoPath, researchId, current.currentSpecState) },
        events.length,
      );
    }
    return applyEventsUnlocked(repoPath, researchId, [{ type: 'research.eval_requested', at: now() }], eventsPath, snapshotPath);
  });
}

async function closeResearch(repoPath, researchId) {
  const eventsPath = getResearchEventsPath(repoPath, researchId);
  const lockPath = getResearchLockPath(repoPath, researchId);
  const snapshotPath = getResearchSnapshotPath(repoPath, researchId);
  return withFeatureLock(lockPath, async () => {
    const { events, context } = await loadCurrentUnlocked(repoPath, researchId, eventsPath);
    const current = requireContext(context, researchId);
    if (current.currentSpecState === 'done') {
      return snapshotFromContext(
        { ...current, entityType: 'research', specPath: computeSpecPath(repoPath, researchId, current.currentSpecState) },
        events.length,
      );
    }
    const requested = await applyEventsUnlocked(
      repoPath,
      researchId,
      [{ type: 'research.close_requested', at: now() }],
      eventsPath,
      snapshotPath,
    );
    if (requested.currentSpecState === 'done') return requested;
    return applyEventsUnlocked(
      repoPath,
      researchId,
      [{ type: 'research.closed', at: now() }],
      eventsPath,
      snapshotPath,
    );
  });
}

async function showResearch(repoPath, researchId) {
  const eventsPath = getResearchEventsPath(repoPath, researchId);
  const events = await readEvents(eventsPath);
  const context = requireContext(projectContext(events), researchId);
  const materialized = {
    ...context,
    entityType: 'research',
    specPath: computeSpecPath(repoPath, researchId, context.currentSpecState),
  };
  return snapshotFromContext(materialized, events.length);
}

module.exports = {
  startResearch,
  requestResearchEval,
  closeResearch,
  showResearch,
};

function readEventsSync(eventsPath) {
  try {
    const content = fsSync.readFileSync(eventsPath, 'utf8');
    return content
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
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

function materializeSnapshotFromEventsSync(repoPath, researchId, events) {
  const context = requireContext(projectContext(events), researchId);
  const materialized = {
    ...context,
    entityType: 'research',
    specPath: computeSpecPath(repoPath, researchId, context.currentSpecState),
  };
  return snapshotFromContext(materialized, events.length);
}

function applyResearchEventsSync(repoPath, researchId, newEvents) {
  const eventsPath = getResearchEventsPath(repoPath, researchId);
  const snapshotPath = getResearchSnapshotPath(repoPath, researchId);
  const previousEvents = readEventsSync(eventsPath);
  const previousContext = projectContext(previousEvents);
  appendEventsSync(eventsPath, newEvents);
  const events = readEventsSync(eventsPath);
  const snapshot = materializeSnapshotFromEventsSync(repoPath, researchId, events);

  if (previousContext && previousContext.currentSpecState !== snapshot.currentSpecState) {
    moveSpecProjectionSync(
      computeSpecPath(repoPath, researchId, previousContext.currentSpecState),
      snapshot.specPath,
    );
  } else if (!previousContext && newEvents.some((event) => event.type === 'research.started')) {
    moveSpecProjectionSync(
      computeSpecPath(repoPath, researchId, 'backlog'),
      snapshot.specPath,
    );
  }

  writeSnapshotSync(snapshotPath, snapshot);
  return snapshot;
}

function startResearchSync(repoPath, researchId, mode, agents = []) {
  const lockPath = getResearchLockPath(repoPath, researchId);
  const eventsPath = getResearchEventsPath(repoPath, researchId);
  const snapshotPath = getResearchSnapshotPath(repoPath, researchId);
  return withLockSync(lockPath, () => {
    const existing = readEventsSync(eventsPath);
    if (existing.length > 0) {
      const snapshot = materializeSnapshotFromEventsSync(repoPath, researchId, existing);
      writeSnapshotSync(snapshotPath, snapshot);
      return snapshot;
    }
    return applyResearchEventsSync(repoPath, researchId, [{
      type: 'research.started',
      researchId,
      mode,
      agents,
      at: now(),
    }]);
  });
}

function requestResearchEvalSync(repoPath, researchId) {
  const lockPath = getResearchLockPath(repoPath, researchId);
  const eventsPath = getResearchEventsPath(repoPath, researchId);
  const snapshotPath = getResearchSnapshotPath(repoPath, researchId);
  return withLockSync(lockPath, () => {
    let events = readEventsSync(eventsPath);
    if (events.length === 0) {
      const inProgressPath = computeSpecPath(repoPath, researchId, 'implementing');
      if (fsSync.existsSync(inProgressPath)) {
        appendEventsSync(eventsPath, [{
          type: 'research.started',
          researchId,
          mode: 'solo',
          agents: [],
          at: now(),
        }]);
        events = readEventsSync(eventsPath);
      }
    }
    const snapshot = materializeSnapshotFromEventsSync(repoPath, researchId, events);
    if (snapshot.currentSpecState === 'evaluating' || snapshot.currentSpecState === 'closing' || snapshot.currentSpecState === 'done') {
      writeSnapshotSync(snapshotPath, snapshot);
      return snapshot;
    }
    return applyResearchEventsSync(repoPath, researchId, [{ type: 'research.eval_requested', at: now() }]);
  });
}

function closeResearchSync(repoPath, researchId) {
  const lockPath = getResearchLockPath(repoPath, researchId);
  const eventsPath = getResearchEventsPath(repoPath, researchId);
  const snapshotPath = getResearchSnapshotPath(repoPath, researchId);
  return withLockSync(lockPath, () => {
    let events = readEventsSync(eventsPath);
    if (events.length === 0) {
      const inProgressPath = computeSpecPath(repoPath, researchId, 'implementing');
      const inEvalPath = computeSpecPath(repoPath, researchId, 'evaluating');
      if (fsSync.existsSync(inProgressPath) || fsSync.existsSync(inEvalPath)) {
        appendEventsSync(eventsPath, [{
          type: 'research.started',
          researchId,
          mode: 'solo',
          agents: [],
          at: now(),
        }]);
        if (fsSync.existsSync(inEvalPath)) {
          appendEventsSync(eventsPath, [{ type: 'research.eval_requested', at: now() }]);
        }
        events = readEventsSync(eventsPath);
      }
    }
    const snapshot = materializeSnapshotFromEventsSync(repoPath, researchId, events);
    if (snapshot.currentSpecState === 'done') {
      writeSnapshotSync(snapshotPath, snapshot);
      return snapshot;
    }
    applyResearchEventsSync(repoPath, researchId, [{ type: 'research.close_requested', at: now() }]);
    return applyResearchEventsSync(repoPath, researchId, [{ type: 'research.closed', at: now() }]);
  });
}

function showResearchSync(repoPath, researchId) {
  const eventsPath = getResearchEventsPath(repoPath, researchId);
  const events = readEventsSync(eventsPath);
  return materializeSnapshotFromEventsSync(repoPath, researchId, events);
}

module.exports.startResearchSync = startResearchSync;
module.exports.requestResearchEvalSync = requestResearchEvalSync;
module.exports.closeResearchSync = closeResearchSync;
module.exports.showResearchSync = showResearchSync;
module.exports.startResearch = async (repoPath, researchId, mode, agents = []) =>
  startResearchSync(repoPath, researchId, mode, agents);
module.exports.requestResearchEval = async (repoPath, researchId) =>
  requestResearchEvalSync(repoPath, researchId);
module.exports.closeResearch = async (repoPath, researchId) =>
  closeResearchSync(repoPath, researchId);
module.exports.showResearch = async (repoPath, researchId) =>
  showResearchSync(repoPath, researchId);
