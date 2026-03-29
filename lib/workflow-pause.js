'use strict';

/**
 * Workflow-pause bridge — routes feature-pause and feature-resume through
 * the workflow-core engine.
 *
 * This module bridges the existing pause/resume commands with the new
 * workflow-core engine. It:
 *   1. Checks the `workflow.pauseEngine` feature flag
 *   2. Checks for existing engine state (no bootstrap — falls back to legacy)
 *   3. Emits pause/resume events with spec-move effects
 *   4. Runs effects through the engine's claim/reclaim lifecycle
 *
 * Unlike workflow-close, no bootstrap-from-legacy is needed here — if the
 * feature wasn't started via the engine, we fall back to the legacy path.
 */

const path = require('path');
const wf = require('./workflow-core');

// ---------------------------------------------------------------------------
// Feature flag
// ---------------------------------------------------------------------------

/**
 * Check whether the workflow-core pause engine is enabled.
 * Supports both config and env var overrides.
 *
 * @param {object} [projectConfig] - From loadProjectConfig()
 * @returns {boolean}
 */
function isPauseEngineEnabled(projectConfig) {
  if (process.env.AIGON_WORKFLOW_PAUSE_ENGINE === '1') return true;
  if (process.env.AIGON_WORKFLOW_PAUSE_ENGINE === '0') return false;
  return !!(projectConfig?.workflow?.pauseEngine);
}

// ---------------------------------------------------------------------------
// Pause
// ---------------------------------------------------------------------------

/**
 * Pause a feature through the workflow-core engine.
 *
 * Emits feature.paused event and runs spec-move effect through the
 * engine's claim/reclaim lifecycle.
 *
 * @param {string} repoPath - Absolute path to repo root
 * @param {string} featureId - Feature ID (e.g. '164')
 * @param {object} opts
 * @param {string} opts.specFromPath - Current spec path (in 03-in-progress/)
 * @param {string} opts.specToPath - Destination path (in 06-paused/)
 * @param {Function} [opts.effectExecutor] - Custom effect executor (defaults to built-in)
 * @param {object} [opts.engineOptions] - Options passed to runPendingEffects
 * @returns {Promise<{kind: string, snapshot?: object, message?: string}>}
 */
async function runWorkflowPause(repoPath, featureId, opts) {
  const { specFromPath, specToPath, effectExecutor, engineOptions } = opts;

  const snapshot = await wf.showFeature(repoPath, featureId);
  const hasPendingEffects = snapshot.effects.some((effect) => effect.status !== 'succeeded');

  if (snapshot.currentSpecState === 'paused') {
    if (hasPendingEffects) {
      return runPauseEffects(
        repoPath,
        featureId,
        effectExecutor || defaultPauseExecutor,
        engineOptions,
      );
    }
    return { kind: 'complete', snapshot, message: 'Feature already paused.' };
  }

  if (snapshot.currentSpecState !== 'implementing') {
    return {
      kind: 'error',
      message: `Cannot pause feature ${featureId} from state "${snapshot.currentSpecState}".`,
    };
  }

  // Emit pause event
  await wf.pauseFeature(repoPath, featureId);

  // Initialize pause effects (spec move)
  const pauseEffects = buildPauseEffects({ specFromPath, specToPath });

  if (pauseEffects.length > 0) {
    const now = new Date().toISOString();
    await wf.persistEvents(
      repoPath,
      featureId,
      pauseEffects.map((effect) => ({ type: 'effect.requested', effect, at: now })),
    );

    return runPauseEffects(
      repoPath,
      featureId,
      effectExecutor || defaultPauseExecutor,
      engineOptions,
    );
  }

  const updated = await wf.showFeature(repoPath, featureId);
  return { kind: 'complete', snapshot: updated };
}

/**
 * Build the list of pause effects.
 *
 * @param {object} opts
 * @param {string} opts.specFromPath - Source spec path (in-progress)
 * @param {string} opts.specToPath - Destination spec path (paused)
 * @returns {object[]} Effect definitions
 */
function buildPauseEffects({ specFromPath, specToPath }) {
  const effects = [];

  if (specFromPath && specToPath && specFromPath !== specToPath) {
    effects.push({
      id: 'bridge.pause.move_spec',
      type: 'move_spec',
      payload: { fromPath: specFromPath, toPath: specToPath },
    });
  }

  return effects;
}

// ---------------------------------------------------------------------------
// Resume
// ---------------------------------------------------------------------------

/**
 * Resume a paused feature through the workflow-core engine.
 *
 * Emits feature.resumed event and runs spec-move effect through the
 * engine's claim/reclaim lifecycle.
 *
 * @param {string} repoPath - Absolute path to repo root
 * @param {string} featureId - Feature ID (e.g. '164')
 * @param {object} opts
 * @param {string} opts.specFromPath - Current spec path (in 06-paused/)
 * @param {string} opts.specToPath - Destination path (in 03-in-progress/)
 * @param {Function} [opts.effectExecutor] - Custom effect executor (defaults to built-in)
 * @param {object} [opts.engineOptions] - Options passed to runPendingEffects
 * @returns {Promise<{kind: string, snapshot?: object, message?: string}>}
 */
