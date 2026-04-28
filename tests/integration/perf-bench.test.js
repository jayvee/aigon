const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const perfBench = require('../../lib/perf-bench');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-perf-bench-'));

function writeJson(rel, obj) {
    const filePath = path.join(tmpRoot, rel);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

try {
    writeJson('.aigon/telemetry/feature-07-cx-run-a.json', {
        agent: 'cx',
        model: 'gpt-5.5',
        tokenUsage: {
            input: 1200,
            cacheReadInput: 700,
            output: 90,
            thinking: 10,
            total: 2000,
            billable: 1300,
        },
        costUsd: 0.12,
    });
    writeJson('.aigon/telemetry/feature-07-cx-run-b.json', {
        agent: 'cx',
        model: 'gpt-5.5',
        tokenUsage: {
            input: 800,
            cacheReadInput: 300,
            output: 110,
            thinking: 20,
            total: 1230,
            billable: 930,
        },
        costUsd: 0.08,
    });
    writeJson('.aigon/telemetry/feature-07-cc-run-c.json', {
        agent: 'cc',
        model: 'claude-opus-4-7',
        tokenUsage: {
            input: 999999,
            cacheReadInput: 0,
            output: 1,
            thinking: 0,
            total: 1000000,
            billable: 1000000,
        },
        costUsd: 99,
    });

    const usage = perfBench.readBenchmarkTelemetryUsage({
        repoPath: tmpRoot,
        featureId: '07',
        agentId: 'cx',
    });

    assert.ok(usage, 'expected telemetry usage');
    assert.strictEqual(usage.inputTokens, 2000);
    assert.strictEqual(usage.cachedInputTokens, 1000);
    assert.strictEqual(usage.freshInputTokens, 1000);
    assert.strictEqual(usage.outputTokens, 200);
    assert.strictEqual(usage.thinkingTokens, 30);
    assert.strictEqual(usage.totalTokens, 3230);
    assert.strictEqual(usage.billableTokens, 2230);
    assert.strictEqual(usage.sessions, 2);
    assert.strictEqual(usage.costUsd, 0.2);
    assert.strictEqual(usage.model, 'gpt-5.5');
} finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
}

console.log('perf-bench telemetry tests: ok');
