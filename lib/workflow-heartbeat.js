'use strict';

/**
 * Workflow heartbeat — periodic agent liveness signals and display-only freshness.
 *
 * Agents emit `signal.heartbeat` periodically via `aigon agent-status implementing`.
 * The heartbeat sidecar touches files in `.aigon/state/heartbeat-{id}-{agent}`.
 *
 * IMPORTANT: Heartbeat data is a DISPLAY concern only. It is used to show
 * liveness indicators (green/yellow/red) in the dashboard. It NEVER triggers
 * engine state transitions (no marking agents as 'lost').
 *
 * Configuration (in .aigon/config.json):
 *   heartbeat.intervalMs — how often agents should heartbeat (default: 30000)
 *   heartbeat.timeoutMs  — how long before a heartbeat is considered stale (default: 120000)
 *   heartbeat.deadMs     — how long before a heartbeat is considered dead (default: 300000)
 *
 * Legacy config paths (still supported, lower priority):
 *   workflow.heartbeatIntervalMs
 *   workflow.heartbeatTimeoutMs
 */

const path = require('path');
const wf = require('./workflow-core');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30000;  // 30 seconds
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 120000;  // 2 minutes — stale threshold
const DEFAULT_HEARTBEAT_DEAD_MS = 300000;     // 5 minutes — dead threshold

// ---------------------------------------------------------------------------
// Liveness levels (display-only)
// ---------------------------------------------------------------------------

const LIVENESS = {
  ALIVE: 'alive',   // heartbeat within timeout — green indicator
  STALE: 'stale',   // heartbeat past timeout but within dead threshold — yellow indicator
  DEAD: 'dead',     // heartbeat past dead threshold — red indicator
  UNKNOWN: 'unknown', // no heartbeat data available
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Get heartbeat configuration from project config.
 * @param {object} [projectConfig] - From loadProjectConfig()
 * @returns {{ intervalMs: number, timeoutMs: number, deadMs: number }}
 */
function getHeartbeatConfig(projectConfig) {
  const hbConfig = projectConfig?.heartbeat || {};
  const wfConfig = projectConfig?.workflow || {};
  return {
    intervalMs: hbConfig.intervalMs || wfConfig.heartbeatIntervalMs || DEFAULT_HEARTBEAT_INTERVAL_MS,
    timeoutMs: hbConfig.timeoutMs || wfConfig.heartbeatTimeoutMs || DEFAULT_HEARTBEAT_TIMEOUT_MS,
    deadMs: hbConfig.deadMs || DEFAULT_HEARTBEAT_DEAD_MS,
  };
}

// ---------------------------------------------------------------------------
// Heartbeat emission
// ---------------------------------------------------------------------------

/**
 * Emit a heartbeat signal for an agent into the workflow engine.
 * Called from `agent-status implementing` to refresh the agent's liveness.
 * Updates lastHeartbeatAt in the snapshot (display data only, no status change).
 *
 * @param {string} repoPath - Main repo path
 * @param {string} featureId - Padded feature ID
 * @param {string} agentId - Agent identifier
 * @returns {Promise<void>}
 */
async function emitHeartbeat(repoPath, featureId, agentId, options = {}) {
  const entityType = options.entityType || 'feature';
  return wf.emitSignal(repoPath, featureId, 'heartbeat', agentId, { entityType });
}

// ---------------------------------------------------------------------------
// Heartbeat file reading (display-only)
// ---------------------------------------------------------------------------

/**
 * Read the heartbeat file timestamp for a specific agent.
 * The heartbeat sidecar touches `.aigon/state/heartbeat-{id}-{agent}` every 30s.
 *
 * @param {string} repoPath - Main repo path
 * @param {string} entityId - Entity ID (feature or research)
 * @param {string} agentId - Agent identifier
 * @returns {number|null} Last heartbeat timestamp in ms, or null if no file
 */
function readHeartbeatFileTimestamp(repoPath, entityId, agentId) {
  const heartbeatFile = path.join(repoPath, '.aigon', 'state', `heartbeat-${entityId}-${agentId}`);
  try {
    const stat = fs.statSync(heartbeatFile);
    return stat.mtimeMs;
  } catch (_) {
    return null;
  }
}

/**
 * Compute liveness level for an agent based on heartbeat freshness.
 * This is a pure display computation — it never changes engine state.
 *
 * @param {object} options
 * @param {number|null} options.heartbeatFileMs - Heartbeat file mtime in ms
 * @param {string|null} options.lastHeartbeatAt - ISO string from engine snapshot
 * @param {boolean} options.tmuxAlive - Whether the tmux session is alive
 * @param {object} options.config - Heartbeat config { timeoutMs, deadMs }
 * @returns {{ liveness: string, lastSeenAt: string|null, heartbeatAgeMs: number|null }}
 */
function computeAgentLiveness(options) {
  const { heartbeatFileMs, lastHeartbeatAt, tmuxAlive, config } = options;
  const now = Date.now();

  // Determine the most recent heartbeat from either source
  const fileBeatMs = heartbeatFileMs || 0;
  const engineBeatMs = lastHeartbeatAt ? new Date(lastHeartbeatAt).getTime() : 0;
  const lastBeatMs = Math.max(fileBeatMs, engineBeatMs);

  if (lastBeatMs === 0) {
    // No heartbeat data at all
    return {
      liveness: tmuxAlive ? LIVENESS.ALIVE : LIVENESS.UNKNOWN,
      lastSeenAt: null,
      heartbeatAgeMs: null,
    };
  }

  const ageMs = now - lastBeatMs;
  const lastSeenAt = new Date(lastBeatMs).toISOString();

  // If tmux is alive, agent is alive regardless of heartbeat age
  if (tmuxAlive) {
    return { liveness: LIVENESS.ALIVE, lastSeenAt, heartbeatAgeMs: ageMs };
  }

  if (ageMs <= config.timeoutMs) {
    return { liveness: LIVENESS.ALIVE, lastSeenAt, heartbeatAgeMs: ageMs };
  }
  if (ageMs <= config.deadMs) {
    return { liveness: LIVENESS.STALE, lastSeenAt, heartbeatAgeMs: ageMs };
  }
  return { liveness: LIVENESS.DEAD, lastSeenAt, heartbeatAgeMs: ageMs };
}

module.exports = {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
  DEFAULT_HEARTBEAT_DEAD_MS,
  LIVENESS,
  getHeartbeatConfig,
  emitHeartbeat,
  readHeartbeatFileTimestamp,
  computeAgentLiveness,
};
