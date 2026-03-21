#!/usr/bin/env node
'use strict';

/**
 * Unit tests for lib/manifest.js
 * Run: node lib/manifest.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(description, fn) {
    try {
        fn();
        console.log(`  ✓ ${description}`);
        passed++;
    } catch (err) {
        console.error(`  ✗ ${description}`);
        console.error(`    ${err.message}`);
        failed++;
    }
}

async function testAsync(description, fn) {
    try {
        await fn();
        console.log(`  ✓ ${description}`);
        passed++;
    } catch (err) {
        console.error(`  ✗ ${description}`);
        console.error(`    ${err.message}`);
        failed++;
    }
}

// ---------------------------------------------------------------------------
// Set up a temp directory so tests don't pollute the real .aigon/
// ---------------------------------------------------------------------------

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-manifest-test-'));
const realCwd = process.cwd();

// Monkey-patch ROOT_DIR paths inside manifest.js by temporarily redirecting cwd
// We instead override the module's internal paths via re-require after patching env.
// Simpler: just use the real module and validate exports + basic behaviour.

const manifest = require('./manifest');

// ---------------------------------------------------------------------------
// Export surface
// ---------------------------------------------------------------------------

console.log('# manifest.js — exports');

test('exports readManifest function', () => {
    assert.strictEqual(typeof manifest.readManifest, 'function');
});

test('exports writeManifest function', () => {
    assert.strictEqual(typeof manifest.writeManifest, 'function');
});

test('exports readAgentStatus function', () => {
    assert.strictEqual(typeof manifest.readAgentStatus, 'function');
});

test('exports writeAgentStatus function', () => {
    assert.strictEqual(typeof manifest.writeAgentStatus, 'function');
});

test('exports acquireLock function', () => {
    assert.strictEqual(typeof manifest.acquireLock, 'function');
});

test('exports releaseLock function', () => {
    assert.strictEqual(typeof manifest.releaseLock, 'function');
});

test('getStateDir returns cwd-relative path', () => {
    assert.ok(manifest.getStateDir().includes('.aigon'));
    assert.ok(manifest.getStateDir().includes('state'));
});

test('getLocksDir returns cwd-relative path', () => {
    assert.ok(manifest.getLocksDir().includes('.aigon'));
    assert.ok(manifest.getLocksDir().includes('locks'));
});

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

console.log('# manifest.js — path helpers');

test('coordinatorPath produces feature-{id}.json', () => {
    const p = manifest.coordinatorPath('42');
    assert.ok(p.endsWith('feature-42.json'), `got: ${p}`);
    assert.ok(p.includes('state'), `expected "state" in path: ${p}`);
});

test('agentStatusPath produces feature-{id}-{agent}.json', () => {
    const p = manifest.agentStatusPath('42', 'cc');
    assert.ok(p.endsWith('feature-42-cc.json'), `got: ${p}`);
});

test('lockPath produces feature-{id}.lock', () => {
    const p = manifest.lockPath('42');
    assert.ok(p.endsWith('feature-42.lock'), `got: ${p}`);
    assert.ok(p.includes('locks'), `expected "locks" in path: ${p}`);
});

// ---------------------------------------------------------------------------
// Manifest read/write (using real .aigon/state with a test ID unlikely to clash)
// ---------------------------------------------------------------------------

const TEST_ID = 'test-99999';

function cleanTestFiles() {
    try { fs.unlinkSync(manifest.coordinatorPath(TEST_ID)); } catch (e) { /* ok */ }
    try { fs.unlinkSync(manifest.agentStatusPath(TEST_ID, 'cc')); } catch (e) { /* ok */ }
    try { fs.unlinkSync(manifest.lockPath(TEST_ID)); } catch (e) { /* ok */ }
}

cleanTestFiles(); // ensure clean start

console.log('# manifest.js — coordinator manifest');

test('readManifest returns a transient derived manifest with correct schema (no file)', () => {
    const m = manifest.readManifest(TEST_ID);
    assert.strictEqual(typeof m.id, 'string');
    assert.strictEqual(m.type, 'feature');
    assert.ok('name' in m);
    assert.ok('stage' in m);
    assert.ok('specPath' in m);
    assert.ok(Array.isArray(m.agents));
    assert.ok('winner' in m);
    assert.ok(Array.isArray(m.pending));
    assert.ok(Array.isArray(m.events));
});

test('readManifest does NOT persist to disk (pure read)', () => {
    // readManifest must be side-effect-free — no file creation
    assert.ok(!fs.existsSync(manifest.coordinatorPath(TEST_ID)),
        'readManifest should not create a file on disk');
});

test('readManifest returns consistent derived data on repeated calls', () => {
    const first = manifest.readManifest(TEST_ID);
    const second = manifest.readManifest(TEST_ID);
    assert.strictEqual(second.events.length, first.events.length);
});

test('ensureManifest creates and persists manifest file', () => {
    const m = manifest.ensureManifest(TEST_ID);
    assert.ok(fs.existsSync(manifest.coordinatorPath(TEST_ID)),
        'ensureManifest should persist the file');
    assert.strictEqual(typeof m.id, 'string');
    assert.strictEqual(m.type, 'feature');
});

