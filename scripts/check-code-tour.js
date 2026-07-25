#!/usr/bin/env node
'use strict';

/**
 * Structural and verbatim checker for docs/code-tour.md.
 *
 * Every JavaScript excerpt must have its own bold `path:line` anchor. The
 * anchor points at the excerpt's opening declaration (or first retained
 * statement for a partial/comment-only excerpt), and every retained source
 * segment must be byte-identical and appear in order. A standalone `// …`
 * line is the only permitted elision.
 *
 * Usage:  node scripts/check-code-tour.js [--quiet]
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..');
const ANCHOR_RE = /`([A-Za-z0-9_./-]+\.[A-Za-z0-9]+):(\d+)`/g;
const HEADER_ANCHOR_RE = /^\*\*`([A-Za-z0-9_./-]+\.[A-Za-z0-9]+):(\d+)`\*\*$/;

function sourceLines(content) {
    const lines = String(content).split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    return lines;
}

function resolveRepoFile(repoRoot, file) {
    if (path.isAbsolute(file) || file.split('/').includes('..')) return null;
    const abs = path.resolve(repoRoot, file);
    const relative = path.relative(repoRoot, abs);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
    return abs;
}

function collectAnchors(tour) {
    const anchors = [];
    const seen = new Set();
    let match;
    while ((match = ANCHOR_RE.exec(tour)) !== null) {
        const key = `${match[1]}:${match[2]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        anchors.push({ file: match[1], line: parseInt(match[2], 10) });
    }
    return anchors;
}

function collectExcerpts(tour, problems) {
    const lines = tour.split('\n');
    const excerpts = [];
    let pendingAnchor = null;

    for (let index = 0; index < lines.length; index += 1) {
        const header = lines[index].match(HEADER_ANCHOR_RE);
        if (header) {
            pendingAnchor = {
                file: header[1],
                line: parseInt(header[2], 10),
                docLine: index + 1,
            };
            continue;
        }
        if (lines[index] !== '```js') continue;

        const end = lines.indexOf('```', index + 1);
        if (end === -1) {
            problems.push(`docs/code-tour.md:${index + 1} — unclosed JavaScript excerpt`);
            break;
        }
        if (!pendingAnchor) {
            problems.push(`docs/code-tour.md:${index + 1} — JavaScript excerpt has no dedicated bold path:line anchor`);
        }
        excerpts.push({
            anchor: pendingAnchor,
            docLine: index + 1,
            lines: lines.slice(index + 1, end),
        });
        pendingAnchor = null;
        index = end;
    }
    return excerpts;
}

function splitExcerptSegments(lines) {
    const segments = [[]];
    for (const line of lines) {
        if (line.trim() === '// …') {
            segments.push([]);
        } else {
            segments[segments.length - 1].push(line);
        }
    }
    return segments
        .map((segment) => {
            let start = 0;
            let end = segment.length;
            while (start < end && segment[start] === '') start += 1;
            while (end > start && segment[end - 1] === '') end -= 1;
            return segment.slice(start, end);
        })
        .filter(segment => segment.length > 0);
}

function openingLineOffset(lines) {
    let inBlockComment = false;
    let fallback = -1;

    for (let index = 0; index < lines.length; index += 1) {
        const trimmed = lines[index].trim();
        if (!trimmed) continue;
        if (fallback === -1) fallback = index;

        if (inBlockComment) {
            if (trimmed.includes('*/')) inBlockComment = false;
            continue;
        }
        if (trimmed.startsWith('/*')) {
            if (!trimmed.includes('*/')) inBlockComment = true;
            continue;
        }
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
        if (/^[{}[\]();,]+$/.test(trimmed)) continue;
        return index;
    }
    return fallback;
}

function segmentMatchesAt(lines, segment, start) {
    if (start < 0 || start + segment.length > lines.length) return false;
    return segment.every((line, offset) => lines[start + offset] === line);
}

function findSegment(lines, segment, startAt) {
    for (let start = startAt; start <= lines.length - segment.length; start += 1) {
        if (segmentMatchesAt(lines, segment, start)) return start;
    }
    return -1;
}

