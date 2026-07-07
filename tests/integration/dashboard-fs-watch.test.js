#!/usr/bin/env node
// F621: filesystem watchers trigger debounced per-repo status refresh.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
    testAsync, withTempDirAsync, report, seedEntityDirs, writeSpec,
} = require('../_helpers');
const {
    createDashboardFsWatch,
    shouldIgnoreWatchPath,
    resolveRepoWatchPaths,
} = require('../../lib/dashboard-fs-watch');

function newResponse() {
    return { summary: { implementing: 0, waiting: 0, complete: 0, error: 0, total: 0 } };
}

testAsync('F621: shouldIgnoreWatchPath filters editor noise and poll side effects', async () => {
    assert.ok(shouldIgnoreWatchPath('feature-1-cu.swp'));
    assert.ok(shouldIgnoreWatchPath('heartbeat-621-cu'));
    assert.ok(shouldIgnoreWatchPath('nudge-recovery-pending-feature-1-cu.json'));
    assert.ok(!shouldIgnoreWatchPath('feature-621-cu.json'));
    assert.ok(!shouldIgnoreWatchPath('features/621/snapshot.json'));
});

testAsync('F621: resolveRepoWatchPaths includes state and spec stage dirs', async () => withTempDirAsync('aigon-f621-paths-', async (repo) => {
    seedEntityDirs(repo, 'features');
    fs.mkdirSync(path.join(repo, '.aigon', 'state'), { recursive: true });
    const paths = resolveRepoWatchPaths(repo);
    assert.ok(paths.some((p) => p.endsWith(path.join('.aigon', 'state'))));
    assert.ok(paths.some((p) => p.endsWith(path.join('docs', 'specs', 'features', '02-backlog'))));
}));

testAsync('F621: fs-watch triggers debounced pollRepoStatus on disk changes', async () => {
    const assert = require('assert');
    const fs = require('fs');
    const path = require('path');
    const { withTempDirAsync, seedEntityDirs, writeSpec } = require('../_helpers');
    const { createDashboardFsWatch, DEBOUNCE_MS } = require('../../lib/dashboard-fs-watch');

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    await withTempDirAsync('aigon-f621-trigger-', async (repo) => {
        seedEntityDirs(repo, 'features');
        fs.mkdirSync(path.join(repo, '.aigon', 'state'), { recursive: true });
        let pollCount = 0;
        const fsWatch = createDashboardFsWatch({
            log: () => {},
            pollRepoStatus: async () => { pollCount += 1; },
            readRepos: () => [repo],
            loadGlobalConfig: () => ({}),
            loadProjectConfig: () => ({}),
        });
        fsWatch.start();
        await sleep(150);
        const before = pollCount;
        writeSpec(repo, 'features', '02-backlog', 'feature-99-fs-watch.md');
        const deadline = Date.now() + 2500;
        while (Date.now() < deadline && pollCount === before) {
            await sleep(50);
        }
        fsWatch.stop();
        assert.ok(pollCount > before, 'fs-watch should schedule pollRepoStatus within 2s of spec write');
    });

    await withTempDirAsync('aigon-f621-debounce-', async (repo) => {
        seedEntityDirs(repo, 'features');
        fs.mkdirSync(path.join(repo, '.aigon', 'state'), { recursive: true });
        let pollCount = 0;
        const fsWatch = createDashboardFsWatch({
            log: () => {},
            pollRepoStatus: async () => { pollCount += 1; },
            readRepos: () => [repo],
            loadGlobalConfig: () => ({}),
            loadProjectConfig: () => ({}),
            debounceMs: DEBOUNCE_MS,
        });
        fsWatch.start();
        await sleep(150);
        for (let i = 0; i < 5; i++) {
            writeSpec(repo, 'features', '02-backlog', `feature-9${i}-burst.md`);
        }
        await sleep(DEBOUNCE_MS + 400);
        fsWatch.stop();
        assert.ok(pollCount >= 1, 'burst writes should trigger at least one poll');
        assert.ok(pollCount <= 2, `burst writes should debounce (got ${pollCount} polls)`);
    });

    await withTempDirAsync('aigon-f621-disabled-', async (repo) => {
        seedEntityDirs(repo, 'features');
        fs.mkdirSync(path.join(repo, '.aigon', 'state'), { recursive: true });
        let pollCount = 0;
        const fsWatch = createDashboardFsWatch({
            log: () => {},
            pollRepoStatus: async () => { pollCount += 1; },
            readRepos: () => [repo],
            loadGlobalConfig: () => ({ dashboard: { fsWatch: false } }),
            loadProjectConfig: () => ({}),
        });
        const result = fsWatch.start();
        assert.strictEqual(result.mode, 'disabled-config');
        writeSpec(repo, 'features', '02-backlog', 'feature-88-disabled.md');
        await sleep(DEBOUNCE_MS + 200);
        fsWatch.stop();
        assert.strictEqual(pollCount, 0, 'disabled fs-watch must not poll');
    });
});

testAsync('F621: spec move visible in collectRepoStatus after re-collect', async () => {
    const { collectRepoStatus, clearTierCache } = require('../../lib/dashboard-status-collector');
    return withTempDirAsync('aigon-f621-move-', async (repo) => {
    seedEntityDirs(repo, 'features');
    fs.mkdirSync(path.join(repo, '.aigon', 'state'), { recursive: true });
    const specName = 'feature-42-moved.md';
    writeSpec(repo, 'features', '01-inbox', specName);
    clearTierCache(repo);
    let latest = collectRepoStatus(repo, newResponse());
    assert.ok((latest.features || []).some((f) => f.stage === 'inbox' && String(f.name).includes('moved')));

    const src = path.join(repo, 'docs', 'specs', 'features', '01-inbox', specName);
    const dest = path.join(repo, 'docs', 'specs', 'features', '02-backlog', specName);
    fs.renameSync(src, dest);
    clearTierCache(repo);
    latest = collectRepoStatus(repo, newResponse());
        assert.ok((latest.features || []).some((f) => f.stage === 'backlog' && String(f.name).includes('moved')),
            'moved spec should appear in backlog after re-collect');
    });
});

report();
