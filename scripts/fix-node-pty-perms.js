'use strict';
// node-pty ships its darwin spawn-helper without the execute bit on some npm
// registry tarballs. Without it, posix_spawnp fails silently at runtime.
const fs = require('fs');
const path = require('path');

if (process.platform === 'win32') process.exit(0);

let pkgDir;
try {
    pkgDir = path.dirname(require.resolve('node-pty/package.json'));
} catch (_) {
    process.exit(0); // node-pty not installed — nothing to do
}

const helper = path.join(pkgDir, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper');
try {
    fs.chmodSync(helper, 0o755);
} catch (_) {
    // Missing file or no permission — non-fatal
}
