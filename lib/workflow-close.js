'use strict';

/**
 * Workflow-close bridge — routes feature-close through the workflow-core engine.
 *
 * This module bridges the existing feature-close command with the new
 * workflow-core engine. It:
 *   1. Checks the `workflow.closeEngine` feature flag
 *   2. Bootstraps workflow-core state from the existing manifest
 *   3. Emits close events with custom effects (real spec paths)
 *   4. Runs effects through the engine's claim/reclaim lifecycle
 *
 * The engine's effect lifecycle provides resumability: if close is interrupted
 * after the merge but before effects complete, re-running feature-close will
 * detect the in-progress workflow and resume from where it left off.
 */

const path = require('path');
const wf = require('./workflow-core');

// ---------------------------------------------------------------------------
// Feature flag
// ---------------------------------------------------------------------------

/**
 * Check whether the workflow-core close engine is enabled.
 * Supports both config and env var overrides.
 *
 * @param {object} [projectConfig] - From loadProjectConfig()
 * @returns {boolean}
 */
function isCloseEngineEnabled(projectConfig) {
  if (process.env.AIGON_WORKFLOW_CLOSE_ENGINE === '1') return true;
  if (process.env.AIGON_WORKFLOW_CLOSE_ENGINE === '0') return false;
  return !!(projectConfig?.workflow?.closeEngine);
}

// ---------------------------------------------------------------------------
// Bootstrap — synthesize workflow-core events from manifest state
// ---------------------------------------------------------------------------

/**
 * Bootstrap workflow-core state for a feature that was started under the
 * old manifest/state-machine system. Synthesizes the minimum events needed
 * to get the feature into `ready_for_review` state so close can proceed.
 *
 * If the feature already has workflow-core events, this is a no-op
 * (returns the existing snapshot).
 *
 * @param {string} repoPath
 * @param {string} featureId
 * @param {object} opts
 * @param {string} opts.mode - FeatureMode value (solo_branch, solo_worktree, fleet)
 * @param {string[]} opts.agents - Agent IDs (e.g. ['cc'] or ['cc', 'gg'])
 * @param {string} opts.winnerId - Winning agent ID
 * @returns {Promise<object>} snapshot
 */
async function bootstrapWorkflowState(repoPath, featureId, { mode, agents, winnerId }) {
  // Check if already bootstrapped
  const existingEvents = await wf.readEvents(wf.getEventsPath(repoPath, featureId));
  if (existingEvents.length > 0) {
    return wf.showFeature(repoPath, featureId);
  }

  // Synthesize events to reach ready_for_review:
  // started → agent_ready (×N) → eval_requested → winner.selected
  await wf.startFeature(repoPath, featureId, mode, agents);
  for (const agentId of agents) {
    await wf.signalAgentReady(repoPath, featureId, agentId);
  }
  await wf.requestFeatureEval(repoPath, featureId);
  await wf.selectWinner(repoPath, featureId, winnerId);

  return wf.showFeature(repoPath, featureId);
}

// ---------------------------------------------------------------------------
// Close with effects
// ---------------------------------------------------------------------------

/**
 * Initialize close effects and run them through the engine's claim lifecycle.
 *
 * This replaces the old requestTransition + moveFile + completePendingOp flow
 * with the engine's durable effect execution.
 *
 * @param {string} repoPath
 * @param {string} featureId
 * @param {object} opts
 * @param {string} opts.specFromPath - Current spec file path (in docs/specs/features/)
 * @param {string} opts.specToPath - Destination path (in 05-done/)
 * @param {string} opts.winnerId - Winning agent ID
 * @param {Function} [opts.effectExecutor] - Custom effect executor (defaults to built-in)
 * @param {object} [opts.engineOptions] - Options passed to runPendingEffects
 * @returns {Promise<{kind: string, snapshot?: object, message?: string}>}
 */
async function runWorkflowClose(repoPath, featureId, opts) {
  const { specFromPath, specToPath, winnerId, effectExecutor, engineOptions } = opts;

  // Check current state — may already be closing (resume) or done
  const snapshot = await wf.showFeature(repoPath, featureId);

  if (snapshot.currentSpecState === 'done') {
    return { kind: 'complete', snapshot, message: 'Feature already closed.' };
  }

  if (snapshot.currentSpecState === 'closing') {
    // Resume interrupted close — effects already initialized
    return runCloseEffects(repoPath, featureId, effectExecutor || defaultCloseExecutor, engineOptions);
  }

  if (snapshot.currentSpecState !== 'ready_for_review') {
    return {
      kind: 'error',
      message: `Cannot close feature ${featureId} from state "${snapshot.currentSpecState}".`,
    };
  }

  // Initialize close: emit close_requested + effect.requested events.
  // Use bridge-prefixed IDs to avoid materializePendingEffects overwriting
  // the custom payload paths with the engine's internal .aigon/workflows/ paths.
  const closeEffects = [
    {
      id: 'bridge.move_spec_to_done',
      type: 'move_spec',
      payload: { fromPath: specFromPath, toPath: specToPath },
    },
    {
      id: 'bridge.write_close_note',
      type: 'write_close_note',
      payload: { winnerAgentId: winnerId || '' },
    },
  ];

  const now = new Date().toISOString();
  await wf.persistEvents(repoPath, featureId, [
    { type: 'feature.close_requested', at: now },
    ...closeEffects.map((effect) => ({ type: 'effect.requested', effect, at: now })),
  ]);

  // Run effects through claim lifecycle
  return runCloseEffects(repoPath, featureId, effectExecutor || defaultCloseExecutor, engineOptions);
}

