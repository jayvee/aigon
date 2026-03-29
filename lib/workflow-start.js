'use strict';

/**
 * Workflow-start bridge — routes feature-start through the workflow-core engine.
 *
 * This module bridges the existing feature-start command with the new
 * workflow-core engine. It:
 *   1. Checks the `workflow.startEngine` feature flag
 *   2. Calls engine.startFeature() to create event-sourced state from scratch
 *   3. Emits start effects (move-spec, init-log per agent) through the engine
 *   4. Runs effects through the engine's claim/reclaim lifecycle
 *   5. Writes a legacy manifest for backward compatibility with agent status files
 *
 * Unlike workflow-close, no bootstrap-from-legacy is needed here — feature-start
 * creates new engine state from the beginning.
 */

const path = require('path');
const wf = require('./workflow-core');

// ---------------------------------------------------------------------------
// Feature flag
// ---------------------------------------------------------------------------

/**
 * Check whether the workflow-core start engine is enabled.
 * Supports both config and env var overrides.
 *
 * @param {object} [projectConfig] - From loadProjectConfig()
 * @returns {boolean}
 */
function isStartEngineEnabled(projectConfig) {
  if (process.env.AIGON_WORKFLOW_START_ENGINE === '1') return true;
  if (process.env.AIGON_WORKFLOW_START_ENGINE === '0') return false;
  return !!(projectConfig?.workflow?.startEngine);
}

// ---------------------------------------------------------------------------
// Mode resolution
// ---------------------------------------------------------------------------

/**
 * Determine the FeatureMode from agent list and config.
 *
 * @param {string[]} agentIds - Agent IDs from the CLI (e.g. ['cc'] or ['cc', 'gg'])
 * @returns {string} FeatureMode value
 */
function resolveMode(agentIds) {
  if (agentIds.length > 1) return wf.FeatureMode.FLEET;
  if (agentIds.length === 1) return wf.FeatureMode.SOLO_WORKTREE;
  return wf.FeatureMode.SOLO_BRANCH;
}

// ---------------------------------------------------------------------------
// Start with effects
// ---------------------------------------------------------------------------

/**
 * Start a feature through the workflow-core engine.
 *
 * Creates the event log, snapshot, and start effects, then runs effects
 * through the engine's claim/reclaim lifecycle.
 *
 * @param {string} repoPath - Absolute path to repo root
 * @param {string} featureId - Feature ID (e.g. '162')
 * @param {object} opts
 * @param {string[]} opts.agents - Agent IDs (e.g. ['cc'] or ['cc', 'gg'])
 * @param {string} opts.specFromPath - Current spec file path (in backlog or in-progress)
 * @param {string} opts.specToPath - Destination path (in 03-in-progress/)
 * @param {string} opts.desc - Feature description slug (e.g. 'dark-mode')
 * @param {string} opts.num - Feature number string (e.g. '162')
 * @param {Function} [opts.effectExecutor] - Custom effect executor (defaults to built-in)
 * @param {object} [opts.engineOptions] - Options passed to runPendingEffects
 * @returns {Promise<{kind: string, snapshot?: object, message?: string}>}
 */
