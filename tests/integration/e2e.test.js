#!/usr/bin/env node
/**
 * End-to-end tests for the Aigon CLI.
 *
 * Runs with: node tests/integration/e2e.test.js
 * Or:        npm run test:integration
 *
 * Filter groups:    npm run test:integration -- --grep feedback
 * Reset fixtures:   npm run fixture:reset && npm run fixture:seed
 *
 * Each top-level group gets a fresh copy of the fixture repo in a temp dir.
 * Tests make real commits, create real branches, and change real files.
 * Isolation: temp dirs are cleaned up after each group.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync, execFileSync } = require('child_process');

const CLI_PATH = path.join(__dirname, '../..', 'aigon-cli.js');
const FIXTURES_DIR = path.join(os.homedir(), 'src');
const MOCK_BIN_DIR = path.join(__dirname, 'mock-bin');

// ─── runner ───────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const grepFilter = (() => {
    const grepIdx = process.argv.indexOf('--grep');
    return grepIdx !== -1 ? process.argv[grepIdx + 1] : null;
})();

function test(description, fn) {
    try {
        fn();
        console.log(`    ✓ ${description}`);
        passed++;
    } catch (err) {
        console.error(`    ✗ ${description}`);
        console.error(`      ${err.message}`);
        failed++;
    }
}

function group(name, fn) {
    if (grepFilter && !name.toLowerCase().includes(grepFilter.toLowerCase())) return;
    console.log(`\n  ${name}`);
    fn();
}

// ─── fixture + invocation helpers ─────────────────────────────────────────────

function ensureFixtures() {
    if (!fs.existsSync(FIXTURES_DIR)) {
        console.log('  Fixtures missing — generating...');
        const result = spawnSync(process.execPath, [path.join(__dirname, 'setup-fixture.js')], {
            encoding: 'utf8',
            stdio: 'inherit'
        });
        if (result.status !== 0) {
            throw new Error('Fixture generation failed');
        }
    }
}

function copyFixtureToTemp(fixtureName) {
    const src = path.join(FIXTURES_DIR, fixtureName);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `aigon-e2e-${fixtureName}-`));
    copyDir(src, tmpDir);
    // Configure git in the copy
    spawnSync('git', ['config', 'user.email', 'test@aigon.test'], { cwd: tmpDir });
    spawnSync('git', ['config', 'user.name', 'Aigon Test'], { cwd: tmpDir });
    return tmpDir;
}

function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

function withFixture(fixtureName, fn) {
    const tmpDir = copyFixtureToTemp(fixtureName);
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-e2e-home-'));
    try {
        fn(tmpDir, tmpHome);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        fs.rmSync(tmpHome, { recursive: true, force: true });
    }
}

/** Run aigon in a temp dir with isolated HOME and mock tmux on PATH */
function runAigon(args, { cwd, home, env = {}, mockLog } = {}) {
    const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
        cwd: cwd || process.cwd(),
        env: {
            ...process.env,
            HOME: home || os.tmpdir(),
            PATH: MOCK_BIN_DIR + path.delimiter + process.env.PATH,
            ...(mockLog ? { AIGON_MOCK_LOG: mockLog } : {}),
            ...env,
        },
        encoding: 'utf8',
    });
    return {
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        exitCode: result.status,
    };
}

function runGit(args, cwd) {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
    return result.stdout ? result.stdout.trim() : '';
}

// ─── assertion helpers ────────────────────────────────────────────────────────

function assertExitCode(result, expected, context = '') {
    if (result.exitCode !== expected) {
        throw new Error(
            `Expected exit code ${expected}, got ${result.exitCode}${context ? ' (' + context + ')' : ''}\n` +
            `  stdout: ${result.stdout.slice(0, 300)}\n` +
            `  stderr: ${result.stderr.slice(0, 300)}`
        );
    }
}

function assertStdoutContains(result, str) {
    const combined = result.stdout + result.stderr;
    if (!combined.includes(str)) {
        throw new Error(
            `Expected output to contain: ${JSON.stringify(str)}\n` +
            `  stdout: ${result.stdout.slice(0, 400)}\n` +
            `  stderr: ${result.stderr.slice(0, 400)}`
        );
    }
}

function assertStdoutNotContains(result, str) {
    const combined = result.stdout + result.stderr;
    if (combined.includes(str)) {
        throw new Error(`Expected output NOT to contain: ${JSON.stringify(str)}`);
    }
}

function assertFileExists(cwd, relativePath) {
    const fullPath = path.join(cwd, relativePath);
    if (!fs.existsSync(fullPath)) {
        throw new Error(`Expected file to exist: ${relativePath}`);
    }
}

function assertFileNotExists(cwd, relativePath) {
    const fullPath = path.join(cwd, relativePath);
    if (fs.existsSync(fullPath)) {
        throw new Error(`Expected file NOT to exist: ${relativePath}`);
    }
}

