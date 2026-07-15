#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { buildDashboardCardGallery } = require('../lib/dashboard-card-gallery');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_PORT = 3700;
const argPort = process.argv.find(arg => arg.startsWith('--port='));
const port = Number(argPort ? argPort.slice('--port='.length) : (process.env.PORT || DEFAULT_PORT));

if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`Invalid gallery port: ${port}`);
    process.exit(1);
}

const staticFiles = new Map([
    ['/', ['gallery/index.html', 'text/html; charset=utf-8']],
    ['/gallery.css', ['gallery/gallery.css', 'text/css; charset=utf-8']],
    ['/gallery.js', ['gallery/gallery.js', 'text/javascript; charset=utf-8']],
    // F679: the gallery renders cards through the production renderer modules
    // and stylesheet so gallery and production card behavior cannot drift.
    ['/contract-cards.css', ['templates/dashboard/styles/contract-cards.css', 'text/css; charset=utf-8']],
    ['/assets/icon/aigon-icon.svg', ['assets/icon/aigon-icon.svg', 'image/svg+xml']],
]);

const CONTRACT_CARDS_DIR = path.join(ROOT, 'templates', 'dashboard', 'js', 'contract-cards');

function resolveContractCardsModule(pathname) {
    if (!pathname.startsWith('/js/contract-cards/')) return null;
    const base = path.basename(pathname);
    if (!/^[a-z0-9-]+\.js$/.test(base)) return null;
    const file = path.join(CONTRACT_CARDS_DIR, base);
    return fs.existsSync(file) ? file : null;
}

function send(res, status, contentType, body) {
    res.writeHead(status, {
        'content-type': contentType,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
    });
    res.end(body);
}

const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
    if (req.method !== 'GET') {
        send(res, 405, 'text/plain; charset=utf-8', 'Method not allowed');
        return;
    }
    if (pathname === '/api/card-gallery') {
        try {
            send(res, 200, 'application/json; charset=utf-8', JSON.stringify(buildDashboardCardGallery()));
        } catch (error) {
            send(res, 500, 'application/json; charset=utf-8', JSON.stringify({ error: error.message }));
        }
        return;
    }
    const moduleFile = resolveContractCardsModule(pathname);
    if (moduleFile) {
        send(res, 200, 'text/javascript; charset=utf-8', fs.readFileSync(moduleFile));
        return;
    }
    const entry = staticFiles.get(pathname);
    if (!entry) {
        send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        return;
    }
    try {
        let body = fs.readFileSync(path.join(ROOT, entry[0]));
        if (pathname === '/') body = body.toString('utf8').replaceAll('${AIGON_VERSION}', require('../package.json').version);
        send(res, 200, entry[1], body);
    } catch (error) {
        send(res, 500, 'text/plain; charset=utf-8', error.message);
    }
});

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`Dashboard gallery port ${port} is already in use. Set PORT=<port> or pass --port=<port>.`);
    } else {
        console.error(error.stack || error.message);
    }
    process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
    console.log(`Aigon dashboard gallery: http://127.0.0.1:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => process.exit(0)));
}
