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
    git(repoDir, 'init -b main'); git(repoDir, 'config user.name "t"'); git(repoDir, 'config user.email t@t');
    fs.mkdirSync(path.join(repoDir, 'docs', 'specs', 'features', 'logs'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'README.md'), '# repo\n');
    git(repoDir, 'add README.md'); git(repoDir, 'commit -qm "chore: seed"'); git(repoDir, `checkout -b ${featureBranch}`);
    const logFile = `docs/specs/features/logs/${featureBranch}-log.md`;
    fs.writeFileSync(path.join(repoDir, logFile), '# log\n');
    git(repoDir, `add ${logFile}`); git(repoDir, 'commit -qm "chore: worktree setup for cx"');
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

// REGRESSION feature 295: multi-agent inference errors loudly; session name uses entity.repoPath basename (not cwd).
test('nudge session inference + repoPath-derived session name', () => {
    assert.throws(() => resolveSessions({ entityType: 'feature', entityId: '295', desc: 'demo', snapshot: { agents: { cc: {}, gg: {} } } }, 'do', null, { tmuxSessionExists: () => true }), /Multiple active do sessions found/);
    const s = resolveSessions({ entityType: 'feature', entityId: '295', desc: 'demo', snapshot: { agents: { cc: {} } }, repoPath: '/tmp/some-other-repo' }, 'do', null, { tmuxSessionExists: () => true });
    assert.strictEqual(s.sessionName, 'some-other-repo-f295-do-cc-demo');
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

// REGRESSION: GET /api/budget cc — parseClaudeStatus misread 0% used when % is on progress-bar line above Resets.
test('parseClaudeStatus handles pct on separate progress-bar line (new Claude format)', () => {
    const { parseClaudeStatus } = require('../../lib/budget-poller');

    // New format: % used appears on the progress-bar line, Resets on the next line.
    const newFormat = `
  Current session
  ███████████████████                                38% used
  Resets 11:50am (Australia/Melbourne)

  Current week (all models)
  █                                                  2% used
  Resets May 4 at 8:59am (Australia/Melbourne)

  Current week (Sonnet only)
  █▌                                                 3% used
  Resets May 4 at 8:59am (Australia/Melbourne)
`;
    const r1 = parseClaudeStatus(newFormat);
    assert.strictEqual(r1.session.pct_used, 38, 'session pct_used');
    assert.strictEqual(r1.week_all.pct_used, 2, 'week_all pct_used');
    assert.strictEqual(r1.week_sonnet.pct_used, 3, 'week_sonnet pct_used');

    // Old format: % used on same line as Resets — must still work.
    const oldFormat = `
  Current session
  Resets 5pm (Australia/Melbourne)    8% used

  Current week (all models)
  Resets 9am (Australia/Melbourne)████ 100% used
`;
    const r2 = parseClaudeStatus(oldFormat);
    assert.strictEqual(r2.session.pct_used, 8, 'old-format session pct_used');
    assert.strictEqual(r2.week_all.pct_used, 100, 'old-format week_all pct_used');

    // Fully available — no bar, no % used line — defaults to 0.
    const fullFormat = `
  Current session
  Resets 5pm (Australia/Melbourne)
`;
    const r3 = parseClaudeStatus(fullFormat);
    assert.strictEqual(r3.session.pct_used, 0, 'fully available defaults to 0% used');
});

// REGRESSION: GET /api/budget gg — parse Gemini CLI /model "Model usage" rows (Flash / Flash Lite / Pro).
test('parseGeminiModelUsage extracts tier pct and reset labels', () => {
    const { parseGeminiModelUsage, parseGeminiFooterPlanQuota, stripAnsi } = require('../../lib/budget-poller');
    assert.strictEqual(stripAnsi('\x1b[31mX\x1b[0m'), 'X');
    const tiers = parseGeminiModelUsage(`
Model usage
│ Flash       ▬  0%   Resets: 11:15 AM (14h 41m)
│ Flash Lite  ▬  0%   Resets: 11:15 AM (14h 41m)
│ Pro         ▬  23%   Resets: 8:13 PM (23h 39m)
`);
    assert.strictEqual(tiers.length, 3);
    assert.strictEqual(tiers[2].tier, 'pro');
    assert.strictEqual(tiers[2].pct_used, 23);

    const flashFirst = parseGeminiModelUsage('Flash Lite 99%\nFlash 1%');
    assert.strictEqual(flashFirst.length, 2);
    assert.strictEqual(flashFirst[0].tier, 'flash_lite');

    const indented = parseGeminiModelUsage('  x  Pro ▬▬▬  44%   Resets: 8:13 PM (1h 2m)');
    assert.strictEqual(indented.length, 1);
    assert.strictEqual(indented[0].pct_used, 44);

    const foot = parseGeminiFooterPlanQuota('sandbox  /model  quota\n  no sandbox   Auto (Gemini 3)   15% used (Limit resets in 14h 41m)');
    assert.strictEqual(foot.pct_used, 15);
});

// REGRESSION: GET /api/budget km — parse Kimi CLI /usage output.
test('parseKimiUsage extracts tier pct remaining and reset hints', () => {
    const { parseKimiUsage } = require('../../lib/budget-poller');
    const tiers = parseKimiUsage(`
╭────────────────────────────── API Usage ──────────────────────────────╮
│  Weekly limit  ━━━╺━━━━━━━━━━━━━━━━  85% left  (resets in 5d 1h 27m)  │
│  5h limit      ━━━╺━━━━━━━━━━━━━━━━  93% left  (resets in 3h 27m)     │
╰───────────────────────────────────────────────────────────────────────╯
`);
    assert.strictEqual(tiers.length, 2);
    assert.strictEqual(tiers[0].tier, 'weekly_limit');
    assert.strictEqual(tiers[0].label, 'Weekly limit');
    assert.strictEqual(tiers[0].pct_used, 15);
    assert.strictEqual(tiers[0].resets_at, 'resets in 5d 1h 27m');
    assert.strictEqual(tiers[1].tier, '5h_limit');
    assert.strictEqual(tiers[1].label, '5h limit');
    assert.strictEqual(tiers[1].pct_used, 7);
    assert.strictEqual(tiers[1].resets_at, 'resets in 3h 27m');
});

report();
