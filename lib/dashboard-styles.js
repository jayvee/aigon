'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_MANIFEST = [
    'tokens.css',
    'base.css',
    'monitor.css',
    'kanban.css',
    'components.css',
    'settings.css',
    'drawer.css',
    'terminal.css',
    'logs.css',
    'sessions.css',
    'stats.css',
    'notifications.css',
    'components-shared.css',
    'budget.css',
    'settings-version.css',
    'terminal-theme.css',
    'stats-matrix.css',
    'stats-benchmarks.css',
    'components-overrides.css',
    'responsive.css',
    'chrome-upgrade.css',
];

let cachedBundle = { key: '', css: '' };

function resolveStylesDir(templateRoot) {
    return path.join(templateRoot, 'templates', 'dashboard', 'styles');
}

function readManifest(stylesDir) {
    const manifestPath = path.join(stylesDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return DEFAULT_MANIFEST;
    try {
        const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (Array.isArray(parsed.order) && parsed.order.length) return parsed.order;
    } catch (_) { /* fall through */ }
    return DEFAULT_MANIFEST;
}

/** Concat ordered dashboard stylesheets for the /styles.css route. */
function concatDashboardStyles(templateRoot) {
    const stylesDir = resolveStylesDir(templateRoot);
    const order = readManifest(stylesDir);
    const parts = [];
    let mtimeKey = stylesDir;

    for (const file of order) {
        const filePath = path.join(stylesDir, file);
        if (!fs.existsSync(filePath)) {
            throw new Error(`Missing dashboard stylesheet: ${filePath}`);
        }
        const stat = fs.statSync(filePath);
        mtimeKey += `|${file}:${stat.mtimeMs}:${stat.size}`;
        parts.push(fs.readFileSync(filePath, 'utf8'));
    }

    if (cachedBundle.key === mtimeKey) return cachedBundle.css;

    const css = parts.join('');
    cachedBundle = { key: mtimeKey, css };
    return css;
}

function clearDashboardStylesCache() {
    cachedBundle = { key: '', css: '' };
}

module.exports = {
    concatDashboardStyles,
    clearDashboardStylesCache,
    resolveStylesDir,
    readManifest,
    DEFAULT_MANIFEST,
};