async function runWorkflowStart(repoPath, featureId, opts) {
  const { agents, specFromPath, specToPath, desc, num, effectExecutor, engineOptions } = opts;

  // Check if already started (resume scenario)
  const resumeResult = await getWorkflowStartState(repoPath, featureId);
  if (resumeResult.state === 'implementing') {
    // Already started — check for pending effects (interrupted start)
    return resumeStart(repoPath, featureId, {
      effectExecutor: effectExecutor || defaultStartExecutor,
      engineOptions,
    });
  }

  if (resumeResult.state !== null) {
    // Feature exists in some other state — don't overwrite
    return {
      kind: 'error',
      message: `Feature ${featureId} already exists in workflow-core with state "${resumeResult.state}".`,
    };
  }

  // Determine mode from agent count
  const mode = resolveMode(agents);

  // Create engine state: emits feature.started event, creates events.jsonl + snapshot.json
  await wf.startFeature(repoPath, featureId, mode, agents);

  // Initialize start effects with custom payloads (real spec paths).
  // Use bridge-prefixed IDs to avoid conflicts with engine's internal effects.
  const startEffects = buildStartEffects({ specFromPath, specToPath, agents, num, desc });

  if (startEffects.length > 0) {
    const now = new Date().toISOString();
    await wf.persistEvents(
      repoPath,
      featureId,
      startEffects.map((effect) => ({ type: 'effect.requested', effect, at: now })),
    );

    // Run effects through claim lifecycle
    return runStartEffects(
      repoPath,
      featureId,
      effectExecutor || defaultStartExecutor,
      engineOptions,
    );
  }

  // No effects needed (e.g. drive mode with spec already in place)
  const snapshot = await wf.showFeature(repoPath, featureId);
  return { kind: 'complete', snapshot };
}

/**
 * Build the list of start effects based on agents and spec paths.
 *
 * @param {object} opts
 * @param {string} opts.specFromPath - Source spec path
 * @param {string} opts.specToPath - Destination spec path
 * @param {string[]} opts.agents - Agent IDs
 * @param {string} opts.num - Feature number
 * @param {string} opts.desc - Feature description slug
 * @returns {object[]} Effect definitions
 */
function buildStartEffects({ specFromPath, specToPath, agents, num, desc }) {
  const effects = [];

  // Move spec from backlog to in-progress (only if paths differ)
  if (specFromPath && specToPath && specFromPath !== specToPath) {
    effects.push({
      id: 'bridge.start.move_spec',
      type: 'move_spec',
      payload: { fromPath: specFromPath, toPath: specToPath },
    });
  }

  // Init log per agent (for worktree/fleet mode)
  for (const agentId of agents) {
    effects.push({
      id: `bridge.start.init_log_${agentId}`,
      type: 'init_log',
      payload: { agentId, num, desc },
    });
  }

  // If no agents (drive mode), single log
  if (agents.length === 0) {
    effects.push({
      id: 'bridge.start.init_log',
      type: 'init_log',
      payload: { agentId: null, num, desc },
    });
  }

  return effects;
}

// ---------------------------------------------------------------------------
// Resume interrupted start
// ---------------------------------------------------------------------------

/**
 * Resume an interrupted start. Called when the feature is already in
 * 'implementing' state with pending effects (e.g. after a crash).
 *
 * @param {string} repoPath
 * @param {string} featureId
 * @param {object} [opts]
 * @param {Function} [opts.effectExecutor]
 * @param {object} [opts.engineOptions]
 * @returns {Promise<{kind: string, snapshot?: object, message?: string}>}
 */
async function resumeStart(repoPath, featureId, opts = {}) {
  const snapshot = await wf.showFeature(repoPath, featureId);

  if (snapshot.currentSpecState !== 'implementing') {
    return {
      kind: 'error',
      message: `Feature ${featureId} is not in implementing state (current: ${snapshot.currentSpecState}).`,
    };
  }

  const hasPendingEffects = snapshot.effects.some((e) => e.status !== 'succeeded');
  if (!hasPendingEffects) {
    return { kind: 'complete', snapshot, message: 'Feature already started, no pending effects.' };
  }

  return runStartEffects(
    repoPath,
    featureId,
    opts.effectExecutor || defaultStartExecutor,
    opts.engineOptions,
  );
}

// ---------------------------------------------------------------------------
// Effect runner
// ---------------------------------------------------------------------------

/**
 * Run pending start effects with the engine's claim/reclaim lifecycle.
 *
 * @param {string} repoPath
 * @param {string} featureId
 * @param {Function} effectExecutor
 * @param {object} [options]
 * @returns {Promise<{kind: string, snapshot?: object, message?: string}>}
 */
