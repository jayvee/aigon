#!/usr/bin/env node
/**
 * Unit tests for lib/telemetry.js
 *
 * Runs with: node lib/telemetry.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
    PRICING,
    getModelPricing,
    computeCost,
    resolveClaudeProjectDir,
    parseTranscriptFile,
    findTranscriptFiles,
    captureFeatureTelemetry,
} = require('./telemetry');

let passed = 0;
let failed = 0;

function test(description, fn) {
    try {
        fn();
        console.log(`  ✓ ${description}`);
        passed++;
    } catch (err) {
        console.error(`  ✗ ${description}`);
        console.error(`    ${err.message}`);
        failed++;
    }
}

function group(name, fn) {
    console.log(`\n${name}`);
    fn();
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function writeTempJsonl(lines) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-telemetry-test-'));
    const file = path.join(dir, 'test-session.jsonl');
    fs.writeFileSync(file, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
    return { dir, file };
}

function cleanup(dir) {
    try { fs.rmSync(dir, { recursive: true }); } catch (_) {}
}

// ── Tests ────────────────────────────────────────────────────────────────────

group('getModelPricing', () => {
    test('returns exact match for known model', () => {
        const p = getModelPricing('claude-opus-4-6');
        assert.strictEqual(p, PRICING['claude-opus-4-6']);
    });

    test('strips date suffix to find match', () => {
        const p = getModelPricing('claude-sonnet-4-6-20260315');
        assert.strictEqual(p, PRICING['claude-sonnet-4-6']);
    });

    test('falls back to opus for unknown opus model', () => {
        const p = getModelPricing('claude-opus-99-99');
        assert.strictEqual(p, PRICING['claude-opus-4-6']);
    });

    test('falls back to haiku for unknown haiku model', () => {
        const p = getModelPricing('claude-haiku-99-99');
        assert.strictEqual(p, PRICING['claude-haiku-4-5-20251001']);
    });

    test('falls back to sonnet for completely unknown model', () => {
        const p = getModelPricing('gpt-4o');
        assert.strictEqual(p, PRICING['claude-sonnet-4-6']);
    });

    test('falls back to sonnet for null', () => {
        const p = getModelPricing(null);
        assert.strictEqual(p, PRICING['claude-sonnet-4-6']);
    });
});

group('computeCost', () => {
    test('computes cost from token counts', () => {
        const pricing = { input: 3 / 1e6, output: 15 / 1e6 };
        const cost = computeCost({
            input_tokens: 1000,
            output_tokens: 500,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
        }, pricing);
        // 1000 * 3/1e6 + 500 * 15/1e6 = 0.003 + 0.0075 = 0.0105
        assert.strictEqual(Math.round(cost * 10000) / 10000, 0.0105);
    });

    test('includes cache costs', () => {
        const pricing = { input: 3 / 1e6, output: 15 / 1e6 };
        const cost = computeCost({
            input_tokens: 0,
            output_tokens: 0,
            cache_read_input_tokens: 10000,
            cache_creation_input_tokens: 5000,
        }, pricing);
        // cache read: 10000 * 3/1e6 * 0.10 = 0.003
        // cache write: 5000 * 3/1e6 * 1.25 = 0.01875
        assert(cost > 0, 'Cost should be positive with cache tokens');
    });

    test('returns 0 for zero tokens', () => {
        const cost = computeCost({
            input_tokens: 0,
            output_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
        }, { input: 3 / 1e6, output: 15 / 1e6 });
        assert.strictEqual(cost, 0);
    });
});

group('resolveClaudeProjectDir', () => {
    test('converts path to Claude project dir format', () => {
        const result = resolveClaudeProjectDir('/Users/dev/src/myproject');
        assert(result.includes('.claude'));
        assert(result.includes('projects'));
        assert(result.includes('-Users-dev-src-myproject'));
    });
});

group('parseTranscriptFile', () => {
    test('extracts tokens from assistant messages', () => {
        const { dir, file } = writeTempJsonl([
            {
                type: 'user',
                message: { role: 'user', content: 'hello' },
            },
            {
                type: 'assistant',
                message: {
                    model: 'claude-sonnet-4-6',
                    role: 'assistant',
                    usage: {
                        input_tokens: 100,
                        output_tokens: 50,
                        cache_creation_input_tokens: 200,
                        cache_read_input_tokens: 1000,
                    },
                },
            },
            {
                type: 'assistant',
                message: {
                    model: 'claude-sonnet-4-6',
                    role: 'assistant',
                    usage: {
                        input_tokens: 150,
                        output_tokens: 75,
                        cache_creation_input_tokens: 0,
                        cache_read_input_tokens: 500,
                    },
                },
            },
        ]);

        const result = parseTranscriptFile(file);
        assert.strictEqual(result.input_tokens, 250);
        assert.strictEqual(result.output_tokens, 125);
        assert.strictEqual(result.cache_creation_input_tokens, 200);
        assert.strictEqual(result.cache_read_input_tokens, 1500);
        assert.strictEqual(result.total_tokens, 250 + 125 + 200 + 1500);
        assert.strictEqual(result.model, 'claude-sonnet-4-6');
        assert(result.cost_usd > 0, 'Cost should be positive');

        cleanup(dir);
    });

    test('handles missing file gracefully', () => {
        const result = parseTranscriptFile('/nonexistent/path.jsonl');
        assert.strictEqual(result.input_tokens, 0);
        assert.strictEqual(result.total_tokens, 0);
        assert.strictEqual(result.cost_usd, 0);
    });

    test('skips non-assistant messages', () => {
        const { dir, file } = writeTempJsonl([
            { type: 'user', message: { role: 'user' } },
            { type: 'system', message: { role: 'system' } },
            { type: 'progress', snapshot: {} },
        ]);

        const result = parseTranscriptFile(file);
        assert.strictEqual(result.total_tokens, 0);

        cleanup(dir);
    });

    test('handles malformed JSON lines', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-telemetry-test-'));
        const file = path.join(dir, 'bad.jsonl');
        fs.writeFileSync(file, 'not json\n{"type":"assistant","message":{"model":"claude-sonnet-4-6","usage":{"input_tokens":10,"output_tokens":5}}}\n');

        const result = parseTranscriptFile(file);
        assert.strictEqual(result.input_tokens, 10);
        assert.strictEqual(result.output_tokens, 5);

        cleanup(dir);
    });
});

group('captureFeatureTelemetry', () => {
    test('returns null when no transcripts found', () => {
        const result = captureFeatureTelemetry('999', 'nonexistent', {
            repoPath: '/nonexistent/repo',
        });
        assert.strictEqual(result, null);
    });

    test('computes tokens_per_line_changed when linesChanged provided', () => {
        // Create a fake Claude project dir
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-telemetry-cap-'));
        const repoPath = path.join(tmpDir, 'repo');
        const escaped = repoPath.replace(/\//g, '-');
        const claudeDir = path.join(os.homedir(), '.claude', 'projects', escaped);

        try {
            fs.mkdirSync(claudeDir, { recursive: true });
            const jsonlFile = path.join(claudeDir, 'test-session.jsonl');
            fs.writeFileSync(jsonlFile, JSON.stringify({
                type: 'assistant',
                message: {
                    model: 'claude-sonnet-4-6',
                    usage: { input_tokens: 500, output_tokens: 250, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
                },
            }) + '\n');

            const result = captureFeatureTelemetry('1', 'test', {
                repoPath,
                linesChanged: 100,
            });

            assert(result !== null, 'Should find transcript');
            assert.strictEqual(result.input_tokens, 500);
            assert.strictEqual(result.output_tokens, 250);
            assert.strictEqual(result.total_tokens, 750);
            assert.strictEqual(result.tokens_per_line_changed, 7.5);
            assert.strictEqual(result.sessions, 1);
            assert.strictEqual(result.model, 'claude-sonnet-4-6');
            assert(result.cost_usd > 0);
        } finally {
            // Clean up the fake Claude project dir
            try { fs.rmSync(claudeDir, { recursive: true }); } catch (_) {}
            cleanup(tmpDir);
        }
    });

    test('returns null tokens_per_line_changed when linesChanged is 0', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-telemetry-cap2-'));
        const repoPath = path.join(tmpDir, 'repo2');
        const escaped = repoPath.replace(/\//g, '-');
        const claudeDir = path.join(os.homedir(), '.claude', 'projects', escaped);

        try {
            fs.mkdirSync(claudeDir, { recursive: true });
            fs.writeFileSync(path.join(claudeDir, 'sess.jsonl'), JSON.stringify({
                type: 'assistant',
                message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 100, output_tokens: 50 } },
            }) + '\n');

            const result = captureFeatureTelemetry('2', 'test2', {
                repoPath,
                linesChanged: 0,
            });

            assert(result !== null);
            assert.strictEqual(result.tokens_per_line_changed, null);
        } finally {
            try { fs.rmSync(claudeDir, { recursive: true }); } catch (_) {}
            cleanup(tmpDir);
        }
    });
});

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
