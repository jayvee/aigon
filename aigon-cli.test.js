#!/usr/bin/env node
/**
 * Unit tests for the modularized Aigon CLI.
 *
 * Runs with: node aigon-cli.test.js
 * Or: npm test
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { spawnSync } = require('child_process');

const { COMMAND_ALIASES, PROVIDER_FAMILIES } = require('./lib/constants');
const { createFeatureCommands } = require('./lib/commands/feature');
const { createResearchCommands } = require('./lib/commands/research');
const { createFeedbackCommands } = require('./lib/commands/feedback');
const { createSetupCommands } = require('./lib/commands/setup');
const { createMiscCommands } = require('./lib/commands/misc');
const {
    buildIncompleteSubmissionReconnectCommand,
    createAllCommands,
    collectIncompleteFeatureEvalAgents,
    collectIncompleteResearchSynthesisAgents,
    parseFrontMatterStatus
} = require('./lib/commands/shared');
const {
    parseSimpleFrontMatter,
    RADAR_INTERACTIVE_ACTIONS,
    resolveRadarActionRepoPath,
    parseRadarActionRequest,
    buildRadarActionCommandArgs,
    collectDashboardStatusData,
    inferDashboardNextCommand,
    inferDashboardNextActions
} = require('./lib/dashboard');
const { buildTmuxSessionName, buildResearchTmuxSessionName, matchTmuxSessionByEntityId, shellQuote, toUnpaddedId } = require('./lib/worktree');
const { isSameProviderFamily, getProfilePlaceholders, generateCaddyfile, gcDevServers, loadProxyRegistry, saveProxyRegistry, RADAR_DEFAULT_PORT, DASHBOARD_DEFAULT_PORT, DASHBOARD_DYNAMIC_PORT_START, DASHBOARD_DYNAMIC_PORT_END, DEV_PROXY_REGISTRY, parseLogFrontmatterFull, serializeLogFrontmatter, updateLogFrontmatterInPlace, collectAnalyticsData } = require('./lib/utils');
const { detectDashboardContext } = require('./lib/devserver');

let passed = 0;
let failed = 0;

function test(description, fn) {
    try {
        fn();
        console.log(`  ✓ ${description}`);
        passed++;
    } catch (err) {
        console.error(`  ✗ ${description}`);
        console.error(`    ${err.message}`);
        failed++;
    }
}

function withTempDir(fn) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-test-'));
    try {
        fn(tempDir);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

function withProjectConfig(config, fn) {
    const configDir = path.join(process.cwd(), '.aigon');
    const configPath = path.join(configDir, 'config.json');
    const hadConfig = fs.existsSync(configPath);
    const originalConfig = hadConfig ? fs.readFileSync(configPath, 'utf8') : null;

    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    try {
        return fn();
    } finally {
        if (hadConfig) {
            fs.writeFileSync(configPath, originalConfig);
        } else if (fs.existsSync(configPath)) {
            fs.unlinkSync(configPath);
        }
    }
}

function withCapturedConsole(fn) {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    const output = [];
    console.log = (...args) => output.push(args.join(' '));
    console.warn = (...args) => output.push(args.join(' '));
    console.error = (...args) => output.push(args.join(' '));
    try {
        return { result: fn(output), output };
    } finally {
        console.log = originalLog;
        console.warn = originalWarn;
        console.error = originalError;
    }
}

console.log('\nProvider Family Map');
test('cc maps to anthropic', () => assert.strictEqual(PROVIDER_FAMILIES.cc, 'anthropic'));
test('gg maps to google', () => assert.strictEqual(PROVIDER_FAMILIES.gg, 'google'));
test('cx maps to openai', () => assert.strictEqual(PROVIDER_FAMILIES.cx, 'openai'));
test('cu maps to varies', () => assert.strictEqual(PROVIDER_FAMILIES.cu, 'varies'));

console.log('\nisSameProviderFamily');
test('returns true for same provider family', () => assert.strictEqual(isSameProviderFamily('cc', 'cc'), true));
test('returns false for different providers', () => assert.strictEqual(isSameProviderFamily('cc', 'gg'), false));
test('returns false when either agent varies', () => assert.strictEqual(isSameProviderFamily('cu', 'cc'), false));
test('returns false for unknown agents', () => assert.strictEqual(isSameProviderFamily('xx', 'cc'), false));

console.log('\nProfile Placeholders');
test('includes playwright verification placeholder for web profile when enabled', () => withProjectConfig({
        profile: 'web',
        verification: { playwright: { enabled: true } }
    }, () => {
        const placeholders = getProfilePlaceholders();
        assert.ok(placeholders.PLAYWRIGHT_VERIFICATION.includes('### Step 4.2: Automated browser verification'));
    }));
test('includes playwright verification placeholder for api profile when enabled', () => withProjectConfig({
        profile: 'api',
        verification: { playwright: { enabled: true } }
    }, () => {
        const placeholders = getProfilePlaceholders();
        assert.ok(placeholders.PLAYWRIGHT_VERIFICATION.includes('### Step 4.2: Automated browser verification'));
    }));
test('omits playwright verification placeholder when disabled', () => withProjectConfig({
        profile: 'web',
        verification: { playwright: { enabled: false } }
    }, () => {
        const placeholders = getProfilePlaceholders();
        assert.strictEqual(placeholders.PLAYWRIGHT_VERIFICATION, '');
    }));
test('omits playwright verification placeholder for non-web profiles', () => withProjectConfig({
        profile: 'library',
        verification: { playwright: { enabled: true } }
    }, () => {
        const placeholders = getProfilePlaceholders();
        assert.strictEqual(placeholders.PLAYWRIGHT_VERIFICATION, '');
    }));

console.log('\nWorktree Helpers');
test('toUnpaddedId removes leading zeros', () => assert.strictEqual(toUnpaddedId('040'), '40'));
test('toUnpaddedId keeps non-numeric IDs unchanged', () => assert.strictEqual(toUnpaddedId('abc'), 'abc'));
test('buildTmuxSessionName includes repo and unpadded ID', () => {
    assert.strictEqual(buildTmuxSessionName('040', 'cx', { repo: 'aigon' }), 'aigon-f40-cx');
});
test('buildTmuxSessionName defaults agent to solo', () => {
    assert.strictEqual(buildTmuxSessionName('40', undefined, { repo: 'aigon' }), 'aigon-f40-solo');
});
test('buildTmuxSessionName includes desc when provided', () => assert.strictEqual(buildTmuxSessionName('7', 'cc', { repo: 'myrepo', desc: 'dark-mode' }), 'myrepo-f7-cc-dark-mode'));
test('buildTmuxSessionName derives repo from worktree path', () => assert.strictEqual(
    buildTmuxSessionName('7', 'cc', { desc: 'dark-mode', worktreePath: '/tmp/myrepo-worktrees/feature-07-cc-dark-mode' }),
    'myrepo-f7-cc-dark-mode'
));
test('buildResearchTmuxSessionName uses repo prefix', () => assert.strictEqual(buildResearchTmuxSessionName('5', 'gg', { repo: 'myrepo' }), 'myrepo-r5-gg'));
test('buildResearchTmuxSessionName derives repo from worktree base path', () => assert.strictEqual(
    buildResearchTmuxSessionName('5', 'gg', { worktreePath: '/tmp/myrepo-worktrees/research-05-gg' }),
    'myrepo-r5-gg'
));
test('matchTmuxSessionByEntityId matches new-style names', () => {
    const m = matchTmuxSessionByEntityId('myrepo-f7-cc-dark-mode', '7');
    assert.deepStrictEqual(m, { type: 'f', id: '7', agent: 'cc' });
});
test('matchTmuxSessionByEntityId matches old-style names', () => {
    const m = matchTmuxSessionByEntityId('aigon-f40-cx', '40');
    assert.deepStrictEqual(m, { type: 'f', id: '40', agent: 'cx' });
});
test('matchTmuxSessionByEntityId returns null for non-match', () => {
    assert.strictEqual(matchTmuxSessionByEntityId('aigon-f40-cx', '41'), null);
});
test('shellQuote escapes apostrophes safely', () => assert.strictEqual(shellQuote("it's"), "'it'\\''s'"));

console.log('\nDashboard Parsing');
test('parseSimpleFrontMatter extracts front matter keys', () => {
    const content = '---\nstatus: submitted\nupdated: 2026-03-11T10:30:00.000Z\n---\n# Log\n';
    const parsed = parseSimpleFrontMatter(content);
    assert.strictEqual(parsed.status, 'submitted');
    assert.strictEqual(parsed.updated, '2026-03-11T10:30:00.000Z');
});
test('parseSimpleFrontMatter returns empty object when absent', () => {
    assert.deepStrictEqual(parseSimpleFrontMatter('# No front matter\n'), {});
});
test('parseFrontMatterStatus extracts status from YAML front matter', () => {
    assert.strictEqual(parseFrontMatterStatus('---\nstatus: waiting\nupdated: 2026-03-11T10:30:00.000Z\n---\n# Log\n'), 'waiting');
});
test('parseFrontMatterStatus returns null when front matter is absent', () => {
    assert.strictEqual(parseFrontMatterStatus('# Log\n'), null);
});
test('RADAR_INTERACTIVE_ACTIONS includes core feature workflow actions', () => {
    assert.strictEqual(RADAR_INTERACTIVE_ACTIONS.has('feature-create'), true);
    assert.strictEqual(RADAR_INTERACTIVE_ACTIONS.has('feature-prioritise'), true);
    assert.strictEqual(RADAR_INTERACTIVE_ACTIONS.has('feature-do'), true);
    assert.strictEqual(RADAR_INTERACTIVE_ACTIONS.has('feature-eval'), true);
    assert.strictEqual(RADAR_INTERACTIVE_ACTIONS.has('feature-submit'), true);
});
test('resolveRadarActionRepoPath accepts registered repo paths', () => {
    const resolved = resolveRadarActionRepoPath('/tmp/repo-a', ['/tmp/repo-a', '/tmp/repo-b'], '/tmp/repo-a');
    assert.deepStrictEqual(resolved, { ok: true, repoPath: '/tmp/repo-a' });
});
test('resolveRadarActionRepoPath requires explicit repo when multiple repos are registered', () => {
    const resolved = resolveRadarActionRepoPath('', ['/tmp/repo-a', '/tmp/repo-b'], '/tmp/not-registered');
    assert.strictEqual(resolved.ok, false);
    assert.strictEqual(resolved.status, 400);
});
test('parseRadarActionRequest rejects unsupported actions', () => {
    const parsed = parseRadarActionRequest({ action: 'rm -rf', args: [] }, { registeredRepos: ['/tmp/repo-a'], defaultRepoPath: '/tmp/repo-a' });
    assert.strictEqual(parsed.ok, false);
    assert.strictEqual(parsed.status, 400);
});
test('parseRadarActionRequest normalizes args and repo', () => {
    const parsed = parseRadarActionRequest(
        { action: 'feature-eval', args: ['55', '--agent=cx', true], repoPath: '/tmp/repo-a' },
        { registeredRepos: ['/tmp/repo-a'], defaultRepoPath: '/tmp/repo-a' }
    );
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.action, 'feature-eval');
    assert.deepStrictEqual(parsed.args, ['55', '--agent=cx', 'true']);
    assert.strictEqual(parsed.repoPath, '/tmp/repo-a');
});
test('buildRadarActionCommandArgs builds CLI invocation args', () => {
    assert.deepStrictEqual(
        buildRadarActionCommandArgs('feature-eval', ['55', '--agent=cx']),
        [path.join(__dirname, 'aigon-cli.js'), 'feature-eval', '55', '--agent=cx']
    );
});
test('RADAR_INTERACTIVE_ACTIONS includes worktree-open', () => {
    assert.strictEqual(RADAR_INTERACTIVE_ACTIONS.has('worktree-open'), true);
});
test('RADAR_INTERACTIVE_ACTIONS includes feature-open', () => {
    assert.strictEqual(RADAR_INTERACTIVE_ACTIONS.has('feature-open'), true);
});
test('parseRadarActionRequest accepts worktree-open action', () => {
    const parsed = parseRadarActionRequest(
        { action: 'worktree-open', args: ['57', 'cc'], repoPath: '/tmp/repo-a' },
        { registeredRepos: ['/tmp/repo-a'], defaultRepoPath: '/tmp/repo-a' }
    );
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.action, 'worktree-open');
    assert.deepStrictEqual(parsed.args, ['57', 'cc']);
});
test('parseRadarActionRequest accepts feature-stop (state machine fire-and-forget action)', () => {
    const parsed = parseRadarActionRequest(
        { action: 'feature-stop', args: ['62'], repoPath: '/tmp/repo-a' },
        { registeredRepos: ['/tmp/repo-a'], defaultRepoPath: '/tmp/repo-a' }
    );
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.action, 'feature-stop');
});
test('parseRadarActionRequest rejects truly unsupported actions', () => {
    const parsed = parseRadarActionRequest(
        { action: 'not-a-real-command', args: [] },
        { registeredRepos: ['/tmp/repo-a'], defaultRepoPath: '/tmp/repo-a' }
    );
    assert.strictEqual(parsed.ok, false);
    assert.strictEqual(parsed.status, 400);
});

// inferDashboardNextActions — state machine integration
console.log('\n--- inferDashboardNextActions (state machine) ---');
test('inferDashboardNextActions returns feature-open for not-started fleet agents', () => {
    const agents = [
        { id: 'cc', status: 'implementing', tmuxRunning: false, tmuxSession: null },
        { id: 'gg', status: 'implementing', tmuxRunning: false, tmuxSession: null }
    ];
    const actions = inferDashboardNextActions('62', agents, 'in-progress');
    assert.ok(Array.isArray(actions), 'should return an array');
    const hasOpen = actions.some(a => a.command && a.command.includes('feature-open'));
    assert.ok(hasOpen, 'should include feature-open command for not-started agents');
});
test('inferDashboardNextActions returns focus for waiting agent', () => {
    const agents = [{ id: 'cc', status: 'waiting', tmuxRunning: true, tmuxSession: 'aigon-62-cc' }];
    const actions = inferDashboardNextActions('62', agents, 'in-progress');
    const hasFocus = actions.some(a => a.command && a.command.includes('terminal-focus'));
    assert.ok(hasFocus, 'should include terminal-focus for waiting agent');
});
test('inferDashboardNextActions returns eval for fleet all submitted', () => {
    const agents = [
        { id: 'cc', status: 'submitted', tmuxRunning: false, tmuxSession: null },
        { id: 'gg', status: 'submitted', tmuxRunning: false, tmuxSession: null }
    ];
    const actions = inferDashboardNextActions('62', agents, 'in-progress');
    const hasEval = actions.some(a => a.command && a.command.includes('afe') || a.command && a.command.includes('feature-eval'));
    assert.ok(hasEval, 'should include eval command when fleet all submitted');
});
test('inferDashboardNextCommand returns first recommended action', () => {
    const agents = [{ id: 'cc', status: 'waiting', tmuxRunning: true, tmuxSession: 'aigon-62-cc' }];
    const result = inferDashboardNextCommand('62', agents, 'in-progress');
    assert.ok(result && result.command, 'should return a command object');
    assert.ok(typeof result.reason === 'string', 'should include a reason');
});
test('inferDashboardNextActions returns empty for empty agents', () => {
    const actions = inferDashboardNextActions('62', [], 'in-progress');
    assert.deepStrictEqual(actions, []);
});

console.log('\nPipeline Stage Data Collection');

// Helper: temporarily register a temp repo in ~/.aigon/config.json, run fn, then restore
function withTempRepo(fn) {
    return withTempDir(tempDir => {
        const globalConfigPath = path.join(os.homedir(), '.aigon', 'config.json');
        let origContent = null;
        try { origContent = fs.readFileSync(globalConfigPath, 'utf8'); } catch (e) { /* no existing config */ }
        const origCfg = origContent ? JSON.parse(origContent) : {};
        const origRepos = Array.isArray(origCfg.repos) ? origCfg.repos : [];
        const testCfg = { ...origCfg, repos: [...origRepos, tempDir] };
        try {
            fs.mkdirSync(path.dirname(globalConfigPath), { recursive: true });
            fs.writeFileSync(globalConfigPath, JSON.stringify(testCfg));
            fn(tempDir);
        } finally {
            if (origContent !== null) {
                fs.writeFileSync(globalConfigPath, origContent);
            } else {
                try { fs.unlinkSync(globalConfigPath); } catch (e) { /* ignore */ }
            }
        }
    });
}

