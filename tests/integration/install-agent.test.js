#!/usr/bin/env node
'use strict';

// Merged: install-agent multi-output (F440), no-AGENTS.md scaffold (F420),
// vendored-docs-to-.aigon (F421). Shared CLI-spawn helper amortises per-spawn cost.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { testAsync, withTempDirAsync, report, GIT_SAFE_ENV } = require('../_helpers');

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

const listAigonSkills = (dir) => fs.readdirSync(dir).filter(d => d.startsWith('aigon-')).sort();

// F440: op multi-output (flat .md + skill tree) — asserts full install shape + frontmatter.
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

// F440 + F421: cc single-output + vendored docs in one install. Asserts command dir has
// .md files, AGENTS.md untouched, .aigon/docs/ populated, legacy docs/ paths NOT created.
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

// --- F440 registry contract (pure-function, no install spawn) ---
testAsync('agent-registry (F440): cc single-output and op multi-output normalise to outputs[] with output alias', async () => {
    delete require.cache[require.resolve('../../lib/agent-registry')];
    const registry = require('../../lib/agent-registry');
    const cc = registry.getAgent('cc');
    assert.strictEqual(cc.outputs.length, 1);
    assert.strictEqual(cc.output, cc.outputs[0]);
    const op = registry.getAgent('op');
    assert.strictEqual(op.outputs.length, 2);
    assert.strictEqual(op.outputs[0].commandDir, '.opencode/commands');
    assert.strictEqual(op.outputs[1].commandDir, '.agents/skills');
    assert.strictEqual(op.output, op.outputs[0]);
});

report();
