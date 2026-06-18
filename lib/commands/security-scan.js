'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function getRepoPath() {
    const utils = require('../utils');
    return utils.getMainRepoPath ? utils.getMainRepoPath(process.cwd()) : process.cwd();
}

function getSinceSha(repoPath, sinceArg, state) {
    if (sinceArg) return sinceArg;
    if (state && state.lastScanSha) return state.lastScanSha;
    // First run — go back 50 commits
    const r = spawnSync('git', ['rev-parse', 'HEAD~50'], {
        cwd: repoPath, encoding: 'utf8', stdio: 'pipe',
    });
    if (r.status === 0) return r.stdout.trim();
    // Fallback to the initial commit
    const r2 = spawnSync('git', ['rev-list', '--max-parents=0', 'HEAD'], {
        cwd: repoPath, encoding: 'utf8', stdio: 'pipe',
    });
    return r2.status === 0 ? r2.stdout.trim() : 'HEAD';
}

function getCurrentSha(repoPath) {
    const r = spawnSync('git', ['rev-parse', 'HEAD'], {
        cwd: repoPath, encoding: 'utf8', stdio: 'pipe',
    });
    return r.status === 0 ? r.stdout.trim() : null;
}

function getFeatureTypeConfig(repoPath) {
    const { CANONICAL_STAGE_DIRS } = require('../workflow-core/paths');
    return {
        root: path.join(repoPath, 'docs', 'specs', 'features'),
        folders: [...CANONICAL_STAGE_DIRS],
        prefix: 'feature',
    };
}

function extractFeatureIdFromPath(filePath) {
    const match = path.basename(filePath).match(/^feature-(\d+)-/);
    return match ? match[1] : null;
}

function extractPackageName(finding) {
    if (!finding || finding.tool !== 'npm-audit' || !finding.message) return null;
    const [name] = String(finding.message).split(':');
    return name ? name.trim() : null;
}

function buildFeatureSlug(finding) {
    const { slugify } = require('../cli-parse');
    const pkg = extractPackageName(finding);
    if (pkg) return slugify(`remediate-${pkg}-security-advisory`);

    const filePart = finding.file
        ? path.basename(finding.file, path.extname(finding.file || ''))
        : 'codebase';
    const base = slugify(`remediate-${finding.category || 'security-finding'}-${filePart}`);
    return base.slice(0, 80);
}

function buildFeatureDisplayName(finding) {
    const pkg = extractPackageName(finding);
    if (pkg) return `Remediate ${pkg} security advisory`;
    if (finding && finding.file) {
        return `Remediate ${finding.category || 'security finding'} in ${path.basename(finding.file)}`;
    }
    return `Remediate ${finding.category || 'security finding'}`;
}

function buildFeatureSummary(finding, reportPath) {
    const location = finding.file
        ? `${finding.file}${finding.line ? `:${finding.line}` : ''}`
        : 'the repo';
    const reportRef = reportPath ? ` See ${reportPath} for the full digest.` : '';
    return `Created automatically by \`aigon security-scan\` after a ${finding.severity} finding from ${finding.tool} at \`${location}\`. Fingerprint: \`${finding.fingerprint}\`. ${finding.message || 'Review the scan output and implement the recommended remediation.'}${reportRef}`;
}

const AIGON_CLI_PATH = path.join(__dirname, '..', '..', 'aigon-cli.js');

function runAigonCommand(repoPath, args) {
    const result = spawnSync(process.execPath, [AIGON_CLI_PATH, ...args], {
        cwd: repoPath,
        encoding: 'utf8',
        stdio: 'pipe',
        env: {
            ...process.env,
            AIGON_EDITOR: 'none',
        },
    });
    if (result.status !== 0) {
        const stderr = (result.stderr || '').trim();
        const stdout = (result.stdout || '').trim();
        throw new Error(stderr || stdout || `aigon ${args[0]} exited with code ${result.status}`);
    }
    return result;
}