test('collectDashboardStatusData includes inbox specs with stage=inbox', () => withTempRepo(tempDir => {
    const inboxDir = path.join(tempDir, 'docs', 'specs', 'features', '01-inbox');
    fs.mkdirSync(inboxDir, { recursive: true });
    fs.writeFileSync(path.join(inboxDir, 'feature-10-my-inbox-feature.md'), '# Feature\n');

    const result = collectDashboardStatusData();
    const repo = (result.repos || []).find(r => r.path === path.resolve(tempDir));
    assert.ok(repo, 'repo found in result');
    const inboxFeature = (repo.features || []).find(f => f.id === '10' && f.stage === 'inbox');
    assert.ok(inboxFeature, 'inbox feature found with stage=inbox');
    assert.strictEqual(inboxFeature.name, 'my-inbox-feature');
    assert.deepStrictEqual(inboxFeature.agents, []);
}));
test('collectDashboardStatusData includes backlog specs with stage=backlog', () => withTempRepo(tempDir => {
    const backlogDir = path.join(tempDir, 'docs', 'specs', 'features', '02-backlog');
    fs.mkdirSync(backlogDir, { recursive: true });
    fs.writeFileSync(path.join(backlogDir, 'feature-20-my-backlog-feature.md'), '# Feature\n');

    const result = collectDashboardStatusData();
    const repo = (result.repos || []).find(r => r.path === path.resolve(tempDir));
    assert.ok(repo, 'repo found in result');
    const backlogFeature = (repo.features || []).find(f => f.id === '20' && f.stage === 'backlog');
    assert.ok(backlogFeature, 'backlog feature found with stage=backlog');
    assert.deepStrictEqual(backlogFeature.agents, []);
}));
test('collectDashboardStatusData limits done features to 10 most recent', () => withTempRepo(tempDir => {
    const doneDir = path.join(tempDir, 'docs', 'specs', 'features', '05-done');
    fs.mkdirSync(doneDir, { recursive: true });
    // Write 12 done features with different mtimes
    for (let i = 1; i <= 12; i++) {
        const fpath = path.join(doneDir, `feature-${String(i).padStart(2, '0')}-done-feature-${i}.md`);
        fs.writeFileSync(fpath, '# Feature\n');
        const mtime = new Date(2024, 0, i);
        fs.utimesSync(fpath, mtime, mtime);
    }

    const result = collectDashboardStatusData();
    const repo = (result.repos || []).find(r => r.path === path.resolve(tempDir));
    assert.ok(repo, 'repo found in result');
    const doneFeatures = (repo.features || []).filter(f => f.stage === 'done');
    assert.strictEqual(doneFeatures.length, 10, 'exactly 10 done features returned');
    // Most recent (features 3–12) should be included, not features 1 or 2
    const ids = doneFeatures.map(f => Number(f.id)).sort((a, b) => a - b);
    assert.ok(ids.every(id => id >= 3), 'only the 10 most recent features included');
}));
test('collectDashboardStatusData: in-progress features still include agent data', () => withTempRepo(tempDir => {
    const inProgressDir = path.join(tempDir, 'docs', 'specs', 'features', '03-in-progress');
    const logsDir = path.join(tempDir, 'docs', 'specs', 'features', 'logs');
    fs.mkdirSync(inProgressDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(path.join(inProgressDir, 'feature-30-active-feature.md'), '# Feature\n');
    fs.writeFileSync(
        path.join(logsDir, 'feature-30-cc-active-feature-log.md'),
        '---\nstatus: waiting\nupdated: 2024-01-01T00:00:00.000Z\n---\n# Log\n'
    );

    const result = collectDashboardStatusData();
    const repo = (result.repos || []).find(r => r.path === path.resolve(tempDir));
    assert.ok(repo, 'repo found in result');
    const feature = (repo.features || []).find(f => f.id === '30' && f.stage === 'in-progress');
    assert.ok(feature, 'in-progress feature found');
    assert.ok(feature.agents.length > 0, 'in-progress feature has agents');
    assert.strictEqual(feature.agents[0].status, 'waiting');
}));

console.log('\nFeature Eval Completion Check');
test('collectIncompleteFeatureEvalAgents returns incomplete fleet agents from worktree logs', () => withTempDir(tempDir => {
    const worktreePath = path.join(tempDir, 'feature-51-cc-demo');
    const logsDir = path.join(worktreePath, 'docs/specs/features/logs');
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(
        path.join(logsDir, 'feature-51-cc-demo-log.md'),
        '---\nstatus: implementing\n---\n# Log\n'
    );

    const incomplete = collectIncompleteFeatureEvalAgents({
        featureNum: '51',
        worktrees: [{ path: worktreePath, agent: 'cc', name: 'Claude' }]
    });

    assert.deepStrictEqual(incomplete, [{ agent: 'cc', name: 'Claude', status: 'implementing' }]);
}));
test('collectIncompleteFeatureEvalAgents skips missing logs for backwards compatibility', () => withTempDir(tempDir => {
    const incomplete = collectIncompleteFeatureEvalAgents({
        featureNum: '51',
        worktrees: [{ path: path.join(tempDir, 'feature-51-cc-demo'), agent: 'cc', name: 'Claude' }]
    });

    assert.deepStrictEqual(incomplete, []);
}));
test('collectIncompleteResearchSynthesisAgents returns unfinished research agents', () => withTempDir(tempDir => {
    const logsDir = path.join(tempDir, 'docs/specs/research-topics/logs');
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(
        path.join(logsDir, 'research-52-cc-findings.md'),
        '---\nstatus: waiting\n---\n# Findings\n'
    );
    fs.writeFileSync(
        path.join(logsDir, 'research-52-gg-findings.md'),
        '---\nstatus: submitted\n---\n# Findings\n'
    );

    const incomplete = collectIncompleteResearchSynthesisAgents({
        researchNum: '52',
        logsDir,
        loadAgentConfig: (agent) => ({ name: agent === 'cc' ? 'Claude' : agent })
    });

    assert.deepStrictEqual(incomplete, [{ agent: 'cc', name: 'Claude', status: 'waiting' }]);
}));
test('feature reconnect command uses terminal-focus', () => {
    assert.strictEqual(
        buildIncompleteSubmissionReconnectCommand({ mode: 'feature', id: '51', agent: 'cc' }),
        'aigon terminal-focus 51 cc'
    );
});
test('feature-eval --force bypasses the completion warning and creates the evaluation file', () => withTempDir(tempDir => {
    const featuresRoot = path.join(tempDir, 'docs/specs/features');
    const inProgressDir = path.join(featuresRoot, '03-in-progress');
    const evaluationsDir = path.join(featuresRoot, 'evaluations');
    const worktreePath = path.join(tempDir, 'feature-51-cc-demo');
    const worktreeLogsDir = path.join(worktreePath, 'docs/specs/features/logs');

    fs.mkdirSync(inProgressDir, { recursive: true });
    fs.mkdirSync(evaluationsDir, { recursive: true });
    fs.mkdirSync(worktreeLogsDir, { recursive: true });

    fs.writeFileSync(
        path.join(inProgressDir, 'feature-51-eval-agent-completion-check.md'),
        '# Feature 51\n'
    );
    fs.writeFileSync(
        path.join(worktreeLogsDir, 'feature-51-cc-eval-agent-completion-check-log.md'),
        '---\nstatus: implementing\n---\n# Log\n'
    );

    const commands = createAllCommands({
        PATHS: {
            features: {
                root: featuresRoot,
                prefix: 'feature',
                folders: ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused']
            }
        },
        detectActiveAgentSession: () => ({ detected: true, agentId: 'gg' }),
        execSync: (cmd) => {
            if (cmd === 'git worktree list') return `${worktreePath} abc123 [feature-51-cc-demo]\n`;
            throw new Error(`Unexpected execSync call: ${cmd}`);
        },
        loadAgentConfig: (agentId) => ({ name: agentId === 'cc' ? 'Claude' : agentId }),
        getAgentCliConfig: () => ({ models: { evaluate: null } }),
        runGit: () => {}
    });

    const { output } = withCapturedConsole(() => {
        commands['feature-eval'](['51', '--force']);
    });

    assert.strictEqual(fs.existsSync(path.join(evaluationsDir, 'feature-51-eval.md')), true);
    assert.strictEqual(output.some(line => line.includes('not yet submitted')), false);
}));
test('research reconnect command uses terminal-focus with --research', () => {
    assert.strictEqual(
        buildIncompleteSubmissionReconnectCommand({ mode: 'research', id: '52', agent: 'cc' }),
        'aigon terminal-focus 52 cc --research'
    );
});
test('research-synthesize warns about unfinished findings and suggests terminal-focus', () => withTempDir(tempDir => {
    const researchRoot = path.join(tempDir, 'docs/specs/research-topics');
    const inProgressDir = path.join(researchRoot, '03-in-progress');
    const logsDir = path.join(researchRoot, 'logs');

    fs.mkdirSync(inProgressDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });

    fs.writeFileSync(
        path.join(inProgressDir, 'research-52-eval-agent-completion-check.md'),
        '# Research 52\n'
    );
    fs.writeFileSync(
        path.join(logsDir, 'research-52-cc-findings.md'),
        '---\nstatus: implementing\n---\n# Findings\n'
    );

    const commands = createAllCommands({
        PATHS: {
            features: {
                root: path.join(tempDir, 'docs/specs/features'),
                prefix: 'feature',
                folders: ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused']
            },
            research: {
                root: researchRoot,
                prefix: 'research',
                folders: ['01-inbox', '02-backlog', '03-in-progress', '04-done']
            }
        },
        loadAgentConfig: (agentId) => ({ name: agentId === 'cc' ? 'Claude' : agentId }),
        printAgentContextWarning: () => {
            throw new Error('printAgentContextWarning should not run when findings are incomplete');
        }
    });

    const { output } = withCapturedConsole(() => {
        commands['research-synthesize'](['52']);
    });

    assert.strictEqual(output.some(line => line.includes('aigon terminal-focus 52 cc --research')), true);
    assert.strictEqual(output.some(line => line.includes('aigon research-synthesize 52 --force')), true);
}));
test('research-synthesize --force bypasses unfinished findings check', () => withTempDir(tempDir => {
    const researchRoot = path.join(tempDir, 'docs/specs/research-topics');
    const inProgressDir = path.join(researchRoot, '03-in-progress');
    const logsDir = path.join(researchRoot, 'logs');

    fs.mkdirSync(inProgressDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });

    fs.writeFileSync(
        path.join(inProgressDir, 'research-52-eval-agent-completion-check.md'),
        '# Research 52\n'
    );
    fs.writeFileSync(
        path.join(logsDir, 'research-52-cc-findings.md'),
        '---\nstatus: implementing\n---\n# Findings\n'
    );

    let contextWarningCalled = false;
    const commands = createAllCommands({
        PATHS: {
            features: {
                root: path.join(tempDir, 'docs/specs/features'),
                prefix: 'feature',
                folders: ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused']
            },
            research: {
                root: researchRoot,
                prefix: 'research',
                folders: ['01-inbox', '02-backlog', '03-in-progress', '04-done']
            }
        },
        loadAgentConfig: (agentId) => ({ name: agentId === 'cc' ? 'Claude' : agentId }),
        printAgentContextWarning: () => {
            contextWarningCalled = true;
        }
    });

    withCapturedConsole(() => {
        commands['research-synthesize'](['52', '--force']);
    });

    assert.strictEqual(contextWarningCalled, true);
}));

