#!/usr/bin/env node
// F590: dashboard perf — lean done features, bounded poll payload, lazy
// all-features list, and gzip transport.
//
// REGRESSION F459: done specs are immutable on disk and must ship a LEAN shape
// (no snapshot/events enrichment). REGRESSION F469: heavy per-entity detail
// (agents, detailFingerprint, cardHeadline, stateRenderMeta, validActions) lives
// behind /api/feature/:id/details and must never appear on a done row in the
// poll payload. REGRESSION F67: the All Items view still gets the full uncapped
// list — now via the lazy /api/repos/all-features endpoint, not /api/status.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const {
    test, withTempDir, report, seedEntityDirs, writeSpec, writeSnap,
} = require('../_helpers');
const engine = require('../../lib/workflow-core/engine');

const {
    collectRepoStatus,
    collectAllFeaturesLean,
    clearTierCache,
    refreshRepoInDashboardStatus,
} = require('../../lib/dashboard-status-collector');
const { sendJsonSerialized, GZIP_THRESHOLD_BYTES } = require('../../lib/dashboard-routes/util');

// Keys a lean done row is allowed to carry. Anything else is a regression.
const LEAN_DONE_KEYS = new Set([
    'id', 'displayKey', 'name', 'stage', 'specPath', 'updatedAt', 'createdAt', 'set', 'logPaths',
]);
// Heavy keys that must NOT appear on a done row in the poll payload.
const FORBIDDEN_DONE_KEYS = [
    'detailFingerprint', 'startupReadiness', 'autonomousController', 'cardHeadline',
    'stateRenderMeta', 'agents', 'validActions', 'nextActions',
];

function newResponse() {
    return { summary: { implementing: 0, waiting: 0, complete: 0, error: 0, total: 0 } };
}

function seedEngineDone(repo, id, name) {
    writeSpec(repo, 'features', '05-done', `feature-${id}-${name}.md`);
    writeSnap(repo, 'features', id, 'done');
}

// ---------------------------------------------------------------------------
// Lean done shape + bounded poll payload (engine-backed done features)
// ---------------------------------------------------------------------------
test('F590: engine-backed done features ship lean shape, bounded to 15, doneTotal accurate', () => withTempDir('aigon-f590-engine-done-', (repo) => {
    seedEntityDirs(repo, 'features');
    // 20 engine-backed done features → only the 15 most recent (by numeric id)
    // ship in `features`; doneTotal must still report all 20.
    for (let i = 1; i <= 20; i++) seedEngineDone(repo, String(i), `done-${i}`);
    clearTierCache(repo);

    const repoStatus = collectRepoStatus(repo, newResponse());
    const doneRows = (repoStatus.features || []).filter(f => f.stage === 'done');

    assert.strictEqual(doneRows.length, 15, 'poll payload must bound done features to 15');
    assert.strictEqual(repoStatus.doneTotal, 20, 'doneTotal must report ALL done features');

    // Recent window = numeric ids 6..20 (descending) — same ordering as collectDoneSpecs.
    const ids = doneRows.map(r => Number(r.id)).sort((a, b) => a - b);
    assert.strictEqual(ids[0], 6, 'lowest id in the recent-15 window must be 6');
    assert.strictEqual(ids[ids.length - 1], 20, 'highest id in the recent-15 window must be 20');

    // REGRESSION F459/F469: lean shape only — no heavy enrichment keys.
    doneRows.forEach(row => {
        FORBIDDEN_DONE_KEYS.forEach(k => assert.ok(!(k in row), `done row carries forbidden heavy key: ${k}`));
        Object.keys(row).forEach(k => assert.ok(LEAN_DONE_KEYS.has(k), `done row carries unexpected key: ${k}`));
        assert.ok(row.specPath && row.displayKey, 'lean done row must still carry specPath + displayKey');
    });

    // allFeatures must NOT be shipped on the default poll payload.
    assert.ok(!('allFeatures' in repoStatus), 'allFeatures must be off the /api/status poll payload');
}));

// ---------------------------------------------------------------------------
// Lean done shape — folder-only done features (no engine dir, F459 legacy path)
// ---------------------------------------------------------------------------
test('F590: folder-only done features also ship lean shape', () => withTempDir('aigon-f590-folder-done-', (repo) => {
    seedEntityDirs(repo, 'features');
    for (let i = 1; i <= 5; i++) writeSpec(repo, 'features', '05-done', `feature-${i}-legacy-${i}.md`);
    clearTierCache(repo);

    const repoStatus = collectRepoStatus(repo, newResponse());
    const doneRows = (repoStatus.features || []).filter(f => f.stage === 'done');

    assert.strictEqual(doneRows.length, 5, 'all 5 folder-only done features fit inside the window');
    doneRows.forEach(row => {
        FORBIDDEN_DONE_KEYS.forEach(k => assert.ok(!(k in row), `folder-only done row carries forbidden key: ${k}`));
        Object.keys(row).forEach(k => assert.ok(LEAN_DONE_KEYS.has(k), `folder-only done row carries unexpected key: ${k}`));
    });
}));

