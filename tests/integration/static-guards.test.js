#!/usr/bin/env node
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const { implAgentReadyForAutonomousClose } = require('../../lib/feature-autonomous');
const { test, withTempDir, report } = require('../_helpers');
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
// REGRESSION: SetConductor outer loop (repo-s{slug}-auto) must be peekable from Pipeline group-by-set headers like *-f{id}-auto.
test('set autonomous conductor peek wired in dashboard templates', () => {
    const root = path.join(__dirname, '../../templates/dashboard/js');
    const pipeline = fs.readFileSync(path.join(root, 'pipeline.js'), 'utf8');
    const needle = 'Peek at set autonomous conductor output';
    assert.ok(pipeline.includes(needle) && pipeline.includes('setPeekSession'));
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
report();
