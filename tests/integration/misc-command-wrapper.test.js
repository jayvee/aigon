#!/usr/bin/env node
// REGRESSION feature 259/260: setup-only worktree branches (spec/log moves
// with no code changes) used to satisfy the submitted-evidence check,
// letting Stop hooks and autonomous loops fire feature-close on empty work.
// getFeatureSubmissionEvidence must only accept branches whose diff touches
// real implementation files.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { test, withTempDir, report } = require('../_helpers');
const { getFeatureSubmissionEvidence } = require('../../lib/commands/misc');

const git = (cwd, cmd) => execSync(`git ${cmd}`, { cwd, stdio: 'pipe' });

function seedRepo(repoDir, featureBranch) {
    git(repoDir, 'init -b main');
    git(repoDir, 'config user.name "t"');
    git(repoDir, 'config user.email t@t');
    fs.mkdirSync(path.join(repoDir, 'docs', 'specs', 'features', 'logs'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'README.md'), '# repo\n');
    git(repoDir, 'add README.md');
    git(repoDir, 'commit -qm "chore: seed"');
    git(repoDir, `checkout -b ${featureBranch}`);
    const logFile = `docs/specs/features/logs/${featureBranch}-log.md`;
    fs.writeFileSync(path.join(repoDir, logFile), '# log\n');
    git(repoDir, `add ${logFile}`);
    git(repoDir, 'commit -qm "chore: worktree setup for cx"');
}

test('setup-only feature branch (log commit but no impl) is rejected', () => withTempDir('aigon-misc-', (repo) => {
    seedRepo(repo, 'feature-259-cx-dashboard-feature-push-action');
    const ev = getFeatureSubmissionEvidence(repo, '259', 'main');
    assert.strictEqual(ev.ok, false);
    assert.match(ev.reason, /no substantive commits|no implementation files changed/);
}));

test('branch with committed implementation files is accepted', () => withTempDir('aigon-misc-', (repo) => {
    seedRepo(repo, 'feature-260-cx-research-reset');
    fs.mkdirSync(path.join(repo, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'lib', 'feature-reset.js'), 'module.exports=1\n');
    git(repo, 'add lib/feature-reset.js');
    git(repo, 'commit -qm "feat: impl"');
    const ev = getFeatureSubmissionEvidence(repo, '260', 'main');
    assert.strictEqual(ev.ok, true);
    assert.deepStrictEqual(ev.substantiveFiles, ['lib/feature-reset.js']);
    assert.strictEqual(ev.substantiveCommits.length, 1);
}));

report();
