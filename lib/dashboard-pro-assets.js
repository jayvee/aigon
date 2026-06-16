'use strict';

const fs = require('fs');
const path = require('path');
const { isProAvailable, getPro } = require('./pro');

function resolveProDashboardAsset(fileName) {
    if (!isProAvailable()) return null;
    const base = String(fileName || '').replace(/^[/\\]+/, '');
    if (!base) return null;
    const tried = new Set();
    const pick = (abs) => {
        if (!abs || tried.has(abs)) return null;
        tried.add(abs);
        return fs.existsSync(abs) ? abs : null;
    };
    const pro = getPro();
    if (pro && pro.dashboardDir) {
        const hit = pick(path.join(pro.dashboardDir, base));
        if (hit) return hit;
    }
    try {
        const pkgRoot = path.dirname(require.resolve('@senlabsai/aigon-pro/package.json'));
        const hit = pick(path.join(pkgRoot, 'dashboard', base));
        if (hit) return hit;
    } catch (_) {
        /* optional peer — matches lib/pro.js optional require */
    }
    return null;
}

function resolveProDashboardStub(fileName, options = {}) {
    const templateRoot = options.templateRoot || path.join(__dirname, '..');
    const stubPath = path.join(templateRoot, 'templates', 'dashboard', 'stubs', String(fileName || ''));
    const mod = require(stubPath);
    return isProAvailable() ? mod.proMissing : mod.proUnavailable;
}

module.exports = {
    resolveProDashboardAsset,
    resolveProDashboardStub,
};
