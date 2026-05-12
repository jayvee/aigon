#!/usr/bin/env node
'use strict';

// F408: buildResearchContextSection / printResearchContextInstructions emit
// concrete spec + findings paths whenever a feature spec has `research:` in
// its frontmatter. These tests pin the empty-input branch and the on-disk
// resolution branch.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');
const { buildResearchContextSection } = require('../../lib/feature-do');

function seedResearchFixture(repo, id) {
    const stageDir = path.join(repo, 'docs', 'specs', 'research-topics', '05-done');
    const logsDir = path.join(repo, 'docs', 'specs', 'research-topics', 'logs');
    fs.mkdirSync(stageDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(path.join(stageDir, `research-${id}-fixture-topic.md`), '# Research fixture\n');
    fs.writeFileSync(path.join(logsDir, `research-${id}-cc-findings.md`), '# CC findings\n');
    fs.writeFileSync(path.join(logsDir, `research-${id}-gg-findings.md`), '# GG findings\n');
}

test('buildResearchContextSection: empty inputs and missing artifacts return ""', () => withTempDir('aigon-research-ctx-empty-', (repo) => {
    for (const v of [null, [], undefined]) assert.strictEqual(buildResearchContextSection(v, '/tmp/no-such-repo'), '');
    fs.mkdirSync(path.join(repo, 'docs', 'specs', 'research-topics', '05-done'), { recursive: true });
    assert.strictEqual(buildResearchContextSection(999, repo), '');
}));

test('buildResearchContextSection: resolves spec + findings paths for single ID and arrays of IDs', () => withTempDir('aigon-research-ctx-', (repo) => {
    seedResearchFixture(repo, 91);
    const single = buildResearchContextSection(91, repo);
    assert.ok(single.includes('Step 2.6: Research context'));
    assert.ok(single.includes('./docs/specs/research-topics/05-done/research-91-fixture-topic.md'));
    assert.ok(single.includes('./docs/specs/research-topics/logs/research-91-cc-findings.md'));
    assert.ok(single.includes('./docs/specs/research-topics/logs/research-91-gg-findings.md'));

    seedResearchFixture(repo, 92);
    const multi = buildResearchContextSection([91, 92], repo);
    assert.ok(multi.includes('research-91-fixture-topic.md') && multi.includes('research-92-fixture-topic.md'));
    assert.ok(multi.includes('Research 91:') && multi.includes('Research 92:'));
}));

report();
