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
const { createAllCommands, collectIncompleteFeatureEvalAgents, parseFrontMatterStatus } = require('./lib/commands/shared');
const { parseSimpleFrontMatter } = require('./lib/dashboard');
const { buildTmuxSessionName, buildResearchTmuxSessionName, matchTmuxSessionByEntityId, shellQuote, toUnpaddedId } = require('./lib/worktree');
const { isSameProviderFamily } = require('./lib/utils');

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

console.log('\nWorktree Helpers');
test('toUnpaddedId removes leading zeros', () => assert.strictEqual(toUnpaddedId('040'), '40'));
test('toUnpaddedId keeps non-numeric IDs unchanged', () => assert.strictEqual(toUnpaddedId('abc'), 'abc'));
test('buildTmuxSessionName includes repo and unpadded ID', () => assert.strictEqual(buildTmuxSessionName('040', 'cx'), 'aigon-f40-cx'));
test('buildTmuxSessionName defaults agent to solo', () => assert.strictEqual(buildTmuxSessionName('40'), 'aigon-f40-solo'));
test('buildTmuxSessionName includes desc when provided', () => assert.strictEqual(buildTmuxSessionName('7', 'cc', { repo: 'myrepo', desc: 'dark-mode' }), 'myrepo-f7-cc-dark-mode'));
test('buildResearchTmuxSessionName uses repo prefix', () => assert.strictEqual(buildResearchTmuxSessionName('5', 'gg', { repo: 'myrepo' }), 'myrepo-r5-gg'));
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