console.log('\nConfig Models Resolution');
function runCliInDir(cwd, args, env = {}) {
    const cliPath = path.join(__dirname, 'aigon-cli.js');
    const result = spawnSync(process.execPath, [cliPath, ...args], {
        cwd,
        env: { ...process.env, ...env },
        encoding: 'utf8'
    });
    return {
        status: result.status,
        stdout: result.stdout || '',
        stderr: result.stderr || ''
    };
}
test('config models reads global config from agents.<agent>.<task>.model', () => withTempDir(tempDir => {
    const homeDir = path.join(tempDir, 'home');
    fs.mkdirSync(path.join(homeDir, '.aigon'), { recursive: true });
    fs.writeFileSync(
        path.join(homeDir, '.aigon', 'config.json'),
        JSON.stringify({
            agents: {
                cx: {
                    research: { model: 'gpt-5.3' }
                }
            }
        }, null, 2)
    );

    const { status, stdout, stderr } = runCliInDir(tempDir, ['config', 'models'], { HOME: homeDir });
    assert.strictEqual(status, 0, stderr || `expected success, got ${status}`);
    assert.match(stdout, /^\s*cx\s+research\s+gpt-5\.3\s+global$/m);
}));
test('config models uses project config over global config', () => withTempDir(tempDir => {
    const homeDir = path.join(tempDir, 'home');
    fs.mkdirSync(path.join(homeDir, '.aigon'), { recursive: true });
    fs.writeFileSync(
        path.join(homeDir, '.aigon', 'config.json'),
        JSON.stringify({
            agents: {
                cx: {
                    research: { model: 'gpt-5.2' }
                }
            }
        }, null, 2)
    );

    fs.mkdirSync(path.join(tempDir, '.aigon'), { recursive: true });
    fs.writeFileSync(
        path.join(tempDir, '.aigon', 'config.json'),
        JSON.stringify({
            agents: {
                cx: {
                    research: { model: 'gpt-5.3' }
                }
            }
        }, null, 2)
    );

    const { status, stdout, stderr } = runCliInDir(tempDir, ['config', 'models'], { HOME: homeDir });
    assert.strictEqual(status, 0, stderr || `expected success, got ${status}`);
    assert.match(stdout, /^\s*cx\s+research\s+gpt-5\.3\s+project$/m);
}));
test('config models uses env var over project config', () => withTempDir(tempDir => {
    const homeDir = path.join(tempDir, 'home');
    fs.mkdirSync(path.join(homeDir, '.aigon'), { recursive: true });
    fs.writeFileSync(
        path.join(homeDir, '.aigon', 'config.json'),
        JSON.stringify({
            agents: {
                cx: {
                    research: { model: 'gpt-5.2' }
                }
            }
        }, null, 2)
    );

    fs.mkdirSync(path.join(tempDir, '.aigon'), { recursive: true });
    fs.writeFileSync(
        path.join(tempDir, '.aigon', 'config.json'),
        JSON.stringify({
            agents: {
                cx: {
                    research: { model: 'gpt-5.3' }
                }
            }
        }, null, 2)
    );

    const { status, stdout, stderr } = runCliInDir(tempDir, ['config', 'models'], {
        HOME: homeDir,
        AIGON_CX_RESEARCH_MODEL: 'gpt-5.4'
    });
    assert.strictEqual(status, 0, stderr || `expected success, got ${status}`);
    assert.match(stdout, /^\s*cx\s+research\s+gpt-5\.4\s+env$/m);
}));

