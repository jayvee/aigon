#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');
const { parseFrontMatter } = require('../../lib/cli-parse');
const {
    migrateFeedbackToResearch,
    findMigratedResearchPath,
    FEEDBACK_STATUS_TO_RESEARCH_FOLDER,
} = require('../../lib/feedback-migrate');
const { createFeedbackCommands } = require('../../lib/commands/feedback');

const FEEDBACK_FOLDERS = [
    '01-inbox', '02-triaged', '03-actionable', '04-done', '05-wont-fix', '06-duplicate',
];
const RESEARCH_FOLDERS = [
    '01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused',
];

function mkDirs(root) {
    FEEDBACK_FOLDERS.forEach(f => fs.mkdirSync(path.join(root, 'docs', 'specs', 'feedback', f), { recursive: true }));
    RESEARCH_FOLDERS.forEach(f => fs.mkdirSync(path.join(root, 'docs', 'specs', 'research-topics', f), { recursive: true }));
}

function writeFeedback(root, folder, id, bodyExtra = '') {
    const file = `feedback-${id}-sample-item.md`;
    const content = `---
id: ${id}
title: "Sample item ${id}"
status: "${folder.replace(/^\d+-/, '')}"
type: "bug"
severity: high
tags: ["auth"]
votes: 2
reporter:
  name: "Pat"
  identifier: "pat@example.com"
source:
  channel: "support"
  reference: "T-${id}"
---

## Summary

User reported issue ${id}.

## Evidence

Logs attached.

## Triage Notes

Needs investigation.

## Proposed Next Action

Promote to research.
${bodyExtra}
`;
    fs.writeFileSync(path.join(root, 'docs', 'specs', 'feedback', folder, file), content);
    return file;
}

function countResearchSpecs(root) {
    let count = 0;
    RESEARCH_FOLDERS.forEach(folder => {
        const dir = path.join(root, 'docs', 'specs', 'research-topics', folder);
        if (!fs.existsSync(dir)) return;
        count += fs.readdirSync(dir).filter(f => f.startsWith('research-') && f.endsWith('.md')).length;
    });
    return count;
}

test('FEEDBACK_STATUS_TO_RESEARCH_FOLDER maps wont-fix and duplicate to done', () => {
    assert.strictEqual(FEEDBACK_STATUS_TO_RESEARCH_FOLDER['wont-fix'], '05-done');
    assert.strictEqual(FEEDBACK_STATUS_TO_RESEARCH_FOLDER.duplicate, '05-done');
});

test('migrateFeedbackToResearch is idempotent on second run', () => withTempDir('aigon-fbm-', (root) => {
    mkDirs(root);
    writeFeedback(root, '01-inbox', 1);
    writeFeedback(root, '05-wont-fix', 2);

    const first = migrateFeedbackToResearch(root);
    assert.strictEqual(first.migrated, 2);
    assert.strictEqual(first.skipped, 0);
    const afterFirst = countResearchSpecs(root);
    assert.strictEqual(afterFirst, 2);

    const second = migrateFeedbackToResearch(root);
    assert.strictEqual(second.migrated, 0);
    assert.strictEqual(second.skipped, 2);
    assert.strictEqual(countResearchSpecs(root), afterFirst);
}));

test('migration preserves origin, reporter, source, and feedback_refs', () => withTempDir('aigon-fbm-meta-', (root) => {
    mkDirs(root);
    writeFeedback(root, '02-triaged', 7);

    migrateFeedbackToResearch(root);
    const migratedPath = findMigratedResearchPath(root, 7, 'docs/specs/feedback/02-triaged/feedback-7-sample-item.md');
    assert.ok(migratedPath);
    assert.ok(migratedPath.includes(`${path.sep}02-backlog${path.sep}`));

    const { data, body } = parseFrontMatter(fs.readFileSync(migratedPath, 'utf8'));
    assert.strictEqual(data.origin, 'customer-feedback');
    assert.strictEqual(data.reporter.name, 'Pat');
    assert.strictEqual(data.source.channel, 'support');
    assert.deepStrictEqual(data.feedback_refs, ['feedback:7', 'docs/specs/feedback/02-triaged/feedback-7-sample-item.md']);
    assert.ok(body.includes('## Context'));
    assert.ok(body.includes('User reported issue 7'));
}));

test('wont-fix disposition is preserved in migrated body', () => withTempDir('aigon-fbm-wf-', (root) => {
    mkDirs(root);
    writeFeedback(root, '05-wont-fix', 9);

    migrateFeedbackToResearch(root);
    const migratedPath = findMigratedResearchPath(root, 9, 'docs/specs/feedback/05-wont-fix/feedback-9-sample-item.md');
    const { body } = parseFrontMatter(fs.readFileSync(migratedPath, 'utf8'));
    assert.ok(body.includes('## Original Feedback Disposition'));
    assert.ok(body.includes('Status: wont-fix'));
}));

test('feedback-create prints deprecation notice', () => withTempDir('aigon-fbm-dep-', (root) => {
    mkDirs(root);
    const logs = [];
    const origLog = console.log;
    const origCwd = process.cwd();
    console.log = (...args) => logs.push(args.join(' '));
    try {
        process.chdir(root);
        const cmds = createFeedbackCommands();
        cmds['feedback-create']('Test title');
    } finally {
        process.chdir(origCwd);
        console.log = origLog;
    }
    assert.ok(logs.some(line => /deprecat/i.test(line)), 'expected deprecation notice');
}));

report();
