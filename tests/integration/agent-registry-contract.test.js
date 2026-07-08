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
const launchableIds = expectedIds.filter(id => agentRegistry.isAgentLaunchable(id));
const sortIds = ids => ids.slice().sort((a, b) => a.localeCompare(b));
const assertExactAgentSet = (actualIds, message) => assert.deepStrictEqual(sortIds(actualIds), expectedIds, message);
const assertExactLaunchableSet = (actualIds, message) => assert.deepStrictEqual(sortIds(actualIds), launchableIds, message);

test('deactivated gg resolves but is not launchable', () => {
    // REGRESSION: retiring gg must keep registry metadata for historic telemetry.
    assert.ok(agentRegistry.getAgent('gg'), 'gg should remain in registry');
    assert.strictEqual(agentRegistry.isAgentLaunchable('gg'), false);
    assert.ok(!agentRegistry.getLaunchableAgentIds().includes('gg'));
});

test('registry launchable set excludes deactivated agents', () => assertExactLaunchableSet(agentRegistry.getSortedAgentIds(), 'runtime launchable registry drifted'));
test('template helpers expose launchable vs all-known agent sets', () => {
    assertExactAgentSet(templates.getAllKnownAgents(), 'templates.getAllKnownAgents drifted');
    const available = templates.getAvailableAgents();
    assert.ok(!available.includes('gg'), 'deactivated gg must not appear in picker agents');
    for (const id of available) assert.ok(agentRegistry.isAgentLaunchable(id), `${id} must be launchable`);
    assertExactAgentSet(Object.keys(agentRegistry.getDisplayNames()), 'display names drifted');
    assertExactAgentSet(Object.keys(agentRegistry.getShortNames()).filter(id => id !== 'solo'), 'short names drifted');
});
test('downstream registry projections split all-known vs launchable', () => {
    assertExactAgentSet(Object.keys(agentRegistry.getPortOffsets()), 'port offsets drifted');
    assertExactLaunchableSet(Object.keys(agentRegistry.buildDefaultAgentConfigs()), 'default config projection drifted');
    assertExactLaunchableSet(Object.keys(agentRegistry.getAgentInstallHints()), 'install hints drifted');
    assertExactLaunchableSet(Object.keys(agentRegistry.getAgentBinMap()), 'CLI map drifted');
    assertExactAgentSet(Object.keys(agentRegistry.getLegacyAgentConfigs()), 'legacy config projection drifted');
    assertExactLaunchableSet(agentRegistry.getDashboardAgents().map(agent => agent.id), 'dashboard payload drifted');
});
test('help template renders launchable agents only', () => {
    const rendered = templates.processTemplate(fs.readFileSync(path.join(__dirname, '..', '..', 'templates', 'help.txt'), 'utf8'));
    assertExactLaunchableSet(rendered.split('\n').map(line => line.match(/^\s{2}([a-z0-9]+) \(/i)).filter(Boolean).map(match => match[1]), 'help output drifted');
});
test('dashboard bootstrap payload renders launchable agents only', () => {
    // REGRESSION: JSON may contain `;` inside string values (e.g. model label text) — do not split on the first `;`.
    const html = dashboardServer.buildDashboardHtml({ repos: [] }, 'test');
    const prefix = 'window.__AIGON_BOOTSTRAP__ = ';
    const start = html.indexOf(prefix);
    assert.ok(start >= 0, 'dashboard bootstrap was not injected');
    let i = start + prefix.length;
    assert.strictEqual(html[i], '{', 'expected JSON object after __AIGON_BOOTSTRAP__');
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
        if (c === '{') depth++;
        if (c === '}') {
            depth--;
            if (depth === 0) {
                i++;
                break;
            }
        }
    }
    const jsonStr = html.slice(start + prefix.length, i);
    const bootstrap = JSON.parse(jsonStr);
    assert.ok(Array.isArray(bootstrap.agents), 'bootstrap.agents must be an array');
    assertExactLaunchableSet(bootstrap.agents.map(agent => agent.id), 'dashboard HTML payload drifted');
});
test('every modelOptions entry satisfies the inclusion-policy contract (docs/model-inclusion-policy.md)', () => {
    // Keystone enforcement for the prose policy: each templates/agents/*.json
    // model entry must carry the §5 fields (label, lastRefreshAt, score, valid
    // pricing/notes shape) and clear the §1 modality / §5 alias hard-exclusions.
    // Whoever adds a model — maintainer by hand or curated tooling — trips here.
    const allErrors = [];
    for (const id of launchableIds) {
        const { errors } = agentRegistry.validateModelOptions(agentRegistry.getAgent(id));
        allErrors.push(...errors);
    }
    assert.deepStrictEqual(allErrors, [], `modelOptions contract violations:\n  ${allErrors.join('\n  ')}`);
});

