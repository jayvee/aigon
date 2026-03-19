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

    // 7. Remove log files (they'll be recreated by feature-setup)
    const logsDir = path.join(specsRoot, 'logs');
    if (fs.existsSync(logsDir)) {
        const logFiles = fs.readdirSync(logsDir).filter(f => f.endsWith('-log.md'));
        logFiles.forEach(f => fs.unlinkSync(path.join(logsDir, f)));
        if (logFiles.length > 0) console.log(`  🗑️  Removed ${logFiles.length} log file(s)`);
    }

    // 8. Remove evaluation files
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

    console.log(`  ✅ ${repoName} reset — all features in backlog`);
}

// --- Main ---
const args = process.argv.slice(2);
const repos = args.length > 0 ? args : FIXTURE_REPOS;

console.log('Aigon Fixture Reset');
console.log('═'.repeat(40));

repos.forEach(resetRepo);

console.log('\n✅ Done. Refresh the dashboard to see clean state.');
