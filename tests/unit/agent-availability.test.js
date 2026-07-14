'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir } = require('../_helpers');

function resetModules() {
    try { require('../../lib/agent-registry')._resetCache?.(); } catch (_) {}
    for (const key of Object.keys(require.cache)) {
        if (['config.js', 'config-core.js', 'agent-availability.js'].some(file => key.endsWith(`${path.sep}lib${path.sep}${file}`))) {
            delete require.cache[key];
        }
    }
}

function withAvailabilityConfig(tmp, { globalAgents = {}, projectAgents, quota }, fn) {
    const home = path.join(tmp, 'home');
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(home, '.aigon'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.aigon', 'state'), { recursive: true });
    fs.writeFileSync(path.join(home, '.aigon', 'config.json'), JSON.stringify({
        repos: {}, agents: globalAgents, terminalApp: 'apple-terminal',
    }));
    if (projectAgents) fs.writeFileSync(path.join(repo, '.aigon', 'config.json'), JSON.stringify({ agents: projectAgents }));
    if (quota) fs.writeFileSync(path.join(repo, '.aigon', 'state', 'agent-quota.json'), JSON.stringify(quota));
    const previous = { home: process.env.HOME, cwd: process.cwd() };
    process.env.HOME = home;
    process.chdir(repo);
    resetModules();
    try {
        return fn(require('../../lib/agent-availability'), repo);
    } finally {
        process.env.HOME = previous.home;
        process.chdir(previous.cwd);
        resetModules();
    }
}

test('legacy disabled config resolves as unusable', () => withTempDir((tmp) =>
    withAvailabilityConfig(tmp, { globalAgents: { km: { disabled: true } } }, (availability, repo) => {
        assert.deepStrictEqual(
            (({ state, usable }) => ({ state, usable }))(availability.getAgentAvailability('km', repo)),
            { state: 'disabled', usable: false }
        );
    })));

test('global disabled outranks project active', () => withTempDir((tmp) =>
    withAvailabilityConfig(tmp, {
        globalAgents: { km: { availability: { state: 'disabled', reason: 'subscription-paused' } } },
        projectAgents: { km: { availability: { state: 'active' } } },
    }, (availability, repo) => {
        const result = availability.getAgentAvailability('km', repo);
        assert.strictEqual(result.state, 'disabled');
        assert.strictEqual(result.reason, 'subscription-paused');
    })));

test('assertAgentUsable rejects disabled agent with enable hint', () => withTempDir((tmp) =>
    withAvailabilityConfig(tmp, {
        globalAgents: { km: { availability: { state: 'disabled', reason: 'subscription-paused' } } },
    }, (availability, repo) => {
        assert.throws(() => availability.assertAgentUsable('km', repo, { featureId: '42' }), /aigon agent enable km/);
    })));

test('retired registry agents remain readable but unusable', () => {
    const registry = require('../../lib/agent-registry');
    const availability = require('../../lib/agent-availability');
    const original = registry.getAgent;
    registry.getAgent = (id) => id === 'zz-test-retired'
        ? { id, name: 'Retired', cli: { command: id }, availability: { state: 'retired', message: 'test' } }
        : original(id);
    try {
        const result = availability.getAgentAvailability('zz-test-retired', process.cwd());
        assert.strictEqual(result.state, 'retired');
        assert.strictEqual(result.usable, false);
    } finally {
        registry.getAgent = original;
    }
});

test('default fleet excludes disabled agents', () => withTempDir((tmp) =>
    withAvailabilityConfig(tmp, {}, (availability, repo) => {
        const fleet = require('../../lib/agent-registry').getAllAgents().filter(a => a.defaultFleetAgent).map(a => a.id);
        if (fleet.length === 0) return;
        availability.disableAgent(fleet[0], { reason: 'manual', scope: 'global', repoPath: repo });
        if (fleet.length === 1) {
            assert.throws(() => availability.getDefaultFleetAgents(repo), error => error?.code === 'no-usable-fleet-agents');
        } else {
            assert.ok(!availability.getDefaultFleetAgents(repo).includes(fleet[0]));
        }
    })));

test('quota panel filters disabled agents', () => withTempDir((tmp) =>
    withAvailabilityConfig(tmp, {
        globalAgents: { km: { availability: { state: 'disabled', reason: 'prefer-other-agent' } } },
    }, (availability, repo) => {
        assert.strictEqual(availability.isAgentQuotaPanelVisible('km', repo), false);
        assert.strictEqual(availability.isAgentQuotaPanelVisible('cc', repo), true);
        const filtered = availability.filterQuotaStateByAvailability({
            schemaVersion: 1,
            agents: { km: { models: {} }, cc: { models: {} } },
        }, repo);
        assert.deepStrictEqual(Object.keys(filtered.agents), ['cc']);
    })));

test('quota reads do not recurse through availability', () => withTempDir((tmp) =>
    withAvailabilityConfig(tmp, {
        quota: {
            schemaVersion: 1,
            agents: {
                cc: { models: { __default__: { verdict: 'depleted', lastProbedAt: '2026-01-01T00:00:00.000Z' } } },
                cx: { models: { __default__: { verdict: 'available', lastProbedAt: '2026-01-01T00:00:00.000Z' } } },
            },
            providers: {},
        },
    }, (availability, repo) => {
        const security = require('../../lib/security');
        const originalBinary = security.isBinaryAvailable;
        const originalAvailability = availability.getAgentAvailability;
        let calls = 0;
        security.isBinaryAvailable = () => true;
        availability.getAgentAvailability = (...args) => { calls += 1; return originalAvailability(...args); };
        try {
            assert.strictEqual(require('../../lib/quota-probe').isPairDepleted(repo, 'cc', null).verdict, 'depleted');
            assert.strictEqual(calls, 0, 'quota probe must not re-enter availability');
            const dashboard = require('../../lib/agent-registry').getDashboardAgents({ repoPath: repo });
            assert.ok(dashboard.length > 0);
            assert.ok(calls <= dashboard.length * 2, 'availability calls must stay bounded');
        } finally {
            security.isBinaryAvailable = originalBinary;
            availability.getAgentAvailability = originalAvailability;
        }
    })));
