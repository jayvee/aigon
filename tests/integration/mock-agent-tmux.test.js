#!/usr/bin/env node
'use strict';
// REGRESSION (F385): MockAgent's in-process mode shells directly to
// `aigon agent-status submitted` and bypasses the buildAgentCommand wrapper —
// so a regression in shell-trap quoting, heartbeat sidecar startup, or the
// trap-vs-status teardown order would not surface in any test until a real
// agent run caught it. tmux mode runs the wrapper end-to-end via MOCK_AGENT_BIN
// and asserts the heartbeat sidecar fires + the EXIT trap submits.
const a = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { testAsync, withTempDirAsync, GIT_SAFE_ENV, report } = require('../_helpers');
const engine = require('../../lib/workflow-core/engine');
const { MockAgent } = require('./mock-agent');

const hasTmux = spawnSync('tmux', ['-V'], { stdio: 'ignore' }).status === 0;

testAsync('MockAgent tmux mode: heartbeat sidecar + trap-driven submitted fire end-to-end', () => withTempDirAsync('aigon-mock-tmux-', async (tmp) => {
    if (!hasTmux) {
        console.log('  ⊘ skipped (tmux not installed)');
        return;
    }
    const repo = path.join(tmp, 'repo');
    const worktreeBase = path.join(tmp, 'worktrees');
    fs.mkdirSync(worktreeBase, { recursive: true });
    for (const sub of ['docs/specs/features/03-in-progress', 'docs/specs/features/logs', '.aigon/workflows/features', '.aigon/state']) {
        fs.mkdirSync(path.join(repo, sub), { recursive: true });
    }
    fs.writeFileSync(path.join(repo, 'docs/specs/features/03-in-progress/feature-01-mock-tmux.md'), '# Feature: mock-tmux\n');
    // Disable security gates so the wrapper's `aigon agent-status submitted` succeeds without gitleaks.
    fs.writeFileSync(path.join(repo, '.aigon/config.json'), JSON.stringify({
        security: { enabled: false },
        heartbeat: { intervalMs: 1000 },
    }));

    const gitOpts = { cwd: repo, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'pipe' };
    a.strictEqual(spawnSync('git', ['init', '-q', '-b', 'main'], gitOpts).status, 0);
    fs.writeFileSync(path.join(repo, 'README.md'), 'main\n');
    a.strictEqual(spawnSync('git', ['add', '.'], gitOpts).status, 0);
    a.strictEqual(spawnSync('git', ['commit', '-q', '-m', 'init'], gitOpts).status, 0);
    await engine.startFeature(repo, '01', 'solo_branch', ['cc']);

    const branch = 'feature-01-cc-mock-tmux';
    const wtPath = path.join(worktreeBase, branch);
    a.strictEqual(spawnSync('git', ['worktree', 'add', '-q', '-b', branch, wtPath], gitOpts).status, 0);
    fs.mkdirSync(path.join(wtPath, '.aigon'), { recursive: true });
    fs.writeFileSync(path.join(wtPath, '.aigon', 'worktree.json'), JSON.stringify({ mainRepo: repo }));

    await new MockAgent({
        featureId: '01', agentId: 'cc', desc: 'mock-tmux',
        repoPath: repo, worktreeBase,
        delays: { implementing: 1000, submitted: 4000 },
        useRealWrapper: true,
    }).run();

    const hb = path.join(repo, '.aigon', 'state', 'heartbeat-01-cc');
    a.ok(fs.existsSync(hb), `heartbeat sidecar should have touched ${hb}`);
    const status = JSON.parse(fs.readFileSync(path.join(repo, '.aigon', 'state', 'feature-01-cc.json'), 'utf8'));
    a.strictEqual(status.status, 'implementation-complete', 'EXIT trap should have run agent-status implementation-complete');
}));

report();
