#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, testAsync, withTempDir, withTempDirAsync, report } = require('../_helpers');
const agentQuotaRead = require('../../lib/agent-quota-read');
const agentQuotaPoller = require('../../lib/agent-quota-poller');
const budgetPoller = require('../../lib/budget-poller');

function stubBudgetPolls() {
    budgetPoller.pollClaudeBudget = async () => null;
    budgetPoller.pollCodexBudget = async () => null;
    budgetPoller.pollKimiBudget = async () => null;
    budgetPoller.pollAntigravityBudget = async () => null;
}

function stubProviderPolls() {
    const providerQuotaPoller = require('../../lib/provider-quota-poller');
    providerQuotaPoller.pollProvider = async () => ({
        entry: { verdict: 'available', lastPolledAt: new Date().toISOString() },
        changed: false,
        skipped: true,
    });
}

function writeFreshUnified(dir, ageMs = 0) {
    const polledAt = new Date(Date.now() - ageMs).toISOString();
    agentQuotaRead.writeAgentQuotaState({
        schemaVersion: 1,
        lastPollAt: polledAt,
        lastPollPhases: { budget: polledAt, probe: polledAt, provider: polledAt },
        agents: {
            cc: {
                budget: { polled_at: polledAt, session: { pct_used: 10 } },
                models: { __default__: { verdict: 'available', lastProbedAt: polledAt } },
            },
        },
        providers: {},
    }, dir);
}

test('migration merges legacy budget-cache + quota.json into agent-quota.json', () => withTempDir((dir) => {
    fs.mkdirSync(path.join(dir, '.aigon', 'state'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.aigon', 'budget-cache.json'), JSON.stringify({
        cc: { polled_at: '2026-07-01T00:00:00.000Z', session: { pct_used: 5 } },
    }));
    fs.writeFileSync(path.join(dir, '.aigon', 'state', 'quota.json'), JSON.stringify({
        schemaVersion: 2,
        agents: { cx: { models: { __default__: { verdict: 'available' } } } },
        providers: { openrouter: { verdict: 'available', balanceUsd: 10 } },
    }));

    assert.strictEqual(agentQuotaRead.mergeLegacyFiles(dir), true);
    const state = agentQuotaRead.readAgentQuotaState(dir);
    assert.strictEqual(state.schemaVersion, 1);
    assert.ok(state.agents.cc.budget);
    assert.ok(state.agents.cx.models.__default__);
    assert.ok(state.providers.openrouter);

    assert.strictEqual(agentQuotaRead.mergeLegacyFiles(dir), false);
}));

// Async poller tests share module-level in-flight state — run sequentially.
testAsync('agent-quota poller integration scenarios', async () => {
    const prevTestEnv = process.env.AIGON_QUOTA_TEST;
    process.env.AIGON_QUOTA_TEST = '1';
    const quotaProbe = require('../../lib/quota-probe');
    const origProbePairAsync = quotaProbe.probePairAsync;
    const fastProbe = async ({ modelValue, modelLabel }) => ({
        entry: {
            verdict: 'available',
            lastProbedAt: new Date().toISOString(),
            modelLabel: modelLabel || modelValue || '(agent default)',
        },
        changed: true,
        result: { ok: true, output: 'PONG' },
    });
    quotaProbe.probePairAsync = fastProbe;
    try {
        await withTempDirAsync(async (dir) => {
            writeFreshUnified(dir, 60_000);
            let spawnCount = 0;
            quotaProbe.probePairAsync = async (...args) => {
                spawnCount += 1;
                return fastProbe(...args);
            };
            agentQuotaPoller._resetForTests();
            const result = await agentQuotaPoller.runTick({ repoPath: dir, force: false, skipCacheGate: false });
            assert.strictEqual(result.skipped, true);
            assert.strictEqual(spawnCount, 0);
            quotaProbe.probePairAsync = fastProbe;
            agentQuotaPoller._resetForTests();
        });

        await withTempDirAsync(async (dir) => {
            agentQuotaPoller._resetForTests();
            stubBudgetPolls();
            stubProviderPolls();
            await agentQuotaPoller.refreshWithLock({ repoPath: dir, force: true, allModels: false });
            let rejected = false;
            try {
                await agentQuotaPoller.triggerRefresh({ repoPath: dir, force: false });
            } catch (e) {
                rejected = e && e.code === 'RATE_LIMITED';
            }
            assert.strictEqual(rejected, true);
            agentQuotaPoller._resetForTests();
        });

        await withTempDirAsync(async (dir) => {
            agentQuotaPoller._resetForTests();
            stubBudgetPolls();
            stubProviderPolls();
            let release;
            const gate = new Promise((resolve) => { release = resolve; });
            quotaProbe.probePairAsync = async (opts) => {
                await gate;
                return fastProbe(opts);
            };
            const first = agentQuotaPoller.refreshWithLock({ repoPath: dir, force: true, allModels: false });
            await new Promise(r => setTimeout(r, 50));
            let blocked = false;
            try {
                await agentQuotaPoller.triggerRefresh({ repoPath: dir, force: true });
            } catch (e) {
                blocked = e && e.code === 'REFRESH_IN_FLIGHT';
            }
            assert.strictEqual(blocked, true);
            release();
            await first;
            quotaProbe.probePairAsync = fastProbe;
            agentQuotaPoller._resetForTests();
        });

        await withTempDirAsync(async (dir) => {
            agentQuotaPoller._resetForTests();
            stubProviderPolls();
            let agCalled = false;
            const originalAg = budgetPoller.pollAntigravityBudget;
            budgetPoller.pollClaudeBudget = async () => null;
            budgetPoller.pollCodexBudget = async () => null;
            budgetPoller.pollKimiBudget = async () => null;
            budgetPoller.pollAntigravityBudget = async () => { agCalled = true; return null; };
            delete process.env.ANTIGRAVITY_TOKEN;
            await agentQuotaPoller.runTick({ repoPath: dir, force: false, skipCacheGate: true });
            assert.strictEqual(agCalled, false);
            budgetPoller.pollAntigravityBudget = originalAg;
            agentQuotaPoller._resetForTests();
        });
    } finally {
        quotaProbe.probePairAsync = origProbePairAsync;
        if (prevTestEnv == null) delete process.env.AIGON_QUOTA_TEST;
        else process.env.AIGON_QUOTA_TEST = prevTestEnv;
    }
});

test('unified poller awaits probePairAsync and runs provider phase', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../lib/agent-quota-poller.js'), 'utf8');
    assert.ok(src.includes('await quotaProbe.probePairAsync'), 'unified poller must use async probes');
    assert.ok(src.includes('providerQuotaPoller.pollProvider'), 'unified poller must refresh provider wallets');
    assert.ok(src.includes('allModels'), 'unified poller must distinguish background vs manual model probes');
});

report();
