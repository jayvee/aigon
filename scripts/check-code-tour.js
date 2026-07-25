#!/usr/bin/env node
'use strict';

/**
 * Line-anchor checker for docs/code-tour.md.
 *
 * The tour quotes verbatim source excerpts under `**`path/to/file.js:LINE`**`
 * headers. Line numbers rot as code moves. This script resolves every anchor
 * and prints the actual source line found there, so a human (or an agent
 * running the `code-tour` skill) can eyeball drift in one pass.
 *
 * It cannot know whether the quoted block is still accurate — only whether the
 * anchor still points at something plausible. Hard failures (missing file,
 * line past EOF) exit non-zero; everything else is advisory output.
 *
 * Usage:  node scripts/check-code-tour.js [--quiet]
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const TOUR_PATH = path.join(REPO_ROOT, 'docs', 'code-tour.md');

// Matches:  **`lib/foo/bar.js:123`**   and inline `lib/foo.js:123` mentions.
const ANCHOR_RE = /`([A-Za-z0-9_./-]+\.(?:js|mjs|json|md|html)):(\d+)`/g;

function main() {
    const quiet = process.argv.includes('--quiet');

    if (!fs.existsSync(TOUR_PATH)) {
        console.error(`❌ Not found: ${path.relative(REPO_ROOT, TOUR_PATH)}`);
        process.exit(1);
    }

    const tour = fs.readFileSync(TOUR_PATH, 'utf8');
    const fileCache = new Map();
    const anchors = [];
    const seen = new Set();

    let match;
    while ((match = ANCHOR_RE.exec(tour)) !== null) {
        const key = `${match[1]}:${match[2]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        anchors.push({ file: match[1], line: parseInt(match[2], 10) });
    }

    if (anchors.length === 0) {
        console.error('❌ No file:line anchors found in docs/code-tour.md — has the format changed?');
        process.exit(1);
    }

    const problems = [];

    for (const anchor of anchors) {
        const abs = path.join(REPO_ROOT, anchor.file);

        if (!fileCache.has(anchor.file)) {
            fileCache.set(
                anchor.file,
                fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8').split('\n') : null,
            );
        }
        const lines = fileCache.get(anchor.file);

        if (lines === null) {
            problems.push(`${anchor.file}:${anchor.line} — file no longer exists`);
            continue;
        }
        if (anchor.line < 1 || anchor.line > lines.length) {
            problems.push(`${anchor.file}:${anchor.line} — past end of file (${lines.length} lines)`);
            continue;
        }

        if (!quiet) {
            const text = lines[anchor.line - 1].trim();
            const label = `${anchor.file}:${anchor.line}`.padEnd(46);
            console.log(`  ${label} ${text.slice(0, 100)}`);
        }
    }

    console.log('');
    if (problems.length > 0) {
        console.error(`❌ ${problems.length} broken anchor(s) in docs/code-tour.md:`);
        problems.forEach(p => console.error(`   - ${p}`));
        console.error('\n   Fix: re-locate the excerpt, update the anchor, and re-verify the quoted');
        console.error('   block is still verbatim. See .claude/skills/code-tour/SKILL.md.');
        process.exit(1);
    }

    console.log(`✅ ${anchors.length} anchors resolve. Confirm the printed lines still match each excerpt's opening.`);
}

main();