console.log('\nCommand Aliases');
test('short alias afd resolves to feature-do', () => assert.strictEqual(COMMAND_ALIASES.afd, 'feature-do'));
test('short alias afe resolves to feature-eval', () => assert.strictEqual(COMMAND_ALIASES.afe, 'feature-eval'));
test('short alias ads resolves to dev-server', () => assert.strictEqual(COMMAND_ALIASES.ads, 'dev-server'));

console.log('\nCommand Families');
test('feature command module exposes feature-do', () => assert.strictEqual(typeof createFeatureCommands()['feature-do'], 'function'));
test('research command module exposes research-do', () => assert.strictEqual(typeof createResearchCommands()['research-do'], 'function'));
test('feedback command module exposes feedback-triage', () => assert.strictEqual(typeof createFeedbackCommands()['feedback-triage'], 'function'));
test('setup command module exposes doctor', () => assert.strictEqual(typeof createSetupCommands().doctor, 'function'));
test('misc command module exposes help', () => assert.strictEqual(typeof createMiscCommands().help, 'function'));
test('command families stay separated', () => {
    const misc = createMiscCommands();
    assert.strictEqual(Object.prototype.hasOwnProperty.call(misc, 'feature-do'), false);
});

console.log('\nDashboard Constants');
test('RADAR_DEFAULT_PORT is 4100', () => assert.strictEqual(RADAR_DEFAULT_PORT, 4100));
test('DASHBOARD_DEFAULT_PORT is 4100', () => assert.strictEqual(DASHBOARD_DEFAULT_PORT, 4100));
test('DASHBOARD_DYNAMIC_PORT_START is 4101', () => assert.strictEqual(DASHBOARD_DYNAMIC_PORT_START, 4101));
test('DASHBOARD_DYNAMIC_PORT_END is 4199', () => assert.strictEqual(DASHBOARD_DYNAMIC_PORT_END, 4199));