// ---------------------------------------------------------------------------
// Lazy all-features endpoint backing function (F67 uncapped list contract)
// ---------------------------------------------------------------------------
test('F590: collectAllFeaturesLean returns the FULL uncapped lean done list', () => withTempDir('aigon-f590-all-features-', (repo) => {
    seedEntityDirs(repo, 'features');
    for (let i = 1; i <= 20; i++) seedEngineDone(repo, String(i), `done-${i}`);
    clearTierCache(repo);

    const all = collectAllFeaturesLean(repo);
    const doneRows = all.filter(f => f.stage === 'done');
    assert.strictEqual(doneRows.length, 20, 'all-features endpoint must return every done feature (uncapped)');

    doneRows.forEach(row => {
        FORBIDDEN_DONE_KEYS.forEach(k => assert.ok(!(k in row), `all-features done row carries forbidden key: ${k}`));
        assert.ok('logPaths' in row, 'all-features rows must carry logPaths for the All Items view');
    });
}));

// ---------------------------------------------------------------------------
// gzip transport on large JSON (sendJsonSerialized)
// ---------------------------------------------------------------------------
function fakeRes() {
    return {
        _head: null,
        _body: null,
        writeHead(status, headers) { this._status = status; this._head = headers; },
        end(body) { this._body = body; },
    };
}

test('F590: sendJsonSerialized gzips large bodies when Accept-Encoding allows it', () => {
    const big = JSON.stringify({ blob: 'x'.repeat(GZIP_THRESHOLD_BYTES + 1000) });
    const res = fakeRes();
    const req = { headers: { 'accept-encoding': 'gzip, deflate, br' } };
    const bytes = sendJsonSerialized(res, 200, big, null, req);

    assert.strictEqual(res._head['content-encoding'], 'gzip', 'large body must be gzip-encoded');
    assert.strictEqual(res._head['vary'], 'Accept-Encoding', 'must advertise Vary: Accept-Encoding');
    assert.strictEqual(bytes, Buffer.byteLength(big), 'returns the UNCOMPRESSED byte count');
    assert.ok(Buffer.isBuffer(res._body), 'compressed body is a Buffer');
    assert.ok(res._body.length < Buffer.byteLength(big), 'compressed body is smaller than the source');
    assert.strictEqual(zlib.gunzipSync(res._body).toString('utf8'), big, 'gunzip round-trips to the original JSON');
});

test('F590: sendJsonSerialized skips gzip below threshold or without Accept-Encoding', () => {
    const small = JSON.stringify({ ok: true });
    // below threshold, gzip offered → no compression
    const r1 = fakeRes();
    sendJsonSerialized(r1, 200, small, null, { headers: { 'accept-encoding': 'gzip' } });
    assert.ok(!r1._head['content-encoding'], 'small body must not be compressed');
    assert.strictEqual(r1._body, small, 'small body sent verbatim');

    // above threshold but no Accept-Encoding → no compression
    const big = JSON.stringify({ blob: 'y'.repeat(GZIP_THRESHOLD_BYTES + 1000) });
    const r2 = fakeRes();
    sendJsonSerialized(r2, 200, big, null, { headers: {} });
    assert.ok(!r2._head['content-encoding'], 'no Accept-Encoding → no compression');
    assert.strictEqual(r2._body, big, 'uncompressed body sent verbatim');
});

// REGRESSION: post-delete UI refresh must rescan only the affected repo, not all
// conductor repos, and must invalidate the spec index so removed cards disappear.
test('refreshRepoInDashboardStatus drops a removed backlog feature', () => withTempDir('aigon-repo-refresh-', (repo) => {
    seedEntityDirs(repo, 'features');
    const specPath = path.join(repo, 'docs/specs/features/02-backlog/feature-05-fast-delete.md');
    fs.writeFileSync(specPath, '# Feature: fast delete\n');
    engine.ensureEntityBootstrappedSync(repo, 'feature', '05', 'backlog', specPath);
    clearTierCache(repo);

    const initialRepo = collectRepoStatus(repo, newResponse());
    assert.ok((initialRepo.features || []).some(f => String(f.id) === '5' || String(f.id) === '05'));
    const initial = {
        generatedAt: new Date().toISOString(),
        repos: [initialRepo],
        summary: { implementing: 0, waiting: 0, complete: 0, error: 0, total: 0 },
    };

    fs.unlinkSync(specPath);
    fs.rmSync(path.join(repo, '.aigon/workflows/features/05'), { recursive: true, force: true });
    const next = refreshRepoInDashboardStatus(initial, repo);
    const refreshed = (next.repos || []).find(r => path.resolve(r.path) === path.resolve(repo));
    assert.ok(refreshed, 'refreshed repo should remain in payload');
    assert.ok(!(refreshed.features || []).some(f => String(f.id) === '5' || String(f.id) === '05'),
        'deleted feature must disappear after scoped repo refresh');
}));

report();
