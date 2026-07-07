#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, testAsync, withTempDirAsync, report } = require('../_helpers');
const providerQuotaPoller = require('../../lib/provider-quota-poller');
const quotaProbe = require('../../lib/quota-probe');

testAsync('quota v1 state loads as schema v2 with empty providers', async () => withTempDirAsync(async (dir) => {
    const file = quotaProbe.statePath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
        schemaVersion: 1,
        agents: { op: { models: { __default__: { verdict: 'available' } } } },
    }, null, 2));

    const state = quotaProbe.readQuotaState(dir);
    assert.strictEqual(state.schemaVersion, 2);
    assert.deepStrictEqual(state.providers, {});
    assert.ok(state.agents.op);
}));

// REGRESSION: wallet balance from /credits takes precedence over key cap remaining.
testAsync('provider poll balance precedence, credits 403, and depleted', async () => {
    async function withMock(responses, fn) {
        providerQuotaPoller._setHttpGetForTests(async (url) => {
            if (url.includes('/key')) return responses.key;
            if (url.includes('/credits')) return responses.credits;
            throw new Error(`unexpected url ${url}`);
        });
        process.env.OPENROUTER_API_KEY = 'test-key';
        try {
            await fn();
        } finally {
            delete process.env.OPENROUTER_API_KEY;
            providerQuotaPoller._setHttpGetForTests(null);
        }
    }

    await withTempDirAsync(async (dir) => {
        await withMock({
            key: {
                statusCode: 200,
                body: JSON.stringify({
                    data: {
                        limit: 100,
                        limit_remaining: 74.5,
                        limit_reset: 'monthly',
                        usage_daily: 1.23,
                        usage_weekly: 4.56,
                        usage_monthly: 37.66,
                    },
                }),
            },
            credits: {
                statusCode: 200,
                body: JSON.stringify({ data: { total_credits: 20, total_usage: 7.66 } }),
            },
        }, async () => {
            const walletResult = await providerQuotaPoller.pollOpenRouter({ repoPath: dir, force: true });
            assert.strictEqual(walletResult.entry.balanceUsd, 12.34);
            assert.strictEqual(walletResult.entry.walletUsd, 12.34);
        });

        await withMock({
            key: {
                statusCode: 200,
                body: JSON.stringify({
                    data: { limit: 100, limit_remaining: 12.5, limit_reset: 'monthly', usage_daily: 0.5 },
                }),
            },
            credits: { statusCode: 403, body: '{"error":"forbidden"}' },
        }, async () => {
            const keyOnly = await providerQuotaPoller.pollOpenRouter({ repoPath: dir, force: true });
            assert.strictEqual(keyOnly.entry.walletUsd, null);
            assert.strictEqual(keyOnly.entry.balanceUsd, 12.5);
            assert.strictEqual(keyOnly.entry.verdict, 'available');
        });

        await withMock({
            key: {
                statusCode: 200,
                body: JSON.stringify({ data: { limit: 10, limit_remaining: 0, limit_reset: 'monthly' } }),
            },
            credits: { statusCode: 403, body: '' },
        }, async () => {
            const depleted = await providerQuotaPoller.pollOpenRouter({ repoPath: dir, force: true });
            assert.strictEqual(depleted.entry.verdict, 'depleted');
            assert.strictEqual(depleted.entry.balanceUsd, 0);
        });
    });
});

test('quota API route exposes providers key in error fallback', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../lib/dashboard-routes/analytics.js'), 'utf8');
    assert.ok(src.includes('providers: {}'), 'GET /api/quota error fallback must include providers');
});

test('quota poller triggers provider poll after agent probes', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../lib/quota-poller.js'), 'utf8');
    assert.ok(src.includes('providerQuotaPoller.pollAllProviders'), 'quota poller must refresh provider wallets');
});

report();
