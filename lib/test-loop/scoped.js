'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const os = require('os');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const INTEGRATION_DIR = path.join(REPO_ROOT, 'tests', 'integration');
const WORKFLOW_DIR = path.join(REPO_ROOT, 'tests', 'workflow-core');

// Smoke set — runs in parallel when keyword matching produces no hits.
// Each line names a test file under tests/integration/ chosen because it
// exercises a load-bearing surface (registries, action scope, bootstrap).
// Keep at <=5 entries — every entry is iterate-loop tax for a no-match diff.
const SMOKE_FILES = [
    'tests/integration/spec-recommendation.test.js',
    'tests/integration/command-registry-drift.test.js',
    'tests/integration/agent-registry-contract.test.js',
    'tests/integration/bootstrap-engine-state.test.js',
    'tests/integration/recurring-instance-body-week-placeholder.test.js',
];

const DASHBOARD_PATH_RE = /^(templates\/dashboard\/|lib\/(dashboard|server))/;
const WORKFLOW_PATH_RE = /^(lib\/workflow|templates\/.*workflow)/;
const STOP_WORDS = new Set([
    'lib', 'src', 'index', 'commands', 'tests', 'integration', 'workflow', 'core',
    'js', 'mjs', 'ts', 'json', 'md', 'sh', 'test', 'main', 'utils', 'helpers',
    'a', 'an', 'the', 'and', 'or', 'to', 'of', 'in', 'for', 'with',
]);

