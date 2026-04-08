#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { test, withTempDir, report } = require('../_helpers');
const {
    setupWorktreeEnvironment,
} = require('../../lib/worktree');
const {
    classifyCommitAttributionRange,
    getCommitAnalytics,
    buildCommitAnalyticsSummary,
} = require('../../lib/git');

function git(cwd, args, env = {}) {
    return execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...env },
    }).trim();
}

test('worktree setup preserves human git identity and still records agent attribution', () => withTempDir('aigon-wt-attr-', (repo) => {
    const prevCwd = process.cwd();
    const prevHome = process.env.HOME;
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-home-'));
    const worktreePath = path.join(repo, 'worktree');
    const logsDir = path.join(repo, 'docs', 'specs', 'features', 'logs');

    try {
        process.chdir(repo);
        process.env.HOME = tempHome;

        fs.mkdirSync(logsDir, { recursive: true });
        git(repo, ['init', '-q']);
        git(repo, ['config', 'user.name', 'Human User']);
        git(repo, ['config', 'user.email', 'human@example.com']);
        fs.writeFileSync(path.join(repo, 'README.md'), 'initial\n');
        git(repo, ['add', 'README.md']);
        git(repo, ['commit', '-m', 'init']);
        git(repo, ['worktree', 'add', '-b', 'feature-01-cc-identity', worktreePath, 'HEAD']);

        const repoNameBefore = git(repo, ['config', '--show-origin', '--get', 'user.name']);
        const repoEmailBefore = git(repo, ['config', '--show-origin', '--get', 'user.email']);
        const worktreeNameBefore = git(worktreePath, ['config', '--show-origin', '--get', 'user.name']);
        const worktreeEmailBefore = git(worktreePath, ['config', '--show-origin', '--get', 'user.email']);

        setupWorktreeEnvironment(worktreePath, {
            featureId: '01',
            agentId: 'cc',
            desc: 'identity-check',
            profile: { devServer: { ports: { cc: 4321 } } },
            logsDirPath: logsDir,
        });

        assert.strictEqual(git(repo, ['config', '--show-origin', '--get', 'user.name']), repoNameBefore);
        assert.strictEqual(git(repo, ['config', '--show-origin', '--get', 'user.email']), repoEmailBefore);
        assert.strictEqual(git(worktreePath, ['config', '--show-origin', '--get', 'user.name']), worktreeNameBefore);
        assert.strictEqual(git(worktreePath, ['config', '--show-origin', '--get', 'user.email']), worktreeEmailBefore);

        assert.strictEqual(git(worktreePath, ['config', '--worktree', 'aigon.agentId']), 'cc');
        assert.strictEqual(git(worktreePath, ['config', '--worktree', 'aigon.agentName']), 'Claude');
        assert.strictEqual(git(worktreePath, ['config', '--worktree', 'aigon.agentEmail']), 'cc@aigon.build');

        const head = git(worktreePath, ['rev-parse', 'HEAD']);
        const author = git(worktreePath, ['show', '-s', '--format=%an <%ae>', head]);
        assert.strictEqual(author, 'Human User <human@example.com>');

        const message = git(worktreePath, ['log', '-1', '--format=%B', head]);
        assert.ok(/Aigon-Agent-ID:\s*cc/i.test(message), 'commit message must include the agent trailer');
        assert.ok(/Co-authored-by:\s*Claude <cc@aigon\.build>/i.test(message),
            'commit message must include the co-authored-by trailer');

        const note = git(worktreePath, ['notes', '--ref=refs/notes/aigon-attribution', 'show', head]);
        assert.ok(/aigon\.agent_id=cc/i.test(note), 'git note must record the agent id');
        assert.ok(/aigon\.authorship=ai-authored/i.test(note), 'git note must mark AI authorship');

        const classification = classifyCommitAttributionRange({
            cwd: worktreePath,
            range: `${head}^..${head}`,
        });
        assert.strictEqual(classification.classification, 'ai-authored');
        assert.strictEqual(classification.counts['ai-authored'], 1);
        assert.strictEqual(classification.commits[0].authorEmail, 'human@example.com');
        assert.strictEqual(classification.commits[0].signals.author_agent_email, false);
        assert.strictEqual(classification.commits[0].signals.trailer_agent_id, true);
        assert.strictEqual(classification.commits[0].signals.git_note, true);

        const analytics = getCommitAnalytics({ cwd: worktreePath, forceRefresh: true });
        const summary = buildCommitAnalyticsSummary(analytics.commits);
        assert.strictEqual(summary.byAgent.cc, 1, 'analytics should attribute the worktree setup commit from trailers/notes');
    } finally {
        process.chdir(prevCwd);
        process.env.HOME = prevHome;
        fs.rmSync(tempHome, { recursive: true, force: true });
    }
}));

report();
