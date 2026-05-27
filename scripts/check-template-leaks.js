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

// Directories under templates/ whose contents are installed into user repos or embedded
// into installed templates. Top-level `agents/`, `contributing/`, `dashboard/`,
// `profiles/`, `recurring/` are aigon-internal and intentionally not scanned.
const SCAN_DIRS = ['generic', 'docs', 'specs', 'prompts', 'sections'];

const FILE_EXCEPTIONS = new Set();

// Patterns that indicate a leak of aigon-internal references OR target-repo assumptions
// into user-facing templates. Aigon has ZERO opinion about the target repo's language,
// package manager, test framework, build, lint, or directory layout — see AGENTS.md §
// "Target-repo boundary — zero opinion".
//
// Each entry: { pattern: RegExp, label: short description for the report }
const LEAK_PATTERNS = [
    // --- aigon-internal source paths ---
    { pattern: /\bdocs\/architecture\.md\b/, label: "docs/architecture.md (aigon's own architecture doc)" },
    { pattern: /\blib\/workflow-core\b/, label: "lib/workflow-core/ (aigon's engine source)" },
    { pattern: /\blib\/[a-z][a-z0-9_-]*\.js\b/, label: "lib/<name>.js (aigon source file)" },
    { pattern: /\baigon-cli\.js\b/, label: "aigon-cli.js (aigon's entry point)" },
    { pattern: /\bscripts\/[a-zA-Z][a-zA-Z0-9_-]*\.(?:sh|js)\b/, label: "scripts/<name> (aigon's own scripts dir)" },
    { pattern: /~\/src\/aigon\b/, label: "~/src/aigon (maintainer-local path)" },
    { pattern: /\/Users\/[a-zA-Z0-9._-]+\//, label: "/Users/... absolute path" },
    { pattern: /\btemplates\/(?:generic|docs|agents|specs|prompts)\b/, label: "templates/... (aigon's source template dir)" },

    // --- target-repo build/package-manager assumptions ---
    { pattern: /\bnpm\s+(?:run\s+\S+|test|install|ci|publish|i\b)/, label: "npm command (target-repo may not use npm)" },
    { pattern: /\bpnpm\s+\S+/, label: "pnpm command (target-repo may not use pnpm)" },
    { pattern: /\byarn\s+\S+/, label: "yarn command (target-repo may not use yarn)" },
    { pattern: /\bpip\s+install\b/, label: "pip install (target-repo may not be Python)" },
    { pattern: /\bcargo\s+(?:test|build|run|check)\b/, label: "cargo command (target-repo may not be Rust)" },
    { pattern: /\bgo\s+(?:test|build|run)\b/, label: "go command (target-repo may not be Go)" },
    { pattern: /\bbundle\s+exec\b/, label: "bundle exec (target-repo may not be Ruby)" },
    { pattern: /\bmvn\s+\S+/, label: "mvn command (target-repo may not be Java)" },

    // --- target-repo test-framework / lint / typecheck assumptions ---
    { pattern: /\bplaywright\b/i, label: "playwright (target-repo may not use Playwright)" },
    { pattern: /\bpytest\b/i, label: "pytest (target-repo may not be Python)" },
    { pattern: /\bjest\b/i, label: "jest (target-repo may not use Jest)" },
    { pattern: /\bvitest\b/i, label: "vitest (target-repo may not use Vitest)" },
    { pattern: /\bmocha\b/i, label: "mocha (target-repo may not use Mocha)" },
    { pattern: /\beslint\b/i, label: "eslint (target-repo may not use ESLint)" },
    { pattern: /\bprettier\b/i, label: "prettier (target-repo may not use Prettier)" },
    { pattern: /\brubocop\b/i, label: "rubocop (target-repo may not be Ruby)" },
    { pattern: /\btsc\b/, label: "tsc (target-repo may not be TypeScript)" },
    { pattern: /\bnode\s+--check\b/, label: "node --check (target-repo may not be Node)" },

    // --- target-repo directory-layout assumptions ---
    // Match standalone references like "lib/" or "the tests/" — not full paths like
    // ".aigon/state/" or "docs/specs/" which ARE Aigon-owned and exist in user repos.
    { pattern: /(?<![./\w-])tests\//, label: "tests/ directory (target-repo may not have one)" },
    { pattern: /(?<![./\w-])src\//, label: "src/ directory (target-repo may not have one)" },
    { pattern: /(?<![./\w-])app\/(?!\w)/, label: "app/ directory (target-repo may not have one)" },

    // --- aigon-the-repo's own conventions leaking out ---
    { pattern: /\btest:(?:iterate|core|browser|deploy|quick|ui|all|migration)\b/, label: "test:* npm script (aigon-specific gate name)" },
    { pattern: /\biterate gate\b|deploy gate\b/i, label: "iterate gate / deploy gate (aigon-the-repo's testing concept)" },
    { pattern: /\bLOC\s+(?:budget|ceiling)\b/i, label: "LOC budget / ceiling (aigon-the-repo's test convention)" },
    { pattern: /\bcheck-test-budget\b/, label: "check-test-budget (aigon-the-repo's script)" },
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