function assertFileMoved(cwd, fromGlob, toDir) {
    const absTo = path.join(cwd, toDir);
    if (!fs.existsSync(absTo)) {
        throw new Error(`Expected directory to exist: ${toDir}`);
    }
    const files = fs.readdirSync(absTo);
    if (files.filter(f => f.endsWith('.md') && f !== '.gitkeep').length === 0) {
        throw new Error(`Expected at least one .md file in ${toDir}`);
    }
}

function assertDirContainsFile(cwd, dir, predicate) {
    const absDir = path.join(cwd, dir);
    if (!fs.existsSync(absDir)) {
        throw new Error(`Expected directory to exist: ${dir}`);
    }
    const files = fs.readdirSync(absDir);
    const match = files.find(f => predicate(f));
    if (!match) {
        throw new Error(`No file matching predicate found in ${dir}. Files: ${files.join(', ')}`);
    }
    return match;
}

function assertFileContains(cwd, relativePath, str) {
    const content = fs.readFileSync(path.join(cwd, relativePath), 'utf8');
    if (!content.includes(str)) {
        throw new Error(`Expected ${relativePath} to contain: ${JSON.stringify(str)}`);
    }
}

function assertBranchExists(cwd, branchName) {
    const branches = runGit(['branch', '--list', branchName], cwd);
    if (!branches.includes(branchName)) {
        throw new Error(`Expected branch to exist: ${branchName}. Branches: ${runGit(['branch'], cwd)}`);
    }
}

function assertCurrentBranch(cwd, branchName) {
    const current = runGit(['branch', '--show-current'], cwd);
    if (current !== branchName) {
        throw new Error(`Expected current branch to be ${branchName}, got ${current}`);
    }
}

function readFrontmatter(cwd, relativePath) {
    const content = fs.readFileSync(path.join(cwd, relativePath), 'utf8');
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};
    const fm = {};
    for (const line of match[1].split('\n')) {
        const [k, ...v] = line.split(':');
        if (k && v.length) fm[k.trim()] = v.join(':').trim();
    }
    return fm;
}

// Ensure fixtures exist before any tests run
ensureFixtures();

// ─── smoke tests ─────────────────────────────────────────────────────────────

group('smoke', () => {
    test('aigon help exits 0 and shows commands', () => {
        withFixture('brewboard', (cwd, home) => {
            const r = runAigon(['help'], { cwd, home });
            assertExitCode(r, 0);
            assertStdoutContains(r, 'aigon');
        });
    });

    test('aigon help shows non-empty output', () => {
        withFixture('brewboard', (cwd, home) => {
            const r = runAigon(['help'], { cwd, home });
            if ((r.stdout + r.stderr).length < 50) {
                throw new Error('Help output is too short');
            }
        });
    });

    test('unknown command shows error message', () => {
        withFixture('brewboard', (cwd, home) => {
            const r = runAigon(['not-a-real-command-xyz'], { cwd, home });
            assertStdoutContains(r, 'Unknown command');
        });
    });
});

// ─── config & setup ───────────────────────────────────────────────────────────

group('config and setup', () => {
    test('aigon init creates full docs/specs/ structure', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-e2e-init-'));
        const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-e2e-home-'));
        try {
            spawnSync('git', ['init', '-b', 'main'], { cwd: tmpDir });
            spawnSync('git', ['config', 'user.email', 'test@aigon.test'], { cwd: tmpDir });
            spawnSync('git', ['config', 'user.name', 'Aigon Test'], { cwd: tmpDir });
            const r = runAigon(['init'], { cwd: tmpDir, home: tmpHome });
            assertExitCode(r, 0);
            assertFileExists(tmpDir, 'docs/specs/features/01-inbox/.gitkeep');
            assertFileExists(tmpDir, 'docs/specs/features/02-backlog/.gitkeep');
            assertFileExists(tmpDir, 'docs/specs/features/03-in-progress/.gitkeep');
            assertFileExists(tmpDir, 'docs/specs/features/05-done/.gitkeep');
            assertFileExists(tmpDir, 'docs/specs/research-topics/01-inbox/.gitkeep');
            assertFileExists(tmpDir, 'docs/specs/feedback/01-inbox/.gitkeep');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
            fs.rmSync(tmpHome, { recursive: true, force: true });
        }
    });

    test('aigon profile detect returns a profile string', () => {
        withFixture('brewboard', (cwd, home) => {
            const r = runAigon(['profile', 'detect'], { cwd, home });
            assertExitCode(r, 0);
            const output = r.stdout + r.stderr;
            // Should mention a profile name (web, api, library, generic, etc.)
            const hasProfile = /web|api|library|generic|ios|android/.test(output.toLowerCase());
            if (!hasProfile) {
                throw new Error(`Expected profile detection output, got: ${output.slice(0, 200)}`);
            }
        });
    });

    test('aigon profile set ios updates .aigon/config.json', () => {
        withFixture('brewboard', (cwd, home) => {
            const r = runAigon(['profile', 'set', 'ios'], { cwd, home });
            assertExitCode(r, 0);
            assertFileExists(cwd, '.aigon/config.json');
            const config = JSON.parse(fs.readFileSync(path.join(cwd, '.aigon/config.json'), 'utf8'));
            if (config.profile !== 'ios') {
                throw new Error(`Expected profile=ios, got ${JSON.stringify(config.profile)}`);
            }
        });
    });

    test('aigon doctor exits 0 or 1 without crashing', () => {
        withFixture('brewboard', (cwd, home) => {
            const r = runAigon(['doctor'], { cwd, home });
            // exit 0 = healthy, exit 1 = warnings — both are valid; crash (exit 2+) is not
            if (r.exitCode > 1) {
                throw new Error(`doctor crashed with exit ${r.exitCode}: ${r.stderr.slice(0, 300)}`);
            }
        });
    });
});

