'use strict';

/**
 * Workflow heartbeat — periodic agent liveness signals and expiry detection.
 *
 * Agents emit `signal.heartbeat` periodically via `aigon agent-status implementing`.
 * The heartbeat sweep detects agents whose last heartbeat has expired and emits
 * `signal.heartbeat_expired` into the engine.
 *
 * Configuration (in .aigon/config.json):
 *   workflow.heartbeatIntervalMs — how often agents should heartbeat (default: 30000)
 *   workflow.heartbeatTimeoutMs  — how long before a heartbeat is considered expired (default: 90000)
 */

const { getSnapshotPath } = require('./workflow-core/paths');
const wf = require('./workflow-core');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30000; // 30 seconds
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 90000;  // 90 seconds (3x interval)

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Get heartbeat configuration from project config.
 * @param {object} [projectConfig] - From loadProjectConfig()
 * @returns {{ intervalMs: number, timeoutMs: number }}
 */
function getHeartbeatConfig(projectConfig) {
  const wfConfig = projectConfig?.workflow || {};
  return {
    intervalMs: wfConfig.heartbeatIntervalMs || DEFAULT_HEARTBEAT_INTERVAL_MS,
    timeoutMs: wfConfig.heartbeatTimeoutMs || DEFAULT_HEARTBEAT_TIMEOUT_MS,
  };
}

// ---------------------------------------------------------------------------
// Heartbeat emission
// ---------------------------------------------------------------------------

/**
 * Emit a heartbeat signal for an agent into the workflow engine.
 * Called from `agent-status implementing` to refresh the agent's liveness.
 *
 * @param {string} repoPath - Main repo path
 * @param {string} featureId - Padded feature ID
 * @param {string} agentId - Agent identifier
 * @returns {Promise<void>}
 */
async function emitHeartbeat(repoPath, featureId, agentId) {
  return wf.emitSignal(repoPath, featureId, 'heartbeat', agentId);
}

// ---------------------------------------------------------------------------
// Heartbeat sweep — detect expired agents
// ---------------------------------------------------------------------------

/**
 * Check all agents in a feature for expired heartbeats and emit
 * `signal.heartbeat_expired` for any that have timed out.
 *
 * This is meant to be called from the dashboard polling loop or
 * a dedicated sweep process (phase 5 orchestrator).
 *
 * @param {string} repoPath
 * @param {string} featureId
 * @param {object} [options]
 * @param {number} [options.timeoutMs] - Override timeout (default from config)
 * @param {object} [options.projectConfig] - Project config for timeout defaults
 * @returns {Promise<string[]>} Agent IDs that were marked as expired
 */
async function sweepExpiredHeartbeats(repoPath, featureId, options = {}) {
  const snapshotPath = getSnapshotPath(repoPath, featureId);
  if (!fs.existsSync(snapshotPath)) return [];

  const snapshot = await wf.showFeature(repoPath, featureId);
  if (!snapshot || !snapshot.agents) return [];

  const { timeoutMs } = options.timeoutMs !== undefined
    ? { timeoutMs: options.timeoutMs }
    : getHeartbeatConfig(options.projectConfig);

  const now = Date.now();
  const expiredAgents = [];

  for (const [agentId, agent] of Object.entries(snapshot.agents)) {
    // Only check running/waiting agents — ready/failed/lost agents don't need heartbeats
    if (agent.status !== 'running' && agent.status !== 'idle' && agent.status !== 'waiting') {
      continue;
    }

    // If no heartbeat recorded, use feature creation time as baseline
    const lastBeat = agent.lastHeartbeatAt
      ? new Date(agent.lastHeartbeatAt).getTime()
      : new Date(snapshot.createdAt).getTime();

    if (now - lastBeat > timeoutMs) {
      try {
        await wf.emitSignal(repoPath, featureId, 'heartbeat-expired', agentId);
        expiredAgents.push(agentId);
      } catch (err) {
        // Non-fatal — log but continue sweeping other agents
        console.error(`⚠️  Heartbeat expiry signal failed for ${agentId}: ${err.message}`);
      }
    }
  }

  return expiredAgents;
}

module.exports = {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
  getHeartbeatConfig,
  emitHeartbeat,
  sweepExpiredHeartbeats,
};
