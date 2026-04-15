#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { test, withTempDir, report } = require('../_helpers');
const { createMiscCommands, getFeatureSubmissionEvidence } = require('../../lib/commands/misc');

test('createMiscCommands exposes Gemini hook commands', () => {
    const commands = createMiscCommands();
    assert.strictEqual(typeof commands['check-agent-signal'], 'function');
    assert.strictEqual(typeof commands['check-agent-submitted'], 'function');
});

test('check-agent-submitted does not enforce on plain solo Drive branches', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../lib/commands/misc.js'), 'utf8');
    const block = src.match(/'check-agent-submitted': \(\) => \{[\s\S]*?process\.exitCode = 1;\n        \},/);
    assert.ok(block, 'check-agent-submitted block should exist');
    assert.ok(!/soloMatch/.test(block[0]), 'solo Drive branches must not be treated as agent sessions');
    assert.ok(/Plain Drive-mode[\s\S]*must not be blocked by the CC Stop hook/.test(block[0]), 'source should document the solo Drive exemption');
});

test('getFeatureSubmissionEvidence rejects setup-only feature worktree branches', () => withTempDir('aigon-misc-', (repoDir) => {
    execSync('git init -b main', { cwd: repoDir, stdio: 'pipe' });
    execSync('git config user.name "Test User"', { cwd: repoDir, stdio: 'pipe' });
    execSync('git config user.email "test@example.com"', { cwd: repoDir, stdio: 'pipe' });

    fs.mkdirSync(path.join(repoDir, 'docs', 'specs', 'features', 'logs'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'README.md'), '# repo\n');
    execSync('git add README.md', { cwd: repoDir, stdio: 'pipe' });
    execSync('git commit -m "chore: seed repo"', { cwd: repoDir, stdio: 'pipe' });

    execSync('git checkout -b feature-259-cx-dashboard-feature-push-action', { cwd: repoDir, stdio: 'pipe' });
    fs.writeFileSync(
        path.join(repoDir, 'docs', 'specs', 'features', 'logs', 'feature-259-cx-dashboard-feature-push-action-log.md'),
        '# log\n'
    );
    execSync('git add docs/specs/features/logs/feature-259-cx-dashboard-feature-push-action-log.md', { cwd: repoDir, stdio: 'pipe' });
    execSync('git commit -m "chore: worktree setup for cx"', { cwd: repoDir, stdio: 'pipe' });

    const evidence = getFeatureSubmissionEvidence(repoDir, '259', 'main');
    assert.strictEqual(evidence.ok, false);
    assert.match(evidence.reason, /no substantive commits|no implementation files changed/);
}));

test('getFeatureSubmissionEvidence accepts branches with committed implementation files', () => withTempDir('aigon-misc-', (repoDir) => {
    execSync('git init -b main', { cwd: repoDir, stdio: 'pipe' });
    execSync('git config user.name "Test User"', { cwd: repoDir, stdio: 'pipe' });
    execSync('git config user.email "test@example.com"', { cwd: repoDir, stdio: 'pipe' });

    fs.mkdirSync(path.join(repoDir, 'docs', 'specs', 'features', 'logs'), { recursive: true });
    fs.mkdirSync(path.join(repoDir, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'README.md'), '# repo\n');
    execSync('git add README.md', { cwd: repoDir, stdio: 'pipe' });
    execSync('git commit -m "chore: seed repo"', { cwd: repoDir, stdio: 'pipe' });

    execSync('git checkout -b feature-260-cx-research-reset', { cwd: repoDir, stdio: 'pipe' });
    fs.writeFileSync(
        path.join(repoDir, 'docs', 'specs', 'features', 'logs', 'feature-260-cx-research-reset-log.md'),
        '# log\n'
    );
    execSync('git add docs/specs/features/logs/feature-260-cx-research-reset-log.md', { cwd: repoDir, stdio: 'pipe' });
    execSync('git commit -m "chore: worktree setup for cx"', { cwd: repoDir, stdio: 'pipe' });

    fs.writeFileSync(path.join(repoDir, 'lib', 'feature-reset.js'), 'module.exports = true;\n');
    execSync('git add lib/feature-reset.js', { cwd: repoDir, stdio: 'pipe' });
    execSync('git commit -m "feat: add research reset command"', { cwd: repoDir, stdio: 'pipe' });

    const evidence = getFeatureSubmissionEvidence(repoDir, '260', 'main');
    assert.strictEqual(evidence.ok, true);
    assert.deepStrictEqual(evidence.substantiveFiles, ['lib/feature-reset.js']);
    assert.strictEqual(evidence.substantiveCommits.length, 1);
}));

report();
