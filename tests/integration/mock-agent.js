#!/usr/bin/env node
/**
 * MockAgent — simulates an agent working in a worktree.
 *
 * Used by e2e-mock-solo.test.js and e2e-mock-fleet.test.js to exercise
 * the full worktree lifecycle without burning real AI tokens.
 *
 * Each MockAgent instance:
 *   1. Sleeps for `delays.implementing` ms (simulates coding)
 *   2. Writes agent-specific dummy code and commits (distinct filenames to avoid merge conflicts)
 *   3. Sleeps for `delays.submitted` ms (simulates final review)
 *   4. Updates log frontmatter to `submitted` and commits
 *
 * Usage:
 *   const { MockAgent } = require('./mock-agent');
 *   const agent = new MockAgent({ featureId: '07', agentId: 'cc', desc: 'dark-mode', repoPath: '/tmp/...' });
 *   await agent.run();
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { GIT_SAFE_ENV } = require('../_helpers');

const CLI_PATH = path.join(__dirname, '..', '..', 'aigon-cli.js');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

class MockAgent {
    /**
     * @param {object} opts
     * @param {string} opts.featureId    - Padded feature ID, e.g. '07'
     * @param {string} opts.agentId     - Agent code, e.g. 'cc', 'gg'
     * @param {string} opts.desc        - Feature slug/desc, e.g. 'mock-test-feature'
     * @param {string} opts.repoPath    - Absolute path to the main repo (temp fixture dir)
     * @param {object} [opts.delays]    - Override default delays (ms)
     * @param {number} [opts.delays.implementing=15000] - Time spent implementing
     * @param {number} [opts.delays.submitted=10000]    - Time before marking submitted
     */
    constructor({ featureId, agentId, desc, repoPath, worktreeBase, delays = {} }) {
        this.featureId = featureId;
        this.agentId = agentId;
        this.desc = desc;
        this.repoPath = repoPath;
        this.delays = { implementing: 15000, submitted: 10000, ...delays };
        this._abort = false;

        // Worktree base is supplied by the test (usually ctx.worktreeBase from
        // tests/dashboard-e2e/setup.js). aigon v2.51+ uses ~/.aigon/worktrees/{repoName}/,
        // so callers must pass the explicit base rather than having MockAgent guess.
        if (!worktreeBase) {
            throw new Error('MockAgent: worktreeBase is required (see tests/dashboard-e2e/setup.js for the expected value)');
        }
        this.worktreePath = path.join(worktreeBase, `feature-${featureId}-${agentId}-${desc}`);

        // Log file path within the worktree (created by feature-start via setupWorktreeEnvironment)
        this.logPath = path.join(
            this.worktreePath,
            'docs', 'specs', 'features', 'logs',
            `feature-${featureId}-${agentId}-${desc}-log.md`
        );
    }

    /** Cancel mid-run (best-effort). */
    abort() {
        this._abort = true;
    }

    /**
     * Run the mock agent: implement → commit → submit.
     * @returns {Promise<void>} Resolves when the agent has submitted.
     */
    async run() {
        // Phase 1: Simulate agent working on implementation
        await sleep(this.delays.implementing);
        if (this._abort) return;

        // Write agent-specific dummy code. Filename includes BOTH agent id
        // AND feature id so successive tests (fleet → solo) don't collide
        // on the same path in the shared fixture repo. Without the feature
        // id, fleet's merged `mock-cc-implementation.js` lives on main and
        // solo's worktree starts with the file already present, making
        // `git add .` a no-op and breaking the test.
        const dummyFile = path.join(
            this.worktreePath,
            `mock-${this.agentId}-f${this.featureId}-implementation.js`
        );
        fs.writeFileSync(
            dummyFile,
            `// Mock implementation by agent ${this.agentId} for feature ${this.featureId}\nmodule.exports = { agent: '${this.agentId}', feature: '${this.featureId}' };\n`
        );

        try {
            execSync('git add . && git commit -m "feat: mock implementation"', {
                cwd: this.worktreePath,
                stdio: 'pipe',
                env: { ...process.env, ...GIT_SAFE_ENV },
            });
        } catch (err) {
            // Surface the actual git error so test failures are diagnosable
            const stdout = err.stdout ? err.stdout.toString() : '';
            const stderr = err.stderr ? err.stderr.toString() : '';
            throw new Error(`MockAgent commit failed in ${this.worktreePath}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`);
        }

        // Phase 2: Simulate final review / polish before submitting
        await sleep(this.delays.submitted);
        if (this._abort) return;

        // Invoke the real CLI `agent-status submitted` so we exercise the
        // full submission path: legacy status file write + engine signal
        // emission. Bypassing this (e.g. calling writeAgentStatus directly)
        // causes silent test rot when the signal contract changes.
        //
        // REGRESSION: prevents the "MockAgent wrote status file but skipped
        // wf.emitSignal()" bug where the dashboard snapshot never picked up
        // the submitted state and the e2e tests failed silently for weeks.
        try {
            execSync(`node ${JSON.stringify(CLI_PATH)} agent-status submitted`, {
                cwd: this.worktreePath,
                stdio: 'pipe',
                env: {
                    ...process.env,
                    AIGON_TEST_MODE: '1',
                    // Real agent sessions get these from `buildAgentCommand`'s
                    // exported env. MockAgent runs outside the tmux session so
                    // it must set them explicitly — otherwise the CLI falls
                    // back to parsing tmux session names and collapses Fleet
                    // agents (cc + gg) into a single `solo` identity.
                    AIGON_ENTITY_TYPE: 'feature',
                    AIGON_ENTITY_ID: this.featureId,
                    AIGON_AGENT_ID: this.agentId,
                    AIGON_PROJECT_PATH: this.repoPath,
                    // Pro state is global (process env), not project-scoped.
                    // MockAgent runs outside the dashboard's process tree so
                    // it must opt in explicitly — otherwise Pro-gated paths
                    // hit the OSS gate during tests.
                    AIGON_FORCE_PRO: 'true',
                    ...GIT_SAFE_ENV,
                },
            });
        } catch (e) {
            throw new Error(`MockAgent failed to submit via CLI: ${e.message}`);
        }

        try {
            execSync('git add . && git commit -m "chore: submit" --allow-empty', {
                cwd: this.worktreePath,
                stdio: 'pipe',
                env: { ...process.env, ...GIT_SAFE_ENV },
            });
        } catch (_) { /* nothing to commit is fine */ }
    }
}

module.exports = { MockAgent, sleep };
