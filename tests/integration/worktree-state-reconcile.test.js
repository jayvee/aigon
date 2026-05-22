#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');
const { reconcileWorktreeJson, resolveHeartbeatStateDir, buildRawAgentCommand, buildAgentCommand } = require('../../lib/worktree');

// Helper: most agent-command tests need AIGON_TEST_MODE cleared so the wrapper emits the
// live agent-status / heartbeat plumbing. Wrap each test body in this to amortise the boilerplate.
function withLiveAgentMode(fn) {
    const prev = process.env.AIGON_TEST_MODE;
    delete process.env.AIGON_TEST_MODE;
    try { return fn(); }
    finally {
        if (prev === undefined) delete process.env.AIGON_TEST_MODE;
        else process.env.AIGON_TEST_MODE = prev;
    }
}
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
test('Cursor tmux wrapper records agent-status review-complete in cleanup trap', () => withLiveAgentMode(() => {
    // Cursor uses the universal EXIT trap (cu-specific _aigon_agent_rc / exec bash -l removed in b80de8ed).
    const cmd = buildAgentCommand({ agent: 'cu', featureId: '02', path: '/tmp/aigon-cu-wrapper-test-wt', repoPath: process.cwd(), desc: 'wrapper-test' }, 'review');
    assert.ok(cmd.includes('aigon agent-status review-complete'), cmd);
    assert.ok(cmd.includes('trap _aigon_cleanup EXIT'), cmd);
    assert.ok(cmd.includes('_aigon_run_timed'), cmd);
}));
test('OpenCode launches interactive TUI with prompt injected via tmux paste-buffer', () => withLiveAgentMode(() => {
    // REGRESSION: previously op ran `opencode run "<prompt>"` and wrapped exit in `exec bash -l` —
    // that replaced the agent's own prompt with bash. Contract: bare `opencode` TUI + background paste-buffer.
    const cmd = buildAgentCommand({ agent: 'op', featureId: '04', path: '/tmp/aigon-op-linger-test-wt', repoPath: process.cwd() }, 'do');
    assert.ok(/\bopencode\b/.test(cmd), cmd);
    assert.ok(!/\bopencode\s+run\b/.test(cmd), `op should not use 'opencode run': ${cmd}`);
    assert.ok(!cmd.includes('exec bash -l'), `op should not exec bash -l: ${cmd}`);
    assert.ok(cmd.includes('tmux load-buffer') && cmd.includes('tmux paste-buffer') && cmd.includes('tmux send-keys'), cmd);
    assert.ok(cmd.includes('trap _aigon_cleanup EXIT'), cmd);
}));
test('Kimi launches bare `kimi` TUI with prompt injected via tmux send-keys skill command', () => withLiveAgentMode(() => {
    // F483: km uses injectViaTmuxSkillCommand — send-keys -l instead of paste-buffer.
    // `kimi term` requires Python 3.14; bare `kimi` is the native interactive TUI.
    const cmd = buildAgentCommand({ agent: 'km', featureId: '05', path: '/tmp/aigon-km-linger-test-wt', repoPath: process.cwd() }, 'do');
    assert.ok(/&&\s+kimi(?:\s+--[a-z-]+)?\s*$/m.test(cmd) || /&&\s+kimi(?:\s+--[a-z-]+)?\s*\n/.test(cmd), `expected bare 'kimi': ${cmd}`);
    assert.ok(!/\bkimi\s+term\b/.test(cmd) && !cmd.includes('--print') && !cmd.includes('exec bash -l') && !cmd.includes('tmux paste-buffer'), cmd);
    assert.ok(cmd.includes('tmux send-keys') && cmd.includes('-l') && cmd.includes('/skill:aigon-feature-do 05'), cmd);
}));
test('Cursor CLI tmux launch uses agent command (--print/--trust removed in b80de8ed)', () => withLiveAgentMode(() => {
    const cmd = buildRawAgentCommand({ agent: 'cu', featureId: '02', path: '/tmp/aigon-cu-trust-test-wt', repoPath: process.cwd(), desc: 'trust-test' }, 'review');
    assert.ok(cmd.includes(' agent '), `expected agent command in: ${cmd}`);
    assert.ok(!cmd.includes('--print'), `--print removed: ${cmd}`);
}));
test('cc do wrapper: cleanup trap is timed, heartbeat sidecar has parent-alive + time-ceiling + tmux-session guards', () => withLiveAgentMode(() => {
    // REGRESSION (fix A): agent-status calls must be wrapped in _aigon_run_timed — hanging dashboard kept wrapper alive forever.
    // REGRESSION (fix B): sidecar previously only checked `kill -0 $$` — if parent hung in EXIT trap the loop ran forever.
    const cmd = buildAgentCommand({ agent: 'cc', featureId: '10', path: '/tmp/aigon-cc-wrapper-test-wt', repoPath: process.cwd() }, 'do');
    assert.ok(cmd.includes('_aigon_run_timed') && cmd.includes('AIGON_STATUS_TIMEOUT_SECS'), cmd.slice(0, 400));
    assert.ok(cmd.includes('_aigon_run_timed env AIGON_SKIP_FIRST_RUN=1 aigon agent-status implementation-complete'), cmd);
    assert.ok(!cmd.match(/^\s+aigon agent-status implementation-complete\s*$/m), 'unguarded agent-status call found');
    assert.ok(cmd.includes('kill -0 $$'), 'parent-alive guard'); // Guard 1
    assert.ok(cmd.includes('AIGON_HEARTBEAT_MAX_SECS'), 'time-ceiling guard'); // Guard 2
    assert.ok(cmd.includes('tmux has-session'), 'tmux-session guard'); // Guard 3
}));
test('agent wrapper resets stale tmux-server test environment before plumbing calls', () => withLiveAgentMode(() => {
    // REGRESSION: a tmux server first started by dashboard e2e kept HOME/AIGON_TEST_MODE
    // in its global environment; later real agent panes inherited that stale env and
    // `aigon agent-status implementing` launched the first-run wizard.
    const prev = {
        HOME: process.env.HOME,
        AIGON_TEST_MODE: process.env.AIGON_TEST_MODE,
        PLAYWRIGHT_TEST: process.env.PLAYWRIGHT_TEST,
        MOCK_DELAY: process.env.MOCK_DELAY,
        GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
        GIT_CONFIG_SYSTEM: process.env.GIT_CONFIG_SYSTEM,
        PORT: process.env.PORT,
    };
    process.env.HOME = '/Users/example';
    delete process.env.AIGON_TEST_MODE;
    delete process.env.PLAYWRIGHT_TEST;
    delete process.env.MOCK_DELAY;
    delete process.env.GIT_CONFIG_GLOBAL;
    delete process.env.GIT_CONFIG_SYSTEM;
    delete process.env.PORT;
    try {
        const cmd = buildAgentCommand({ agent: 'cc', featureId: '11', path: '/tmp/aigon-cc-env-test-wt', repoPath: process.cwd() }, 'do');
        assert.ok(cmd.includes("export HOME='/Users/example'"), cmd.slice(0, 300));
        assert.ok(cmd.includes('unset AIGON_TEST_MODE'), cmd.slice(0, 300));
        assert.ok(cmd.includes('unset PLAYWRIGHT_TEST'), cmd.slice(0, 300));
        assert.ok(cmd.includes('unset MOCK_DELAY'), cmd.slice(0, 300));
        assert.ok(cmd.includes('unset GIT_CONFIG_GLOBAL'), cmd.slice(0, 300));
        assert.ok(cmd.includes('AIGON_SKIP_FIRST_RUN=1 AIGON_TASK_TYPE=do aigon agent-status implementing'), cmd);
    } finally {
        for (const [key, value] of Object.entries(prev)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
}));
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
test('Fleet research inline prompt files are agent-disambiguated (no shared path)', () => {
    // REGRESSION: Before this fix every Fleet research agent (cc/cu/gg) wrote its
    // rendered prompt to `<tmp>/aigon-inline-prompts/<repo>/research-<id>-research-do.md`
    // — a single path shared across all slots. The bash `$(< file)` substitution
    // runs asynchronously inside each tmux session, so whichever JS write happened
    // last won, and every agent read the last-writer's prompt. Symptom on 2026-05-12:
    // gg believed it was cu, wrote to cu-findings.md, signalled research-complete
    // for cu. Introduced by bfd5047b (2026-04-29) when cc/cu/gg joined the inline
    // prompt path. Fix: include agent id in the filename.
    const wt = require('../../lib/worktree');
    const cmdGg = wt.buildRawAgentCommand({ agent: 'gg', featureId: '02', entityType: 'research', repoPath: process.cwd() }, 'do');
    const cmdCu = wt.buildRawAgentCommand({ agent: 'cu', featureId: '02', entityType: 'research', repoPath: process.cwd() }, 'do');
    const cmdCc = wt.buildRawAgentCommand({ agent: 'cc', featureId: '02', entityType: 'research', repoPath: process.cwd() }, 'do');
    const fileFromCmd = (c) => (c.match(/\$\(<\s+'?([^'\s)]+)/) || [])[1];
    const fGg = fileFromCmd(cmdGg);
    const fCu = fileFromCmd(cmdCu);
    const fCc = fileFromCmd(cmdCc);
    assert.ok(fGg && fCu && fCc, `expected inline prompt files for all three agents (gg=${fGg} cu=${fCu} cc=${fCc})`);
    assert.notStrictEqual(fGg, fCu, 'gg and cu must not share an inline prompt path');
    assert.notStrictEqual(fGg, fCc, 'gg and cc must not share an inline prompt path');
    assert.notStrictEqual(fCu, fCc, 'cu and cc must not share an inline prompt path');
    assert.ok(fGg.includes('-gg-'), `gg path should include agent id: ${fGg}`);
    assert.ok(fCu.includes('-cu-'), `cu path should include agent id: ${fCu}`);
    assert.ok(fCc.includes('-cc-'), `cc path should include agent id: ${fCc}`);
    // The rendered body for each agent must reference its own findings file, not a sibling's.
    assert.ok(fs.readFileSync(fGg, 'utf8').includes('-gg-findings.md'), 'gg prompt must reference gg findings file');
    assert.ok(fs.readFileSync(fCu, 'utf8').includes('-cu-findings.md'), 'cu prompt must reference cu findings file');
    assert.ok(fs.readFileSync(fCc, 'utf8').includes('-cc-findings.md'), 'cc prompt must reference cc findings file');
});
report();
