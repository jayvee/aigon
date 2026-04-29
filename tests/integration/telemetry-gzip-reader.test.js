#!/usr/bin/env node
'use strict';

// REGRESSION F451: readTelemetryFile must transparently decompress .json.gz files
// produced by vault retention compression, so readers never miss compressed records.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { test, withTempDir, report } = require('../_helpers');
const { readTelemetryFile } = require('../../lib/telemetry');

test('readTelemetryFile: reads plain .json', () => withTempDir('telemetry-gzip-', (dir) => {
    const fp = path.join(dir, 'feature-99-cc-plain.json');
    const obj = { featureId: '99', costUsd: 1.23 };
    fs.writeFileSync(fp, JSON.stringify(obj) + '\n', 'utf8');
    const result = JSON.parse(readTelemetryFile(fp));
    assert.strictEqual(result.featureId, '99');
    assert.strictEqual(result.costUsd, 1.23);
}));

test('readTelemetryFile: reads gzipped .json.gz (round-trip)', () => withTempDir('telemetry-gzip-', (dir) => {
    const fp = path.join(dir, 'feature-99-cc-compressed.json.gz');
    const obj = { featureId: '99', costUsd: 4.56, tokenUsage: { input: 1000, output: 500 } };
    fs.writeFileSync(fp, zlib.gzipSync(JSON.stringify(obj) + '\n'));
    const result = JSON.parse(readTelemetryFile(fp));
    assert.strictEqual(result.featureId, '99');
    assert.strictEqual(result.costUsd, 4.56);
    assert.strictEqual(result.tokenUsage.input, 1000);
}));

report();
