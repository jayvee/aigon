'use strict';

/**
 * Supervisor module — observes agent liveness, idle, awaiting-input, and token exhaustion.
 *
 * Runs as a 30-second interval loop inside the same process as the HTTP
 * dashboard server. The two modules share a process for operational simplicity
 * but have ZERO imports of each other.
 *
 * Each sweep:
 *   1. For every active feature and research entity, checks agents in running/idle.
 *   2. Computes liveness (alive/stale/dead) from tmux session + heartbeat file.
 *   3. Stores liveness data in memory for the dashboard to read.
 *   4. On token exhaustion (positive detector): may append workflow events, update
 *      agent-status flags, pause the feature, notify, and/or kill the slot tmux session
 *      and spawn a replacement agent per `agentFailover` policy.
 *   5. Sends desktop notifications for idle thresholds, awaiting-input, and dead agents.
 *
 * The supervisor NEVER moves spec files. It does not implement liveness-based kills;
 * token-exhaustion auto-switch is the intentional exception for F308 failover.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

// Config — read-only
const { readConductorReposFromGlobalConfig, loadProjectConfig, loadGlobalConfig } = require('./config');
const workflowEngine = require('./workflow-core');
const { readAgentStatusRecordAt, writeAgentStatusAt } = require('./agent-status');
const {
    buildTokenExhaustionSignal,
    resolveFailoverConfig,
    getAgentRuntimeId,
    getLastReachableCommit,
} = require('./agent-exhaustion-detect');
const { runTmux } = require('./worktree');
const { resolveFeatureWorktreePath, safeFeatureAutoSessionExists } = require('./dashboard-status-helpers');
const { loadAgentConfig } = require('./templates');

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

const SWEEP_INTERVAL_MS = Number(process.env.AIGON_SUPERVISOR_SWEEP_MS) || 30000; // 30 seconds (override via env for tests)

// Progress event types that reset the idle clock (same family agent-status drives).
// signal.heartbeat is intentionally excluded — long test runs should not mask idle.
const PROGRESS_TYPES = new Set([
  'signal.agent_started',
  'signal.agent_waiting',
  'signal.agent_ready',
  'signal.agent_submitted',
  'signal.agent_failed',
]);

// Default idle thresholds (minutes). Overridable via ~/.aigon/config.json
// under supervisor.idleThresholdsMinutes: { soft, notify, sticky }.
const DEFAULT_IDLE_THRESHOLDS = { soft: 10, notify: 20, sticky: 60 };
const VALID_TMUX_ROLES = ['do', 'eval', 'review', 'spec-review', 'spec-revise', 'spec-check'];

// ---------------------------------------------------------------------------
// State — liveness data and sweep metadata
// ---------------------------------------------------------------------------

let lastSweepAt = null;
let sweepCount = 0;
let intervalHandle = null;
/** @type {(() => boolean)|null} */
let shouldSkipSweep = null;
let sweepInFlight = false;

function setSweepSkipGuard(fn) {
  shouldSkipSweep = typeof fn === 'function' ? fn : null;
}

function isSweepInFlight() {
  return sweepInFlight;
}

/** Yield the event loop so HTTP handlers stay responsive during long sweeps. */
function yieldEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * In-memory liveness data. Keyed by `{repoPath}:{entityType}:{entityId}:{agentId}`.
 * Values are { liveness, lastSeenAt, heartbeatAgeMs, tmuxAlive, notifiedDead }.
 * @type {Map<string, object>}
 */
const livenessData = new Map();

/**
 * Registered exhaustion handlers — wired by @aigon/pro at startup via
 * registerExhaustionHandler(). If empty and policy=switch is configured,
 * the supervisor logs a one-line warning and takes no action.
 */
const exhaustionHandlers = [];

function registerExhaustionHandler(fn) {
  if (typeof fn === 'function') exhaustionHandlers.push(fn);
}

/**
 * Per-agent last-seen `awaitingInput.at` timestamp. Used to fire a desktop
 * notification only on the absent→present transition (or when the question
 * text changes — new `at` timestamp). Keyed the same as livenessData.
 * @type {Map<string, string>}
 */
