'use strict';

const { version } = require('../package.json');

// Stable semver has no pre-release identifiers (no hyphen after patch number).
// e.g. 2.54.5 → latest, 2.55.0-next.1 → next
const isPrerelease = /^\d+\.\d+\.\d+-.+/.test(version);

module.exports = {
    channel: isPrerelease ? 'next' : 'latest',
    version,
};
