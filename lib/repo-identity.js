'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT_DIR } = require('./config');

function realpathOrNull(p) {
    try {
        return fs.realpathSync(p);
    } catch (_) {
        return null;
    }
}

function isAigonSourceRepo(repoRoot = process.cwd()) {
    const repoReal = realpathOrNull(repoRoot);
    const sourceReal = realpathOrNull(ROOT_DIR);
    if (!repoReal || !sourceReal || repoReal !== sourceReal) return false;

    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(repoReal, 'package.json'), 'utf8'));
        return pkg.name === '@senlabsai/aigon';
    } catch (_) {
        return false;
    }
}

module.exports = {
    isAigonSourceRepo,
};
