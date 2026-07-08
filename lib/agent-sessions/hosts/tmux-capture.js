'use strict';

// Tmux pipe-pane transcript capture (F632). Owned by TmuxSessionHost.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { shellQuote } = require('../../terminal-adapters');
const { runTmux } = require('./tmux-exec');

let _capturableAgentsCache = null;

function getCapturableAgents() {
    if (!_capturableAgentsCache) {
        const ids = require('../../agent-registry').getCapturableAgentIds();
        _capturableAgentsCache = new Set(ids);
    }
    return _capturableAgentsCache;
}

function ensureTmuxRotateScript() {
    const scriptsDir = path.join(os.homedir(), '.aigon', 'scripts');
    const scriptPath = path.join(scriptsDir, 'aigon-tmux-pipe-pane.sh');
    if (fs.existsSync(scriptPath)) return scriptPath;

    const scriptBody = `#!/bin/sh
# aigon-tmux-pipe-pane.sh — rotating log writer for tmux pipe-pane
# Usage: aigon-tmux-pipe-pane.sh <log_file> [<cap_bytes>] [<max_files>]
LOG="$1"
CAP="\${2:-104857600}"
MAX="\${3:-3}"

_rotate() {
  i=$MAX
  while [ "$i" -gt 1 ]; do
    prev=$((i-1))
    [ -f "\${LOG}.\${prev}" ] && mv "\${LOG}.\${prev}" "\${LOG}.\${i}" 2>/dev/null || true
    i=$prev
  done
  [ -f "\$LOG" ] && mv "\$LOG" "\${LOG}.1" 2>/dev/null || true
}

_filesize() {
  stat -c%s "\$1" 2>/dev/null || stat -f%z "\$1" 2>/dev/null || echo 0
}

count=0
check_every=500
while IFS= read -r line; do
  printf '%s\\n' "\$line" >> "\$LOG"
  count=$((count+1))
  if [ $((count % check_every)) -eq 0 ]; then
    sz=$(_filesize "\$LOG")
    if [ "\$sz" -gt "\$CAP" ]; then
      _rotate
      count=0
    fi
  fi
done
`;

    try {
        fs.mkdirSync(scriptsDir, { recursive: true });
        fs.writeFileSync(scriptPath, scriptBody, { mode: 0o755 });
    } catch (_) { /* best-effort */ }
    return scriptPath;
}

function attachTmuxPipePane(sessionName, logPath, maxBytes, maxFiles) {
    try {
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
    } catch (_) { /* ignore */ }

    const scriptPath = ensureTmuxRotateScript();
    const pipeCmd = `${shellQuote(scriptPath)} ${shellQuote(logPath)} ${maxBytes} ${maxFiles}`;
    runTmux(['pipe-pane', '-t', sessionName, '-O', pipeCmd], { stdio: 'ignore' });
}

function shouldAttachTmuxPipePane(meta, options = {}) {
    if (!meta || !meta.entityType || !meta.entityId || !meta.agent) return false;
    if (String(meta.role || '') === 'auto' && String(meta.agent) === 'auto' && meta.entityType === 'f') return true;
    const tmuxCaptureEnabled = options.tmuxCaptureEnabled !== undefined
        ? Boolean(options.tmuxCaptureEnabled)
        : require('../../config').isTmuxTranscriptCaptureEnabled();
    const capturableAgents = options.capturableAgents || getCapturableAgents();
    return tmuxCaptureEnabled && !capturableAgents.has(meta.agent);
}

function attachSessionCapture(sessionName, meta) {
    if (!meta || !meta.repoPath || !meta.agent) return;
    const resolvedWorktreePath = meta.worktreePath != null ? meta.worktreePath : process.cwd();
    const createdAt = meta.createdAt || new Date().toISOString();
    try {
        require('../../session-sidecar').spawnCaptureProcess(
            sessionName,
            path.resolve(meta.repoPath),
            path.resolve(resolvedWorktreePath),
            meta.agent,
            createdAt
        );
    } catch (_) { /* capture is best-effort */ }
    if (shouldAttachTmuxPipePane(meta)) {
        try {
            const { maxBytes, maxFiles } = require('../../config').getTmuxTranscriptOptions();
            const entityTypeLong = meta.entityType === 'r' ? 'research' : 'feature';
            const sessionUuid = require('crypto').randomUUID();
            const role = String(meta.role || 'do');
            const agentDir = path.join(
                require('../../transcript-store').resolveTranscriptEntityDir(
                    path.resolve(meta.repoPath),
                    entityTypeLong,
                    meta.entityId
                ),
                meta.agent
            );
            const logPath = path.join(agentDir, `${role}-${sessionUuid}.tmux.log`);
            attachTmuxPipePane(sessionName, logPath, maxBytes, maxFiles);
            require('../../session-sidecar').updateSessionSidecar(
                sessionName,
                path.resolve(meta.repoPath),
                { tmuxLogPath: logPath }
            );
        } catch (_) { /* pipe-pane is best-effort */ }
    }
}

module.exports = {
    attachSessionCapture,
    shouldAttachTmuxPipePane,
    ensureTmuxRotateScript,
};
