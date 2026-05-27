#!/usr/bin/env node
'use strict';

// Coverage: lib/commands/bench.js — the model inclusion-policy pipeline.
//
// Three pillars to verify:
//   1. isIrrelevantForCoding catches every modality/domain we have written
//      a rule for in docs/model-inclusion-policy.md §1.
//   2. The discovery-time filter (filterRelevantCandidates) strips those
//      candidates before they ever reach the human prompt.
//   3. Non-interactive callers never auto-approve — promptIncludeExclude
//      returns an empty array, and the pending queue is the only persistence
//      surface for unattended runs.
//
// The 2026-05-22 incident (TTS / robotics / computer-use / -latest aliases
// in the gg dropdown) was caused by perf-bench writing directly to
// templates/agents/gg.json with autoAddModels: true. These tests guard
// against a regression.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, testAsync, report, withTempDir } = require('../_helpers');

function freshBench() {
    const key = require.resolve('../../lib/commands/bench');
    delete require.cache[key];
    return require('../../lib/commands/bench');
}

// --- isIrrelevantForCoding ---

const REJECTED_BY_POLICY_PARAM_SIZE = [
    // Single-digit-B (non-MoE) — promoted to hard exclusion after Gemini review
    'openrouter/qwen/qwen-2.5-7b-instruct',
    'openrouter/meta-llama/llama-3.1-8b-instruct',
];

const REJECTED_BY_POLICY = [
    // TTS / audio
    'gemini-2.5-flash-preview-tts',
    'gemini-2.5-pro-preview-tts',
    'gemini-3.1-flash-tts-preview',
    'voxtral-small',
    'whisper-audio-1',
    'speech-to-text-v2',
    // Robotics & computer-use
    'gemini-robotics-er-1.5-preview',
    'gemini-robotics-er-1.6-preview',
    'gemini-2.5-computer-use-preview-10-2025',
    // Vision-language / image gen
    'qwen-vl-max',
    'openrouter/z-ai/glm-4.5v',
    'openrouter/z-ai/glm-4.6v',
    'gemini-2.5-flash-image',
    'gemini-3-pro-image-preview',
    'gemini-3.1-flash-image-preview',
    // Alias / mutable pointers
    'gemini-flash-latest',
    'gemini-flash-lite-latest',
    'gemini-pro-latest',
    // Superseded
    'gemini-2.0-flash-lite',
];

const ACCEPTED_BY_POLICY = [
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-3.1-pro-preview',
    'gemini-3-flash-preview',
    'openrouter/anthropic/claude-sonnet-4-6',
    'openrouter/qwen/qwen3-coder-480b-instruct',
];

for (const id of REJECTED_BY_POLICY) {
    test(`isIrrelevantForCoding rejects ${id}`, () => {
        const { isIrrelevantForCoding } = freshBench();
        assert.strictEqual(
            isIrrelevantForCoding({ value: id }), true,
            `policy must reject ${id} (TTS/robotics/image/computer-use/alias/superseded)`
        );
    });
}

for (const id of REJECTED_BY_POLICY_PARAM_SIZE) {
    test(`isIrrelevantForCoding rejects ${id} (single-digit-B param count)`, () => {
        const { isIrrelevantForCoding } = freshBench();
        assert.strictEqual(
            isIrrelevantForCoding({ value: id }), true,
            `policy §1 hard-excludes single-digit-B non-MoE models — ${id} must not reach the prompt`
        );
    });
}

// MoE models name a small active-param count in the ID but should be kept
// (e.g. qwen3-vl-30b-a3b-instruct would be filtered for VL, but a hypothetical
// non-VL MoE with -a3b is acceptable). The -a\d guard preserves them.
test('isIrrelevantForCoding keeps MoE models with -a\\d active-param suffix', () => {
    const { isIrrelevantForCoding } = freshBench();
    // Hypothetical: an MoE with 7b active params but no VL/TTS suffix
    assert.strictEqual(
        isIrrelevantForCoding({ value: 'openrouter/foo/foomodel-30b-a7b-instruct' }), false,
        'MoE active-param naming (-a7b) keeps the model eligible'
    );
});

for (const id of ACCEPTED_BY_POLICY) {
    test(`isIrrelevantForCoding accepts ${id}`, () => {
        const { isIrrelevantForCoding } = freshBench();
        assert.strictEqual(
            isIrrelevantForCoding({ value: id }), false,
            `policy must accept ${id} as eligible for the approval prompt`
        );
    });
}

