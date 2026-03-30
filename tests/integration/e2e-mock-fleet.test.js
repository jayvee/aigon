#!/usr/bin/env node
/**
 * E2E test: Full fleet (multi-agent) lifecycle with mock agents.
 *
 * Exercises: feature-create → prioritise → setup (cc + gg) →
 *            parallel mock-do → eval → close (winner: cc) → cleanup
 *
 * Run: node tests/integration/e2e-mock-fleet.test.js
 * Or:  npm run test:integration:mock-fleet
 *
 * Separate from main e2e suite due to timing (~35s dominated by mock agent pauses).
 *
 * Notes:
 *   - feature-eval is invoked with GEMINI_CLI=1 so detectActiveAgentSession() treats
 *     the subprocess as being inside a Gemini agent session, bypassing the "launch agent"
 *     path and running the eval setup directly.
 *   - gg's log is copied from the worktree to the main repo before feature-close so
 *     both logs are present in the flat logs/ directory.
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

    console.log('\n  e2e-mock-fleet: Full fleet lifecycle (cc + gg)');
    console.log(`  Fixture: ${tmpDir}`);

    try {
        // ── Phase 1: Setup ──────────────────────────────────────────────────────
        console.log('\n  Setup Phase');

        const createResult = runAigon(['feature-create', 'fleet-test-feature'], { cwd: tmpDir });
        check('feature-create exits 0', () => {
            if (createResult.exitCode !== 0)
                throw new Error(`exit ${createResult.exitCode}: ${createResult.stderr.slice(0, 200)}`);
        });

        const prioritiseResult = runAigon(['feature-prioritise', 'fleet-test-feature'], { cwd: tmpDir });
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
        const desc = 'fleet-test-feature';

        // Setup fleet: two agents cc and gg
        const setupResult = runAigon(['feature-start', featureId, 'cc', 'gg'], { cwd: tmpDir });
        check('feature-start (fleet) exits 0', () => {
            if (setupResult.exitCode !== 0)
                throw new Error(`exit ${setupResult.exitCode}: ${setupResult.stderr.slice(0, 300)}`);
        });

        check('spec moved to 03-in-progress', () => {
            const f = findFileIn(
                path.join(tmpDir, 'docs/specs/features/03-in-progress'),
                f => f.includes(paddedId)
            );
            if (!f) throw new Error(`Spec for feature ${paddedId} not found in 03-in-progress`);
        });

        const ccWorktreePath = path.join(worktreeBase, `feature-${paddedId}-cc-${desc}`);
        const ggWorktreePath = path.join(worktreeBase, `feature-${paddedId}-gg-${desc}`);

        check('cc worktree created', () => {
            if (!fs.existsSync(ccWorktreePath)) throw new Error(`cc worktree not found: ${ccWorktreePath}`);
        });

        check('gg worktree created', () => {
            if (!fs.existsSync(ggWorktreePath)) throw new Error(`gg worktree not found: ${ggWorktreePath}`);
        });

        const ccLogPath = path.join(
            ccWorktreePath, 'docs', 'specs', 'features', 'logs',
            `feature-${paddedId}-cc-${desc}-log.md`
        );
        const ggLogPath = path.join(
            ggWorktreePath, 'docs', 'specs', 'features', 'logs',
            `feature-${paddedId}-gg-${desc}-log.md`
        );

        check('cc log created with status: implementing', () => {
            const status = readFrontmatterStatus(ccLogPath);
            if (status !== 'implementing') throw new Error(`Expected implementing, got: ${status}`);
        });

        check('gg log created with status: implementing', () => {
            const status = readFrontmatterStatus(ggLogPath);
            if (status !== 'implementing') throw new Error(`Expected implementing, got: ${status}`);
        });

        // ── Phase 2: Parallel Mock Agents ────────────────────────────────────────
        // cc finishes after ~20s, gg after ~25s (5s gap for intermediate check)
        console.log('\n  Parallel Agent Phase (~25s): cc=20s, gg=25s');

        const agentCC = new MockAgent({
            featureId: paddedId,
            agentId: 'cc',
            desc,
            repoPath: tmpDir,
            delays: { implementing: 15000, submitted: 5000 }, // 20s total
        });

        const agentGG = new MockAgent({
            featureId: paddedId,
            agentId: 'gg',
            desc,
            repoPath: tmpDir,
            delays: { implementing: 20000, submitted: 5000 }, // 25s total
        });

        // Start both agents concurrently (do NOT await yet)
        const ccRunning = agentCC.run();
        const ggRunning = agentGG.run();

        // Wait for cc to finish (~20s)
        await ccRunning;

        // Intermediate check: cc submitted, gg still implementing (has ~5s remaining)
        check('cc log shows submitted after cc completes', () => {
            const status = readFrontmatterStatus(ccLogPath);
            if (status !== 'submitted') throw new Error(`Expected submitted, got: ${status}`);
        });

        check('gg log still implementing while cc is done (staggered)', () => {
            const status = readFrontmatterStatus(ggLogPath);
            if (status !== 'implementing') throw new Error(`Expected implementing, got: ${status}`);
        });

        // Wait for gg to finish (~5s more)
        await ggRunning;

        check('gg log shows submitted after gg completes', () => {
            const status = readFrontmatterStatus(ggLogPath);
            if (status !== 'submitted') throw new Error(`Expected submitted, got: ${status}`);
        });

        check('all-submitted state: both logs show submitted', () => {
            const ccStatus = readFrontmatterStatus(ccLogPath);
            const ggStatus = readFrontmatterStatus(ggLogPath);
            if (ccStatus !== 'submitted' || ggStatus !== 'submitted')
                throw new Error(`cc=${ccStatus}, gg=${ggStatus} — both must be submitted`);
        });

        // ── Phase 3: Evaluation ──────────────────────────────────────────────────
        console.log('\n  Evaluation Phase');

        // Run feature-eval with GEMINI_CLI=1 so detectActiveAgentSession() returns gg,
        // bypassing the "launch an agent" path and running eval setup directly.
        // --allow-same-model-judge suppresses the bias warning (gg evaluates gg).
        const evalResult = runAigon(
            ['feature-eval', featureId, '--allow-same-model-judge'],
            { cwd: tmpDir, env: { GEMINI_CLI: '1' } }
        );
        check('feature-eval exits 0', () => {
            if (evalResult.exitCode !== 0)
                throw new Error(`exit ${evalResult.exitCode}: ${evalResult.stdout.slice(0, 300)}\n${evalResult.stderr.slice(0, 300)}`);
        });

        check('spec moved to 04-in-evaluation', () => {
            const f = findFileIn(
                path.join(tmpDir, 'docs/specs/features/04-in-evaluation'),
                f => f.includes(paddedId)
            );
            if (!f) throw new Error(`Spec for feature ${paddedId} not found in 04-in-evaluation`);
        });

        const evalFile = path.join(tmpDir, 'docs/specs/features/evaluations', `feature-${paddedId}-eval.md`);
        check('evaluation file created', () => {
            if (!fs.existsSync(evalFile)) throw new Error(`Eval file not found: ${evalFile}`);
        });

        // Simulate human writing eval results: pick cc as winner
        const existingEval = fs.readFileSync(evalFile, 'utf8');
        fs.writeFileSync(evalFile, existingEval + '\n**Winner: cc**\n');

        // Bring gg's log into the main repo (flat logs/ directory).
        // (In a real workflow, the eval agent would consolidate logs; here we do it directly.)
        const mainLogsDir = path.join(tmpDir, 'docs/specs/features/logs');
        const ggLogDest = path.join(mainLogsDir, `feature-${paddedId}-gg-${desc}-log.md`);
        fs.copyFileSync(ggLogPath, ggLogDest);

        runGit(['add', 'docs/specs/features/'], tmpDir);
        runGit(['commit', '-m', `chore: write eval results for feature ${paddedId}`], tmpDir);

        check('eval file contains winner declaration', () => {
            const content = fs.readFileSync(evalFile, 'utf8');
            if (!content.includes('Winner: cc')) throw new Error('Winner not written to eval file');
        });

        // ── Phase 4: Close (merge winner cc) ─────────────────────────────────────
        console.log('\n  Close Phase');

        const closeResult = runAigon(['feature-close', featureId, 'cc'], { cwd: tmpDir });
        check('feature-close cc exits 0', () => {
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

        check("cc's log stays in flat logs/", () => {
            const f = findFileIn(
                path.join(tmpDir, 'docs/specs/features/logs'),
                f => f.includes(paddedId) && f.includes('-cc-') && !fs.lstatSync(path.join(tmpDir, 'docs/specs/features/logs', f)).isDirectory()
            );
            if (!f) throw new Error(`cc log not found in logs/`);
        });

        check("gg's log stays in flat logs/", () => {
            const f = findFileIn(
                path.join(tmpDir, 'docs/specs/features/logs'),
                f => f.includes(paddedId) && f.includes('-gg-') && !fs.lstatSync(path.join(tmpDir, 'docs/specs/features/logs', f)).isDirectory()
            );
            if (!f) throw new Error(`gg log not found in logs/`);
        });

        check("winner recorded in manifest", () => {
            const manifestPath = path.join(tmpDir, '.aigon/state', `feature-${paddedId}.json`);
            if (!fs.existsSync(manifestPath)) throw new Error('Manifest not found');
            const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            if (m.winner !== 'cc') throw new Error(`Expected winner=cc, got ${m.winner}`);
        });

        check('cc branch merged to main (no-ff merge commit)', () => {
            const log = runGit(['log', '--oneline', '-10'], tmpDir);
            if (!log.toLowerCase().includes('merge')) throw new Error('No merge commit found in git log');
        });

        check("cc's dummy code present on main after merge", () => {
            if (!fs.existsSync(path.join(tmpDir, 'mock-cc-implementation.js')))
                throw new Error('mock-cc-implementation.js not in main repo after merge');
        });

        check("gg's code NOT on main (only cc was merged)", () => {
            if (fs.existsSync(path.join(tmpDir, 'mock-gg-implementation.js')))
                throw new Error('mock-gg-implementation.js should NOT be in main repo');
        });

        check('cc worktree removed after close', () => {
            if (fs.existsSync(ccWorktreePath)) throw new Error(`cc worktree still exists: ${ccWorktreePath}`);
        });

        check('cc branch deleted after close', () => {
            const branches = runGit(['branch', '--list', `feature-${paddedId}-cc-${desc}`], tmpDir);
            if (branches.includes(`feature-${paddedId}-cc-${desc}`)) throw new Error('cc branch still exists');
        });

        // Clean up gg's worktree and branch (simulates running feature-cleanup for losing agents)
        const cleanupResult = runAigon(['feature-cleanup', featureId], { cwd: tmpDir });
        check('feature-cleanup exits 0', () => {
            if (cleanupResult.exitCode !== 0)
                throw new Error(`exit ${cleanupResult.exitCode}: ${cleanupResult.stderr.slice(0, 200)}`);
        });

        check('gg worktree removed after cleanup', () => {
            if (fs.existsSync(ggWorktreePath)) throw new Error(`gg worktree still exists: ${ggWorktreePath}`);
        });

        check('gg branch deleted after cleanup', () => {
            const branches = runGit(['branch', '--list', `feature-${paddedId}-gg-${desc}`], tmpDir);
            if (branches.includes(`feature-${paddedId}-gg-${desc}`)) throw new Error('gg branch still exists');
        });

        // ── State Machine Compliance ─────────────────────────────────────────────
        // Verify that at no point did we use solo-only actions in fleet mode.
        // (The fact that feature-eval required 2+ worktrees validates this — it
        //  would have errored with "feature-eval is for Fleet mode only" if there
        //  was only one worktree, preventing accidental solo close.)
        check('no solo-only actions were taken in fleet mode (eval was required)', () => {
            // If feature-eval succeeded, fleet mode was correctly enforced
            if (evalResult.exitCode !== 0) throw new Error('feature-eval did not succeed (fleet enforcement failed)');
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
