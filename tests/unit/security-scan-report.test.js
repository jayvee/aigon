#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');
const { readState, writeState } = require('../../lib/security-scan/report');

test('readState throws on unresolved conflict markers', () => withTempDir('aigon-scan-state-', (repo) => {
    const dir = path.join(repo, '.scan');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'state.json'), [
        '{',
        '<<<<<<< Updated upstream',
        '  "lastScanSha": "new",',
        '=======',
        '  "lastScanSha": "old",',
        '>>>>>>> Stashed changes',
        '  "lastScanIso": "2026-06-18",',
        '  "version": 1',
        '}',
        '',
    ].join('\n'));

    assert.throws(
        () => readState(repo),
        /\.scan\/state\.json contains unresolved conflict markers/
    );
}));

test('readState throws on malformed JSON instead of silently resetting scan scope', () => withTempDir('aigon-scan-state-', (repo) => {
    const dir = path.join(repo, '.scan');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'state.json'), '{ "lastScanSha": ');

    assert.throws(
        () => readState(repo),
        /\.scan\/state\.json is not valid JSON/
    );
}));

test('writeState writes parseable scan checkpoint', () => withTempDir('aigon-scan-state-', (repo) => {
    writeState(repo, 'abc123', '2026-06-21');
    assert.deepStrictEqual(readState(repo), {
        lastScanSha: 'abc123',
        lastScanIso: '2026-06-21',
        version: 1,
    });
}));

report();
