#!/usr/bin/env node
'use strict';

// Publishes @aigon/cli to npm with the correct dist-tag for the current version.
// Stable versions (2.x.y) → latest; prerelease versions (2.x.y-next.N) → next.
// Replaces bare `npm publish` to ensure the wrong channel can never be tagged.

const { execSync } = require('child_process');
const { channel, version } = require('../lib/release-channel');

// Invariant assertions — these guard against version/channel mismatches.
// The logic in release-channel.js makes them impossible in normal flow,
// but they catch manual version bumps that leave an inconsistent state.
if (channel === 'latest' && version.includes('-')) {
    process.stderr.write(`publish: ABORT — version "${version}" looks like a prerelease but channel resolved to "latest".\n`);
    process.stderr.write('  Bump to a stable version or use a prerelease suffix (e.g. 2.55.0-next.1).\n');
    process.exit(1);
}
if (channel === 'next' && !version.includes('-')) {
    process.stderr.write(`publish: ABORT — version "${version}" is stable but channel resolved to "next".\n`);
    process.stderr.write('  Add a prerelease suffix (e.g. -next.1) or publish to latest.\n');
    process.exit(1);
}

process.stdout.write(`publish: ${version}  →  dist-tag "${channel}"\n`);

try {
    execSync(`npm publish --tag ${channel}`, { stdio: 'inherit' });
} catch (err) {
    process.exit(typeof err.status === 'number' ? err.status : 1);
}