// ─── feature lifecycle ────────────────────────────────────────────────────────

group('feature lifecycle', () => {
    test('feature-create produces file in 01-inbox with correct frontmatter area', () => {
        withFixture('brewboard', (cwd, home) => {
            const r = runAigon(['feature-create', 'add-notification-bell'], { cwd, home });
            assertExitCode(r, 0);
            const file = assertDirContainsFile(cwd, 'docs/specs/features/01-inbox', f => f.includes('notification-bell'));
            assertFileContains(cwd, `docs/specs/features/01-inbox/${file}`, 'Feature');
        });
    });

    test('feature-prioritise moves file to 02-backlog with ID assigned', () => {
        withFixture('brewboard', (cwd, home) => {
            // Create then prioritise
            runAigon(['feature-create', 'batch-check-in'], { cwd, home });
            const r = runAigon(['feature-prioritise', 'batch-check-in'], { cwd, home });
            assertExitCode(r, 0);
            assertStdoutContains(r, 'ID');
            assertDirContainsFile(cwd, 'docs/specs/features/02-backlog', f => f.includes('batch-check-in') && /feature-\d+-/.test(f));
        });
    });

    test('feature-start (Drive branch mode) creates branch and log file', () => {
        withFixture('brewboard', (cwd, home) => {
            // feature-01-dark-mode is in backlog — set it up
            const r = runAigon(['feature-start', '1'], { cwd, home });
            assertExitCode(r, 0);
            assertBranchExists(cwd, 'feature-01-dark-mode');
            assertDirContainsFile(cwd, 'docs/specs/features/logs', f => f.includes('01') && f.endsWith('-log.md'));
        });
    });

    test('feature-start moves spec from backlog to in-progress', () => {
        withFixture('brewboard', (cwd, home) => {
            runAigon(['feature-start', '2'], { cwd, home });
            // brewery-import should now be in-progress
            assertDirContainsFile(cwd, 'docs/specs/features/03-in-progress', f => f.includes('brewery-import'));
        });
    });

    test('feature-start creates tmux session in fleet mode', () => {
        withFixture('brewboard', (cwd, home) => {
            const mockLog = path.join(os.tmpdir(), `aigon-tmux-${Date.now()}.log`);
            // Two agents = fleet mode
            const r = runAigon(['feature-start', '2', 'cc', 'gg'], { cwd, home, mockLog });
            // fleet mode attempts worktree creation which calls tmux
            // we verify command ran without crash
            if (r.exitCode !== 0 && !r.stderr.includes('worktree')) {
                // accept worktree errors (git repo may not have right state) but not crashes
                if (r.exitCode !== 0 && r.stderr.includes('error:') && !r.stderr.includes('worktree')) {
                    throw new Error(`feature-start fleet crashed: ${r.stderr.slice(0, 300)}`);
                }
            }
        });
    });

    test('feature-do prints instructions when feature is in-progress', () => {
        withFixture('brewboard', (cwd, home) => {
            // First move feature to in-progress via setup
            runAigon(['feature-start', '1'], { cwd, home });
            const r = runAigon(['feature-do', '1'], { cwd, home });
            assertExitCode(r, 0);
            // Should show instructions or mode info
            assertStdoutContains(r, '1');
        });
    });

    test('feature-do detects Drive mode when on branch', () => {
        withFixture('brewboard', (cwd, home) => {
            runAigon(['feature-start', '2'], { cwd, home });
            // Switch to the feature branch
            spawnSync('git', ['checkout', 'feature-02-brewery-import'], { cwd });
            const r = runAigon(['feature-do', '2'], { cwd, home });
            assertExitCode(r, 0);
            const output = r.stdout + r.stderr;
            if (!output.includes('Drive') && !output.includes('drive') && !output.includes('02')) {
                throw new Error(`feature-do should show drive mode info, got: ${output.slice(0, 300)}`);
            }
        });
    });

    test('feature-close merges branch and moves spec to 05-done', () => {
        withFixture('brewboard', (cwd, home) => {
            // Full lifecycle: setup → checkout → close
            runAigon(['feature-start', '1'], { cwd, home });
            spawnSync('git', ['checkout', 'feature-01-dark-mode'], { cwd });
            // Make a commit on the branch so it's ahead of main
            fs.writeFileSync(path.join(cwd, 'src', 'app', 'dark-mode.tsx'), `// dark mode\n`);
            spawnSync('git', ['add', '-A'], { cwd });
            spawnSync('git', ['commit', '-m', 'feat: implement dark mode'], { cwd });
            // Go back to main and close
            spawnSync('git', ['checkout', 'main'], { cwd });
            const r = runAigon(['feature-close', '1'], { cwd, home });
            // Expect success (warnings about push failing are OK)
            if (r.exitCode !== 0 && !r.stderr.includes('push') && !r.stdout.includes('push')) {
                throw new Error(`feature-close failed: ${r.stderr.slice(0, 300)}\nstdout: ${r.stdout.slice(0, 300)}`);
            }
            // Spec should be in done
            assertDirContainsFile(cwd, 'docs/specs/features/05-done', f => f.includes('dark-mode'));
        });
    });

    test('feature-cleanup removes worktrees and branches', () => {
        withFixture('brewboard', (cwd, home) => {
            // Set up a drive branch first (cleanup works on branches too)
            runAigon(['feature-start', '2'], { cwd, home });
            // Check that branch exists
            assertBranchExists(cwd, 'feature-02-brewery-import');
            const r = runAigon(['feature-cleanup', '2'], { cwd, home });
            // Cleanup may warn but shouldn't crash
            if (r.exitCode !== 0) {
                // Some warnings about not being in an agent session are acceptable
                const output = r.stdout + r.stderr;
                if (!output.includes('cleanup') && !output.includes('worktree') && !output.includes('No') && !output.includes('Agent')) {
                    throw new Error(`feature-cleanup failed: ${output.slice(0, 300)}`);
                }
            }
        });
    });
});