console.log('\nCaddyfile Generation with Radar Entries');
test('generateCaddyfile handles regular dev server entries', () => {
    const registry = {
        farline: {
            '': { port: 3000, pid: 100 },
            'cc-119': { port: 3001, pid: 101 }
        }
    };
    const caddyfile = generateCaddyfile(registry);
    assert.ok(caddyfile.includes('http://farline.test'));
    assert.ok(caddyfile.includes('reverse_proxy localhost:3000'));
    assert.ok(caddyfile.includes('http://cc-119.farline.test'));
    assert.ok(caddyfile.includes('reverse_proxy localhost:3001'));
});
test('generateCaddyfile handles Radar entries with nested dashboard.port', () => {
    const registry = {
        aigon: {
            '': {
                service: { port: 4100, pid: 200 },
                dashboard: { port: 4100, pid: 200 },
                started: '2026-03-15T00:00:00.000Z'
            },
            'cc-119': {
                service: { port: 4301, pid: 300 },
                dashboard: { port: 4847, pid: 301 },
                worktree: '/tmp/wt',
                started: '2026-03-15T00:00:00.000Z'
            }
        }
    };
    const caddyfile = generateCaddyfile(registry);
    assert.ok(caddyfile.includes('http://aigon.test'), 'main aigon entry');
    assert.ok(caddyfile.includes('reverse_proxy localhost:4100'), 'main routes to dashboard port');
    assert.ok(caddyfile.includes('http://cc-119.aigon.test'), 'worktree entry');
    assert.ok(caddyfile.includes('reverse_proxy localhost:4847'), 'worktree routes to dashboard port');
    assert.ok(!caddyfile.includes('reverse_proxy localhost:4301'), 'does not route to service port');
});
test('generateCaddyfile mixes Radar and regular entries', () => {
    const registry = {
        aigon: {
            '': { service: { port: 4100, pid: 200 }, dashboard: { port: 4100, pid: 200 }, started: '' }
        },
        farline: {
            '': { port: 3000, pid: 100 }
        }
    };
    const caddyfile = generateCaddyfile(registry);
    assert.ok(caddyfile.includes('http://aigon.test'), 'aigon entry present');
    assert.ok(caddyfile.includes('http://farline.test'), 'farline entry present');
});

console.log('\nDetect Dashboard Context');
test('detectDashboardContext returns expected shape', () => {
    const ctx = detectDashboardContext();
    assert.ok(typeof ctx.isWorktree === 'boolean', 'isWorktree should be a boolean');
    assert.ok(typeof ctx.instanceName === 'string' && ctx.instanceName.length > 0, 'instanceName should be a non-empty string');
});

console.log('\ngcDevServers with Radar Entries');
test('gcDevServers removes radar entries with dead PIDs', () => withTempDir(tempDir => {
    const registryPath = path.join(tempDir, 'servers.json');
    const deadPid = 999999; // very high PID, very unlikely to exist

    // Write a test registry with a dead radar entry
    const registry = {
        ['aigon']: {
            'cc-61': {
                service: { port: 4201, pid: deadPid },
                dashboard: { port: 4202, pid: deadPid + 1 },
                worktree: '/tmp/test-wt',
                started: '2026-01-01T00:00:00.000Z'
            }
        }
    };
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n');

    // Back up real registry, replace with test file
    const realRegistry = fs.existsSync(DEV_PROXY_REGISTRY) ? fs.readFileSync(DEV_PROXY_REGISTRY, 'utf8') : null;
    const realRegistryDir = path.dirname(DEV_PROXY_REGISTRY);
    fs.mkdirSync(realRegistryDir, { recursive: true });
    fs.writeFileSync(DEV_PROXY_REGISTRY, JSON.stringify(registry, null, 2) + '\n');

    try {
        const removed = gcDevServers();
        assert.strictEqual(removed, 1, 'should remove 1 dead radar entry');

        const after = loadProxyRegistry();
        assert.ok(!after['aigon'] || !after['aigon']['cc-61'], 'dead entry should be removed');
    } finally {
        // Restore
        if (realRegistry !== null) {
            fs.writeFileSync(DEV_PROXY_REGISTRY, realRegistry);
        } else if (fs.existsSync(DEV_PROXY_REGISTRY)) {
            fs.unlinkSync(DEV_PROXY_REGISTRY);
        }
    }
}));

test('gcDevServers preserves live radar entries', () => {
    // Use PID 1 (always alive: init/launchd on macOS) as "live" PID
    const livePid = 1;
    const realRegistry = fs.existsSync(DEV_PROXY_REGISTRY) ? fs.readFileSync(DEV_PROXY_REGISTRY, 'utf8') : null;
    const realRegistryDir = path.dirname(DEV_PROXY_REGISTRY);
    fs.mkdirSync(realRegistryDir, { recursive: true });

    const registry = {
        ['aigon']: {
            '': {
                service: { port: 4100, pid: livePid },
                dashboard: { port: 4200, pid: livePid },
                started: '2026-01-01T00:00:00.000Z'
            }
        }
    };
    fs.writeFileSync(DEV_PROXY_REGISTRY, JSON.stringify(registry, null, 2) + '\n');

    try {
        const removed = gcDevServers();
        assert.strictEqual(removed, 0, 'should not remove live entry');
    } finally {
        if (realRegistry !== null) {
            fs.writeFileSync(DEV_PROXY_REGISTRY, realRegistry);
        } else if (fs.existsSync(DEV_PROXY_REGISTRY)) {
            fs.unlinkSync(DEV_PROXY_REGISTRY);
        }
    }
});


console.log('\nEntrypoint');
test('aigon-cli.js stays under 200 lines', () => {
    const lineCount = fs.readFileSync(path.join(__dirname, 'aigon-cli.js'), 'utf8').trimEnd().split('\n').length;
    assert.ok(lineCount < 200, `expected < 200 lines, got ${lineCount}`);
});

console.log('\nModel Resolution');
test('buildResearchAgentCommand uses global agents.<agent>.<task>.model override', () => withTempDir(tempDir => {
    const homeDir = path.join(tempDir, 'home');
    const cwdDir = path.join(tempDir, 'project');
    fs.mkdirSync(path.join(homeDir, '.aigon'), { recursive: true });
    fs.mkdirSync(cwdDir, { recursive: true });
    fs.writeFileSync(
        path.join(homeDir, '.aigon', 'config.json'),
        JSON.stringify({ agents: { cx: { research: { model: 'gpt-5.3' } } } }, null, 2)
    );

    const output = execFileSync(
        'node',
        ['-e', `const u=require(${JSON.stringify(path.join(__dirname, 'lib', 'utils.js'))}); console.log(u.buildResearchAgentCommand('cx','54'));`],
        { cwd: cwdDir, env: { ...process.env, HOME: homeDir }, encoding: 'utf8' }
    ).trim();

    assert.ok(output.includes('--model gpt-5.3'), `expected global override model, got: ${output}`);
}));

test('buildResearchAgentCommand prefers project agents.<agent>.<task>.model over global', () => withTempDir(tempDir => {
    const homeDir = path.join(tempDir, 'home');
    const cwdDir = path.join(tempDir, 'project');
    fs.mkdirSync(path.join(homeDir, '.aigon'), { recursive: true });
    fs.mkdirSync(path.join(cwdDir, '.aigon'), { recursive: true });
    fs.writeFileSync(
        path.join(homeDir, '.aigon', 'config.json'),
        JSON.stringify({ agents: { cx: { research: { model: 'gpt-5.3' } } } }, null, 2)
    );
    fs.writeFileSync(
        path.join(cwdDir, '.aigon', 'config.json'),
        JSON.stringify({ agents: { cx: { research: { model: 'gpt-5.4' } } } }, null, 2)
    );

    const output = execFileSync(
        'node',
        ['-e', `const u=require(${JSON.stringify(path.join(__dirname, 'lib', 'utils.js'))}); console.log(u.buildResearchAgentCommand('cx','54'));`],
        { cwd: cwdDir, env: { ...process.env, HOME: homeDir }, encoding: 'utf8' }
    ).trim();

    assert.ok(output.includes('--model gpt-5.4'), `expected project override model, got: ${output}`);
}));

test('buildResearchAgentCommand allows env var override over project/global', () => withTempDir(tempDir => {
    const homeDir = path.join(tempDir, 'home');
    const cwdDir = path.join(tempDir, 'project');
    fs.mkdirSync(path.join(homeDir, '.aigon'), { recursive: true });
    fs.mkdirSync(path.join(cwdDir, '.aigon'), { recursive: true });
    fs.writeFileSync(
        path.join(homeDir, '.aigon', 'config.json'),
        JSON.stringify({ agents: { cx: { research: { model: 'gpt-5.3' } } } }, null, 2)
    );
    fs.writeFileSync(
        path.join(cwdDir, '.aigon', 'config.json'),
        JSON.stringify({ agents: { cx: { research: { model: 'gpt-5.4' } } } }, null, 2)
    );

    const output = execFileSync(
        'node',
        ['-e', `const u=require(${JSON.stringify(path.join(__dirname, 'lib', 'utils.js'))}); console.log(u.buildResearchAgentCommand('cx','54'));`],
        {
            cwd: cwdDir,
            env: { ...process.env, HOME: homeDir, AIGON_CX_RESEARCH_MODEL: 'gpt-5.5' },
            encoding: 'utf8'
        }
    ).trim();

    assert.ok(output.includes('--model gpt-5.5'), `expected env override model, got: ${output}`);
}));