test('readManifest returns persisted data after ensureManifest', () => {
    // Now that ensureManifest has persisted, readManifest should return stored data
    const m = manifest.readManifest(TEST_ID);
    assert.ok(fs.existsSync(manifest.coordinatorPath(TEST_ID)));
    assert.strictEqual(m.type, 'feature');
});

test('writeManifest updates fields and persists', () => {
    // ensureManifest was called above, so file exists
    manifest.writeManifest(TEST_ID, { stage: 'in-progress', winner: 'cc' });
    const m = manifest.readManifest(TEST_ID);
    assert.strictEqual(m.stage, 'in-progress');
    assert.strictEqual(m.winner, 'cc');
});

test('writeManifest appends event when provided', () => {
    const before = manifest.readManifest(TEST_ID);
    const eventsBefore = before.events.length;
    manifest.writeManifest(TEST_ID, {}, { type: 'test-event', actor: 'test' });
    const after = manifest.readManifest(TEST_ID);
    assert.strictEqual(after.events.length, eventsBefore + 1);
    const last = after.events[after.events.length - 1];
    assert.strictEqual(last.type, 'test-event');
    assert.strictEqual(last.actor, 'test');
    assert.ok(typeof last.at === 'string');
});

// ---------------------------------------------------------------------------
// Agent status
// ---------------------------------------------------------------------------

console.log('# manifest.js — agent status');

test('readAgentStatus returns null when file absent', () => {
    cleanTestFiles();
    const s = manifest.readAgentStatus(TEST_ID, 'cc');
    assert.strictEqual(s, null);
});

test('writeAgentStatus creates file with correct schema', () => {
    const record = manifest.writeAgentStatus(TEST_ID, 'cc', {
        status: 'implementing',
        worktreePath: '/tmp/wt',
    });
    assert.strictEqual(record.agent, 'cc');
    assert.strictEqual(record.status, 'implementing');
    assert.strictEqual(record.worktreePath, '/tmp/wt');
    assert.ok(typeof record.updatedAt === 'string');
});

test('readAgentStatus returns written record', () => {
    const s = manifest.readAgentStatus(TEST_ID, 'cc');
    assert.strictEqual(s.status, 'implementing');
    assert.strictEqual(s.agent, 'cc');
});

test('writeAgentStatus always stamps updatedAt', () => {
    const r1 = manifest.writeAgentStatus(TEST_ID, 'cc', { status: 'waiting' });
    assert.ok(typeof r1.updatedAt === 'string');
    const r2 = manifest.writeAgentStatus(TEST_ID, 'cc', { status: 'submitted' });
    assert.ok(r2.updatedAt >= r1.updatedAt);
});

// ---------------------------------------------------------------------------
// File locking
// ---------------------------------------------------------------------------

console.log('# manifest.js — locking');

const LOCK_TEST_ID = 'test-lock-99999';

function cleanLock() {
    try { fs.unlinkSync(manifest.lockPath(LOCK_TEST_ID)); } catch (e) { /* ok */ }
}

cleanLock();

test('acquireLock returns true when no lock exists', () => {
    const result = manifest.acquireLock(LOCK_TEST_ID);
    assert.strictEqual(result, true);
});

test('acquireLock returns false when lock already held by live process', () => {
    // Lock is already held from previous test (same process)
    const result = manifest.acquireLock(LOCK_TEST_ID);
    assert.strictEqual(result, false);
});

test('lock file contains current PID', () => {
    const content = fs.readFileSync(manifest.lockPath(LOCK_TEST_ID), 'utf8').trim();
    assert.strictEqual(parseInt(content, 10), process.pid);
});

test('releaseLock removes lock file', () => {
    manifest.releaseLock(LOCK_TEST_ID);
    assert.ok(!fs.existsSync(manifest.lockPath(LOCK_TEST_ID)));
});

test('acquireLock succeeds again after release', () => {
    const result = manifest.acquireLock(LOCK_TEST_ID);
    assert.strictEqual(result, true);
    manifest.releaseLock(LOCK_TEST_ID);
});

test('acquireLock removes stale lock with dead PID', () => {
    // Write a lock file with a dead PID (PID 1 or a very high number unlikely to exist)
    // We'll use a guaranteed non-existent PID
    const lp = manifest.lockPath(LOCK_TEST_ID);
    const locksDir = path.dirname(lp);
    if (!fs.existsSync(locksDir)) fs.mkdirSync(locksDir, { recursive: true });
    // PID 99999999 should not exist on any reasonable system
    fs.writeFileSync(lp, '99999999');
    const result = manifest.acquireLock(LOCK_TEST_ID);
    assert.strictEqual(result, true, 'should acquire lock over stale PID');
    manifest.releaseLock(LOCK_TEST_ID);
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

cleanTestFiles();
cleanLock();
try { fs.unlinkSync(manifest.agentStatusPath(TEST_ID, 'cc')); } catch (e) { /* ok */ }

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