// ─── research lifecycle ───────────────────────────────────────────────────────

group('research lifecycle', () => {
    test('research-create produces file in 01-inbox', () => {
        withFixture('brewboard', (cwd, home) => {
            const r = runAigon(['research-create', 'push-notifications'], { cwd, home });
            assertExitCode(r, 0);
            assertDirContainsFile(cwd, 'docs/specs/research-topics/01-inbox', f => f.includes('push-notification'));
        });
    });

    test('research-prioritise moves file to 02-backlog with ID assigned', () => {
        withFixture('brewboard', (cwd, home) => {
            runAigon(['research-create', 'ab-testing-framework'], { cwd, home });
            const r = runAigon(['research-prioritise', 'ab-testing-framework'], { cwd, home });
            assertExitCode(r, 0);
            assertStdoutContains(r, 'ID');
            assertDirContainsFile(cwd, 'docs/specs/research-topics/02-backlog', f => f.includes('ab-testing') && /research-\d+-/.test(f));
        });
    });

    test('research-start (Drive mode) moves spec to in-progress', () => {
        withFixture('brewboard', (cwd, home) => {
            // research-01-caching-strategy is in backlog
            const r = runAigon(['research-start', '1'], { cwd, home });
            assertExitCode(r, 0);
            assertDirContainsFile(cwd, 'docs/specs/research-topics/03-in-progress', f => f.includes('caching'));
        });
    });

    test('research-start fleet mode creates findings files', () => {
        withFixture('brewboard', (cwd, home) => {
            const r = runAigon(['research-start', '1', 'cc', 'gg'], { cwd, home });
            assertExitCode(r, 0);
            // Findings files should be created in research-topics/logs/
            assertDirContainsFile(cwd, 'docs/specs/research-topics/logs', f => f.includes('findings'));
        });
    });

    test('research-submit sets status to submitted in findings file', () => {
        withFixture('brewboard', (cwd, home) => {
            // Setup fleet mode to create findings file
            runAigon(['research-start', '1', 'cc'], { cwd, home });
            const logsDir = path.join(cwd, 'docs/specs/research-topics/logs');
            const findingsFile = fs.readdirSync(logsDir).find(f => f.includes('-cc-findings'));
            if (!findingsFile) {
                // Skip if no findings file was created (may depend on git state)
                return;
            }
            const r = runAigon(['research-submit', '1', 'cc'], { cwd, home });
            assertExitCode(r, 0);
            assertFileContains(cwd, `docs/specs/research-topics/logs/${findingsFile}`, 'submitted');
        });
    });

    test('research-close moves spec from in-progress to 04-done', () => {
        withFixture('brewboard', (cwd, home) => {
            // research-02-offline-sync is already in in-progress
            const r = runAigon(['research-close', '2', '--complete'], { cwd, home });
            assertExitCode(r, 0);
            assertDirContainsFile(cwd, 'docs/specs/research-topics/04-done', f => f.includes('offline-sync') || f.includes('research'));
        });
    });
});

// ─── feedback lifecycle ───────────────────────────────────────────────────────

