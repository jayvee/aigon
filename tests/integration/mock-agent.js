#!/usr/bin/env node
// MockAgent — simulates an agent working in a worktree without burning AI tokens.
// Phases: sleep(implementing) → write + commit dummy file → sleep(submitted) →
// `aigon agent-status submitted` via real CLI → empty commit.
//
// REGRESSION: invokes the real CLI path so that the legacy status file write
// AND wf.emitSignal() both fire — bypassing with writeAgentStatus once caused
// silent test rot where dashboards never saw 'submitted' and e2e failed quietly.
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { GIT_SAFE_ENV } = require('../_helpers');

const CLI_PATH = path.join(__dirname, '..', '..', 'aigon-cli.js');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class MockAgent {
    constructor({ featureId, agentId, desc, repoPath, worktreeBase, delays = {} }) {
        if (!worktreeBase) throw new Error('MockAgent: worktreeBase is required');
        this.featureId = featureId;
        this.agentId = agentId;
        this.desc = desc;
        this.repoPath = repoPath;
        this.delays = { implementing: 15000, submitted: 10000, ...delays };
        this._abort = false;
        this.worktreePath = path.join(worktreeBase, `feature-${featureId}-${agentId}-${desc}`);
        this.logPath = path.join(this.worktreePath, 'docs', 'specs', 'features', 'logs', `feature-${featureId}-${agentId}-${desc}-log.md`);
    }

    abort() { this._abort = true; }

    async run() {
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
}

module.exports = { MockAgent, sleep };