async function runStartEffects(repoPath, featureId, effectExecutor, options = {}) {
  const result = await wf.runPendingEffects(repoPath, featureId, effectExecutor, options);

  if (result.kind === 'busy') {
    return {
      kind: 'busy',
      message:
        'Start effects are already being executed by another process.\n' +
        'If you believe this is stale, re-run with --reclaim to force.',
    };
  }

  return { kind: 'complete', snapshot: result.snapshot };
}

// ---------------------------------------------------------------------------
// Default effect executor
// ---------------------------------------------------------------------------

/**
 * Default start effect executor. Handles move_spec and init_log
 * using real Aigon spec paths.
 *
 * @param {string} repoPath
 * @param {string} featureId
 * @param {object} effect
 */
async function defaultStartExecutor(repoPath, featureId, effect) {
  const fsp = require('fs/promises');

  if (effect.type === 'move_spec') {
    const { fromPath, toPath } = effect.payload;
    await fsp.mkdir(path.dirname(toPath), { recursive: true });
    try {
      await fsp.access(fromPath);
    } catch {
      // Source already moved (idempotent)
      return;
    }
    try {
      await fsp.access(toPath);
      // Target already exists (idempotent)
      return;
    } catch {
      // Target doesn't exist — move
    }
    await fsp.rename(fromPath, toPath);
    return;
  }

  if (effect.type === 'init_log') {
    const { agentId, num, desc } = effect.payload;
    const logsDir = path.join(repoPath, 'docs', 'specs', 'features', 'logs');
    await fsp.mkdir(logsDir, { recursive: true });
    const logName = agentId
      ? `feature-${num}-${agentId}-${desc}-log.md`
      : `feature-${num}-${desc}-log.md`;
    const logPath = path.join(logsDir, logName);
    try {
      await fsp.access(logPath);
      // Already exists (idempotent)
      return;
    } catch {
      // Doesn't exist — create
    }
    const logTemplate = `# Implementation Log: Feature ${num} - ${desc}\n\n## Plan\n\n## Progress\n\n## Decisions\n`;
    await fsp.writeFile(logPath, logTemplate, 'utf8');
    return;
  }
}

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

/**
 * Check if a workflow-core start is already in progress for a feature.
 *
 * @param {string} repoPath
 * @param {string} featureId
 * @returns {Promise<{inProgress: boolean, state: string|null, hasPendingEffects: boolean}>}
 */
async function getWorkflowStartState(repoPath, featureId) {
  const events = await wf.readEvents(wf.getEventsPath(repoPath, featureId));
  if (events.length === 0) {
    return { inProgress: false, state: null, hasPendingEffects: false };
  }
  const context = wf.projectContext(events);
  if (!context) {
    return { inProgress: false, state: null, hasPendingEffects: false };
  }
  const hasPendingEffects = context.effects.some((e) => e.status !== 'succeeded');
  return {
    inProgress: context.currentSpecState === 'implementing' && hasPendingEffects,
    state: context.currentSpecState,
    hasPendingEffects,
  };
}

/**
 * Write a legacy manifest for backward compatibility.
 * Agent status files (.aigon/state/feature-{id}-{agent}.json) still use manifests,
 * so we need to keep one in sync even when the engine owns the state.
 *
 * @param {object} manifest - The manifest module (injected for testability)
 * @param {string} featureId
 * @param {string[]} agents
 */
function writeLegacyManifest(manifest, featureId, agents) {
  manifest.writeManifest(
    featureId,
    {
      stage: 'in-progress',
      agents,
      pending: [], // Engine owns effect tracking, so no legacy pending ops
    },
    { type: 'transition:feature-start', actor: 'workflow-core/start' },
  );
}

module.exports = {
  isStartEngineEnabled,
  resolveMode,
  runWorkflowStart,
  buildStartEffects,
  resumeStart,
  runStartEffects,
  defaultStartExecutor,
  getWorkflowStartState,
  writeLegacyManifest,
};
