'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

function listPidsUsingPath(targetPath) {
    if (!targetPath || !fs.existsSync(targetPath)) return [];
    try {
        const result = spawnSync('lsof', ['-t', '+D', targetPath], { // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        const output = result.status === 0 ? result.stdout : '';
        return [...new Set(
            output
                .split('\n')
                .map(line => parseInt(line.trim(), 10))
                .filter(pid => Number.isInteger(pid) && pid > 0)
        )];
    } catch (_) {
        return [];
    }
}

function listRepoRelatedPids({ repoPath, worktreeDir, repoName }) {
    const pidSet = new Set();
    [repoPath, worktreeDir].forEach(targetPath => {
        listPidsUsingPath(targetPath).forEach(pid => pidSet.add(pid));
    });

    try {
        const psOutput = execSync('ps -ax -o pid=,command=', {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        psOutput.split('\n').forEach(line => {
            const match = line.match(/^\s*(\d+)\s+(.*)$/);
            if (!match) return;
            const pid = parseInt(match[1], 10);
            const command = match[2] || '';
            if (!Number.isInteger(pid) || pid <= 0) return;
            if (
                command.includes(repoPath) ||
                command.includes(worktreeDir) ||
                command.includes(`${repoName}-worktrees`) ||
                command.includes(path.join('.aigon', 'worktrees', repoName)) ||
                command.includes(`${repoName}-f`)
            ) {
                pidSet.add(pid);
            }
        });
    } catch (_) { /* ignore */ }

    return [...pidSet].filter(pid => pid !== process.pid);
}

function isPidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (_) {
        return false;
    }
}

function killPidsHard(pids) {
    const targetPids = [...new Set((pids || []).filter(pid => Number.isInteger(pid) && pid > 1 && pid !== process.pid))];
    if (targetPids.length === 0) return [];

    targetPids.forEach(pid => {
        try { process.kill(pid, 'SIGTERM'); } catch (_) { /* ignore */ }
    });

    const termDeadline = Date.now() + 1500;
    while (Date.now() < termDeadline) {
        if (targetPids.every(pid => !isPidAlive(pid))) break;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }

    targetPids.forEach(pid => {
        if (!isPidAlive(pid)) return;
        try { process.kill(pid, 'SIGKILL'); } catch (_) { /* ignore */ }
    });

    return targetPids.filter(pid => isPidAlive(pid));
}

module.exports = {
    listPidsUsingPath,
    listRepoRelatedPids,
    isPidAlive,
    killPidsHard,
};
