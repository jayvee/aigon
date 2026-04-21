#!/usr/bin/env node
// REGRESSION F259/260: setup-only branches (spec/log only) must not pass getFeatureSubmissionEvidence.
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

test('legacy iterate flags still hard-error with the rename hint', () => {
    for (const flag of ['--autonomous', '--ralph']) {
        const r = require('child_process').spawnSync(process.execPath, [path.join(__dirname, '..', '..', 'aigon-cli.js'), 'feature-do', '7', flag], { encoding: 'utf8' });
        assert.strictEqual(r.status, 1); assert.match(r.stderr, /--autonomous\/--ralph was renamed to --iterate/);
    }
    assert.match(require('../../lib/templates').COMMAND_REGISTRY['feature-do'].argHints, /\[--iterate\]/);
});

test('repair registration and worktree/reset guard rails stay wired', () => {
    assert.strictEqual(typeof require('../../lib/commands/shared').createAllCommands().repair, 'function'); assert.strictEqual(typeof require('../../lib/commands/misc').createMiscCommands().repair, 'function');
    assert.match(fs.readFileSync(path.join(__dirname, '../../templates/help.txt'), 'utf8'), /repair <feature\|research> <ID> \[--dry-run\]/);
    const [wt, feature, entityCmds, setup] = ['../../lib/worktree.js', '../../lib/commands/feature.js', '../../lib/commands/entity-commands.js', '../../lib/commands/setup.js'].map((p) => fs.readFileSync(path.join(__dirname, p), 'utf8'));
    assert.match(wt, /config --local extensions\.worktreeConfig true/); assert.doesNotMatch(wt, /config --(?:local|worktree) user\.(?:name|email)/);
    assert.match(wt, /config --worktree aigon\.agentId/); assert.match(wt, /config --worktree core\.hooksPath/);
    // feature-reset is wired to the workflow engine via entityResetBase (F292).
    assert.match(feature, /entityResetBase\(entity\.FEATURE_DEF/); assert.match(entityCmds, /wf\.resetFeature/);
    assert.match(setup, /stale-drive-branch/);
});

// REGRESSION: F289 — bounded Autopilot carry-forward; criteria stay in CRITERIA_SECTION only.
test('Autopilot buildIterationCarryForward', () => {
    const { buildIterationCarryForward, CARRY_FORWARD_MAX_CHARS } = require('../../lib/validation');
    assert.strictEqual(CARRY_FORWARD_MAX_CHARS, 2000);
    const s = buildIterationCarryForward({ iteration: 2, commits: ['feat: x'], filesChanged: ['lib/a.js'], validationSummary: 'bad' });
    assert.ok(/iteration 2/.test(s) && /feat: x/.test(s) && /lib\/a\.js/.test(s) && !/Failing criteria/.test(s));
    const c = buildIterationCarryForward({ iteration: 1, commits: [], filesChanged: [], validationSummary: 'z'.repeat(6000) });
    assert.ok(c.length <= CARRY_FORWARD_MAX_CHARS && c.endsWith('...'));
});

report();
