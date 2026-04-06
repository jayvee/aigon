'use strict';

/**
 * Supervisor module — observes agent liveness and provides display data.
 *
 * Runs as a 30-second interval loop inside the same process as the HTTP
 * dashboard server.  The two modules share a process for operational simplicity
 * but have ZERO imports of each other.
 *
 * Each sweep:
 *   1. For every active feature and research entity, checks agents in running/idle.
 *   2. Computes liveness (alive/stale/dead) from tmux session + heartbeat file.
 *   3. Stores liveness data in memory for the dashboard to read.
 *   4. Sends desktop notifications for genuinely dead agents.
 *
 * The supervisor NEVER:
 *   - Emits signals into the workflow engine
 *   - Changes agent lifecycle state
 *   - Kills tmux sessions
 *   - Restarts agents
 *   - Moves spec files
 *   - Writes agent status files
 *   - Makes decisions — it observes and reports
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

// Config — read-only
const { readConductorReposFromGlobalConfig, loadProjectConfig } = require('./config');

// Heartbeat — display-only liveness computation
const {
  getHeartbeatConfig,
  readHeartbeatFileTimestamp,
  computeAgentLiveness,
  LIVENESS,
} = require('./workflow-heartbeat');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SWEEP_INTERVAL_MS = 30000; // 30 seconds

// ---------------------------------------------------------------------------
// State — liveness data and sweep metadata
// ---------------------------------------------------------------------------

let lastSweepAt = null;
let sweepCount = 0;
let intervalHandle = null;

/**
 * In-memory liveness data. Keyed by `{repoPath}:{entityType}:{entityId}:{agentId}`.
 * Values are { liveness, lastSeenAt, heartbeatAgeMs, tmuxAlive, notifiedDead }.
 * @type {Map<string, object>}
 */
const livenessData = new Map();

// ---------------------------------------------------------------------------
// Tmux helpers — local, no import from worktree.js
// ---------------------------------------------------------------------------

/**
 * Check whether a tmux session with the given name exists.
 * Self-contained — does not import from worktree.js.
 */
function tmuxSessionAlive(sessionName) {
  try {
    const result = spawnSync('tmux', ['has-session', '-t', sessionName], { stdio: 'ignore' });
    return !result.error && result.status === 0;
  } catch (_) {
    return false;
  }
}

/**
 * Build the expected tmux session name for a feature agent.
 * Convention: {repoBasename}-f{id}-{agent}
 */
function expectedSessionName(repoPath, featureId, agentId) {
  const repo = path.basename(path.resolve(repoPath));
  const num = String(parseInt(featureId, 10)); // unpadded
  return `${repo}-f${num}-${agentId}`;
}

/**
 * Build the expected tmux session name for a research agent.
 * Convention: {repoBasename}-r{id}-{agent}
 */
function expectedResearchSessionName(repoPath, researchId, agentId) {
  const repo = path.basename(path.resolve(repoPath));
  const num = String(parseInt(researchId, 10)); // unpadded
  return `${repo}-r${num}-${agentId}`;
}

// ---------------------------------------------------------------------------
// Notification — self-contained macOS/Linux desktop notifications
// ---------------------------------------------------------------------------

function sendNotification(message, title) {
  title = title || 'Aigon Supervisor';
  if (process.platform === 'darwin') {
    try {
      const tnPath = execSync('which terminal-notifier 2>/dev/null', { encoding: 'utf8' }).trim();
      if (tnPath) {
        spawnSync(tnPath, ['-title', title, '-message', message, '-group', 'aigon-supervisor', '-sender', 'com.apple.Terminal'], { stdio: 'ignore' });
        return;
      }
    } catch (_) { /* fall through */ }
    try {
      execSync(`osascript -e 'display notification "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"'`);
    } catch (_) { /* non-fatal */ }
  } else if (process.platform === 'linux') {
    try {
      spawnSync('notify-send', [title, message], { stdio: 'ignore' });
    } catch (_) { /* non-fatal */ }
  }
}

// ---------------------------------------------------------------------------
// Logging — writes to stderr, captured by dashboard log when co-hosted
// ---------------------------------------------------------------------------

