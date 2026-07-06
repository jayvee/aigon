#!/usr/bin/env node
'use strict';

// Budget parser regression tests — covers parseClaudeStatus, parseGeminiModelUsage,
// parseGeminiFooterPlanQuota, parseKimiUsage, and stripAnsi from lib/budget-poller.js.
// Extracted from misc-command-wrapper.test.js (F506) where they were misplaced.

const assert = require('assert');
const { test, report } = require('../_helpers');
const { parseClaudeStatus, parseGeminiModelUsage, parseGeminiFooterPlanQuota, parseAntigravityUsage, parseKimiUsage, stripAnsi } = require('../../lib/budget-poller');

// REGRESSION: GET /api/budget cc — parseClaudeStatus misread 0% used when % is on progress-bar line above Resets.
test('parseClaudeStatus: new format — pct on progress-bar line above Resets', () => {
    const newFormat = `
  Current session
  ███████████████████                                38% used
  Resets 11:50am (Australia/Melbourne)

  Current week (all models)
  █                                                  2% used
  Resets May 4 at 8:59am (Australia/Melbourne)

  Current week (Sonnet only)
  █▌                                                 3% used
  Resets May 4 at 8:59am (Australia/Melbourne)
`;
    const r = parseClaudeStatus(newFormat);
    assert.strictEqual(r.session.pct_used, 38, 'session pct_used');
    assert.strictEqual(r.week_all.pct_used, 2, 'week_all pct_used');
    assert.strictEqual(r.week_sonnet.pct_used, 3, 'week_sonnet pct_used');
});

test('parseClaudeStatus: old format — pct on same line as Resets', () => {
    const oldFormat = `
  Current session
  Resets 5pm (Australia/Melbourne)    8% used

  Current week (all models)
  Resets 9am (Australia/Melbourne)████ 100% used
`;
    const r = parseClaudeStatus(oldFormat);
    assert.strictEqual(r.session.pct_used, 8, 'old-format session pct_used');
    assert.strictEqual(r.week_all.pct_used, 100, 'old-format week_all pct_used');
});

test('parseClaudeStatus: fully available — no bar, no % line — defaults to 0', () => {
    const fullFormat = `
  Current session
  Resets 5pm (Australia/Melbourne)
`;
    const r = parseClaudeStatus(fullFormat);
    assert.strictEqual(r.session.pct_used, 0, 'fully available defaults to 0% used');
});

// REGRESSION: tmux soft-wrap breaks "Resets …" mid-token → bogus resets_at ("1", "M") on dashboard.
test('parseClaudeStatus: merges soft-wrapped Resets continuation lines', () => {
    const wrappedTime = `
  Current session
  █  89% used
  Resets 1
  1:50am (Australia/Melbourne)

  Current week (all models)
  █  57% used
  Resets May
  11 at 9:05am (Australia/Melbourne)
`;
    const r = parseClaudeStatus(wrappedTime);
    assert.strictEqual(r.session.resets_at, '11:50am', 'session reset time');
    assert.strictEqual(r.session.tz, 'Australia/Melbourne');
    assert.strictEqual(r.week_all.resets_at, '9:05am');
    assert.strictEqual(r.week_all.resets_date, 'May 11');
});

// REGRESSION: truncated capture at EOF must not emit bogus resets_at ("1") — omit reset label, keep %.
test('parseClaudeStatus: drops incomplete Resets when continuation never arrives', () => {
    const raw = `
  Current session
  █  89% used
  Resets 1

  Current week (all models)
  █  57% used
  Resets M
`;
    const r = parseClaudeStatus(raw);
    assert.strictEqual(r.session.pct_used, 89);
    assert.strictEqual(r.session.resets_at, null);
    assert.strictEqual(r.week_all.pct_used, 57);
    assert.strictEqual(r.week_all.resets_at, null);
});

