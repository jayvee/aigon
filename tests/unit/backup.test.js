'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const {
    PROJECT_EXCLUDES,
    DEFAULT_RETENTION,
    applyTelemetryRetention,
    getTelemetryRetentionConfig,
} = require('../../lib/backup');
const { mergeJsonlByTimestamp } = require('../../lib/sync-merge');

// ── Helpers ──────────────────────────────────────────────────────────────────

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'backup-test-'));
}

function rmrf(p) {
    fs.rmSync(p, { recursive: true, force: true });
}

function daysAgoMs(days) {
    return Date.now() - days * 24 * 60 * 60 * 1000;
}

function setMtime(fp, ms) {
    const d = new Date(ms);
    fs.utimesSync(fp, d, d);
}

function writeJsonFile(fp, obj, mtimeMs) {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(obj) + '\n', 'utf8');
    if (mtimeMs !== undefined) setMtime(fp, mtimeMs);
}

// ── Test 1: PROJECT_EXCLUDES — telemetry is included (not in the set) ────────

{
    const test = 'PROJECT_EXCLUDES does not contain telemetry';
    assert.ok(!PROJECT_EXCLUDES.has('telemetry'), test);
    assert.ok(PROJECT_EXCLUDES.has('sessions'), 'sessions still excluded');
    assert.ok(PROJECT_EXCLUDES.has('locks'), 'locks still excluded');
    console.log(`✓ ${test}`);
}

// ── Test 2: DEFAULT_RETENTION values ─────────────────────────────────────────

{
    const test = 'DEFAULT_RETENTION has correct thresholds';
    assert.strictEqual(DEFAULT_RETENTION.compressAfterDays, 90, test);
    assert.strictEqual(DEFAULT_RETENTION.dropAfterDays, 365, test);
    console.log(`✓ ${test}`);
}

// ── Test 3: retention compress — files older than compressAfterDays become .gz ─

{
    const test = 'retention compress: per-session json >90d becomes .json.gz';
    const repo = tmpDir();
    const telDir = path.join(repo, '.aigon', 'telemetry');
    fs.mkdirSync(telDir, { recursive: true });

    // Old file (91 days)
    const oldFile = path.join(telDir, 'feature-100-cc-abc.json');
    writeJsonFile(oldFile, { featureId: '100', endAt: new Date(daysAgoMs(91)).toISOString() });

    // Recent file (10 days)
    const newFile = path.join(telDir, 'feature-100-cc-def.json');
    writeJsonFile(newFile, { featureId: '100', endAt: new Date(daysAgoMs(10)).toISOString() });

    applyTelemetryRetention(repo);

    assert.ok(!fs.existsSync(oldFile), `${test}: original .json removed`);
    assert.ok(fs.existsSync(oldFile + '.gz'), `${test}: .json.gz created`);
    // Verify it's valid gzip
    const decompressed = zlib.gunzipSync(fs.readFileSync(oldFile + '.gz')).toString('utf8');
    const rec = JSON.parse(decompressed);
    assert.strictEqual(rec.featureId, '100', `${test}: content preserved`);
    // Recent file untouched
    assert.ok(fs.existsSync(newFile), `${test}: recent file not touched`);
    assert.ok(!fs.existsSync(newFile + '.gz'), `${test}: recent file not gzipped`);

    rmrf(repo);
    console.log(`✓ ${test}`);
}

// ── Test 4: retention drop — files older than dropAfterDays are deleted ───────

{
    const test = 'retention drop: per-session json >365d is deleted';
    const repo = tmpDir();
    const telDir = path.join(repo, '.aigon', 'telemetry');
    fs.mkdirSync(telDir, { recursive: true });

    const oldFile = path.join(telDir, 'feature-200-cc-xyz.json');
    writeJsonFile(oldFile, { featureId: '200', endAt: new Date(daysAgoMs(400)).toISOString() });

    applyTelemetryRetention(repo);

    assert.ok(!fs.existsSync(oldFile), `${test}: original .json deleted`);
    assert.ok(!fs.existsSync(oldFile + '.gz'), `${test}: .gz not created for dropped file`);

    rmrf(repo);
    console.log(`✓ ${test}`);
}

// ── Test 5: retention disabled when compressAfterDays=0 ──────────────────────

{
    const test = 'retention disabled when compressAfterDays=0';
    const repo = tmpDir();
    const telDir = path.join(repo, '.aigon', 'telemetry');
    fs.mkdirSync(telDir, { recursive: true });

    const oldFile = path.join(telDir, 'feature-300-cc-aaa.json');
    writeJsonFile(oldFile, { featureId: '300', endAt: new Date(daysAgoMs(200)).toISOString() });

    // Temporarily override retention config
    applyTelemetryRetention(repo, { compressAfterDays: 0, dropAfterDays: 0 });

    assert.ok(fs.existsSync(oldFile), `${test}: file untouched`);
    assert.ok(!fs.existsSync(oldFile + '.gz'), `${test}: no gzip created`);

    rmrf(repo);
    console.log(`✓ ${test}`);
}