function log(msg) {
  const ts = new Date().toISOString().slice(11, 23);
  process.stderr.write(`[supervisor ${ts}] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// Snapshot scanning — find all active features in a repo
// ---------------------------------------------------------------------------

/**
 * Read all entity snapshots from a repo's workflow directory.
 * @param {string} repoPath
 * @param {string} entityDir - 'features' or 'research'
 * @returns {Array<{ entityId: string, snapshot: object }>}
 */
function readAllEntitySnapshots(repoPath, entityDir) {
  const dir = path.join(repoPath, '.aigon', 'workflows', entityDir);
  if (!fs.existsSync(dir)) return [];

  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (_) {
    return [];
  }

  for (const entry of entries) {
    const snapshotFile = path.join(dir, entry, 'snapshot.json');
    if (!fs.existsSync(snapshotFile)) continue;
    try {
      const raw = fs.readFileSync(snapshotFile, 'utf8');
      const snapshot = JSON.parse(raw);
      results.push({ entityId: entry, snapshot });
    } catch (_) {
      // Corrupted snapshot — skip silently
    }
  }

  return results;
}

function readAllFeatureSnapshots(repoPath) {
  return readAllEntitySnapshots(repoPath, 'features');
}

function readAllResearchSnapshots(repoPath) {
  return readAllEntitySnapshots(repoPath, 'research');
}

// ---------------------------------------------------------------------------
// Entity sweep — compute liveness for all agents (no engine mutations)
// ---------------------------------------------------------------------------

/**
 * Sweep a single entity (feature or research) for agent liveness.
 * Computes liveness and stores it in the in-memory map.
 * Sends notifications for dead agents (once per dead transition).
 * NEVER emits signals or changes engine state.
 */
function sweepEntity(repoPath, entityType, entityId, snapshot, projConfig) {
  if (!snapshot.agents) return;

  // Skip terminal lifecycle states
  const lifecycle = snapshot.lifecycle || '';
  if (lifecycle === 'done' || lifecycle === 'closing') return;

  const hbConfig = getHeartbeatConfig(projConfig);
  const prefix = entityType === 'research' ? 'R' : 'F';

  for (const [agentId, agent] of Object.entries(snapshot.agents)) {
    // Only check agents that could plausibly be alive
    if (agent.status !== 'running' && agent.status !== 'idle') continue;

    const sessionName = entityType === 'research'
      ? expectedResearchSessionName(repoPath, entityId, agentId)
      : expectedSessionName(repoPath, entityId, agentId);
    const tmuxAlive = tmuxSessionAlive(sessionName);
    const heartbeatFileMs = readHeartbeatFileTimestamp(repoPath, entityId, agentId);

    const liveness = computeAgentLiveness({
      heartbeatFileMs,
      lastHeartbeatAt: agent.lastHeartbeatAt || null,
      tmuxAlive,
      config: hbConfig,
    });

    const key = `${repoPath}:${entityType}:${entityId}:${agentId}`;
    const prev = livenessData.get(key);
    const alreadyNotified = prev?.notifiedDead || false;

    livenessData.set(key, {
      ...liveness,
      tmuxAlive,
      notifiedDead: liveness.liveness === LIVENESS.DEAD ? true : false,
    });

    // Send desktop notification on first transition to dead
    if (liveness.liveness === LIVENESS.DEAD && !alreadyNotified) {
      log(`[liveness] ${prefix}${entityId} ${agentId}: dead (tmux=${tmuxAlive}, age=${liveness.heartbeatAgeMs}ms)`);
      sendNotification(
        `Agent may need attention: ${prefix}${entityId} ${agentId}`,
        `Aigon - ${path.basename(repoPath)}`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Core sweep — runs every 30 seconds
// ---------------------------------------------------------------------------

/**
 * Single sweep iteration: check all agents across all repos.
 * Computes liveness data for dashboard display. Never changes engine state.
 */
async function sweep() {
  // Guard: ensure process cwd is valid — seed-reset or worktree removal
  // can delete the directory from under us, crashing all shell commands.
  try { process.cwd(); } catch (_) {
    try { process.chdir(os.homedir()); } catch (_2) {}
  }

  const repos = readConductorReposFromGlobalConfig();
  if (!repos || repos.length === 0) return;

  for (const repoPath of repos) {
    const absRepo = path.resolve(repoPath);
    if (!fs.existsSync(absRepo)) continue;

    let projConfig;
    try {
      projConfig = loadProjectConfig(absRepo);
    } catch (_) {
      projConfig = {};
    }

    // Sweep features
    const featureSnapshots = readAllFeatureSnapshots(absRepo);
    for (const { entityId, snapshot } of featureSnapshots) {
      try { sweepEntity(absRepo, 'feature', entityId, snapshot, projConfig); }
      catch (e) { log(`sweep skip F${entityId}: ${e.message}`); }
    }

    // Sweep research
    const researchSnapshots = readAllResearchSnapshots(absRepo);
    for (const { entityId, snapshot } of researchSnapshots) {
      try { sweepEntity(absRepo, 'research', entityId, snapshot, projConfig); }
      catch (e) { log(`sweep skip R${entityId}: ${e.message}`); }
    }
  }

  lastSweepAt = new Date().toISOString();
  sweepCount++;
}

// ---------------------------------------------------------------------------
// Liveness data access (for dashboard status collector)
// ---------------------------------------------------------------------------

/**
 * Get liveness data for a specific agent.
 * @param {string} repoPath
 * @param {string} entityType - 'feature' or 'research'
 * @param {string} entityId
 * @param {string} agentId
 * @returns {{ liveness: string, lastSeenAt: string|null, heartbeatAgeMs: number|null, tmuxAlive: boolean }|null}
 */
function getAgentLiveness(repoPath, entityType, entityId, agentId) {
  const key = `${repoPath}:${entityType}:${entityId}:${agentId}`;
  return livenessData.get(key) || null;
}

/**
 * Get all liveness data (for debugging/status reporting).
 * @returns {Map<string, object>}
 */
function getAllLivenessData() {
  return new Map(livenessData);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the supervisor loop. Runs sweep() every 30 seconds.
 * Safe to call multiple times — only one loop will run.
 *
 * @returns {{ stop: Function }} Handle to stop the loop
 */
function startSupervisorLoop() {
  if (intervalHandle) return { stop: stopSupervisorLoop };

  log('Supervisor started (sweep every 30s, observe-only)');

  // Run first sweep after a short delay to let the server settle
  setTimeout(() => {
    sweep().catch(err => log(`sweep error: ${err.message}`));
  }, 5000);

  intervalHandle = setInterval(() => {
    sweep().catch(err => log(`sweep error: ${err.message}`));
  }, SWEEP_INTERVAL_MS);

  // Don't let the interval keep the process alive if the server shuts down
  if (intervalHandle.unref) intervalHandle.unref();

  return { stop: stopSupervisorLoop };
}

/**
 * Stop the supervisor loop.
 */
function stopSupervisorLoop() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    log('Supervisor stopped');
  }
}

/**
 * Get supervisor status for reporting.
 */
function getSupervisorStatus() {
  // Derive sweep health from the age of the last successful sweep.
  // Pure derivation — observe-only, no state mutation, no side effects.
  // Thresholds: healthy < 90s (≈ up to 2 missed 30s sweeps), stale < 5min, dead beyond.
  const lastMs = lastSweepAt ? Date.parse(lastSweepAt) : null;
  const ageMs = lastMs ? Date.now() - lastMs : null;
  let sweepHealth = 'dead';
  if (ageMs !== null) {
    if (ageMs < 90 * 1000) sweepHealth = 'healthy';
    else if (ageMs < 5 * 60 * 1000) sweepHealth = 'stale';
  }
  return {
    running: intervalHandle !== null,
    lastSweepAt,
    sweepCount,
    intervalMs: SWEEP_INTERVAL_MS,
    trackedAgents: livenessData.size,
    sweepHealth,
  };
}

module.exports = {
  startSupervisorLoop,
  stopSupervisorLoop,
  getSupervisorStatus,
  getAgentLiveness,
  getAllLivenessData,
  // Exported for testing
  sweep,
  sweepEntity,
  readAllFeatureSnapshots,
  readAllResearchSnapshots,
  tmuxSessionAlive,
  expectedSessionName,
  expectedResearchSessionName,
  sendNotification,
  SWEEP_INTERVAL_MS,
};
