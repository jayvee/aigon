#!/usr/bin/env node
/**
 * Unit tests for collectAgentLogs() in lib/dashboard-status-collector.
 *
 * Covers solo / Fleet keying and the 256 KB truncation footer that powers
 * the Agent Log drawer tab (feature 225).
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { test, withTempDir, report } = require('../_helpers');
const {
    collectAgentLogs,
    AGENT_LOG_MAX_BYTES,
} = require('../../lib/dashboard-status-collector');

const inLogsDir = (fn) => withTempDir('aigon-log-test-', fn);

// REGRESSION: prevents the bug where the Agent Log drawer tab would mis-key
// solo logs under a 2-letter agent id (e.g. "da" from "dark-mode") because
// the keying heuristic only looked at the first two characters instead of
// requiring a hyphen separator. See feature 225.
test('solo log without agent infix is keyed under "solo"', () => inLogsDir((dir) => {
    fs.writeFileSync(path.join(dir, 'feature-07-dark-mode-log.md'), '# solo log\n');
    const out = collectAgentLogs([dir], 7);
    assert.deepStrictEqual(Object.keys(out), ['solo']);
    assert.ok(out.solo.content.includes('solo log'));
    assert.ok(out.solo.path.endsWith('feature-07-dark-mode-log.md'));
}));

// REGRESSION: prevents Fleet logs from being collapsed into a single entry —
// each agent must get its own keyed entry so the picker can switch between
// them without re-fetching the detail payload.
test('Fleet logs are keyed by 2-letter agent code', () => inLogsDir((dir) => {
    fs.writeFileSync(path.join(dir, 'feature-08-cc-social-sharing-log.md'), '# cc log\n');
    fs.writeFileSync(path.join(dir, 'feature-08-gg-social-sharing-log.md'), '# gg log\n');
    const out = collectAgentLogs([dir], 8);
    assert.deepStrictEqual(Object.keys(out).sort(), ['cc', 'gg']);
    assert.ok(out.cc.content.includes('cc log'));
    assert.ok(out.gg.content.includes('gg log'));
}));

// REGRESSION: prevents pathological logs from bloating the /api/detail HTTP
// payload — anything over 256 KB must be truncated with a footer pointing to
// the on-disk path.
test('logs over AGENT_LOG_MAX_BYTES are truncated with a footer', () => inLogsDir((dir) => {
    const big = 'x'.repeat(AGENT_LOG_MAX_BYTES + 1024);
    fs.writeFileSync(path.join(dir, 'feature-09-huge-log.md'), big);
    const out = collectAgentLogs([dir], 9);
    assert.ok(out.solo, 'solo entry should exist');
    assert.ok(out.solo.content.includes('log truncated'),
        'truncated content must include the footer marker');
    assert.ok(out.solo.content.includes(out.solo.path),
        'footer should reference the on-disk path');
}));

test('missing feature id returns an empty object, not an error', () => inLogsDir((dir) => {
    fs.writeFileSync(path.join(dir, 'feature-08-cc-social-sharing-log.md'), '# cc\n');
    const out = collectAgentLogs([dir], 999);
    assert.deepStrictEqual(out, {});
}));

// REGRESSION: prevents partially-written Fleet features from hiding agents with
// missing log files. The payload still needs a null-content entry so the Agent
// Log tab can show the empty state without dropping that agent from the picker.
test('expected agent entries are preserved when a Fleet log is missing', () => inLogsDir((dir) => {
    fs.writeFileSync(path.join(dir, 'feature-08-cc-social-sharing-log.md'), '# cc log\n');
    const out = collectAgentLogs([dir], 8, {
        cc: path.join(dir, 'feature-08-cc-social-sharing-log.md'),
        gg: path.join(dir, 'feature-08-gg-social-sharing-log.md'),
    });
    assert.deepStrictEqual(Object.keys(out).sort(), ['cc', 'gg']);
    assert.ok(out.cc.content.includes('cc log'));
    assert.strictEqual(out.gg.content, null);
    assert.ok(out.gg.path.endsWith('feature-08-gg-social-sharing-log.md'));
}));

test('non-existent dirs are skipped silently', () => {
    const out = collectAgentLogs(['/nonexistent/path/aigon/test'], 1);
    assert.deepStrictEqual(out, {});
});

// REGRESSION: prevents the "wall of bold text" bug where telemetry YAML
// frontmatter (written by close/log workflows) rendered as a
// massive header at the top of the Agent Log tab via marked.parse().
// Log files are supposed to be pure narrative per CLAUDE.md, but the
// telemetry pipeline has historically written frontmatter anyway. The
// collector strips it before returning so the rendered output shows
// only the narrative. See 2026-04-06 incident on feature 220's log.
test('YAML frontmatter is stripped from the returned content', () => inLogsDir((dir) => {
    const body = '# Implementation Log\n\nThe narrative body goes here.\n';
    const withFrontmatter = `---\ncommit_count: 5\ncost_usd: 9.9996\nmodel: "claude-opus-4-6"\n---\n${body}`;
    fs.writeFileSync(path.join(dir, 'feature-10-cc-example-log.md'), withFrontmatter);
    const out = collectAgentLogs([dir], 10);
    assert.ok(out.cc, 'cc entry should exist');
    assert.ok(!out.cc.content.includes('commit_count'), 'frontmatter keys must be stripped');
    assert.ok(!out.cc.content.includes('---'), 'frontmatter delimiters must be stripped');
    assert.ok(out.cc.content.includes('# Implementation Log'), 'narrative body must be preserved');
    assert.ok(out.cc.content.includes('narrative body goes here'), 'narrative prose must be preserved');
}));

test('logs without frontmatter are returned unchanged', () => inLogsDir((dir) => {
    const body = '# Plain log\n\nNo frontmatter here.\n';
    fs.writeFileSync(path.join(dir, 'feature-11-cc-plain-log.md'), body);
    const out = collectAgentLogs([dir], 11);
    assert.strictEqual(out.cc.content, body);
}));

report();