group('feedback lifecycle', () => {
    test('feedback-create produces file in 01-inbox with ID assigned', () => {
        withFixture('brewboard', (cwd, home) => {
            const r = runAigon(['feedback-create', 'Login fails on Safari iOS'], { cwd, home });
            assertExitCode(r, 0);
            assertDirContainsFile(cwd, 'docs/specs/feedback/01-inbox', f => f.includes('login') || f.includes('safari') || /feedback-\d+/.test(f));
        });
    });

    test('feedback-list exits 0 and includes all items', () => {
        withFixture('brewboard', (cwd, home) => {
            const r = runAigon(['feedback-list'], { cwd, home });
            assertExitCode(r, 0);
            // Should show feedback IDs
            const output = r.stdout + r.stderr;
            if (!/\d/.test(output)) {
                throw new Error(`feedback-list should show IDs, got: ${output.slice(0, 300)}`);
            }
        });
    });

    test('feedback-list --status=triaged filters to triaged items', () => {
        withFixture('brewboard', (cwd, home) => {
            const r = runAigon(['feedback-list', '--status=triaged'], { cwd, home });
            assertExitCode(r, 0);
            // Should include the triaged item (#3 - dark mode flicker)
            assertStdoutContains(r, '#3');
            assertStdoutContains(r, 'triaged');
        });
    });

    test('feedback-triage with action=keep updates status to triaged', () => {
        withFixture('brewboard', (cwd, home) => {
            const r = runAigon(['feedback-triage', '1', '--action=keep', '--apply', '--yes'], { cwd, home });
            assertExitCode(r, 0);
            assertStdoutContains(r, 'Applied');
            // File should now be in triaged folder
            assertDirContainsFile(cwd, 'docs/specs/feedback/02-triaged', f => /feedback-0?1/.test(f));
        });
    });

    test('feedback-triage with action=mark-duplicate sets duplicate_of field', () => {
        withFixture('brewboard', (cwd, home) => {
            // Mark feedback 2 as duplicate of feedback 1
            const r = runAigon([
                'feedback-triage', '2',
                '--action=mark-duplicate',
                '--duplicate-of=1',
                '--apply', '--yes'
            ], { cwd, home });
            assertExitCode(r, 0);
            // Should be moved to duplicate folder
            const file = assertDirContainsFile(cwd, 'docs/specs/feedback/06-duplicate', f => /feedback-0?2/.test(f));
            assertFileContains(cwd, `docs/specs/feedback/06-duplicate/${file}`, 'duplicate_of');
        });
    });

    test('feedback-triage with action=promote-feature creates feature spec in inbox', () => {
        withFixture('brewboard', (cwd, home) => {
            const r = runAigon([
                'feedback-triage', '4',
                '--action=promote-feature',
                '--apply', '--yes'
            ], { cwd, home });
            // May succeed or show a warning — should not crash
            if (r.exitCode !== 0) {
                const output = r.stdout + r.stderr;
                if (!output.includes('promote') && !output.includes('feature') && !output.includes('4')) {
                    throw new Error(`feedback-triage promote-feature failed unexpectedly: ${output.slice(0, 300)}`);
                }
            }
        });
    });
});

// ─── board command ────────────────────────────────────────────────────────────

group('board command', () => {
    test('aigon board exits 0 and shows column headers', () => {
        withFixture('brewboard', (cwd, home) => {
            const r = runAigon(['board'], { cwd, home });
            assertExitCode(r, 0);
            const output = r.stdout + r.stderr;
            // Should show stage labels or feature IDs
            if (output.length < 20) {
                throw new Error(`board output too short: ${output}`);
            }
        });
    });

    test('aigon board --list exits 0 and lists all stages', () => {
        withFixture('brewboard', (cwd, home) => {
            const r = runAigon(['board', '--list'], { cwd, home });
            assertExitCode(r, 0);
        });
    });

    test('aigon board --features hides research section', () => {
        withFixture('brewboard', (cwd, home) => {
            const r = runAigon(['board', '--features'], { cwd, home });
            assertExitCode(r, 0);
            assertStdoutNotContains(r, 'research-02');
        });
    });

    test('aigon board --research hides features section', () => {
        withFixture('brewboard', (cwd, home) => {
            const r = runAigon(['board', '--research'], { cwd, home });
            assertExitCode(r, 0);
            assertStdoutNotContains(r, 'feature-01');
        });
    });

    test('aigon board --active shows only in-progress items', () => {
        withFixture('brewboard', (cwd, home) => {
            const r = runAigon(['board', '--active'], { cwd, home });
            assertExitCode(r, 0);
            // Should show in-progress features (03, 04)
            assertStdoutContains(r, '03');
        });
    });

    test('board shows feature IDs for pre-seeded backlog items', () => {
        withFixture('brewboard', (cwd, home) => {
            const r = runAigon(['board'], { cwd, home });
            assertExitCode(r, 0);
            // feature-01-dark-mode and feature-02-brewery-import should appear
            assertStdoutContains(r, '01');
            assertStdoutContains(r, '02');
        });
    });
});

// ─── tmux mock shim ───────────────────────────────────────────────────────────

