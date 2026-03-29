'use strict';

/**
 * Workflow-eval bridge — routes feature-eval through the workflow-core engine.
 *
 * This module bridges the existing feature-eval command with the new
 * workflow-core engine. It:
 *   1. Checks the `workflow.evalEngine` feature flag
 *   2. Synthesizes agent_ready signals from legacy manifest status files
 *   3. Calls engine.requestFeatureEval() with XState guard enforcement
 *   4. Runs eval effects (move-spec, write-eval-stub) through the effect lifecycle
 *
 * The key value-add over the legacy path is the XState `allAgentsReady` guard,
 * which rejects eval if any agent hasn't submitted — enforced by the machine,
 * not ad-hoc checks.
 */

const path = require('path');
const wf = require('./workflow-core');

// ---------------------------------------------------------------------------
// Feature flag
// ---------------------------------------------------------------------------

/**
 * Check whether the workflow-core eval engine is enabled.
 * Supports both config and env var overrides.
 *
 * @param {object} [projectConfig] - From loadProjectConfig()
 * @returns {boolean}
 */
function isEvalEngineEnabled(projectConfig) {
  if (process.env.AIGON_WORKFLOW_EVAL_ENGINE === '1') return true;
  if (process.env.AIGON_WORKFLOW_EVAL_ENGINE === '0') return false;
  return !!(projectConfig?.workflow?.evalEngine);
}

// ---------------------------------------------------------------------------
// Agent-ready synthesis — bridge legacy manifest status to engine events
// ---------------------------------------------------------------------------

/**
 * Ensure all agents that have submitted (per legacy manifest status files)
 * have corresponding `signal.agent_ready` events in the engine.
 *
 * This handles the transition period where features are engine-started but
 * agents submit via the legacy `aigon agent-status submitted` path, which
 * writes to `.aigon/state/feature-{id}-{agent}.json` but not to the engine.
 *
 * @param {string} repoPath
 * @param {string} featureId
 * @param {object} manifest - The manifest module (for reading agent status)
 * @returns {Promise<void>}
 */
async function synthesizeAgentReadySignals(repoPath, featureId, manifest) {
  const snapshot = await wf.showFeature(repoPath, featureId);

  for (const [agentId, agentState] of Object.entries(snapshot.agents)) {
    if (agentState.status === 'ready') continue; // Already marked ready in engine

    // Check legacy manifest agent status file
    const legacyStatus = manifest.readAgentStatus(featureId, agentId);
    if (legacyStatus && legacyStatus.status === 'submitted') {
      await wf.signalAgentReady(repoPath, featureId, agentId);
    }
  }
}

// ---------------------------------------------------------------------------
// Eval with effects
// ---------------------------------------------------------------------------

/**
 * Run feature-eval through the workflow-core engine.
 *
 * Emits `feature.eval_requested` (which the XState machine gates with
 * `allAgentsReady`), then registers and runs eval effects.
 *
 * @param {string} repoPath
 * @param {string} featureId
 * @param {object} opts
 * @param {string} opts.specFromPath - Current spec file path (in 03-in-progress/)
 * @param {string} opts.specToPath - Destination path (in 04-in-evaluation/)
 * @param {Function} [opts.effectExecutor] - Custom effect executor (defaults to built-in)
 * @param {object} [opts.engineOptions] - Options passed to runPendingEffects
 * @returns {Promise<{kind: string, snapshot?: object, message?: string}>}
 */
async function runWorkflowEval(repoPath, featureId, opts) {
  const { specFromPath, specToPath, effectExecutor, engineOptions } = opts;

  // Check current state — may already be evaluating (resume) or past eval
  const snapshot = await wf.showFeature(repoPath, featureId);

  if (snapshot.currentSpecState === 'evaluating') {
    // Already in evaluating — resume any pending effects
    return resumeEval(repoPath, featureId, {
      effectExecutor: effectExecutor || defaultEvalExecutor,
      engineOptions,
    });
  }

  if (snapshot.currentSpecState !== 'implementing') {
    return {
      kind: 'error',
      message: `Cannot eval feature ${featureId} from state "${snapshot.currentSpecState}".`,
    };
  }

  // Attempt the eval transition — XState enforces allAgentsReady guard
  try {
    await wf.requestFeatureEval(repoPath, featureId);
  } catch (err) {
    if (err.message && err.message.includes('is invalid')) {
      // Guard failed — agents not all ready
      return {
        kind: 'guard_failed',
        message: `Cannot eval feature ${featureId}: not all agents are ready. Ensure all agents have submitted before evaluating.`,
      };
    }
    throw err;
  }

  // Register eval effects with bridge-prefixed IDs
  const evalEffects = buildEvalEffects({ specFromPath, specToPath });

  if (evalEffects.length > 0) {
    const now = new Date().toISOString();
    await wf.persistEvents(
      repoPath,
      featureId,
      evalEffects.map((effect) => ({ type: 'effect.requested', effect, at: now })),
    );

    // Run effects through claim lifecycle
    return runEvalEffects(
      repoPath,
      featureId,
      effectExecutor || defaultEvalExecutor,
      engineOptions,
    );
  }

  // No effects needed
  const updatedSnapshot = await wf.showFeature(repoPath, featureId);
  return { kind: 'complete', snapshot: updatedSnapshot };
}

