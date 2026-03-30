'use strict';

/**
 * Effect runner and feature effect implementations.
 *
 * Ported from aigon-next/src/effects/runner.ts and feature-effects.ts.
 *
 * The tmux/session effect is stubbed — Aigon already manages tmux sessions
 * via lib/worktree.js. Full effect execution will be wired in a later feature.
 */

const fs = require('fs/promises');
const path = require('path');
const { getSpecStateDir } = require('./paths');

/**
 * @callback EffectExecutor
 * @param {string} repoPath
 * @param {string} featureId
 * @param {object} effect - EffectRequest
 * @returns {Promise<void>}
 */

/**
 * Run a list of effects sequentially using the given executor.
 * @param {string} repoPath
 * @param {string} featureId
 * @param {object[]} effects
 * @param {EffectExecutor} [executeEffect]
 * @returns {Promise<void>}
 */
async function runEffects(repoPath, featureId, effects, executeEffect = runFeatureEffect) {
  for (const effect of effects) {
    await executeEffect(repoPath, featureId, effect);
  }
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Default effect executor for feature-lifecycle side effects.
 * @param {string} repoPath
 * @param {string} featureId
 * @param {object} effect
 * @returns {Promise<void>}
 */
async function runFeatureEffect(repoPath, featureId, effect) {
  if (effect.type === 'ensure_feature_layout') {
    const lifecycle = effect.payload.lifecycle;
    const specDir = getSpecStateDir(repoPath, lifecycle);
    await fs.mkdir(specDir, { recursive: true });
    return;
  }

  if (effect.type === 'move_spec') {
    const fromPath = effect.payload.fromPath;
    const toPath = effect.payload.toPath;
    await fs.mkdir(path.dirname(toPath), { recursive: true });
    const sourceExists = await pathExists(fromPath);
    const targetExists = await pathExists(toPath);
    if (targetExists && !sourceExists) {
      return;
    }
    if (sourceExists) {
      await fs.rename(fromPath, toPath);
    }
    return;
  }

  if (effect.type === 'write_eval_stub') {
    const { getFeatureRoot } = require('./paths');
    const evalPath = path.join(getFeatureRoot(repoPath, featureId), 'eval.md');
    const body = [`# Feature ${featureId} Eval`, '', 'Evaluation requested.', ''].join('\n');
    await fs.writeFile(evalPath, body, 'utf8');
    return;
  }

  if (effect.type === 'write_close_note') {
    const { getFeatureRoot } = require('./paths');
    const closePath = path.join(getFeatureRoot(repoPath, featureId), 'closeout.md');
    const winner = effect.payload.winnerAgentId || 'none';
    const body = [`# Feature ${featureId} Closeout`, '', `Winner: ${winner}`, ''].join('\n');
    await fs.writeFile(closePath, body, 'utf8');
    return;
  }

  if (effect.type === 'ensure_agent_session') {
    // Stubbed — Aigon manages tmux sessions via lib/worktree.js.
    // Will be wired to the real implementation in a later feature.
    return;
  }
}

module.exports = { runEffects, runFeatureEffect };
