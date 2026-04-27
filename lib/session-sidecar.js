'use strict';

/**
 * Agent session ID capture and resume utilities.
 *
 * After a tmux session is spawned, a detached background process polls each
 * agent's session-storage directory until the newly created transcript appears.
 * It then rewrites the sidecar with `agentSessionId` + `agentSessionPath` so
 * the session can be resumed deterministically after a terminal crash.
 *
 * Telemetry helpers from lib/telemetry.js are reused for cwd-matching.
 * No new parser logic is duplicated here.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { resolveClaudeProjectDir, resolveGeminiChatsDir, findCodexSessionFiles } = require('./telemetry');
const agentRegistry = require('./agent-registry');

const POLL_INTERVAL_MS = 800;
const POLL_TIMEOUT_MS = 12000;

// Session-finder strategies dispatched by agent's runtime.sessionStrategy.
// Keyed by strategy name (not agentId), so a new agent that reuses an existing
// storage shape becomes a one-JSON edit.
const SESSION_FINDERS = {
    'claude-jsonl'(worktreePath, threshold) {
        const dir = resolveClaudeProjectDir(worktreePath);
        if (!dir || !fs.existsSync(dir)) return null;
        const match = _newestFile(dir, '.jsonl', threshold);
        if (!match) return null;
        return { sessionId: path.basename(match, '.jsonl'), sessionPath: match };
    },
    'gemini-chats'(worktreePath, threshold) {
        const chatsDir = resolveGeminiChatsDir(worktreePath);
        if (!chatsDir || !fs.existsSync(chatsDir)) return null;
        const match = _newestFile(chatsDir, '.json', threshold);
        if (!match) return null;
        // Prefer internal sessionId field if present
        let sessionId = path.basename(match, '.json');
        try {
            const data = JSON.parse(fs.readFileSync(match, 'utf8'));
            if (data && data.sessionId) sessionId = String(data.sessionId);
        } catch (_) {}
        return { sessionId, sessionPath: match };
    },
    'codex-sessions'(worktreePath, threshold) {
        const allFiles = findCodexSessionFiles(worktreePath);
        if (!allFiles.length) return null;
        let best = null;
        let bestMtime = threshold;
        for (const full of allFiles) {
            try {
                const mtime = fs.statSync(full).mtimeMs;
                if (mtime > bestMtime) { bestMtime = mtime; best = full; }
            } catch (_) {}
        }
        if (!best) return null;
        return { sessionId: path.basename(best, '.jsonl'), sessionPath: best };
    },
};

// ── Sidecar rewrite ──────────────────────────────────────────────────────────

/**
 * Atomically patch a session sidecar file.
 * Reads the current record, merges patch, writes via rename to avoid torn JSON.
 */
function updateSessionSidecar(sessionName, repoPath, patch) {
    const sidecarPath = path.join(path.resolve(repoPath), '.aigon', 'sessions', `${sessionName}.json`);
    let current = {};
    try {
        current = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
    } catch (_) {}
    const updated = Object.assign({}, current, patch);
    const tmp = `${sidecarPath}.${process.pid}.tmp`;
    try {
        fs.writeFileSync(tmp, JSON.stringify(updated, null, 2));
        fs.renameSync(tmp, sidecarPath);
    } catch (err) {
        try { fs.unlinkSync(tmp); } catch (_) {}
        throw err;
    }
}

// ── Session-file finders ─────────────────────────────────────────────────────

/**
 * Find the newest agent session file whose mtime is >= afterMs - 3s (tolerance).
 * Returns { sessionId, sessionPath } or null.
 */
function findNewAgentSession(agentId, worktreePath, afterMs) {
    const tolerance = 3000;
    const threshold = afterMs - tolerance;
    const strategy = agentRegistry.getSessionStrategy(agentId);
    const finder = strategy ? SESSION_FINDERS[strategy] : null;
    if (!finder) return null;
    try {
        return finder(worktreePath, threshold);
    } catch (_) {
        return null;
    }
}

function _newestFile(dir, ext, minMtimeMs) {
    let best = null;
    let bestMtime = minMtimeMs;
    let entries;
    try { entries = fs.readdirSync(dir); } catch (_) { return null; }
    for (const f of entries) {
        if (!f.endsWith(ext)) continue;
        const full = path.join(dir, f);
        try {
            const mtime = fs.statSync(full).mtimeMs;
            if (mtime > bestMtime) { bestMtime = mtime; best = full; }
        } catch (_) {}
    }
    return best;
}

// ── Background capture ───────────────────────────────────────────────────────

/**
 * Spawn a detached background process that polls for the agent session file
 * and updates the sidecar. Returns immediately — never blocks the caller.
 *
 * @param {string} sessionName
 * @param {string} repoPath      absolute main-repo path
 * @param {string} worktreePath  absolute worktree path (for cwd-matching)
 * @param {string} agentId       'cc' | 'gg' | 'cx'
 * @param {string} createdAt     ISO timestamp of tmux session creation
 */
