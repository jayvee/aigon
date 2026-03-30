'use strict';

/**
 * Workflow heartbeat — periodic agent liveness signals and expiry detection.
 *
 * Agents emit `signal.heartbeat` periodically via `aigon agent-status implementing`.
 * The heartbeat sweep detects agents whose last heartbeat has expired and emits
 * `signal.heartbeat_expired` into the engine.
 *
 * Configuration (in .aigon/config.json):
 *   heartbeat.intervalMs — how often agents should heartbeat (default: 30000)
 *   heartbeat.timeoutMs  — how long before a heartbeat is considered expired (default: 120000)
 *
 * Legacy config paths (still supported, lower priority):
 *   workflow.heartbeatIntervalMs
 *   workflow.heartbeatTimeoutMs
 */

const { getSnapshotPath } = require('./workflow-core/paths');
const wf = require('./workflow-core');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30000; // 30 seconds
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 120000; // 120 seconds (4x interval)

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Get heartbeat configuration from project config.
 * @param {object} [projectConfig] - From loadProjectConfig()
 * @returns {{ intervalMs: number, timeoutMs: number }}
 */
function getHeartbeatConfig(projectConfig) {
  const hbConfig = projectConfig?.heartbeat || {};
  const wfConfig = projectConfig?.workflow || {};
  return {
    intervalMs: hbConfig.intervalMs || wfConfig.heartbeatIntervalMs || DEFAULT_HEARTBEAT_INTERVAL_MS,
    timeoutMs: hbConfig.timeoutMs || wfConfig.heartbeatTimeoutMs || DEFAULT_HEARTBEAT_TIMEOUT_MS,
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

// ---------------------------------------------------------------------------
// Recovery sweep — auto-restart lost/failed agents or escalate
// ---------------------------------------------------------------------------

/**
 * Sweep agents for recovery: auto-restart lost/failed agents up to maxRetries,
 * then escalate to needs-attention.
 *
 * @param {string} repoPath
 * @param {string} featureId
 * @param {object} [options]
 * @param {object} [options.recoveryConfig] - { autoRestart, maxRetries } from getRecoveryConfig()
 * @returns {Promise<{ restarted: string[], escalated: string[] }>}
 */
async function sweepAgentRecovery(repoPath, featureId, options = {}) {
  const snapshotPath = getSnapshotPath(repoPath, featureId);
  if (!fs.existsSync(snapshotPath)) return { restarted: [], escalated: [] };

  const snapshot = await wf.showFeature(repoPath, featureId);
  if (!snapshot || !snapshot.agents) return { restarted: [], escalated: [] };

  const recoveryConfig = options.recoveryConfig || { autoRestart: true, maxRetries: 2 };

  const restarted = [];
  const escalated = [];

  for (const [agentId, agent] of Object.entries(snapshot.agents)) {
    if (agent.status !== 'lost' && agent.status !== 'failed') continue;

    const restartCount = agent.restartCount || 0;
    if (recoveryConfig.autoRestart && restartCount < recoveryConfig.maxRetries) {
      try {
        await wf.restartAgent(repoPath, featureId, agentId);
        restarted.push(agentId);
      } catch (err) {
        console.error(`⚠️  Auto-restart failed for ${agentId}: ${err.message}`);
      }
    } else {
      try {
        await wf.escalateAgent(repoPath, featureId, agentId);
        escalated.push(agentId);
      } catch (err) {
        console.error(`⚠️  Escalation failed for ${agentId}: ${err.message}`);
      }
    }
  }

  return { restarted, escalated };
}

module.exports = {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
  getHeartbeatConfig,
  emitHeartbeat,
  sweepExpiredHeartbeats,
  sweepAgentRecovery,
};
