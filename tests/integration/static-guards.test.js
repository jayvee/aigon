#!/usr/bin/env node
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const { implAgentReadyForAutonomousClose } = require('../../lib/feature-autonomous');
const { test, withTempDir, withRepoCwd, report } = require('../_helpers');
// REGRESSION F538: dashboard registry must read dashboard-runtime.json via AIGON_HOME, not lsof on 4100.
test('getServerRegistryEntry uses dashboard-runtime.json scoped to AIGON_HOME', () => {
    const infra = fs.readFileSync(path.join(__dirname, '../../lib/commands/infra.js'), 'utf8');
    const block = infra.match(/function getServerRegistryEntry\(\) \{[\s\S]*?\n    \}/);
    assert.ok(block, 'getServerRegistryEntry must exist');
    assert.ok(block[0].includes('getDashboardRuntimeEntry'));
    assert.ok(!block[0].includes('lsof'));
});
test('static guards: home.html stays GA4-free and lib/pro.js ignores project config', () => {
    const html = fs.readFileSync(path.join(__dirname, '../../site/public/home.html'), 'utf8');
    const pro = fs.readFileSync(require.resolve('../../lib/pro.js'), 'utf8');
    assert.ok(!html.includes('G-XXXXXXXXXX') && !html.includes('googletagmanager.com'));
    assert.ok(!/loadProjectConfig|require\(['"]\.\/config['"]\)/.test(pro));
});
// REGRESSION F594: default dashboard e2e bootstrap must fence mock-only runs.
test('dashboard e2e mock bootstrap strips model overrides and forces mock agent bin', () => {
    const { stripLiveAgentEnv, buildMockOnlyDashEnv, buildHostAgentEnv, MOCK_AGENT_BIN_PATH } = require('../dashboard-e2e/e2e-env');
    const stripped = stripLiveAgentEnv({
        AIGON_CC_IMPLEMENT_MODEL: 'claude-opus-4-8',
        AIGON_TEST_MODEL_CC: 'claude-opus-4-8',
        MOCK_AGENT_BIN: '/tmp/evil',
        PATH: '/usr/bin',
    });
    assert.ok(!('AIGON_CC_IMPLEMENT_MODEL' in stripped));
    assert.ok(!('AIGON_TEST_MODEL_CC' in stripped));
    assert.ok(!('MOCK_AGENT_BIN' in stripped));
    const dash = buildMockOnlyDashEnv({ PORT: '4201' });
    assert.strictEqual(dash.AIGON_TEST_MODE, '1');
    assert.strictEqual(dash.MOCK_AGENT_BIN, MOCK_AGENT_BIN_PATH);
    const host = buildHostAgentEnv({
        HOME: '/real-home',
        AIGON_HOME: '/tmp/e2e-home',
        AIGON_TEST_MODE: '1',
        MOCK_AGENT_BIN: '/tmp/mock',
        TMUX_TMPDIR: '/tmp/tmux',
    });
    assert.strictEqual(host.HOME, '/real-home');
    assert.ok(!('AIGON_HOME' in host));
    assert.ok(!('AIGON_TEST_MODE' in host));
    assert.ok(!('MOCK_AGENT_BIN' in host));
    assert.ok(!('TMUX_TMPDIR' in host));
    const setup = fs.readFileSync(path.join(__dirname, '../dashboard-e2e/bootstrap.js'), 'utf8');
    assert.ok(setup.includes('isLiveAgentRun()'), 'bootstrap must reject AIGON_E2E_REAL on default path');
});
// REGRESSION: dashboard e2e servers use the fixed `aigon` app id and an
// ephemeral port. They must never rewrite the real aigon.localhost Caddy route.
test('server start/restart gates Caddy proxy writes for e2e dashboard servers', () => {
    const infra = fs.readFileSync(path.join(__dirname, '../../lib/commands/infra.js'), 'utf8');
    assert.ok(infra.includes("const isE2eServer = process.env.AIGON_E2E_SERVER === '1';"));
    const guarded = (infra.match(/proxyAvailable:\s*!isE2eServer && isProxyAvailable\(\)/g) || []).length;
    assert.strictEqual(guarded, 2, 'server start and restart launch paths must both be e2e-gated');
});
// REGRESSION: F286 mode-conditional implementation logs (fleet-only + skip copy).
test('implementation logging policy', () => {
    const pp = require('../../lib/profile-placeholders');
    assert.strictEqual(pp.resolveImplementationLogVariant('drive', undefined), 'skip');
    assert.strictEqual(pp.resolveImplementationLogVariant('drive', 'always'), 'full');
    assert.strictEqual(pp.shouldWriteImplementationLogStarter({ mode: 'drive', loggingLevel: 'fleet-only' }), false);
    const r = pp.resolveLoggingPlaceholders('full', { implementationLogMode: 'drive', loggingLevel: 'fleet-only', projectConfig: {} });
    assert.ok(r.LOGGING_SECTION.includes('No implementation log'));
});
// REGRESSION: AutoConductor solo `feature-close` used to stall after code review when the
// implementer status was 'feedback-addressed' — the close gate only counted ready/submitted.
test('autonomous close gate: feedback-addressed and per-agent file bridge snapshot lag', () => withTempDir('aigon-fauto-gate-', (repo) => {
    const snap = { agents: { cc: { status: 'feedback-addressed' } } };
    assert.ok(implAgentReadyForAutonomousClose(snap, 'cc', '1', repo), 'snapshot terminal state');
    const d = path.join(repo, '.aigon', 'state');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'feature-01-cc.json'), JSON.stringify({ status: 'feedback-addressed' }, null, 2));
    const snapLag = { agents: { cc: { status: 'implementing' } } };
    assert.ok(implAgentReadyForAutonomousClose(snapLag, 'cc', '1', repo), 'per-agent file when snapshot lags');
    const snapSolo = { agents: { solo: { status: 'ready' } } };
    assert.ok(implAgentReadyForAutonomousClose(snapSolo, 'cu', '1', repo), 'solo engine slot bridges concrete --agents id');
}));
// REGRESSION: F313 banner used querySelector('#agent-picker .modal-card') but the modal is .modal-box — banner never rendered.
test('agent picker recommendation banner mounts in index.html (no phantom .modal-card)', () => {
    const idx = fs.readFileSync(path.join(__dirname, '../../templates/dashboard/index.html'), 'utf8');
    const picker = fs.readFileSync(path.join(__dirname, '../../templates/dashboard/js/actions-picker.js'), 'utf8');
    assert.ok(idx.includes('id="agent-picker-recommendation"'));
    assert.ok(idx.includes('id="autonomous-picker-recommendation"'));
    assert.ok(!picker.includes("querySelector('#agent-picker .modal-card')"));
    assert.ok(picker.includes("getElementById(mountId || 'agent-picker-recommendation')"));
});
// REGRESSION: Start Autonomously reviewer row must reuse the same triplet wiring as implement rows (spec recommendations + localStorage), not dead selects.
test('autonomous reviewer triplet uses recommendation and tripletStorage like implement rows', () => {
    const picker = fs.readFileSync(path.join(__dirname, '../../templates/dashboard/js/actions-picker.js'), 'utf8');
    const block = picker.match(/function updateReviewerTripletSelects\([\s\S]*?\n}\n\n\/\/ Convert picker triplets/);
    assert.ok(block, 'updateReviewerTripletSelects block present');
    const body = block[0];
    assert.ok(body.includes('getRecommendedValue(agent.id, \'model\')'), 'reviewer model select applies spec recommendation');
    assert.ok(body.includes('tripletStorage.read(agent.id)'), 'reviewer model select reads last-used triplet');
    assert.ok(body.includes('getRecommendedValue(agent.id, \'effort\')'), 'reviewer effort select applies spec recommendation');
    assert.ok(body.includes('tripletStorage.write(agent.id, { effort:'), 'reviewer effort persists');
    const idx = fs.readFileSync(path.join(__dirname, '../../templates/dashboard/index.html'), 'utf8');
    assert.ok(idx.includes('id="autonomous-review-triplet-hint"'), 'autonomous reviewer hint documents picker parity');
});
// REGRESSION: set-conductor spawns per-feature AutoConductor via tmux; wrong aigon-cli path exits immediately (no review/close).
test('AutoConductor loop cmd targets repo-root aigon-cli', () => {
    const p = path.join(__dirname, '../../lib/feature-autonomous.js');
    const content = fs.readFileSync(p, 'utf8');
    assert.ok(
        !content.includes("path.join(__dirname, '..', '..', 'aigon-cli.js')"),
        'inner __run-loop must use lib/../aigon-cli.js not ../../ (parent of repo)',
    );
});
// REGRESSION: feature 307 bans blanket staging in aigon-owned commit paths.
test('aigon-owned commit paths avoid git add -A and git add .', () => {
    const repoRoot = path.join(__dirname, '../..');
    ['lib/feature-close.js', 'lib/worktree.js', 'lib/commands/setup.js', 'lib/commands/setup-legacy.js'].forEach(relPath => {
        const content = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
        assert.ok(!content.includes('git add -A'));
        assert.ok(!/git add \.(?:["'`\s]|$)/.test(content));
    });
});
// REGRESSION F332: feature-do template renders SET_CONTEXT_SECTION placeholder with/without set: frontmatter.
test('feature-do template: SET_CONTEXT_SECTION renders non-empty for set-tagged spec (cx path)', () => {
    const { resolveCxCommandBody } = require('../../lib/agent-prompt-resolver');
    const withSet = resolveCxCommandBody('feature-do', '07', 'cx', { SET_CONTEXT_SECTION: '## Step 2.5: Set context (`my-set`)\n\nRead sibling logs.' });
    assert.ok(withSet.includes('Step 2.5') && withSet.includes('my-set'), 'SET_CONTEXT_SECTION should be interpolated');
    const withoutSet = resolveCxCommandBody('feature-do', '07', 'cx', { SET_CONTEXT_SECTION: '' });
    assert.ok(!withoutSet.includes('SET_CONTEXT_SECTION'), 'empty placeholder should be collapsed by processTemplate');
    assert.ok(!withoutSet.includes('Step 2.5'), 'no set context section for standalone feature');
});
// REGRESSION F332: set context must list the feature-<N>-*-log.md glob so Fleet sibling logs are not collapsed to one arbitrary file.
test('feature-do set context points at per-feature log globs', () => withTempDir('aigon-set-context-', (repo) => withRepoCwd(repo, () => {
    const doneDir = path.join(repo, 'docs', 'specs', 'features', '05-done');
    const inProgressDir = path.join(repo, 'docs', 'specs', 'features', '03-in-progress');
    fs.mkdirSync(doneDir, { recursive: true });
    fs.mkdirSync(inProgressDir, { recursive: true });
    fs.writeFileSync(path.join(doneDir, 'feature-07-alpha.md'), '---\nset: launch-flow\n---\n# Alpha\n');
    fs.writeFileSync(path.join(inProgressDir, 'feature-08-beta.md'), '---\nset: launch-flow\n---\n# Beta\n');

    const { buildSetContextSection } = require('../../lib/feature-do');
    const section = buildSetContextSection('launch-flow');
    assert.ok(section.includes('./docs/specs/features/logs/feature-07-*-log.md'), 'done sibling should use glob pattern');
    assert.ok(!section.includes('feature-07-cc-') && !section.includes('no log found'), 'should not collapse to one discovered log');
})));
// REGRESSION F332: LOGGING_SECTION constants use Step 4.5 and do not say "AFTER submit".
test('LOGGING_SECTION constants: Step 4.5 label, no AFTER-submit wording', () => {
    const pp = require('../../lib/profile-placeholders');
    for (const variant of ['full', 'fleet', 'minimal']) {
        const { LOGGING_SECTION } = pp.resolveLoggingPlaceholders('full', {
            implementationLogMode: variant === 'fleet' ? 'fleet' : variant === 'minimal' ? 'drive' : 'drive-wt',
            loggingLevel: variant === 'minimal' ? 'always' : undefined,
            projectConfig: {},
        });
        // These variants produce a real logging section
        if (LOGGING_SECTION.includes('Step')) {
            assert.ok(LOGGING_SECTION.includes('Step 4.5'), `${variant} should use Step 4.5`);
            assert.ok(!LOGGING_SECTION.includes('AFTER submit') && !LOGGING_SECTION.includes('do this AFTER'), `${variant} must not say AFTER submit`);
        }
    }
});
// REGRESSION F417: clean-room cred injection helper must parse and fail closed without container id.
test('docker-inject-creds.sh parses (bash -n) and exits non-zero with no args', () => {
    const sh = path.join(__dirname, '../../scripts/docker-inject-creds.sh');
    const syn = spawnSync('bash', ['-n', sh], { encoding: 'utf8' });
    assert.strictEqual(syn.status, 0, syn.stderr || '');
    const noArgs = spawnSync('bash', [sh], { encoding: 'utf8' });
    assert.notStrictEqual(noArgs.status, 0);
    assert.ok(String(noArgs.stderr + noArgs.stdout).includes('Usage'));
});
// REGRESSION F420: Pro benchmark matrix wiring is OSS-thin — script tag, settings mount, asset proxy.
// Pro owns the data + UI; OSS must NOT register /api/benchmarks/latest.
test('dashboard wires benchmark settings placeholder (script order + Pro asset proxy + no OSS API)', () => {
    const idx = fs.readFileSync(path.join(__dirname, '../../templates/dashboard/index.html'), 'utf8');
    const iBench = idx.indexOf('/js/benchmark-matrix.js');
    const iSettings = idx.indexOf('/js/settings.js');
    assert.ok(iBench > 0 && iSettings > iBench, 'benchmark-matrix.js must precede settings.js');
    const ds = fs.readFileSync(path.join(__dirname, '../../lib/dashboard-server.js'), 'utf8');
    assert.ok(ds.includes("reqPath === '/js/benchmark-matrix.js'"), 'dashboard-server must serve /js/benchmark-matrix.js via resolveProDashboardAsset');
    const settings = fs.readFileSync(path.join(__dirname, '../../templates/dashboard/js/settings.js'), 'utf8');
    assert.ok(settings.includes("addSection('perf-benchmarks'"), 'settings.js must add the perf-benchmarks section');
    assert.ok(settings.includes('AigonProBenchmarkMatrix'), 'settings.js must mount via window.AigonProBenchmarkMatrix');
    assert.ok(!settings.includes('aigon perf-bench'), 'OSS settings copy must not tell users to run removed perf-bench command');
    const cfg = fs.readFileSync(path.join(__dirname, '../../lib/dashboard-routes/config.js'), 'utf8');
    assert.ok(!cfg.includes('/api/benchmarks'), 'OSS must not register /api/benchmarks — Pro owns it via pro-bridge');
});
// REGRESSION F537: benchmark-specific agent-probe flag was removed from OSS.
test('agent-probe rejects removed benchmark flag without launching probe', () => {
    const cli = path.join(__dirname, '../../aigon-cli.js');
    const res = spawnSync(process.execPath, [cli, 'agent-probe', '--include-bench'], { encoding: 'utf8' });
    assert.notStrictEqual(res.status, 0);
    assert.ok(String(res.stderr).includes('removed from OSS Aigon'));
});
// REGRESSION F524: feature-do prompt must not inject any package-manager / depCheck recipe.
// Aigon has zero opinion about the target repo's stack — operators declare `worktreeSetup`.
test('feature-do prompt has no depCheck injection (F524)', () => {
    const pp = require('../../lib/profile-placeholders');
    const repoRoot = path.join(__dirname, '../..');
    // 1. Profile preset string-files map carries no depCheck entry.
    assert.ok(!('depCheck' in pp.PROFILE_PRESET_STRING_FILES), 'PROFILE_PRESET_STRING_FILES.depCheck must be removed');
    // 2. Every resolved profile lacks a depCheck field.
    for (const name of Object.keys(pp.PROFILE_PRESETS)) {
        const profile = pp.PROFILE_PRESETS[name];
        assert.ok(!('depCheck' in profile), `profile ${name} must not carry depCheck`);
    }
    // 3. profiles.json string-files map has no depCheck key.
    const profilesJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'templates/profiles.json'), 'utf8'));
    assert.ok(!('depCheck' in profilesJson.stringFiles), 'templates/profiles.json stringFiles.depCheck must be removed');
    // 4. The feature-do generic template has no WORKTREE_DEP_CHECK placeholder or stack-specific install lines.
    const tpl = fs.readFileSync(path.join(repoRoot, 'templates/generic/commands/feature-do.md'), 'utf8');
    assert.ok(!tpl.includes('WORKTREE_DEP_CHECK'), 'feature-do.md must not reference WORKTREE_DEP_CHECK');
    assert.ok(!tpl.includes('Install dependencies if needed'), 'feature-do.md must not inject dep-check block');
});
report();