function spawnCaptureProcess(sessionName, repoPath, worktreePath, agentId, createdAt) {
    if (!agentRegistry.getSessionStrategy(agentId)) return;
    const args = [
        '--session-name', sessionName,
        '--repo-path', path.resolve(repoPath),
        '--worktree-path', path.resolve(worktreePath),
        '--agent-id', agentId,
        '--created-at', createdAt || new Date().toISOString(),
    ];
    try {
        const child = spawn(
            process.execPath,
            [__filename, '--capture', ...args],
            { detached: true, stdio: 'ignore' }
        );
        child.unref();
    } catch (_) { /* best-effort */ }
}

/**
 * Synchronous polling loop used by the background capture process.
 * Not called from the main process.
 */
function _runCapture(sessionName, repoPath, worktreePath, agentId, createdAt) {
    const afterMs = createdAt ? new Date(createdAt).getTime() : Date.now();
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    const poll = () => {
        const found = findNewAgentSession(agentId, worktreePath, afterMs);
        if (found) {
            try {
                updateSessionSidecar(sessionName, repoPath, {
                    agentSessionId: found.sessionId,
                    agentSessionPath: found.sessionPath,
                });
            } catch (_) {}
            return true;
        }
        return false;
    };

    // Synchronous poll loop (this runs in a dedicated background process)
    const { execSync } = require('child_process');
    const start = Date.now();
    while (Date.now() < deadline) {
        if (poll()) return;
        // sync sleep — safe in the dedicated capture process
        try { execSync(`sleep ${POLL_INTERVAL_MS / 1000}`); } catch (_) { break; }
    }
}

// ── Resume helpers ───────────────────────────────────────────────────────────

/**
 * Find the most recent sidecar for entity + agent that has `agentSessionId` set.
 * Returns the sidecar record or null.
 *
 * @param {string} repoPath
 * @param {string} entityType  'f' | 'r' | 'S'
 * @param {string} entityId    unpaddedId
 * @param {string} agentId
 */
function readLatestSidecarWithSession(repoPath, entityType, entityId, agentId) {
    const dir = path.join(path.resolve(repoPath), '.aigon', 'sessions');
    if (!fs.existsSync(dir)) return null;
    let entries;
    try { entries = fs.readdirSync(dir); } catch (_) { return null; }

    const matches = [];
    for (const f of entries) {
        if (!f.endsWith('.json')) continue;
        try {
            const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
            if (!raw || typeof raw !== 'object') continue;
            if (!raw.agentSessionId) continue;
            if (raw.entityType !== entityType) continue;
            if (String(raw.entityId) !== String(entityId)) continue;
            if (raw.agent !== agentId) continue;
            matches.push(raw);
        } catch (_) {}
    }

    if (!matches.length) return null;
    matches.sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
    });
    return matches[0];
}

/**
 * Build the resume CLI arguments to append/prepend to the agent's launch command.
 *
 * cc:  claude ... --resume <uuid>
 * cx:  codex resume <id>         (isSubcommand=true: replace the normal launch)
 * gg:  gemini ... --resume <id>  (verify flag name during impl)
 *
 * Returns { appendArgs, prependArgs, isSubcommand } or null for unsupported agents.
 */
function resolveResumeArgs(agentId, agentSessionId) {
    if (!agentId || !agentSessionId) return null;
    const cfg = agentRegistry.getResumeConfig(agentId);
    if (!cfg) return null;
    if (cfg.kind === 'append') {
        return {
            prependArgs: [],
            appendArgs: [cfg.flag, agentSessionId],
            isSubcommand: false,
        };
    }
    if (cfg.kind === 'subcommand') {
        return {
            prependArgs: [...(cfg.args || []), agentSessionId],
            appendArgs: [],
            isSubcommand: true,
        };
    }
    return null;
}

// ── Script entry-point (background capture process) ──────────────────────────

if (require.main === module) {
    const argv = process.argv.slice(2);
    const idx = argv.indexOf('--capture');
    if (idx === -1) process.exit(0);

    function _arg(name) {
        const i = argv.indexOf(name);
        return i !== -1 ? argv[i + 1] : null;
    }

    const sessionName = _arg('--session-name');
    const repoPath = _arg('--repo-path');
    const worktreePath = _arg('--worktree-path');
    const agentId = _arg('--agent-id');
    const createdAt = _arg('--created-at');

    if (sessionName && repoPath && worktreePath && agentId) {
        _runCapture(sessionName, repoPath, worktreePath, agentId, createdAt);
    }
    process.exit(0);
}

module.exports = {
    updateSessionSidecar,
    findNewAgentSession,
    spawnCaptureProcess,
    readLatestSidecarWithSession,
    resolveResumeArgs,
};
