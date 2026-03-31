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

      // --- Liveness: bridge heartbeat files to engine signals ---
      // The sidecar touches .aigon/state/heartbeat-{id}-{agent} every 30s.
      // We read that file's mtime and emit signals to keep the engine in sync.
      const wf = require('./workflow-core');
      const stateDir = path.join(absRepo, '.aigon', 'state');
      const heartbeatTimeoutMs = (projConfig.heartbeat && projConfig.heartbeat.timeoutMs)
        || DEFAULT_HEARTBEAT_TIMEOUT_MS;

      for (const [agentId, agent] of Object.entries(snapshot.agents)) {
        // Only check agents that could be alive
        if (agent.status === 'ready' || agent.status === 'failed') continue;

        const sessionName = expectedSessionName(absRepo, featureId, agentId);
        const tmuxAlive = tmuxSessionAlive(sessionName);

        // Check heartbeat file freshness
        const hbFile = path.join(stateDir, `heartbeat-${featureId}-${agentId}`);
        let hbFileFresh = false;
        try {
          const stat = fs.statSync(hbFile);
          hbFileFresh = (Date.now() - stat.mtimeMs) < heartbeatTimeoutMs;
        } catch (_) { /* file doesn't exist = not fresh */ }

        const isAlive = tmuxAlive || hbFileFresh;

        if (isAlive && (agent.status === 'lost' || agent.status === 'needs_attention')) {
          // Agent is alive but engine thinks it's dead — revive it
          try {
            await wf.emitSignal(absRepo, featureId, 'agent-started', agentId);
            log(`[revive] F${featureId} ${agentId}: alive (tmux=${tmuxAlive}, hb=${hbFileFresh}), was ${agent.status}`);
          } catch (e) {
            log(`[revive-err] F${featureId} ${agentId}: ${e.message}`);
          }
        } else if (isAlive && (agent.status === 'running' || agent.status === 'idle')) {
          // Agent is alive and engine knows — emit heartbeat to keep it fresh
          try {
            if (!wf.isSignalRedundant(snapshot, 'signal.heartbeat', agentId)) {
              await wf.emitSignal(absRepo, featureId, 'heartbeat', agentId);
            }
          } catch (_) { /* non-fatal */ }
        } else if (!isAlive && (agent.status === 'running' || agent.status === 'idle')) {
          // Agent is dead but engine thinks it's alive — mark as lost
          try {
            await wf.emitSignal(absRepo, featureId, 'heartbeat-expired', agentId);
            log(`[lost] F${featureId} ${agentId}: session dead, heartbeat stale`);
            sendNotification(`Agent lost: F${featureId} ${agentId}`, `Aigon - ${path.basename(absRepo)}`);
          } catch (e) {
            log(`[lost-err] F${featureId} ${agentId}: ${e.message}`);
          }
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
