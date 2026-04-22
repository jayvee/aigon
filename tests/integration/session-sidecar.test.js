#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');
const { parseEnrichedTmuxSessionsOutput } = require('../../lib/worktree');

const SEP = '__AIGON_SEP__';

test('parseEnrichedTmuxSessionsOutput reads entity fields from sidecar when name is unparseable', () => withTempDir('aigon-ss-', (tmp) => {
    // REGRESSION: feature 311 — Close-resolve and other roles must not rely on tmux name regex alone.
    const sessionsDir = path.join(tmp, '.aigon', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    const badName = 'not-parseable-session-id';
    const record = {
        sessionName: badName,
        entityType: 'f',
        entityId: '311',
        agent: 'cc',
        role: 'close',
        repoPath: tmp,
        worktreePath: tmp,
        createdAt: '2026-04-22T00:00:00.000Z',
    };
    fs.writeFileSync(path.join(sessionsDir, `${badName}.json`), JSON.stringify(record));
    const epochSec = 1_000_000;
    const line = `${badName}${SEP}${epochSec}${SEP}0`;
    const rows = parseEnrichedTmuxSessionsOutput(line, [tmp]);
    assert.strictEqual(rows.length, 1, 'one session row');
    assert.strictEqual(rows[0].entityId, '311');
    assert.strictEqual(rows[0].entityType, 'f');
    assert.strictEqual(rows[0].role, 'close');
    assert.strictEqual(rows[0].agent, 'cc');
    assert.strictEqual(path.resolve(rows[0].repoPath), path.resolve(tmp));
}));

test('parseEnrichedTmuxSessionsOutput prunes sidecar files with no live tmux session', () => withTempDir('aigon-ss2-', (tmp) => {
    // REGRESSION: feature 311 — stale JSON must not accumulate when tmux sessions end.
    const sessionsDir = path.join(tmp, '.aigon', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, 'gone.json'), JSON.stringify({
        sessionName: 'gone',
        entityType: 'f',
        entityId: '1',
        agent: 'cc',
        role: 'do',
        repoPath: tmp,
        worktreePath: tmp,
        createdAt: new Date().toISOString(),
    }));
    const liveName = 'aigon-f311-do-cc';
    fs.writeFileSync(path.join(sessionsDir, `${liveName}.json`), JSON.stringify({
        sessionName: liveName,
        entityType: 'f',
        entityId: '311',
        agent: 'cc',
        role: 'do',
        repoPath: tmp,
        worktreePath: tmp,
        createdAt: new Date().toISOString(),
    }));
    const epochSec = 1_000_000;
    const line = `${liveName}${SEP}${epochSec}${SEP}0`;
    parseEnrichedTmuxSessionsOutput(line, [tmp]);
    assert.ok(!fs.existsSync(path.join(sessionsDir, 'gone.json')));
    assert.ok(fs.existsSync(path.join(sessionsDir, `${liveName}.json`)));
}));

report();
