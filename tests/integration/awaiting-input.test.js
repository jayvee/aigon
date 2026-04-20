#!/usr/bin/env node
// REGRESSION feature 285: `aigon agent-status awaiting-input "<msg>"` sets a per-agent
// { awaitingInput: { message, at } } flag the dashboard renders as a pulsing badge.
// Overwrites on re-write, clears on any other status write, clears on dead tmux.
'use strict';
const a = require('assert'), fs = require('fs'), path = require('path');
const { test, withTempDir, report } = require('../_helpers');
const ast = require('../../lib/agent-status'), sup = require('../../lib/supervisor');
const rj = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const sp = (r, i, g, x = 'feature') => path.join(r, '.aigon', 'state', `${x}-${i}-${g}.json`);
test('awaiting-input: write/overwrite/clear/stale-session', () => withTempDir('aigon-ai-', (r) => {
    ast.writeAwaitingInput(r, '01', 'cc', 'Pick 1,2,3');
    a.strictEqual(rj(sp(r, '01', 'cc')).awaitingInput.message, 'Pick 1,2,3');
    ast.writeAwaitingInput(r, '01', 'cc', 'New q'); a.strictEqual(rj(sp(r, '01', 'cc')).awaitingInput.message, 'New q');
    ast.writeAwaitingInput(r, '01', 'cc', ''); a.strictEqual(rj(sp(r, '01', 'cc')).awaitingInput, undefined);
    ast.writeAwaitingInput(r, '01', 'cc', 'again'); ast.writeAgentStatusAt(r, '01', 'cc', { status: 'implementing' });
    a.strictEqual(rj(sp(r, '01', 'cc')).awaitingInput, undefined, 'implementing clears');
    ast.writeAwaitingInput(r, '01', 'cc', 'q'); ast.writeAgentStatusAt(r, '01', 'cc', { status: 'waiting' });
    a.strictEqual(rj(sp(r, '01', 'cc')).awaitingInput, undefined, 'waiting clears');
    ast.writeAwaitingInput(r, '07', 'cc', 'synthesis pause', 'research');
    fs.mkdirSync(path.join(r, '.aigon', 'workflows', 'research', '07'), { recursive: true });
    sup.sweepEntity(r, 'research', '07', { agents: { cc: { status: 'running' } }, lifecycle: 'in-progress' }, {});
    a.strictEqual(rj(sp(r, '07', 'cc', 'research')).awaitingInput, undefined, 'dead tmux clears');
}));
report();
