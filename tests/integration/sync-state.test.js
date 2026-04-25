#!/usr/bin/env node
'use strict';

/**
 * F359 — aigon sync configure/push/pull + suspended detection.
 *
 * Builds a bare git repo as the shared sync remote, then exercises:
 *   1. configure → writes .aigon/config.json sync.remote and .aigon/.syncignore
 *   2. push from workspace A → orphan branch created on remote
 *   3. pull into workspace B → state replicated, syncignored paths excluded
 *   4. divergent local change in B → push fails / pull surfaces conflict
 *   5. isFeatureSuspended detects in-progress snapshot with missing worktree
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, testAsync, withTempDir, withRepoCwd, report, GIT_SAFE_ENV } = require('../_helpers');

function git(cwd, args) {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_SAFE_ENV } });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
    return (r.stdout || '').trim();
}

function makeBareRemote(parent) {
    const remote = path.join(parent, 'remote.git');
    git(parent, ['init', '--bare', '--initial-branch=main', remote]);
    return remote;
}

function makeWorkspace(parent, name, _remoteUrl) {
    const ws = path.join(parent, name);
    fs.mkdirSync(ws, { recursive: true });
    git(parent, ['init', '--initial-branch=main', ws]);
    // Seed an initial commit on main so the helper repo isn't empty when we
    // initialise — and to keep workspace state sane.
    fs.writeFileSync(path.join(ws, 'README.md'), `# ${name}\n`);
    git(ws, ['add', 'README.md']);
    git(ws, ['commit', '-m', 'init']);
    return ws;
}

function seedAigonState(ws) {
    const aigon = path.join(ws, '.aigon');
    fs.mkdirSync(path.join(aigon, 'workflows', 'features', '01'), { recursive: true });
    fs.writeFileSync(
        path.join(aigon, 'workflows', 'features', '01', 'snapshot.json'),
        JSON.stringify({ featureId: '01', lifecycle: 'in-progress', mode: 'solo_worktree' }, null, 2),
    );
    fs.mkdirSync(path.join(aigon, 'locks'), { recursive: true });
    fs.writeFileSync(path.join(aigon, 'locks', 'machine-A.lock'), 'pid:1');
    fs.mkdirSync(path.join(aigon, 'sessions'), { recursive: true });
    fs.writeFileSync(path.join(aigon, 'sessions', 'index.json'), JSON.stringify({ host: 'A' }));
    fs.writeFileSync(path.join(aigon, '.env'), 'SECRET=hunter2');
    fs.writeFileSync(path.join(aigon, 'config.json'), JSON.stringify({ profile: 'generic' }, null, 2));
}

testAsync('sync.configure writes sync.remote + .syncignore', async () => {
    await new Promise(resolve => {
        withTempDir('aigon-sync-cfg-', (tmp) => {
            const remote = makeBareRemote(tmp);
            const ws = makeWorkspace(tmp, 'A', remote);
            withRepoCwd(ws, () => {
                // Reset module cache so cwd-dependent paths take effect.
                delete require.cache[require.resolve('../../lib/sync-state')];
                const sync = require('../../lib/sync-state');
                const result = sync.configure(remote);
                assert.strictEqual(result.remote, remote);
                assert.ok(fs.existsSync(path.join(ws, '.aigon', 'config.json')));
                const cfg = JSON.parse(fs.readFileSync(path.join(ws, '.aigon', 'config.json'), 'utf8'));
                assert.strictEqual(cfg.sync.remote, remote);
                assert.ok(fs.existsSync(path.join(ws, '.aigon', '.syncignore')));
                const ignore = fs.readFileSync(path.join(ws, '.aigon', '.syncignore'), 'utf8');
                assert.ok(ignore.includes('locks/'));
                assert.ok(ignore.includes('sessions/'));
                assert.ok(ignore.includes('.env'));
            });
            resolve();
        });
    });
});

testAsync('sync.push then sync.pull replicates state with syncignore enforced', async () => {
    await new Promise(resolve => {
        withTempDir('aigon-sync-pp-', (tmp) => {
            const remote = makeBareRemote(tmp);
            const wsA = makeWorkspace(tmp, 'A', remote);
            const wsB = makeWorkspace(tmp, 'B', remote);
            seedAigonState(wsA);

            // Push from A
            withRepoCwd(wsA, () => {
                delete require.cache[require.resolve('../../lib/sync-state')];
                const sync = require('../../lib/sync-state');
                sync.configure(remote);
                const pushResult = sync.push();
                assert.strictEqual(pushResult.committed, true, 'first push should commit');
                assert.strictEqual(pushResult.pushed, true, 'first push should push');
                // Excluded directories must not have been included in fileCount accounting.
                // (We can't introspect helper repo from here without recompiling; rely on pull side check.)
            });

            // Pull into B
            withRepoCwd(wsB, () => {
                delete require.cache[require.resolve('../../lib/sync-state')];
                const sync = require('../../lib/sync-state');
                sync.configure(remote);
                const pullResult = sync.pull();
                assert.strictEqual(pullResult.applied, true, 'pull should apply remote state');
                assert.ok(pullResult.fileCount > 0);

                const restoredSnap = path.join(wsB, '.aigon', 'workflows', 'features', '01', 'snapshot.json');
                assert.ok(fs.existsSync(restoredSnap), 'snapshot replicated');
                const snap = JSON.parse(fs.readFileSync(restoredSnap, 'utf8'));
                assert.strictEqual(snap.lifecycle, 'in-progress');

                assert.ok(!fs.existsSync(path.join(wsB, '.aigon', 'locks', 'machine-A.lock')), 'locks/ excluded');
                assert.ok(!fs.existsSync(path.join(wsB, '.aigon', 'sessions', 'index.json')), 'sessions/ excluded');
                assert.ok(!fs.existsSync(path.join(wsB, '.aigon', '.env')), '.env excluded');
            });
            resolve();
        });
    });
});

testAsync('sync.push refuses when remote has state but this machine never pulled (REGRESSION: silent overwrite)', async () => {
    await new Promise(resolve => {
        withTempDir('aigon-sync-nopull-', (tmp) => {
            const remote = makeBareRemote(tmp);
            const wsA = makeWorkspace(tmp, 'A', remote);
            const wsB = makeWorkspace(tmp, 'B', remote);
            seedAigonState(wsA);

            withRepoCwd(wsA, () => {
                delete require.cache[require.resolve('../../lib/sync-state')];
                const sync = require('../../lib/sync-state');
                sync.configure(remote);
                sync.push();
            });

            withRepoCwd(wsB, () => {
                delete require.cache[require.resolve('../../lib/sync-state')];
                const sync = require('../../lib/sync-state');
                sync.configure(remote);
                let threw = false;
                try {
                    sync.push();
                } catch (e) {
                    threw = e.code === 'ESYNCCONFLICT' || /sync pull/i.test(e.message);
                }
                assert.ok(threw, 'push without prior pull must not replace remote state');
            });
            resolve();
        });
    });
});

testAsync('sync.pull surfaces divergence as conflict (both sides have local commits)', async () => {
    await new Promise(resolve => {
        withTempDir('aigon-sync-conf-', (tmp) => {
            const remote = makeBareRemote(tmp);
            const wsA = makeWorkspace(tmp, 'A', remote);
            const wsB = makeWorkspace(tmp, 'B', remote);
            seedAigonState(wsA);

            withRepoCwd(wsA, () => {
                delete require.cache[require.resolve('../../lib/sync-state')];
                const sync = require('../../lib/sync-state');
                sync.configure(remote);
                sync.push();
            });

            // B pulls (clean), then makes a local change and pushes successfully.
            withRepoCwd(wsB, () => {
                delete require.cache[require.resolve('../../lib/sync-state')];
                const sync = require('../../lib/sync-state');
                sync.configure(remote);
                sync.pull();
                fs.mkdirSync(path.join(wsB, '.aigon', 'workflows', 'features', '02'), { recursive: true });
                fs.writeFileSync(
                    path.join(wsB, '.aigon', 'workflows', 'features', '02', 'snapshot.json'),
                    JSON.stringify({ featureId: '02', lifecycle: 'in-progress' }),
                );
                sync.push();
            });

            // A makes a different local change without pulling B's.
            withRepoCwd(wsA, () => {
                delete require.cache[require.resolve('../../lib/sync-state')];
                const sync = require('../../lib/sync-state');
                fs.mkdirSync(path.join(wsA, '.aigon', 'workflows', 'features', '03'), { recursive: true });
                fs.writeFileSync(
                    path.join(wsA, '.aigon', 'workflows', 'features', '03', 'snapshot.json'),
                    JSON.stringify({ featureId: '03', lifecycle: 'in-progress' }),
                );
                let conflictDetected = false;
                try { sync.push(); } catch (e) {
                    conflictDetected = e.code === 'ESYNCCONFLICT' || /diverged|rejected|non-fast-forward/i.test(e.message);
                }
                assert.ok(conflictDetected, 'A push must surface divergence after B pushed first');
            });
            resolve();
        });
    });
});

test('isFeatureSuspended: in-progress feature with missing worktreePath flags suspended', () => {
    withTempDir('aigon-sync-susp-', (tmp) => {
        const dir = path.join(tmp, '.aigon', 'workflows', 'features', '07');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'snapshot.json'), JSON.stringify({
            featureId: '07',
            lifecycle: 'in-progress',
            mode: 'solo_worktree',
            worktreePath: '/tmp/aigon-definitely-missing-' + Math.random(),
        }));
        delete require.cache[require.resolve('../../lib/sync-state')];
        const { isFeatureSuspended } = require('../../lib/sync-state');
        assert.strictEqual(isFeatureSuspended(tmp, '07'), true);
        assert.strictEqual(isFeatureSuspended(tmp, '07', { hasLocalWorktree: true }), true,
            'explicit worktreePath miss outranks hasLocalWorktree=true');
        // Snapshot without worktreePath in non-worktree mode → not suspended.
        fs.writeFileSync(path.join(dir, 'snapshot.json'), JSON.stringify({
            featureId: '07', lifecycle: 'in-progress', mode: 'drive_branch',
        }));
        assert.strictEqual(isFeatureSuspended(tmp, '07', { hasLocalWorktree: false }), false);
        // Worktree mode with no local worktree → suspended.
        fs.writeFileSync(path.join(dir, 'snapshot.json'), JSON.stringify({
            featureId: '07', lifecycle: 'in-progress', mode: 'solo_worktree',
        }));
        assert.strictEqual(isFeatureSuspended(tmp, '07', { hasLocalWorktree: false }), true);
        assert.strictEqual(isFeatureSuspended(tmp, '07', { hasLocalWorktree: true }), false);
    });
});

test('makeSyncIgnoreMatcher honours directory and glob patterns', () => {
    delete require.cache[require.resolve('../../lib/sync-state')];
    const { makeSyncIgnoreMatcher } = require('../../lib/sync-state');
    const m = makeSyncIgnoreMatcher(['locks/', 'sessions/', '*.env', '.env*']);
    assert.strictEqual(m('locks/foo.lock'), true);
    assert.strictEqual(m('sessions/index.json'), true);
    assert.strictEqual(m('config.json'), false);
    assert.strictEqual(m('workflows/features/01/snapshot.json'), false);
    assert.strictEqual(m('.env'), true);
    assert.strictEqual(m('.env.local'), true);
    assert.strictEqual(m('worktrees/foo.env'), true);
});

report();
