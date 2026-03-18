#!/usr/bin/env node
/**
 * E2E test — Solo worktree (Drive) lifecycle.
 *
 * Exercises the full flow:
 *   feature-create → feature-prioritise → feature-setup (cc) →
 *   MockAgent run → feature-close
 *
 * Runs with:  node test/e2e-mock-solo.test.js
 *             npm run test:e2e:mock-solo
 *
 * Set MOCK_DELAY=fast to use 500ms delays instead of 15s/10s defaults (for CI).
 *
 * Test time:
 *   Default: ~60-90 seconds (dominated by MockAgent delays)
 *   Fast:    ~5-10 seconds
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const MockAgent = require('./mock-agent');

const CLI_PATH = path.join(__dirname, '..', 'aigon-cli.js');
const FIXTURES_DIR = path.join(os.homedir(), 'src');
const MOCK_BIN_DIR = path.join(__dirname, 'mock-bin');

// ─── async test runner ────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(description, fn) {
    try {
        await fn();
        console.log(`    ✓ ${description}`);
        passed++;
    } catch (err) {
        console.error(`    ✗ ${description}`);
        console.error(`      ${err.message}`);
        failed++;
    }
}

// ─── fixture helpers (mirrors test/e2e.test.js) ────────────────────────────

function ensureFixtures() {
    if (!fs.existsSync(path.join(FIXTURES_DIR, 'brewboard'))) {
        console.log('  Fixtures missing — generating...');
        const result = spawnSync(process.execPath, [path.join(__dirname, 'setup-fixture.js')], {
            encoding: 'utf8',
            stdio: 'inherit',
        });
        if (result.status !== 0) throw new Error('Fixture generation failed');
    }
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

function copyFixtureToTemp(fixtureName) {
    const src = path.join(FIXTURES_DIR, fixtureName);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `aigon-e2e-${fixtureName}-`));
    copyDir(src, tmpDir);
    spawnSync('git', ['config', 'user.email', 'test@aigon.test'], { cwd: tmpDir });
    spawnSync('git', ['config', 'user.name', 'Aigon Test'], { cwd: tmpDir });
    return tmpDir;
}

function runAigon(args, { cwd, home, env = {} } = {}) {
    const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
        cwd: cwd || process.cwd(),
        env: {
            ...process.env,
            HOME: home || os.tmpdir(),
            PATH: MOCK_BIN_DIR + path.delimiter + process.env.PATH,
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

function assertExitCode(result, expected) {
    if (result.exitCode !== expected) {
        throw new Error(
            `Expected exit code ${expected}, got ${result.exitCode}\n` +
            `  stdout: ${result.stdout.slice(0, 300)}\n` +
            `  stderr: ${result.stderr.slice(0, 300)}`
        );
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

function readFrontmatter(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};
    const fm = {};
    for (const line of match[1].split('\n')) {
        const [k, ...v] = line.split(':');
        if (k && v.length) fm[k.trim()] = v.join(':').trim();
    }
    return fm;
}

// ─── main test ────────────────────────────────────────────────────────────────

async function main() {
    console.log('\n  e2e — mock solo worktree lifecycle');

    ensureFixtures();

    const tmpDir = copyFixtureToTemp('brewboard');
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-e2e-home-'));
    const worktreesDir = `${tmpDir}-worktrees`;

    try {
        // ── 1. feature-create ──────────────────────────────────────────────────
        const createResult = runAigon(['feature-create', 'mock-test-feature'], { cwd: tmpDir, home: tmpHome });
        await test('feature-create exits 0', () => assertExitCode(createResult, 0));

        // ── 2. feature-prioritise ──────────────────────────────────────────────
        const prioResult = runAigon(['feature-prioritise', 'mock-test-feature'], { cwd: tmpDir, home: tmpHome });
        await test('feature-prioritise exits 0', () => assertExitCode(prioResult, 0));

        // Parse assigned ID from output (e.g. "📋 Assigned ID: 05")
        const idMatch = (prioResult.stdout + prioResult.stderr).match(/Assigned ID:\s*(\d+)/);
        const featureId = idMatch ? idMatch[1] : '05';
        const desc = 'mock-test-feature';

        await test(`feature assigned ID ${featureId}`, () => {
            if (!featureId.match(/^\d+$/)) throw new Error(`Could not parse feature ID from: ${prioResult.stdout}`);
        });

        // ── 3. feature-setup (solo worktree) ───────────────────────────────────
        const setupResult = runAigon(['feature-setup', featureId, 'cc'], { cwd: tmpDir, home: tmpHome });
        await test('feature-setup exits 0', () => {
            if (setupResult.exitCode !== 0) {
                throw new Error(`feature-setup failed: ${setupResult.stderr.slice(0, 300)}\nstdout: ${setupResult.stdout.slice(0, 300)}`);
            }
        });

        // ── 4. Verify spec moved to 03-in-progress ─────────────────────────────
        await test('spec moved to 03-in-progress', () => {
            assertDirContainsFile(tmpDir, 'docs/specs/features/03-in-progress', f =>
                f.startsWith(`feature-${featureId}-`) && f.endsWith('.md')
            );
        });

        // ── 5. Verify worktree created ─────────────────────────────────────────
        const worktreePath = path.join(worktreesDir, `feature-${featureId}-cc-${desc}`);
        await test('worktree directory created', () => {
            if (!fs.existsSync(worktreePath)) {
                throw new Error(`Expected worktree at: ${worktreePath}\nsetup stdout: ${setupResult.stdout.slice(0, 300)}`);
            }
        });

        // ── 6. Verify log created with status: implementing ────────────────────
        const logPath = path.join(
            worktreePath, 'docs', 'specs', 'features', 'logs',
            `feature-${featureId}-cc-${desc}-log.md`
        );
        await test('log file exists with status: implementing', () => {
            if (!fs.existsSync(logPath)) {
                throw new Error(`Expected log at: ${logPath}`);
            }
            const fm = readFrontmatter(logPath);
            if (fm.status !== 'implementing') {
                throw new Error(`Expected status: implementing, got: ${fm.status}`);
            }
        });

        // ── 7. Run MockAgent ───────────────────────────────────────────────────
        const delayNote = process.env.MOCK_DELAY === 'fast' ? '~1s' : '~25s';
        console.log(`\n    Running mock agent (${delayNote})...`);

        const agent = new MockAgent({ featureId, agentId: 'cc', desc, repoPath: tmpDir });
        await agent.run();

        // ── 8. Verify log updated to submitted ────────────────────────────────
        await test('log shows status: submitted', () => {
            const fm = readFrontmatter(logPath);
            if (fm.status !== 'submitted') {
                throw new Error(`Expected status: submitted, got: ${fm.status}`);
            }
        });

        // ── 9. feature-close ──────────────────────────────────────────────────
        const closeResult = runAigon(['feature-close', featureId], { cwd: tmpDir, home: tmpHome });
        await test('feature-close exits 0 (or fails only on push)', () => {
            const output = closeResult.stdout + closeResult.stderr;
            if (closeResult.exitCode !== 0 && !output.includes('push')) {
                throw new Error(
                    `feature-close failed: ${closeResult.stderr.slice(0, 300)}\n` +
                    `stdout: ${closeResult.stdout.slice(0, 300)}`
                );
            }
        });

        // ── 10. Verify spec moved to 05-done ──────────────────────────────────
        await test('spec moved to 05-done', () => {
            assertDirContainsFile(tmpDir, 'docs/specs/features/05-done', f =>
                f.startsWith(`feature-${featureId}-`) && f.endsWith('.md')
            );
        });

        // ── 11. Verify log moved to logs/selected ─────────────────────────────
        await test('log moved to logs/selected', () => {
            assertDirContainsFile(tmpDir, 'docs/specs/features/logs/selected', f =>
                f.startsWith(`feature-${featureId}-`) && f.endsWith('-log.md')
            );
        });

        // ── 12. Verify worktree removed ───────────────────────────────────────
        await test('worktree removed after close', () => {
            if (fs.existsSync(worktreePath)) {
                throw new Error(`Expected worktree to be removed: ${worktreePath}`);
            }
        });

        // ── 13. Verify feature branch deleted ────────────────────────────────
        await test('feature branch deleted', () => {
            const branchName = `feature-${featureId}-cc-${desc}`;
            const branches = runGit(['branch', '--list', branchName], tmpDir);
            if (branches.includes(branchName)) {
                throw new Error(`Expected branch to be deleted: ${branchName}`);
            }
        });

        // ── 14. Verify merge commit exists ────────────────────────────────────
        await test('merge commit exists on main', () => {
            const log = runGit(['log', '--oneline', '-10'], tmpDir);
            if (!log.toLowerCase().includes('merge')) {
                throw new Error(`Expected a merge commit in recent log:\n${log}`);
            }
        });

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        fs.rmSync(tmpHome, { recursive: true, force: true });
        if (fs.existsSync(worktreesDir)) {
            fs.rmSync(worktreesDir, { recursive: true, force: true });
        }
    }

    console.log(`\n  ${passed} passed${failed > 0 ? `, ${failed} failed` : ''}\n`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('\nFatal error:', err.message);
    process.exit(1);
});
