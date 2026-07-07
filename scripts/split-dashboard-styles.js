#!/usr/bin/env node
'use strict';

/**
 * Feature 628: format + split templates/dashboard/styles.css into per-concern sheets.
 * REGRESSION: concat of split sheets must match formatCss(whole-file) byte-for-byte.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'templates/dashboard/styles.css');
const OUT_DIR = path.join(ROOT, 'templates/dashboard/styles');

/** Expand minified multi-rule lines to one rule per line (4-space indent). */
function formatCssLines(raw) {
    const lines = raw.split('\n');
    const out = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            out.push('');
            continue;
        }
        if (trimmed.startsWith('/*')) {
            out.push('    ' + trimmed);
            continue;
        }

        const body = trimmed;
        const chunks = [];
        let depth = 0;
        let start = 0;
        let inComment = false;

        for (let i = 0; i < body.length; i++) {
            const ch = body[i];
            const next = body[i + 1];
            if (inComment) {
                if (ch === '*' && next === '/') {
                    inComment = false;
                    i++;
                }
                continue;
            }
            if (ch === '/' && next === '*') {
                inComment = true;
                i++;
                continue;
            }
            if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth === 0) {
                    chunks.push(body.slice(start, i + 1));
                    start = i + 1;
                }
            }
        }
        if (start < body.length) {
            const tail = body.slice(start).trim();
            if (tail) chunks.push(tail);
        }

        if (chunks.length <= 1) {
            out.push('    ' + body);
        } else {
            for (const chunk of chunks) {
                const c = chunk.trim();
                if (c) out.push('    ' + c);
            }
        }
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '\n');
}

/** Split boundaries on the pre-format source: [filename, startLine, endLine] 1-based inclusive. */
const SPLITS = [
    ['tokens.css', 1, 2],
    ['base.css', 3, 48],
    ['monitor.css', 49, 217],
    ['kanban.css', 218, 488],
    ['components.css', 489, 581],
    ['settings.css', 582, 737],
    ['drawer.css', 738, 960],
    ['terminal.css', 961, 990],
    ['logs.css', 991, 1024],
    ['sessions.css', 1025, 1040],
    ['stats.css', 1041, 1274],
    ['notifications.css', 1275, 1300],
    ['components-shared.css', 1301, 1328],
    ['budget.css', 1329, 1400],
    ['settings-version.css', 1401, 1436],
    ['terminal-theme.css', 1437, 1451],
    ['stats-matrix.css', 1453, 1491],
    ['stats-benchmarks.css', 1493, 1567],
    ['components-overrides.css', 1569, 1585],
    ['responsive.css', 1587, 1641],
    ['chrome-upgrade.css', 1643, 1685],
];

function stripForCompare(css) {
    return css.replace(/\s+/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function main() {
    const raw = fs.readFileSync(SRC, 'utf8');
    const rawLines = raw.split('\n');
    const expectedFormatted = formatCssLines(raw);

    fs.mkdirSync(OUT_DIR, { recursive: true });

    const manifest = [];
    const parts = [];

    for (const [file, start, end] of SPLITS) {
        const slice = rawLines.slice(start - 1, end).join('\n');
        const formattedSlice = formatCssLines(slice.endsWith('\n') ? slice : slice + '\n');
        const dest = path.join(OUT_DIR, file);
        fs.writeFileSync(dest, formattedSlice);
        manifest.push(file);
        parts.push(formattedSlice);
    }

    fs.writeFileSync(
        path.join(OUT_DIR, 'manifest.json'),
        JSON.stringify({ order: manifest }, null, 2) + '\n'
    );

    const concat = parts.join('');
    if (stripForCompare(concat) !== stripForCompare(expectedFormatted)) {
        console.error('MISMATCH: split concat differs from formatted monolith');
        process.exit(1);
    }

    console.log(`Split ${manifest.length} sheets → ${OUT_DIR}`);
    console.log(`Formatted monolith would be ${expectedFormatted.split('\n').length} lines (source ${rawLines.length})`);
    console.log('Cascade verify: OK');
}

main();
