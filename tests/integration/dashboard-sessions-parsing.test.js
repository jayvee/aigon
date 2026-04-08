#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { parseEnrichedTmuxSessionsOutput } = require('../../lib/worktree');

const sessions = parseEnrichedTmuxSessionsOutput([
    'farline-ai-forge-f48-do-cx-fix-ui__AIGON_SEP__1775646258__AIGON_SEP__1',
    'broken-row-without-epoch',
    'aigon-f243-review-cx-dashboard-reset-action_1775643043_0'
].join('\n'), []);

assert.equal(sessions.length, 2, 'malformed tmux rows should be skipped, not crash session parsing');
assert.equal(sessions[0].name, 'farline-ai-forge-f48-do-cx-fix-ui');
assert.equal(sessions[0].attached, true);
assert.equal(sessions[1].name, 'aigon-f243-review-cx-dashboard-reset-action');
assert.equal(sessions[1].attached, false);

console.log('  ✓ dashboard sessions parser skips malformed tmux rows');
