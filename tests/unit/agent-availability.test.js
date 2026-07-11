'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, withTempDir } = require('../_helpers');

// REGRESSION: legacy agents.<id>.disabled must resolve as availability state disabled.
test('legacy agents.<id>.disabled resolves as disabled', () => withTempDir(async (tmp) => {
    const home = path.join(tmp, 'home');
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(home, '.aigon'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.aigon'), { recursive: true });
    fs.writeFileSync(path.join(home, '.aigon', 'config.json'), JSON.stringify({
        repos: {},
        agents: { km: { disabled: true } },
        terminalApp: 'apple-terminal',
    }, null, 2));

    const prevHome = process.env.HOME;
    const prevCwd = process.cwd();
    process.env.HOME = home;
    process.chdir(repo);
    try {
        const agentAvailability = require('../../lib/agent-availability');
        agentRegistryReset();
        const avail = agentAvailability.getAgentAvailability('km', repo);
        assert.strictEqual(avail.state, 'disabled');
        assert.strictEqual(avail.usable, false);
    } finally {
        process.env.HOME = prevHome;
        process.chdir(prevCwd);
        agentRegistryReset();
    }
}));

// REGRESSION: global disabled must outrank project-level active preference (v1).
test('global disabled outranks project active', () => withTempDir(async (tmp) => {
    const home = path.join(tmp, 'home');
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(home, '.aigon'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.aigon'), { recursive: true });
    fs.writeFileSync(path.join(home, '.aigon', 'config.json'), JSON.stringify({
        repos: {},
        agents: { km: { availability: { state: 'disabled', reason: 'subscription-paused' } } },
        terminalApp: 'apple-terminal',
    }, null, 2));
    fs.writeFileSync(path.join(repo, '.aigon', 'config.json'), JSON.stringify({
        agents: { km: { availability: { state: 'active' } } },
    }, null, 2));

    const prevHome = process.env.HOME;
    const prevCwd = process.cwd();
    process.env.HOME = home;
    process.chdir(repo);
    try {
        agentRegistryReset();
        const agentAvailability = require('../../lib/agent-availability');
        const avail = agentAvailability.getAgentAvailability('km', repo);
        assert.strictEqual(avail.state, 'disabled');
        assert.strictEqual(avail.reason, 'subscription-paused');
    } finally {
        process.env.HOME = prevHome;
        process.chdir(prevCwd);
        agentRegistryReset();
    }
}));

// REGRESSION: launch paths must reject disabled agents with re-enable hint.
test('assertAgentUsable rejects disabled agent with enable hint', () => withTempDir(async (tmp) => {
    const home = path.join(tmp, 'home');
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(home, '.aigon'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.aigon'), { recursive: true });
    fs.writeFileSync(path.join(home, '.aigon', 'config.json'), JSON.stringify({
        repos: {},
        agents: { km: { availability: { state: 'disabled', reason: 'subscription-paused' } } },
        terminalApp: 'apple-terminal',
    }, null, 2));

    const prevHome = process.env.HOME;
    const prevCwd = process.cwd();
    process.env.HOME = home;
    process.chdir(repo);
    try {
        agentRegistryReset();
        const agentAvailability = require('../../lib/agent-availability');
        assert.throws(
            () => agentAvailability.assertAgentUsable('km', repo, { featureId: '42' }),
            /aigon agent enable km/
        );
    } finally {
        process.env.HOME = prevHome;
        process.chdir(prevCwd);
        agentRegistryReset();
    }
}));

// REGRESSION: historical registry lookups must still resolve retired agent ids.
test('getAgentAvailability still resolves retired registry agents for read paths', () => {
    const agentRegistry = require('../../lib/agent-registry');
    const agentAvailability = require('../../lib/agent-availability');
    const agents = agentRegistry.getAllAgents();
    const retiredLike = {
        id: 'zz-test-retired',
        name: 'Test Retired',
        displayName: 'Test Retired',
        cli: { command: 'zz-test-retired' },
        availability: { state: 'retired', message: 'test only' },
    };
    const original = agentRegistry.getAgent;
    agentRegistry.getAgent = (id) => (id === 'zz-test-retired' ? retiredLike : original(id));
    try {
        const avail = agentAvailability.getAgentAvailability('zz-test-retired', process.cwd());
        assert.strictEqual(avail.state, 'retired');
        assert.strictEqual(avail.usable, false);
    } finally {
        agentRegistry.getAgent = original;
    }
});

// REGRESSION: default fleet helper must exclude disabled agents.
test('getDefaultFleetAgents excludes disabled agents', () => withTempDir(async (tmp) => {
    const home = path.join(tmp, 'home');
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(home, '.aigon'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.aigon'), { recursive: true });
    fs.writeFileSync(path.join(home, '.aigon', 'config.json'), JSON.stringify({
        repos: {},
        agents: {},
        terminalApp: 'apple-terminal',
    }, null, 2));

    const prevHome = process.env.HOME;
    const prevCwd = process.cwd();
    process.env.HOME = home;
    process.chdir(repo);
    try {
        agentRegistryReset();
        const agentAvailability = require('../../lib/agent-availability');
        const agentRegistry = require('../../lib/agent-registry');
        const fleet = agentRegistry.getAllAgents().filter(a => a.defaultFleetAgent).map(a => a.id);
        if (fleet.length === 0) return;
        const target = fleet[0];
        agentAvailability.disableAgent(target, { reason: 'manual', scope: 'global', repoPath: repo });
        const ids = agentAvailability.getDefaultFleetAgents(repo);
        assert.ok(!ids.includes(target), `disabled fleet agent ${target} should be excluded`);
    } finally {
        process.env.HOME = prevHome;
        process.chdir(prevCwd);
        agentRegistryReset();
    }
}));

// REGRESSION: disabled/retired agents must be omitted from dashboard quota panel reads.
test('isAgentQuotaPanelVisible hides disabled and retired agents', () => withTempDir(async (tmp) => {
    const home = path.join(tmp, 'home');
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(home, '.aigon'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.aigon'), { recursive: true });
    fs.writeFileSync(path.join(home, '.aigon', 'config.json'), JSON.stringify({
        repos: {},
        agents: { km: { availability: { state: 'disabled', reason: 'prefer-other-agent' } } },
        terminalApp: 'apple-terminal',
    }, null, 2));

    const prevHome = process.env.HOME;
    const prevCwd = process.cwd();
    process.env.HOME = home;
    process.chdir(repo);
    try {
        agentRegistryReset();
        const agentAvailability = require('../../lib/agent-availability');
        assert.strictEqual(agentAvailability.isAgentQuotaPanelVisible('km', repo), false);
        assert.strictEqual(agentAvailability.isAgentQuotaPanelVisible('cc', repo), true);
        const filtered = agentAvailability.filterQuotaStateByAvailability({
            schemaVersion: 1,
            agents: {
                km: { models: { default: { verdict: 'available' } } },
                cc: { models: { default: { verdict: 'available' } } },
            },
        }, repo);
        assert.ok(!filtered.agents.km);
        assert.ok(filtered.agents.cc);
    } finally {
        process.env.HOME = prevHome;
        process.chdir(prevCwd);
        agentRegistryReset();
    }
}));

// REGRESSION F638: mutual recursion quota-probe ↔ availability must not hang or flood command -v.
test('getAgentAvailability and getDashboardAgents terminate with quota state present', () => withTempDir(async (tmp) => {
    const home = path.join(tmp, 'home');
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(home, '.aigon'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.aigon', 'state'), { recursive: true });
    fs.writeFileSync(path.join(home, '.aigon', 'config.json'), JSON.stringify({
        repos: {},
        agents: {},
        terminalApp: 'apple-terminal',
    }, null, 2));
    fs.writeFileSync(path.join(repo, '.aigon', 'state', 'agent-quota.json'), JSON.stringify({
        schemaVersion: 1,
        agents: {
            cc: { models: { __default__: { verdict: 'depleted', lastProbedAt: '2026-01-01T00:00:00.000Z' } } },
            cx: { models: { __default__: { verdict: 'available', lastProbedAt: '2026-01-01T00:00:00.000Z' } } },
        },
        providers: {},
    }, null, 2));

    const prevHome = process.env.HOME;
    const prevCwd = process.cwd();
    process.env.HOME = home;
    process.chdir(repo);
    const security = require('../../lib/security');
    const origBinary = security.isBinaryAvailable;
    security.isBinaryAvailable = () => true;
    let getAgentAvailabilityCalls = 0;
    const agentAvailability = require('../../lib/agent-availability');
    const origGetAvail = agentAvailability.getAgentAvailability;
    agentAvailability.getAgentAvailability = (...args) => {
        getAgentAvailabilityCalls += 1;
        return origGetAvail(...args);
    };
    try {
        agentRegistryReset();
        const quotaProbe = require('../../lib/quota-probe');
        const depleted = quotaProbe.isPairDepleted(repo, 'cc', null);
        assert.ok(depleted && depleted.verdict === 'depleted');
        assert.strictEqual(getAgentAvailabilityCalls, 0, 'isPairDepleted must not call getAgentAvailability');

        getAgentAvailabilityCalls = 0;
        const avail = origGetAvail('cc', repo);
        assert.ok(avail.quotaDepleted || avail.state === 'quota_depleted' || avail.quota);

        const agentRegistry = require('../../lib/agent-registry');
        const dashboard = agentRegistry.getDashboardAgents({ repoPath: repo });
        assert.ok(dashboard.length > 0);
        assert.ok(getAgentAvailabilityCalls <= dashboard.length * 2, 'no availability re-entry storm');
    } finally {
        security.isBinaryAvailable = origBinary;
        process.env.HOME = prevHome;
        process.chdir(prevCwd);
        agentRegistryReset();
    }
}));

// REGRESSION: OpenCode installs to ~/.opencode/bin — launchd/minimal PATH must still resolve op.
test('resolveAgentCliBinary finds opencode outside PATH via pathCandidates', () => {
    const agentRegistry = require('../../lib/agent-registry');
    const { resolveBinary } = require('../../lib/binary-check');
    const candidates = agentRegistry.getAgentCliPathCandidates('op');
    assert.ok(candidates.includes('~/.opencode/bin/opencode'));
    const prevPath = process.env.PATH;
    process.env.PATH = '/usr/bin:/bin';
    try {
        const resolved = resolveBinary('opencode', { candidates });
        if (fs.existsSync(path.join(os.homedir(), '.opencode', 'bin', 'opencode'))) {
            assert.strictEqual(resolved, path.join(os.homedir(), '.opencode', 'bin', 'opencode'));
        } else {
            assert.strictEqual(resolved, null);
        }
    } finally {
        process.env.PATH = prevPath;
    }
});

function agentRegistryReset() {
    try {
        const agentRegistry = require('../../lib/agent-registry');
        if (typeof agentRegistry._resetCache === 'function') agentRegistry._resetCache();
    } catch (_) { /* ignore */ }
    for (const key of Object.keys(require.cache)) {
        // config-core.js freezes GLOBAL_CONFIG_PATH at module load (F643 moved
        // agent-availability's config reads there) — evict it too, or the
        // temp-HOME override in these tests never takes effect.
        if (key.includes(`${path.sep}lib${path.sep}config.js`)
            || key.includes(`${path.sep}lib${path.sep}config-core.js`)
            || key.includes(`${path.sep}lib${path.sep}agent-availability.js`)) {
            delete require.cache[key];
        }
    }
}