// ---------------------------------------------------------------------------
// State machine tests
// ---------------------------------------------------------------------------

const {
    FEATURE_STAGES,
    RESEARCH_STAGES,
    FEEDBACK_STAGES,
    getValidTransitions,
    getAvailableActions,
    getSessionAction,
    getRecommendedActions,
    isActionValid,
    allAgentsSubmitted,
    isFleet
} = require('./lib/state-machine');

console.log('\n--- state machine ---');

// Stage definitions
test('FEATURE_STAGES has correct ordered stages', () => {
    assert.deepStrictEqual(FEATURE_STAGES, ['inbox', 'backlog', 'in-progress', 'in-evaluation', 'done']);
});

test('RESEARCH_STAGES has correct ordered stages', () => {
    assert.deepStrictEqual(RESEARCH_STAGES, ['inbox', 'backlog', 'in-progress', 'paused', 'done']);
});

test('FEEDBACK_STAGES has correct ordered stages', () => {
    assert.deepStrictEqual(FEEDBACK_STAGES, ['inbox', 'triaged', 'actionable', 'done', 'wont-fix', 'duplicate']);
});

// allAgentsSubmitted helper
test('allAgentsSubmitted returns false when statuses is empty', () => {
    assert.strictEqual(allAgentsSubmitted({ agentStatuses: {} }), false);
});

test('allAgentsSubmitted returns true when all submitted', () => {
    assert.strictEqual(allAgentsSubmitted({ agentStatuses: { cc: 'submitted', gg: 'submitted' } }), true);
});

test('allAgentsSubmitted returns false when one is implementing', () => {
    assert.strictEqual(allAgentsSubmitted({ agentStatuses: { cc: 'submitted', gg: 'implementing' } }), false);
});

// isFleet helper
test('isFleet returns false for solo context', () => {
    assert.strictEqual(isFleet({ agents: ['solo'] }), false);
});

test('isFleet returns false for single agent', () => {
    assert.strictEqual(isFleet({ agents: ['cc'] }), false);
});

test('isFleet returns true for two real agents', () => {
    assert.strictEqual(isFleet({ agents: ['cc', 'gg'] }), true);
});

// getValidTransitions — features
test('feature inbox → backlog transition always available', () => {
    const transitions = getValidTransitions('feature', 'inbox', {});
    assert.ok(transitions.some(t => t.action === 'feature-prioritise' && t.to === 'backlog'));
});

test('feature backlog → in-progress transition always available', () => {
    const transitions = getValidTransitions('feature', 'backlog', {});
    assert.ok(transitions.some(t => t.action === 'feature-setup' && t.to === 'in-progress'));
});

test('feature in-progress → in-evaluation blocked when not all submitted', () => {
    const transitions = getValidTransitions('feature', 'in-progress', {
        agentStatuses: { cc: 'implementing' }
    });
    assert.ok(!transitions.some(t => t.action === 'feature-eval'));
});

test('feature in-progress → in-evaluation allowed when all submitted', () => {
    const transitions = getValidTransitions('feature', 'in-progress', {
        agentStatuses: { cc: 'submitted' }
    });
    assert.ok(transitions.some(t => t.action === 'feature-eval' && t.to === 'in-evaluation'));
});

test('feature in-evaluation → done transition always available', () => {
    const transitions = getValidTransitions('feature', 'in-evaluation', {});
    assert.ok(transitions.some(t => t.action === 'feature-close' && t.to === 'done'));
});

test('feature in done stage has no transitions', () => {
    const transitions = getValidTransitions('feature', 'done', {});
    assert.strictEqual(transitions.length, 0);
});

// getValidTransitions — research
test('research inbox → backlog transition available', () => {
    const transitions = getValidTransitions('research', 'inbox', {});
    assert.ok(transitions.some(t => t.action === 'research-prioritise'));
});

test('research in-progress → done blocked when not all submitted', () => {
    const transitions = getValidTransitions('research', 'in-progress', {
        agentStatuses: { cc: 'implementing' }
    });
    assert.ok(!transitions.some(t => t.action === 'research-close'));
});

test('research in-progress → done available when all submitted', () => {
    const transitions = getValidTransitions('research', 'in-progress', {
        agentStatuses: { cc: 'submitted' }
    });
    assert.ok(transitions.some(t => t.action === 'research-close'));
});

// getValidTransitions — feedback
test('feedback inbox → triaged transition available', () => {
    const transitions = getValidTransitions('feedback', 'inbox', {});
    assert.ok(transitions.some(t => t.action === 'feedback-triage'));
});

test('feedback triaged → wont-fix transition available', () => {
    const transitions = getValidTransitions('feedback', 'triaged', {});
    assert.ok(transitions.some(t => t.to === 'wont-fix'));
});

test('feedback triaged → duplicate transition available', () => {
    const transitions = getValidTransitions('feedback', 'triaged', {});
    assert.ok(transitions.some(t => t.to === 'duplicate'));
});

// getAvailableActions — in-progress per-agent actions
test('getAvailableActions returns feature-open for idle agent in in-progress', () => {
    const actions = getAvailableActions('feature', 'in-progress', {
        agents: ['cc'],
        agentStatuses: { cc: 'idle' },
        tmuxSessionStates: { cc: 'none' }
    });
    assert.ok(actions.some(a => a.action === 'feature-open' && a.agentId === 'cc'));
});

test('getAvailableActions returns Restart label for error agent', () => {
    const actions = getAvailableActions('feature', 'in-progress', {
        agents: ['cc'],
        agentStatuses: { cc: 'error' },
        tmuxSessionStates: { cc: 'none' }
    });
    const openAction = actions.find(a => a.action === 'feature-open' && a.agentId === 'cc');
    assert.ok(openAction, 'should have feature-open action');
    assert.strictEqual(openAction.label, 'Restart cc');
});

test('getAvailableActions returns feature-attach for implementing agent with running session', () => {
    const actions = getAvailableActions('feature', 'in-progress', {
        agents: ['cc'],
        agentStatuses: { cc: 'implementing' },
        tmuxSessionStates: { cc: 'running' }
    });
    assert.ok(actions.some(a => a.action === 'feature-attach' && a.agentId === 'cc'));
});

test('getAvailableActions returns feature-focus (high priority) for waiting agent', () => {
    const actions = getAvailableActions('feature', 'in-progress', {
        agents: ['cc'],
        agentStatuses: { cc: 'waiting' },
        tmuxSessionStates: { cc: 'running' }
    });
    const focusAction = actions.find(a => a.action === 'feature-focus' && a.agentId === 'cc');
    assert.ok(focusAction, 'should have feature-focus');
    assert.strictEqual(focusAction.priority, 'high');
});

test('getAvailableActions returns feature-stop for implementing agent', () => {
    const actions = getAvailableActions('feature', 'in-progress', {
        agents: ['cc'],
        agentStatuses: { cc: 'implementing' },
        tmuxSessionStates: {}
    });
    assert.ok(actions.some(a => a.action === 'feature-stop' && a.agentId === 'cc'));
});

test('getAvailableActions returns feature-close and feature-review for solo submitted', () => {
    const actions = getAvailableActions('feature', 'in-progress', {
        agents: ['cc'],
        agentStatuses: { cc: 'submitted' },
        tmuxSessionStates: {}
    });
    assert.ok(actions.some(a => a.action === 'feature-close' && !a.agentId));
    assert.ok(actions.some(a => a.action === 'feature-review' && !a.agentId));
});

test('getAvailableActions returns feature-eval for fleet all submitted', () => {
    const actions = getAvailableActions('feature', 'in-progress', {
        agents: ['cc', 'gg'],
        agentStatuses: { cc: 'submitted', gg: 'submitted' },
        tmuxSessionStates: {}
    });
    assert.ok(actions.some(a => a.action === 'feature-eval' && !a.agentId));
});

test('getAvailableActions in-evaluation solo returns feature-review', () => {
    const actions = getAvailableActions('feature', 'in-evaluation', {
        agents: ['cc'],
        agentStatuses: { cc: 'submitted' }
    });
    assert.ok(actions.some(a => a.action === 'feature-review'));
    assert.ok(!actions.some(a => a.action === 'feature-eval' && a.type === 'action'));
});

test('getAvailableActions in-evaluation fleet returns feature-eval action', () => {
    const actions = getAvailableActions('feature', 'in-evaluation', {
        agents: ['cc', 'gg'],
        agentStatuses: { cc: 'submitted', gg: 'submitted' }
    });
    assert.ok(actions.some(a => a.action === 'feature-eval' && a.type === 'action'));
});

