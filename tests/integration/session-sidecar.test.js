#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');
const {
    parseEnrichedTmuxSessionsOutput,
    writeSessionSidecarRecord,
} = require('../../lib/worktree');

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

test('parseEnrichedTmuxSessionsOutput resolves set conductor ...-s<slug>-auto to repo (no unlinked filter)', () => withTempDir('aigon-set-tmux-', (tmp) => {
    // REGRESSION: set-autonomous-start uses {repo}-s{setSlug}-auto; must not lose repoPath (sessions tab filter).
    const repo = path.join(tmp, 'brewboard');
    fs.mkdirSync(repo, { recursive: true });
    const name = 'brewboard-shomepage-polish-auto';
    const epochSec = 1_000_000;
    const line = `${name}${SEP}${epochSec}${SEP}0`;
    const rows = parseEnrichedTmuxSessionsOutput(line, [repo]);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].entityType, 'S');
    assert.strictEqual(rows[0].entityId, 'homepage-polish');
    assert.strictEqual(path.resolve(rows[0].repoPath), path.resolve(repo));
    assert.strictEqual(rows[0].orphan, null);
    assert.strictEqual(rows[0].role, 'auto');
}));

test('writeSessionSidecarRecord persists tmuxId/shellPid; repo category drops entity fields', () => withTempDir('aigon-ss-id-', (tmp) => {
    writeSessionSidecarRecord({
        sessionName: 'aigon-f351-do-cc', repoPath: tmp, worktreePath: tmp,
        entityType: 'f', entityId: '351', agent: 'cc', role: 'do',
        tmuxId: '$42', shellPid: 99001,
    });
    writeSessionSidecarRecord({
        sessionName: 'ask-myrepo-cc', repoPath: tmp, worktreePath: tmp,
        category: 'repo', agent: 'cc', tmuxId: '$7',
    });
    const ent = JSON.parse(fs.readFileSync(path.join(tmp, '.aigon/sessions/aigon-f351-do-cc.json'), 'utf8'));
    const repo = JSON.parse(fs.readFileSync(path.join(tmp, '.aigon/sessions/ask-myrepo-cc.json'), 'utf8'));
    assert.strictEqual(ent.tmuxId, '$42'); assert.strictEqual(ent.shellPid, 99001);
    assert.strictEqual(ent.category, 'entity'); assert.strictEqual(ent.entityId, '351');
    assert.strictEqual(repo.category, 'repo'); assert.ok(!('entityType' in repo));
}));

test('parseEnrichedTmuxSessionsOutput exposes tmuxId/shellPid; repo category preserved; tmuxId set drives prune', () => withTempDir('aigon-ss-row-', (tmp) => {
    const sessionsDir = path.join(tmp, '.aigon', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, 'ask-myrepo-cc.json'), JSON.stringify({
        category: 'repo', sessionName: 'ask-myrepo-cc', repoPath: tmp, agent: 'cc',
        tmuxId: '$3', createdAt: '2026-04-25T00:00:00.000Z',
    }));
    fs.writeFileSync(path.join(sessionsDir, 'stale.json'), JSON.stringify({
        category: 'entity', sessionName: 'stale', entityType: 'f', entityId: '2',
        agent: 'cc', role: 'do', repoPath: tmp, worktreePath: tmp,
        tmuxId: '$99', createdAt: new Date().toISOString(),
    }));
    const lines = [
        `aigon-f351-do-cc${SEP}1000000${SEP}1${SEP}$12${SEP}54321`,
        `ask-myrepo-cc${SEP}1000000${SEP}0${SEP}$3${SEP}1234`,
    ].join('\n');
    const rows = parseEnrichedTmuxSessionsOutput(lines, [tmp]);
    const byName = Object.fromEntries(rows.map(r => [r.name, r]));
    assert.strictEqual(byName['aigon-f351-do-cc'].tmuxId, '$12');
    assert.strictEqual(byName['aigon-f351-do-cc'].shellPid, 54321);
    assert.strictEqual(byName['ask-myrepo-cc'].category, 'repo');
    assert.strictEqual(byName['ask-myrepo-cc'].agent, 'cc');
    assert.strictEqual(byName['ask-myrepo-cc'].entityType, null);
    assert.ok(!fs.existsSync(path.join(sessionsDir, 'stale.json')), 'sidecar with tmuxId not in live set is pruned');
}));

report();
