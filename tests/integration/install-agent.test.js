#!/usr/bin/env node
'use strict';

// Merged from: install-agent-multi-output (F440), install-agent-no-agents-md-scaffold (F420),
// install-agent-vendored-docs-to-dot-aigon (F421). Shared CLI-spawn helper amortises the
// per-spawn cost, and tests that inspect different aspects of the same install output
// share one tempdir/install pair.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { testAsync, withTempDirAsync, report, GIT_SAFE_ENV } = require('../_helpers');
const { runPendingMigrations } = require('../../lib/migration');

const CLI = path.join(__dirname, '..', '..', 'aigon-cli.js');

function runInstallAgent(repo, agentId) {
    execFileSync(process.execPath, [CLI, 'install-agent', agentId], {
        cwd: repo,
        env: { ...process.env, ...GIT_SAFE_ENV, HOME: repo, USERPROFILE: repo },
        stdio: 'pipe',
    });
}

function listAigonCmds(dir) {
    return fs.readdirSync(dir).filter(f => f.startsWith('aigon-') && f.endsWith('.md')).sort();
}

function listAigonSkills(dir) {
    return fs.readdirSync(dir).filter(d => d.startsWith('aigon-')).sort();
}

// --- F440: op multi-output (flat .md + skill tree) ---
// One install, asserts the full shape: flat dir exists, skill dir exists,
// counts match, frontmatter is well-formed.
testAsync('install-agent op: writes both flat commands and skill tree with matching counts (F440)', () => withTempDirAsync('aigon-f440-op-', async (repo) => {
    runInstallAgent(repo, 'op');
    const cmdDir = path.join(repo, '.opencode', 'commands');
    const skillsDir = path.join(repo, '.agents', 'skills');
    assert.ok(fs.existsSync(cmdDir), '.opencode/commands/ must exist');
    assert.ok(fs.existsSync(skillsDir), '.agents/skills/ must exist');

    const flat = listAigonCmds(cmdDir);
    const skills = listAigonSkills(skillsDir);
    assert.ok(flat.length > 0, 'must write at least one aigon-*.md in .opencode/commands/');
    assert.ok(skills.length > 0, 'must write at least one aigon-* skill directory');
    assert.strictEqual(flat.length, skills.length,
        `flat commands (${flat.length}) and skill dirs (${skills.length}) must have equal counts`);

    // Frontmatter shape (sample one command + one SKILL.md).
    const cmdSample = flat.find(f => f === 'aigon-feature-do.md') || flat[0];
    const cmdContent = fs.readFileSync(path.join(cmdDir, cmdSample), 'utf8');
    assert.ok(cmdContent.startsWith('---\n'), `${cmdSample} must start with YAML frontmatter`);
    assert.ok(cmdContent.includes('description:'), `${cmdSample} must have description frontmatter`);
    assert.ok(
        fs.existsSync(path.join(skillsDir, skills[0], 'SKILL.md')),
        `${skills[0]}/SKILL.md must exist`
    );
}));

testAsync('install-agent op: second run is idempotent (no duplicates) (F440)', () => withTempDirAsync('aigon-f440-op-idem-', async (repo) => {
    runInstallAgent(repo, 'op');
    const flatBefore = listAigonCmds(path.join(repo, '.opencode', 'commands'));
    const skillsBefore = listAigonSkills(path.join(repo, '.agents', 'skills'));

    runInstallAgent(repo, 'op');

    assert.deepStrictEqual(listAigonCmds(path.join(repo, '.opencode', 'commands')), flatBefore);
    assert.deepStrictEqual(listAigonSkills(path.join(repo, '.agents', 'skills')), skillsBefore);
}));

