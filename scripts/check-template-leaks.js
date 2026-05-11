#!/usr/bin/env node
// check-template-leaks.js — fail if any user-facing template references aigon-internal
// source paths. Templates under templates/{generic,docs,specs,prompts,skill-pointers}/
// get installed into the user's repo; they must not mention aigon's own lib/, scripts/,
// docs/architecture.md, etc., because those paths don't exist in user repos.
//
// Allow-list: `.aigon/state/`, `.aigon/workflows/`, `.aigon/docs/`, etc. — these ARE
// created in user repos by aigon, so referencing them is legitimate.
//
// Escape valve: append `<!-- aigon-internal-ok -->` (or `// aigon-internal-ok`) on the
// same line to suppress the check for that line. Use sparingly — prefer rewriting.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATES = path.join(ROOT, 'templates');

// Directories under templates/ that ARE installed into user repos (in scope).
const SCAN_DIRS = ['generic', 'docs', 'specs', 'prompts', 'skill-pointers'];

// File-level exceptions: paths (relative to templates/) of files that legitimately
// reference aigon-internal paths because they are maintainer-only commands. These
// SHOULD ideally be moved out of templates/ so they don't ship to user repos at all;
// until they are, suppress the check here so this script stays useful.
const FILE_EXCEPTIONS = new Set([
    'generic/commands/model-refresh.md', // maintainer command — edits aigon's own agent registry
]);

// Patterns that indicate a leak of aigon-internal paths into user-facing templates.
// Each entry: { pattern: RegExp, label: short description for the report }
const LEAK_PATTERNS = [
    { pattern: /\bdocs\/architecture\.md\b/, label: "docs/architecture.md (aigon's own architecture doc)" },
    { pattern: /\blib\/workflow-core\b/, label: "lib/workflow-core/ (aigon's engine source)" },
    { pattern: /\blib\/[a-z][a-z0-9_-]*\.js\b/, label: "lib/<name>.js (aigon source file)" },
    { pattern: /\baigon-cli\.js\b/, label: "aigon-cli.js (aigon's entry point)" },
    { pattern: /\bscripts\/[a-zA-Z][a-zA-Z0-9_-]*\.(?:sh|js)\b/, label: "scripts/<name> (aigon's own scripts dir)" },
    { pattern: /~\/src\/aigon\b/, label: "~/src/aigon (maintainer-local path)" },
    { pattern: /\/Users\/[a-zA-Z0-9._-]+\//, label: "/Users/... absolute path" },
    { pattern: /\btemplates\/(?:generic|docs|agents|specs|prompts)\b/, label: "templates/... (aigon's source template dir)" },
];

const SUPPRESSION_MARKERS = ['aigon-internal-ok'];

function walk(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (entry.isFile()) out.push(full);
    }
    return out;
}

function isSuppressed(line) {
    return SUPPRESSION_MARKERS.some((m) => line.includes(m));
}

function scanFile(file) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n');
    const findings = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (isSuppressed(line)) continue;
        for (const { pattern, label } of LEAK_PATTERNS) {
            const match = line.match(pattern);
            if (match) findings.push({ file, lineNo: i + 1, line: line.trim(), match: match[0], label });
        }
    }
    return findings;
}

function main() {
    const files = [];
    for (const sub of SCAN_DIRS) files.push(...walk(path.join(TEMPLATES, sub)));

    const allFindings = [];
    for (const f of files) {
        const relFromTemplates = path.relative(TEMPLATES, f);
        if (FILE_EXCEPTIONS.has(relFromTemplates)) continue;
        allFindings.push(...scanFile(f));
    }

    if (allFindings.length === 0) {
        console.log(`✓ check-template-leaks: scanned ${files.length} files under templates/{${SCAN_DIRS.join(',')}}/ — no leaks`);
        process.exit(0);
    }

    console.error(`✗ check-template-leaks: found ${allFindings.length} aigon-internal reference(s) in user-facing templates.\n`);
    console.error('These templates get installed into user repos. The flagged paths do not exist in user repos — rewrite to reference user-repo concepts only, or suppress with `aigon-internal-ok` on the same line if truly intentional.\n');
    for (const f of allFindings) {
        const rel = path.relative(ROOT, f.file);
        console.error(`  ${rel}:${f.lineNo}`);
        console.error(`    matched: "${f.match}"  (${f.label})`);
        console.error(`    line:    ${f.line}`);
        console.error('');
    }
    process.exit(1);
}

main();
