'use strict';

// F622: Server-Sent Events hub for dashboard live push (status, notifications, restart).

const HEARTBEAT_MS = 25_000;
const SSE_RETRY_MS = 1000;

function formatSseChunk(name, data) {
    const lines = [];
    if (name) lines.push(`event: ${name}`);
    if (data !== undefined) {
        lines.push(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
    }
    return `${lines.join('\n')}\n\n`;
}

function createDashboardSseHub() {
    /** @type {Set<import('http').ServerResponse>} */
    const clients = new Set();
    let heartbeatTimer = null;

    function ensureHeartbeat() {
        if (heartbeatTimer || clients.size === 0) return;
        heartbeatTimer = setInterval(() => {
            for (const res of clients) {
                try {
                    res.write(': heartbeat\n\n');
                } catch (_) {
                    clients.delete(res);
                }
            }
        }, HEARTBEAT_MS);
        if (heartbeatTimer.unref) heartbeatTimer.unref();
    }

    function stopHeartbeatIfEmpty() {
        if (clients.size === 0 && heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
    }

    function removeClient(res) {
        clients.delete(res);
        stopHeartbeatIfEmpty();
    }

    function broadcast(name, data) {
        if (!clients.size) return;
        const chunk = formatSseChunk(name, data);
        for (const res of clients) {
            try {
                res.write(chunk);
            } catch (_) {
                clients.delete(res);
            }
        }
        stopHeartbeatIfEmpty();
    }

    function handleEventsRequest(req, res, getStatusVersion) {
        res.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-store',
            connection: 'keep-alive',
            'x-accel-buffering': 'no',
        });
        res.write(`retry: ${SSE_RETRY_MS}\n\n`);
        res.write(formatSseChunk('status', { statusVersion: getStatusVersion() }));

        clients.add(res);
        ensureHeartbeat();

        req.on('close', () => {
            removeClient(res);
            try { res.end(); } catch (_) { /* already closed */ }
        });
    }

    return {
        broadcast,
        handleEventsRequest,
        getClientCount: () => clients.size,
    };
}

module.exports = {
    createDashboardSseHub,
    formatSseChunk,
    HEARTBEAT_MS,
    SSE_RETRY_MS,
};
