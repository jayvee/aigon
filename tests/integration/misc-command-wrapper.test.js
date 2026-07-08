#!/usr/bin/env node
// REGRESSION F259/260: setup-only branches (spec/log only) must not pass getFeatureSubmissionEvidence.
// REGRESSION F295: nudge delivery, session inference, and retry logic.
// Budget-parser tests (parseClaudeStatus, parseGeminiModelUsage, parseKimiUsage) live in budget-poller.test.js.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { test, testAsync, withTempDir, report } = require('../_helpers');
const { getFeatureSubmissionEvidence } = require('../../lib/feature-command-helpers');
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
    let captureCount = 0;
    const result = await sendNudge('/repo', '295', message, { _deps: {
        resolveEntity: () => ({ entityType: 'feature', entityId: '295', snapshot: { agents: { cc: {} } }, desc: 'demo' }),
        resolveSessions: () => ({ agentId: 'cc', role: 'do', sessionName: 'repo-f295-do-cc-demo' }),
        resolveNudgeTransport: () => ({ submitKey: 'Enter', submitAttempts: 1, retryDelayMs: 0, successPatterns: ['Thinking...'], promptPlaceholder: 'Type your message or @path/to/file' }),
        assertBelowRateLimit: async () => {},
        persistEntityEvents: async (_repo, _type, _id, events) => { recorded = events[0]; },
        runTmux: (args, opts = {}) => {
            ops.push({ args, input: opts.input || null });
            if (args[0] === 'capture-pane') {
                captureCount += 1;
                return { status: 0, stdout: captureCount === 1 ? `> ${message}` : '⠼ Thinking...', stderr: '' };
            }
            return { status: 0, stdout: '', stderr: '' };
        },
    } });
    assert.strictEqual(ops[0].args[0], 'load-buffer');
    assert.strictEqual(ops[0].input, message);
    assert.strictEqual(ops[1].args[0], 'paste-buffer');
    assert.strictEqual(ops.some(op => op.args[0] === 'send-keys'), true);
    assert.strictEqual(recorded.text, message); assert.strictEqual(result.agentId, 'cc');
});

// REGRESSION feature 295: multi-agent inference errors loudly; session name uses entity.repoPath basename (not cwd).
test('nudge session inference + repoPath-derived session name', () => {
    assert.throws(() => resolveSessions({ entityType: 'feature', entityId: '295', desc: 'demo', snapshot: { agents: { cc: {}, gg: {} } } }, 'do', null, { tmuxSessionExists: () => true }), /Multiple active do sessions found/);
    const s = resolveSessions({ entityType: 'feature', entityId: '295', desc: 'demo', snapshot: { agents: { cc: {} } }, repoPath: '/tmp/some-other-repo' }, 'do', null, { tmuxSessionExists: () => true });
    assert.strictEqual(s.sessionName, 'some-other-repo-f295-do-cc-demo');
});

// REGRESSION: review nudges must resolve the active reviewer even when the reviewer
// is not present in snapshot.agents (solo implementation + separate review agent).
test('nudge review session resolves active reviewer from codeReview state', () => {
    const session = resolveSessions({
        entityType: 'feature',
        entityId: '436',
        desc: 'dashboard-rip-out-wterm',
        repoPath: '/tmp/aigon',
        snapshot: {
            agents: { cx: {} },
            codeReview: { activeReviewerId: 'gg' },
        },
    }, 'review', 'gg', {
        tmuxSessionExists: (name) => name === 'aigon-f436-review-gg-dashboard-rip-out-wterm',
    });
    assert.strictEqual(session.agentId, 'gg');
    assert.strictEqual(session.sessionName, 'aigon-f436-review-gg-dashboard-rip-out-wterm');
});

// REGRESSION feature 295: failed delivery confirmation must return pane tail for diagnosis.
testAsync('nudge delivery failure includes pane tail', async () => {
    await assert.rejects(() => sendNudge('/repo', '295', 'hello', { _deps: {
        resolveEntity: () => ({ entityType: 'feature', entityId: '295', snapshot: { agents: { cc: {} } }, desc: 'demo' }),
        resolveSessions: () => ({ agentId: 'cc', role: 'do', sessionName: 'repo-f295-do-cc-demo' }),
        resolveNudgeTransport: () => ({ submitKey: 'Enter', submitAttempts: 1, retryDelayMs: 0, successPatterns: ['Thinking...'], promptPlaceholder: 'Type your message or @path/to/file' }),
        assertBelowRateLimit: async () => {},
        persistEntityEvents: async () => {},
        runTmux: (args) => args[0] === 'capture-pane' ? { status: 0, stdout: 'stale pane output', stderr: '' } : { status: 0, stdout: '', stderr: '' },
    } }), (error) => (assert.match(error.message, /Nudge text not found in pane after delivery/), assert.strictEqual(error.paneTail, 'stale pane output'), true));
});

testAsync('nudge retries submit when Gemini prompt still contains the injected text', async () => {
    const ops = [];
    let captureCount = 0;
    const result = await sendNudge('/repo', '436', 'hello repo attached test', { _deps: {
        resolveEntity: () => ({ entityType: 'feature', entityId: '436', snapshot: { agents: { gg: {} } }, desc: 'demo' }),
        resolveSessions: () => ({ agentId: 'gg', role: 'review', sessionName: 'repo-f436-review-gg-demo' }),
        resolveNudgeTransport: () => ({
            submitKey: 'Enter',
            submitAttempts: 2,
            retryDelayMs: 0,
            successPatterns: ['Thinking...', '✦ '],
            promptPlaceholder: 'Type your message or @path/to/file',
        }),
        assertBelowRateLimit: async () => {},
        persistEntityEvents: async () => {},
        runTmux: (args, opts = {}) => {
            ops.push({ args, input: opts.input || null });
            if (args[0] === 'capture-pane') {
                captureCount += 1;
                if (captureCount === 1) return { status: 0, stdout: '> hello repo attached test', stderr: '' };
                if (captureCount === 2) return { status: 0, stdout: '> hello repo attached test', stderr: '' };
                return { status: 0, stdout: '⠼ Thinking... (esc to cancel, 6s)\n>   Type your message or @path/to/file', stderr: '' };
            }
            return { status: 0, stdout: '', stderr: '' };
        },
    } });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(ops.filter(op => op.args[0] === 'send-keys').length, 2);
});

report();
