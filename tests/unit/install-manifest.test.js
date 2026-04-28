#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');

const m = require('../../lib/install-manifest');

test('readManifest returns null when no manifest exists', () => {
    withTempDir('aigon-manifest-read-', (dir) => {
        const result = m.readManifest(dir);
        assert.strictEqual(result, null);
    });
});

test('readManifest throws on corrupt JSON', () => {
    withTempDir('aigon-manifest-corrupt-', (dir) => {
        fs.mkdirSync(path.join(dir, '.aigon'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.aigon', 'install-manifest.json'), 'not json');
        assert.throws(() => m.readManifest(dir), /invalid JSON/);
    });
});

test('writeManifest + readManifest round-trip', () => {
    withTempDir('aigon-manifest-roundtrip-', (dir) => {
        const manifest = m.createEmptyManifest('1.2.3');
        m.writeManifest(dir, manifest);
        const read = m.readManifest(dir);
        assert.strictEqual(read.version, m.MANIFEST_VERSION);
        assert.strictEqual(read.aigonVersion, '1.2.3');
        assert.deepStrictEqual(read.files, []);
    });
});

test('writeManifest uses atomic tmp rename', () => {
    withTempDir('aigon-manifest-atomic-', (dir) => {
        const manifest = m.createEmptyManifest('2.0.0');
        m.writeManifest(dir, manifest);
        // No .tmp file should remain
        assert.ok(!fs.existsSync(path.join(dir, '.aigon', 'install-manifest.json.tmp')));
    });
});

test('recordFile adds a new entry', () => {
    withTempDir('aigon-manifest-record-', (dir) => {
        const manifest = m.createEmptyManifest('1.0.0');
        const filePath = path.join(dir, 'testfile.txt');
        fs.writeFileSync(filePath, 'hello');
        m.recordFile(manifest, filePath, dir, '1.0.0');
        assert.strictEqual(manifest.files.length, 1);
        assert.strictEqual(manifest.files[0].path, 'testfile.txt');
        assert.ok(manifest.files[0].sha256.length === 64);
        assert.strictEqual(manifest.files[0].version, '1.0.0');
        assert.ok(manifest.files[0].installedAt);
    });
});

test('recordFile updates existing entry', () => {
    withTempDir('aigon-manifest-update-', (dir) => {
        const manifest = m.createEmptyManifest('1.0.0');
        const filePath = path.join(dir, 'testfile.txt');
        fs.writeFileSync(filePath, 'hello');
        m.recordFile(manifest, filePath, dir, '1.0.0');
        const sha1 = manifest.files[0].sha256;

        fs.writeFileSync(filePath, 'world');
        m.recordFile(manifest, filePath, dir, '1.1.0');
        assert.strictEqual(manifest.files.length, 1, 'no duplicate entries');
        assert.notStrictEqual(manifest.files[0].sha256, sha1, 'sha256 updated');
        assert.strictEqual(manifest.files[0].version, '1.1.0');
    });
});

test('recordFile silently skips missing file', () => {
    withTempDir('aigon-manifest-skip-', (dir) => {
        const manifest = m.createEmptyManifest('1.0.0');
        m.recordFile(manifest, path.join(dir, 'nonexistent.txt'), dir, '1.0.0');
        assert.strictEqual(manifest.files.length, 0);
    });
});

test('recordFile normalizes relative path with forward slashes', () => {
    withTempDir('aigon-manifest-relpath-', (dir) => {
        const manifest = m.createEmptyManifest('1.0.0');
        fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
        const filePath = path.join(dir, 'sub', 'file.txt');
        fs.writeFileSync(filePath, 'data');
        m.recordFile(manifest, filePath, dir, '1.0.0');
        assert.strictEqual(manifest.files[0].path, 'sub/file.txt');
    });
});

test('removeFile removes entry by relPath', () => {
    withTempDir('aigon-manifest-remove-', (dir) => {
        const manifest = m.createEmptyManifest('1.0.0');
        const filePath = path.join(dir, 'testfile.txt');
        fs.writeFileSync(filePath, 'hello');
        m.recordFile(manifest, filePath, dir, '1.0.0');
        assert.strictEqual(manifest.files.length, 1);
        m.removeFile(manifest, 'testfile.txt');
        assert.strictEqual(manifest.files.length, 0);
    });
});

test('removeFile is a no-op for unknown paths', () => {
    withTempDir('aigon-manifest-remove-noop-', (dir) => {
        const manifest = m.createEmptyManifest('1.0.0');
        m.removeFile(manifest, 'nonexistent.txt');
        assert.strictEqual(manifest.files.length, 0);
    });
});

test('getModifiedFiles returns paths whose sha256 changed', () => {
    withTempDir('aigon-manifest-modified-', (dir) => {
        const manifest = m.createEmptyManifest('1.0.0');
        const filePath = path.join(dir, 'testfile.txt');
        fs.writeFileSync(filePath, 'original');
        m.recordFile(manifest, filePath, dir, '1.0.0');

        // Modify on disk
        fs.writeFileSync(filePath, 'changed content');
        const modified = m.getModifiedFiles(manifest, dir);
        assert.strictEqual(modified.length, 1);
        assert.strictEqual(modified[0].path, 'testfile.txt');
    });
});

test('getModifiedFiles returns empty when file is unchanged', () => {
    withTempDir('aigon-manifest-unchanged-', (dir) => {
        const manifest = m.createEmptyManifest('1.0.0');
        const filePath = path.join(dir, 'testfile.txt');
        fs.writeFileSync(filePath, 'original');
        m.recordFile(manifest, filePath, dir, '1.0.0');
        const modified = m.getModifiedFiles(manifest, dir);
        assert.strictEqual(modified.length, 0);
    });
});

test('getModifiedFiles skips missing files (not "modified")', () => {
    withTempDir('aigon-manifest-missing-', (dir) => {
        const manifest = m.createEmptyManifest('1.0.0');
        const filePath = path.join(dir, 'testfile.txt');
        fs.writeFileSync(filePath, 'original');
        m.recordFile(manifest, filePath, dir, '1.0.0');
        fs.unlinkSync(filePath);
        const modified = m.getModifiedFiles(manifest, dir);
        assert.strictEqual(modified.length, 0, 'missing files are not modified');
    });
});

test('getMissingFiles returns entries not on disk', () => {
    withTempDir('aigon-manifest-getmissing-', (dir) => {
        const manifest = m.createEmptyManifest('1.0.0');
        const filePath = path.join(dir, 'testfile.txt');
        fs.writeFileSync(filePath, 'data');
        m.recordFile(manifest, filePath, dir, '1.0.0');
        fs.unlinkSync(filePath);
        const missing = m.getMissingFiles(manifest, dir);
        assert.strictEqual(missing.length, 1);
        assert.strictEqual(missing[0].path, 'testfile.txt');
    });
});

test('createEmptyManifest sets correct schema', () => {
    const manifest = m.createEmptyManifest('3.0.0');
    assert.strictEqual(manifest.version, m.MANIFEST_VERSION);
    assert.strictEqual(manifest.aigonVersion, '3.0.0');
    assert.deepStrictEqual(manifest.files, []);
});

report();
