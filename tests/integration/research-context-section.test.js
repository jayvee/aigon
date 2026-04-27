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

test('buildResearchContextSection: returns empty string for null / empty array', () => {
    assert.strictEqual(buildResearchContextSection(null, '/tmp/no-such-repo'), '');
    assert.strictEqual(buildResearchContextSection([], '/tmp/no-such-repo'), '');
    assert.strictEqual(buildResearchContextSection(undefined, '/tmp/no-such-repo'), '');
});

test('buildResearchContextSection: resolves spec path and findings paths for a single integer ID', () => withTempDir('aigon-research-ctx-', (repo) => {
    seedResearchFixture(repo, 91);
    const section = buildResearchContextSection(91, repo);
    assert.ok(section.includes('Step 2.6: Research context'), 'should emit the Step 2.6 header');
    assert.ok(section.includes('./docs/specs/research-topics/05-done/research-91-fixture-topic.md'), 'should include the resolved spec path');
    assert.ok(section.includes('./docs/specs/research-topics/logs/research-91-cc-findings.md'), 'should include cc findings path');
    assert.ok(section.includes('./docs/specs/research-topics/logs/research-91-gg-findings.md'), 'should include gg findings path');
}));

test('buildResearchContextSection: accepts an array of IDs and emits a section per ID', () => withTempDir('aigon-research-ctx-multi-', (repo) => {
    seedResearchFixture(repo, 91);
    seedResearchFixture(repo, 92);
    const section = buildResearchContextSection([91, 92], repo);
    assert.ok(section.includes('research-91-fixture-topic.md'), 'should include first ID spec');
    assert.ok(section.includes('research-92-fixture-topic.md'), 'should include second ID spec');
    assert.ok(section.includes('Research 91:'), 'should label first ID');
    assert.ok(section.includes('Research 92:'), 'should label second ID');
}));

test('buildResearchContextSection: returns empty string when no on-disk artifacts exist', () => withTempDir('aigon-research-ctx-empty-', (repo) => {
    fs.mkdirSync(path.join(repo, 'docs', 'specs', 'research-topics', '05-done'), { recursive: true });
    const section = buildResearchContextSection(999, repo);
    assert.strictEqual(section, '');
}));

report();
