#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');
const { reconcileWorktreeJson, resolveHeartbeatStateDir, buildRawAgentCommand, buildAgentCommand } = require('../../lib/worktree');
test('reconcileWorktreeJson writes or repairs mainRepo pointer', () => withTempDir('aigon-wtjson-', (tmp) => {
    // REGRESSION: feature-start skip branch left no worktree.json; wrong mainRepo broke heartbeat vs dashboard.
    const main = path.join(tmp, 'main');
    const other = path.join(tmp, 'other');
    const wt = path.join(tmp, 'wt');
    fs.mkdirSync(path.join(wt, '.aigon'), { recursive: true });
    reconcileWorktreeJson(wt, main);
    assert.strictEqual(path.resolve(JSON.parse(fs.readFileSync(path.join(wt, '.aigon', 'worktree.json'), 'utf8')).mainRepo), main);
    fs.writeFileSync(path.join(wt, '.aigon', 'worktree.json'), JSON.stringify({ mainRepo: other }, null, 2));
    reconcileWorktreeJson(wt, main);
    assert.strictEqual(path.resolve(JSON.parse(fs.readFileSync(path.join(wt, '.aigon', 'worktree.json'), 'utf8')).mainRepo), main);
}));
test('resolveHeartbeatStateDir: AIGON_PROJECT_PATH when no worktree.json; file wins over env', () => withTempDir('aigon-hb-', (tmp) => {
    // REGRESSION: sidecar touched worktree .aigon/state while readers used main repo.
    const mainA = path.join(tmp, 'a');
    const mainB = path.join(tmp, 'b');
    fs.mkdirSync(mainA, { recursive: true });
    fs.mkdirSync(mainB, { recursive: true });
    const wt = path.join(tmp, 'wt');
    fs.mkdirSync(wt, { recursive: true });
    const prev = process.env.AIGON_PROJECT_PATH;
    process.env.AIGON_PROJECT_PATH = mainA;
    try {
        assert.strictEqual(resolveHeartbeatStateDir({ path: wt }), path.join(mainA, '.aigon', 'state'));
    } finally {
        if (prev === undefined) delete process.env.AIGON_PROJECT_PATH;
        else process.env.AIGON_PROJECT_PATH = prev;
    }
    fs.mkdirSync(path.join(wt, '.aigon'), { recursive: true });
    fs.writeFileSync(path.join(wt, '.aigon', 'worktree.json'), JSON.stringify({ mainRepo: mainA }, null, 2));
    process.env.AIGON_PROJECT_PATH = mainB;
    try {
        assert.strictEqual(resolveHeartbeatStateDir({ path: wt }), path.join(mainA, '.aigon', 'state'));
    } finally {
        if (prev === undefined) delete process.env.AIGON_PROJECT_PATH;
        else process.env.AIGON_PROJECT_PATH = prev;
    }
}));
test('Cursor tmux wrapper records agent-status on agent exit then clears EXIT trap', () => {
    // REGRESSION: Composer stayed open after review; EXIT trap never ran so
    // review-complete was missing until a nudge. Same post-success path as op.
    const prev = process.env.AIGON_TEST_MODE;
    delete process.env.AIGON_TEST_MODE;
    try {
        const cmd = buildAgentCommand({
            agent: 'cu',
            featureId: '02',
            path: '/tmp/aigon-cu-wrapper-test-wt',
            repoPath: process.cwd(),
            desc: 'wrapper-test',
        }, 'review');
        assert.ok(cmd.includes('_aigon_agent_rc=$?'), cmd);
        assert.ok(cmd.includes('aigon agent-status review-complete'), cmd);
        assert.ok(cmd.includes('trap - EXIT'), cmd);
        assert.ok(cmd.includes('exec bash -l'), cmd);
    } finally {
        if (prev === undefined) delete process.env.AIGON_TEST_MODE;
        else process.env.AIGON_TEST_MODE = prev;
    }
});
test('OpenCode launches interactive TUI with prompt injected via tmux paste-buffer', () => {
    // REGRESSION: previously op ran `opencode run "<prompt>"` (one-shot batch) and
    // wrapped exit in `exec bash -l` to keep the pane alive — that replaced the
    // agent's own prompt with bash. Contract now: launch `opencode` (TUI, no
    // subcommand) and paste the slash-command prompt into the TUI via a
    // backgrounded `tmux paste-buffer` after a delay, so the agent's own prompt
    // remains the live surface.
    const prev = process.env.AIGON_TEST_MODE;
    delete process.env.AIGON_TEST_MODE;
    try {
        const cmd = buildAgentCommand({
            agent: 'op',
            featureId: '04',
            path: '/tmp/aigon-op-linger-test-wt',
            repoPath: process.cwd(),
        }, 'do');
        // TUI mode: bare `opencode`, no `run` subcommand, no inline prompt arg.
        assert.ok(/\bopencode\b/.test(cmd), cmd);
        assert.ok(!/\bopencode\s+run\b/.test(cmd), `op should not use 'opencode run': ${cmd}`);
        assert.ok(!cmd.includes('exec bash -l'), `op should not exec bash -l (TUI keeps the pane): ${cmd}`);
        // Background injection: paste-buffer + send-keys Enter into the TUI
        assert.ok(cmd.includes('tmux load-buffer'), cmd);
        assert.ok(cmd.includes('tmux paste-buffer'), cmd);
        assert.ok(cmd.includes('tmux send-keys'), cmd);
        // Universal lifecycle still in place
        assert.ok(cmd.includes('trap _aigon_cleanup EXIT'), cmd);
    } finally {
        if (prev === undefined) delete process.env.AIGON_TEST_MODE;
        else process.env.AIGON_TEST_MODE = prev;
    }
});
test('Kimi launches bare `kimi` TUI with prompt injected via tmux paste-buffer', () => {
    // REGRESSION: `kimi term` was tried first but requires Python 3.14; bare
    // `kimi` is the native interactive TUI ("Welcome to Kimi Code CLI!").
    const prev = process.env.AIGON_TEST_MODE;
    delete process.env.AIGON_TEST_MODE;
    try {
        const cmd = buildAgentCommand({
            agent: 'km',
            featureId: '05',
            path: '/tmp/aigon-km-linger-test-wt',
            repoPath: process.cwd(),
        }, 'do');
        // Bare `kimi` (no `term`, no `--print`)
        assert.ok(/&&\s+kimi\s*$/m.test(cmd) || /&&\s+kimi\s*\n/.test(cmd), `expected bare 'kimi' launch: ${cmd}`);
        assert.ok(!/\bkimi\s+term\b/.test(cmd), `km should not use 'kimi term' (Python 3.14 dep): ${cmd}`);
        assert.ok(!cmd.includes('--print'), `km should not use --print: ${cmd}`);
        assert.ok(!cmd.includes('exec bash -l'), cmd);
        assert.ok(cmd.includes('tmux paste-buffer'), cmd);
    } finally {
        if (prev === undefined) delete process.env.AIGON_TEST_MODE;
        else process.env.AIGON_TEST_MODE = prev;
    }
});
test('Cursor CLI tmux launch adds --print and --trust (workspace trust in headless)', () => {
    // REGRESSION: dashboard/code-review in tmux hung on "Trust this workspace" — Cursor
    // only honors --trust with --print; interactive agent has no stdin in tmux.
    const prev = process.env.AIGON_TEST_MODE;
    delete process.env.AIGON_TEST_MODE;
    try {
        const cmd = buildRawAgentCommand({
            agent: 'cu',
            featureId: '02',
            path: '/tmp/aigon-cu-trust-test-wt',
            repoPath: process.cwd(),
            desc: 'trust-test',
        }, 'review');
        assert.ok(cmd.includes(' agent '), `expected agent command in: ${cmd}`);
        assert.ok(cmd.includes('--print'), `expected --print in: ${cmd}`);
        assert.ok(cmd.includes('--trust'), `expected --trust in: ${cmd}`);
        assert.ok(cmd.indexOf('--print') < cmd.indexOf('--trust'), '--print should precede --trust');
        assert.ok(cmd.includes('< /dev/null'), 'expected stdin closed so Cursor agent exits after --print turn');
    } finally {
        if (prev === undefined) delete process.env.AIGON_TEST_MODE;
        else process.env.AIGON_TEST_MODE = prev;
    }
});
test('headless research spec-review launches inline instructions instead of recursive shell guidance', () => {
    // REGRESSION: Gemini spec-review sessions were told to run `aigon research-spec-review`
    // from inside the session, so they edited the spec and made a generic commit
    // without recording workflow state. Prompt body lives in a temp file referenced via $(< …).
    const cmd = buildRawAgentCommand({
        agent: 'gg',
        featureId: '01',
        entityType: 'research',
        repoPath: process.cwd(),
    }, 'spec-review');
    assert.ok(cmd.includes('$(< ') && cmd.includes('gemini'), 'expected inline prompt file + gemini launch');
    assert.ok(!cmd.includes('Then run `aigon research-spec-review 01` in the shell and follow its output.'));
});
report();
