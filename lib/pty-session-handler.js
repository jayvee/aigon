'use strict';
const crypto = require('crypto');

const tokenStore = new Map();

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

function isLoopbackAddress(addr) {
    return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function isValidOrigin(origin) {
    if (!origin) return false;
    try {
        const u = new URL(origin);
        const h = u.hostname;
        const okProto = u.protocol === 'http:' || u.protocol === 'https:';
        return okProto && (
            h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost')
        );
    } catch (_) {
        return false;
    }
}

function handleResizeFrame(pty, frameStr) {
    try {
        const msg = JSON.parse(frameStr);
        if (msg && msg.type === 'resize' && msg.cols > 0 && msg.rows > 0) {
            pty.resize(msg.cols, msg.rows);
        }
    } catch (_) {}
}

function attachPtyWebSocketServer(wss, { tmuxSessionExists }) {
    const nodePty = require('node-pty');

    wss.on('connection', (ws, req) => {
        if (!isLoopbackAddress(req.socket.remoteAddress)) {
            ws.close(4001, 'Forbidden');
            return;
        }
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
            pty.onData((data) => {
                if (ws.readyState === ws.OPEN) {
                    try { ws.send(Buffer.from(data, 'utf8')); } catch (_) {}
                }
            });
            pty.onExit(() => {
                try { ws.close(); } catch (_) {}
            });
            for (const chunk of inputQueue) {
                try { pty.write(chunk); } catch (_) {}
            }
            inputQueue.length = 0;
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
        ws.on('close', () => {
            if (pty) { try { pty.kill(); } catch (_) {} }
        });
    });

    return wss;
}

module.exports = {
    mintPtyToken,
    validateAndConsumePtyToken,
    isLoopbackAddress,
    isValidOrigin,
    handleResizeFrame,
    attachPtyWebSocketServer,
};
