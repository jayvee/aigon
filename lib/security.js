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
        maxBuffer: 256 * 1024 * 1024,
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
 * Parse Semgrep JSON output and return structured findings.
 *
 * @param {string} rawOutput - Raw JSON string from semgrep --json
 * @param {string} severityThreshold - 'high' (block ERROR only) or 'medium' (block ERROR + WARNING)
 * @returns {{ findings: Array<{severity: string, rule: string, file: string, line: number, message: string}>, blockCount: number, warnCount: number }}
 */
function parseSemgrepOutput(rawOutput, severityThreshold = 'high') {
    let parsed;
    try {
        parsed = JSON.parse(rawOutput);
    } catch (_) {
        return { findings: [], blockCount: 0, warnCount: 0, parseError: true };
    }

    const results = parsed.results || [];
    const findings = results.map(r => ({
        severity: (r.extra && r.extra.severity) || 'UNKNOWN',
        rule: r.check_id || 'unknown',
        file: r.path || 'unknown',
        line: (r.start && r.start.line) || 0,
        message: (r.extra && r.extra.message) || '',
    }));

    // Severity levels for comparison
    const severityRank = { ERROR: 3, WARNING: 2, INFO: 1, UNKNOWN: 0 };
    const blockThreshold = severityThreshold === 'medium' ? 2 : 3; // medium blocks WARNING+, high blocks ERROR only

    let blockCount = 0;
    let warnCount = 0;
    for (const f of findings) {
        const rank = severityRank[f.severity] || 0;
        if (rank >= blockThreshold) {
            blockCount++;
        } else if (rank >= 2) {
            warnCount++;
        }
    }

    return { findings, blockCount, warnCount, parseError: false };
}

/**
 * Format Semgrep findings for terminal display.
 *
 * @param {Array} findings - Parsed findings from parseSemgrepOutput
 * @param {number} blockThreshold - Minimum severity rank to block (3 = high, 2 = medium)
 * @returns {string} Formatted terminal output
 */
function formatSemgrepFindings(findings, blockThreshold = 3) {
    if (findings.length === 0) return '';

    const severityRank = { ERROR: 3, WARNING: 2, INFO: 1, UNKNOWN: 0 };
    const severityIcon = { ERROR: '🔴', WARNING: '🟡', INFO: '🔵', UNKNOWN: '⚪' };
    const lines = [];

    for (const f of findings) {
        const rank = severityRank[f.severity] || 0;
        const icon = severityIcon[f.severity] || '⚪';
        const action = rank >= blockThreshold ? 'BLOCK' : 'warn';
        const location = `${f.file}:${f.line}`;
        lines.push(`   ${icon} [${action}] ${f.severity} ${location}`);
        lines.push(`      Rule: ${f.rule}`);
        if (f.message) {
            // Truncate long messages and handle newlines for clean terminal formatting
            const cleanMsg = f.message.replace(/\r?\n/g, " ").trim();
            const msg = cleanMsg.length > 120 ? cleanMsg.slice(0, 117) + "..." : cleanMsg;
            lines.push(`      ${msg}`);
        }
    }

    return lines.join('\n');
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
                    timeout: 120000,
                });

                // Handle structured output formats
                if (def.outputFormat === 'semgrep-json') {
                    const threshold = def.severityThreshold || 'high';
                    const { findings, blockCount, warnCount, parseError } = parseSemgrepOutput(output, threshold);
                    if (parseError) {
                        console.log(`   ✅ ${name}: clean (no parseable output)`);
                        results.push({ scanner: name, passed: true, output: output || '' });
                    } else if (findings.length === 0) {
                        console.log(`   ✅ ${name}: clean`);
                        results.push({ scanner: name, passed: true, output: '', findings: [] });
                    } else {
                        const blockThreshold = threshold === 'medium' ? 2 : 3;
                        const formatted = formatSemgrepFindings(findings, blockThreshold);
                        if (blockCount > 0) {
                            allPassed = false;
                            console.error(`   ❌ ${name}: ${blockCount} blocking finding(s), ${warnCount} warning(s)`);
                        } else {
                            console.warn(`   ⚠️  ${name}: ${warnCount} warning(s) (non-blocking)`);
                        }
                        if (formatted) console.error(formatted);
                        results.push({ scanner: name, passed: blockCount === 0, output: formatted, findings });
                    }
                } else {
                    console.log(`   ✅ ${name}: clean`);
                    results.push({ scanner: name, passed: true, output: output || '' });
                }
            } catch (err) {
                // Non-zero exit = findings detected
                const stdout = err.stdout || '';
                const stderr = err.stderr || '';
                const output = stdout + stderr;

                // Semgrep exits non-zero when findings are detected — parse structured output
                if (def.outputFormat === 'semgrep-json' && stdout.trim()) {
                    const threshold = def.severityThreshold || 'high';
                    const { findings, blockCount, warnCount, parseError } = parseSemgrepOutput(stdout, threshold);
                    if (!parseError && findings.length > 0) {
                        const blockThreshold = threshold === 'medium' ? 2 : 3;
                        const formatted = formatSemgrepFindings(findings, blockThreshold);
                        if (blockCount > 0) {
                            allPassed = false;
                            console.error(`   ❌ ${name}: ${blockCount} blocking finding(s), ${warnCount} warning(s)`);
                        } else {
                            console.warn(`   ⚠️  ${name}: ${warnCount} warning(s) (non-blocking)`);
                        }
                        if (formatted) console.error(formatted);
                        results.push({ scanner: name, passed: blockCount === 0, output: formatted, findings });
                        continue;
                    }
                }

                // Fallback: raw output for non-JSON scanners or parse failures
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
    parseSemgrepOutput,
    formatSemgrepFindings,
};
