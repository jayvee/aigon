'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { test, withTempDir, report } = require('../_helpers');
const {
    PROJECT_EXCLUDES,
    DEFAULT_RETENTION,
    applyTelemetryRetention,
} = require('../../lib/backup');
const { mergeJsonlByTimestamp } = require('../../lib/sync-merge');

function daysAgoMs(days) {
    return Date.now() - days * 24 * 60 * 60 * 1000;
}

function writeJsonFile(fp, obj) {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(obj) + '\n', 'utf8');
}

// REGRESSION: telemetry must remain included in backup scope while sessions/locks stay excluded.
test('PROJECT_EXCLUDES keeps telemetry included and sessions/locks excluded', () => {
    assert.ok(!PROJECT_EXCLUDES.has('telemetry'));
    assert.ok(PROJECT_EXCLUDES.has('sessions'));
    assert.ok(PROJECT_EXCLUDES.has('locks'));
});

// REGRESSION: retention compresses aged per-session telemetry and preserves recent files.
test('retention compress: per-session json older than compressAfterDays becomes .json.gz', () => withTempDir('backup-test-', (repo) => {
    const telDir = path.join(repo, '.aigon', 'telemetry');
    fs.mkdirSync(telDir, { recursive: true });

    const oldFile = path.join(telDir, 'feature-100-cc-abc.json');
    writeJsonFile(oldFile, { featureId: '100', endAt: new Date(daysAgoMs(91)).toISOString() });

    const newFile = path.join(telDir, 'feature-100-cc-def.json');
    writeJsonFile(newFile, { featureId: '100', endAt: new Date(daysAgoMs(10)).toISOString() });

    applyTelemetryRetention(repo);

    assert.ok(!fs.existsSync(oldFile));
    assert.ok(fs.existsSync(oldFile + '.gz'));
    const decompressed = zlib.gunzipSync(fs.readFileSync(oldFile + '.gz')).toString('utf8');
    assert.strictEqual(JSON.parse(decompressed).featureId, '100');
    assert.ok(fs.existsSync(newFile));
    assert.ok(!fs.existsSync(newFile + '.gz'));
}));

// REGRESSION: retention drop deletes telemetry older than dropAfterDays.
test('retention drop: per-session json older than dropAfterDays is deleted', () => withTempDir('backup-test-', (repo) => {
    const telDir = path.join(repo, '.aigon', 'telemetry');
    fs.mkdirSync(telDir, { recursive: true });

    const oldFile = path.join(telDir, 'feature-200-cc-xyz.json');
    writeJsonFile(oldFile, { featureId: '200', endAt: new Date(daysAgoMs(400)).toISOString() });

    applyTelemetryRetention(repo);

    assert.ok(!fs.existsSync(oldFile));
    assert.ok(!fs.existsSync(oldFile + '.gz'));
}));

// REGRESSION: retention can be disabled without mutating existing telemetry files.
test('retention disabled when compressAfterDays=0', () => withTempDir('backup-test-', (repo) => {
    const telDir = path.join(repo, '.aigon', 'telemetry');
    fs.mkdirSync(telDir, { recursive: true });

    const oldFile = path.join(telDir, 'feature-300-cc-aaa.json');
    writeJsonFile(oldFile, { featureId: '300', endAt: new Date(daysAgoMs(200)).toISOString() });

    applyTelemetryRetention(repo, { compressAfterDays: 0, dropAfterDays: 0 });

    assert.ok(fs.existsSync(oldFile));
    assert.ok(!fs.existsSync(oldFile + '.gz'));
}));

// REGRESSION: signal-health jsonl retention compresses aged daily files by filename date.
test('retention: signal-health jsonl older than compressAfterDays becomes .jsonl.gz', () => withTempDir('backup-test-', (repo) => {
    const shDir = path.join(repo, '.aigon', 'telemetry', 'signal-health');
    fs.mkdirSync(shDir, { recursive: true });

    const oldDate = new Date(daysAgoMs(100));
    const oldFile = path.join(shDir, `${oldDate.toISOString().slice(0, 10)}.jsonl`);
    fs.writeFileSync(oldFile, '{"t":"2025-01-01T00:00:00Z","type":"nudge"}\n', 'utf8');

    const recentDate = new Date(daysAgoMs(5));
    const recentFile = path.join(shDir, `${recentDate.toISOString().slice(0, 10)}.jsonl`);
    fs.writeFileSync(recentFile, '{"t":"2026-04-24T00:00:00Z","type":"nudge"}\n', 'utf8');

    applyTelemetryRetention(repo);

    assert.ok(!fs.existsSync(oldFile));
    assert.ok(fs.existsSync(oldFile + '.gz'));
    assert.ok(fs.existsSync(recentFile));
}));

// REGRESSION: sync merge must union jsonl events, sort by timestamp, and deduplicate.
test('mergeJsonlByTimestamp: union + sort by t + dedup', () => withTempDir('backup-test-', (dir) => {
    const local = path.join(dir, 'local.jsonl');
    const imported = path.join(dir, 'imported.jsonl');

    const e1 = JSON.stringify({ t: '2026-04-29T10:00:00Z', type: 'a' });
    const e2 = JSON.stringify({ t: '2026-04-29T09:00:00Z', type: 'b' });
    const e3 = JSON.stringify({ t: '2026-04-29T11:00:00Z', type: 'c' });

    fs.writeFileSync(local, `${e1}\n${e2}\n`, 'utf8');
    fs.writeFileSync(imported, `${e1}\n${e3}\n`, 'utf8');

    mergeJsonlByTimestamp(local, imported);

    const parsed = fs.readFileSync(local, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    assert.strictEqual(parsed.length, 3);
    assert.strictEqual(parsed[0].type, 'b');
    assert.strictEqual(parsed[1].type, 'a');
    assert.strictEqual(parsed[2].type, 'c');
}));

// REGRESSION: jsonl merge must tolerate non-JSON lines without throwing.
test('mergeJsonlByTimestamp: falls back gracefully for non-JSON lines', () => withTempDir('backup-test-', (dir) => {
    const local = path.join(dir, 'local.jsonl');
    const imported = path.join(dir, 'imported.jsonl');

    fs.writeFileSync(local, 'not-json\n{"t":"2026-01-01T00:00:00Z","x":1}\n', 'utf8');
    fs.writeFileSync(imported, '{"t":"2025-12-31T00:00:00Z","x":2}\n', 'utf8');

    assert.doesNotThrow(() => mergeJsonlByTimestamp(local, imported));
    assert.ok(fs.readFileSync(local, 'utf8').split('\n').filter(Boolean).length >= 2);
}));

report();
