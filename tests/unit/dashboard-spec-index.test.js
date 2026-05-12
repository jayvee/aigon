#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report, seedEntityDirs } = require('../_helpers');
const specIndex = require('../../lib/dashboard-spec-index');

function writeFeature(filePath, setSlug) {
    fs.writeFileSync(filePath, [
        '---',
        `set: ${setSlug}`,
        '---',
        '',
        `# ${path.basename(filePath)}`,
        '',
    ].join('\n'));
}

test('warm refresh evicts moved feature specs from their previous stage', () => withTempDir('aigon-spec-index-', (repo) => {
    seedEntityDirs(repo, 'features');
    const inboxPath = path.join(repo, 'docs/specs/features/01-inbox/feature-startup-phase-ui.md');
    const backlogPath = path.join(repo, 'docs/specs/features/02-backlog/feature-527-startup-phase-ui.md');

    specIndex.clearRepoSpecIndexCache(repo);
    writeFeature(inboxPath, 'fleet-startup');

    const initial = specIndex.getRepoSpecIndex(repo, { watchdogEvery: 1000 });
    assert.deepStrictEqual(initial.entries.map(entry => [entry.stage, entry.id, entry.slug]), [
        ['inbox', null, 'startup-phase-ui'],
    ]);

    fs.renameSync(inboxPath, backlogPath);

    const refreshed = specIndex.getRepoSpecIndex(repo, { watchdogEvery: 1000 });
    assert.deepStrictEqual(refreshed.entries.map(entry => [entry.stage, entry.id, entry.slug]), [
        ['backlog', '527', 'startup-phase-ui'],
    ]);
    assert.strictEqual(refreshed.bySet.get('fleet-startup').length, 1);
    assert.ok(!refreshed.byPath.has(inboxPath));
    specIndex.clearRepoSpecIndexCache(repo);
}));

report();
