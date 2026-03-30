'use strict';

/**
 * Supervisor module — observes agent liveness and emits signals.
 *
 * Runs as a 30-second interval loop inside the same process as the HTTP
 * dashboard server.  The two modules share a process for operational simplicity
 * but have ZERO imports of each other.
 *
 * The supervisor does four things:
 *   1. Detects dead tmux sessions (agent running but session gone) -> signal.session_lost
 *   2. Detects expired heartbeats (agent running but no heartbeat) -> signal.heartbeat_expired
 *   3. Sends desktop notifications for problems
 *   4. Nothing else.
 *
 * The supervisor NEVER:
 *   - Kills tmux sessions
 *   - Restarts agents
 *   - Moves spec files
 *   - Writes agent status files
 *   - Makes decisions — it observes and reports via signals
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

// Config — read-only
const { readConductorReposFromGlobalConfig, loadProjectConfig } = require('./config');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SWEEP_INTERVAL_MS = 30000; // 30 seconds
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 120000; // 2 minutes

// ---------------------------------------------------------------------------
// State — last sweep timestamp for status reporting
// ---------------------------------------------------------------------------

let lastSweepAt = null;
let sweepCount = 0;
let intervalHandle = null;

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
 * Read all feature snapshots from a repo's workflow directory.
 * Returns array of { featureId, snapshot }.
 */
function readAllFeatureSnapshots(repoPath) {
  const featuresDir = path.join(repoPath, '.aigon', 'workflows', 'features');
  if (!fs.existsSync(featuresDir)) return [];

  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(featuresDir);
  } catch (_) {
    return [];
  }

  for (const entry of entries) {
    const snapshotFile = path.join(featuresDir, entry, 'snapshot.json');
    if (!fs.existsSync(snapshotFile)) continue;
    try {
      const raw = fs.readFileSync(snapshotFile, 'utf8');
      const snapshot = JSON.parse(raw);
      results.push({ featureId: entry, snapshot });
    } catch (_) {
      // Corrupted snapshot — skip silently
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Core sweep — runs every 30 seconds
// ---------------------------------------------------------------------------

/**
 * Single sweep iteration: check all agents across all repos.
 * Emits signals for dead sessions and expired heartbeats.
 */
async function sweep() {
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

    const snapshots = readAllFeatureSnapshots(absRepo);

    for (const { featureId, snapshot } of snapshots) {
      if (!snapshot.agents) continue;

      // Skip terminal lifecycle states
      const lifecycle = snapshot.lifecycle || '';
      if (lifecycle === 'done' || lifecycle === 'closing') continue;

      // --- Liveness observation (LOG ONLY — no engine mutations) ---
      // The supervisor observes but does NOT emit signals that change engine state.
      // Previous implementation marked agents as 'lost' which broke working features.
      // Signals will be re-enabled once the heartbeat/recovery cycle is proven reliable.
      for (const [agentId, agent] of Object.entries(snapshot.agents)) {
        if (agent.status !== 'running' && agent.status !== 'idle') continue;

        const sessionName = expectedSessionName(absRepo, featureId, agentId);
        const heartbeatFresh = agent.lastHeartbeatAt &&
          (Date.now() - new Date(agent.lastHeartbeatAt).getTime()) < DEFAULT_HEARTBEAT_TIMEOUT_MS;

        if (!tmuxSessionAlive(sessionName) && !heartbeatFresh) {
          log(`[observe] F${featureId} ${agentId}: session dead, heartbeat stale`);
          sendNotification(`Session may be lost: F${featureId} ${agentId}`, `Aigon - ${path.basename(absRepo)}`);
        }
      }

    }
  }

  lastSweepAt = new Date().toISOString();
  sweepCount++;
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

  log('Supervisor started (sweep every 30s)');

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
  return {
    running: intervalHandle !== null,
    lastSweepAt,
    sweepCount,
    intervalMs: SWEEP_INTERVAL_MS,
  };
}

module.exports = {
  startSupervisorLoop,
  stopSupervisorLoop,
  getSupervisorStatus,
  // Exported for testing
  sweep,
  readAllFeatureSnapshots,
  tmuxSessionAlive,
  expectedSessionName,
  sendNotification,
  SWEEP_INTERVAL_MS,
};
