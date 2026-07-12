'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const tokenStore = new Map();

// node-pty 1.1.0 ships prebuilds/<platform>-<arch>/spawn-helper without the
// execute bit on its npm tarball. Without +x, posix_spawnp aborts and every
// PTY WebSocket closes with code 1011 → the dashboard renders "[Session
// ended]" for live tmux sessions. Postinstall covers fresh `npm install`
// runs, but `npm rebuild`, `--ignore-scripts`, and partial installs all skip
// it. Re-asserting the bit at server boot makes the failure mode unreachable.
let _spawnHelperEnsured = false;
function ensureSpawnHelperExecutable() {
    if (_spawnHelperEnsured) return;
    _spawnHelperEnsured = true;
    if (process.platform === 'win32') return;
    let pkgDir;
    try { pkgDir = path.dirname(require.resolve('node-pty/package.json')); }
    catch (_) { return; }
    const helper = path.join(pkgDir, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper');
    let st;
    try { st = fs.statSync(helper); } catch (_) { return; }
    if ((st.mode & 0o111) === 0o111) return;
    try { fs.chmodSync(helper, 0o755); console.log(`[pty] chmod +x ${helper} (was ${(st.mode & 0o777).toString(8)})`); }
    catch (e) { console.warn(`[pty] failed to chmod ${helper}: ${e.message}`); }
}
ensureSpawnHelperExecutable();

function mintPtyToken({ ttlMs = 30_000 } = {}) {
    const token = crypto.randomBytes(16).toString('hex');
    tokenStore.set(token, { expiresAt: Date.now() + ttlMs });
    const now = Date.now();
    for (const [k, v] of tokenStore) {
        if (v.expiresAt < now) tokenStore.delete(k);
    }
    return token;
}

function validateAndConsumePtyToken(token) {
    const entry = tokenStore.get(token);
    if (!entry) return false;
    tokenStore.delete(token);
    return entry.expiresAt >= Date.now();
}

// F672: Origin validation lives in the shared security module so the HTTP guard
// and this WebSocket upgrade path share one definition. Re-exported for
// backward-compatible callers/tests.
const { isValidOrigin } = require('./dashboard-security');

function handleResizeFrame(pty, frameStr) {
    try {
        const msg = JSON.parse(frameStr);
        if (msg && msg.type === 'resize' && msg.cols > 0 && msg.rows > 0) {
            pty.resize(msg.cols, msg.rows);
        }
    } catch (_) {}
}

function attachPtyWebSocketServer(wss, { tmuxSessionExists }) {
    ensureSpawnHelperExecutable();
    const nodePty = require('node-pty');

    wss.on('connection', (ws, req) => {
        // Docker/OrbStack port publishing forwards localhost traffic through a
        // bridge address, so req.socket.remoteAddress is not loopback inside the
        // container. Keep the localhost-origin gate plus the single-use PTY token,
        // but do not reject bridged local connections on remoteAddress alone.
        if (!isValidOrigin(req.headers.origin || '')) {
            ws.close(4001, 'Forbidden');
            return;
        }
        const [pathname, qs = ''] = (req.url || '').split('?');
        const pathMatch = pathname.match(/^\/api\/session\/pty\/(.+)$/);
        if (!pathMatch) {
            ws.close(4004, 'Not found');
            return;
        }
        const sessionName = decodeURIComponent(pathMatch[1]);
        const tokenParam = qs.split('&').find(p => p.startsWith('token='));
        const token = tokenParam ? decodeURIComponent(tokenParam.slice('token='.length)) : '';
        if (!validateAndConsumePtyToken(token)) {
            ws.close(4001, 'Forbidden');
            return;
        }
        if (!tmuxSessionExists(sessionName)) {
            ws.close(4040, 'Session not found');
            return;
        }

        // Two-phase handshake: spawn the PTY only after the browser sends its
        // actual terminal dimensions in the first resize message.  This guarantees
        // the tmux attach starts at the correct size, so full-screen TUIs (Gemini,
        // kimi, opencode) never see a resize event and never need to repaint.
        let pty = null;
        const inputQueue = [];

        function spawnPty(cols, rows) {
            try {
                pty = nodePty.spawn('tmux', ['attach-session', '-t', sessionName], {
                    name: 'xterm-256color', cols, rows,
                    cwd: process.env.HOME || '/', env: process.env,
                });
            } catch (e) {
                ws.close(1011, 'PTY spawn failed');
                return;
            }
            let pendingOutput = '';
            let flushTimer = null;
            const flushDelayMs = 12;
            const flushOutput = () => {
                flushTimer = null;
                if (!pendingOutput) return;
                if (ws.readyState !== ws.OPEN) {
                    pendingOutput = '';
                    return;
                }
                const chunk = pendingOutput;
                pendingOutput = '';
                try { ws.send(chunk, { binary: true }); } catch (_) {}
            };
            const clearFlushTimer = () => {
                if (!flushTimer) return;
                clearTimeout(flushTimer);
                flushTimer = null;
            };
            pty.onData((data) => {
                pendingOutput += data;
                if (pendingOutput.length >= 32_768) { clearFlushTimer(); flushOutput(); return; }
                if (!flushTimer) flushTimer = setTimeout(flushOutput, flushDelayMs);
            });
            pty.onExit(() => {
                clearFlushTimer();
                flushOutput();
                try { ws.close(); } catch (_) {}
            });
            for (const chunk of inputQueue) {
                try { pty.write(chunk); } catch (_) {}
            }
            inputQueue.length = 0;
            ws.on('close', () => {
                clearFlushTimer();
                if (pty) { try { pty.kill(); } catch (_) {} }
            });
        }

        ws.on('message', (msg, isBinary) => {
            if (!isBinary) {
                const frame = (() => { try { return JSON.parse(msg.toString()); } catch (_) { return null; } })();
                if (frame && frame.type === 'resize' && frame.cols > 0 && frame.rows > 0) {
                    if (!pty) {
                        spawnPty(frame.cols, frame.rows);
                    } else {
                        try { pty.resize(frame.cols, frame.rows); } catch (_) {}
                    }
                }
                return;
            }
            if (pty) {
                try { pty.write(msg.toString('utf8')); } catch (_) {}
            } else {
                inputQueue.push(msg.toString('utf8'));
            }
        });
    });

    return wss;
}

module.exports = {
    mintPtyToken,
    validateAndConsumePtyToken,
    isValidOrigin,
    ensureSpawnHelperExecutable,
    handleResizeFrame,
    attachPtyWebSocketServer,
};