// getSessionAction
test('getSessionAction returns create-and-start when no session', () => {
    const result = getSessionAction('cc', { tmuxSessionStates: { cc: 'none' }, agentStatuses: { cc: 'idle' } });
    assert.strictEqual(result.action, 'create-and-start');
    assert.strictEqual(result.needsAgentCommand, true);
});

test('getSessionAction returns create-and-start when session exited', () => {
    const result = getSessionAction('cc', { tmuxSessionStates: { cc: 'exited' }, agentStatuses: { cc: 'submitted' } });
    assert.strictEqual(result.action, 'create-and-start');
});

test('getSessionAction returns attach when session running and agent implementing', () => {
    const result = getSessionAction('cc', { tmuxSessionStates: { cc: 'running' }, agentStatuses: { cc: 'implementing' } });
    assert.strictEqual(result.action, 'attach');
});

test('getSessionAction returns attach when session running and agent waiting', () => {
    const result = getSessionAction('cc', { tmuxSessionStates: { cc: 'running' }, agentStatuses: { cc: 'waiting' } });
    assert.strictEqual(result.action, 'attach');
});

test('getSessionAction returns send-keys when session running but agent submitted', () => {
    const result = getSessionAction('cc', { tmuxSessionStates: { cc: 'running' }, agentStatuses: { cc: 'submitted' } });
    assert.strictEqual(result.action, 'send-keys');
    assert.strictEqual(result.needsAgentCommand, true);
});

test('getSessionAction returns send-keys when session running but agent errored', () => {
    const result = getSessionAction('cc', { tmuxSessionStates: { cc: 'running' }, agentStatuses: { cc: 'error' } });
    assert.strictEqual(result.action, 'send-keys');
});

// getRecommendedActions — high priority first
test('getRecommendedActions puts high-priority actions first', () => {
    const actions = getRecommendedActions('feature', 'in-progress', {
        agents: ['cc'],
        agentStatuses: { cc: 'waiting' },
        tmuxSessionStates: { cc: 'running' }
    });
    assert.ok(actions.length > 0, 'should have actions');
    // feature-focus is high priority
    assert.strictEqual(actions[0].action, 'feature-focus');
    assert.strictEqual(actions[0].priority, 'high');
});

test('getRecommendedActions returns fleet-eval as high priority when all submitted', () => {
    const actions = getRecommendedActions('feature', 'in-progress', {
        agents: ['cc', 'gg'],
        agentStatuses: { cc: 'submitted', gg: 'submitted' },
        tmuxSessionStates: {}
    });
    const first = actions[0];
    assert.ok(first, 'should have at least one action');
    assert.strictEqual(first.action, 'feature-eval');
});

// isActionValid
test('isActionValid returns true for valid transition', () => {
    assert.strictEqual(isActionValid('feature-prioritise', 'feature', 'inbox', {}), true);
});

test('isActionValid returns false for invalid transition from stage', () => {
    assert.strictEqual(isActionValid('feature-close', 'feature', 'inbox', {}), false);
});

test('isActionValid returns true for in-state action matching context', () => {
    assert.strictEqual(isActionValid('feature-open', 'feature', 'in-progress', {
        agents: ['cc'],
        agentStatuses: { cc: 'idle' }
    }), true);
});

test('isActionValid returns false when context blocks action', () => {
    // feature-eval in-progress requires all agents submitted
    assert.strictEqual(isActionValid('feature-eval', 'feature', 'in-progress', {
        agents: ['cc'],
        agentStatuses: { cc: 'implementing' }
    }), false);
});

test('isActionValid returns false for unknown entity type', () => {
    assert.strictEqual(isActionValid('foo-bar', 'unknown', 'inbox', {}), false);
});

// Transition labels
test('feature transitions have string labels', () => {
    const transitions = getValidTransitions('feature', 'inbox', {});
    transitions.forEach(t => {
        assert.strictEqual(typeof t.label, 'string', `label should be string, got ${typeof t.label}`);
    });
});

// Per-agent expansion for fleet
test('getAvailableActions expands per-agent actions for each agent in fleet', () => {
    const actions = getAvailableActions('feature', 'in-progress', {
        agents: ['cc', 'gg'],
        agentStatuses: { cc: 'idle', gg: 'idle' },
        tmuxSessionStates: {}
    });
    const openActions = actions.filter(a => a.action === 'feature-open');
    assert.ok(openActions.some(a => a.agentId === 'cc'), 'should have open for cc');
    assert.ok(openActions.some(a => a.agentId === 'gg'), 'should have open for gg');
});

// ── Analytics / Statistics tests ──────────────────────────────────────────────

console.log('\nparseLogFrontmatterFull');

test('parseLogFrontmatterFull parses simple frontmatter', () => {
    const content = '---\nstatus: implementing\nupdated: 2026-01-01T00:00:00Z\nstartedAt: 2026-01-01T00:00:00Z\n---\n\nBody text.';
    const { fields, events } = parseLogFrontmatterFull(content);
    assert.strictEqual(fields.status, 'implementing');
    assert.strictEqual(fields.startedAt, '2026-01-01T00:00:00Z');
    assert.deepStrictEqual(events, []);
});

test('parseLogFrontmatterFull parses events array', () => {
    const content = `---
status: submitted
updated: 2026-01-01T02:00:00Z
startedAt: 2026-01-01T00:00:00Z
events:
  - { ts: "2026-01-01T00:00:00Z", status: implementing }
  - { ts: "2026-01-01T01:00:00Z", status: waiting }
  - { ts: "2026-01-01T02:00:00Z", status: submitted }
---

Body.`;
    const { fields, events } = parseLogFrontmatterFull(content);
    assert.strictEqual(fields.status, 'submitted');
    assert.strictEqual(events.length, 3);
    assert.strictEqual(events[0].status, 'implementing');
    assert.strictEqual(events[1].status, 'waiting');
    assert.strictEqual(events[2].status, 'submitted');
});

test('parseLogFrontmatterFull returns empty for no frontmatter', () => {
    const { fields, events } = parseLogFrontmatterFull('No frontmatter here');
    assert.deepStrictEqual(fields, {});
    assert.deepStrictEqual(events, []);
});

console.log('\nserializeLogFrontmatter');

test('serializeLogFrontmatter writes fields in order', () => {
    const fields = { status: 'waiting', updated: '2026-01-01T00:00:00Z', startedAt: '2026-01-01T00:00:00Z' };
    const out = serializeLogFrontmatter(fields, []);
    assert.ok(out.startsWith('---\nstatus: waiting\n'));
    assert.ok(out.includes('startedAt:'));
    assert.ok(out.endsWith('---\n'));
});

test('serializeLogFrontmatter writes events array', () => {
    const fields = { status: 'submitted', updated: '2026-01-01T01:00:00Z' };
    const events = [
        { ts: '2026-01-01T00:00:00Z', status: 'implementing' },
        { ts: '2026-01-01T01:00:00Z', status: 'submitted' }
    ];
    const out = serializeLogFrontmatter(fields, events);
    assert.ok(out.includes('events:'));
    assert.ok(out.includes('  - { ts: "2026-01-01T00:00:00Z", status: implementing }'));
    assert.ok(out.includes('  - { ts: "2026-01-01T01:00:00Z", status: submitted }'));
});

console.log('\nupdateLogFrontmatterInPlace');

test('updateLogFrontmatterInPlace updates status and appends event', () => {
    withTempDir(tmpDir => {
        const logPath = path.join(tmpDir, 'test-log.md');
        const now = new Date().toISOString();
        fs.writeFileSync(logPath, `---\nstatus: implementing\nupdated: ${now}\nstartedAt: ${now}\nevents:\n  - { ts: "${now}", status: implementing }\n---\n\nBody.`);

        updateLogFrontmatterInPlace(logPath, { status: 'waiting', appendEvent: 'waiting' });

        const result = parseLogFrontmatterFull(fs.readFileSync(logPath, 'utf8'));
        assert.strictEqual(result.fields.status, 'waiting');
        assert.strictEqual(result.events.length, 2);
        assert.strictEqual(result.events[1].status, 'waiting');
        assert.ok(result.fields.startedAt, 'startedAt preserved');
    });
});

test('updateLogFrontmatterInPlace sets startedAt on first implementing', () => {
    withTempDir(tmpDir => {
        const logPath = path.join(tmpDir, 'test-log.md');
        fs.writeFileSync(logPath, `---\nstatus: implementing\nupdated: 2026-01-01T00:00:00Z\n---\n\nBody.`);
        updateLogFrontmatterInPlace(logPath, { status: 'implementing', appendEvent: 'implementing', setStartedAt: true });
        const result = parseLogFrontmatterFull(fs.readFileSync(logPath, 'utf8'));
        assert.ok(result.fields.startedAt, 'startedAt should be set');
    });
});