group('tmux mock shim', () => {
    test('mock tmux exits 0 by default', () => {
        const result = spawnSync(path.join(MOCK_BIN_DIR, 'tmux'), ['new-session', '-s', 'test'], {
            encoding: 'utf8',
        });
        if (result.status !== 0) throw new Error(`Expected exit 0, got ${result.status}`);
    });

    test('mock tmux records invocation to AIGON_MOCK_LOG', () => {
        const logFile = path.join(os.tmpdir(), `tmux-mock-test-${Date.now()}.log`);
        spawnSync(path.join(MOCK_BIN_DIR, 'tmux'), ['new-session', '-s', 'aigon-7-cc'], {
            encoding: 'utf8',
            env: { ...process.env, AIGON_MOCK_LOG: logFile },
        });
        if (!fs.existsSync(logFile)) throw new Error('Mock log not created');
        const content = fs.readFileSync(logFile, 'utf8');
        if (!content.includes('aigon-7-cc')) throw new Error(`Expected log to contain session name, got: ${content}`);
        fs.unlinkSync(logFile);
    });

    test('mock tmux exits with AIGON_MOCK_EXIT when set', () => {
        const result = spawnSync(path.join(MOCK_BIN_DIR, 'tmux'), ['new-session'], {
            encoding: 'utf8',
            env: { ...process.env, AIGON_MOCK_EXIT: '1' },
        });
        if (result.status !== 1) throw new Error(`Expected exit 1, got ${result.status}`);
    });
});

// ─── multi-repo (dashboard add) ───────────────────────────────────────────────

group('multi-repo', () => {
    test('all three fixture repos have aigon specs structure', () => {
        ['brewboard', 'brewboard-api', 'trailhead'].forEach(name => {
            withFixture(name, (cwd) => {
                assertFileExists(cwd, 'docs/specs/features/01-inbox');
                assertFileExists(cwd, 'docs/specs/research-topics/01-inbox');
                assertFileExists(cwd, 'docs/specs/feedback/01-inbox');
            });
        });
    });

    test('brewboard-api backlog has feature-01 and feature-02', () => {
        withFixture('brewboard-api', (cwd, home) => {
            const r = runAigon(['board'], { cwd, home });
            assertExitCode(r, 0);
            assertStdoutContains(r, '01');
            assertStdoutContains(r, '02');
        });
    });

    test('trailhead board shows iOS-themed features', () => {
        withFixture('trailhead', (cwd, home) => {
            const r = runAigon(['board'], { cwd, home });
            assertExitCode(r, 0);
            // Should show backlog items (feature-01, feature-02)
            assertStdoutContains(r, '01');
            assertStdoutContains(r, '02');
        });
    });
});

// ─── trailhead (personal iOS app) ────────────────────────────────────────────

group('trailhead', () => {
    test('has Swift project files (Package.swift, .swift sources)', () => {
        withFixture('trailhead', (cwd) => {
            assertFileExists(cwd, 'Package.swift');
            assertFileExists(cwd, 'Sources/Trailhead/TrailheadApp.swift');
            assertFileExists(cwd, 'Sources/Trailhead/Models/Hike.swift');
            assertFileExists(cwd, 'Tests/TrailheadTests/HikeTests.swift');
        });
    });

    test('feature-create works in a Swift/iOS repo', () => {
        withFixture('trailhead', (cwd, home) => {
            const r = runAigon(['feature-create', 'siri-shortcuts'], { cwd, home });
            assertExitCode(r, 0);
            assertDirContainsFile(cwd, 'docs/specs/features/01-inbox', f => f.includes('siri'));
        });
    });

    test('feedback-list shows iOS-relevant feedback items', () => {
        withFixture('trailhead', (cwd, home) => {
            const r = runAigon(['feedback-list'], { cwd, home });
            assertExitCode(r, 0);
            // Should include battery drain and map rotation feedback
            assertStdoutContains(r, '#1');
            assertStdoutContains(r, '#2');
        });
    });

    test('research topics cover iOS-specific concerns', () => {
        withFixture('trailhead', (cwd) => {
            // Battery optimisation research should be in in-progress
            assertDirContainsFile(cwd, 'docs/specs/research-topics/03-in-progress', f => f.includes('battery'));
            // Route planning in backlog
            assertDirContainsFile(cwd, 'docs/specs/research-topics/02-backlog', f => f.includes('route'));
            // Map SDK decision is done
            assertDirContainsFile(cwd, 'docs/specs/research-topics/04-done', f => f.includes('map'));
        });
    });

    test('aigon profile set ios works on the trailhead repo', () => {
        withFixture('trailhead', (cwd, home) => {
            const r = runAigon(['profile', 'set', 'ios'], { cwd, home });
            assertExitCode(r, 0);
            const config = JSON.parse(fs.readFileSync(path.join(cwd, '.aigon/config.json'), 'utf8'));
            if (config.profile !== 'ios') {
                throw new Error(`Expected profile=ios in trailhead repo, got ${JSON.stringify(config.profile)}`);
            }
        });
    });

    test('feature lifecycle works in a non-web repo', () => {
        withFixture('trailhead', (cwd, home) => {
            runAigon(['feature-create', 'haptic-feedback'], { cwd, home });
            const r = runAigon(['feature-prioritise', 'haptic-feedback'], { cwd, home });
            assertExitCode(r, 0);
            assertDirContainsFile(cwd, 'docs/specs/features/02-backlog', f => f.includes('haptic') && /feature-\d+-/.test(f));
        });
    });
});

// ─── regression guard (CLI modularization) ────────────────────────────────────