const VALID_SUMMARY = {
    headline: 'Strong implementer with solid review chops.',
    body: 'Evidence-backed body within limits.',
    bestFor: ['implement', 'review'],
    avoidFor: ['research'],
    confidence: 'medium',
    researchedAt: '2026-07-08T07:42:00.000Z',
    sources: [{ kind: 'aigon-bench', title: 'brewboard sweep' }],
};

function modelOptWithSummary(summary) {
    return {
        id: 'test',
        cli: {
            modelOptions: [{
                value: 'test-model',
                label: 'Test Model',
                lastRefreshAt: '2026-07-08T07:42:00.000Z',
                score: { implement: 4 },
                summary,
            }],
        },
    };
}

test('validateModelOptions accepts a valid summary block', () => {
    const { errors } = agentRegistry.validateModelOptions(modelOptWithSummary(VALID_SUMMARY));
    assert.deepStrictEqual(errors, []);
});

test('validateModelOptions rejects summary missing headline', () => {
    const bad = { ...VALID_SUMMARY };
    delete bad.headline;
    const { errors } = agentRegistry.validateModelOptions(modelOptWithSummary(bad));
    assert.ok(errors.some(e => e.includes('summary.headline')));
});

test('validateModelOptions rejects invalid role in bestFor', () => {
    const bad = { ...VALID_SUMMARY, bestFor: ['implement', 'not-a-role'] };
    const { errors } = agentRegistry.validateModelOptions(modelOptWithSummary(bad));
    assert.ok(errors.some(e => e.includes('invalid role')));
});

test('validateModelOptions rejects free-form role like code review in bestFor', () => {
    const bad = { ...VALID_SUMMARY, bestFor: ['code review', 'implement'] };
    const { errors } = agentRegistry.validateModelOptions(modelOptWithSummary(bad));
    assert.ok(errors.some(e => e.includes('invalid role "code review"')));
});

test('validateModelOptions rejects headline duplicating label', () => {
    const bad = { ...VALID_SUMMARY, headline: 'Test Model' };
    const { errors } = agentRegistry.validateModelOptions(modelOptWithSummary(bad));
    assert.ok(errors.some(e => e.includes('must not duplicate label')));
});

test('validateModelOptions rejects body exceeding 500 chars', () => {
    const bad = { ...VALID_SUMMARY, body: 'x'.repeat(501) };
    const { errors } = agentRegistry.validateModelOptions(modelOptWithSummary(bad));
    assert.ok(errors.some(e => e.includes('summary.body exceeds 500 chars')));
});

test('validateModelOptions rejects invalid sources kind', () => {
    const bad = { ...VALID_SUMMARY, sources: [{ kind: 'blog-post', title: 'nope' }] };
    const { errors } = agentRegistry.validateModelOptions(modelOptWithSummary(bad));
    assert.ok(errors.some(e => e.includes('sources[0].kind')));
});

