#!/usr/bin/env node
// MockAgent — simulates an agent working in a worktree without burning AI tokens.
//
// Two modes:
//   - default (in-process): sleep → write file + commit → sleep → run
//     `aigon agent-status submitted` directly via the real CLI. Fast and
//     deterministic; used by solo-lifecycle dashboard e2e.
//   - useRealWrapper: true (F385): launch a real tmux session running the
//     full buildAgentCommand wrapper (shell trap + heartbeat sidecar) with
//     MOCK_AGENT_BIN substituted for the agent binary, so the trap + sidecar
//     paths get the same coverage as a real agent run.
//
// REGRESSION: invokes the real CLI path so that the legacy status file write
// AND wf.emitSignal() both fire — bypassing with writeAgentStatus once caused
// silent test rot where dashboards never saw 'submitted' and e2e failed quietly.
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const { GIT_SAFE_ENV } = require('../_helpers');

const CLI_PATH = path.join(__dirname, '..', '..', 'aigon-cli.js');
const MOCK_BIN = path.join(__dirname, 'mock-bin', 'mock-agent-bin.sh');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class MockAgent {
    constructor({ featureId, agentId, desc, repoPath, worktreeBase, delays = {}, useRealWrapper = false }) {
        if (!worktreeBase) throw new Error('MockAgent: worktreeBase is required');
        this.featureId = featureId;
        this.agentId = agentId;
        this.desc = desc;
        this.repoPath = repoPath;
        this.delays = { implementing: 15000, submitted: 10000, ...delays };
        this.useRealWrapper = useRealWrapper;
        this._abort = false;
        this.worktreePath = path.join(worktreeBase, `feature-${featureId}-${agentId}-${desc}`);
        this.logPath = path.join(this.worktreePath, 'docs', 'specs', 'features', 'logs', `feature-${featureId}-${agentId}-${desc}-log.md`);
    }

    abort() { this._abort = true; }

    async run() {
        if (this.useRealWrapper) return this._runViaTmux();

        await sleep(this.delays.implementing);
        if (this._abort) return;

        // Filename scoped by agent+feature so fleet→solo runs on the same
        // fixture repo don't collide on an already-merged file.
        const dummyFile = path.join(this.worktreePath, `mock-${this.agentId}-f${this.featureId}-implementation.js`);
        fs.writeFileSync(dummyFile, `// mock ${this.agentId} f${this.featureId}\nmodule.exports = { agent: '${this.agentId}', feature: '${this.featureId}' };\n`);

        try {
            execSync('git add . && git commit -m "feat: mock implementation"', {
                cwd: this.worktreePath, stdio: 'pipe',
                env: { ...process.env, ...GIT_SAFE_ENV },
            });
        } catch (err) {
            throw new Error(`MockAgent commit failed in ${this.worktreePath}\nstdout: ${err.stdout}\nstderr: ${err.stderr}`);
        }

        await sleep(this.delays.submitted);
        if (this._abort) return;

        // MockAgent runs outside the tmux session, so AIGON_ENTITY_* must be
        // set explicitly — the CLI otherwise parses tmux session names and
        // collapses fleet agents (cc+gg) into 'solo'. AIGON_FORCE_PRO is
        // process-global and must be opted in explicitly too.
        execSync(`node ${JSON.stringify(CLI_PATH)} agent-status submitted`, {
            cwd: this.worktreePath, stdio: 'pipe',
            env: {
                ...process.env, AIGON_TEST_MODE: '1',
                AIGON_ENTITY_TYPE: 'feature', AIGON_ENTITY_ID: this.featureId,
                AIGON_AGENT_ID: this.agentId, AIGON_PROJECT_PATH: this.repoPath,
                AIGON_FORCE_PRO: 'true', ...GIT_SAFE_ENV,
            },
        });

        try {
            execSync('git add . && git commit -m "chore: submit" --allow-empty', {
                cwd: this.worktreePath, stdio: 'pipe',
                env: { ...process.env, ...GIT_SAFE_ENV },
            });
        } catch (_) { /* nothing to commit is fine */ }
    }

    // F385: launch a real tmux session running the full buildAgentCommand
    // wrapper, with MOCK_AGENT_BIN substituting for the agent binary. The
    // shell trap + heartbeat sidecar fire end-to-end, so regressions in
    // either surface here instead of in production.
    async _runViaTmux() {
        const padded = String(this.featureId).padStart(2, '0');
        const sessionName = `aigon-mock-${padded}-${this.agentId}-${process.pid}-${Date.now()}`;
        const sleepSec = Math.max(1, Math.round((this.delays.implementing || 0) / 1000));

        const prevBin = process.env.MOCK_AGENT_BIN;
        const prevTestMode = process.env.AIGON_TEST_MODE;
        process.env.MOCK_AGENT_BIN = MOCK_BIN;
        delete process.env.AIGON_TEST_MODE;
        let command;
        try {
            const { buildAgentCommand } = require('../../lib/worktree');
            command = buildAgentCommand({
                agent: this.agentId,
                featureId: padded,
                desc: this.desc,
                path: this.worktreePath,
                repoPath: this.repoPath,
                entityType: 'feature',
            }, 'do');
        } finally {
            if (prevBin === undefined) delete process.env.MOCK_AGENT_BIN;
            else process.env.MOCK_AGENT_BIN = prevBin;
            if (prevTestMode === undefined) delete process.env.AIGON_TEST_MODE;
            else process.env.AIGON_TEST_MODE = prevTestMode;
        }

        // shellQuote produces single-quoted output so embedded newlines + `$`
        // survive tmux's argv → bash -lc handoff. JSON.stringify's `\n` escapes
        // are *not* interpreted inside bash double-quoted strings, so the trap +
        // heartbeat lines collapse onto a single line and the wrapper breaks.
        // Make the trap's `aigon ...` resolve to *this* worktree's CLI rather
        // than the globally installed binary (which may be out of sync when
        // we're iterating in a feature worktree).
        const shimDir = path.join(this.repoPath, '.aigon', 'test-bin');
        fs.mkdirSync(shimDir, { recursive: true });
        const shimPath = path.join(shimDir, 'aigon');
        fs.writeFileSync(shimPath, `#!/usr/bin/env sh\nexec node ${JSON.stringify(CLI_PATH)} "$@"\n`);
        fs.chmodSync(shimPath, 0o755);

        // Inject the shim PATH inside the command body so it survives bash
        // login-shell profile sourcing (which would otherwise reset PATH).
        const wrappedCommand = `export PATH=${require('../../lib/terminal-adapters').shellQuote(shimDir)}:"$PATH"\n${command}`;
        const quoted = require('../../lib/terminal-adapters').shellQuote(wrappedCommand);
        const tmuxArgs = [
            'new-session', '-d', '-s', sessionName, '-c', this.worktreePath,
            '-e', `MOCK_AGENT_SLEEP_SEC=${sleepSec}`,
            `bash -lc ${quoted}`,
        ];
        const r = spawnSync('tmux', tmuxArgs, { stdio: 'pipe', encoding: 'utf8' });
        if (r.status !== 0) throw new Error(`tmux new-session failed: ${r.stderr || r.stdout}`);

        try {
            const statusPath = path.join(this.repoPath, '.aigon', 'state', `feature-${padded}-${this.agentId}.json`);
            const deadline = Date.now() + (this.delays.submitted || 10000) + (sleepSec * 1000) + 8000;
            while (Date.now() < deadline) {
                if (this._abort) return;
                if (fs.existsSync(statusPath)) {
                    try {
                        const rec = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
                        if (rec && (rec.status === 'submitted' || rec.status === 'implementation-complete')) return;
                    } catch (_) { /* file mid-write */ }
                }
                await sleep(150);
            }
            throw new Error(`MockAgent tmux mode timed out waiting for submitted status at ${statusPath}`);
        } finally {
            spawnSync('tmux', ['kill-session', '-t', sessionName], { stdio: 'ignore' });
        }
    }
}

module.exports = { MockAgent, sleep };