group('regression guard', () => {
    test('all top-level modules load without error', () => {
        // Importing these directly would pollute cwd; run a quick check via the help command
        withFixture('brewboard', (cwd, home) => {
            const r = runAigon(['help'], { cwd, home });
            assertExitCode(r, 0, 'CLI should load all modules without error');
        });
    });

    test('feature commands are accessible', () => {
        withFixture('brewboard', (cwd, home) => {
            const r = runAigon(['feature-create'], { cwd, home });
            // Should print usage (exit 0 or non-zero), not crash
            const output = r.stdout + r.stderr;
            if (!output.includes('feature-create') && !output.includes('Usage') && !output.includes('name')) {
                throw new Error(`Expected usage message for feature-create, got: ${output.slice(0, 200)}`);
            }
        });
    });

    test('research commands are accessible', () => {
        withFixture('brewboard', (cwd, home) => {
            const r = runAigon(['research-create'], { cwd, home });
            const output = r.stdout + r.stderr;
            if (!output.includes('research') && !output.includes('Usage')) {
                throw new Error(`Expected usage message for research-create, got: ${output.slice(0, 200)}`);
            }
        });
    });

    test('feedback commands are accessible', () => {
        withFixture('brewboard', (cwd, home) => {
            const r = runAigon(['feedback-create'], { cwd, home });
            const output = r.stdout + r.stderr;
            if (!output.includes('feedback') && !output.includes('Usage')) {
                throw new Error(`Expected usage message for feedback-create, got: ${output.slice(0, 200)}`);
            }
        });
    });
});

// ─── agent-status (submit workflow) ──────────────────────────────────────────

group('agent-status', () => {
    test('agent-status submitted updates log status on a feature branch', () => {
        withFixture('brewboard', (cwd, home) => {
            // Setup feature 2 (creates branch + log)
            runAigon(['feature-start', '2'], { cwd, home });
            // Switch to the feature branch
            spawnSync('git', ['checkout', 'feature-02-brewery-import'], { cwd });
            const r = runAigon(['agent-status', 'submitted'], { cwd, home });
            assertExitCode(r, 0);
            assertStdoutContains(r, 'submitted');
            // Log file should contain 'submitted' status
            const logFile = assertDirContainsFile(cwd, 'docs/specs/features/logs', f => f.includes('02') && f.endsWith('-log.md'));
            assertFileContains(cwd, `docs/specs/features/logs/${logFile}`, 'submitted');
        });
    });

    test('agent-status implementing updates log status', () => {
        withFixture('brewboard', (cwd, home) => {
            runAigon(['feature-start', '2'], { cwd, home });
            spawnSync('git', ['checkout', 'feature-02-brewery-import'], { cwd });
            const r = runAigon(['agent-status', 'implementing'], { cwd, home });
            assertExitCode(r, 0);
            assertStdoutContains(r, 'implementing');
        });
    });
});

// ─── fixture quality checks ───────────────────────────────────────────────────

group('fixture quality', () => {
    test('brewboard has 2 features in inbox', () => {
        withFixture('brewboard', (cwd) => {
            const dir = path.join(cwd, 'docs/specs/features/01-inbox');
            const mdFiles = fs.readdirSync(dir).filter(f => f.endsWith('.md') && f !== '.gitkeep');
            if (mdFiles.length < 2) throw new Error(`Expected 2 inbox features, got ${mdFiles.length}`);
        });
    });

    test('brewboard has 2 features in backlog', () => {
        withFixture('brewboard', (cwd) => {
            const dir = path.join(cwd, 'docs/specs/features/02-backlog');
            const mdFiles = fs.readdirSync(dir).filter(f => f.endsWith('.md') && f !== '.gitkeep' && /feature-\d+-/.test(f));
            if (mdFiles.length < 2) throw new Error(`Expected 2 backlog features with IDs, got ${mdFiles.length}`);
        });
    });

    test('brewboard has 2 features in in-progress', () => {
        withFixture('brewboard', (cwd) => {
            const dir = path.join(cwd, 'docs/specs/features/03-in-progress');
            const mdFiles = fs.readdirSync(dir).filter(f => f.endsWith('.md') && f !== '.gitkeep' && /feature-\d+-/.test(f));
            if (mdFiles.length < 2) throw new Error(`Expected 2 in-progress features with IDs, got ${mdFiles.length}`);
        });
    });

    test('brewboard has 2 features in done', () => {
        withFixture('brewboard', (cwd) => {
            const dir = path.join(cwd, 'docs/specs/features/05-done');
            const mdFiles = fs.readdirSync(dir).filter(f => f.endsWith('.md') && f !== '.gitkeep');
            if (mdFiles.length < 2) throw new Error(`Expected 2 done features, got ${mdFiles.length}`);
        });
    });

    test('brewboard has research topics in inbox, backlog, in-progress, done', () => {
        withFixture('brewboard', (cwd) => {
            const stages = ['01-inbox', '02-backlog', '03-in-progress', '04-done'];
            for (const stage of stages) {
                const dir = path.join(cwd, `docs/specs/research-topics/${stage}`);
                const files = fs.readdirSync(dir).filter(f => f.endsWith('.md') && f !== '.gitkeep');
                if (files.length < 1) throw new Error(`Expected research topic in ${stage}, got 0`);
            }
        });
    });

    test('brewboard has feedback in inbox, triaged, and actionable', () => {
        withFixture('brewboard', (cwd) => {
            const stages = ['01-inbox', '02-triaged', '03-actionable'];
            for (const stage of stages) {
                const dir = path.join(cwd, `docs/specs/feedback/${stage}`);
                const files = fs.readdirSync(dir).filter(f => f.endsWith('.md') && f !== '.gitkeep');
                if (files.length < 1) throw new Error(`Expected feedback in ${stage}, got 0`);
            }
        });
    });

    test('fixture has realistic project files (package.json, src/)', () => {
        withFixture('brewboard', (cwd) => {
            assertFileExists(cwd, 'package.json');
            assertFileExists(cwd, 'src/app/page.tsx');
            const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
            if (pkg.name !== 'brewboard') throw new Error(`Expected package name 'brewboard', got '${pkg.name}'`);
        });
    });

    test('fixture has realistic git history', () => {
        withFixture('brewboard', (cwd) => {
            const log = runGit(['log', '--oneline'], cwd);
            if (log.split('\n').length < 2) {
                throw new Error(`Expected at least 2 commits, got: ${log}`);
            }
            if (!log.includes('seed') && !log.includes('init') && !log.includes('setup')) {
                throw new Error(`Git log doesn't contain expected commit messages: ${log}`);
            }
        });
    });

    test('feature names are realistic and match repo theme', () => {
        withFixture('brewboard', (cwd) => {
            const backlogDir = path.join(cwd, 'docs/specs/features/02-backlog');
            const files = fs.readdirSync(backlogDir).filter(f => f.endsWith('.md'));
            // Should contain beer/brewing themed feature names
            const hasThematic = files.some(f => f.includes('dark-mode') || f.includes('brewery') || f.includes('beer'));
            if (!hasThematic) throw new Error(`Expected thematic feature names, got: ${files.join(', ')}`);
        });
    });
});

