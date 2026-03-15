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
    isRadarAutoEvalEnabled,
    buildRadarFeatureEvalSessionName,
    shouldRadarAutoEvalFeature,
    RADAR_INTERACTIVE_ACTIONS,
    resolveRadarActionRepoPath,
    parseRadarActionRequest,
    buildRadarActionCommandArgs,
    collectDashboardStatusData
} = require('./lib/dashboard');
const { buildTmuxSessionName, buildResearchTmuxSessionName, matchTmuxSessionByEntityId, shellQuote, toUnpaddedId } = require('./lib/worktree');
const { isSameProviderFamily, getProfilePlaceholders } = require('./lib/utils');

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

console.log('\nRadar Auto-Eval');
test('isRadarAutoEvalEnabled defaults to true when unset', () => {
    assert.strictEqual(isRadarAutoEvalEnabled({}), true);
    assert.strictEqual(isRadarAutoEvalEnabled({ conductor: {} }), true);
});
test('isRadarAutoEvalEnabled can be disabled via top-level autoEval=false', () => {
    assert.strictEqual(isRadarAutoEvalEnabled({ autoEval: false }), false);
});
test('isRadarAutoEvalEnabled can be disabled via conductor.autoEval=false', () => {
    assert.strictEqual(isRadarAutoEvalEnabled({ conductor: { autoEval: false } }), false);
});
test('buildRadarFeatureEvalSessionName uses repo basename and eval suffix', () => {
    assert.strictEqual(
        buildRadarFeatureEvalSessionName('/tmp/my-repo', '053'),
        'my-repo-f53-ev-eval'
    );
});

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
test('shouldRadarAutoEvalFeature triggers only for submitted Fleet in-progress features', () => {
    const should = shouldRadarAutoEvalFeature({
        id: '53',
        stage: 'in-progress',
        agents: [
            { id: 'cc', status: 'submitted' },
            { id: 'gg', status: 'submitted' }
        ]
    });
    assert.strictEqual(should, true);
});
test('shouldRadarAutoEvalFeature does not trigger for solo features', () => {
    const should = shouldRadarAutoEvalFeature({
        id: '53',
        stage: 'in-progress',
        agents: [{ id: 'solo', status: 'submitted' }]
    });
    assert.strictEqual(should, false);
});
test('shouldRadarAutoEvalFeature does not trigger in evaluation stage', () => {
    const should = shouldRadarAutoEvalFeature({
        id: '53',
        stage: 'in-evaluation',
        agents: [
            { id: 'cc', status: 'submitted' },
            { id: 'gg', status: 'submitted' }
        ]
    });
    assert.strictEqual(should, false);
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
test('parseRadarActionRequest accepts worktree-open action', () => {
    const parsed = parseRadarActionRequest(
        { action: 'worktree-open', args: ['57', 'cc'], repoPath: '/tmp/repo-a' },
        { registeredRepos: ['/tmp/repo-a'], defaultRepoPath: '/tmp/repo-a' }
    );
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.action, 'worktree-open');
    assert.deepStrictEqual(parsed.args, ['57', 'cc']);
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

console.log('');
if (failed === 0) {
    console.log(`Passed: ${passed}`);
    process.exit(0);
}

console.error(`Failed: ${failed} of ${passed + failed}`);
process.exit(1);
