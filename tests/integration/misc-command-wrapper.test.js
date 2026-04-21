#!/usr/bin/env node
// REGRESSION F259/260: setup-only branches (spec/log only) must not pass getFeatureSubmissionEvidence.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { test, testAsync, withTempDir, report } = require('../_helpers');
const { getFeatureSubmissionEvidence } = require('../../lib/commands/misc');
const { sendNudge, resolveSessions } = require('../../lib/nudge');

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

// REGRESSION feature 295: multiline nudges with quotes must go through tmux load-buffer verbatim.
testAsync('nudge delivery keeps multiline quoted text intact', async () => {
    const message = "line one\nline 'two'\nline \"three\""; const ops = []; let recorded = null;
    const result = await sendNudge('/repo', '295', message, { _deps: {
        resolveEntity: () => ({ entityType: 'feature', entityId: '295', snapshot: { agents: { cc: {} } }, desc: 'demo' }),
        resolveSessions: () => ({ agentId: 'cc', role: 'do', sessionName: 'repo-f295-do-cc-demo' }),
        resolveSubmitKey: () => 'Enter',
        assertBelowRateLimit: async () => {},
        persistEntityEvents: async (_repo, _type, _id, events) => { recorded = events[0]; },
        runTmux: (args, opts = {}) => (ops.push({ args, input: opts.input || null }), args[0] === 'capture-pane' ? { status: 0, stdout: message, stderr: '' } : { status: 0, stdout: '', stderr: '' }),
    } });
    assert.strictEqual(ops[0].args[0], 'load-buffer'); assert.strictEqual(ops[0].input, message); assert.strictEqual(ops[1].args[0], 'paste-buffer'); assert.strictEqual(ops[2].args[0], 'send-keys');
    assert.strictEqual(recorded.text, message); assert.strictEqual(result.agentId, 'cc');
});

// REGRESSION feature 295: omitted agent must fail loudly when more than one active session matches.
test('nudge agent inference errors on multiple active sessions', () => {
    assert.throws(() => resolveSessions({ entityType: 'feature', entityId: '295', desc: 'demo', snapshot: { agents: { cc: {}, gg: {} } } }, 'do', null, { tmuxSessionExists: () => true }), /Multiple active do sessions found/);
});

// REGRESSION feature 295: failed delivery confirmation must return pane tail for diagnosis.
testAsync('nudge delivery failure includes pane tail', async () => {
    await assert.rejects(() => sendNudge('/repo', '295', 'hello', { _deps: {
        resolveEntity: () => ({ entityType: 'feature', entityId: '295', snapshot: { agents: { cc: {} } }, desc: 'demo' }),
        resolveSessions: () => ({ agentId: 'cc', role: 'do', sessionName: 'repo-f295-do-cc-demo' }),
        resolveSubmitKey: () => 'Enter',
        assertBelowRateLimit: async () => {},
        persistEntityEvents: async () => {},
        runTmux: (args) => args[0] === 'capture-pane' ? { status: 0, stdout: 'stale pane output', stderr: '' } : { status: 0, stdout: '', stderr: '' },
    } }), (error) => (assert.match(error.message, /Nudge text not found in pane after delivery/), assert.strictEqual(error.paneTail, 'stale pane output'), true));
});

report();