// --- F440: cc single-output regression + vendored docs (F421) in one install ---
// Single install, asserts: command dir exists with .md files, AGENTS.md untouched,
// .aigon/docs/ is populated, legacy docs/ paths NOT created.
testAsync('install-agent cc: writes commands, vendored docs to .aigon/docs/, leaves docs/ untouched (F440+F421)', () => withTempDirAsync('aigon-f421-cc-', async (repo) => {
    fs.mkdirSync(path.join(repo, 'docs', 'specs'), { recursive: true });
    runInstallAgent(repo, 'cc');

    // Single-output regression
    const cmdDir = path.join(repo, '.claude', 'commands', 'aigon');
    assert.ok(fs.existsSync(cmdDir), '.claude/commands/aigon/ must exist after cc install');
    const cmdFiles = fs.readdirSync(cmdDir).filter(f => f.endsWith('.md'));
    assert.ok(cmdFiles.length > 0, 'cc install must write command files');
    const cmdSample = cmdFiles.find(f => f === 'feature-do.md') || cmdFiles[0];
    assert.ok(fs.readFileSync(path.join(cmdDir, cmdSample), 'utf8').includes('description:'),
        `${cmdSample} must have description frontmatter`);

    // Vendored docs live under .aigon/docs/ — never under docs/
    assert.ok(fs.existsSync(path.join(repo, '.aigon', 'docs', 'development_workflow.md')));
    assert.ok(fs.existsSync(path.join(repo, '.aigon', 'docs', 'agents', 'claude.md')));
    assert.ok(!fs.existsSync(path.join(repo, 'docs', 'development_workflow.md')),
        'docs/development_workflow.md must NOT be created (consumer docs/ is untouched)');
    assert.ok(!fs.existsSync(path.join(repo, 'docs', 'agents')),
        'docs/agents/ must NOT be created');

    // F420: when no AGENTS.md exists, install must not scaffold one.
    assert.ok(!fs.existsSync(path.join(repo, 'AGENTS.md')),
        'AGENTS.md must not be created by install-agent (F420)');

    // Every templates/docs/*.md is picked up.
    const templatesDocs = path.join(__dirname, '..', '..', 'templates', 'docs');
    for (const file of fs.readdirSync(templatesDocs).filter(f => f.endsWith('.md'))) {
        assert.ok(fs.existsSync(path.join(repo, '.aigon', 'docs', file)),
            `.aigon/docs/${file} must exist (sourced from templates/docs/${file})`);
    }
}));

// --- F420: AGENTS.md scaffold rules ---
testAsync('install-agent cc: does not create AGENTS.md, leaves existing byte-identical (F420)', () => withTempDirAsync('aigon-f420-agents-md-', async (repo) => {
    fs.mkdirSync(path.join(repo, 'docs', 'specs'), { recursive: true });
    const userContent = '# My project\n\nMy own AGENTS.md, please don\'t touch.\n';
    const agentsPath = path.join(repo, 'AGENTS.md');
    fs.writeFileSync(agentsPath, userContent);
    runInstallAgent(repo, 'cc');
    assert.strictEqual(fs.readFileSync(agentsPath, 'utf8'), userContent,
        'AGENTS.md must be byte-identical after install-agent');
}));