// --- filterRelevantCandidates ---

test('filterRelevantCandidates strips irrelevant entries, keeps the rest', () => {
    const { filterRelevantCandidates } = freshBench();
    const input = [
        { value: 'gemini-2.5-flash' },                       // keep
        { value: 'gemini-2.5-flash-preview-tts' },           // drop
        { value: 'gemini-3.1-pro-preview' },                 // keep
        { value: 'gemini-robotics-er-1.5-preview' },         // drop
        { value: 'gemini-flash-latest' },                    // drop (alias)
    ];
    const kept = filterRelevantCandidates('gg', input);
    assert.deepStrictEqual(
        kept.map(m => m.value),
        ['gemini-2.5-flash', 'gemini-3.1-pro-preview'],
        'only coding-relevant Gemini IDs survive the filter'
    );
});

test('filterRelevantCandidates is a pure helper — empty list in, empty list out', () => {
    const { filterRelevantCandidates } = freshBench();
    assert.deepStrictEqual(filterRelevantCandidates('gg', []), []);
    assert.deepStrictEqual(filterRelevantCandidates('op', null), []);
    assert.deepStrictEqual(filterRelevantCandidates('op', undefined), []);
});

// --- Pending-models queue ---

test('appendToPendingQueue dedups by agentId+value', () => {
    withTempDir('aigon-pending-', (dir) => {
        const { appendToPendingQueue, readPendingModels } = freshBench();
        const c1 = [{ value: 'gemini-2.5-flash', label: 'F' }];
        const added1 = appendToPendingQueue(dir, 'gg', c1);
        const added2 = appendToPendingQueue(dir, 'gg', c1); // same again
        assert.strictEqual(added1, 1, 'first append writes 1 entry');
        assert.strictEqual(added2, 0, 'duplicate is suppressed');
        const data = readPendingModels(dir);
        assert.strictEqual(data.queue.length, 1, 'queue contains exactly one entry after dedup');
        assert.strictEqual(data.queue[0].agentId, 'gg');
        assert.strictEqual(data.queue[0].value, 'gemini-2.5-flash');
    });
});

test('appendToPendingQueue preserves apiData fields assessModel reads (Gemini review finding E)', () => {
    withTempDir('aigon-pending-', (dir) => {
        const { appendToPendingQueue, readPendingModels } = freshBench();
        appendToPendingQueue(dir, 'op', [{
            value: 'openrouter/foo/big-ctx-coder',
            label: 'Big Ctx Coder',
            pricing: { input: 1, output: 2 },
            apiData: {
                id: 'foo/big-ctx-coder',
                context_length: 262144,
                description: 'should be dropped',
                modality: 'should be dropped',
            },
        }]);
        const data = readPendingModels(dir);
        assert.strictEqual(data.queue.length, 1);
        // Persisted: only fields assessModel reads
        assert.deepStrictEqual(data.queue[0].apiData, {
            id: 'foo/big-ctx-coder',
            context_length: 262144,
        }, 'pending queue preserves apiData.id + context_length, drops the rest');
    });
});

test('appendToPendingQueue handles candidates without apiData', () => {
    withTempDir('aigon-pending-', (dir) => {
        const { appendToPendingQueue, readPendingModels } = freshBench();
        appendToPendingQueue(dir, 'gg', [{ value: 'gemini-2.5-flash', label: 'F' }]);
        const data = readPendingModels(dir);
        assert.strictEqual(data.queue[0].apiData, null, 'no apiData → null (not undefined, not missing)');
    });
});

test('appendToPendingQueue preserves cross-agent entries', () => {
    withTempDir('aigon-pending-', (dir) => {
        const { appendToPendingQueue, readPendingModels } = freshBench();
        appendToPendingQueue(dir, 'gg', [{ value: 'gemini-2.5-flash' }]);
        appendToPendingQueue(dir, 'op', [{ value: 'openrouter/qwen/qwen3-coder' }]);
        const data = readPendingModels(dir);
        assert.strictEqual(data.queue.length, 2);
        const agentIds = data.queue.map(e => e.agentId).sort();
        assert.deepStrictEqual(agentIds, ['gg', 'op']);
    });
});

