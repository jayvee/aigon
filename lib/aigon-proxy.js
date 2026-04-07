#!/usr/bin/env node
'use strict';

/**
 * aigon-proxy — standalone HTTP reverse proxy daemon (~50 lines)
 *
 * Reads ~/.aigon/dev-proxy/servers.json on each request.
 * Routes by Host header: aigon.localhost → port 4100, cc-85.aigon.localhost → port 4121, etc.
 * Handles WebSocket upgrades for tmux terminal relay.
 *
 * Usage:
 *   node lib/aigon-proxy.js                  # Listen on $AIGON_PROXY_PORT or 80
 *   AIGON_PROXY_PORT=4100 node lib/aigon-proxy.js  # Listen on 4100 (no sudo)
 */

const http = require('http');
const httpProxy = require('http-proxy');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEV_PROXY_DIR = path.join(os.homedir(), '.aigon', 'dev-proxy');
const SERVERS_JSON = path.join(DEV_PROXY_DIR, 'servers.json');
const PID_FILE = path.join(DEV_PROXY_DIR, 'proxy.pid');

function loadServers() {
    try {
        return JSON.parse(fs.readFileSync(SERVERS_JSON, 'utf8'));
    } catch (e) {
        return {};
    }
}

function resolvePort(host) {
    const servers = loadServers();
    // Strip port number and ".localhost" suffix: "cc-85.aigon.localhost:4100" → "cc-85.aigon"
    const hostname = (host || '').split(':')[0].replace(/\.localhost$/, '');
    // Split by dots to extract appId and serverId
    // e.g. "cc-85.aigon" → appId="aigon", serverId="cc-85"
    //      "aigon"        → appId="aigon", serverId=""
    const dotIdx = hostname.lastIndexOf('.');
    let appId, serverId;
    if (dotIdx !== -1) {
        serverId = hostname.slice(0, dotIdx);
        appId = hostname.slice(dotIdx + 1);
    } else {
        serverId = '';
        appId = hostname;
    }

    const appServers = servers[appId];
    if (!appServers) return null;

    const entry = appServers[serverId];
    if (!entry) return null;

    // Support legacy nested entries (dashboard.port) and regular entries (port)
    return (entry.dashboard ? entry.dashboard.port : entry.port) || null;
}

// feature 234: long actions (feature-close on a large merge) can take 60+ seconds.
// Default http-proxy timeouts are too short for legitimate work and mask
// successful actions as "Proxy error: socket hang up". 5 minutes is generous
// enough for any realistic action and tight enough that genuinely hung
// connections still time out eventually.
const proxy = httpProxy.createProxyServer({
    proxyTimeout: 5 * 60 * 1000,
    timeout: 5 * 60 * 1000,
});
proxy.on('error', (err, req, res) => {
    if (res && res.writeHead) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Proxy error: ' + err.message);
    }
});

const server = http.createServer((req, res) => {
    const port = resolvePort(req.headers.host);
    if (!port) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('No route for: ' + (req.headers.host || '(no host)'));
    }
    proxy.web(req, res, { target: `http://localhost:${port}` });
});

server.on('upgrade', (req, socket, head) => {
    const port = resolvePort(req.headers.host);
    if (!port) {
        socket.destroy();
        return;
    }
    proxy.ws(req, socket, head, { target: `http://localhost:${port}` });
});

const listenPort = process.env.AIGON_PROXY_PORT ? parseInt(process.env.AIGON_PROXY_PORT, 10) : 80;
server.listen(listenPort, '127.0.0.1', () => {
    fs.mkdirSync(DEV_PROXY_DIR, { recursive: true });
    fs.writeFileSync(PID_FILE, String(process.pid));
    process.stderr.write(`aigon-proxy listening on port ${listenPort} (PID ${process.pid})\n`);
});

// Clean up PID file on exit
function cleanup() {
    try { fs.unlinkSync(PID_FILE); } catch (e) {}
    process.exit(0);
}
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