test('updateLogFrontmatterInPlace does not overwrite existing startedAt', () => {
    withTempDir(tmpDir => {
        const logPath = path.join(tmpDir, 'test-log.md');
        const origStarted = '2026-01-01T00:00:00Z';
        fs.writeFileSync(logPath, `---\nstatus: implementing\nupdated: 2026-01-01T00:00:00Z\nstartedAt: ${origStarted}\n---\n\nBody.`);
        updateLogFrontmatterInPlace(logPath, { status: 'waiting', appendEvent: 'waiting', setStartedAt: true });
        const result = parseLogFrontmatterFull(fs.readFileSync(logPath, 'utf8'));
        assert.strictEqual(result.fields.startedAt, origStarted);
    });
});

test('updateLogFrontmatterInPlace sets completedAt', () => {
    withTempDir(tmpDir => {
        const logPath = path.join(tmpDir, 'test-log.md');
        fs.writeFileSync(logPath, `---\nstatus: submitted\nupdated: 2026-01-01T01:00:00Z\nstartedAt: 2026-01-01T00:00:00Z\n---\n\nBody.`);
        updateLogFrontmatterInPlace(logPath, { setCompletedAt: '2026-01-01T02:00:00Z' });
        const result = parseLogFrontmatterFull(fs.readFileSync(logPath, 'utf8'));
        assert.strictEqual(result.fields.completedAt, '2026-01-01T02:00:00Z');
    });
});

console.log('\ncollectAnalyticsData');

test('collectAnalyticsData returns valid structure for empty repos', () => {
    withTempDir(tmpDir => {
        // Create a minimal repo structure with no completed features
        const doneDir = path.join(tmpDir, 'docs', 'specs', 'features', '05-done');
        fs.mkdirSync(doneDir, { recursive: true });

        // Point global config to our temp repo (requires mocking readConductorReposFromGlobalConfig)
        // Instead, test with an empty global config that points to our temp dir
        const globalCfgDir = path.join(tmpDir, '.aigon-global');
        fs.mkdirSync(globalCfgDir, { recursive: true });
        const globalCfgPath = path.join(globalCfgDir, 'config.json');
        fs.writeFileSync(globalCfgPath, JSON.stringify({ repos: [tmpDir] }, null, 2));

        // We call collectAnalyticsData with the global config directly (not via path)
        const analytics = collectAnalyticsData({ repos: [tmpDir], analytics: {} });
        assert.ok(analytics.generatedAt, 'has generatedAt');
        assert.ok(Array.isArray(analytics.features), 'has features array');
        assert.strictEqual(analytics.features.length, 0, 'no features');
        assert.ok(analytics.volume, 'has volume');
        assert.ok(analytics.autonomy, 'has autonomy');
        assert.ok(analytics.quality, 'has quality');
        assert.ok(Array.isArray(analytics.agents), 'has agents');
        assert.ok(Array.isArray(analytics.evalWins), 'has evalWins');
    });
});

test('collectAnalyticsData returns features from done specs with selected logs', () => {
    withTempDir(tmpDir => {
        const doneDir = path.join(tmpDir, 'docs', 'specs', 'features', '05-done');
        const selectedDir = path.join(tmpDir, 'docs', 'specs', 'features', 'logs', 'selected');
        fs.mkdirSync(doneDir, { recursive: true });
        fs.mkdirSync(selectedDir, { recursive: true });

        // Create a done spec
        fs.writeFileSync(path.join(doneDir, 'feature-01-test-feature.md'), '# Feature 01\n');

        // Create a selected log with full lifecycle metadata
        const startedAt = '2026-01-01T00:00:00Z';
        const completedAt = '2026-01-01T08:00:00Z';
        fs.writeFileSync(path.join(selectedDir, 'feature-01-cc-test-feature-log.md'),
            `---\nstatus: submitted\nupdated: ${completedAt}\nstartedAt: ${startedAt}\ncompletedAt: ${completedAt}\nevents:\n  - { ts: "${startedAt}", status: implementing }\n  - { ts: "${completedAt}", status: submitted }\n---\n\nLog body.`
        );

        const analytics = collectAnalyticsData({ repos: [tmpDir], analytics: {} });
        assert.strictEqual(analytics.features.length, 1);
        const f = analytics.features[0];
        assert.strictEqual(f.featureNum, '01');
        assert.strictEqual(f.winnerAgent, 'cc');
        assert.strictEqual(f.startedAt, startedAt);
        assert.strictEqual(f.completedAt, completedAt);
        assert.ok(f.durationMs > 0, 'duration should be positive');
        assert.strictEqual(f.firstPassSuccess, true, 'no wait events = first pass success');
    });
});

test('collectAnalyticsData respects cycleTimeExclude flag', () => {
    withTempDir(tmpDir => {
        const doneDir = path.join(tmpDir, 'docs', 'specs', 'features', '05-done');
        const selectedDir = path.join(tmpDir, 'docs', 'specs', 'features', 'logs', 'selected');
        fs.mkdirSync(doneDir, { recursive: true });
        fs.mkdirSync(selectedDir, { recursive: true });

        const startedAt = '2026-01-01T00:00:00Z';
        const normalCompletedAt = '2026-01-01T02:00:00Z'; // 2h
        const excludedCompletedAt = '2026-01-01T48:00:00Z'; // 48h (should be excluded)

        // Normal feature (2h cycle time)
        fs.writeFileSync(path.join(doneDir, 'feature-01-normal-feature.md'), '# Feature 01\n');
        fs.writeFileSync(path.join(selectedDir, 'feature-01-cc-normal-feature-log.md'),
            `---\nstatus: submitted\nupdated: ${normalCompletedAt}\nstartedAt: ${startedAt}\ncompletedAt: ${normalCompletedAt}\n---\n\nLog body.`
        );

        // Excluded feature (long cycle time, flagged)
        fs.writeFileSync(path.join(doneDir, 'feature-02-parked-feature.md'), '# Feature 02\n');
        fs.writeFileSync(path.join(selectedDir, 'feature-02-cc-parked-feature-log.md'),
            `---\nstatus: submitted\nupdated: ${excludedCompletedAt}\nstartedAt: ${startedAt}\ncompletedAt: ${excludedCompletedAt}\ncycleTimeExclude: true\n---\n\nLog body.`
        );

        const analytics = collectAnalyticsData({ repos: [tmpDir], analytics: {} });
        assert.strictEqual(analytics.features.length, 2, 'both features present');

        // cycleTimeExclude flag should be in payload
        const excluded = analytics.features.find(f => f.featureNum === '02');
        assert.ok(excluded, 'excluded feature present');
        assert.strictEqual(excluded.cycleTimeExclude, true, 'cycleTimeExclude=true for parked feature');

        const normal = analytics.features.find(f => f.featureNum === '01');
        assert.ok(normal, 'normal feature present');
        assert.strictEqual(normal.cycleTimeExclude, false, 'cycleTimeExclude=false for normal feature');
    });
});

test('collectAnalyticsData parses eval wins from evaluation files', () => {
    withTempDir(tmpDir => {
        const doneDir = path.join(tmpDir, 'docs', 'specs', 'features', '05-done');
        const evalsDir = path.join(tmpDir, 'docs', 'specs', 'features', 'evaluations');
        fs.mkdirSync(doneDir, { recursive: true });
        fs.mkdirSync(evalsDir, { recursive: true });

        const evalContent = `# Eval\n\n## Implementations\n\n- [x] **cc** (Claude): path\n- [x] **cx** (Codex): path\n\n## Verdict\n\n**Winner:** **cc** (Claude)`;
        fs.writeFileSync(path.join(evalsDir, 'feature-01-eval.md'), evalContent);

        const analytics = collectAnalyticsData({ repos: [tmpDir], analytics: {} });
        const ccEval = analytics.evalWins.find(e => e.agent === 'cc');
        const cxEval = analytics.evalWins.find(e => e.agent === 'cx');
        assert.ok(ccEval, 'cc should have eval data');
        assert.strictEqual(ccEval.wins, 1);
        assert.strictEqual(ccEval.evals, 1);
        assert.ok(cxEval, 'cx should have eval data');
        assert.strictEqual(cxEval.wins, 0);
        assert.strictEqual(cxEval.evals, 1);
    });
});

console.log('');
if (failed === 0) {
    console.log(`Passed: ${passed}`);
    process.exit(0);
}

console.error(`Failed: ${failed} of ${passed + failed}`);
process.exit(1);
