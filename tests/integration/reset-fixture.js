#!/usr/bin/env node
/**
 * Reset fixture repos to clean backlog state.
 *
 * Kills tmux sessions, removes worktrees, clears manifests/locks,
 * moves all features back to backlog, deletes branches, and commits.
 *
 * Usage:
 *   node test/reset-fixture.js                    # Reset all fixture repos
 *   node test/reset-fixture.js brewboard          # Reset one repo
 *   node test/reset-fixture.js brewboard trailhead # Reset specific repos
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const HOME = process.env.HOME || '/tmp';
const FIXTURE_REPOS = ['brewboard', 'brewboard-api', 'trailhead'];

function run(cmd, opts = {}) {
    try {
        return execSync(cmd, { encoding: 'utf8', stdio: 'pipe', ...opts }).trim();
    } catch (e) {
        if (!opts.ignoreError) console.error(`  ⚠️  ${cmd}: ${(e.stderr || e.message || '').trim().slice(0, 100)}`);
        return '';
    }
}

function resetRepo(repoName) {
    const repoPath = path.join(HOME, 'src', repoName);
    if (!fs.existsSync(repoPath)) {
        console.log(`⏭️  ${repoName}: not found at ${repoPath}, skipping`);
        return;
    }

    console.log(`\n🔄 Resetting ${repoName}...`);

    // 1. Kill tmux sessions for this repo
    try {
        const sessions = run('tmux ls -F "#{session_name}" 2>/dev/null') || '';
        sessions.split('\n').filter(Boolean).forEach(s => {
            if (s.startsWith(repoName + '-')) {
                run(`tmux kill-session -t "${s}"`, { ignoreError: true });
                console.log(`  🗑️  Killed tmux session: ${s}`);
            }
        });
    } catch (e) { /* no tmux server */ }

    // 2. Remove worktrees directory
    const worktreesDir = path.join(HOME, 'src', `${repoName}-worktrees`);
    if (fs.existsSync(worktreesDir)) {
        fs.rmSync(worktreesDir, { recursive: true, force: true });
        console.log(`  🗑️  Removed worktrees: ${worktreesDir}`);
    }

    // 2b. Prune git worktree references (must happen AFTER directory removal)
    run(`git -C "${repoPath}" worktree prune`, { ignoreError: true });

    // 3. Clear manifests, locks, state
    for (const subdir of ['state', 'locks']) {
        const dir = path.join(repoPath, '.aigon', subdir);
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
            console.log(`  🗑️  Cleared .aigon/${subdir}/`);
        }
    }

    // 4. Prune git worktrees
    run(`git -C "${repoPath}" worktree prune`, { ignoreError: true });

    // 5. Delete all non-main branches
    const branches = run(`git -C "${repoPath}" branch --format="%(refname:short)"`) || '';
    branches.split('\n').filter(b => b && b !== 'main' && b !== 'master').forEach(branch => {
        run(`git -C "${repoPath}" branch -D "${branch}"`, { ignoreError: true });
        console.log(`  🗑️  Deleted branch: ${branch}`);
    });

    // 6. Move all features back to backlog
    const specsRoot = path.join(repoPath, 'docs', 'specs', 'features');
    const moveDirs = ['03-in-progress', '04-in-evaluation', '05-done', '06-paused'];
    const backlogDir = path.join(specsRoot, '02-backlog');
    let moved = 0;

    if (fs.existsSync(backlogDir)) {
        for (const dir of moveDirs) {
            const fullDir = path.join(specsRoot, dir);
            if (!fs.existsSync(fullDir)) continue;
            fs.readdirSync(fullDir).filter(f => f.endsWith('.md')).forEach(f => {
                const src = path.join(fullDir, f);
                // Strip ID prefix for backlog (features in done may have IDs already)
                const dest = path.join(backlogDir, f);
                if (!fs.existsSync(dest)) {
                    fs.renameSync(src, dest);
                    moved++;
                }
            });
        }
        if (moved > 0) console.log(`  📋 Moved ${moved} feature(s) back to backlog`);
    }

    // 7. Rewrite config with correct per-provider models
    const FIXTURE_PORTS = { brewboard: 4200, 'brewboard-api': 4210, trailhead: 4220 };
    const port = FIXTURE_PORTS[repoName] || 4200;
    const configPath = path.join(repoPath, '.aigon', 'config.json');
    const config = {
        profile: 'web',
        agents: {
            cc: { models: { research: 'haiku', implement: 'haiku', evaluate: 'haiku' } },
            gg: { models: { research: 'gemini-2.5-flash', implement: 'gemini-2.5-flash', evaluate: 'gemini-2.5-flash' } },
            cx: { models: { research: 'gpt-4.1-mini', implement: 'gpt-4.1-mini', evaluate: 'gpt-4.1-mini' } },
        },
        devProxy: { basePort: port },
    };
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    fs.writeFileSync(path.join(repoPath, '.env'), `PORT=${port}\n`);
    console.log(`  🔧 Config reset (models + PORT=${port})`);

    // 8. Reinstall agent commands
    const aigonCli = path.join(__dirname, '..', 'aigon-cli.js');
    run(`node "${aigonCli}" install-agent cc gg`, { cwd: repoPath, ignoreError: true });
    console.log(`  🔧 Reinstalled agent commands (cc, gg)`);

    // 10. Remove log files (they'll be recreated by feature-start)
    const logsDir = path.join(specsRoot, 'logs');
    if (fs.existsSync(logsDir)) {
        const logFiles = fs.readdirSync(logsDir).filter(f => f.endsWith('-log.md'));
        logFiles.forEach(f => fs.unlinkSync(path.join(logsDir, f)));
        if (logFiles.length > 0) console.log(`  🗑️  Removed ${logFiles.length} log file(s)`);
    }

    // 11. Remove evaluation files
    const evalsDir = path.join(specsRoot, 'evaluations');
    if (fs.existsSync(evalsDir)) {
        const evalFiles = fs.readdirSync(evalsDir).filter(f => f.endsWith('.md'));
        evalFiles.forEach(f => fs.unlinkSync(path.join(evalsDir, f)));
        if (evalFiles.length > 0) console.log(`  🗑️  Removed ${evalFiles.length} evaluation file(s)`);
    }

    // 9. Stage and commit
    const status = run(`git -C "${repoPath}" status --short`);
    if (status) {
        run(`git -C "${repoPath}" add -A`);
        run(`git -C "${repoPath}" commit -m "chore: reset fixture to clean backlog state"`, { ignoreError: true });
        console.log(`  📝 Committed reset`);
    }

    // 10. Push to remote if configured
    const hasRemote = run(`git -C "${repoPath}" remote get-url origin`, { ignoreError: true });
    if (hasRemote) {
        run(`git -C "${repoPath}" push --force origin main`, { ignoreError: true });
        console.log(`  ☁️  Pushed to remote`);
    }

    console.log(`  ✅ ${repoName} reset — all features in backlog`);
}

// --- Main ---
const args = process.argv.slice(2);
const repos = args.length > 0 ? args : FIXTURE_REPOS;

console.log('Aigon Fixture Reset');
console.log('═'.repeat(40));

repos.forEach(resetRepo);

console.log('\n✅ Done. Refresh the dashboard to see clean state.');
