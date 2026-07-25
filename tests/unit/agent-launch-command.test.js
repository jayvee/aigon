#!/usr/bin/env node
// REGRESSION F701: a replacement post-review worker must launch the revise
// command, which records addressing-code-review and revision-complete.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, report } = require('../_helpers');
const { buildAgentCommand } = require('../../lib/agent-launch-command');

test('revision worker uses the canonical feature-code-revise prompt and signals', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-revise-launch-'));
    try {
        const command = buildAgentCommand({
            agent: 'cx', featureId: '701', path: repo, repoPath: repo, desc: 'recover-revision',
        }, 'revise');
        assert.match(command, /aigon agent-status addressing-code-review/);
        assert.match(command, /aigon agent-status revision-complete/);
        const promptPath = command.match(/\$\(< '([^']+)'\)/)?.[1];
        assert.ok(promptPath, 'cx revision launch should use an inline prompt file');
        assert.match(fs.readFileSync(promptPath, 'utf8'), /# aigon-feature-code-revise/);
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});

report();