async function runWorkflowResume(repoPath, featureId, opts) {
  const { specFromPath, specToPath, effectExecutor, engineOptions } = opts;

  const snapshot = await wf.showFeature(repoPath, featureId);
  const hasPendingEffects = snapshot.effects.some((effect) => effect.status !== 'succeeded');

  if (snapshot.currentSpecState === 'implementing') {
    if (hasPendingEffects) {
      return runResumeEffects(
        repoPath,
        featureId,
        effectExecutor || defaultPauseExecutor,
        engineOptions,
      );
    }
    return { kind: 'complete', snapshot, message: 'Feature already implementing.' };
  }

  if (snapshot.currentSpecState !== 'paused') {
    return {
      kind: 'error',
      message: `Cannot resume feature ${featureId} from state "${snapshot.currentSpecState}".`,
    };
  }

  // Emit resume event
  await wf.resumeFeature(repoPath, featureId);

  // Initialize resume effects (spec move)
  const resumeEffects = buildResumeEffects({ specFromPath, specToPath });

  if (resumeEffects.length > 0) {
    const now = new Date().toISOString();
    await wf.persistEvents(
      repoPath,
      featureId,
      resumeEffects.map((effect) => ({ type: 'effect.requested', effect, at: now })),
    );

    return runResumeEffects(
      repoPath,
      featureId,
      effectExecutor || defaultPauseExecutor,
      engineOptions,
    );
  }

  const updated = await wf.showFeature(repoPath, featureId);
  return { kind: 'complete', snapshot: updated };
}

/**
 * Build the list of resume effects.
 *
 * @param {object} opts
 * @param {string} opts.specFromPath - Source spec path (paused)
 * @param {string} opts.specToPath - Destination spec path (in-progress)
 * @returns {object[]} Effect definitions
 */
function buildResumeEffects({ specFromPath, specToPath }) {
  const effects = [];

  if (specFromPath && specToPath && specFromPath !== specToPath) {
    effects.push({
      id: 'bridge.resume.move_spec',
      type: 'move_spec',
      payload: { fromPath: specFromPath, toPath: specToPath },
    });
  }

  return effects;
}

// ---------------------------------------------------------------------------
// Effect runners
// ---------------------------------------------------------------------------

/**
 * Run pending pause effects with the engine's claim/reclaim lifecycle.
 *
 * @param {string} repoPath
 * @param {string} featureId
 * @param {Function} effectExecutor
 * @param {object} [options]
 * @returns {Promise<{kind: string, snapshot?: object, message?: string}>}
 */
async function runPauseEffects(repoPath, featureId, effectExecutor, options = {}) {
  const result = await wf.runPendingEffects(repoPath, featureId, effectExecutor, options);

  if (result.kind === 'busy') {
    return {
      kind: 'busy',
      message:
        'Pause effects are already being executed by another process.\n' +
        'If you believe this is stale, re-run with --reclaim to force.',
    };
  }

  return { kind: 'complete', snapshot: result.snapshot };
}

/**
 * Run pending resume effects with the engine's claim/reclaim lifecycle.
 *
 * @param {string} repoPath
 * @param {string} featureId
 * @param {Function} effectExecutor
 * @param {object} [options]
 * @returns {Promise<{kind: string, snapshot?: object, message?: string}>}
 */
async function runResumeEffects(repoPath, featureId, effectExecutor, options = {}) {
  const result = await wf.runPendingEffects(repoPath, featureId, effectExecutor, options);

  if (result.kind === 'busy') {
    return {
      kind: 'busy',
      message:
        'Resume effects are already being executed by another process.\n' +
        'If you believe this is stale, re-run with --reclaim to force.',
    };
  }

  return { kind: 'complete', snapshot: result.snapshot };
}

// ---------------------------------------------------------------------------
// Default effect executor
// ---------------------------------------------------------------------------

/**
 * Default pause/resume effect executor. Handles move_spec using real
 * Aigon spec paths (docs/specs/features/).
 *
 * @param {string} repoPath
 * @param {string} featureId
 * @param {object} effect
 */
async function defaultPauseExecutor(repoPath, featureId, effect) {
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
}

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

/**
 * Check workflow-core state for a feature (pause/resume context).
 * Returns null state if no engine events exist (signals legacy fallback).
 *
 * @param {string} repoPath
 * @param {string} featureId
 * @returns {Promise<{state: string|null, hasPendingEffects: boolean}>}
 */
async function getWorkflowPauseState(repoPath, featureId) {
  const events = await wf.readEvents(wf.getEventsPath(repoPath, featureId));
  if (events.length === 0) {
    return { state: null, hasPendingEffects: false };
  }
  const context = wf.projectContext(events);
  if (!context) {
    return { state: null, hasPendingEffects: false };
  }
  const hasPendingEffects = context.effects.some((e) => e.status !== 'succeeded');
  return {
    state: context.currentSpecState,
    hasPendingEffects,
  };
}

module.exports = {
  isPauseEngineEnabled,
  runWorkflowPause,
  buildPauseEffects,
  runWorkflowResume,
  buildResumeEffects,
  runPauseEffects,
  runResumeEffects,
  defaultPauseExecutor,
  getWorkflowPauseState,
};
