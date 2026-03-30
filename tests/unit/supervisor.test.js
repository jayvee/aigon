#!/usr/bin/env node
'use strict';

/**
 * Tests for supervisor module (feature 172).
 *
 * Covers: snapshot scanning, session name construction, supervisor lifecycle,
 * idempotency, and module isolation.
 *
 * Run: node lib/supervisor.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const asyncTests = [];

function test(description, fn) {
  try {
    fn();
    console.log(`  \u2713 ${description}`);
    passed++;
  } catch (err) {
    console.error(`  \u2717 ${description}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

function testAsync(description, fn) {
  asyncTests.push(
    fn()
      .then(() => {
        console.log(`  \u2713 ${description}`);
        passed++;
      })
      .catch((err) => {
        console.error(`  \u2717 ${description}`);
        console.error(`    ${err.message}`);
        failed++;
      })
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'supervisor-test-'));
}

function writeSnapshot(repoPath, featureId, snapshot) {
  const dir = path.join(repoPath, '.aigon', 'workflows', 'features', featureId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'snapshot.json'), JSON.stringify(snapshot));
}

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

const {
  readAllFeatureSnapshots,
  expectedSessionName,
  startSupervisorLoop,
  stopSupervisorLoop,
  getSupervisorStatus,
  SWEEP_INTERVAL_MS,
} = require('../../lib/supervisor');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('\n--- supervisor module tests ---\n');

// -- readAllFeatureSnapshots --

test('readAllFeatureSnapshots returns empty for missing directory', () => {
  const tmp = mkTmp();
  const result = readAllFeatureSnapshots(tmp);
  assert.deepStrictEqual(result, []);
});

test('readAllFeatureSnapshots reads snapshot files', () => {
  const tmp = mkTmp();
  const snap1 = { lifecycle: 'implementing', agents: { cc: { status: 'running' } } };
  const snap2 = { lifecycle: 'done', agents: { gg: { status: 'ready' } } };
  writeSnapshot(tmp, '01', snap1);
  writeSnapshot(tmp, '02', snap2);

  const results = readAllFeatureSnapshots(tmp);
  assert.strictEqual(results.length, 2);
  const ids = results.map(r => r.featureId).sort();
  assert.deepStrictEqual(ids, ['01', '02']);
  const s1 = results.find(r => r.featureId === '01');
  assert.strictEqual(s1.snapshot.lifecycle, 'implementing');
});

test('readAllFeatureSnapshots skips entries without snapshot.json', () => {
  const tmp = mkTmp();
  // Create a feature dir without snapshot
  const dir = path.join(tmp, '.aigon', 'workflows', 'features', '03');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), '');

  // Create one with snapshot
  writeSnapshot(tmp, '04', { lifecycle: 'implementing', agents: {} });

  const results = readAllFeatureSnapshots(tmp);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].featureId, '04');
});

test('readAllFeatureSnapshots skips corrupted snapshots', () => {
  const tmp = mkTmp();
  const dir = path.join(tmp, '.aigon', 'workflows', 'features', '05');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'snapshot.json'), 'NOT JSON{{{');

  writeSnapshot(tmp, '06', { lifecycle: 'implementing', agents: {} });

  const results = readAllFeatureSnapshots(tmp);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].featureId, '06');
});

// -- expectedSessionName --

test('expectedSessionName builds correct format', () => {
  assert.strictEqual(expectedSessionName('/Users/dev/myrepo', '01', 'cc'), 'myrepo-f1-cc');
  assert.strictEqual(expectedSessionName('/Users/dev/myrepo', '12', 'gg'), 'myrepo-f12-gg');
});

test('expectedSessionName unpads feature IDs', () => {
  assert.strictEqual(expectedSessionName('/tmp/aigon', '003', 'cc'), 'aigon-f3-cc');
});

// -- Supervisor lifecycle --

test('getSupervisorStatus reports not running initially', () => {
  stopSupervisorLoop(); // ensure clean state
  const status = getSupervisorStatus();
  assert.strictEqual(status.running, false);
});

test('startSupervisorLoop starts and stopSupervisorLoop stops', () => {
  const handle = startSupervisorLoop();
  assert.strictEqual(typeof handle.stop, 'function');
  assert.strictEqual(getSupervisorStatus().running, true);

  handle.stop();
  assert.strictEqual(getSupervisorStatus().running, false);
});

test('startSupervisorLoop is idempotent — second call returns same handle', () => {
  stopSupervisorLoop();
  const h1 = startSupervisorLoop();
  const h2 = startSupervisorLoop();
  assert.strictEqual(getSupervisorStatus().running, true);
  // Both should stop the same loop
  h1.stop();
  assert.strictEqual(getSupervisorStatus().running, false);
});

test('SWEEP_INTERVAL_MS is 30 seconds', () => {
  assert.strictEqual(SWEEP_INTERVAL_MS, 30000);
});

// -- Module isolation --

test('supervisor.js does not import dashboard-server.js', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../lib/supervisor.js'), 'utf8');
  assert.strictEqual(src.includes("require('./dashboard-server')"), false);
  assert.strictEqual(src.includes("require('./dashboard')"), false);
  assert.strictEqual(src.includes('require("./dashboard-server")'), false);
});

test('dashboard-server.js does not import supervisor.js', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../lib/dashboard-server.js'), 'utf8');
  assert.strictEqual(src.includes("require('./supervisor')"), false);
  assert.strictEqual(src.includes('require("./supervisor")'), false);
});

test('supervisor.js never kills tmux sessions', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../lib/supervisor.js'), 'utf8');
  assert.strictEqual(src.includes('kill-session'), false);
  assert.strictEqual(src.includes('kill-server'), false);
});

test('supervisor.js never writes agent status files', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../lib/supervisor.js'), 'utf8');
  assert.strictEqual(src.includes('writeAgentStatus'), false);
});

test('supervisor.js never moves spec files', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../lib/supervisor.js'), 'utf8');
  assert.strictEqual(src.includes('renameSync'), false);
  assert.strictEqual(src.includes('moveSpec'), false);
});

// ---------------------------------------------------------------------------
// Run async tests and report
// ---------------------------------------------------------------------------

Promise.all(asyncTests).then(() => {
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
});
