#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { testAsync, withTempDirAsync, report, GIT_SAFE_ENV } = require('../_helpers');
const { runPendingMigrations } = require('../../lib/migration');

const CLI = path.join(__dirname, '..', '..', 'aigon-cli.js');

function runInstallAgent(repo) {
    // Pin HOME so install-agent's global-registry / worktree-base writes land in the tempdir,
    // not the developer's real home.
    execFileSync(process.execPath, [CLI, 'install-agent', 'cc'], {
        cwd: repo,
        env: { ...process.env, ...GIT_SAFE_ENV, HOME: repo, USERPROFILE: repo },
        stdio: 'pipe',
    });
}

testAsync('install-agent does not create AGENTS.md when none exists', () => withTempDirAsync('aigon-f420-noscaffold-', async (repo) => {
    fs.mkdirSync(path.join(repo, 'docs', 'specs'), { recursive: true });
    runInstallAgent(repo);
    assert.ok(!fs.existsSync(path.join(repo, 'AGENTS.md')),
        'AGENTS.md must not be created by install-agent');
}));

testAsync('install-agent leaves an existing AGENTS.md byte-identical', () => withTempDirAsync('aigon-f420-existing-', async (repo) => {
    fs.mkdirSync(path.join(repo, 'docs', 'specs'), { recursive: true });
    const userContent = '# My project\n\nMy own AGENTS.md, please don\'t touch.\n';
    const agentsPath = path.join(repo, 'AGENTS.md');
    fs.writeFileSync(agentsPath, userContent);
    runInstallAgent(repo);
    const after = fs.readFileSync(agentsPath, 'utf8');
    assert.strictEqual(after, userContent, 'AGENTS.md must be byte-identical after install-agent');
}));

testAsync('migration 2.59.0 strips legacy aigon marker block from AGENTS.md', () => withTempDirAsync('aigon-f420-mig-block-', async (repo) => {
    const userPre = '# My project\n\nUser content.\n\n';
    const aigonBlock = '<!-- AIGON_START -->\n## Aigon\n\nThis project uses Aigon.\n<!-- AIGON_END -->\n';
    const userPost = '\n## Other section\n\nMore user content.\n';
    fs.writeFileSync(path.join(repo, 'AGENTS.md'), userPre + aigonBlock + userPost);

    await runPendingMigrations(repo);

    const after = fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf8');
    assert.ok(!after.includes('AIGON_START'), 'marker start must be removed');
    assert.ok(!after.includes('AIGON_END'), 'marker end must be removed');
    assert.ok(!after.includes('## Aigon'), 'block content must be removed');
    assert.ok(after.includes('User content.'), 'user content above must be preserved');
    assert.ok(after.includes('Other section'), 'user content below must be preserved');
    assert.ok(!/\n{3,}/.test(after), 'no runs of 3+ newlines after collapse');
}));

testAsync('migration 2.59.0 is a no-op when no marker block is present', () => withTempDirAsync('aigon-f420-mig-noblock-', async (repo) => {
    const original = '# My project\n\nNo aigon block here.\n';
    fs.writeFileSync(path.join(repo, 'AGENTS.md'), original);
    await runPendingMigrations(repo);
    const after = fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf8');
    assert.strictEqual(after, original, 'AGENTS.md must be untouched when no marker block');
}));

testAsync('migration 2.59.1 deletes docs/aigon-project.md and is idempotent', () => withTempDirAsync('aigon-f420-mig-projmd-', async (repo) => {
    fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
    const projPath = path.join(repo, 'docs', 'aigon-project.md');
    fs.writeFileSync(projPath, '# Old descriptor\n');
    assert.ok(fs.existsSync(projPath));

    await runPendingMigrations(repo);
    assert.ok(!fs.existsSync(projPath), 'docs/aigon-project.md must be deleted');

    // Second run is a clean no-op (idempotent — file already absent).
    await runPendingMigrations(repo);
    assert.ok(!fs.existsSync(projPath));
}));

testAsync('lib/templates.js no longer exports legacy scaffold helpers (drift guard)', () => {
    const templates = require('../../lib/templates');
    for (const name of ['syncAgentsMdFile', 'getProjectInstructions', 'getRootFileContent', 'getScaffoldContent']) {
        assert.strictEqual(templates[name], undefined,
            `lib/templates.js must not export ${name} after F420`);
    }
});

report();
