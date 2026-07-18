#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
    getLaunchableAgentIds,
    getAllAgentIds,
    isAgentActive,
} = require('../../lib/agent-registry');
const { readManifest } = require('../../lib/install-manifest');
const { resolveAgentDocPlaceholders } = require('../../lib/profile-placeholders');
const { scanRenderedManifestFiles } = require('../../lib/template-leak-scan');
const { testAsync, withTempDirAsync, report, GIT_SAFE_ENV } = require('../_helpers');

const CLI = path.join(__dirname, '..', '..', 'aigon-cli.js');

function runInstallAgent(repo, agentId, homeDir) {
    execFileSync(process.execPath, [CLI, 'install-agent', agentId], {
        cwd: repo,
        env: { ...process.env, ...GIT_SAFE_ENV, HOME: homeDir, USERPROFILE: homeDir },
        stdio: 'pipe',
    });
}

function writeGenericConfig(repo) {
    fs.mkdirSync(path.join(repo, '.aigon'), { recursive: true });
    fs.writeFileSync(
        path.join(repo, '.aigon', 'config.json'),
        JSON.stringify({ profile: 'generic' }, null, 2) + '\n'
    );
}

function writeWebConfig(repo) {
    fs.mkdirSync(path.join(repo, '.aigon'), { recursive: true });
    fs.writeFileSync(
        path.join(repo, '.aigon', 'config.json'),
        JSON.stringify({ profile: 'web' }, null, 2) + '\n'
    );
}

function readAgentDoc(repo, agentFile) {
    return fs.readFileSync(path.join(repo, '.aigon', 'docs', 'agents', agentFile), 'utf8');
}

// REGRESSION: every active agent installs into its own isolated generic fixture.
testAsync('install-agent rendered leaks: each active agent renders in its own generic fixture (F683)', async () => {
    const active = getLaunchableAgentIds().sort();
    assert.ok(active.length >= 6, 'expected launchable agents');
    for (const agentId of active) {
        await withTempDirAsync(`aigon-f683-generic-${agentId}-`, async (repo) => {
            const home = path.join(repo, 'home');
            fs.mkdirSync(path.join(repo, 'docs', 'specs'), { recursive: true });
            fs.mkdirSync(home, { recursive: true });
            writeGenericConfig(repo);
            runInstallAgent(repo, agentId, home);
            const manifest = readManifest(repo);
            assert.ok(manifest, `manifest missing for ${agentId}`);
            const findings = scanRenderedManifestFiles(repo, manifest);
            assert.strictEqual(
                findings.length,
                0,
                `${agentId}: ${findings.map((f) => `${f.file} ${f.match}`).join(', ')}`
            );
        });
    }
});

// REGRESSION: deactivated agents are not part of the launchable set.
testAsync('install-agent rendered leaks: deactivated agents are skipped (F683)', async () => {
    const deactivated = getAllAgentIds().filter((id) => !isAgentActive(id));
    assert.deepStrictEqual(deactivated.sort(), ['ag', 'gg']);
    for (const id of deactivated) {
        assert.ok(!getLaunchableAgentIds().includes(id), `${id} must not be launchable`);
    }
});

// REGRESSION: generic profile omits dev-server note for cx/cu agent docs.
testAsync('install-agent rendered leaks: generic cx/cu docs omit AGENT_DEV_SERVER_NOTE (F683)', async () => {
    for (const agentId of ['cx', 'cu']) {
        await withTempDirAsync(`aigon-f683-no-note-${agentId}-`, async (repo) => {
            const home = path.join(repo, 'home');
            fs.mkdirSync(path.join(repo, 'docs', 'specs'), { recursive: true });
            fs.mkdirSync(home, { recursive: true });
            writeGenericConfig(repo);
            runInstallAgent(repo, agentId, home);
            const agentFile = agentId === 'cx' ? 'codex.md' : 'cursor.md';
            const doc = readAgentDoc(repo, agentFile);
            assert.ok(!doc.includes('CRITICAL —'), `${agentId} generic doc must omit dev-server note`);
            assert.ok(!doc.includes('npm run dev'), `${agentId} must not mention npm run dev`);
            assert.ok(!doc.includes('.env.local'), `${agentId} must not mention .env.local`);
        });
    }
});

// REGRESSION: web profile keeps stack-neutral dev-server guidance for cx/cu.
testAsync('install-agent rendered leaks: web profile cx/cu retain stack-neutral dev-server note (F683)', async () => {
    for (const agentId of ['cx', 'cu']) {
        await withTempDirAsync(`aigon-f683-web-${agentId}-`, async (repo) => {
            const home = path.join(repo, 'home');
            fs.mkdirSync(path.join(repo, 'docs', 'specs'), { recursive: true });
            fs.mkdirSync(home, { recursive: true });
            writeWebConfig(repo);
            runInstallAgent(repo, agentId, home);
            const agentFile = agentId === 'cx' ? 'codex.md' : 'cursor.md';
            const doc = readAgentDoc(repo, agentFile);
            assert.ok(doc.includes('aigon dev-server start'), `${agentId} must document aigon dev-server start`);
            assert.ok(doc.includes('aigon dev-server url'), `${agentId} must document aigon dev-server url`);
            assert.ok(!doc.includes('npm run dev'), `${agentId} must stay stack-neutral`);
            assert.ok(!doc.includes('next dev'), `${agentId} must stay stack-neutral`);
            assert.ok(!doc.includes('.env.local'), `${agentId} must stay stack-neutral`);
        });
    }
});

// REGRESSION: resolveAgentDocPlaceholders blanks note when generic profile disables dev server.
testAsync('install-agent rendered leaks: resolveAgentDocPlaceholders blanks note for generic profile (F683)', async () => {
    await withTempDirAsync('aigon-f683-resolve-', async (repo) => {
        writeGenericConfig(repo);
        const { loadAgentConfig } = require('../../lib/templates');
        const cfg = loadAgentConfig('cu');
        const merged = resolveAgentDocPlaceholders(cfg, repo);
        assert.strictEqual(merged.AGENT_DEV_SERVER_NOTE, '');
    });
});

// REGRESSION: injected leak in manifest-tracked file is actionable.
testAsync('install-agent rendered leaks: injected manifest artifact fails scan (F683)', async () => {
    await withTempDirAsync('aigon-f683-inject-', async (repo) => {
        const rel = '.aigon/docs/agents/cursor.md';
        const abs = path.join(repo, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, '# Cursor\n\nUse npm run dev here.\n');
        const manifest = { files: [{ path: rel }] };
        const findings = scanRenderedManifestFiles(repo, manifest);
        assert.ok(findings.length > 0);
        assert.ok(findings[0].file.includes('cursor.md'));
    });
});

report();
