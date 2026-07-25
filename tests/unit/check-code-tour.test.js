#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');
const { checkCodeTour } = require('../../scripts/check-code-tour');

const SOURCE = `/**
 * First declaration.
 */
function first() {
  return 1;
}

function second() {
  return 2;
}
`;

function writeFixture(repo, tour) {
    fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'docs', 'code-tour.md'), tour);
    fs.writeFileSync(path.join(repo, 'lib', 'sample.js'), SOURCE);
}

function validTour(anchorLine = 4, returnValue = 2) {
    return `# Tour

**\`lib/sample.js:${anchorLine}\`**

\`\`\`js
/**
 * First declaration.
 */
function first() {
  return 1;
}
// …
function second() {
  return ${returnValue};
}
\`\`\`
`;
}

// REGRESSION: the checker must accept aligned verbatim segments separated by the permitted elision marker.
test('accepts an aligned verbatim excerpt with elision', () => withTempDir('aigon-tour-valid-', (repo) => {
    writeFixture(repo, validTour());
    const result = checkCodeTour({ repoRoot: repo });
    assert.deepStrictEqual(result.problems, []);
    assert.strictEqual(result.excerpts.length, 1);
}));

// REGRESSION: an in-range anchor to the wrong declaration previously passed because only line bounds were checked.
test('rejects an in-range anchor that does not open the excerpt', () => withTempDir('aigon-tour-anchor-', (repo) => {
    writeFixture(repo, validTour(8));
    const result = checkCodeTour({ repoRoot: repo });
    assert.ok(result.problems.some(problem => problem.includes('anchor/excerpt mismatch')));
}));

// REGRESSION: hand-edited excerpt lines must fail instead of relying on fuzzy human comparison.
test('rejects a non-verbatim retained line', () => withTempDir('aigon-tour-verbatim-', (repo) => {
    writeFixture(repo, validTour(4, 99));
    const result = checkCodeTour({ repoRoot: repo });
    assert.ok(result.problems.some(problem => problem.includes('not verbatim')));
}));

// REGRESSION: every JavaScript fence needs its own anchor rather than inheriting a section-level anchor.
test('rejects a second excerpt without a dedicated anchor', () => withTempDir('aigon-tour-unanchored-', (repo) => {
    const tour = `${validTour()}
\`\`\`js
function second() {
  return 2;
}
\`\`\`
`;
    writeFixture(repo, tour);
    const result = checkCodeTour({ repoRoot: repo });
    assert.ok(result.problems.some(problem => problem.includes('no dedicated bold path:line anchor')));
}));

// REGRESSION: a trailing newline must not create a phantom source line that an anchor can target.
test('rejects an anchor one line past a newline-terminated file', () => withTempDir('aigon-tour-eof-', (repo) => {
    const tour = `${validTour()}\nSee \`lib/sample.js:11\`.\n`;
    writeFixture(repo, tour);
    const result = checkCodeTour({ repoRoot: repo });
    assert.ok(result.problems.some(problem => problem.includes('past end of file (10 lines)')));
}));

report();
