#!/usr/bin/env node
'use strict';

/**
 * MockAgent — simulates an agent working in a worktree.
 *
 * Used by e2e tests to exercise the full lifecycle without burning real AI tokens.
 * Mirrors the real agent behavior: writes code, commits, updates log frontmatter.
 *
 * Usage:
 *   const MockAgent = require('./mock-agent');
 *   const agent = new MockAgent({ featureId: '05', agentId: 'cc', desc: 'my-feature', repoPath: '/tmp/repo' });
 *   await agent.run();
 *
 * Set MOCK_DELAY=fast (env) to use 500ms delays instead of defaults (for CI/tests).
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { updateLogFrontmatterInPlace } = require('../lib/utils');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

class MockAgent {
    /**
     * @param {object} config
     * @param {string} config.featureId   - padded feature ID, e.g. '05'
     * @param {string} config.agentId     - agent code, e.g. 'cc'
     * @param {string} config.desc        - feature slug, e.g. 'mock-test-feature'
     * @param {string} config.repoPath    - absolute path to the main repo
     * @param {object} [config.delays]    - override delays in ms
     * @param {number} [config.delays.implementing] - ms to wait before committing code (default 15000)
     * @param {number} [config.delays.submitted]    - ms to wait before submitting (default 10000)
     */
    constructor({ featureId, agentId, desc, repoPath, delays = {} }) {
        this.featureId = featureId;
        this.agentId = agentId;
        this.desc = desc;
        this.repoPath = repoPath;

        const fastMode = process.env.MOCK_DELAY === 'fast';
        this.delays = {
            implementing: delays.implementing !== undefined ? delays.implementing : (fastMode ? 500 : 15000),
            submitted: delays.submitted !== undefined ? delays.submitted : (fastMode ? 500 : 10000),
        };

        // Worktree path mirrors getWorktreeBase() in lib/worktree.js:
        //   ../${repoName}-worktrees/feature-${featureId}-${agentId}-${desc}
        const repoName = path.basename(repoPath);
        this.worktreePath = path.join(
            repoPath, '..', `${repoName}-worktrees`,
            `feature-${featureId}-${agentId}-${desc}`
        );

        // Log path mirrors setupWorktreeEnvironment() in lib/worktree.js
        this.logPath = path.join(
            this.worktreePath,
            'docs', 'specs', 'features', 'logs',
            `feature-${featureId}-${agentId}-${desc}-log.md`
        );

        this._aborted = false;
    }

    /** Cancel a running mock agent (no-op if already completed). */
    abort() {
        this._aborted = true;
    }

    /**
     * Simulate agent work:
     *   1. Sleep (implementing delay) — simulates agent thinking/coding
     *   2. Write a dummy file and commit
     *   3. Sleep (submitted delay) — simulates final review
     *   4. Update log to submitted and commit
     *
     * @returns {Promise<void>}
     */
    async run() {
        // 1. Simulate working
        await sleep(this.delays.implementing);
        if (this._aborted) return;

        // 2. Write a dummy code change and commit (simulates real implementation)
        const mockFile = path.join(this.worktreePath, 'mock-implementation.js');
        fs.writeFileSync(mockFile, '// mock implementation\n');
        execSync('git add . && git commit -m "feat: mock implementation"', {
            cwd: this.worktreePath,
            stdio: 'pipe',
        });

        // 3. Simulate final wrap-up before submission
        await sleep(this.delays.submitted);
        if (this._aborted) return;

        // 4. Update log frontmatter to submitted (matches real agent-status submitted behavior)
        updateLogFrontmatterInPlace(this.logPath, {
            status: 'submitted',
            appendEvent: 'submitted',
        });

        execSync('git add . && git commit -m "chore: submit"', {
            cwd: this.worktreePath,
            stdio: 'pipe',
        });
    }
}

module.exports = MockAgent;