// --- F420 migration 2.59.0: strip legacy AIGON marker block ---
testAsync('migration 2.59.0: strips legacy aigon marker block from AGENTS.md (F420)', () => withTempDirAsync('aigon-f420-mig-block-', async (repo) => {
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

testAsync('migration 2.59.0: no-op when no marker block present (F420)', () => withTempDirAsync('aigon-f420-mig-noblock-', async (repo) => {
    const original = '# My project\n\nNo aigon block here.\n';
    fs.writeFileSync(path.join(repo, 'AGENTS.md'), original);
    await runPendingMigrations(repo);
    assert.strictEqual(fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf8'), original);
}));

// --- F420 migration 2.59.1: docs/aigon-project.md deletion ---
testAsync('migration 2.59.1: deletes docs/aigon-project.md and is idempotent (F420)', () => withTempDirAsync('aigon-f420-mig-projmd-', async (repo) => {
    fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
    const projPath = path.join(repo, 'docs', 'aigon-project.md');
    fs.writeFileSync(projPath, '# Old descriptor\n');

    await runPendingMigrations(repo);
    assert.ok(!fs.existsSync(projPath), 'docs/aigon-project.md must be deleted');

    await runPendingMigrations(repo); // idempotent
    assert.ok(!fs.existsSync(projPath));
}));

// --- F421 migration 2.60.0: pristine vs diverged vs already-migrated vs user-owned ---
testAsync('migration 2.60.0: pristine legacy docs are moved into .aigon/docs/ (F421)', () => withTempDirAsync('aigon-f421-mig-pristine-', async (repo) => {
    const templatesDocs = path.join(__dirname, '..', '..', 'templates', 'docs');
    fs.mkdirSync(path.join(repo, 'docs', 'agents'), { recursive: true });
    for (const file of fs.readdirSync(templatesDocs).filter(f => f.endsWith('.md'))) {
        fs.copyFileSync(path.join(templatesDocs, file), path.join(repo, 'docs', file));
    }
    fs.writeFileSync(path.join(repo, 'docs', 'agents', 'claude.md'),
        '<!-- AIGON_START -->\n# Claude\nuser content\n<!-- AIGON_END -->\n');

    await runPendingMigrations(repo);

    assert.ok(fs.existsSync(path.join(repo, '.aigon', 'docs', 'development_workflow.md')));
    assert.ok(!fs.existsSync(path.join(repo, 'docs', 'development_workflow.md')));
    assert.ok(fs.existsSync(path.join(repo, '.aigon', 'docs', 'agents', 'claude.md')));
    assert.ok(!fs.existsSync(path.join(repo, 'docs', 'agents')));
}));

testAsync('migration 2.60.0: leaves diverged user-edited doc in place (F421)', () => withTempDirAsync('aigon-f421-mig-diverged-', async (repo) => {
    fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
    const userEdited = '# Development Workflow\n\nMy hand-edited copy with custom rules.\n';
    fs.writeFileSync(path.join(repo, 'docs', 'development_workflow.md'), userEdited);

    await runPendingMigrations(repo);

    assert.ok(fs.existsSync(path.join(repo, 'docs', 'development_workflow.md')));
    assert.strictEqual(fs.readFileSync(path.join(repo, 'docs', 'development_workflow.md'), 'utf8'), userEdited);
}));

testAsync('migration 2.60.0: idempotent on already-migrated repos (F421)', () => withTempDirAsync('aigon-f421-mig-idem-', async (repo) => {
    fs.mkdirSync(path.join(repo, '.aigon', 'docs', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.aigon', 'docs', 'development_workflow.md'), '# Workflow\n');
    fs.writeFileSync(path.join(repo, '.aigon', 'docs', 'agents', 'claude.md'), '<!-- AIGON_START -->\nx\n<!-- AIGON_END -->\n');

    await runPendingMigrations(repo);
    await runPendingMigrations(repo);

    assert.ok(fs.existsSync(path.join(repo, '.aigon', 'docs', 'development_workflow.md')));
    assert.ok(!fs.existsSync(path.join(repo, 'docs', 'development_workflow.md')));
}));

testAsync('migration 2.60.0: leaves user-owned files in docs/agents/ alone (no AIGON marker) (F421)', () => withTempDirAsync('aigon-f421-mig-userown-', async (repo) => {
    fs.mkdirSync(path.join(repo, 'docs', 'agents'), { recursive: true });
    const userOwned = '# My internal note about agent X\nNot installed by aigon.\n';
    fs.writeFileSync(path.join(repo, 'docs', 'agents', 'internal-notes.md'), userOwned);

    await runPendingMigrations(repo);

    assert.ok(fs.existsSync(path.join(repo, 'docs', 'agents', 'internal-notes.md')));
    assert.strictEqual(fs.readFileSync(path.join(repo, 'docs', 'agents', 'internal-notes.md'), 'utf8'), userOwned);
}));

// --- F440 registry contract (pure-function, no install spawn) ---
testAsync('agent-registry op: outputs is array of 2, output alias === outputs[0] (F440)', () => withTempDirAsync('aigon-f440-registry-op-', async () => {
    delete require.cache[require.resolve('../../lib/agent-registry')];
    const registry = require('../../lib/agent-registry');
    const cfg = registry.getAgent('op');
    assert.ok(Array.isArray(cfg.outputs));
    assert.strictEqual(cfg.outputs.length, 2);
    assert.strictEqual(cfg.outputs[0].commandDir, '.opencode/commands');
    assert.strictEqual(cfg.outputs[1].commandDir, '.agents/skills');
    assert.strictEqual(cfg.output, cfg.outputs[0]);
}));

testAsync('agent-registry cc: single output normalised to outputs array of length 1 (F440)', () => withTempDirAsync('aigon-f440-registry-cc-', async () => {
    delete require.cache[require.resolve('../../lib/agent-registry')];
    const registry = require('../../lib/agent-registry');
    const cfg = registry.getAgent('cc');
    assert.ok(Array.isArray(cfg.outputs));
    assert.strictEqual(cfg.outputs.length, 1);
    assert.strictEqual(cfg.output, cfg.outputs[0]);
}));

// --- F420 drift guard: removed scaffold helpers stay removed ---
testAsync('lib/templates.js: legacy scaffold helpers no longer exported (F420 drift guard)', async () => {
    const templates = require('../../lib/templates');
    for (const name of ['syncAgentsMdFile', 'getProjectInstructions', 'getRootFileContent', 'getScaffoldContent']) {
        assert.strictEqual(templates[name], undefined,
            `lib/templates.js must not export ${name} after F420`);
    }
});

report();
