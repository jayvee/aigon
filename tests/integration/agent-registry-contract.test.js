'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');
const agentRegistry = require('../../lib/agent-registry');
const templates = require('../../lib/templates');
const dashboardServer = require('../../lib/dashboard-server');
const { buildAgentPortMap } = require('../../lib/profile-placeholders');

const AGENTS_DIR = path.join(__dirname, '..', '..', 'templates', 'agents');
const PROFILES_PATH = path.join(__dirname, '..', '..', 'templates', 'profiles.json');
const expectedIds = fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')).sort((a, b) => a.localeCompare(b));
const sortIds = ids => ids.slice().sort((a, b) => a.localeCompare(b));
const assertExactAgentSet = (actualIds, message) => assert.deepStrictEqual(sortIds(actualIds), expectedIds, message);

test('registry file set matches runtime registry ids', () => assertExactAgentSet(agentRegistry.getSortedAgentIds(), 'runtime registry drifted from templates/agents/*.json'));
test('template helpers expose exactly the registry agent set', () => {
    assertExactAgentSet(templates.getAvailableAgents(), 'templates.getAvailableAgents drifted');
    assertExactAgentSet(Object.keys(agentRegistry.getDisplayNames()), 'display names drifted');
    assertExactAgentSet(Object.keys(agentRegistry.getShortNames()).filter(id => id !== 'solo'), 'short names drifted');
});
test('downstream registry projections expose exactly the registry agent set', () => {
    assertExactAgentSet(Object.keys(agentRegistry.getPortOffsets()), 'port offsets drifted');
    assertExactAgentSet(Object.keys(agentRegistry.buildDefaultAgentConfigs()), 'default config projection drifted');
    assertExactAgentSet(Object.keys(agentRegistry.getAgentInstallHints()), 'install hints drifted');
    assertExactAgentSet(Object.keys(agentRegistry.getAgentBinMap()), 'CLI map drifted');
    assertExactAgentSet(Object.keys(agentRegistry.getLegacyAgentConfigs()), 'legacy config projection drifted');
    assertExactAgentSet(agentRegistry.getDashboardAgents().map(agent => agent.id), 'dashboard payload drifted');
});
test('help template renders exactly the registry agents', () => {
    const rendered = templates.processTemplate(fs.readFileSync(path.join(__dirname, '..', '..', 'templates', 'help.txt'), 'utf8'));
    assertExactAgentSet(rendered.split('\n').map(line => line.match(/^\s{2}([a-z0-9]+) \(/i)).filter(Boolean).map(match => match[1]), 'help output drifted');
});
test('dashboard bootstrap payload renders exactly the registry agents', () => {
    // REGRESSION: JSON may contain `;` inside string values (e.g. model label text) — do not split on the first `;`.
    const html = dashboardServer.buildDashboardHtml({ repos: [] }, 'test');
    const prefix = 'window.__AIGON_AGENTS__ = ';
    const start = html.indexOf(prefix);
    assert.ok(start >= 0, 'dashboard payload was not injected');
    let i = start + prefix.length;
    assert.strictEqual(html[i], '[', 'expected JSON array after __AIGON_AGENTS__');
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (; i < html.length; i++) {
        const c = html[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (c === '\\' && inString) {
            escaped = true;
            continue;
        }
        if (c === '"') {
            inString = !inString;
            continue;
        }
        if (inString) continue;
        if (c === '[') depth++;
        if (c === ']') {
            depth--;
            if (depth === 0) {
                i++;
                break;
            }
        }
    }
    const jsonStr = html.slice(start + prefix.length, i);
    assertExactAgentSet(JSON.parse(jsonStr).map(agent => agent.id), 'dashboard HTML payload drifted');
});
test('parseDashboardActionRequest allows feature-delete and research-delete', () => {
    // REGRESSION: engine manual actions must pass /api/action allowlist (not only SM_INVOCABLE_ACTIONS).
    const f = dashboardServer.parseDashboardActionRequest({ action: 'feature-delete', args: ['5'] });
    assert.ok(f.ok, f.error);
    const r = dashboardServer.parseDashboardActionRequest({ action: 'research-delete', args: ['3'] });
    assert.ok(r.ok, r.error);
});
test('profile templates derive ports from basePort plus registry offsets', () => {
    const profiles = JSON.parse(fs.readFileSync(PROFILES_PATH, 'utf8'));
    ['web', 'api'].forEach(profileName => {
        assert.deepStrictEqual(profiles.profiles[profileName].devServer.ports, {}, `${profileName} still hardcodes per-agent ports`);
        assertExactAgentSet(Object.keys(buildAgentPortMap(profiles.profiles[profileName].devServer.basePort)), `${profileName} port map drifted`);
    });
});
test('cursor agent project slug and trust marker match Cursor CLI layout', () => withTempDir('aigon-cu-trust-', tmpDir => {
    // REGRESSION: Cursor Agent ignores security.workspace.trust.* and gates on ~/.cursor/projects/<slug>/.workspace-trusted.
    const { cursorAgentProjectSlug, ensureCursorAgentWorkspaceTrustedMarkers } = agentRegistry._test;
    const wt = '/Users/jviner/.aigon/worktrees/aigon/feature-425-cc-planning-context-injection-via-spec-frontmatter';
    assert.strictEqual(
        cursorAgentProjectSlug(wt),
        'Users-jviner-aigon-worktrees-aigon-feature-425-cc-planning-context-injection-via-spec-frontmatter',
        'slug drift breaks pre-trust markers'
    );
    const projectsRoot = path.join(tmpDir, 'cursor-projects');
    const absWt = path.join(tmpDir, 'wt', 'feature-425-cu-x');
    fs.mkdirSync(absWt, { recursive: true });
    assert.ok(ensureCursorAgentWorkspaceTrustedMarkers(projectsRoot, [absWt]), 'expected first write');
    const slug = cursorAgentProjectSlug(absWt);
    const marker = fs.readFileSync(path.join(projectsRoot, slug, '.workspace-trusted'), 'utf8');
    assert.ok(marker.includes(`"workspacePath": ${JSON.stringify(absWt)}`), 'marker must record absolute workspace path');
    assert.ok(!ensureCursorAgentWorkspaceTrustedMarkers(projectsRoot, [absWt]), 'idempotent second call');
}));

test('codex trust writes exact worktree sections and cleans them up', () => withTempDir('aigon-cx-trust-', tmpDir => {
    // REGRESSION: prevents cx worktree trust from only covering the parent dir and leaking stale entries on cleanup.
    const originalHome = process.env.HOME;
    const originalCwd = process.cwd();
    const repoPath = path.join(tmpDir, 'repo');
    const worktreePath = path.join(tmpDir, 'worktrees', 'feature-284-cx-test');
    fs.mkdirSync(repoPath, { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    try {
        process.env.HOME = tmpDir;
        process.chdir(repoPath);
        const trustedRepoPath = process.cwd();
        const trustedWorktreePath = path.resolve(worktreePath);
        const configPath = path.join(tmpDir, '.codex', 'config.toml');
        agentRegistry.ensureAgentTrust('cx', [trustedWorktreePath]);
        let config = fs.readFileSync(configPath, 'utf8');
        assert.ok(config.includes(`[projects."${trustedRepoPath}"]`) && config.includes(`[projects."${trustedWorktreePath}"]`), 'missing codex trust entries');
        agentRegistry.removeAgentTrust('cx', [trustedWorktreePath]);
        config = fs.readFileSync(configPath, 'utf8');
        assert.ok(config.includes(`[projects."${trustedRepoPath}"]`) && !config.includes(`[projects."${trustedWorktreePath}"]`), 'cleanup should preserve repo trust and remove worktree trust');
    } finally {
        process.chdir(originalCwd);
        process.env.HOME = originalHome;
    }
}));

report();
