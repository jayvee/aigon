'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const { getEffectiveConfig } = require('./config');
const { getDefaultBranch } = require('./git');

function runGitCapture(args, options = {}) {
    const result = spawnSync('git', args, {
        cwd: options.cwd || process.cwd(),
        encoding: options.encoding || 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (result.status !== 0) {
        const stderr = result.stderr
            ? result.stderr.toString(options.encoding === 'buffer' ? undefined : 'utf8')
            : '';
        throw new Error(stderr.trim() || `git ${args.join(' ')} failed`);
    }
    return result.stdout;
}

function listChangedPaths(defaultBranch, options = {}) {
    const cwd = options.cwd || process.cwd();
    const committedOutput = runGitCapture(
        ['diff', '--name-only', '--diff-filter=ACMR', `${defaultBranch}...HEAD`],
        { cwd }
    );
    const stagedOutput = runGitCapture(
        ['diff', '--cached', '--name-only', '--diff-filter=ACMR'],
        { cwd }
    );

    return Array.from(new Set(
        `${committedOutput}\n${stagedOutput}`
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
    ));
}

function writeGitObjectToFile(spec, relPath, targetRoot, options = {}) {
    const cwd = options.cwd || process.cwd();
    const outputPath = path.join(targetRoot, relPath);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const content = runGitCapture(['show', spec], { cwd, encoding: 'buffer' });
    fs.writeFileSync(outputPath, content);
}

function createScanSnapshot(defaultBranch, options = {}) {
    const cwd = options.cwd || process.cwd();
    const committedPaths = runGitCapture(
        ['diff', '--name-only', '--diff-filter=ACMR', `${defaultBranch}...HEAD`],
        { cwd }
    ).split('\n').map(line => line.trim()).filter(Boolean);
    const stagedPaths = runGitCapture(
        ['diff', '--cached', '--name-only', '--diff-filter=ACMR'],
        { cwd }
    ).split('\n').map(line => line.trim()).filter(Boolean);
    const changedPaths = Array.from(new Set([...committedPaths, ...stagedPaths]));

    if (changedPaths.length === 0) {
        return {
            paths: [],
            scanPath: null,
            cleanup: () => {},
        };
    }

    const scanPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-security-scan-'));

    for (const relPath of committedPaths) {
        writeGitObjectToFile(`HEAD:${relPath}`, relPath, scanPath, { cwd });
    }
    for (const relPath of stagedPaths) {
        writeGitObjectToFile(`:${relPath}`, relPath, scanPath, { cwd });
    }

    return {
        paths: changedPaths,
        scanPath,
        cleanup: () => fs.rmSync(scanPath, { recursive: true, force: true }),
    };
}

/**
 * Run security scanners for a given merge-gate stage.
 *
 * @param {string} stage - One of: featureClose, featureSubmit, researchClose
 * @param {object} [options]
 * @param {string} [options.cwd] - Working directory for scanner execution
 * @returns {{ passed: boolean, mode: string, results: Array<{scanner: string, passed: boolean, output: string}> }}
 */
function runSecurityScan(stage, options = {}) {
    const config = getEffectiveConfig();
    const security = config.security || {};
    const cwd = options.cwd || process.cwd();

    const mode = security.mode || 'enforce';

    // If security is disabled or mode is 'off', skip entirely
    if (security.enabled === false || mode === 'off') {
        return { passed: true, mode, results: [], skipped: true };
    }

    const mergeGateStages = security.mergeGateStages || {};
    const scannerNames = mergeGateStages[stage];

    if (!scannerNames || !Array.isArray(scannerNames) || scannerNames.length === 0) {
        return { passed: true, mode, results: [], skipped: true };
    }

    const scannerDefs = security.scannerDefs || {};
    const results = [];
    let allPassed = true;

    let defaultBranch;
    try {
        defaultBranch = getDefaultBranch();
    } catch (_) {
        defaultBranch = 'main';
    }

    const snapshot = createScanSnapshot(defaultBranch, { cwd });
    if (snapshot.paths.length === 0) {
        return { passed: true, mode, results: [], skipped: true };
    }

    console.log(`\n🔒 Security scan (${stage}, mode: ${mode})...`);

    try {
        for (const name of scannerNames) {
            const def = scannerDefs[name];
            if (!def || !def.command) {
                console.warn(`⚠️  Scanner "${name}" has no command definition — skipping`);
                continue;
            }

            // Interpolate variables in the command
            const command = def.command
                .replace(/\{\{defaultBranch\}\}/g, defaultBranch)
                .replace(/\{\{scanPath\}\}/g, snapshot.scanPath);

            // Check if the scanner binary is available
            const binary = command.split(/\s+/)[0];
            if (!isBinaryAvailable(binary)) {
                console.warn(`⚠️  Scanner "${name}" not found (${binary} not installed) — skipping`);
                results.push({ scanner: name, passed: true, output: `${binary} not installed`, skipped: true });
                continue;
            }

            try {
                const output = execSync(command, {
                    encoding: 'utf8',
                    cwd,
                    stdio: ['pipe', 'pipe', 'pipe'],
                    timeout: 60000,
                });
                console.log(`   ✅ ${name}: clean`);
                results.push({ scanner: name, passed: true, output: output || '' });
            } catch (err) {
                // Non-zero exit = findings detected
                const output = (err.stdout || '') + (err.stderr || '');
                allPassed = false;
                console.error(`   ❌ ${name}: findings detected`);
                if (output.trim()) {
                    // Show the first 40 lines of output to keep it readable
                    const lines = output.trim().split('\n');
                    const preview = lines.slice(0, 40).join('\n');
                    console.error(preview);
                    if (lines.length > 40) {
                        console.error(`   ... (${lines.length - 40} more lines)`);
                    }
                }
                results.push({ scanner: name, passed: false, output });
            }
        }
    } finally {
        snapshot.cleanup();
    }

    if (allPassed) {
        console.log(`🔒 Security scan passed\n`);
    } else if (mode === 'warn') {
        console.warn(`⚠️  Security scan found issues (mode: warn — continuing anyway)\n`);
    } else {
        console.error(`❌ Security scan failed — blocking ${stage} (mode: enforce)`);
        console.error(`   Fix the issues above or set security.mode to "warn" in .aigon/config.json\n`);
    }

    return {
        passed: allPassed || mode === 'warn',
        mode,
        results,
    };
}

/**
 * Check if a binary is available on PATH.
 * @param {string} binary
 * @returns {boolean}
 */
function isBinaryAvailable(binary) {
    try {
        execSync(`command -v ${binary}`, { encoding: 'utf8', stdio: 'pipe' });
        return true;
    } catch (_) {
        return false;
    }
}

module.exports = {
    runSecurityScan,
    isBinaryAvailable,
    listChangedPaths,
    createScanSnapshot,
};