test('readPendingModels handles missing file gracefully', () => {
    withTempDir('aigon-pending-', (dir) => {
        const { readPendingModels } = freshBench();
        const data = readPendingModels(dir);
        assert.deepStrictEqual(data, { queue: [] });
    });
});

test('readPendingModels handles corrupt JSON gracefully', () => {
    withTempDir('aigon-pending-', (dir) => {
        const aigonDir = path.join(dir, '.aigon');
        fs.mkdirSync(aigonDir, { recursive: true });
        fs.writeFileSync(path.join(aigonDir, 'pending-models.json'), '{not json');
        const { readPendingModels } = freshBench();
        const data = readPendingModels(dir);
        assert.deepStrictEqual(data, { queue: [] });
    });
});

// --- Non-interactive contract ---

testAsync('promptIncludeExclude returns [] in non-interactive mode (policy §6)', async () => {
    const { promptIncludeExclude } = freshBench();
    // Use a candidate that would have passed every assessment heuristic so we
    // know the empty return is the policy gate, not a soft signal.
    const candidates = [
        { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', pricing: { input: 0.15, output: 0.6 } },
    ];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = () => true;
    try {
        const approved = await promptIncludeExclude('gg', candidates, { nonInteractive: true });
        assert.deepStrictEqual(approved, [], 'non-interactive mode never auto-approves');
    } finally {
        process.stdout.write = origWrite;
    }
});

// --- buildRegistryEntry shape ---

test('buildRegistryEntry produces a policy-compliant entry', () => {
    const { buildRegistryEntry } = freshBench();
    const entry = buildRegistryEntry({
        value: 'gemini-2.5-flash',
        label: 'Gemini 2.5 Flash',
        pricing: { input: 0.15, output: 0.6 },
        autoNotes: 'Cost-effective Flash variant.',
    });
    assert.strictEqual(entry.value, 'gemini-2.5-flash');
    assert.strictEqual(entry.label, 'Gemini 2.5 Flash');
    assert.deepStrictEqual(entry.pricing, { input: 0.15, output: 0.6 });
    assert.deepStrictEqual(entry.score, { implement: null }, 'never-benched models start at score.implement: null');
    assert.match(entry.lastRefreshAt, /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
    assert.deepStrictEqual(entry.notes, { implement: 'Cost-effective Flash variant.' });
});

test('buildRegistryEntry omits pricing/notes when absent', () => {
    const { buildRegistryEntry } = freshBench();
    const entry = buildRegistryEntry({ value: 'x', label: 'X' });
    assert.ok(!('pricing' in entry), 'no pricing key when not supplied');
    assert.ok(!('notes' in entry), 'no notes key when no autoNotes');
});

// --- Static guard: gg.json must not currently contain rejected IDs ---
//
// This test exists so a future bypass can't silently re-pollute the registry.
// If you intentionally want a new ID type in modelOptions, update the policy
// (and isIrrelevantForCoding) in the same PR.

test('templates/agents/gg.json contains no policy-rejected model IDs', () => {
    const { isIrrelevantForCoding } = freshBench();
    const ggPath = path.join(__dirname, '..', '..', 'templates', 'agents', 'gg.json');
    const gg = JSON.parse(fs.readFileSync(ggPath, 'utf8'));
    const opts = gg.cli?.modelOptions || [];
    const offenders = opts
        .filter(o => o && o.value)
        .filter(o => isIrrelevantForCoding({ value: o.value }))
        .map(o => o.value);
    assert.deepStrictEqual(
        offenders, [],
        `gg.json contains models the inclusion policy rejects: ${offenders.join(', ')}`
    );
});

test('templates/agents/op.json contains no policy-rejected model IDs', () => {
    const { isIrrelevantForCoding } = freshBench();
    const opPath = path.join(__dirname, '..', '..', 'templates', 'agents', 'op.json');
    if (!fs.existsSync(opPath)) return; // op may not be present in all checkouts
    const op = JSON.parse(fs.readFileSync(opPath, 'utf8'));
    const opts = op.cli?.modelOptions || [];
    const offenders = opts
        .filter(o => o && o.value && !o.quarantined && !o.archived)
        .filter(o => isIrrelevantForCoding({ value: o.value }))
        .map(o => o.value);
    assert.deepStrictEqual(
        offenders, [],
        `op.json contains active models the inclusion policy rejects: ${offenders.join(', ')}`
    );
});

report();
