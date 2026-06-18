#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { testAsync, withTempDirAsync, report, initGitRepo, seedEntityDirs } = require('../_helpers');
const { createFeatureForFinding } = require('../../lib/commands/security-scan');
const { STAGE_FOLDERS } = require('../../lib/workflow-core/paths');

const SAMPLE_FINDING = {
    severity: 'HIGH',
    tool: 'semgrep',
    category: 'xss',
    file: 'src/auth/login.js',
    line: 42,
    message: 'unsafe innerHTML assignment',
    fingerprint: 'cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe',
};

testAsync('security-scan filing: HIGH finding becomes backlog spec with numeric ID', async () => {
    // REGRESSION: 2026-06-18 scan created inbox specs but failed prioritise/reporting.
    await withTempDirAsync('aigon-sec-scan-file-', async (root) => {
        initGitRepo(root);
        seedEntityDirs(root, 'features');

        const result = await createFeatureForFinding(root, SAMPLE_FINDING, '.scan/reports/2026-06-18.md');
        assert.strictEqual(result.created, true, JSON.stringify(result));
        assert.ok(result.id && /^\d+$/.test(result.id), `expected numeric id, got ${result.id}`);
        assert.ok(result.filePath.includes(`${STAGE_FOLDERS.BACKLOG}${path.sep}`), result.filePath);

        const backlogName = path.basename(result.filePath);
        assert.match(backlogName, new RegExp(`^feature-${result.id}-`));

        const content = fs.readFileSync(result.filePath, 'utf8');
        assert.ok(content.includes(SAMPLE_FINDING.fingerprint));
    });
});

testAsync('security-scan filing: duplicate prioritised spec reports existing numeric ID', async () => {
    await withTempDirAsync('aigon-sec-scan-dup-', async (root) => {
        initGitRepo(root);
        seedEntityDirs(root, 'features');

        const first = await createFeatureForFinding(root, SAMPLE_FINDING, null);
        assert.strictEqual(first.created, true);

        const second = await createFeatureForFinding(root, SAMPLE_FINDING, null);
        assert.strictEqual(second.skipped, true);
        assert.strictEqual(second.reason, 'duplicate finding');
        assert.strictEqual(second.existingId, first.id);
    });
});

report();
