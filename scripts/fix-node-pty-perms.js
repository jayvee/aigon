'use strict';
// node-pty 1.1.0's npm tarball ships prebuilds/<platform>-<arch>/spawn-helper
// without the execute bit. Without +x, posix_spawnp aborts and every PTY
// WebSocket closes — the dashboard renders "[Session ended]" for live tmux
// sessions. This script is wired into `postinstall` for fresh installs.
// Runtime self-heal also lives in lib/pty-session-handler.js
// (ensureSpawnHelperExecutable) so npm rebuild / --ignore-scripts / partial
// installs cannot leave the helper non-executable.
const fs = require('fs');
const path = require('path');

if (process.platform === 'win32') process.exit(0);

let pkgDir;
try {
    pkgDir = path.dirname(require.resolve('node-pty/package.json'));
} catch (_) {
    process.exit(0);
}

const helper = path.join(pkgDir, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper');
let st;
try {
    st = fs.statSync(helper);
} catch (e) {
    if (e.code === 'ENOENT') process.exit(0);
    console.warn(`[fix-node-pty-perms] cannot stat ${helper}: ${e.message}`);
    process.exit(0);
}
if ((st.mode & 0o111) === 0o111) process.exit(0);
try {
    fs.chmodSync(helper, 0o755);
} catch (e) {
    console.warn(`[fix-node-pty-perms] chmod failed on ${helper}: ${e.message}`);
}
