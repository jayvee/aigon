#!/usr/bin/env node
// REGRESSION feature 288: telemetry parsers must emit turns[] and contextLoadTokens
const a = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
const { parseTranscriptSession, parseGeminiSessionFile, CONTEXT_LOAD_TURNS_DEFAULT, computeContextLoadTokens } = require('../../lib/telemetry');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-telem-turns-'));

// ── CC (Claude) JSONL fixture ────────────────────────────────────────────────
const ccFixture = path.join(tmp, 'session.jsonl');
const ccLines = [
    JSON.stringify({ type: 'user', timestamp: '2026-04-01T10:00:00Z', message: { content: 'hello' } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-04-01T10:00:01Z', message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 300, cache_creation_input_tokens: 50 }, content: [] } }),
    JSON.stringify({ type: 'user', timestamp: '2026-04-01T10:00:05Z', message: { content: 'follow up' } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-04-01T10:00:06Z', message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 1200, output_tokens: 180, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 }, content: [] } }),
    JSON.stringify({ type: 'user', timestamp: '2026-04-01T10:00:10Z', message: { content: 'another' } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-04-01T10:00:11Z', message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 1500, output_tokens: 150, cache_read_input_tokens: 700, cache_creation_input_tokens: 0 }, content: [] } }),
    JSON.stringify({ type: 'user', timestamp: '2026-04-01T10:00:15Z', message: { content: 'fourth' } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-04-01T10:00:16Z', message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 1600, output_tokens: 140, cache_read_input_tokens: 800, cache_creation_input_tokens: 0 }, content: [] } }),
];
fs.writeFileSync(ccFixture, ccLines.join('\n') + '\n');

const cc = parseTranscriptSession(ccFixture);

// turns[] shape
a.ok(Array.isArray(cc.turns), 'cc: turns must be an array');
a.strictEqual(cc.turns.length, 4, 'cc: should have 4 turns (one per assistant message)');
a.strictEqual(cc.turns[0].index, 0);
a.strictEqual(cc.turns[0].inputTokens, 1000);
a.strictEqual(cc.turns[0].outputTokens, 200);
a.strictEqual(cc.turns[0].cachedInputTokens, 300);
a.strictEqual(cc.turns[1].index, 1);
a.strictEqual(cc.turns[1].inputTokens, 1200);
a.strictEqual(cc.turns[3].index, 3);

// contextLoadTokens = sum of first CONTEXT_LOAD_TURNS_DEFAULT (3) turns' inputTokens
const expectedContextLoad = cc.turns.slice(0, CONTEXT_LOAD_TURNS_DEFAULT).reduce((s, t) => s + t.inputTokens, 0);
a.strictEqual(cc.context_load_tokens, expectedContextLoad, 'cc: contextLoadTokens must sum first N turns input');
a.strictEqual(cc.context_load_tokens, 1000 + 1200 + 1500);

// Totals still correct
a.strictEqual(cc.input_tokens, 1000 + 1200 + 1500 + 1600);
a.strictEqual(cc.output_tokens, 200 + 180 + 150 + 140);

// computeContextLoadTokens helper
a.strictEqual(computeContextLoadTokens([{ inputTokens: 100 }, { inputTokens: 200 }, { inputTokens: 300 }, { inputTokens: 400 }]), 600, 'helper: default N=3');
a.strictEqual(computeContextLoadTokens([{ inputTokens: 100 }, { inputTokens: 200 }], 5), 300, 'helper: N > length clamps gracefully');
a.strictEqual(computeContextLoadTokens([], 3), 0, 'helper: empty array returns 0');

// ── Gemini JSON fixture ──────────────────────────────────────────────────────
const ggFixture = path.join(tmp, 'gemini-session.json');
fs.writeFileSync(ggFixture, JSON.stringify({
    startTime: '2026-04-01T11:00:00Z',
    lastUpdated: '2026-04-01T11:30:00Z',
    messages: [
        { type: 'user', tokens: null },
        { type: 'gemini', model: 'gemini-2.5-flash', tokens: { input: 2000, output: 300, cached: 400, thoughts: 50 } },
        { type: 'user', tokens: null },
        { type: 'gemini', model: 'gemini-2.5-flash', tokens: { input: 2500, output: 250, cached: 600, thoughts: 30 } },
    ],
}));

const { parseGeminiSessionFile: ggParse } = require('../../lib/telemetry');
const gg = ggParse(ggFixture);

a.ok(Array.isArray(gg.turns), 'gg: turns must be an array');
a.strictEqual(gg.turns.length, 2, 'gg: should have 2 turns (one per gemini message with tokens)');
a.strictEqual(gg.turns[0].inputTokens, 2000);
a.strictEqual(gg.turns[0].outputTokens, 300);
a.strictEqual(gg.turns[0].cachedInputTokens, 400);
a.strictEqual(gg.turns[1].inputTokens, 2500);
a.strictEqual(gg.context_load_tokens, 2000 + 2500, 'gg: contextLoadTokens sums first N=3 turns (only 2 exist)');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('  ✓ telemetry turns[] and contextLoadTokens tests passed');
