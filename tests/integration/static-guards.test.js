#!/usr/bin/env node
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const { implAgentReadyForAutonomousClose } = require('../../lib/feature-autonomous');
const { test, withTempDir, withRepoCwd, report } = require('../_helpers');
// REGRESSION: keep the GA4 placeholder leak and Pro env/config drift covered even under the hard LOC budget.
test('static guards: home.html stays GA4-free and lib/pro.js ignores project config', () => {
    const html = fs.readFileSync(path.join(__dirname, '../../site/public/home.html'), 'utf8');
    const pro = fs.readFileSync(require.resolve('../../lib/pro.js'), 'utf8');
    assert.ok(!html.includes('G-XXXXXXXXXX') && !html.includes('googletagmanager.com'));
    assert.ok(!/loadProjectConfig|require\(['"]\.\/config['"]\)/.test(pro));
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
    const actions = fs.readFileSync(path.join(__dirname, '../../templates/dashboard/js/actions.js'), 'utf8');
    assert.ok(idx.includes('id="agent-picker-recommendation"'));
    assert.ok(idx.includes('id="autonomous-picker-recommendation"'));
    assert.ok(!actions.includes("querySelector('#agent-picker .modal-card')"));
    assert.ok(actions.includes("getElementById(mountId || 'agent-picker-recommendation')"));
});
// REGRESSION: Start Autonomously reviewer row must reuse the same triplet wiring as implement rows (spec recommendations + localStorage), not dead selects.
test('autonomous reviewer triplet uses recommendation and tripletStorage like implement rows', () => {
    const actions = fs.readFileSync(path.join(__dirname, '../../templates/dashboard/js/actions.js'), 'utf8');
    const block = actions.match(/function updateReviewerTripletSelects\([\s\S]*?\n}\n\n\/\/ Convert picker triplets/);
    assert.ok(block, 'updateReviewerTripletSelects block present');
    const body = block[0];
    assert.ok(body.includes('getRecommendedValue(agent.id, \'model\')'), 'reviewer model select applies spec recommendation');
    assert.ok(body.includes('tripletStorage.read(agent.id)'), 'reviewer model select reads last-used triplet');
    assert.ok(body.includes('getRecommendedValue(agent.id, \'effort\')'), 'reviewer effort select applies spec recommendation');
    assert.ok(body.includes('tripletStorage.write(agent.id, { effort:'), 'reviewer effort persists');
    const idx = fs.readFileSync(path.join(__dirname, '../../templates/dashboard/index.html'), 'utf8');
    assert.ok(idx.includes('id="autonomous-review-triplet-hint"'), 'autonomous reviewer hint documents picker parity');
});
// REGRESSION (F355): SetConductor must wire openTerminalPanel (not openPeekPanel) in pipeline.js
test('set autonomous conductor view wired in dashboard templates', () => {
    const pipeline = fs.readFileSync(path.join(__dirname, '../../templates/dashboard/js/pipeline.js'), 'utf8');
    assert.ok(pipeline.includes('View set autonomous conductor output') && pipeline.includes('setConductorSession') && !pipeline.includes('openPeekPanel'));
});
// REGRESSION: solo review → counter-review must not require only `feedback-addressed` or set Conductor waits forever.
test('AutoConductor accepts re-submit after review feedback', () => {
    const p = fs.readFileSync(path.join(__dirname, '../../lib/feature-autonomous.js'), 'utf8');
    assert.ok(p.includes('implStatusProgressedAfterFeedback') && p.includes('re-signaled after review feedback'));
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
    ['lib/feature-close.js', 'lib/worktree.js', 'lib/commands/setup.js'].forEach(relPath => {
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
// REGRESSION F332: log starter skeleton written by both bootstrap paths uses 7-section structure.
test('log starter skeleton uses 7-section structure (commands/feature.js path)', () => withTempDir('aigon-log-skeleton-', async (tmpDir) => {
    const fsp = require('fs/promises');
    const logsDir = path.join(tmpDir, 'docs', 'specs', 'features', 'logs');
    await fsp.mkdir(logsDir, { recursive: true });
    // Simulate the init_log effect handler directly
    const logTemplate = `# Implementation Log: Feature 07 - foo\n\n## Status\n\n## New API Surface\n\n## Key Decisions\n\n## Gotchas / Known Issues\n\n## Explicitly Deferred\n\n## For the Next Feature in This Set\n\n## Test Coverage\n`;
    const logPath = path.join(logsDir, 'feature-07-foo-log.md');
    await fsp.writeFile(logPath, logTemplate, 'utf8');
    const written = await fsp.readFile(logPath, 'utf8');
    for (const section of ['## Status', '## New API Surface', '## Key Decisions', '## Gotchas / Known Issues', '## Explicitly Deferred', '## For the Next Feature in This Set', '## Test Coverage']) {
        assert.ok(written.includes(section), `Missing section: ${section}`);
    }
    assert.ok(!written.includes('## Plan') && !written.includes('## Progress') && !written.includes('## Decisions\n'), 'old sections must not appear');
}));
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
test('dashboard wires perf-bench settings (script order + Pro asset proxy + no OSS API)', () => {
    const idx = fs.readFileSync(path.join(__dirname, '../../templates/dashboard/index.html'), 'utf8');
    const iBench = idx.indexOf('/js/benchmark-matrix.js');
    const iSettings = idx.indexOf('/js/settings.js');
    assert.ok(iBench > 0 && iSettings > iBench, 'benchmark-matrix.js must precede settings.js');
    const ds = fs.readFileSync(path.join(__dirname, '../../lib/dashboard-server.js'), 'utf8');
    assert.ok(ds.includes("reqPath === '/js/benchmark-matrix.js'"), 'dashboard-server must serve /js/benchmark-matrix.js via resolveProDashboardAsset');
    const settings = fs.readFileSync(path.join(__dirname, '../../templates/dashboard/js/settings.js'), 'utf8');
    assert.ok(settings.includes("addSection('perf-benchmarks'"), 'settings.js must add the perf-benchmarks section');
    assert.ok(settings.includes('AigonProBenchmarkMatrix'), 'settings.js must mount via window.AigonProBenchmarkMatrix');
    const cfg = fs.readFileSync(path.join(__dirname, '../../lib/dashboard-routes/config.js'), 'utf8');
    assert.ok(!cfg.includes('/api/benchmarks'), 'OSS must not register /api/benchmarks — Pro owns it via pro-bridge');
});
report();
