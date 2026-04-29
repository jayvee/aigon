'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { test, withTempDir, report } = require('../_helpers');
const checks = require('../../lib/aigon-eval-checks');
const runner = require('../../lib/aigon-eval-runner');
const command = require('../../lib/commands/aigon-eval');

const fixture = {
    allowedFiles: ['eval-fixture.txt'],
    expectedSignals: ['implementing', 'implementation-complete'],
    expectedFinalState: 'submitted',
    expectedFolder: '03-in-progress',
    slaSeconds: 10,
};

test('aigon-eval check matrix passes when mock agent emits expected signals', () => {
    const result = checks.runCheckMatrix({
        fixture,
        telemetryEvents: [
            { kind: 'signal-emitted', status: 'implementing', t: '2026-04-29T00:00:00.000Z', elapsedSec: 1 },
            { kind: 'signal-emitted', status: 'implementation-complete', t: '2026-04-29T00:00:04.000Z', elapsedSec: 4 },
        ],
        finalEngineSnapshot: { currentSpecState: 'submitted' },
        finalSpecPath: 'docs/specs/features/03-in-progress/feature-99-aigon-eval-fixture.md',
        gitDiff: { changedFiles: ['eval-fixture.txt'] },
        commandEvents: [{ command: 'aigon feature-do 99' }],
    });

    assert.strictEqual(result.pass, true);
    assert.strictEqual(result.checks.lifecycleSignals.pass, true);
});

test('aigon-eval fails lifecycle check when implementation-complete is skipped', () => {
    const result = checks.runCheckMatrix({
        fixture,
        telemetryEvents: [
            { kind: 'signal-emitted', status: 'implementing', t: '2026-04-29T00:00:00.000Z', elapsedSec: 1 },
        ],
        finalEngineSnapshot: { currentSpecState: 'submitted' },
        finalSpecPath: 'docs/specs/features/03-in-progress/feature-99-aigon-eval-fixture.md',
        gitDiff: { changedFiles: ['eval-fixture.txt'] },
        commandEvents: [],
    });

    assert.strictEqual(result.pass, false);
    assert.strictEqual(result.checks.lifecycleSignals.pass, false);
    assert.match(result.checks.lifecycleSignals.reason, /missing implementation-complete/);
});

test('aigon-eval fails forbidden command check when agent runs feature-close', () => {
    const result = checks.runCheckMatrix({
        fixture,
        telemetryEvents: [
            { kind: 'signal-emitted', status: 'implementing', t: '2026-04-29T00:00:00.000Z' },
            { kind: 'signal-emitted', status: 'implementation-complete', t: '2026-04-29T00:00:01.000Z' },
        ],
        finalEngineSnapshot: { currentSpecState: 'submitted' },
        finalSpecPath: 'docs/specs/features/03-in-progress/feature-99-aigon-eval-fixture.md',
        gitDiff: { changedFiles: ['eval-fixture.txt'] },
        commandEvents: [{ command: 'aigon feature-close 99' }],
    });

    assert.strictEqual(result.pass, false);
    assert.strictEqual(result.checks.forbiddenCommandGuard.pass, false);
});

test('aigon-eval writes per-run result and matrix from injected runs', async () => {
    await withTempDir('aigon-eval-', async (repo) => {
        const injectedRuns = [
            {
                telemetryEvents: [
                    { kind: 'signal-emitted', status: 'implementing', t: '2026-04-29T00:00:00.000Z' },
                    { kind: 'signal-emitted', status: 'implementation-complete', t: '2026-04-29T00:00:01.000Z' },
                ],
                finalEngineSnapshot: { currentSpecState: 'submitted' },
                finalSpecPath: 'docs/specs/features/03-in-progress/feature-99-aigon-eval-fixture.md',
                gitDiff: { changedFiles: ['eval-fixture.txt'] },
                commandEvents: [],
            },
        ];
        const { matrix, results } = await runner.runEvaluationMatrix({
            repoPath: repo,
            pairs: [{ agent: 'cx', model: 'gpt-test' }],
            workload: 'feature',
            runs: 1,
            fixture,
            injectedRuns,
        });

        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].pass, true);
        assert.ok(fs.existsSync(path.join(repo, '.aigon', 'benchmarks', 'aigon-eval', 'matrix.json')));
        assert.strictEqual(matrix.pairs[0].reliability, 100);
    });
});

test('aigon-eval quarantine updater marks and clears model options', () => {
    withTempDir('aigon-eval-', (repo) => {
        const prevCwd = process.cwd();
        process.chdir(repo);
        try {
            fs.mkdirSync(path.join(repo, 'templates', 'agents'), { recursive: true });
            fs.writeFileSync(path.join(repo, 'templates', 'agents', 'zz.json'), JSON.stringify({
                id: 'zz',
                cli: { modelOptions: [{ value: 'model-a', label: 'Model A' }] },
            }, null, 2));

            command.updateQuarantineForMatrix({
                updatedAt: '2026-04-29T00:00:00.000Z',
                pairs: [{ agent: 'zz', model: 'model-a', runs: 3, failed: 2, reliability: 33.3, failureCounts: { lifecycleSignals: 2 } }],
            }, { quiet: true });
            let data = JSON.parse(fs.readFileSync(path.join(repo, 'templates', 'agents', 'zz.json'), 'utf8'));
            assert.strictEqual(data.cli.modelOptions[0].quarantined, true);
            assert.match(data.cli.modelOptions[0].quarantineReason, /lifecycleSignals/);

            command.updateQuarantineForMatrix({
                updatedAt: '2026-04-29T01:00:00.000Z',
                pairs: [{ agent: 'zz', model: 'model-a', runs: 3, failed: 0, reliability: 100, failureCounts: {} }],
            }, { quiet: true });
            data = JSON.parse(fs.readFileSync(path.join(repo, 'templates', 'agents', 'zz.json'), 'utf8'));
            assert.strictEqual(data.cli.modelOptions[0].quarantined, undefined);
            assert.strictEqual(data.cli.modelOptions[0].aigonEvalReliability, 100);
        } finally {
            process.chdir(prevCwd);
        }
    });
});

report();
