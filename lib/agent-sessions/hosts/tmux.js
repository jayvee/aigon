'use strict';

// Tmux SessionHost (F554).
//
// Implements the `SessionHost` contract for the tmux backend. This is where the
// tmux-specific session mechanics live: process creation, liveness, console
// capture, and operator-message delivery. The host knows nothing about
// workflow-core, dashboard routes, or command modules — it speaks only tmux and
// the AgentSession DTOs.
//
// SessionHost contract:
//   startSession(request)                 -> { host, tmuxId, shellPid, startedAt }
//   stopSession(sessionRef, options?)     -> { ok }
//   stopEntitySessions(entityRef, opts?)  -> result of graceful shutdown
//   isSessionAlive(sessionRef)            -> boolean
//   getConsoleSnapshot(sessionRef, opts?) -> ConsoleSnapshot
//   deliverOperatorMessage(ref, msg, o?)  -> { ok, paneTail }
//   openConsole(sessionRef, options?)     -> { command }
//
// The low-level tmux exec + the entangled transcript-capture side effects are
// delegated to `lib/worktree.js` via lazy requires so this module stays free of
// top-level circular edges. `lib/worktree.js` is the compatibility facade.

const { SESSION_STATES } = require('../model');
const {
    createConsoleSnapshot,
    createDeadConsoleSnapshot,
    DEFAULT_SNAPSHOT_LINES,
} = require('../console');

const TMUX_DISPLAY_SEP = '__AIGON_SEP__';
const DEFAULT_CAPTURE_LINES = 60;

function lazyWorktree() {
    return require('../../worktree');
}

function lazyInjectLiteral() {
    return require('../../tmux-inject').injectLiteral;
}

function sessionNameOf(sessionRef) {
    if (!sessionRef) return '';
    if (typeof sessionRef === 'string') return sessionRef;
    return String(sessionRef.sessionName || sessionRef.sessionId || '');
}

function tmuxIdOf(sessionRef) {
    if (!sessionRef || typeof sessionRef === 'string') return null;
    if (sessionRef.tmuxId) return String(sessionRef.tmuxId);
    const handle = sessionRef.host && sessionRef.host.handle;
    if (handle && handle.tmuxId) return String(handle.tmuxId);
    return null;
}

function sleepMs(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        // Busy wait keeps delivery synchronous without extra process churn.
    }
}

function extractLastPromptLine(paneTail) {
    const lines = String(paneTail || '').split('\n');
    for (let i = lines.length - 1; i >= 0; i -= 1) {
        const line = lines[i].trim();
        // Match common prompt prefixes across agents: `>` (Claude Code, Gemini),
        // `›` U+203A (Codex).
        if (/^[>›]/.test(line)) return line;
    }
    return '';
}

function paneMatchesAny(paneTail, patterns) {
    return (patterns || []).some(pattern => String(paneTail || '').includes(pattern));
}

function promptStillContainsMessage(paneTail, message) {
    const promptLine = extractLastPromptLine(paneTail);
    return !!promptLine && promptLine.includes(String(message || ''));
}

function promptShowsPlaceholder(paneTail, placeholder) {
    if (!placeholder) return false;
    const promptLine = extractLastPromptLine(paneTail);
    return !!promptLine && promptLine.includes(placeholder);
}

/**
 * Construct a tmux SessionHost.
 *
 * @param {Object} [deps] Injectable dependencies (defaults lazy-require worktree).
 * @param {Function} [deps.runTmux]
 * @param {Function} [deps.tmuxSessionExists]
 * @param {Function} [deps.resolveTmuxTarget]
 * @param {Function} [deps.attachSessionCapture]
 * @param {Function} [deps.gracefullyCloseEntitySessions]
 * @param {Function} [deps.now]
 */
