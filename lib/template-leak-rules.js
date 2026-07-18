'use strict';

// Shared leak rules and text-scanning primitives for template source files,
// agent JSON placeholders, and rendered install artifacts.

const SUPPRESSION_MARKERS = ['aigon-internal-ok'];

// Explicit allow-list for placeholder keys whose values legitimately match a
// pattern but must not block install (one-line rationale per key).
const PLACEHOLDER_KEY_ALLOW_LIST = new Map([
    // No entries — fix leaks in placeholder text rather than suppressing.
]);

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
    { pattern: /\bnext\s+dev\b/, label: "next dev (target-repo may not use Next.js)" },
    { pattern: /\.env\.local\b/, label: ".env.local (target-repo may use different env file layout)" },

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
    { pattern: /(?<![./\w-])tests\//, label: "tests/ directory (target-repo may not have one)" },
    { pattern: /(?<![./\w-])src\//, label: "src/ directory (target-repo may not have one)" },
    { pattern: /(?<![./\w-])app\/(?!\w)/, label: "app/ directory (target-repo may not have one)" },

    // --- aigon-the-repo's own conventions leaking out ---
    { pattern: /\btest:(?:iterate|core|browser|deploy|quick|ui|all|migration)\b/, label: "test:* npm script (aigon-specific gate name)" },
    { pattern: /\biterate gate\b|deploy gate\b/i, label: "iterate gate / deploy gate (aigon-the-repo's testing concept)" },
    { pattern: /\bLOC\s+(?:budget|ceiling)\b/i, label: "LOC budget / ceiling (aigon-the-repo's test convention)" },
    { pattern: /\bcheck-test-budget\b/, label: "check-test-budget (aigon-the-repo's script)" },
];

const INSTRUCTION_TEXT_EXTENSIONS = new Set(['.md', '.mdc', '.toml']);

function isSuppressed(line) {
    return SUPPRESSION_MARKERS.some((m) => line.includes(m));
}

/**
 * Scan text line-by-line. Returns findings with line numbers.
 * @param {string} text
 * @param {{ file?: string, allowSuppression?: boolean, placeholderKey?: string }} [ctx]
 */
function scanText(text, ctx = {}) {
    const { file = '<text>', allowSuppression = true, placeholderKey } = ctx;
    if (placeholderKey && PLACEHOLDER_KEY_ALLOW_LIST.has(placeholderKey)) {
        return [];
    }
    const lines = String(text).split('\n');
    const findings = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (allowSuppression && isSuppressed(line)) continue;
        for (const { pattern, label } of LEAK_PATTERNS) {
            const match = line.match(pattern);
            if (match) {
                findings.push({
                    file,
                    lineNo: i + 1,
                    line: line.trim(),
                    match: match[0],
                    label,
                    placeholderKey: placeholderKey || null,
                });
            }
        }
    }
    return findings;
}

/**
 * Walk nested placeholder object; returns dotted keys with string values.
 */
function flattenPlaceholderStrings(obj, prefix = '') {
    const out = [];
    if (!obj || typeof obj !== 'object') return out;
    for (const [key, value] of Object.entries(obj)) {
        const dotted = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'string') {
            out.push({ key: dotted, value });
        } else if (value && typeof value === 'object' && !Array.isArray(value)) {
            out.push(...flattenPlaceholderStrings(value, dotted));
        }
    }
    return out;
}

function isInstructionArtifactPath(relPath) {
    const ext = relPath.slice(relPath.lastIndexOf('.')).toLowerCase();
    return INSTRUCTION_TEXT_EXTENSIONS.has(ext);
}

module.exports = {
    LEAK_PATTERNS,
    SUPPRESSION_MARKERS,
    PLACEHOLDER_KEY_ALLOW_LIST,
    INSTRUCTION_TEXT_EXTENSIONS,
    isSuppressed,
    scanText,
    flattenPlaceholderStrings,
    isInstructionArtifactPath,
};