function findExistingFeatureForFinding(repoPath, finding, slugs) {
    const specCrud = require('../spec-crud');
    const featureConfig = getFeatureTypeConfig(repoPath);
    const slugList = Array.isArray(slugs) ? slugs : [slugs];
    for (const slug of slugList) {
        if (!slug) continue;
        const existingBySlug = specCrud.findFile(featureConfig, slug);
        if (existingBySlug) {
            return {
                filePath: existingBySlug.fullPath,
                id: extractFeatureIdFromPath(existingBySlug.fullPath),
                reason: 'matching slug',
            };
        }
    }

    for (const folder of featureConfig.folders) {
        const dir = path.join(featureConfig.root, folder);
        if (!fs.existsSync(dir)) continue;
        const files = fs.readdirSync(dir).filter(file => file.endsWith('.md'));
        for (const file of files) {
            const fullPath = path.join(dir, file);
            const content = fs.readFileSync(fullPath, 'utf8');
            if (content.includes(finding.fingerprint)) {
                return {
                    filePath: fullPath,
                    id: extractFeatureIdFromPath(fullPath),
                    reason: 'matching fingerprint',
                };
            }
        }
    }

    return null;
}

function findPrioritisedBacklogSpec(repoPath, slug) {
    const { STAGE_FOLDERS } = require('../workflow-core/paths');
    const specCrud = require('../spec-crud');
    const featureConfig = getFeatureTypeConfig(repoPath);
    const found = specCrud.findFile(featureConfig, slug, [STAGE_FOLDERS.BACKLOG]);
    if (!found) return null;
    const id = extractFeatureIdFromPath(found.fullPath);
    if (!id) return null;
    return { id, filePath: found.fullPath };
}

function resolveFeatureSlugs(finding) {
    const { slugify } = require('../cli-parse');
    const displayName = buildFeatureDisplayName(finding);
    const createSlug = slugify(displayName);
    const legacySlug = buildFeatureSlug(finding);
    return { displayName, createSlug, legacySlug };
}

async function createFeatureForFinding(repoPath, finding, reportPath, deps = {}) {
    const runCmd = deps.runAigonCommand || runAigonCommand;
    const { displayName, createSlug, legacySlug } = resolveFeatureSlugs(finding);
    const slugCandidates = createSlug === legacySlug ? [createSlug] : [createSlug, legacySlug];

    const existing = findExistingFeatureForFinding(repoPath, finding, slugCandidates);
    if (existing) {
        return {
            skipped: true,
            reason: 'duplicate finding',
            existingId: existing.id,
            existingPath: existing.filePath,
        };
    }

    const summary = buildFeatureSummary(finding, reportPath);

    try {
        runCmd(repoPath, ['feature-create', displayName, '--description', summary]);
    } catch (err) {
        return { failed: true, step: 'feature-create', reason: err.message };
    }

    try {
        runCmd(repoPath, ['feature-prioritise', createSlug]);
    } catch (err) {
        return { failed: true, step: 'feature-prioritise', reason: err.message };
    }

    let prioritised = findPrioritisedBacklogSpec(repoPath, createSlug);
    if (!prioritised && legacySlug !== createSlug) {
        prioritised = findPrioritisedBacklogSpec(repoPath, legacySlug);
    }
    if (!prioritised) {
        return {
            failed: true,
            step: 're-locate',
            reason: `prioritised spec not found in backlog for slug '${createSlug}'`,
        };
    }

    return { created: true, id: prioritised.id, filePath: prioritised.filePath };
}

