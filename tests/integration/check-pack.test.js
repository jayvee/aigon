'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');

// REGRESSION: F699 added scripts/docs-check.js to the npm package but omitted it from
// check-pack's independent allowlist, causing every prepublishOnly run to fail.
const result = spawnSync(process.execPath, ['scripts/check-pack.js'], {
    cwd: ROOT,
    encoding: 'utf8',
});

assert.strictEqual(result.status, 0, result.stderr || result.stdout);
assert.match(result.stdout, /check-pack: OK/);
console.log('✓ packaged documentation checker passes the independent package allowlist');