function getChangedPaths({ baseRef = null } = {}) {
    const cwd = REPO_ROOT;
    const paths = new Set();
    const pushAll = (out) => {
        if (!out) return;
        out.split('\n').map(s => s.trim()).filter(Boolean).forEach(p => paths.add(p));
    };

    try {
        if (baseRef) {
            pushAll(execSync(`git diff --name-only ${baseRef}...HEAD`, { cwd, encoding: 'utf8' }));
        } else {
            // Default base: detect repo's default branch (main / master) merge-base.
            let mergeBase = null;
            try {
                const headBranch = execSync('git symbolic-ref --short HEAD', { cwd, encoding: 'utf8' }).trim();
                const candidates = ['main', 'master'].filter(b => b !== headBranch);
                for (const cand of candidates) {
                    try {
                        execSync(`git rev-parse --verify --quiet ${cand}`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
                        mergeBase = execSync(`git merge-base HEAD ${cand}`, { cwd, encoding: 'utf8' }).trim();
                        break;
                    } catch (_) { /* try next */ }
                }
            } catch (_) { /* detached HEAD */ }
            if (mergeBase) {
                pushAll(execSync(`git diff --name-only ${mergeBase}...HEAD`, { cwd, encoding: 'utf8' }));
            }
        }
    } catch (_) { /* fall through */ }

    // Always include working-tree changes (uncommitted edits matter for the iterate loop).
    try {
        pushAll(execSync('git diff --name-only HEAD', { cwd, encoding: 'utf8' }));
        pushAll(execSync('git ls-files --others --exclude-standard', { cwd, encoding: 'utf8' }));
    } catch (_) { /* not a git repo */ }

    return [...paths];
}

function extractKeywords(paths) {
    const keywords = new Set();
    for (const p of paths) {
        const segments = p.split('/');
        for (const seg of segments) {
            const base = seg.replace(/\.[^.]+$/, '');
            for (const tok of base.split(/[-_.]/)) {
                const lower = tok.toLowerCase();
                if (lower.length >= 3 && !STOP_WORDS.has(lower)) keywords.add(lower);
            }
        }
    }
    return [...keywords];
}

function listTestFiles(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter(f => f.endsWith('.test.js'))
        .map(f => path.join(dir, f));
}

function matchTestsForKeywords(keywords) {
    if (keywords.length === 0) return [];
    const all = [...listTestFiles(INTEGRATION_DIR), ...listTestFiles(WORKFLOW_DIR)];
    const matched = new Set();
    for (const file of all) {
        const base = path.basename(file).toLowerCase().replace(/\.test\.js$/, '');
        for (const kw of keywords) {
            if (base.includes(kw)) {
                matched.add(file);
                break;
            }
        }
    }
    return [...matched].sort();
}

function classifyChanges(paths) {
    const flags = {
        dashboard: false,
        workflowGen: false,
        anyLib: false,
        anyTemplate: false,
        anyDoc: false,
        anyConfig: false,
    };
    for (const p of paths) {
        if (DASHBOARD_PATH_RE.test(p)) flags.dashboard = true;
        if (WORKFLOW_PATH_RE.test(p)) flags.workflowGen = true;
        if (p.startsWith('lib/')) flags.anyLib = true;
        if (p.startsWith('templates/')) flags.anyTemplate = true;
        if (p.startsWith('docs/') || p.endsWith('.md')) flags.anyDoc = true;
        if (p === 'package.json' || p.startsWith('.aigon/') || p.startsWith('scripts/')) flags.anyConfig = true;
    }
    return flags;
}

function runChild(cmd, args, opts = {}) {
    const start = Date.now();
    const result = spawnSync(cmd, args, {
        cwd: REPO_ROOT,
        stdio: opts.silent ? ['ignore', 'pipe', 'pipe'] : 'inherit',
        encoding: 'utf8',
        env: { ...process.env, ...(opts.env || {}) },
    });
    const durationMs = Date.now() - start;
    const exitCode = typeof result.status === 'number' ? result.status : 1;
    return {
        ok: exitCode === 0 && !result.error && !result.signal,
        exitCode,
        signal: result.signal || null,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        durationMs,
    };
}

function runFilesInParallel(files, { concurrency = Math.max(2, os.cpus().length - 1), label = 'tests' } = {}) {
    if (files.length === 0) return { ok: true, durationMs: 0, files: [] };
    const start = Date.now();
    let nextIndex = 0;
    let firstFailure = null;
    const results = [];

    return new Promise((resolve) => {
        let active = 0;
        let done = 0;

        const launch = () => {
            while (active < concurrency && nextIndex < files.length && !firstFailure) {
                const file = files[nextIndex++];
                active++;
                const child = require('child_process').spawn(process.execPath, [file], {
                    cwd: REPO_ROOT,
                    env: process.env,
                });
                let stdout = '';
                let stderr = '';
                child.stdout.on('data', d => { stdout += d.toString(); });
                child.stderr.on('data', d => { stderr += d.toString(); });
                child.on('close', (code) => {
                    active--;
                    done++;
                    const ok = code === 0;
                    results.push({ file, ok, code });
                    if (!ok && !firstFailure) {
                        firstFailure = { file, code, stdout, stderr };
                        process.stderr.write(`\n--- FAIL: ${path.relative(REPO_ROOT, file)} (exit ${code}) ---\n`);
                        if (stdout) process.stderr.write(stdout);
                        if (stderr) process.stderr.write(stderr);
                    } else if (ok) {
                        process.stdout.write(`  ✓ ${path.relative(REPO_ROOT, file)}\n`);
                    }
                    if (firstFailure && active === 0) {
                        resolve({ ok: false, durationMs: Date.now() - start, files, failure: firstFailure });
                    } else if (done === files.length) {
                        resolve({ ok: true, durationMs: Date.now() - start, files });
                    } else {
                        launch();
                    }
                });
            }
        };

        process.stdout.write(`\n[${label}] running ${files.length} file(s) with concurrency ${concurrency}\n`);
        launch();
    });
}

async function runScopedValidation({ baseRef = null, log = console.log } = {}) {
    const totalStart = Date.now();
    const ranSteps = [];
    const changedPaths = getChangedPaths({ baseRef });
    log(`[scoped] ${changedPaths.length} changed path(s)`);
    if (changedPaths.length === 0) {
        return {
            ok: true,
            durationMs: Date.now() - totalStart,
            ranSteps,
            note: 'no changed paths — skipping iterate-loop validation',
        };
    }

    const flags = classifyChanges(changedPaths);
    const keywords = extractKeywords(changedPaths);
    log(`[scoped] keywords: ${keywords.slice(0, 8).join(', ')}${keywords.length > 8 ? `, +${keywords.length - 8} more` : ''}`);

    // Step 1: scoped lint on changed lib/ files only.
    const changedLibJs = changedPaths.filter(p => p.startsWith('lib/') && p.endsWith('.js') && fs.existsSync(path.join(REPO_ROOT, p)));
    if (changedLibJs.length > 0) {
        log(`[lint] eslint on ${changedLibJs.length} changed lib/ file(s)`);
        const lint = runChild('npx', ['--no-install', 'eslint', ...changedLibJs]);
        ranSteps.push({ step: 'lint', ok: lint.ok, durationMs: lint.durationMs, files: changedLibJs.length });
        if (!lint.ok) {
            return { ok: false, durationMs: Date.now() - totalStart, ranSteps, failedAt: 'lint' };
        }
    }

    // Step 2: workflow diagram check, only when workflow code/templates touched.
    if (flags.workflowGen) {
        log(`[diagram] workflow diagrams check`);
        const diag = runChild('node', ['scripts/generate-workflow-diagrams.js', '--check']);
        ranSteps.push({ step: 'diagram', ok: diag.ok, durationMs: diag.durationMs });
        if (!diag.ok) {
            return { ok: false, durationMs: Date.now() - totalStart, ranSteps, failedAt: 'diagram' };
        }
    }

    // Step 3: matched integration + workflow tests, or smoke set if no match.
    let matched = matchTestsForKeywords(keywords);
    let usingSmoke = false;
    if (matched.length === 0) {
        usingSmoke = true;
        matched = SMOKE_FILES
            .map(f => path.join(REPO_ROOT, f))
            .filter(p => fs.existsSync(p));
    }
    const testRun = await runFilesInParallel(matched, { label: usingSmoke ? 'smoke' : 'scoped-tests' });
    ranSteps.push({ step: usingSmoke ? 'smoke' : 'scoped-tests', ok: testRun.ok, durationMs: testRun.durationMs, files: matched.length });
    if (!testRun.ok) {
        return { ok: false, durationMs: Date.now() - totalStart, ranSteps, failedAt: usingSmoke ? 'smoke' : 'scoped-tests' };
    }

    // Step 4: Playwright runs only if dashboard files touched.
    if (flags.dashboard) {
        log(`[playwright] dashboard touched — running test:ui`);
        const ui = runChild('npm', ['run', 'test:ui'], { env: { MOCK_DELAY: 'fast' } });
        ranSteps.push({ step: 'test:ui', ok: ui.ok, durationMs: ui.durationMs });
        if (!ui.ok) {
            return { ok: false, durationMs: Date.now() - totalStart, ranSteps, failedAt: 'test:ui' };
        }
    }

    return { ok: true, durationMs: Date.now() - totalStart, ranSteps };
}

function summariseResult(result) {
    const parts = result.ranSteps.map(s => `${s.step}=${s.ok ? '✓' : '✗'}(${s.durationMs}ms${s.files !== undefined ? `,${s.files}f` : ''})`);
    const head = result.ok ? '✅ scoped validation passed' : `❌ scoped validation failed at ${result.failedAt}`;
    return `${head} in ${result.durationMs}ms — ${parts.join(' ')}`;
}

module.exports = {
    runScopedValidation,
    getChangedPaths,
    extractKeywords,
    matchTestsForKeywords,
    classifyChanges,
    summariseResult,
};