test('cc and op exemplar entries pass validateModelOptions with zero errors', () => {
    // REGRESSION: hand-written summary exemplars must not drift from the contract.
    for (const id of ['cc', 'op']) {
        const { errors } = agentRegistry.validateModelOptions(agentRegistry.getAgent(id));
        assert.deepStrictEqual(errors, [], `${id} exemplar summary drift: ${errors.join('; ')}`);
    }
});

test('validateCustomModelOptions drops custom entry with invalid summary role', () => {
    // REGRESSION: bad custom summary warns and is dropped, not blocking startup.
    const custom = [{
        value: 'local/custom-model',
        label: 'Custom Model',
        summary: { ...VALID_SUMMARY, bestFor: ['code review'] },
    }];
    const { valid, warnings } = agentRegistry.validateCustomModelOptions(custom, 'op');
    assert.deepStrictEqual(valid, []);
    assert.ok(warnings.some(w => w.includes('invalid role "code review"')));
    assert.ok(warnings.some(w => w.includes('dropped from picker')));
});

test('Amp registry contract exposes modes and quarantines large mode from picker', () => {
    const amp = agentRegistry.getAgent('am');
    assert.strictEqual(amp.cli.command, 'amp');
    assert.strictEqual(amp.cli.modelFlag, '--mode');
    assert.strictEqual(amp.capabilities.resolvesSlashCommands, false);
    assert.strictEqual(amp.capabilities.transcriptTelemetry, false);
    const pickerValues = agentRegistry.getModelOptions('am').map(o => o.value);
    assert.deepStrictEqual(pickerValues, [null, 'rush', 'smart', 'deep']);
    const allValues = agentRegistry.getModelOptions('am', { includeQuarantined: true }).map(o => o.value);
    assert.deepStrictEqual(allValues, [null, 'rush', 'smart', 'deep', 'large']);
    const dashboardAmp = agentRegistry.getDashboardAgents().find(agent => agent.id === 'am');
    assert.ok(dashboardAmp, 'Amp missing from dashboard registry projection');
    assert.deepStrictEqual(dashboardAmp.modelOptions.map(o => o.value), [null, 'rush', 'smart', 'deep']);
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
    const { cursorAgentProjectSlug, listCursorProjectSlugVariants, ensureCursorAgentWorkspaceTrustedMarkers } = agentRegistry._test;
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

test('cursor trust markers cover truncated Cursor project slug siblings', () => withTempDir('aigon-cu-trust-trunc-', tmpDir => {
    // REGRESSION: Cursor truncates long ~/.cursor/projects/<slug> dirs (worker.sock path) while
    // aigon only wrote .workspace-trusted to the full slug — F617 cu session died during indexing.
    const { cursorAgentProjectSlug, listCursorProjectSlugVariants, ensureCursorAgentWorkspaceTrustedMarkers } = agentRegistry._test;
    const projectsRoot = path.join(tmpDir, 'cursor-projects');
    const absWt = '/Users/jviner/.aigon/worktrees/aigon/feature-617-cu-model-catalog-intelligence-2026-w28';
    const fullSlug = cursorAgentProjectSlug(absWt);
    const truncatedSlug = 'Users-jviner-aigon-worktrees-aigon-feature-617-cu-mod-069e368';
    fs.mkdirSync(path.join(projectsRoot, truncatedSlug), { recursive: true });
    const variants = listCursorProjectSlugVariants(absWt, projectsRoot);
    assert.ok(variants.includes(fullSlug), 'full slug variant');
    assert.ok(variants.includes(truncatedSlug), 'truncated sibling slug variant');
    assert.ok(ensureCursorAgentWorkspaceTrustedMarkers(projectsRoot, [absWt]));
    assert.ok(fs.existsSync(path.join(projectsRoot, fullSlug, '.workspace-trusted')));
    assert.ok(fs.existsSync(path.join(projectsRoot, truncatedSlug, '.workspace-trusted')));
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