async function runSecurityScan(args) {
    const { parseCliOptions } = require('../cli-parse');
    const options = parseCliOptions(args);

    const dryRun = options['dry-run'] !== undefined;
    const noLlm = options['no-llm'] !== undefined;
    const noFeature = options['no-feature'] !== undefined || options['no-feedback'] !== undefined;
    const sinceArg = options['since'] || null;

    const repoPath = getRepoPath();

    const { readState, writeState, readSuppressions, stashRaw, writeReport } = require('../security-scan/report');
    const { triage } = require('../security-scan/triage');

    const state = readState(repoPath);
    const since = getSinceSha(repoPath, sinceArg, state);
    const currentSha = getCurrentSha(repoPath);
    const iso = new Date().toISOString().slice(0, 10);

    console.log(`🔒 Security scan starting`);
    console.log(`   Scope: commits since ${since.slice(0, 12)}`);
    if (dryRun) console.log(`   Mode: dry-run (no files written)`);

    const suppressions = readSuppressions(repoPath);
    const allFindings = [];
    const scanOpts = { cwd: repoPath, since, noLlm };

    // Run deterministic runners
    const runners = [
        { name: 'gitleaks', ext: 'json', mod: require('../security-scan/runners/gitleaks') },
        { name: 'osv-scanner', ext: 'json', mod: require('../security-scan/runners/osv') },
        { name: 'semgrep', ext: 'json', mod: require('../security-scan/runners/semgrep') },
        { name: 'npm-audit', ext: 'json', mod: require('../security-scan/runners/npm-audit') },
    ];

    for (const runner of runners) {
        process.stdout.write(`   Running ${runner.name}... `);
        try {
            const result = await runner.mod.run(scanOpts);
            if (result.skipped) {
                console.log(`⚠️  skipped (${result.reason})`);
            } else {
                console.log(`✅ ${result.findings.length} finding(s)`);
                allFindings.push(...result.findings);
                if (!dryRun) stashRaw(repoPath, runner.name, runner.ext, result.raw);
            }
        } catch (err) {
            console.log(`❌ error: ${err.message}`);
        }
    }

    // LLM layer
    if (!noLlm) {
        process.stdout.write(`   Running claude /security-review... `);
        try {
            const llm = require('../security-scan/llm');
            const result = await llm.run(scanOpts);
            if (result.skipped) {
                console.log(`⚠️  skipped (${result.reason})`);
            } else {
                console.log(`✅ ${result.findings.length} finding(s)`);
                allFindings.push(...result.findings);
                if (!dryRun) stashRaw(repoPath, 'claude-security-review', 'json', result.raw);
            }
        } catch (err) {
            console.log(`❌ error: ${err.message}`);
        }
    }

    const totalRaw = allFindings.length;
    const { top, overflow, total } = triage(allFindings, suppressions);

    console.log(`\n📊 Results: ${totalRaw} raw findings → ${total} after triage → showing top ${top.length}`);

    const { jsonPath, mdPath, digest } = writeReport(
        repoPath,
        { top, overflow, total },
        allFindings,
        { iso, since, totalRaw },
        dryRun
    );

    if (dryRun) {
        console.log(`\n📋 Digest (dry-run — not written to disk):\n`);
        console.log(digest);
    } else {
        console.log(`\n📄 Report: ${path.relative(repoPath, jsonPath)}`);
        console.log(`📋 Digest: ${path.relative(repoPath, mdPath)}`);
    }

    // Auto-create follow-up features for HIGH survivors
    if (!noFeature && !dryRun) {
        const highFindings = top.filter(f => f.severity === 'HIGH');
        if (highFindings.length > 0) {
            const reportPath = mdPath ? path.relative(repoPath, mdPath) : null;
            console.log(`\n📝 Creating follow-up feature specs for ${highFindings.length} HIGH finding(s)...`);
            for (const f of highFindings) {
                const result = await createFeatureForFinding(repoPath, f, reportPath);
                if (result.created && result.id) {
                    console.log(`   ✅ feature-${result.id} created`);
                } else if (result.failed) {
                    console.log(`   ❌ filing failed at ${result.step}: ${result.reason}`);
                } else if (result.skipped && result.reason === 'duplicate finding') {
                    const label = result.existingId
                        ? `feature-${result.existingId}`
                        : 'existing spec (not yet prioritised)';
                    console.log(`   ⏭️  skipped (already filed as ${label})`);
                } else if (result.skipped) {
                    console.log(`   ⚠️  skipped (${result.reason})`);
                }
            }
        }
    }

    // Update state after successful scan
    if (!dryRun && currentSha) {
        writeState(repoPath, currentSha, iso);
    }

    console.log(`\n✅ Security scan complete`);
}

// `--install-recurring` removed with feature 236; the weekly cron wrapper
// lived in the recurring engine that moved to @aigon/pro. Use `aigon
// security-scan` on demand or schedule it via Pro's `aigon schedule`.

function createSecurityScanCommands() {
    return {
        'security-scan': async (args) => {
            try {
                await runSecurityScan(args);
            } catch (err) {
                console.error(`❌ security-scan failed: ${err.message}`);
                if (process.env.AIGON_NO_STACK !== '1') console.error(err.stack);
                process.exitCode = 1;
            }
        },
    };
}

module.exports = {
    createSecurityScanCommands,
    createFeatureForFinding,
    findPrioritisedBacklogSpec,
    resolveFeatureSlugs,
    runAigonCommand,
};
