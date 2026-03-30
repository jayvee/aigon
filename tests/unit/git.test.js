#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const {
    classifyCommitAttributionRange,
    getFileLineAttribution,
} = require('../../lib/git');

let passed = 0;
let failed = 0;

function test(description, fn) {
    try {
        fn();
        console.log(`  ✓ ${description}`);
        passed++;
    } catch (err) {
        console.error(`  ✗ ${description}`);
        console.error(`    ${err.message}`);
        failed++;
    }
}

function run(cmd, cwd) {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function write(repoDir, filePath, content) {
    fs.writeFileSync(path.join(repoDir, filePath), content);
}

function setupRepo() {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-git-attribution-'));
    run('git init', repoDir);
    run('git config user.name "Human Dev"', repoDir);
    run('git config user.email "human@example.com"', repoDir);

    write(repoDir, 'app.txt', 'line human\n');
    run('git add app.txt', repoDir);
    run('git commit -m "feat: baseline"', repoDir);

    write(repoDir, 'app.txt', 'line human\nline ai\n');
    run('git add app.txt', repoDir);
    run(`git commit --author="Codex <cc@aigon.dev>" -m "feat: ai change

Aigon-Agent-ID: cc
Co-authored-by: Codex <cc@aigon.dev>"`, repoDir);
    const aiSha = run('git rev-parse HEAD', repoDir);
    run(`git notes --ref=refs/notes/aigon-attribution add -f -m "aigon.agent_id=cc
aigon.authorship=ai-authored" ${aiSha}`, repoDir);

    write(repoDir, 'app.txt', 'line human\nline ai\nline mixed\n');
    run('git add app.txt', repoDir);
    run(`git commit -m "chore: mixed update

Aigon-Agent-ID: cc
Co-authored-by: Human Dev <human@example.com>"`, repoDir);

    return repoDir;
}

console.log('# git.js attribution tests');

test('classifyCommitAttributionRange classifies human/ai/mixed commits', () => {
    const repoDir = setupRepo();
    try {
        const root = run('git rev-list --max-parents=0 HEAD', repoDir);
        const result = classifyCommitAttributionRange({
            cwd: repoDir,
            range: `${root}..HEAD`,
        });

        assert.strictEqual(result.classification, 'mixed');
        assert.strictEqual(result.counts['human-authored'], 0);
        assert.strictEqual(result.counts['ai-authored'], 1);
        assert.strictEqual(result.counts.mixed, 1);
        assert.strictEqual(result.commits.length, 2);
        assert(result.commits.some(c => c.signals.git_note), 'Expected at least one git-note-backed attribution signal');
    } finally {
        fs.rmSync(repoDir, { recursive: true, force: true });
    }
});

test('getFileLineAttribution returns line-level attribution counts', () => {
    const repoDir = setupRepo();
    try {
        const result = getFileLineAttribution({
            cwd: repoDir,
            filePath: 'app.txt',
        });
        assert.strictEqual(result.total_lines, 3);
        assert.strictEqual(result.line_counts['human-authored'], 1);
        assert.strictEqual(result.line_counts['ai-authored'], 1);
        assert.strictEqual(result.line_counts.mixed, 1);
    } finally {
        fs.rmSync(repoDir, { recursive: true, force: true });
    }
});

console.log(`\n# Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
