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
const agentStatus = require('../lib/agent-status');

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
    constructor({ featureId, agentId, desc, repoPath, delays = {} }) {
        this.featureId = featureId;
        this.agentId = agentId;
        this.desc = desc;
        this.repoPath = repoPath;
        this.delays = { implementing: 15000, submitted: 10000, ...delays };
        this._abort = false;

        // Worktree lives at <repoParent>/<repoName>-worktrees/feature-<id>-<agent>-<desc>
        const repoName = path.basename(repoPath);
        const worktreeBase = path.join(path.dirname(repoPath), `${repoName}-worktrees`);
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

        // Write agent-specific dummy code. Different filenames per agent prevents merge conflicts
        // when cc and gg both commit to their own worktrees.
        const dummyFile = path.join(this.worktreePath, `mock-${this.agentId}-implementation.js`);
        fs.writeFileSync(
            dummyFile,
            `// Mock implementation by agent ${this.agentId}\nmodule.exports = { agent: '${this.agentId}' };\n`
        );

        execSync('git add . && git commit -m "feat: mock implementation"', {
            cwd: this.worktreePath,
            stdio: 'pipe',
        });

        // Phase 2: Simulate final review / polish before submitting
        await sleep(this.delays.submitted);
        if (this._abort) return;

        // Write agent status — matches real agent-status behavior
        agentStatus.writeAgentStatus(this.featureId, this.agentId, {
            status: 'submitted',
            worktreePath: this.worktreePath,
        });

        execSync('git add . && git commit -m "chore: submit"', {
            cwd: this.worktreePath,
            stdio: 'pipe',
        });
    }
}

module.exports = { MockAgent, sleep };
