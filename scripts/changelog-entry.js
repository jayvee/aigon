#!/usr/bin/env node
'use strict';

// Generate a Keep-a-Changelog entry block from commits since the last tag.
// Used by the /release skill to draft the entry that ship.js will demand.
//
// Usage: node scripts/changelog-entry.js <version> [<since-ref>]
//
//   <version>     e.g. 2.65.0-beta.3 (no leading v).
//   <since-ref>   Optional. Defaults to `git describe --tags --abbrev=0`.

const { execSync } = require('child_process');

const version = process.argv[2];
if (!version) {
    process.stderr.write('usage: changelog-entry.js <version> [<since-ref>]\n');
    process.exit(2);
}

function sh(cmd) {
    return execSync(cmd, { encoding: 'utf8' }).trim();
}

const sinceRef = process.argv[3] || sh('git describe --tags --abbrev=0');
const log = sh(`git log ${sinceRef}..HEAD --pretty=format:%h%s`);
if (!log) {
    process.stderr.write(`changelog-entry: no commits since ${sinceRef}\n`);
    process.exit(1);
}

const commits = log.split('\n').filter(Boolean).map(line => {
    const [sha, subject] = line.split('');
    return { sha, subject };
});

const buckets = { Breaking: [], Added: [], Changed: [], Fixed: [], Internal: [] };

const BREAKING_RE = /^[a-z]+(\([^)]+\))?!:\s*(.+)/;
const FEAT_RE = /^feat(\([^)]+\))?:\s*(.+)/;
const FIX_RE = /^fix(\([^)]+\))?:\s*(.+)/;
const INTERNAL_RE = /^(test|chore|docs|refactor|style|build|ci|perf)(\([^)]+\))?:\s*(.+)/;

for (const { sha, subject } of commits) {
    let m;
    if ((m = subject.match(BREAKING_RE))) buckets.Breaking.push(`${m[2]} (${sha})`);
    else if ((m = subject.match(FEAT_RE))) buckets.Added.push(`${m[2]} (${sha})`);
    else if ((m = subject.match(FIX_RE))) buckets.Fixed.push(`${m[2]} (${sha})`);
    else if ((m = subject.match(INTERNAL_RE))) buckets.Internal.push(`${m[3]} (${sha})`);
    else buckets.Changed.push(`${subject} (${sha})`);
}

const today = new Date().toISOString().slice(0, 10);
let out = `## [${version}] — ${today}\n\n<one-sentence headline — edit me before committing>\n\n`;
for (const [name, items] of Object.entries(buckets)) {
    if (items.length === 0) continue;
    out += `### ${name}\n\n`;
    for (const item of items) out += `- ${item}\n`;
    out += '\n';
}
process.stdout.write(out);
