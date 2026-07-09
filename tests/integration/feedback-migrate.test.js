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

test('terminal feedback dispositions are preserved in migrated research', () => withTempDir('aigon-fbm-terminal-', (root) => {
    mkDirs(root);
    writeFeedback(root, '05-wont-fix', 9);
    writeFeedback(root, '06-duplicate', 10);

    migrateFeedbackToResearch(root);
    const wontFixPath = findMigratedResearchPath(root, 9, 'docs/specs/feedback/05-wont-fix/feedback-9-sample-item.md');
    const duplicatePath = findMigratedResearchPath(root, 10, 'docs/specs/feedback/06-duplicate/feedback-10-sample-item.md');
    assert.ok(wontFixPath.includes(`${path.sep}05-done${path.sep}`));
    assert.ok(duplicatePath.includes(`${path.sep}05-done${path.sep}`));

    const wontFix = parseFrontMatter(fs.readFileSync(wontFixPath, 'utf8'));
    const duplicate = parseFrontMatter(fs.readFileSync(duplicatePath, 'utf8'));
    assert.ok(wontFix.body.includes('## Original Feedback Disposition'));
    assert.ok(wontFix.body.includes('Status: wont-fix'));
    assert.ok(duplicate.body.includes('## Original Feedback Disposition'));
    assert.ok(duplicate.body.includes('Status: duplicate'));
}));

test('feedback-create prints deprecation notice', () => withTempDir('aigon-fbm-dep-', (root) => {
    mkDirs(root);
    const logs = [];
    const origLog = console.log;
    const origError = console.error;
    const origCwd = process.cwd();
    console.log = (...args) => logs.push(args.join(' '));
    console.error = (...args) => logs.push(args.join(' '));
    try {
        process.chdir(root);
        const cmds = createFeedbackCommands();
        cmds['feedback-create']('Test title');
    } finally {
        process.chdir(origCwd);
        console.log = origLog;
        console.error = origError;
    }
    assert.ok(logs.some(line => /deprecat/i.test(line)), 'expected deprecation notice');
    assert.ok(logs.some(line => /no longer writes feedback items/i.test(line)), 'expected no-write notice');
    const created = FEEDBACK_FOLDERS.flatMap(folder => {
        const dir = path.join(root, 'docs', 'specs', 'feedback', folder);
        return fs.existsSync(dir)
            ? fs.readdirSync(dir).filter(name => /^feedback-\d+-/.test(name))
            : [];
    });
    assert.deepStrictEqual(created, [], 'feedback-create must not create feedback files');
}));

report();
