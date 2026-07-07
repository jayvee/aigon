#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const eslintConfigs = require('../eslint.config.js');

const JS_DIR = path.join(__dirname, '..', 'templates', 'dashboard', 'js');
const EXPORT_MARKER = '// ── ESM exports (F623) ──';

const SKIP = new Set(['main.js', 'injected.js', 'alpine-bindings.js', 'set-cards.js', 'autonomous-plan.js']);

const NAMED_EXPORT_MODULES = new Set(['close-log-panel.js', 'live.js']);

const EXTRA_GLOBALS = {
    'state.js': ['POLL_MS', 'TS_MS', 'state'],
    'statistics.js': ['statsState'],
    'terminal.js': ['termState'],
    'spec-drawer.js': ['drawerState'],
    'logs.js': ['allItemsState'],
    'actions-picker.js': ['AIGON_AGENTS', 'AGENT_DISPLAY_NAMES', 'AGENT_SHORT_NAMES', 'AUTONOMOUS_AGENT_IDS'],
    'monitor.js': ['monitorView'],
    'pipeline.js': ['pipelineView'],
    'close-log-panel.js': ['openCloseLogPanel', 'finalizeCloseLogPanel', 'dismissCloseLogPanel'],
    'init.js': ['refreshTimestamps'],
    'api.js': ['syncDashboardHiddenRepos'],
};

function getDashboardGlobals() {
    const block = eslintConfigs.find((b) => b.files
        && b.files.some((f) => String(f).includes('templates/dashboard/js')));
    return new Set(Object.keys(block.languageOptions.globals));
}

function stripOldExports(src) {
    const idx = src.indexOf(EXPORT_MARKER);
    if (idx === -1) return src;
    return src.slice(0, idx).replace(/\s+$/, '') + '\n';
}

function extractFunctionNames(source) {
    const names = new Set();
    for (const line of source.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('//')) continue;
        const m = t.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
        if (m) names.add(m[1]);
    }
    return [...names];
}

function bindingExists(source, name) {
    const re = new RegExp(`\\b(?:const|let|var|function)\\s+${name}\\b`);
    return re.test(source);
}

function processFile(fileName, dashboardGlobals) {
    if (SKIP.has(fileName)) return false;
    const filePath = path.join(JS_DIR, fileName);
    if (!fs.existsSync(filePath)) return false;
    let src = fs.readFileSync(filePath, 'utf8');
    if (!src.includes('/* dashboard-esm-processed */')) return false;

    src = stripOldExports(src);
    const fnNames = extractFunctionNames(src);
    const names = new Set();
    for (const fn of fnNames) {
        if (dashboardGlobals.has(fn) && bindingExists(src, fn)) names.add(fn);
    }
    for (const extra of (EXTRA_GLOBALS[fileName] || [])) {
        if (bindingExists(src, extra)) names.add(extra);
    }

    const valid = [...names].sort();
    if (valid.length === 0) {
        fs.writeFileSync(filePath, src + '\n');
        return true;
    }

    let block = `\n${EXPORT_MARKER}\n`;
    if (NAMED_EXPORT_MODULES.has(fileName)) {
        block += `export { ${valid.join(', ')} };\n`;
    }
    block += `Object.assign(globalThis, { ${valid.join(', ')} });\n`;
    fs.writeFileSync(filePath, src + block);
    return true;
}

const dashboardGlobals = getDashboardGlobals();
const files = fs.readdirSync(JS_DIR).filter((f) => f.endsWith('.js') && !f.startsWith('vendor'));
let n = 0;
for (const f of files) {
    if (processFile(f, dashboardGlobals)) n += 1;
}
console.log(`dashboard-esm-fix-exports: fixed ${n} files`);
