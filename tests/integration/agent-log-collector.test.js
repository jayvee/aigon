#!/usr/bin/env node
// REGRESSION feature 225 + 2026-04-06 incident: the Agent Log drawer
// depends on precise solo/Fleet keying and on stripping telemetry
// frontmatter that the close workflow sometimes writes into log files.
// Together these tests pin down collectAgentLogs's contract with the
// /api/detail payload: truncate pathological logs, preserve per-agent
// entries even when a Fleet file is missing, and strip YAML blocks so
// marked.parse doesn't render a wall of bold headers.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');
const { collectAgentLogs, AGENT_LOG_MAX_BYTES } = require('../../lib/dashboard-status-collector');

const inDir = (fn) => withTempDir('aigon-log-', fn);
const write = (dir, name, body) => fs.writeFileSync(path.join(dir, name), body);

test('solo log (no agent infix) is keyed under "solo"', () => inDir((dir) => {
    write(dir, 'feature-07-dark-mode-log.md', '# solo\n');
    const out = collectAgentLogs([dir], 7);
    assert.deepStrictEqual(Object.keys(out), ['solo']);
    assert.ok(out.solo.content.includes('solo'));
}));

test('Fleet logs get one entry per 2-letter agent code', () => inDir((dir) => {
    write(dir, 'feature-08-cc-x-log.md', '# cc\n');
    write(dir, 'feature-08-gg-x-log.md', '# gg\n');
    const out = collectAgentLogs([dir], 8);
    assert.deepStrictEqual(Object.keys(out).sort(), ['cc', 'gg']);
}));

test('logs over AGENT_LOG_MAX_BYTES are truncated with a path-referenced footer', () => inDir((dir) => {
    write(dir, 'feature-09-huge-log.md', 'x'.repeat(AGENT_LOG_MAX_BYTES + 1024));
    const out = collectAgentLogs([dir], 9);
    assert.ok(out.solo.content.includes('log truncated'));
    assert.ok(out.solo.content.includes(out.solo.path));
}));

test('missing Fleet log still keeps the agent in the picker with null content', () => inDir((dir) => {
    write(dir, 'feature-08-cc-x-log.md', '# cc\n');
    const out = collectAgentLogs([dir], 8, {
        cc: path.join(dir, 'feature-08-cc-x-log.md'),
        gg: path.join(dir, 'feature-08-gg-x-log.md'),
    });
    assert.deepStrictEqual(Object.keys(out).sort(), ['cc', 'gg']);
    assert.strictEqual(out.gg.content, null);
}));

test('YAML frontmatter is stripped so marked.parse does not render it', () => inDir((dir) => {
    write(dir, 'feature-10-cc-x-log.md', '---\ncommit_count: 5\ncost_usd: 9.99\n---\n# Body\n\nProse.\n');
    const out = collectAgentLogs([dir], 10);
    assert.ok(!out.cc.content.includes('commit_count'));
    assert.ok(!out.cc.content.includes('---'));
    assert.ok(out.cc.content.includes('# Body'));
}));

report();