/**
 * Build the list of eval effects.
 *
 * @param {object} opts
 * @param {string} opts.specFromPath - Source spec path (in-progress)
 * @param {string} opts.specToPath - Destination spec path (in-evaluation)
 * @returns {object[]} Effect definitions
 */
function buildEvalEffects({ specFromPath, specToPath }) {
  const effects = [];

  // Move spec from in-progress to in-evaluation
  if (specFromPath && specToPath && specFromPath !== specToPath) {
    effects.push({
      id: 'bridge.eval.move_spec',
      type: 'move_spec',
      payload: { fromPath: specFromPath, toPath: specToPath },
    });
  }

  // Write eval stub (evaluation template placeholder)
  effects.push({
    id: 'bridge.eval.write_eval_stub',
    type: 'write_eval_stub',
    payload: {},
  });

  return effects;
}

// ---------------------------------------------------------------------------
// Resume interrupted eval
// ---------------------------------------------------------------------------

/**
 * Resume an interrupted eval. Called when the feature is already in
 * 'evaluating' state with pending effects.
 *
 * @param {string} repoPath
 * @param {string} featureId
 * @param {object} [opts]
 * @param {Function} [opts.effectExecutor]
 * @param {object} [opts.engineOptions]
 * @returns {Promise<{kind: string, snapshot?: object, message?: string}>}
 */
async function resumeEval(repoPath, featureId, opts = {}) {
  const snapshot = await wf.showFeature(repoPath, featureId);

  if (snapshot.currentSpecState !== 'evaluating') {
    return {
      kind: 'error',
      message: `Feature ${featureId} is not in evaluating state (current: ${snapshot.currentSpecState}).`,
    };
  }

  const hasPendingEffects = snapshot.effects.some((e) => e.status !== 'succeeded');
  if (!hasPendingEffects) {
    return { kind: 'complete', snapshot, message: 'Feature already in evaluation, no pending effects.' };
  }

  return runEvalEffects(
    repoPath,
    featureId,
    opts.effectExecutor || defaultEvalExecutor,
    opts.engineOptions,
  );
}

// ---------------------------------------------------------------------------
// Effect runner
// ---------------------------------------------------------------------------

/**
 * Run pending eval effects with the engine's claim/reclaim lifecycle.
 *
 * @param {string} repoPath
 * @param {string} featureId
 * @param {Function} effectExecutor
 * @param {object} [options]
 * @returns {Promise<{kind: string, snapshot?: object, message?: string}>}
 */
async function runEvalEffects(repoPath, featureId, effectExecutor, options = {}) {
  const result = await wf.runPendingEffects(repoPath, featureId, effectExecutor, options);

  if (result.kind === 'busy') {
    return {
      kind: 'busy',
      message:
        'Eval effects are already being executed by another process.\n' +
        'If you believe this is stale, re-run with --reclaim to force.',
    };
  }

  return { kind: 'complete', snapshot: result.snapshot };
}

// ---------------------------------------------------------------------------
// Default effect executor — operates on real docs/specs/features/ paths
// ---------------------------------------------------------------------------

/**
 * Default eval effect executor. Handles move_spec and write_eval_stub
 * using the real Aigon spec paths (docs/specs/features/).
 *
 * @param {string} repoPath
 * @param {string} featureId
 * @param {object} effect
 */
async function defaultEvalExecutor(repoPath, featureId, effect) {
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

  if (effect.type === 'write_eval_stub') {
    // The eval stub is a marker in the workflow directory.
    // The actual evaluation template is created by the feature-eval command
    // itself (not by the engine) because it depends on worktree context.
    const evalStubPath = path.join(wf.getFeatureRoot(repoPath, featureId), 'eval-started.md');
    await fsp.mkdir(path.dirname(evalStubPath), { recursive: true });
    try {
      await fsp.access(evalStubPath);
      // Already exists (idempotent)
      return;
    } catch {
      // Doesn't exist — create
    }
    const body = [
      `# Feature ${featureId} Evaluation`,
      '',
      `Started at: ${new Date().toISOString()}`,
      '',
    ].join('\n');
    await fsp.writeFile(evalStubPath, body, 'utf8');
    return;
  }
}

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

/**
 * Check if a workflow-core eval is already in progress for a feature.
 *
 * @param {string} repoPath
 * @param {string} featureId
 * @returns {Promise<{inProgress: boolean, state: string|null, hasPendingEffects: boolean}>}
 */
async function getWorkflowEvalState(repoPath, featureId) {
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
    inProgress: context.currentSpecState === 'evaluating' && hasPendingEffects,
    state: context.currentSpecState,
    hasPendingEffects,
  };
}

/**
 * Check whether a feature has engine state (was started via workflow-core).
 *
 * @param {string} repoPath
 * @param {string} featureId
 * @returns {Promise<boolean>}
 */
async function hasEngineState(repoPath, featureId) {
  const events = await wf.readEvents(wf.getEventsPath(repoPath, featureId));
  return events.length > 0;
}

module.exports = {
  isEvalEngineEnabled,
  synthesizeAgentReadySignals,
  runWorkflowEval,
  buildEvalEffects,
  resumeEval,
  runEvalEffects,
  defaultEvalExecutor,
  getWorkflowEvalState,
  hasEngineState,
};
