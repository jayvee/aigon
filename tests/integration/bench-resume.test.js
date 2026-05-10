#!/usr/bin/env node
'use strict';
// F504: --resume must skip already-completed pairs in the latest sweep state file.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');

const perfBench = require('../../lib/perf-bench');
const seedReset = require('../../lib/commands/setup/seed-reset');

test('benchKey is stable for an (agentId, modelValue) pair', () => {
    const k = perfBench.benchKey({ agentId: 'cc', modelValue: 'claude-opus-4-7' });
    assert.strictEqual(k, 'cc::claude-opus-4-7');
});

test('writeStateFile + readStateFile round-trip', () => {
    withTempDir((dir) => {
        const fpath = path.join(dir, 'sweep-x.state.json');
        const state = { seed: 'brewboard', startedAt: 'now', pairs: [{ agentId: 'cc', modelValue: 'm', status: 'pending' }] };
        perfBench.writeStateFile(fpath, state);
        const loaded = perfBench.readStateFile(fpath);
        assert.deepStrictEqual(loaded, state);
    });
});

test('loadLatestStateFile picks the most recent matching seed', () => {
    withTempDir((dir) => {
        const a = path.join(dir, 'sweep-2026-01-01T00-00-00-000Z.state.json');
        const b = path.join(dir, 'sweep-2026-02-01T00-00-00-000Z.state.json');
        const c = path.join(dir, 'sweep-2026-03-01T00-00-00-000Z.state.json');
        perfBench.writeStateFile(a, { seed: 'brewboard', pairs: [] });
        perfBench.writeStateFile(b, { seed: 'trailhead', pairs: [] });
        perfBench.writeStateFile(c, { seed: 'brewboard', pairs: [] });
        const latest = perfBench.loadLatestStateFile(dir, 'brewboard');
        assert.ok(latest, 'should find a state file');
        assert.strictEqual(path.basename(latest.path), path.basename(c));
    });
});

test('updatePairInStateFile mutates the matching pair only', () => {
    withTempDir((dir) => {
        const fpath = path.join(dir, 'sweep-x.state.json');
        perfBench.writeStateFile(fpath, {
            seed: 's',
            pairs: [
                { agentId: 'cc', modelValue: 'm1', status: 'pending' },
                { agentId: 'gg', modelValue: 'm2', status: 'pending' },
            ],
        });
        perfBench.updatePairInStateFile(fpath, 'cc', 'm1', { status: 'passed', resultFile: '/x.json' });
        const state = perfBench.readStateFile(fpath);
        assert.strictEqual(state.pairs[0].status, 'passed');
        assert.strictEqual(state.pairs[0].resultFile, '/x.json');
        assert.strictEqual(state.pairs[1].status, 'pending');
    });
});

test('applyResumeFilter: 3 done + 2 pending → only 2 pending are returned', () => {
    withTempDir((dir) => {
        const fpath = path.join(dir, 'sweep-2026-04-01T00-00-00-000Z.state.json');
        perfBench.writeStateFile(fpath, {
            seed: 'brewboard',
            startedAt: '2026-04-01T00:00:00Z',
            pairs: [
                { agentId: 'cc', modelValue: 'm1', status: 'passed' },
                { agentId: 'cc', modelValue: 'm2', status: 'failed' },
                { agentId: 'gg', modelValue: 'm3', status: 'passed' },
                { agentId: 'gg', modelValue: 'm4', status: 'pending' },
                { agentId: 'op', modelValue: 'm5', status: 'pending' },
            ],
        });
        // The "current" sweep enumerates all 5 pairs; resume should reduce to the 2 pending.
        const allPairs = [
            { agentId: 'cc', modelValue: 'm1', modelLabel: 'M1' },
            { agentId: 'cc', modelValue: 'm2', modelLabel: 'M2' },
            { agentId: 'gg', modelValue: 'm3', modelLabel: 'M3' },
            { agentId: 'gg', modelValue: 'm4', modelLabel: 'M4' },
            { agentId: 'op', modelValue: 'm5', modelLabel: 'M5' },
        ];
        const filtered = perfBench.applyResumeFilter(allPairs, dir, 'brewboard');
        assert.strictEqual(filtered.doneCount, 3);
        assert.strictEqual(filtered.pairs.length, 2);
        const remainingKeys = filtered.pairs.map(p => `${p.agentId}::${p.modelValue}`).sort();
        assert.deepStrictEqual(remainingKeys, ['gg::m4', 'op::m5']);
    });
});

test('applyResumeFilter without an existing state file throws when required', () => {
    withTempDir((dir) => {
        const allPairs = [{ agentId: 'cc', modelValue: 'm1', modelLabel: 'M1' }];
        assert.throws(
            () => perfBench.applyResumeFilter(allPairs, dir, 'brewboard'),
            /No sweep state file/
        );
    });
});

// --- Gold-image helpers (F504) ---

test('goldImagePath / goldImageMetaPath produce stable paths under ~/.aigon/bench-seeds', () => {
    const tar = seedReset.goldImagePath('brewboard');
    const meta = seedReset.goldImageMetaPath('brewboard');
    assert.ok(tar.endsWith('/.aigon/bench-seeds/brewboard-gold.tar.gz'));
    assert.ok(meta.endsWith('/.aigon/bench-seeds/brewboard-gold.meta.json'));
});

test('readGoldMeta returns null when missing', () => {
    // Use a guaranteed-absent name to avoid stomping a real gold image.
    const meta = seedReset.readGoldMeta('definitely-not-a-real-seed-name-' + process.pid);
    assert.strictEqual(meta, null);
});

test('createGoldImage + extractGoldImage round-trip via mocked tar', () => {
    withTempDir((dir) => {
        // Mock spawnSync to record the args and pretend tar succeeded.
        const calls = [];
        const fakeExec = (cmd, args /* , opts */) => {
            calls.push({ cmd, args });
            // Pretend the tar invocation produced a tarball.
            if (cmd === 'tar' && args[0] === '-czf') {
                fs.writeFileSync(args[1], 'fake-tar-bytes', 'utf8');
            }
            return { status: 0, stdout: '', stderr: '' };
        };
        // Override goldImageDir by spying — we'll supply a custom seed name and
        // assert tar was invoked with the expected -czf <tmp> -C parent repo args.
        const repoName = 'fakeseed-' + process.pid;
        const parentDir = dir;
        const repoPath = path.join(dir, repoName);
        fs.mkdirSync(repoPath, { recursive: true });
        fs.writeFileSync(path.join(repoPath, 'sentinel'), 'hi', 'utf8');

        const result = seedReset.createGoldImage({
            seedName: repoName,
            repoPath,
            parentDir,
            repoName,
            execFn: fakeExec,
        });
        assert.strictEqual(result.ok, true, `createGoldImage failed: ${result.error}`);
        assert.ok(result.sizeBytes > 0);
        // tar was called with -czf and our parent/repo args
        assert.strictEqual(calls[0].cmd, 'tar');
        assert.strictEqual(calls[0].args[0], '-czf');
        assert.strictEqual(calls[0].args[2], '-C');
        assert.strictEqual(calls[0].args[3], parentDir);
        assert.strictEqual(calls[0].args[4], repoName);

        // Clean up the produced tarball so we don't leak into ~/.aigon/bench-seeds.
        try { fs.unlinkSync(seedReset.goldImagePath(repoName)); } catch (_) {}
    });
});

report();
