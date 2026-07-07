#!/usr/bin/env node
'use strict';

/**
 * F623 wave-1: append ESM export + globalThis bridge blocks to dashboard JS files.
 * Idempotent — skips files already marked with dashboard-esm-processed.
 */

const fs = require('fs');
const path = require('path');

const JS_DIR = path.join(__dirname, '..', 'templates', 'dashboard', 'js');
const MARKER = '/* dashboard-esm-processed */';

const INJECTED_IMPORT_FILES = new Set(['state.js']);

const UNWRAP_IIFE = new Set(['live.js', 'close-log-panel.js']);

const SKIP_FILES = new Set([
    'main.js',
    'injected.js',
    'alpine-bindings.js',
    'global-bridge.js',
]);

function extractTopLevelNames(source) {
    const names = new Set();
    const patterns = [
        /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm,
        /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
    ];
    for (const re of patterns) {
        for (const m of source.matchAll(re)) {
            const name = m[1];
            if (!name.startsWith('_')) names.add(name);
        }
    }
    return [...names].sort();
}

function unwrapIife(source) {
    const trimmed = source.trim();
    const match = trimmed.match(/^\(function\s*\(\)\s*\{([\s\S]*)\}\s*\)\s*\(\s*\)\s*;?\s*$/);
    if (!match) return source;
    return match[1].trim() + '\n';
}

function convertUmdToEsm(source, exportName) {
    const factoryMatch = source.match(
        /\(function\s*\(\s*root\s*,\s*factory\s*\)\s*\{[\s\S]*?\}\s*\)\s*\(\s*typeof globalThis[\s\S]*?,\s*function\s*\(\s*\)\s*\{([\s\S]*)\}\s*\)\s*;?\s*$/
    );
    if (!factoryMatch) return null;
    return `/* dashboard-esm-processed */\nexport const ${exportName} = (function() {\n${factoryMatch[1]}\n})();\nObject.assign(globalThis, { ${exportName} });\n`;
}

function processFile(fileName) {
    if (SKIP_FILES.has(fileName)) return false;
    const filePath = path.join(JS_DIR, fileName);
    if (!fs.existsSync(filePath)) return false;

    let src = fs.readFileSync(filePath, 'utf8');
    if (src.includes(MARKER)) return false;

    if (fileName === 'set-cards.js') {
        const converted = convertUmdToEsm(src, 'AIGON_SET_CARDS');
        if (converted) {
            fs.writeFileSync(filePath, converted);
            return true;
        }
    }
    if (fileName === 'autonomous-plan.js') {
        const converted = convertUmdToEsm(src, 'AIGON_AUTONOMOUS_PLAN');
        if (converted) {
            fs.writeFileSync(filePath, converted);
            return true;
        }
    }

    if (UNWRAP_IIFE.has(fileName)) {
        src = unwrapIife(src);
    }

    let header = `${MARKER}\n`;
    if (INJECTED_IMPORT_FILES.has(fileName)) {
        header += "import { INITIAL_DATA, INSTANCE_NAME } from './injected.js';\n";
        src = src.replace(/^\/\/ INITIAL_DATA and INSTANCE_NAME.*\n\s*/m, '');
    }

    src = header + src;

    const names = extractTopLevelNames(src);
    if (names.length === 0) {
        fs.writeFileSync(filePath, src);
        return true;
    }

    const exportBlock = `\n// ── ESM exports (F623) ──\nexport { ${names.join(', ')} };\nObject.assign(globalThis, { ${names.join(', ')} });\n`;
    fs.writeFileSync(filePath, src + exportBlock);
    return true;
}

const LOAD_ORDER = [
    'state.js', 'utils.js', 'api.js', 'live.js', 'terminal.js', 'sidebar.js',
    'detail-tabs.js', 'spec-drawer.js', 'budget-widget.js', 'actions-picker.js',
    'actions.js', 'matrix-peek.js', 'set-cards.js', 'monitor.js', 'autonomous-plan.js',
    'pipeline.js', 'settings.js', 'statistics.js', 'logs.js', 'close-log-panel.js',
    'init.js', 'aigon-status-pill.js',
];

let changed = 0;
for (const file of LOAD_ORDER) {
    if (processFile(file)) changed += 1;
}
console.log(`dashboard-esm-migrate: updated ${changed} files`);