function validateExcerpt(excerpt, repoRoot, getLines, problems) {
    if (!excerpt.anchor) return;
    const { file, line } = excerpt.anchor;
    const lines = getLines(file);
    if (!lines) return;

    const segments = splitExcerptSegments(excerpt.lines);
    if (segments.length === 0) {
        problems.push(`docs/code-tour.md:${excerpt.docLine} — JavaScript excerpt is empty`);
        return;
    }

    const first = segments[0];
    const openingOffset = openingLineOffset(first);
    if (openingOffset < 0) {
        problems.push(`docs/code-tour.md:${excerpt.docLine} — JavaScript excerpt has no retained source line`);
        return;
    }

    let firstStart = -1;
    for (let start = 0; start <= lines.length - first.length; start += 1) {
        if (start + openingOffset !== line - 1) continue;
        if (segmentMatchesAt(lines, first, start)) {
            firstStart = start;
            break;
        }
    }

    if (firstStart === -1) {
        const foundElsewhere = findSegment(lines, first, 0);
        if (foundElsewhere !== -1) {
            const actualLine = foundElsewhere + openingOffset + 1;
            problems.push(
                `${file}:${line} — anchor/excerpt mismatch; opening source line is ${actualLine}`,
            );
        } else {
            problems.push(
                `docs/code-tour.md:${excerpt.docLine} — excerpt is not verbatim in ${file}`,
            );
        }
        return;
    }

    let nextStart = firstStart + first.length;
    for (const segment of segments.slice(1)) {
        const found = findSegment(lines, segment, nextStart);
        if (found === -1) {
            problems.push(
                `docs/code-tour.md:${excerpt.docLine} — excerpt segment after // … is not verbatim/in order in ${file}`,
            );
            return;
        }
        nextStart = found + segment.length;
    }
}

function checkCodeTour(options = {}) {
    const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
    const tourPath = options.tourPath || path.join(repoRoot, 'docs', 'code-tour.md');
    const problems = [];
    const fileCache = new Map();

    if (!fs.existsSync(tourPath)) {
        return {
            anchors: [],
            excerpts: [],
            rows: [],
            problems: [`Not found: ${path.relative(repoRoot, tourPath)}`],
        };
    }

    const tour = fs.readFileSync(tourPath, 'utf8');
    const anchors = collectAnchors(tour);
    const excerpts = collectExcerpts(tour, problems);

    function getLines(file) {
        if (fileCache.has(file)) return fileCache.get(file);
        const abs = resolveRepoFile(repoRoot, file);
        if (!abs) {
            problems.push(`${file} — anchor path escapes the repository`);
            fileCache.set(file, null);
            return null;
        }
        if (!fs.existsSync(abs)) {
            problems.push(`${file} — file no longer exists`);
            fileCache.set(file, null);
            return null;
        }
        const lines = sourceLines(fs.readFileSync(abs, 'utf8'));
        fileCache.set(file, lines);
        return lines;
    }

    const rows = [];
    if (anchors.length === 0) {
        problems.push('No file:line anchors found in docs/code-tour.md — has the format changed?');
    }
    for (const anchor of anchors) {
        const lines = getLines(anchor.file);
        if (!lines) continue;
        if (anchor.line < 1 || anchor.line > lines.length) {
            problems.push(`${anchor.file}:${anchor.line} — past end of file (${lines.length} lines)`);
            continue;
        }
        rows.push({
            ...anchor,
            text: lines[anchor.line - 1].trim(),
        });
    }

    excerpts.forEach(excerpt => validateExcerpt(excerpt, repoRoot, getLines, problems));
    return { anchors, excerpts, rows, problems };
}

function main() {
    const quiet = process.argv.includes('--quiet');
    const result = checkCodeTour();

    if (!quiet) {
        result.rows.forEach((row) => {
            const label = `${row.file}:${row.line}`.padEnd(46);
            console.log(`  ${label} ${row.text.slice(0, 100)}`);
        });
    }
    console.log('');

    if (result.problems.length > 0) {
        console.error(`❌ ${result.problems.length} code-tour problem(s):`);
        result.problems.forEach(problem => console.error(`   - ${problem}`));
        console.error('\n   Fix: re-copy the excerpt, give it a dedicated anchor, and update the');
        console.error('   opening line. See .claude/skills/code-tour/SKILL.md.');
        process.exit(1);
    }

    console.log(
        `✅ ${result.anchors.length} anchors resolve; ` +
        `${result.excerpts.length} excerpts are verbatim and aligned.`,
    );
}

if (require.main === module) main();

module.exports = {
    checkCodeTour,
    collectAnchors,
    collectExcerpts,
    openingLineOffset,
    sourceLines,
    splitExcerptSegments,
};
