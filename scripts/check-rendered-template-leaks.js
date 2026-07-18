#!/usr/bin/env node
// check-rendered-template-leaks.js — install each active agent into an isolated
// generic-profile fixture and scan rendered instruction artifacts for leaks.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { getLaunchableAgentIds } = require('../lib/agent-registry');
const { readManifest } = require('../lib/install-manifest');
const { scanRenderedManifestFiles, formatFinding, ROOT } = require('../lib/template-leak-scan');

const CLI = path.join(ROOT, 'aigon-cli.js');

function runInstallAgent(repo, agentId, homeDir) {
    execFileSync(process.execPath, [CLI, 'install-agent', agentId], {
        cwd: repo,
        env: {
            ...process.env,
            HOME: homeDir,
            USERPROFILE: homeDir,
            GIT_CONFIG_GLOBAL: '/dev/null',
            GIT_CONFIG_SYSTEM: '/dev/null',
            GIT_TERMINAL_PROMPT: '0',
        },
        stdio: 'pipe',
    });
}

function prepareFixtureRepo(repo) {
    fs.mkdirSync(path.join(repo, 'docs', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.aigon'), { recursive: true });
    fs.writeFileSync(
        path.join(repo, '.aigon', 'config.json'),
        JSON.stringify({ profile: 'generic' }, null, 2) + '\n'
    );
}

function main() {
    const agentIds = getLaunchableAgentIds().sort();
    const allFindings = [];
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-rendered-leak-'));

    try {
        for (const agentId of agentIds) {
            const repo = path.join(tmpRoot, agentId);
            const home = path.join(tmpRoot, `${agentId}-home`);
            fs.mkdirSync(repo, { recursive: true });
            fs.mkdirSync(home, { recursive: true });
            prepareFixtureRepo(repo);
            runInstallAgent(repo, agentId, home);
            const manifest = readManifest(repo);
            if (!manifest) {
                console.error(`✗ check-rendered-template-leaks: no install-manifest.json after install-agent ${agentId}`);
                process.exit(1);
            }
            const findings = scanRenderedManifestFiles(repo, manifest);
            for (const f of findings) {
                allFindings.push({ ...f, agentId });
            }
        }
    } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }

    if (allFindings.length === 0) {
        console.log(`✓ check-rendered-template-leaks: scanned rendered output for ${agentIds.length} active agent(s) under generic profile — no leaks`);
        process.exit(0);
    }

    console.error(`✗ check-rendered-template-leaks: found ${allFindings.length} leak(s) in rendered install output.\n`);
    for (const f of allFindings) {
        const prefix = f.agentId ? `[${f.agentId}] ` : '';
        console.error(prefix + formatFinding(f, ROOT));
        console.error('');
    }
    process.exit(1);
}

if (require.main === module) {
    main();
}
