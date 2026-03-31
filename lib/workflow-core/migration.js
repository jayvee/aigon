'use strict';

const path = require('path');
const fs = require('fs');
const { readEvents } = require('./event-store');
const { getEventsPathForEntity } = require('./paths');
const engine = require('./engine');
const { FeatureMode } = require('./types');

function defaultModeForAgents(agents) {
  const count = Array.isArray(agents) ? agents.length : 0;
  if (count > 1) return FeatureMode.FLEET;
  if (count === 1) return FeatureMode.SOLO_WORKTREE;
  return FeatureMode.SOLO_BRANCH;
}

function mapFolderToLifecycle(folder) {
  if (folder === '04-in-evaluation') return 'evaluating';
  if (folder === '05-done') return 'done';
  return 'implementing';
}

async function migrateEntityLifecycleIfNeeded(options) {
  const {
    repoPath,
    entityType,
    entityId,
    mode,
    agents = [],
    readyAgents = [],
    lifecycle = 'implementing',
    winnerAgentId = null,
  } = options;

  const existingEvents = await readEvents(getEventsPathForEntity(repoPath, entityType, entityId));
  if (existingEvents.length > 0) {
    return { migrated: false, reason: 'already-initialized' };
  }

  const resolvedMode = mode || defaultModeForAgents(agents);
  const steps = [];

  await engine.startEntity(repoPath, entityType, entityId, resolvedMode, agents);
  steps.push('started');

  for (const agentId of readyAgents) {
    await engine.emitSignal(repoPath, entityId, 'agent-ready', agentId, { entityType });
  }
  if (readyAgents.length > 0) {
    steps.push('agent-ready');
  }

  if (lifecycle === 'evaluating' || lifecycle === 'ready_for_review' || lifecycle === 'closing' || lifecycle === 'done') {
    await engine.requestEntityEval(repoPath, entityType, entityId);
    steps.push('eval-requested');
  }

  if (entityType === 'feature' && (lifecycle === 'ready_for_review' || lifecycle === 'closing' || lifecycle === 'done') && winnerAgentId) {
    await engine.selectWinner(repoPath, entityId, winnerAgentId);
    steps.push('winner-selected');
  }

  if (lifecycle === 'closing' || lifecycle === 'done') {
    await engine.closeEntity(repoPath, entityType, entityId);
    steps.push('closed');
  }

  const snapshot = await engine.showEntity(repoPath, entityType, entityId);
  return { migrated: true, steps, snapshot };
}

function discoverActiveEntitySpecs(repoPath, entityType) {
  const docsDir = entityType === 'research' ? 'research-topics' : 'features';
  const prefix = entityType === 'research' ? 'research-' : 'feature-';
  const folders = ['03-in-progress', '04-in-evaluation'];
  const ids = [];

  folders.forEach((folder) => {
    const folderPath = path.join(repoPath, 'docs', 'specs', docsDir, folder);
    if (!fs.existsSync(folderPath)) return;
    for (const file of fs.readdirSync(folderPath)) {
      if (!file.startsWith(prefix) || !file.endsWith('.md')) continue;
      const match = file.match(/^\w+-(\d+)-/);
      if (!match) continue;
      ids.push({
        entityId: match[1],
        lifecycle: mapFolderToLifecycle(folder),
      });
    }
  });

  return ids;
}

async function migrateActiveEntities(repoPath, options = {}) {
  const entityTypes = options.entityTypes || ['feature', 'research'];
  const results = [];

  for (const entityType of entityTypes) {
    const discovered = discoverActiveEntitySpecs(repoPath, entityType);
    for (const item of discovered) {
      const migration = await migrateEntityLifecycleIfNeeded({
        repoPath,
        entityType,
        entityId: item.entityId,
        lifecycle: item.lifecycle,
        agents: options.agentsByEntityId?.[item.entityId] || [],
        readyAgents: options.readyAgentsByEntityId?.[item.entityId] || [],
        mode: options.modeByEntityId?.[item.entityId],
      });
      results.push({ entityType, entityId: item.entityId, ...migration });
    }
  }

  return results;
}

module.exports = {
  migrateEntityLifecycleIfNeeded,
  migrateActiveEntities,
};

