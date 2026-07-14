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

test('registry projections preserve known versus launchable agent sets', () => {
    assert.ok(agentRegistry.getAgent('gg'), 'deactivated agents remain readable');
    assert.strictEqual(agentRegistry.isAgentLaunchable('gg'), false);
    for (const [label, ids, expected] of [
        ['known templates', templates.getAllKnownAgents(), expectedIds],
        ['display names', Object.keys(agentRegistry.getDisplayNames()), expectedIds],
        ['port offsets', Object.keys(agentRegistry.getPortOffsets()), expectedIds],
        ['runtime IDs', agentRegistry.getSortedAgentIds(), launchableIds],
        ['dashboard IDs', agentRegistry.getDashboardAgents().map(agent => agent.id), launchableIds],
        ['binary map', Object.keys(agentRegistry.getAgentBinMap()), launchableIds],
    ]) assert.deepStrictEqual(sortIds(ids), expected, label);
    assert.ok(templates.getAvailableAgents().every(id => agentRegistry.isAgentLaunchable(id)), 'picker agents must be launchable');
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

test('validateModelOptions accepts valid summaries and rejects each invalid field', () => {
    assert.deepStrictEqual(agentRegistry.validateModelOptions(modelOptWithSummary(VALID_SUMMARY)).errors, []);
    const missingHeadline = { ...VALID_SUMMARY };
    delete missingHeadline.headline;
    for (const [summary, message] of [
        [missingHeadline, 'summary.headline'],
        [{ ...VALID_SUMMARY, bestFor: ['not-a-role'] }, 'invalid role'],
        [{ ...VALID_SUMMARY, bestFor: ['code review'] }, 'invalid role "code review"'],
        [{ ...VALID_SUMMARY, headline: 'Test Model' }, 'must not duplicate label'],
        [{ ...VALID_SUMMARY, body: 'x'.repeat(501) }, 'summary.body exceeds 500 chars'],
        [{ ...VALID_SUMMARY, sources: [{ kind: 'blog-post', title: 'nope' }] }, 'sources[0].kind'],
    ]) {
        const { errors } = agentRegistry.validateModelOptions(modelOptWithSummary(summary));
        assert.ok(errors.some(error => error.includes(message)), message);
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