// ── Test 6: retention disabled when dropAfterDays=null ───────────────────────

{
    const test = 'retention disabled when dropAfterDays=null';
    const repo = tmpDir();
    const telDir = path.join(repo, '.aigon', 'telemetry');
    fs.mkdirSync(telDir, { recursive: true });

    const oldFile = path.join(telDir, 'feature-400-cc-bbb.json');
    writeJsonFile(oldFile, { featureId: '400', endAt: new Date(daysAgoMs(400)).toISOString() });

    applyTelemetryRetention(repo, { compressAfterDays: null, dropAfterDays: null });

    assert.ok(fs.existsSync(oldFile), `${test}: file untouched`);

    rmrf(repo);
    console.log(`✓ ${test}`);
}

// ── Test 7: signal-health jsonl retention by filename date ────────────────────

{
    const test = 'retention: signal-health jsonl >90d becomes .jsonl.gz';
    const repo = tmpDir();
    const shDir = path.join(repo, '.aigon', 'telemetry', 'signal-health');
    fs.mkdirSync(shDir, { recursive: true });

    // A date 100 days ago
    const oldDate = new Date(daysAgoMs(100));
    const dateStr = oldDate.toISOString().slice(0, 10);
    const oldFile = path.join(shDir, `${dateStr}.jsonl`);
    fs.writeFileSync(oldFile, '{"t":"2025-01-01T00:00:00Z","type":"nudge"}\n', 'utf8');

    // A recent date file
    const recentDate = new Date(daysAgoMs(5));
    const recentStr = recentDate.toISOString().slice(0, 10);
    const recentFile = path.join(shDir, `${recentStr}.jsonl`);
    fs.writeFileSync(recentFile, '{"t":"2026-04-24T00:00:00Z","type":"nudge"}\n', 'utf8');

    applyTelemetryRetention(repo);

    assert.ok(!fs.existsSync(oldFile), `${test}: old .jsonl removed`);
    assert.ok(fs.existsSync(oldFile + '.gz'), `${test}: .jsonl.gz created`);
    assert.ok(fs.existsSync(recentFile), `${test}: recent .jsonl untouched`);

    rmrf(repo);
    console.log(`✓ ${test}`);
}

// ── Test 8: jsonl merge — concat + sort by t + dedup ─────────────────────────

{
    const test = 'mergeJsonlByTimestamp: union + sort by t + dedup';
    const dir = tmpDir();
    const local = path.join(dir, 'local.jsonl');
    const imported = path.join(dir, 'imported.jsonl');

    const e1 = JSON.stringify({ t: '2026-04-29T10:00:00Z', type: 'a' });
    const e2 = JSON.stringify({ t: '2026-04-29T09:00:00Z', type: 'b' });
    const e3 = JSON.stringify({ t: '2026-04-29T11:00:00Z', type: 'c' });
    const dup = e1; // duplicate of e1

    fs.writeFileSync(local, `${e1}\n${e2}\n`, 'utf8');
    fs.writeFileSync(imported, `${dup}\n${e3}\n`, 'utf8');

    mergeJsonlByTimestamp(local, imported);

    const lines = fs.readFileSync(local, 'utf8').split('\n').filter(Boolean);
    assert.strictEqual(lines.length, 3, `${test}: 3 unique events`);
    // Sorted by t
    const parsed = lines.map(l => JSON.parse(l));
    assert.strictEqual(parsed[0].type, 'b', `${test}: sorted first = b (09:00)`);
    assert.strictEqual(parsed[1].type, 'a', `${test}: sorted second = a (10:00)`);
    assert.strictEqual(parsed[2].type, 'c', `${test}: sorted third = c (11:00)`);

    rmrf(dir);
    console.log(`✓ ${test}`);
}

// ── Test 9: jsonl merge — handles non-parseable lines gracefully ──────────────

{
    const test = 'mergeJsonlByTimestamp: falls back gracefully for non-JSON lines';
    const dir = tmpDir();
    const local = path.join(dir, 'local.jsonl');
    const imported = path.join(dir, 'imported.jsonl');

    fs.writeFileSync(local, 'not-json\n{"t":"2026-01-01T00:00:00Z","x":1}\n', 'utf8');
    fs.writeFileSync(imported, '{"t":"2025-12-31T00:00:00Z","x":2}\n', 'utf8');

    assert.doesNotThrow(() => mergeJsonlByTimestamp(local, imported), `${test}: no throw`);
    const lines = fs.readFileSync(local, 'utf8').split('\n').filter(Boolean);
    assert.ok(lines.length >= 2, `${test}: at least 2 lines`);

    rmrf(dir);
    console.log(`✓ ${test}`);
}

console.log('\n✅ All backup tests passed');
