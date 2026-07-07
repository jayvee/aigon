'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const SANDBOX_REGISTRY_DIR = path.join(os.homedir(), '.aigon', 'preview-sandboxes');

function getSandboxRegistryPath(instanceId) {
    const safe = String(instanceId).replace(/[^a-zA-Z0-9._-]+/g, '-');
    return path.join(SANDBOX_REGISTRY_DIR, `${safe}.json`);
}

function readSandboxState(instanceId) {
    const registryPath = getSandboxRegistryPath(instanceId);
    try {
        if (!fs.existsSync(registryPath)) return null;
        return JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    } catch (_) {
        return null;
    }
}

function writeSandboxState(instanceId, state) {
    fs.mkdirSync(SANDBOX_REGISTRY_DIR, { recursive: true });
    fs.writeFileSync(getSandboxRegistryPath(instanceId), JSON.stringify({
        instanceId,
        updatedAt: new Date().toISOString(),
        ...state,
    }, null, 2));
}

function removeSandboxState(instanceId) {
    const registryPath = getSandboxRegistryPath(instanceId);
    try {
        if (fs.existsSync(registryPath)) fs.rmSync(registryPath, { force: true });
    } catch (_) { /* best-effort */ }
}

function listSandboxStates() {
    if (!fs.existsSync(SANDBOX_REGISTRY_DIR)) return [];
    const states = [];
    for (const file of fs.readdirSync(SANDBOX_REGISTRY_DIR)) {
        if (!file.endsWith('.json')) continue;
        try {
            states.push(JSON.parse(fs.readFileSync(path.join(SANDBOX_REGISTRY_DIR, file), 'utf8')));
        } catch (_) { /* skip corrupt */ }
    }
    return states;
}

function readSandboxRuntimeEntry(tempHome, isProcessAlive) {
    const runtimePath = path.join(tempHome, '.aigon', 'dashboard-runtime.json');
    try {
        if (!fs.existsSync(runtimePath)) return null;
        const rt = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
        if (!rt || !rt.pid || !isProcessAlive(rt.pid)) return null;
        return { pid: rt.pid, port: rt.port };
    } catch (_) {
        return null;
    }
}

module.exports = {
    SANDBOX_REGISTRY_DIR,
    getSandboxRegistryPath,
    readSandboxState,
    writeSandboxState,
    removeSandboxState,
    listSandboxStates,
    readSandboxRuntimeEntry,
};
