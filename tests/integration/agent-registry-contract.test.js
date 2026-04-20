'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, report } = require('../_helpers');
const agentRegistry = require('../../lib/agent-registry');
const templates = require('../../lib/templates');
const dashboardServer = require('../../lib/dashboard-server');
const { buildAgentPortMap } = require('../../lib/profile-placeholders');

const AGENTS_DIR = path.join(__dirname, '..', '..', 'templates', 'agents');
const PROFILES_PATH = path.join(__dirname, '..', '..', 'templates', 'profiles.json');

function registryFileAgentIds() {
    return fs.readdirSync(AGENTS_DIR)
        .filter(file => file.endsWith('.json'))
        .map(file => file.replace(/\.json$/, ''))
        .sort((a, b) => a.localeCompare(b));
}

function sortedRegistryIds() {
    return agentRegistry.getSortedAgentIds().slice().sort((a, b) => a.localeCompare(b));
}

function assertExactAgentSet(actualIds, expectedIds, message) {
    assert.deepStrictEqual(actualIds.slice().sort((a, b) => a.localeCompare(b)), expectedIds, message);
}

const expectedIds = registryFileAgentIds();

test('registry file set matches runtime registry ids', () => {
    assertExactAgentSet(sortedRegistryIds(), expectedIds, 'runtime registry drifted from templates/agents/*.json');
});

test('template helpers expose exactly the registry agent set', () => {
    assertExactAgentSet(templates.getAvailableAgents(), expectedIds, 'templates.getAvailableAgents drifted');
    assertExactAgentSet(Object.keys(agentRegistry.getDisplayNames()), expectedIds, 'display names drifted');
    assertExactAgentSet(Object.keys(agentRegistry.getShortNames()).filter(id => id !== 'solo'), expectedIds, 'short names drifted');
});

test('downstream registry projections expose exactly the registry agent set', () => {
    assertExactAgentSet(Object.keys(agentRegistry.getPortOffsets()), expectedIds, 'port offsets drifted');
    assertExactAgentSet(Object.keys(agentRegistry.buildDefaultAgentConfigs()), expectedIds, 'default config projection drifted');
    assertExactAgentSet(Object.keys(agentRegistry.getAgentInstallHints()), expectedIds, 'install hints drifted');
    assertExactAgentSet(Object.keys(agentRegistry.getAgentBinMap()), expectedIds, 'CLI map drifted');
    assertExactAgentSet(Object.keys(agentRegistry.getLegacyAgentConfigs()), expectedIds, 'legacy config projection drifted');
    assertExactAgentSet(agentRegistry.getDashboardAgents().map(agent => agent.id), expectedIds, 'dashboard payload drifted');
});

test('help template renders exactly the registry agents', () => {
    const rendered = templates.processTemplate(fs.readFileSync(path.join(__dirname, '..', '..', 'templates', 'help.txt'), 'utf8'));
    const helpAgentIds = rendered.split('\n')
        .map(line => line.match(/^\s{2}([a-z0-9]+) \(/i))
        .filter(Boolean)
        .map(match => match[1]);
    assertExactAgentSet(helpAgentIds, expectedIds, 'help output drifted');
});

test('dashboard bootstrap payload renders exactly the registry agents', () => {
    const html = dashboardServer.buildDashboardHtml({ repos: [] }, 'test');
    const match = html.match(/window\.__AIGON_AGENTS__ = (.+?);/);
    assert.ok(match, 'dashboard payload was not injected');
    const agents = JSON.parse(match[1]);
    assertExactAgentSet(agents.map(agent => agent.id), expectedIds, 'dashboard HTML payload drifted');
});

test('profile templates derive ports from basePort plus registry offsets', () => {
    const profiles = JSON.parse(fs.readFileSync(PROFILES_PATH, 'utf8'));
    ['web', 'api'].forEach(profileName => {
        assert.deepStrictEqual(profiles.profiles[profileName].devServer.ports, {}, `${profileName} still hardcodes per-agent ports`);
        assertExactAgentSet(Object.keys(buildAgentPortMap(profiles.profiles[profileName].devServer.basePort)), expectedIds, `${profileName} port map drifted`);
    });
});

report();
