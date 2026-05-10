'use strict';

const assert = require('assert');
const { test, report } = require('../_helpers');
const agentRegistry = require('../../lib/agent-registry');
const { _detectActiveAgentSessionCore } = require('../../lib/config');

// Real process-detection map so tests stay in sync with templates/agents/*.json
const agentProcesses = agentRegistry.getProcessDetectionMap();

function makeGetProcessInfo(chain) {
    // chain: array of { commBase, argsRaw } from nearest to farthest ancestor.
    // ppid is synthesised: each entry points to the next, last entry has ppid=1.
    const entries = chain.map((e, i) => ({
        commBase: e.commBase,
        argsRaw: e.argsRaw,
        ppid: i + 1 < chain.length ? 1000 + i + 1 : 1,
    }));
    const byPid = new Map(entries.map((e, i) => [1000 + i, e]));
    return (pid) => byPid.get(pid) || null;
}

// REGRESSION: shell wrapper false positive — the observed failure shape.
// A Codex session invokes "aigon agent-context --id-only" via a zsh wrapper.
// The wrapper's args contain "agent-context", which includes "agent" as a substring.
// Old code: argsRaw.includes('agent') fires → returns cu (wrong).
// New code: exact-commBase pass finds 'codex' at deeper depth → returns cx.
test('shell wrapper with agent-context args resolves to codex, not cursor', () => {
    const getProcessInfo = makeGetProcessInfo([
        { commBase: 'zsh', argsRaw: 'zsh -c aigon agent-context --id-only' },
        { commBase: 'codex', argsRaw: 'codex resume' },
    ]);
    const result = _detectActiveAgentSessionCore({ getProcessInfo, startPid: 1000, agentProcesses });
    assert.ok(result, 'expected a match');
    assert.strictEqual(result.agentId, 'cx', `expected cx, got ${result && result.agentId}`);
});

// Cursor exact executable: commBase === 'agent' must still resolve to cu.
test('process with commBase "agent" resolves to cursor', () => {
    const getProcessInfo = makeGetProcessInfo([
        { commBase: 'agent', argsRaw: 'agent --resume some-session' },
    ]);
    const result = _detectActiveAgentSessionCore({ getProcessInfo, startPid: 1000, agentProcesses });
    assert.ok(result, 'expected a match');
    assert.strictEqual(result.agentId, 'cu', `expected cu, got ${result && result.agentId}`);
});

// Partial-token guard: AIGON_AGENT_ID contains 'agent' as a substring but not as a standalone token.
test('AIGON_AGENT_ID in args does not produce a false cursor match', () => {
    const getProcessInfo = makeGetProcessInfo([
        { commBase: 'zsh', argsRaw: 'zsh -c echo $aigon_agent_id' },
    ]);
    const result = _detectActiveAgentSessionCore({ getProcessInfo, startPid: 1000, agentProcesses });
    assert.strictEqual(result, null, `expected null, got ${JSON.stringify(result)}`);
});

// Interpreter-wrapped agent: node launches claude via full path — fuzzy pass resolves via basename.
test('node-launched claude resolves to cc via path basename', () => {
    const getProcessInfo = makeGetProcessInfo([
        { commBase: 'node', argsRaw: 'node /usr/local/bin/claude --print do task' },
    ]);
    const result = _detectActiveAgentSessionCore({ getProcessInfo, startPid: 1000, agentProcesses });
    assert.ok(result, 'expected a match');
    assert.strictEqual(result.agentId, 'cc', `expected cc, got ${result && result.agentId}`);
});

// Exact commBase wins even when fuzzy token match appears shallower in ancestry.
test('exact commBase match at deeper depth beats fuzzy token match at shallower depth', () => {
    const getProcessInfo = makeGetProcessInfo([
        { commBase: 'zsh', argsRaw: 'zsh -c agent something' },  // 'agent' token → cu (fuzzy)
        { commBase: 'codex', argsRaw: 'codex resume' },           // exact commBase → cx
    ]);
    const result = _detectActiveAgentSessionCore({ getProcessInfo, startPid: 1000, agentProcesses });
    assert.ok(result, 'expected a match');
    assert.strictEqual(result.agentId, 'cx', `expected cx (exact), got ${result && result.agentId}`);
});

report();