/**
 * Run pending close effects with the engine's claim/reclaim lifecycle.
 * Returns clear operator feedback when blocked or busy.
 *
 * @param {string} repoPath
 * @param {string} featureId
 * @param {Function} effectExecutor
 * @param {object} [options]
 * @returns {Promise<{kind: string, snapshot?: object, message?: string}>}
 */
async function runCloseEffects(repoPath, featureId, effectExecutor, options = {}) {
  const result = await wf.runPendingEffects(repoPath, featureId, effectExecutor, options);

  if (result.kind === 'busy') {
    return {
      kind: 'busy',
      message:
        `Close effects are already being executed by another process.\n` +
        `If you believe this is stale, re-run with --reclaim to force.`,
    };
  }

  return { kind: 'complete', snapshot: result.snapshot };
}

/**
 * Resume an interrupted close. Called when the feature is already in
 * 'closing' state with pending effects (e.g. after a crash).
 *
 * @param {string} repoPath
 * @param {string} featureId
 * @param {object} [opts]
 * @param {Function} [opts.effectExecutor]
 * @param {object} [opts.engineOptions]
 * @returns {Promise<{kind: string, snapshot?: object, message?: string}>}
 */
async function resumeClose(repoPath, featureId, opts = {}) {
  const snapshot = await wf.showFeature(repoPath, featureId);

  if (snapshot.currentSpecState === 'done') {
    return { kind: 'complete', snapshot, message: 'Feature already closed.' };
  }

  if (snapshot.currentSpecState !== 'closing') {
    return {
      kind: 'error',
      message: `Feature ${featureId} is not in closing state (current: ${snapshot.currentSpecState}).`,
    };
  }

  return runCloseEffects(
    repoPath,
    featureId,
    opts.effectExecutor || defaultCloseExecutor,
    opts.engineOptions,
  );
}

// ---------------------------------------------------------------------------
// Default effect executor — operates on real docs/specs/features/ paths
// ---------------------------------------------------------------------------

/**
 * Default close effect executor. Handles move_spec and write_close_note
 * using the real Aigon spec paths (docs/specs/features/).
 *
 * @param {string} repoPath
 * @param {string} featureId
 * @param {object} effect
 */
async function defaultCloseExecutor(repoPath, featureId, effect) {
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

  if (effect.type === 'write_close_note') {
    const { winnerAgentId } = effect.payload;
    const closePath = path.join(wf.getFeatureRoot(repoPath, featureId), 'closeout.md');
    await fsp.mkdir(path.dirname(closePath), { recursive: true });
    const body = [
      `# Feature ${featureId} Closeout`,
      '',
      `Winner: ${winnerAgentId || 'solo'}`,
      `Closed at: ${new Date().toISOString()}`,
      '',
    ].join('\n');
    await fsp.writeFile(closePath, body, 'utf8');
    return;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determine the FeatureMode from manifest/context.
 * @param {object} manifest - Current manifest
 * @param {boolean} isWorktree - Whether feature uses worktrees
 * @returns {string} FeatureMode value
 */
function resolveMode(manifest, isWorktree) {
  const agentCount = Object.keys(manifest.agents || {}).length;
  if (agentCount > 1) return wf.FeatureMode.FLEET;
  if (isWorktree) return wf.FeatureMode.SOLO_WORKTREE;
  return wf.FeatureMode.SOLO_BRANCH;
}

/**
 * Check if a workflow-core close is already in progress for a feature.
 * Used to detect resume scenarios before the full bootstrap.
 *
 * @param {string} repoPath
 * @param {string} featureId
 * @returns {Promise<{inProgress: boolean, state: string|null}>}
 */
async function getWorkflowCloseState(repoPath, featureId) {
  const events = await wf.readEvents(wf.getEventsPath(repoPath, featureId));
  if (events.length === 0) {
    return { inProgress: false, state: null };
  }
  const context = wf.projectContext(events);
  if (!context) {
    return { inProgress: false, state: null };
  }
  return {
    inProgress: context.currentSpecState === 'closing',
    state: context.currentSpecState,
  };
}

module.exports = {
  isCloseEngineEnabled,
  bootstrapWorkflowState,
  runWorkflowClose,
  resumeClose,
  runCloseEffects,
  defaultCloseExecutor,
  resolveMode,
  getWorkflowCloseState,
};