const awaitingInputSeen = new Map();

/**
 * In-memory idle state. Keyed same as livenessData.
 * Values are { level: 'soft'|'notify'|'sticky', idleMinutes: number } or null.
 * @type {Map<string, object|null>}
 */
const idleData = new Map();

/**
 * Tracks the highest idle level for which a desktop notification was fired,
 * per session key. Prevents re-firing on every sweep tick.
 * @type {Map<string, string>}
 */
const notifiedIdle = new Map();

/**
 * Per-agent "agent is sitting at its idle REPL prompt" derived from
 * `tmux capture-pane` + the agent JSON `idleDetection` patterns. Recomputed
 * every sweep, never written to disk. Keyed same as livenessData.
 * Values are { idleAtPrompt: bool, detectedAt: ISO } or null.
 * @type {Map<string, object|null>}
 */
const idleAtPromptData = new Map();

/**
 * Per-agent compiled regex cache for idleDetection patterns. Keyed by agentId.
 * Avoids recompiling every sweep. Value is { idle: RegExp|null, working: RegExp|null }
 * or null when the agent has no idleDetection block.
 * @type {Map<string, object|null>}
 */
const idleDetectionCache = new Map();

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

function listTmuxSessionNames() {
  try {
    const result = spawnSync('tmux', ['list-sessions', '-F', '#S'], { encoding: 'utf8' });
    if (result.error || result.status !== 0 || !result.stdout) return [];
    return result.stdout.split(/\r?\n/).map(name => name.trim()).filter(Boolean);
  } catch (_) {
    return [];
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

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find the live tmux session name for an agent using the current role-aware
 * naming scheme, while still tolerating the legacy no-role form.
 */
function findLiveAgentSessionName(repoPath, entityType, entityId, agentId) {
  const repo = escapeRegex(path.basename(path.resolve(repoPath)));
  const typeChar = entityType === 'research' ? 'r' : 'f';
  const num = escapeRegex(String(parseInt(entityId, 10)));
  const agent = escapeRegex(agentId);
  const rolePattern = VALID_TMUX_ROLES.map(escapeRegex).join('|');
  const patterns = [
    new RegExp(`^${repo}-${typeChar}${num}-(?:${rolePattern})-${agent}(?:-|$)`),
    new RegExp(`^${repo}-${typeChar}${num}-${agent}(?:-|$)`),
  ];
  const matches = listTmuxSessionNames().filter(name => patterns.some(pattern => pattern.test(name)));
  if (matches.length === 0) return null;
  matches.sort();
  return matches[0];
}

// ---------------------------------------------------------------------------
// Idle-at-prompt detection — capture-pane + per-agent regex
// ---------------------------------------------------------------------------

const ANSI_ESCAPE_RE = /\x1b\[[0-9;?]*[a-zA-Z]/g;
const IDLE_CAPTURE_LINES = 8;

function stripAnsi(text) {
  return String(text || '').replace(ANSI_ESCAPE_RE, '');
}

/**
 * Resolve and cache compiled idleDetection regexes for an agent.
 * Returns null when the agent has no idleDetection.idlePattern defined,
 * which signals the supervisor to skip capture-pane entirely.
 */
function getIdleDetectionRegexes(agentId) {
  if (idleDetectionCache.has(agentId)) return idleDetectionCache.get(agentId);
  let resolved = null;
  try {
    const cfg = loadAgentConfig(agentId);
    const block = cfg && cfg.idleDetection;
    if (block && typeof block.idlePattern === 'string' && block.idlePattern.trim()) {
      const idle = new RegExp(block.idlePattern);
      const working = (typeof block.workingPattern === 'string' && block.workingPattern.trim())
        ? new RegExp(block.workingPattern)
        : null;
      resolved = { idle, working };
    }
  } catch (_) { /* unknown agent or bad regex — treat as no detection */ }
  idleDetectionCache.set(agentId, resolved);
  return resolved;
}

/**
 * Capture the recent tmux pane output as plain (ansi-stripped) text. Returns
 * null when capture-pane fails or the session is gone. Shared by idle and
 * exhaustion detection so we only run `tmux capture-pane` once per sweep.
 */
function capturePaneText(sessionName, lines = IDLE_CAPTURE_LINES) {
  if (!sessionName) return null;
  try {
    const result = runTmux(
      ['capture-pane', '-p', '-t', sessionName, '-S', `-${lines}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    if (result.error || result.status !== 0) return null;
    return stripAnsi(result.stdout);
  } catch (_) {
    return null;
  }
}

/**
 * Decide if an agent is sitting at its idle REPL prompt, given pre-captured
 * pane text. Returns null when the agent has no idleDetection block.
 *
 * `workingPattern` short-circuits: any match means the agent is computing
 * (e.g. an LLM call in flight), so idleAtPrompt is forced to false even if
 * the idle prompt chrome is also visible higher in the buffer.
 */
function detectIdleFromText(text, agentId) {
  const regexes = getIdleDetectionRegexes(agentId);
  if (!regexes) return null;
  if (typeof text !== 'string' || text.length === 0) return null;
  if (regexes.working && regexes.working.test(text)) {
    return { idleAtPrompt: false, detectedAt: new Date().toISOString() };
  }
  const idleAtPrompt = regexes.idle.test(text);
  return { idleAtPrompt, detectedAt: new Date().toISOString() };
}

/**
 * Backwards-compatible wrapper that captures and detects in one call. Kept for
 * callers/tests that don't have pre-captured text on hand.
 */
function captureAndDetectIdle(sessionName, agentId) {
  const text = capturePaneText(sessionName);
  if (text === null) return null;
  return detectIdleFromText(text, agentId);
}

// ---------------------------------------------------------------------------
// Idle detection helpers
// ---------------------------------------------------------------------------

/**
 * Get idle thresholds from global config, with defaults.
 * @returns {{ soft: number, notify: number, sticky: number }} minutes
 */
function getIdleThresholds() {
  try {
    const globalConfig = loadGlobalConfig();
    const t = globalConfig && globalConfig.supervisor && globalConfig.supervisor.idleThresholdsMinutes;
    if (t && typeof t === 'object') {
      return {
        soft: Number(t.soft) || DEFAULT_IDLE_THRESHOLDS.soft,
        notify: Number(t.notify) || DEFAULT_IDLE_THRESHOLDS.notify,
        sticky: Number(t.sticky) || DEFAULT_IDLE_THRESHOLDS.sticky,
      };
    }
  } catch (_) { /* non-fatal */ }
  return { ...DEFAULT_IDLE_THRESHOLDS };
}

/**
 * Read the last progress event timestamp for an agent from events.jsonl (sync).
 * Returns milliseconds timestamp or null if no progress events found.
 * Reads the entire file but only scans for PROGRESS_TYPES — lightweight for
 * typical event log sizes (hundreds of lines).
 */
function readLastProgressEventMs(repoPath, entityType, entityId, agentId) {
  const entityDir = entityType === 'research' ? 'research' : 'features';
  const eventsPath = path.join(repoPath, '.aigon', 'workflows', entityDir, entityId, 'events.jsonl');
  let lastMs = null;
  try {
    const content = fs.readFileSync(eventsPath, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const event = JSON.parse(lines[i]);
        if (PROGRESS_TYPES.has(event.type) && event.agentId === agentId && event.at) {
          lastMs = new Date(event.at).getTime();
          break;
        }
      } catch (_) { /* skip malformed line */ }
    }
  } catch (_) { /* no events file or unreadable */ }
  return lastMs;
}

/**
 * Compute idle state for an agent session.
 * @param {string} repoPath
 * @param {string} entityType - 'feature' or 'research'
 * @param {string} entityId
 * @param {string} agentId
 * @param {{ soft: number, notify: number, sticky: number }} thresholds - minutes
 * @param {number|null} sessionStartedAt - fallback epoch ms when no progress events found
 * @returns {{ level: string, idleMinutes: number }|null}
 */
function computeIdleState(repoPath, entityType, entityId, agentId, thresholds, sessionStartedAt) {
  const lastProgressMs = readLastProgressEventMs(repoPath, entityType, entityId, agentId);
  const refMs = lastProgressMs !== null ? lastProgressMs : sessionStartedAt;
  if (refMs === null) return null;
  const idleMs = Date.now() - refMs;
  const idleMinutes = Math.floor(idleMs / 60_000);
  if (idleMs > thresholds.sticky * 60_000) return { level: 'sticky', idleMinutes };
  if (idleMs > thresholds.notify * 60_000) return { level: 'notify', idleMinutes };
  if (idleMs > thresholds.soft * 60_000) return { level: 'soft', idleMinutes };
  return null;
}

/**
 * Whether desktop notifications are enabled for supervisor events.
 * Reads supervisorNotifications from global config (default: true).
 */
function isSupervisorNotificationsEnabled() {
  try {
    const globalConfig = loadGlobalConfig();
    if (globalConfig && globalConfig.supervisorNotifications === false) return false;
  } catch (_) { /* non-fatal */ }
  return true;
}

// ---------------------------------------------------------------------------
// Notification — self-contained macOS/Linux desktop notifications
// ---------------------------------------------------------------------------

let terminalNotifierPathPromise = null;

function runNotificationProcess(bin, args, options = {}) {
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 5000;
  return new Promise(resolve => {
    let settled = false;
    let child;
    let stdout = '';
    let timer = null;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ ok, stdout });
    };
    try {
      child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (_) {
      finish(false);
      return;
    }
    timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch (_) {}
      finish(false);
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    if (child.stdout) child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.on('error', () => finish(false));
    child.on('close', code => finish(code === 0));
  });
}

function resolveTerminalNotifierPath() {
  if (!terminalNotifierPathPromise) {
    terminalNotifierPathPromise = runNotificationProcess('which', ['terminal-notifier'], { timeoutMs: 1000 })
      .then(result => {
        const found = result.ok ? String(result.stdout || '').trim().split(/\r?\n/)[0] : '';
        return found || null;
      })
      .catch(() => null);
  }
  return terminalNotifierPathPromise;
}

async function deliverNotification(message, title) {
  if (process.platform === 'darwin') {
    const tnPath = await resolveTerminalNotifierPath();
    if (tnPath) {
      const result = await runNotificationProcess(
        tnPath,
        ['-title', title, '-message', message, '-group', 'aigon-supervisor', '-sender', 'com.apple.Terminal'],
        { timeoutMs: 5000 }
      );
      if (result.ok) return;
    }
    await runNotificationProcess(
      'osascript',
      ['-e', `display notification ${JSON.stringify(String(message))} with title ${JSON.stringify(String(title))}`],
      { timeoutMs: 5000 }
    );
  } else if (process.platform === 'linux') {
    await runNotificationProcess('notify-send', [title, message], { timeoutMs: 5000 });
  }
}

function sendNotification(message, title) {
  title = title || 'Aigon Supervisor';
  deliverNotification(String(message), String(title)).catch(() => {});
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

function markTokenExhaustedFlag(repoPath, entityType, entityId, agentId, payload) {
  const prefix = entityType === 'research' ? 'research' : 'feature';
  const existing = readAgentStatusRecordAt(repoPath, entityId, agentId, { prefixes: [prefix] });
  const current = existing && existing.data ? existing.data : {};
  const flags = {
    ...(current.flags || {}),
    tokenExhausted: true,
    tokenExhaustedAt: payload.at,
    tokenExhaustedSource: payload.source,
  };
  writeAgentStatusAt(repoPath, entityId, agentId, {
    // Flip status to 'needs_attention' so the dashboard slot card stops
    // rendering "Implementing" for an exhausted slot. Previously we kept
    // whatever status was already there, which left an exhausted cx slot
    // showing the same green "Implementing" badge as a healthy one — making
    // it impossible to tell at a glance that a slot needs intervention.
    status: 'needs_attention',
    worktreePath: current.worktreePath || null,
    runtimeAgentId: payload.currentAgentId || current.runtimeAgentId || agentId,
    lastExitCode: current.lastExitCode != null ? current.lastExitCode : null,
    lastPaneTail: current.lastPaneTail || null,
    flags,
  }, prefix);
}

function resolveSlotWorktreePath(repoPath, featureId, agentId) {
  const record = readAgentStatusRecordAt(repoPath, featureId, agentId, { prefixes: ['feature'] });
  if (record && record.data && record.data.worktreePath) {
    return record.data.worktreePath;
  }
  return resolveFeatureWorktreePath(path.join(os.homedir(), '.aigon', 'worktrees', path.basename(repoPath)), featureId, agentId, repoPath);
}

// ---------------------------------------------------------------------------
// Entity sweep — liveness + token exhaustion (features may append engine events)
// ---------------------------------------------------------------------------

/**
 * Sweep a single entity (feature or research) for agent liveness.
 * Computes liveness and stores it in the in-memory map.
 * For features, may record token-exhaustion workflow events and apply failover policy.
 * Sends notifications for dead agents (once per dead transition).
 */
function sweepEntity(repoPath, entityType, entityId, snapshot, projConfig) {
  if (!snapshot.agents) return;

  // Skip terminal lifecycle states
  const lifecycle = snapshot.lifecycle || '';
  if (lifecycle === 'done' || lifecycle === 'closing') return;

  const hbConfig = getHeartbeatConfig(projConfig);
  const prefix = entityType === 'research' ? 'R' : 'F';
  const statePrefix = entityType === 'research' ? 'research' : 'feature';

  for (const [agentId, agent] of Object.entries(snapshot.agents)) {
    const statusRecord = readAgentStatusRecordAt(repoPath, entityId, agentId, { prefixes: [statePrefix] });
    const statusData = statusRecord && statusRecord.data ? statusRecord.data : {};
    const failoverConfig = resolveFailoverConfig(repoPath, snapshot);
    // Capture live pane text up-front so exhaustion detection sees alive
    // agents that printed a quota message and stayed at their REPL prompt.
    // Status-file lastPaneTail is only written on process exit, which most
    // CLIs never do for quota — they print and wait. Reused by idle detection
    // below to avoid a second `tmux capture-pane` call.
    const earlySessionName = (agent.status === 'running' || agent.status === 'idle' || agent.status === 'needs_attention')
      ? findLiveAgentSessionName(repoPath, entityType, entityId, agentId)
      : null;
    const livePaneText = earlySessionName ? capturePaneText(earlySessionName) : null;
    const exhaustionSignal = entityType === 'feature'
      ? buildTokenExhaustionSignal({
          slotAgentId: agentId,
          agentState: agent,
          statusRecord: statusData,
          featureId: entityId,
          repoPath,
          failoverConfig,
          livePaneTail: livePaneText,
        })
      : null;
    // Suppression is gated on the **status-file flag only**. Previously we
    // also checked the snapshot's `agent.tokenExhausted` field, but that field
    // is only cleared by `agent.failover_switched`. So if Pro wasn't loaded
    // (or the failover handler failed), the snapshot field stayed set
    // permanently and the slot was stuck — clearing the status flag manually
    // had no effect. The status-file flag is the right source of truth: it's
    // set when we record exhaustion and explicitly cleared by
    // `clearTokenExhaustedFlag` after a successful switch (or by the operator
    // when they want to retry detection).
    if (entityType === 'feature' && exhaustionSignal && !(statusData.flags && statusData.flags.tokenExhausted)) {
      const at = new Date().toISOString();
      const lastCommit = getLastReachableCommit(statusData.worktreePath || resolveSlotWorktreePath(repoPath, entityId, agentId));
      const payload = {
        agentId,
        role: 'do',
        lastCommit,
        tokensConsumed: exhaustionSignal.tokensConsumed,
        limit: exhaustionSignal.limit,
        source: exhaustionSignal.source,
        currentAgentId: exhaustionSignal.currentAgentId,
        at,
      };
      const tokenExhaustedPromise = workflowEngine.recordAgentTokenExhausted(repoPath, entityId, payload)
        .catch((error) => {
          log(`token-exhausted record failed F${entityId} ${agentId}: ${error.message}`);
        });
      markTokenExhaustedFlag(repoPath, entityType, entityId, agentId, payload);
      // Auto-failover only fires for autonomous (autopilot) runs. Manual /
      // Drive / Fleet runs always require a click on the dashboard "Failover
      // now →" button — the operator is at the wheel and shouldn't have the
      // slot swapped from under them. The chosen `policy` is a kill switch
      // that further restricts auto behaviour even for autonomous runs.
      const autoSession = entityType === 'feature'
        ? safeFeatureAutoSessionExists(entityId, repoPath)
        : null;
      const isAutonomous = !!(autoSession && autoSession.running);
      if (failoverConfig.policy === 'pause') {
        workflowEngine.pauseFeatureForReason(repoPath, entityId, 'token-limit').catch((error) => {
          log(`token-exhausted pause failed F${entityId} ${agentId}: ${error.message}`);
        });
      } else if (failoverConfig.policy === 'switch' && isAutonomous) {
        if (exhaustionHandlers.length === 0) {
          log(`agentFailover.policy=switch requires aigon-pro; falling back to notify (F${entityId} ${agentId})`);
        } else {
          // Chain handlers after token_exhausted is written so failover_switched
          // always appends after it (prevents out-of-order snapshot on lock contention).
          for (const handler of exhaustionHandlers) {
            tokenExhaustedPromise.then(() => handler({ repoPath, entityId, agentId, signal: exhaustionSignal, snapshot, failoverConfig }))
              .catch((error) => {
                log(`token-exhausted handler failed F${entityId} ${agentId}: ${error.message}`);
              });
          }
        }
      } else if (failoverConfig.policy === 'switch' && !isAutonomous) {
        log(`agentFailover.policy=switch but feature is non-autonomous; manual failover only (F${entityId} ${agentId})`);
      }
      if (isSupervisorNotificationsEnabled()) {
        sendNotification(
          `F${entityId} ${agentId} hit a token limit (${exhaustionSignal.source})`,
          `Aigon - ${path.basename(repoPath)}`
        );
      }
    }

    // Only check agents that could plausibly be alive
    if (agent.status !== 'running' && agent.status !== 'idle' && agent.status !== 'needs_attention') continue;

    // Reuse the session name and pane capture taken at the top of the loop
    // when status was already in {running,idle,needs_attention}. Otherwise
    // (status changed since, or earlier capture skipped) look up now.
    const sessionName = earlySessionName !== null
      ? earlySessionName
      : findLiveAgentSessionName(repoPath, entityType, entityId, agentId);
    const tmuxAlive = Boolean(sessionName);
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

    // Idle detection (observation only — no session mutation)
    const notificationsEnabled = isSupervisorNotificationsEnabled();
    let newIdleState = null;
    if (tmuxAlive && liveness.liveness === LIVENESS.ALIVE) {
      const thresholds = getIdleThresholds();
      // Use liveness lastSeenAt as the sessionStartedAt fallback
      const sessionStartedAt = liveness.lastSeenAt ? new Date(liveness.lastSeenAt).getTime() : null;
      newIdleState = computeIdleState(repoPath, entityType, entityId, agentId, thresholds, sessionStartedAt);
    }

    const prevIdle = idleData.get(key) || null;
    idleData.set(key, newIdleState);

    // Fire one-shot desktop notification at 'notify' level transition
    if (newIdleState && newIdleState.level === 'notify' && notificationsEnabled) {
      const alreadyNotifiedIdle = notifiedIdle.get(key);
      if (alreadyNotifiedIdle !== 'notify' && alreadyNotifiedIdle !== 'sticky') {
        notifiedIdle.set(key, 'notify');
        const repoName = path.basename(repoPath);
        log(`[idle] ${prefix}${entityId} ${agentId}: idle ${newIdleState.idleMinutes}m (notify)`);
        sendNotification(
          `${prefix}${entityId} ${agentId} awaiting input — ${newIdleState.idleMinutes}m idle`,
          `Aigon - ${repoName}`
        );
      }
    } else if (newIdleState && newIdleState.level === 'sticky' && notificationsEnabled) {
      const alreadyNotifiedIdle = notifiedIdle.get(key);
      if (alreadyNotifiedIdle !== 'sticky') {
        notifiedIdle.set(key, 'sticky');
        const repoName = path.basename(repoPath);
        log(`[idle] ${prefix}${entityId} ${agentId}: idle ${newIdleState.idleMinutes}m (sticky)`);
        sendNotification(
          `${prefix}${entityId} ${agentId} awaiting input — ${newIdleState.idleMinutes}m idle (still waiting)`,
          `Aigon - ${repoName}`
        );
      }
    } else if (!newIdleState && prevIdle) {
      // Idle cleared — reset notification tracker
      notifiedIdle.delete(key);
      log(`[idle] ${prefix}${entityId} ${agentId}: idle cleared`);
    }

    // Idle-at-prompt detection (capture-pane based, observation only).
    // Only meaningful while the tmux session is alive; cleared otherwise below.
    // Reuses the same pane capture taken at the top of the loop for
    // exhaustion detection — one tmux call, two consumers.
    let idleAtPromptResult = null;
    if (tmuxAlive && sessionName) {
      idleAtPromptResult = livePaneText !== null
        ? detectIdleFromText(livePaneText, agentId)
        : captureAndDetectIdle(sessionName, agentId);
    }
    idleAtPromptData.set(key, idleAtPromptResult);

    livenessData.set(key, {
      ...liveness,
      tmuxAlive,
      notifiedDead: liveness.liveness === LIVENESS.DEAD ? true : false,
    });

    // Send desktop notification on first transition to dead
    if (liveness.liveness === LIVENESS.DEAD && !alreadyNotified) {
      log(`[liveness] ${prefix}${entityId} ${agentId}: dead (tmux=${tmuxAlive}, age=${liveness.heartbeatAgeMs}ms)`);
      if (notificationsEnabled) {
        sendNotification(
          `Agent may need attention: ${prefix}${entityId} ${agentId}`,
          `Aigon - ${path.basename(repoPath)}`
        );
      }
    }

    // Clear idle state when session ends or agent is no longer running/idle
    if (!tmuxAlive || liveness.liveness === LIVENESS.DEAD) {
      idleData.set(key, null);
      idleAtPromptData.set(key, null);
      notifiedIdle.delete(key);
    }

    // awaiting-input: read the per-agent state file and fire a notification
    // on the absent→present transition (or when the question changes).
    // Clears silently when the tmux session is gone.
    const stateFile = path.join(repoPath, '.aigon', 'state', `${statePrefix}-${entityId}-${agentId}.json`);
    let awaitingInput = null;
    try {
      const stateData = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (stateData.awaitingInput && stateData.awaitingInput.message) {
        awaitingInput = stateData.awaitingInput;
      }
    } catch (_) { /* no state file or invalid — treat as no prompt */ }

    if (awaitingInput && !tmuxAlive) {
      // Session is gone — clear silently. No notification ("question abandoned"
      // would add noise for an action the user can no longer take).
      awaitingInput = null;
      try {
        const stateData = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        delete stateData.awaitingInput;
        const tmp = `${stateFile}.tmp.${process.pid}`;
        fs.writeFileSync(tmp, JSON.stringify(stateData, null, 2));
        fs.renameSync(tmp, stateFile);
      } catch (_) { /* best-effort */ }
    }

    const lastSeenAt = awaitingInputSeen.get(key) || null;
    if (awaitingInput && awaitingInput.at !== lastSeenAt) {
      awaitingInputSeen.set(key, awaitingInput.at);
      log(`[awaiting-input] ${prefix}${entityId} ${agentId}: ${awaitingInput.message}`);
      sendNotification(
        `${prefix}${entityId} ${agentId} — ${awaitingInput.message}`,
        `Aigon awaiting input - ${path.basename(repoPath)}`
      );
    } else if (!awaitingInput && lastSeenAt) {
      awaitingInputSeen.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Core sweep — runs every 30 seconds
// ---------------------------------------------------------------------------

/**
 * Single sweep iteration: check all agents across all repos.
 * Computes liveness data for dashboard display; may persist token-exhaustion events on features.
 */
async function sweep() {
  if (sweepInFlight) return;
  if (shouldSkipSweep && shouldSkipSweep()) return;
  sweepInFlight = true;
  try {
    // Guard: ensure process cwd is valid — seed-reset or worktree removal
    // can delete the directory from under us, crashing all shell commands.
    try { process.cwd(); } catch (_) {
      try { process.chdir(os.homedir()); } catch (_2) {}
    }

    const repos = readConductorReposFromGlobalConfig();
    if (!repos || repos.length === 0) return;

    for (const repoPath of repos) {
      await yieldEventLoop();
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
      for (let i = 0; i < featureSnapshots.length; i++) {
        const { entityId, snapshot } = featureSnapshots[i];
        try { sweepEntity(absRepo, 'feature', entityId, snapshot, projConfig); }
        catch (e) { log(`sweep skip F${entityId}: ${e.message}`); }
        if (i % 12 === 11) await yieldEventLoop();
      }

      // Sweep research
      const researchSnapshots = readAllResearchSnapshots(absRepo);
      for (let i = 0; i < researchSnapshots.length; i++) {
        const { entityId, snapshot } = researchSnapshots[i];
        try { sweepEntity(absRepo, 'research', entityId, snapshot, projConfig); }
        catch (e) { log(`sweep skip R${entityId}: ${e.message}`); }
        if (i % 12 === 11) await yieldEventLoop();
      }
    }

    lastSweepAt = new Date().toISOString();
    sweepCount++;
  } finally {
    sweepInFlight = false;
  }
}

// ---------------------------------------------------------------------------
// Liveness data access (for dashboard status collector)
// ---------------------------------------------------------------------------

/**
 * Get liveness data for a specific agent, including idle state.
 * @param {string} repoPath
 * @param {string} entityType - 'feature' or 'research'
 * @param {string} entityId
 * @param {string} agentId
 * @returns {{ liveness: string, lastSeenAt: string|null, heartbeatAgeMs: number|null, tmuxAlive: boolean, idleState: object|null }|null}
 */
function getAgentLiveness(repoPath, entityType, entityId, agentId) {
  const key = `${repoPath}:${entityType}:${entityId}:${agentId}`;
  const liveness = livenessData.get(key);
  if (!liveness) return null;
  const idleAtPromptEntry = idleAtPromptData.get(key) || null;
  return {
    ...liveness,
    idleState: idleData.get(key) || null,
    idleAtPrompt: idleAtPromptEntry ? Boolean(idleAtPromptEntry.idleAtPrompt) : false,
    idleAtPromptDetectedAt: idleAtPromptEntry ? idleAtPromptEntry.detectedAt : null,
  };
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

  log(`Supervisor started (sweep every ${SWEEP_INTERVAL_MS}ms, observe-only)`);

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
  setSweepSkipGuard,
  isSweepInFlight,
  getAgentLiveness,
  getAllLivenessData,
  registerExhaustionHandler,
  // Exported for testing
  sweep,
  sweepEntity,
  readAllFeatureSnapshots,
  readAllResearchSnapshots,
  tmuxSessionAlive,
  listTmuxSessionNames,
  expectedSessionName,
  expectedResearchSessionName,
  findLiveAgentSessionName,
  sendNotification,
  isSupervisorNotificationsEnabled,
  SWEEP_INTERVAL_MS,
  PROGRESS_TYPES,
  DEFAULT_IDLE_THRESHOLDS,
  computeIdleState,
  readLastProgressEventMs,
  getIdleThresholds,
  captureAndDetectIdle,
  stripAnsi,
  getIdleDetectionRegexes,
  // Test-only: clear the per-agent regex cache so unit tests can stub
  // loadAgentConfig output between cases.
  _resetIdleDetectionCache: () => idleDetectionCache.clear(),
  // Test-only: clear registered exhaustion handlers between test cases.
  _resetExhaustionHandlers: () => { exhaustionHandlers.length = 0; },
};