function createTmuxSessionHost(deps = {}) {
    const kind = 'tmux';
    const runTmux = (...args) => (deps.runTmux || lazyWorktree().runTmux)(...args);
    const tmuxSessionExists = (name) => (deps.tmuxSessionExists || lazyWorktree().tmuxSessionExists)(name);
    const resolveTmuxTarget = (id, name) => (deps.resolveTmuxTarget || lazyWorktree().resolveTmuxTarget)(id, name);
    const gracefullyCloseEntitySessions = (...args) =>
        (deps.gracefullyCloseEntitySessions || lazyWorktree().gracefullyCloseEntitySessions)(...args);
    const now = deps.now || (() => new Date());

    function targetFor(sessionRef) {
        const name = sessionNameOf(sessionRef);
        const tmuxId = tmuxIdOf(sessionRef);
        // Prefer the durable session ID when present and still live; this is the
        // routing invariant from F351/F357 (id survives rename/truncation).
        if (tmuxId) {
            try {
                const resolved = resolveTmuxTarget(tmuxId, name);
                return resolved && resolved.target ? resolved.target : name;
            } catch (_) {
                return name;
            }
        }
        return name;
    }

    /**
     * Create a detached tmux session for a normalized start request.
     * Returns the host binding + durable identifiers. Sidecar persistence is the
     * AgentSessionService's responsibility (via the store); the host only does
     * tmux mechanics and the transcript-capture side effects.
     */
    function startSession(request) {
        const req = request || {};
        const sessionName = String(req.sessionId || req.sessionName || '');
        if (!sessionName) {
            throw new Error('TmuxSessionHost.startSession requires a sessionId');
        }
        const paths = req.paths || {};
        const cwd = req.cwd || paths.cwd || paths.worktreePath || process.cwd();
        const command = req.command || null;

        const args = ['new-session', '-d', '-s', sessionName, '-c', cwd];
        // Wrap in bash -lc so shell syntax (&&, unset, etc.) works correctly.
        if (command) args.push(`bash -lc ${shellQuoteLazy(command)}`);
        const result = runTmux(args, { stdio: 'ignore' });
        if (result.error || result.status !== 0) {
            throw new Error(`Failed to create tmux session "${sessionName}"`);
        }

        // Capture the durable session ID and pane PID immediately so the record
        // can carry them as a foreign key for routing and liveness.
        let tmuxId = null;
        let shellPid = null;
        try {
            const idResult = runTmux(
                ['display-message', '-t', sessionName, '-p', `#{session_id}${TMUX_DISPLAY_SEP}#{pane_pid}`],
                { encoding: 'utf8', stdio: 'pipe' }
            );
            if (!idResult.error && idResult.status === 0) {
                const [idPart, pidPart] = String(idResult.stdout || '').trim().split(TMUX_DISPLAY_SEP);
                if (idPart) tmuxId = idPart.trim();
                const pid = Number.parseInt(pidPart, 10);
                if (Number.isFinite(pid)) shellPid = pid;
            }
        } catch (_) { /* tmuxId is best-effort */ }

        // Window title = session name so windows are identifiable.
        runTmux(['set-option', '-t', sessionName, 'set-titles', 'on'], { stdio: 'ignore' });
        runTmux(['set-option', '-t', sessionName, 'set-titles-string', '#{session_name}'], { stdio: 'ignore' });
        runTmux(['rename-window', '-t', `${sessionName}:0`, sessionName], { stdio: 'ignore' });

        // NOTE: sidecar persistence + transcript-capture side effects remain in
        // the worktree compatibility facade (createDetachedTmuxSession), which
        // sequences them after the sidecar write to preserve the historical
        // ordering pipe-pane capture depends on. Provider transcript capture is
        // explicitly out of scope to redesign in F554.

        return {
            host: { kind, handle: compact({ tmuxId, shellPid, sessionName }) },
            tmuxId,
            shellPid,
            state: SESSION_STATES.ACTIVE,
            startedAt: toIso(now()),
        };
    }

    function stopSession(sessionRef, options = {}) {
        const target = targetFor(sessionRef);
        if (!target) return { ok: false };
        const result = runTmux(['kill-session', '-t', target], { stdio: 'ignore' });
        const ok = !result.error && (result.status === 0 || options.ignoreMissing === true);
        return { ok, sessionName: sessionNameOf(sessionRef) };
    }

    function stopEntitySessions(entityRef, options = {}) {
        const entityId = entityRef && (entityRef.id || entityRef.entityId);
        const entityType = entityRef && (entityRef.typeChar
            || (entityRef.type === 'research' ? 'r' : entityRef.type === 'feature' ? 'f' : entityRef.type));
        return gracefullyCloseEntitySessions(entityId, entityType, options);
    }

    /**
     * List live host sessions enriched with entity/orphan metadata.
     * Delegates to the existing tmux+sidecar join in worktree (preserved verbatim
     * to avoid regressing dashboard/CLI output shape).
     * @returns {{ sessions: Array, orphanCount: number }}
     */
    function listEnrichedSessions() {
        const getEnriched = deps.getEnrichedSessions || lazyWorktree().getEnrichedSessions;
        return getEnriched();
    }

    function isSessionAlive(sessionRef) {
        const name = sessionNameOf(sessionRef);
        if (!name) return false;
        return tmuxSessionExists(name);
    }

    function getConsoleSnapshot(sessionRef, options = {}) {
        const name = sessionNameOf(sessionRef);
        if (!name) return createDeadConsoleSnapshot(name);
        if (!tmuxSessionExists(name)) return createDeadConsoleSnapshot(name);
        const target = targetFor(sessionRef);
        const startLine = Number.isFinite(options.lines) && options.lines > 0
            ? Math.floor(options.lines)
            : DEFAULT_SNAPSHOT_LINES;
        const captureArgs = ['capture-pane', '-t', target, '-p'];
        if (options.escapeSequences) captureArgs.push('-e');
        captureArgs.push('-S', `-${startLine}`);
        const snap = runTmux(captureArgs, { encoding: 'utf8', stdio: 'pipe' });
        const raw = (!snap.error && snap.status === 0) ? String(snap.stdout || '') : '';
        return createConsoleSnapshot({
            sessionName: name,
            alive: true,
            text: raw,
            maxLines: options.maxLines,
            capturedAt: toIso(now()),
        });
    }

    // --- Operator message delivery (was nudge.js low-level orchestration) ----

    function capturePane(target) {
        const result = runTmux(
            ['capture-pane', '-p', '-t', target, '-S', `-${DEFAULT_CAPTURE_LINES}`],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
        );
        if (result.error || result.status !== 0) {
            throw new Error((result.stderr || (result.error && result.error.message) || 'tmux capture-pane failed').trim());
        }
        return String(result.stdout || '');
    }

    function loadBuffer(message) {
        const result = runTmux(['load-buffer', '-'], {
            input: message,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        if (result.error || result.status !== 0) {
            throw new Error((result.stderr || (result.error && result.error.message) || 'tmux load-buffer failed').trim());
        }
    }

    function pasteBuffer(target) {
        const result = runTmux(['paste-buffer', '-t', target, '-p'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        if (result.error || result.status !== 0) {
            throw new Error((result.stderr || (result.error && result.error.message) || 'tmux paste-buffer failed').trim());
        }
    }

    function sendSubmitKey(target, submitKey) {
        const normalizedSubmitKey = String(submitKey || '').trim() === 'Enter' ? 'C-m' : submitKey;
        const result = runTmux(['send-keys', '-t', target, normalizedSubmitKey], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        if (result.error || result.status !== 0) {
            throw new Error((result.stderr || (result.error && result.error.message) || 'tmux send-keys failed').trim());
        }
    }

    function confirmDelivery(target, message) {
        let paneTail = '';
        for (let attempt = 0; attempt < 3; attempt += 1) {
            sleepMs(attempt === 0 ? 150 : 80);
            paneTail = capturePane(target);
            if (paneTail.includes(message)) {
                return { ok: true, paneTail };
            }
        }
        return { ok: false, paneTail };
    }

    function submitMessage(target, text, transport) {
        const attempts = Math.max(1, (transport && transport.submitAttempts) || 1);
        const retryDelayMs = Math.max(0, (transport && transport.retryDelayMs) || 0);
        let paneTail = '';
        for (let attempt = 0; attempt < attempts; attempt += 1) {
            sendSubmitKey(target, transport.submitKey);
            if (retryDelayMs > 0) sleepMs(retryDelayMs);
            paneTail = capturePane(target);
            const sawSuccess = paneMatchesAny(paneTail, transport.successPatterns || [])
                || promptShowsPlaceholder(paneTail, transport.promptPlaceholder || '');
            if (sawSuccess) return { ok: true, paneTail };
            if (!promptStillContainsMessage(paneTail, text)) return { ok: true, paneTail };
        }
        return { ok: false, paneTail };
    }

    /**
     * Deliver an operator message into a live session and submit it.
     * Routes by durable tmuxId when present; falls back to session name.
     * Throws (with `.paneTail`) on delivery/submit failure to preserve the
     * nudge error contract.
     */
    function deliverOperatorMessage(sessionRef, message, options = {}) {
        const text = String(message || '');
        const target = targetFor(sessionRef);
        const transport = options.transport || { submitKey: 'Enter', submitAttempts: 1, retryDelayMs: 0, successPatterns: [], promptPlaceholder: '' };

        if (transport.useSendKeys) {
            // send-keys -l (literal) + submitKey — same mechanism as the injection
            // subshell. Avoids paste-buffer -p which can leave some TUIs in a state
            // where the subsequent C-m is ignored.
            const inject = options.injectLiteral || lazyInjectLiteral();
            inject(target, text, {
                submitKey: transport.submitKey || 'Enter',
                deps: options.injectDeps,
            });
            return { ok: true, sessionName: sessionNameOf(sessionRef), paneTail: '' };
        }

        loadBuffer(text);
        pasteBuffer(target);
        const confirmation = confirmDelivery(target, text);
        if (!confirmation.ok) {
            const error = new Error('Nudge text not found in pane after delivery');
            error.paneTail = confirmation.paneTail;
            throw error;
        }
        const submit = submitMessage(target, text, transport);
        if (!submit.ok) {
            const error = new Error('Nudge submit did not complete');
            error.paneTail = submit.paneTail;
            throw error;
        }
        return { ok: true, sessionName: sessionNameOf(sessionRef), paneTail: submit.paneTail };
    }

    function openConsole(sessionRef, options = {}) {
        const name = sessionNameOf(sessionRef);
        const command = `tmux attach -t ${shellQuoteLazy(name)}`;
        if (options.open && options.cwd) {
            lazyWorktree().openTerminalAppWithCommand(options.cwd, command, name);
        }
        return { command, sessionName: name };
    }

    return {
        kind,
        startSession,
        stopSession,
        stopEntitySessions,
        isSessionAlive,
        listEnrichedSessions,
        getConsoleSnapshot,
        deliverOperatorMessage,
        openConsole,
    };
}

function shellQuoteLazy(value) {
    return require('../../worktree').shellQuote(value);
}

function toIso(value) {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function compact(obj) {
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null));
}

module.exports = {
    createTmuxSessionHost,
};