// REGRESSION: GET /api/budget gg — parse Gemini CLI /model "Model usage" rows (Flash / Flash Lite / Pro).
test('parseGeminiModelUsage: extracts tier pct and reset labels; Flash Lite before Flash', () => {
    assert.strictEqual(stripAnsi('\x1b[31mX\x1b[0m'), 'X', 'stripAnsi removes ANSI codes');

    const tiers = parseGeminiModelUsage(`
Model usage
│ Flash       ▬  0%   Resets: 11:15 AM (14h 41m)
│ Flash Lite  ▬  0%   Resets: 11:15 AM (14h 41m)
│ Pro         ▬  23%   Resets: 8:13 PM (23h 39m)
`);
    assert.strictEqual(tiers.length, 3);
    assert.strictEqual(tiers[2].tier, 'pro');
    assert.strictEqual(tiers[2].pct_used, 23);

    const flashFirst = parseGeminiModelUsage('Flash Lite 99%\nFlash 1%');
    assert.strictEqual(flashFirst.length, 2);
    assert.strictEqual(flashFirst[0].tier, 'flash_lite', 'Flash Lite matched before Flash');

    const indented = parseGeminiModelUsage('  x  Pro ▬▬▬  44%   Resets: 8:13 PM (1h 2m)');
    assert.strictEqual(indented.length, 1);
    assert.strictEqual(indented[0].pct_used, 44);
});

test('parseGeminiFooterPlanQuota: extracts footer-level quota pct', () => {
    const foot = parseGeminiFooterPlanQuota('sandbox  /model  quota\n  no sandbox   Auto (Gemini 3)   15% used (Limit resets in 14h 41m)');
    assert.strictEqual(foot.pct_used, 15);
});

// REGRESSION: GET /api/budget ag — parse Antigravity CLI /usage "Models & Quota" groups.
test('parseAntigravityUsage: extracts Gemini and Claude/GPT weekly headroom', () => {
    const fixture = `
└ Models & Quota
GEMINI MODELS
  Weekly Limit
    [░░░░░░░░░░░░░░░░░░░░] 0.00%
    Refreshes in 106h 54m
CLAUDE AND GPT MODELS
  Weekly Limit
    [████████████████████] 100.00%
    Quota available
`;
    const tiers = parseAntigravityUsage(fixture);
    assert.strictEqual(tiers.length, 2);
    assert.strictEqual(tiers[0].tier, 'gemini_models');
    assert.strictEqual(tiers[0].pct_used, 100);
    assert.strictEqual(tiers[0].resets_at, '106h 54m');
    assert.strictEqual(tiers[1].tier, 'claude_gpt_models');
    assert.strictEqual(tiers[1].pct_used, 0);
    assert.strictEqual(tiers[1].resets_at, 'Quota available');
});

// REGRESSION: GET /api/budget km — parse Kimi CLI /usage output.
test('parseKimiUsage: extracts tier pct remaining and reset hints', () => {
    const tiers = parseKimiUsage(`
╭────────────────────────────── API Usage ──────────────────────────────╮
│  Weekly limit  ━━━╺━━━━━━━━━━━━━━━━  85% left  (resets in 5d 1h 27m)  │
│  5h limit      ━━━╺━━━━━━━━━━━━━━━━  93% left  (resets in 3h 27m)     │
╰───────────────────────────────────────────────────────────────────────╯
`);
    assert.strictEqual(tiers.length, 2);
    assert.strictEqual(tiers[0].tier, 'weekly_limit');
    assert.strictEqual(tiers[0].label, 'Weekly limit');
    assert.strictEqual(tiers[0].pct_used, 15);
    assert.strictEqual(tiers[0].resets_at, 'resets in 5d 1h 27m');
    assert.strictEqual(tiers[1].tier, '5h_limit');
    assert.strictEqual(tiers[1].label, '5h limit');
    assert.strictEqual(tiers[1].pct_used, 7);
    assert.strictEqual(tiers[1].resets_at, 'resets in 3h 27m');
});

report();
