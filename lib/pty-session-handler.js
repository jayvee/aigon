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
        let pty;
        try {
            pty = nodePty.spawn('tmux', ['attach-session', '-t', sessionName], {
                name: 'xterm-256color', cols: 80, rows: 24,
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
        ws.on('message', (msg, isBinary) => {
            if (!isBinary) {
                handleResizeFrame(pty, msg.toString());
                return;
            }
            try { pty.write(msg.toString('utf8')); } catch (_) {}
        });
        // Close: kill the attach process; tmux session lives on
        ws.on('close', () => {
            try { pty.kill(); } catch (_) {}
        });
        pty.onExit(() => {
            try { ws.close(); } catch (_) {}
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