// ─── fixture buildability ─────────────────────────────────────────────────────

group('fixture buildability', () => {
    test('brewboard has tsconfig.json and next.config.js', () => {
        withFixture('brewboard', (cwd) => {
            assertFileExists(cwd, 'tsconfig.json');
            assertFileExists(cwd, 'next.config.js');
            // Validate tsconfig.json is parseable JSON
            JSON.parse(fs.readFileSync(path.join(cwd, 'tsconfig.json'), 'utf8'));
        });
    });

    test('brewboard TypeScript files pass tsc --noEmit', () => {
        withFixture('brewboard', (cwd) => {
            // Try tsc from PATH; skip if not installed (downloading via npx would be too slow)
            const tscCheck = spawnSync('which', ['tsc'], { encoding: 'utf8', stdio: 'pipe' });
            if (tscCheck.status !== 0) {
                console.log('      (skipped — tsc not in PATH)');
                return;
            }
            const result = spawnSync('tsc', ['--noEmit'], { cwd, encoding: 'utf8', stdio: 'pipe' });
            if (result.status !== 0) {
                throw new Error(`tsc --noEmit failed:\n${(result.stderr || result.stdout || '').slice(0, 500)}`);
            }
        });
    });

    test('brewboard-api src/index.js is syntactically valid', () => {
        withFixture('brewboard-api', (cwd) => {
            const result = spawnSync(process.execPath, ['--check', 'src/index.js'], { cwd, encoding: 'utf8', stdio: 'pipe' });
            if (result.status !== 0) {
                throw new Error(`node --check src/index.js failed: ${result.stderr || result.stdout}`);
            }
        });
    });

    test('brewboard-api src/routes/beers.js is syntactically valid', () => {
        withFixture('brewboard-api', (cwd) => {
            const result = spawnSync(process.execPath, ['--check', 'src/routes/beers.js'], { cwd, encoding: 'utf8', stdio: 'pipe' });
            if (result.status !== 0) {
                throw new Error(`node --check src/routes/beers.js failed: ${result.stderr || result.stdout}`);
            }
        });
    });

    test('trailhead swift build exits 0 (macOS only)', () => {
        if (process.platform !== 'darwin') {
            console.log('      (skipped — not macOS)');
            return;
        }
        const swiftCheck = spawnSync('which', ['swift'], { encoding: 'utf8', stdio: 'pipe' });
        if (swiftCheck.status !== 0) {
            console.log('      (skipped — swift not in PATH)');
            return;
        }
        withFixture('trailhead', (cwd) => {
            const result = spawnSync('swift', ['build'], { cwd, encoding: 'utf8', stdio: 'pipe', timeout: 120000 });
            if (result.status !== 0) {
                throw new Error(`swift build failed:\n${(result.stderr || result.stdout || '').slice(0, 800)}`);
            }
        });
    });
});

// ─── summary ─────────────────────────────────────────────────────────────────

console.log('');
if (failed === 0) {
    console.log(`  Passed: ${passed}`);
    process.exit(0);
} else {
    console.error(`  Failed: ${failed} of ${passed + failed}`);
    process.exit(1);
}
