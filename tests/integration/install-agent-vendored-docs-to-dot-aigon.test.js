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
    execFileSync(process.execPath, [CLI, 'install-agent', 'cc'], {
        cwd: repo,
        env: { ...process.env, ...GIT_SAFE_ENV, HOME: repo, USERPROFILE: repo },
        stdio: 'pipe',
    });
}

testAsync('install-agent writes vendored docs to .aigon/docs/, never docs/', () => withTempDirAsync('aigon-f421-install-', async (repo) => {
    fs.mkdirSync(path.join(repo, 'docs', 'specs'), { recursive: true });
    runInstallAgent(repo);

    // New layout: aigon-vendored docs under .aigon/docs/
    assert.ok(fs.existsSync(path.join(repo, '.aigon', 'docs', 'development_workflow.md')),
        '.aigon/docs/development_workflow.md must exist');
    assert.ok(fs.existsSync(path.join(repo, '.aigon', 'docs', 'agents', 'claude.md')),
        '.aigon/docs/agents/claude.md must exist for cc agent');

    // Legacy layout: must NOT be touched
    assert.ok(!fs.existsSync(path.join(repo, 'docs', 'development_workflow.md')),
        'docs/development_workflow.md must NOT be created (consumer docs/ is untouched)');
    assert.ok(!fs.existsSync(path.join(repo, 'docs', 'agents')),
        'docs/agents/ must NOT be created');
}));

testAsync('install-agent picks up every templates/docs/*.md (feature-sets.md too)', () => withTempDirAsync('aigon-f421-allfiles-', async (repo) => {
    fs.mkdirSync(path.join(repo, 'docs', 'specs'), { recursive: true });
    runInstallAgent(repo);

    const templatesDocs = path.join(__dirname, '..', '..', 'templates', 'docs');
    const expected = fs.readdirSync(templatesDocs).filter(f => f.endsWith('.md'));
    for (const file of expected) {
        assert.ok(fs.existsSync(path.join(repo, '.aigon', 'docs', file)),
            `.aigon/docs/${file} must exist (sourced from templates/docs/${file})`);
    }
}));

testAsync('migration 2.60.0 moves pristine legacy docs into .aigon/docs/', () => withTempDirAsync('aigon-f421-mig-pristine-', async (repo) => {
    // Seed a pristine legacy install: copy the shipped templates verbatim.
    const templatesDocs = path.join(__dirname, '..', '..', 'templates', 'docs');
    fs.mkdirSync(path.join(repo, 'docs', 'agents'), { recursive: true });
    for (const file of fs.readdirSync(templatesDocs).filter(f => f.endsWith('.md'))) {
        fs.copyFileSync(path.join(templatesDocs, file), path.join(repo, 'docs', file));
    }
    // Seed a per-agent doc with the AIGON_START marker (mimics install-agent output).
    fs.writeFileSync(path.join(repo, 'docs', 'agents', 'claude.md'),
        '<!-- AIGON_START -->\n# Claude\nuser content\n<!-- AIGON_END -->\n');

    await runPendingMigrations(repo);

    assert.ok(fs.existsSync(path.join(repo, '.aigon', 'docs', 'development_workflow.md')),
        'development_workflow.md must be moved to .aigon/docs/');
    assert.ok(!fs.existsSync(path.join(repo, 'docs', 'development_workflow.md')),
        'legacy docs/development_workflow.md must be removed');
    assert.ok(fs.existsSync(path.join(repo, '.aigon', 'docs', 'agents', 'claude.md')),
        'agent doc must be moved to .aigon/docs/agents/');
    assert.ok(!fs.existsSync(path.join(repo, 'docs', 'agents')),
        'empty docs/agents/ must be removed');
}));

testAsync('migration 2.60.0 leaves diverged legacy doc in place with warning', () => withTempDirAsync('aigon-f421-mig-diverged-', async (repo) => {
    fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
    const userEdited = '# Development Workflow\n\nMy hand-edited copy with custom rules.\n';
    fs.writeFileSync(path.join(repo, 'docs', 'development_workflow.md'), userEdited);

    await runPendingMigrations(repo);

    // Diverged copy stays put; .aigon/docs/ copy is NOT created by migration
    // (the next install-agent will write the canonical template there).
    assert.ok(fs.existsSync(path.join(repo, 'docs', 'development_workflow.md')),
        'edited docs/development_workflow.md must not be silently moved');
    assert.strictEqual(fs.readFileSync(path.join(repo, 'docs', 'development_workflow.md'), 'utf8'), userEdited,
        'edited content must be preserved verbatim');
}));

testAsync('migration 2.60.0 is idempotent on already-migrated repos', () => withTempDirAsync('aigon-f421-mig-idem-', async (repo) => {
    // Already on new layout — legacy paths absent, .aigon/docs/ populated.
    fs.mkdirSync(path.join(repo, '.aigon', 'docs', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.aigon', 'docs', 'development_workflow.md'), '# Workflow\n');
    fs.writeFileSync(path.join(repo, '.aigon', 'docs', 'agents', 'claude.md'), '<!-- AIGON_START -->\nx\n<!-- AIGON_END -->\n');

    await runPendingMigrations(repo);
    // Second pass — must remain a no-op without throwing.
    await runPendingMigrations(repo);

    assert.ok(fs.existsSync(path.join(repo, '.aigon', 'docs', 'development_workflow.md')));
    assert.ok(!fs.existsSync(path.join(repo, 'docs', 'development_workflow.md')));
}));

testAsync('migration 2.60.0 does not move user-owned files in docs/agents/ (no AIGON marker)', () => withTempDirAsync('aigon-f421-mig-userown-', async (repo) => {
    fs.mkdirSync(path.join(repo, 'docs', 'agents'), { recursive: true });
    const userOwned = '# My internal note about agent X\nNot installed by aigon.\n';
    fs.writeFileSync(path.join(repo, 'docs', 'agents', 'internal-notes.md'), userOwned);

    await runPendingMigrations(repo);

    assert.ok(fs.existsSync(path.join(repo, 'docs', 'agents', 'internal-notes.md')),
        'user-owned file (no AIGON_START marker) must stay in place');
    assert.strictEqual(fs.readFileSync(path.join(repo, 'docs', 'agents', 'internal-notes.md'), 'utf8'), userOwned);
}));

report();
