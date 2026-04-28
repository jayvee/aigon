#!/usr/bin/env node
'use strict';

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

// --- op: multi-output (markdown flat + skill-md) ---

testAsync('install-agent op writes flat .opencode/commands/aigon-*.md files', () => withTempDirAsync('aigon-f440-op-flat-', async (repo) => {
    runInstallAgent(repo, 'op');
    const cmdDir = path.join(repo, '.opencode', 'commands');
    assert.ok(fs.existsSync(cmdDir), '.opencode/commands/ must exist after install');
    const files = fs.readdirSync(cmdDir).filter(f => f.startsWith('aigon-') && f.endsWith('.md'));
    assert.ok(files.length > 0, 'must write at least one aigon-*.md in .opencode/commands/');
    // Verify frontmatter shape: description present, no disable-model-invocation (op uses markdown format)
    const sample = files.find(f => f === 'aigon-feature-do.md') || files[0];
    const content = fs.readFileSync(path.join(cmdDir, sample), 'utf8');
    assert.ok(content.startsWith('---\n'), `${sample} must start with YAML frontmatter`);
    assert.ok(content.includes('description:'), `${sample} must have description frontmatter`);
}));

testAsync('install-agent op writes .agents/skills/aigon-*/SKILL.md tree', () => withTempDirAsync('aigon-f440-op-skills-', async (repo) => {
    runInstallAgent(repo, 'op');
    const skillsDir = path.join(repo, '.agents', 'skills');
    assert.ok(fs.existsSync(skillsDir), '.agents/skills/ must exist after install');
    const dirs = fs.readdirSync(skillsDir).filter(d => d.startsWith('aigon-'));
    assert.ok(dirs.length > 0, 'must write at least one aigon-* skill directory');
    const sample = dirs[0];
    assert.ok(
        fs.existsSync(path.join(skillsDir, sample, 'SKILL.md')),
        `${sample}/SKILL.md must exist`
    );
}));

testAsync('install-agent op both outputs have matching command counts', () => withTempDirAsync('aigon-f440-op-counts-', async (repo) => {
    runInstallAgent(repo, 'op');
    const flatFiles = fs.readdirSync(path.join(repo, '.opencode', 'commands'))
        .filter(f => f.startsWith('aigon-') && f.endsWith('.md'));
    const skillDirs = fs.readdirSync(path.join(repo, '.agents', 'skills'))
        .filter(d => d.startsWith('aigon-'));
    assert.strictEqual(flatFiles.length, skillDirs.length,
        `flat commands (${flatFiles.length}) and skill dirs (${skillDirs.length}) must have equal counts`);
}));

testAsync('install-agent op is idempotent (no duplicates, exit 0)', () => withTempDirAsync('aigon-f440-op-idempotent-', async (repo) => {
    runInstallAgent(repo, 'op');
    const flatBefore = fs.readdirSync(path.join(repo, '.opencode', 'commands'))
        .filter(f => f.startsWith('aigon-') && f.endsWith('.md')).sort();
    const skillsBefore = fs.readdirSync(path.join(repo, '.agents', 'skills'))
        .filter(d => d.startsWith('aigon-')).sort();

    runInstallAgent(repo, 'op'); // second run must be idempotent

    const flatAfter = fs.readdirSync(path.join(repo, '.opencode', 'commands'))
        .filter(f => f.startsWith('aigon-') && f.endsWith('.md')).sort();
    const skillsAfter = fs.readdirSync(path.join(repo, '.agents', 'skills'))
        .filter(d => d.startsWith('aigon-')).sort();

    assert.deepStrictEqual(flatAfter, flatBefore, 'flat commands must be identical after second install');
    assert.deepStrictEqual(skillsAfter, skillsBefore, 'skill dirs must be identical after second install');
}));

// --- cc: single-output regression (output normalization must not break cc) ---

testAsync('install-agent cc (single output) still works after output normalization', () => withTempDirAsync('aigon-f440-cc-regression-', async (repo) => {
    runInstallAgent(repo, 'cc');
    const cmdDir = path.join(repo, '.claude', 'commands', 'aigon');
    assert.ok(fs.existsSync(cmdDir), '.claude/commands/aigon/ must exist after cc install');
    const files = fs.readdirSync(cmdDir).filter(f => f.endsWith('.md'));
    assert.ok(files.length > 0, 'cc install must write command files');
    const sample = files.find(f => f === 'feature-do.md') || files[0];
    const content = fs.readFileSync(path.join(cmdDir, sample), 'utf8');
    assert.ok(content.includes('description:'), `${sample} must have description frontmatter`);
}));

// --- agent-registry: normalisation contract ---

testAsync('loadAgentConfig op: outputs array has 2 entries and output alias is outputs[0]', () => withTempDirAsync('aigon-f440-registry-', async (_repo) => {
    // Clear registry cache so the patched JSON is re-read
    const registryPath = require.resolve('../../lib/agent-registry');
    delete require.cache[registryPath];
    const registry = require('../../lib/agent-registry');
    const cfg = registry.getAgent('op');
    assert.ok(Array.isArray(cfg.outputs), 'op config must have outputs array');
    assert.strictEqual(cfg.outputs.length, 2, 'op must have exactly 2 output entries');
    assert.strictEqual(cfg.outputs[0].commandDir, '.opencode/commands', 'first output must target .opencode/commands');
    assert.strictEqual(cfg.outputs[1].commandDir, '.agents/skills', 'second output must target .agents/skills');
    assert.strictEqual(cfg.output, cfg.outputs[0], 'config.output must be backward-compat alias of outputs[0]');
}));

testAsync('loadAgentConfig cc: single output normalised to outputs array of length 1', () => withTempDirAsync('aigon-f440-cc-norm-', async (_repo) => {
    const registryPath = require.resolve('../../lib/agent-registry');
    delete require.cache[registryPath];
    const registry = require('../../lib/agent-registry');
    const cfg = registry.getAgent('cc');
    assert.ok(Array.isArray(cfg.outputs), 'cc config must have outputs array after normalization');
    assert.strictEqual(cfg.outputs.length, 1, 'cc must have exactly 1 output entry');
    assert.strictEqual(cfg.output, cfg.outputs[0], 'config.output must equal outputs[0] for cc');
}));

report();
