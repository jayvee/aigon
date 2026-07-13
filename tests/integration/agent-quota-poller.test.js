#!/usr/bin/env node
'use strict';

// REGRESSION: must be set before poller module load so PROBE_PACE_MS is zero in tests.
process.env.AIGON_QUOTA_TEST = '1';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, testAsync, withTempDirAsync, report } = require('../_helpers');
const agentQuotaRead = require('../../lib/agent-quota-read');
const agentQuotaPoller = require('../../lib/agent-quota-poller');
const budgetPoller = require('../../lib/budget-poller');

function stubBudgetPolls() {
    budgetPoller.pollClaudeBudget = async () => null;
    budgetPoller.pollCodexBudget = async () => null;
    budgetPoller.pollKimiBudget = async () => null;
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

// Async poller tests share module-level in-flight state — run sequentially.
testAsync('agent-quota poller integration scenarios', async () => {
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
            let gateEntered = false;
            const gate = new Promise((resolve) => { release = resolve; });
            quotaProbe.probePairAsync = async (opts) => {
                if (!gateEntered) {
                    gateEntered = true;
                    await gate;
                }
                return fastProbe(opts);
            };
            const first = agentQuotaPoller.refreshWithLock({ repoPath: dir, force: true, allModels: false });
            for (let i = 0; i < 100 && !gateEntered; i += 1) {
                await new Promise(r => setTimeout(r, 10));
            }
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

        // ag (Antigravity) must never be polled automatically — not on a background
        // tick, not on a forced refresh, not even with ANTIGRAVITY_TOKEN set —
        // because launching agy opens a Google sign-in tab in the user's browser.
        await withTempDirAsync(async (dir) => {
            agentQuotaPoller._resetForTests();
            stubProviderPolls();
            budgetPoller.pollClaudeBudget = async () => null;
            budgetPoller.pollCodexBudget = async () => null;
            budgetPoller.pollKimiBudget = async () => null;
            process.env.ANTIGRAVITY_TOKEN = 'test-token';
            await agentQuotaPoller.runTick({ repoPath: dir, force: true, skipCacheGate: true });
            const state = agentQuotaRead.readAgentQuotaState(dir);
            assert.strictEqual(state.agents.ag, undefined, 'agy budget must never be polled, even forced with a token');
            delete process.env.ANTIGRAVITY_TOKEN;
            agentQuotaPoller._resetForTests();
        });

        // REGRESSION: probe subprocess non-zero exit records error slice; other phases still write.
        await withTempDirAsync(async (dir) => {
            agentQuotaPoller._resetForTests();
            const budgetAt = new Date().toISOString();
            const agentRegistry = require('../../lib/agent-registry');
            const origGetAllAgents = agentRegistry.getAllAgents;
            agentRegistry.getAllAgents = () => ['cc', 'cx'].map((id) => origGetAllAgents().find((a) => a.id === id)).filter(Boolean);
            budgetPoller.pollClaudeBudget = async () => ({
                polled_at: budgetAt,
                session: { pct_used: 12, resets_at: '6pm' },
            });
            budgetPoller.pollCodexBudget = async () => null;
            budgetPoller.pollKimiBudget = async () => null;
            stubProviderPolls();
            const providerQuotaPoller = require('../../lib/provider-quota-poller');
            providerQuotaPoller.pollProvider = async () => {
                const entry = { verdict: 'available', balanceUsd: 9.5, lastPolledAt: budgetAt };
                agentQuotaRead.updateProviderEntry(dir, 'openrouter', entry);
                return { entry, changed: true, skipped: false };
            };
            quotaProbe.probePairAsync = async ({ repoPath, agentId, modelValue, modelLabel }) => {
                if (agentId === 'cc') {
                    return {
                        entry: { verdict: 'unknown', lastProbedAt: budgetAt },
                        changed: true,
                        result: { ok: false, exitCode: 1, error: 'probe subprocess failed' },
                    };
                }
                const modelKey = modelValue || '__default__';
                const entry = {
                    verdict: 'available',
                    lastProbedAt: budgetAt,
                    modelLabel: modelLabel || modelValue || '(agent default)',
                };
                agentQuotaRead.updateProbeEntry(repoPath, agentId, modelKey, entry, () => true);
                return { entry, changed: true, result: { ok: true, output: 'PONG' } };
            };
            try {
                await agentQuotaPoller.runTick({ repoPath: dir, force: true, skipCacheGate: true, allModels: false });
                const state = agentQuotaRead.readAgentQuotaState(dir);
                assert.ok(state.agents.cc.budget, 'budget phase should write cc slice');
                const ccModels = Object.values(state.agents.cc.models || {});
                assert.ok(ccModels.some((m) => m.verdict === 'error' && /probe/.test(m.lastError || '')), 'cc probe error slice');
                const cxModels = Object.values(state.agents.cx.models || {});
                assert.ok(cxModels.some((m) => m.verdict === 'available'), 'cx probe still writes available slice');
                assert.strictEqual(state.providers.openrouter.verdict, 'available');
                assert.ok(state.lastPollAt);
            } finally {
                agentRegistry.getAllAgents = origGetAllAgents;
                agentQuotaPoller._resetForTests();
            }
        });
    } finally {
        quotaProbe.probePairAsync = origProbePairAsync;
    }
});

test('unified poller awaits probePairAsync and runs provider phase', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../lib/agent-quota-poller.js'), 'utf8');
    assert.ok(src.includes('await quotaProbe.probePairAsync'), 'unified poller must use async probes');
    assert.ok(src.includes('providerQuotaPoller.pollProvider'), 'unified poller must refresh provider wallets');
    assert.ok(src.includes('allModels'), 'unified poller must distinguish background vs manual model probes');
});

report();
