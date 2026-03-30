#!/usr/bin/env node
/**
 * E2E test: Full solo worktree (Drive) lifecycle with mock agent.
 *
 * Exercises: feature-create → prioritise → setup (cc) → mock-do → close
 *
 * Run: node tests/integration/e2e-mock-solo.test.js
 * Or:  npm run test:integration:mock-solo
 *
 * Separate from main e2e suite due to timing (~30s dominated by mock agent pauses).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { MockAgent } = require('./mock-agent');

const CLI_PATH = path.join(__dirname, '../..', 'aigon-cli.js');
const FIXTURES_DIR = path.join(os.homedir(), 'src');
const MOCK_BIN_DIR = path.join(__dirname, 'mock-bin');

// ─── simple async test runner ──────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function check(description, fn) {
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

// ─── helpers ──────────────────────────────────────────────────────────────────

function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) copyDir(srcPath, destPath);
        else fs.copyFileSync(srcPath, destPath);
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

function runAigon(args, { cwd, env = {} } = {}) {
    const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
        cwd: cwd || process.cwd(),
        env: {
            ...process.env,
            HOME: os.tmpdir(),
            PATH: MOCK_BIN_DIR + path.delimiter + process.env.PATH,
            ...env,
        },
        encoding: 'utf8',
    });
    return { stdout: result.stdout || '', stderr: result.stderr || '', exitCode: result.status };
}

function runGit(args, cwd) {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
    return result.stdout ? result.stdout.trim() : '';
}

function readFrontmatterStatus(filePath) {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf8');
    const m = content.match(/^---\n[\s\S]*?status:\s*(\S+)/);
    return m ? m[1] : null;
}

function findFileIn(dir, predicate) {
    if (!fs.existsSync(dir)) return null;
    return fs.readdirSync(dir).find(predicate) || null;
}

function extractAssignedId(output) {
    const m = (output || '').match(/Assigned ID:\s*(\d+)/);
    return m ? m[1] : null;
}

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

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
    ensureFixtures();

    const tmpDir = copyFixtureToTemp('brewboard');
    const repoName = path.basename(tmpDir);
    const worktreeBase = path.join(path.dirname(tmpDir), `${repoName}-worktrees`);

    console.log('\n  e2e-mock-solo: Full solo worktree lifecycle');
    console.log(`  Fixture: ${tmpDir}`);

    try {
        // ── Phase 1: Setup ─────────────────────────────────────────────────────
        console.log('\n  Setup Phase');

        const createResult = runAigon(['feature-create', 'mock-test-feature'], { cwd: tmpDir });
        check('feature-create exits 0', () => {
            if (createResult.exitCode !== 0)
                throw new Error(`exit ${createResult.exitCode}: ${createResult.stderr.slice(0, 200)}`);
        });

        const prioritiseResult = runAigon(['feature-prioritise', 'mock-test-feature'], { cwd: tmpDir });
        check('feature-prioritise exits 0', () => {
            if (prioritiseResult.exitCode !== 0)
                throw new Error(`exit ${prioritiseResult.exitCode}: ${prioritiseResult.stderr.slice(0, 200)}`);
        });

        const featureId = extractAssignedId(prioritiseResult.stdout + prioritiseResult.stderr);
        check('feature-prioritise assigns an ID', () => {
            if (!featureId) throw new Error('Could not parse "Assigned ID" from output');
        });
        if (!featureId) {
            console.error('  Cannot continue without feature ID');
            process.exitCode = 1;
            return;
        }

        const paddedId = String(featureId).padStart(2, '0');
        const desc = 'mock-test-feature';

        check('spec in 02-backlog after prioritise', () => {
            const f = findFileIn(
                path.join(tmpDir, 'docs/specs/features/02-backlog'),
                f => f.includes(paddedId) && f.includes(desc)
            );
            if (!f) throw new Error(`No spec with ID ${paddedId} found in 02-backlog`);
        });

        const setupResult = runAigon(['feature-start', featureId, 'cc'], { cwd: tmpDir });
        check('feature-start exits 0', () => {
            if (setupResult.exitCode !== 0)
                throw new Error(`exit ${setupResult.exitCode}: ${setupResult.stderr.slice(0, 200)}`);
        });

        check('spec moved to 03-in-progress', () => {
            const f = findFileIn(
                path.join(tmpDir, 'docs/specs/features/03-in-progress'),
                f => f.includes(paddedId)
            );
            if (!f) throw new Error(`Spec for feature ${paddedId} not found in 03-in-progress`);
        });

        const worktreePath = path.join(worktreeBase, `feature-${paddedId}-cc-${desc}`);
        check('worktree created at expected path', () => {
            if (!fs.existsSync(worktreePath)) throw new Error(`Worktree not found: ${worktreePath}`);
        });

        const logPath = path.join(
            worktreePath, 'docs', 'specs', 'features', 'logs',
            `feature-${paddedId}-cc-${desc}-log.md`
        );
        check('log file created with status: implementing', () => {
            const status = readFrontmatterStatus(logPath);
            if (status !== 'implementing') throw new Error(`Expected implementing, got: ${status}`);
        });

        // ── Phase 2: Mock Agent ────────────────────────────────────────────────
        console.log('\n  Agent Phase (~15s)');

        const agent = new MockAgent({
            featureId: paddedId,
            agentId: 'cc',
            desc,
            repoPath: tmpDir,
            delays: { implementing: 10000, submitted: 3000 }, // ~13s total
        });

        await agent.run();

        check('log shows status: submitted after agent run', () => {
            const status = readFrontmatterStatus(logPath);
            if (status !== 'submitted') throw new Error(`Expected submitted, got: ${status}`);
        });

        // ── Phase 3: Close ─────────────────────────────────────────────────────
        console.log('\n  Close Phase');

        // feature-close <ID> (no agent arg) — auto-detects the single Drive worktree
        const closeResult = runAigon(['feature-close', featureId], { cwd: tmpDir });
        check('feature-close exits 0', () => {
            if (closeResult.exitCode !== 0)
                throw new Error(`exit ${closeResult.exitCode}: ${closeResult.stdout.slice(0, 300)}\n${closeResult.stderr.slice(0, 300)}`);
        });

        check('spec moved to 05-done', () => {
            const f = findFileIn(
                path.join(tmpDir, 'docs/specs/features/05-done'),
                f => f.includes(paddedId)
            );
            if (!f) throw new Error(`Spec for feature ${paddedId} not found in 05-done`);
        });

        check('log moved to logs/selected', () => {
            const f = findFileIn(
                path.join(tmpDir, 'docs/specs/features/logs/selected'),
                f => f.includes(paddedId)
            );
            if (!f) throw new Error(`Log for feature ${paddedId} not found in logs/selected`);
        });

        check('worktree removed after close', () => {
            if (fs.existsSync(worktreePath)) throw new Error(`Worktree still exists: ${worktreePath}`);
        });

        check('feature branch deleted', () => {
            const branches = runGit(['branch', '--list', `feature-${paddedId}-cc-${desc}`], tmpDir);
            if (branches.includes(`feature-${paddedId}-cc-${desc}`)) throw new Error('Branch still exists after close');
        });

        check('merge commit on main', () => {
            const log = runGit(['log', '--oneline', '-10'], tmpDir);
            if (!log.toLowerCase().includes('merge')) throw new Error('No merge commit found in recent git log');
        });

        check('agent dummy code present on main after merge', () => {
            if (!fs.existsSync(path.join(tmpDir, 'mock-cc-implementation.js')))
                throw new Error('mock-cc-implementation.js not in main repo after merge');
        });

    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
        try { fs.rmSync(worktreeBase, { recursive: true, force: true }); } catch (_) {}
    }

    console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
    if (failed > 0) process.exitCode = 1;
}

main().catch(err => {
    console.error('\nFatal error:', err.message);
    process.exitCode = 1;
});
