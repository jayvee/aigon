'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PORT_FILE = path.join(os.tmpdir(), 'aigon-dashboard-e2e-port.txt');
const PORT_START = 4200;
const PORT_END = 4299;

function readStoredPort() {
    try {
        const value = fs.readFileSync(PORT_FILE, 'utf8').trim();
        const port = parseInt(value, 10);
        return Number.isInteger(port) && port > 0 ? port : null;
    } catch (_) {
        return null;
    }
}

function findFreePortSync() {
    const probe = `
        const net = require('net');
        const start = ${PORT_START};
        const end = ${PORT_END};
        const isFree = (port) => new Promise((resolve) => {
            const server = net.createServer();
            server.once('error', () => resolve(false));
            server.once('listening', () => server.close(() => resolve(true)));
            server.listen(port, '127.0.0.1');
        });
        (async () => {
            for (let port = start; port <= end; port++) {
                if (await isFree(port)) {
                    process.stdout.write(String(port));
                    return;
                }
            }
            process.exit(1);
        })().catch(() => process.exit(1));
    `;
    const result = spawnSync(process.execPath, ['-e', probe], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (result.status !== 0) {
        throw new Error(`No free dashboard e2e port found in ${PORT_START}-${PORT_END}`);
    }
    const port = parseInt((result.stdout || '').trim(), 10);
    if (!Number.isInteger(port) || port <= 0) {
        throw new Error('Dashboard e2e port probe returned an invalid port');
    }
    return port;
}

function resolveFixturePort() {
    const envPort = parseInt(process.env.AIGON_E2E_DASHBOARD_PORT || '', 10);
    if (Number.isInteger(envPort) && envPort > 0) return envPort;

    const storedPort = readStoredPort();
    if (storedPort) return storedPort;

    const port = findFreePortSync();
    fs.writeFileSync(PORT_FILE, `${port}\n`);
    return port;
}

module.exports = {
    PORT_FILE,
    PORT: resolveFixturePort(),
};
