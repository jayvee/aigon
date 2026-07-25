'use strict';

/**
 * REGRESSION: latest run per (benchmark kind, agent, model) and stable row order
 * when pairing perf-bench JSON under `.aigon/benchmarks/`.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ba = require('../../lib/benchmark-artifacts');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-bench-artifacts-'));

function writeJson(rel, obj) {
    const dir = path.dirname(path.join(tmpRoot, rel));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, rel), JSON.stringify(obj) + '\n', 'utf8');
}

try {
    writeJson('.aigon/benchmarks/brewboard-07-2026-04-28T10-00-00-000Z.json', {
        seed: 'brewboard',
        featureId: '07',
        agent: 'cc',
        model: 'm-old',
        totalMs: 100,
        timestamp: '2026-04-28T10:00:00.000Z',
        ok: true,
        phases: [{ name: 'cli-start', ms: 10 }],
        aigonVersion: '1.0.0',
    });
    writeJson('.aigon/benchmarks/brewboard-07-2026-04-28T12-00-00-000Z.json', {
        seed: 'brewboard',
        featureId: '07',
        agent: 'cc',
        model: 'm-old',
        totalMs: 50,
        timestamp: '2026-04-28T12:00:00.000Z',
        ok: true,
        phases: [],
        tokenUsage: {
            inputTokens: 1200,
            cachedInputTokens: 700,
            freshInputTokens: 500,
            outputTokens: 90,
            thinkingTokens: 10,
            totalTokens: 2000,
            billableTokens: 1300,
            sessions: 1,
            costUsd: 0.12,
        },
        quality: {
            score: 8.5,
            summary: 'Solid implementation.',
            judge: { agentId: 'cx', model: 'gpt-5.4' },
        },
        aigonVersion: '1.0.0',
    });
    writeJson('.aigon/benchmarks/brewboard-review-08-2026-04-28T11-00-00-000Z.json', {
        seed: 'brewboard-review',
        featureId: '08',
        agent: 'cc',
        model: 'm-old',
        totalMs: 200,
        timestamp: '2026-04-28T11:00:00.000Z',
        ok: false,
        phases: [{ name: 'agent-work', ms: 99 }],
        aigonVersion: '1.0.0',
    });
    writeJson('.aigon/benchmarks/brewboard-07-2026-04-28T09-00-00-000Z.json', {
        seed: 'brewboard',
        featureId: '07',
        agent: 'gg',
        model: null,
        totalMs: 999,
        timestamp: '2026-04-28T09:00:00.000Z',
        ok: true,
        aigonVersion: '1.0.0',
    });

    const matrix = ba.buildLatestMatrix(tmpRoot);
    assert.strictEqual(matrix.kinds.length, 2);
    const rowCc = matrix.rows.find((r) => r.agentId === 'cc' && r.modelValue === 'm-old');
    assert.ok(rowCc, 'expected cc / m-old row');
    assert.strictEqual(rowCc.cells.implement.totalMs, 50, 'implement cell picks latest timestamp');
    assert.strictEqual(rowCc.cells.implement.tokenUsage.freshInputTokens, 500);
    assert.strictEqual(rowCc.cells.implement.tokenUsage.outputTokens, 90);
    assert.strictEqual(rowCc.cells.implement.quality.score, 8.5);
    assert.strictEqual(rowCc.cells.review.totalMs, 200);
    assert.strictEqual(rowCc.cells.review.ok, false);

    const rowGg = matrix.rows.find((r) => r.agentId === 'gg' && r.modelValue == null);
    assert.ok(rowGg);
    assert.strictEqual(rowGg.cells.implement.totalMs, 999);

    const keys = matrix.rows.map((r) => ba._pairKey(r.agentId, r.modelValue));
    // REGRESSION: duplicate (agent, model) rows; ordering follows OSS registry (not plain locale sort).
    assert.strictEqual(new Set(keys).size, keys.length, 'row keys must be unique');

    assert.strictEqual(ba.matchKind({ seed: 'brewboard', featureId: '99' }), null);
} finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
}

console.log('benchmark-artifacts tests: ok');
