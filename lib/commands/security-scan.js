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

async function createFeedbackForFinding(repoPath, finding) {
    try {
        const specCrud = require('../spec-crud');
        const feedbackLib = require('../feedback');
        const { parseFrontMatter, slugify } = require('../cli-parse');
        const templates = require('../templates');

        const { PATHS, SPECS_ROOT, FEEDBACK_STATUS_TO_FOLDER, readTemplate } = templates;
        const { getNextId } = specCrud;
        const { normalizeFeedbackMetadata, buildFeedbackDocumentContent } = feedbackLib;

        const inboxDir = path.join(PATHS.feedback.root, FEEDBACK_STATUS_TO_FOLDER['inbox']);
        fs.mkdirSync(inboxDir, { recursive: true });

        const nextId = getNextId(PATHS.feedback);
        const title = `[Security] ${finding.severity}: ${finding.category} in ${finding.file || 'codebase'}`;
        const slug = slugify(title.slice(0, 60));
        const filename = `feedback-${nextId}-${slug}.md`;
        const filePath = path.join(inboxDir, filename);

        // Skip if a feedback item with this fingerprint already exists
        const allFolders = PATHS.feedback.folders;
        for (const folder of allFolders) {
            const dir = path.join(PATHS.feedback.root, folder);
            if (!fs.existsSync(dir)) continue;
            const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
            for (const f of files) {
                const content = fs.readFileSync(path.join(dir, f), 'utf8');
                if (content.includes(finding.fingerprint)) return { skipped: true, reason: 'duplicate fingerprint' };
            }
        }

        const projectTemplatePath = path.join(SPECS_ROOT, 'templates', 'feedback-template.md');
        const templateStr = fs.existsSync(projectTemplatePath)
            ? fs.readFileSync(projectTemplatePath, 'utf8')
            : readTemplate('specs/feedback-template.md');
        const parsedTemplate = parseFrontMatter(templateStr);

        const metadata = normalizeFeedbackMetadata(parsedTemplate.data, {
            id: nextId,
            title,
            status: 'inbox',
            type: 'security',
            severity: finding.severity === 'HIGH' ? 'high' : 'medium',
        });

        const body = [
            `## Summary`,
            ``,
            `Security finding from automated scan.`,
            ``,
            `**Tool:** ${finding.tool}`,
            `**Category:** ${finding.category}`,
            `**Severity:** ${finding.severity}`,
            `**Confidence:** ${Math.round((finding.confidence || 0) * 100)}%`,
            `**File:** ${finding.file || '—'}${finding.line ? `:${finding.line}` : ''}`,
            `**Fingerprint:** \`${finding.fingerprint}\``,
            ``,
            `## Details`,
            ``,
            finding.message || '',
            ``,
            `## To suppress`,
            ``,
            `Add to \`.scan/suppressions.json\`:`,
            `\`\`\`json`,
            `{ "fingerprint": "${finding.fingerprint}", "status": "fp", "note": "reason here" }`,
            `\`\`\``,
        ].join('\n');

        const content = buildFeedbackDocumentContent(metadata, body);
        fs.writeFileSync(filePath, content);
        return { created: true, filePath, id: nextId };
    } catch (err) {
        return { skipped: true, reason: err.message };
    }
}

async function runSecurityScan(args) {
    const { parseCliOptions } = require('../cli-parse');
    const options = parseCliOptions(args);

    const dryRun = options['dry-run'] !== undefined;
    const noLlm = options['no-llm'] !== undefined;
    const noFeedback = options['no-feedback'] !== undefined;
    const installRecurring = options['install-recurring'] !== undefined;
    const sinceArg = options['since'] || null;

    const repoPath = getRepoPath();

    if (installRecurring) {
        return installRecurringSchedule(repoPath);
    }

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

    // Auto-create feedback for HIGH survivors
    if (!noFeedback && !dryRun) {
        const highFindings = top.filter(f => f.severity === 'HIGH');
        if (highFindings.length > 0) {
            console.log(`\n📝 Creating feedback items for ${highFindings.length} HIGH finding(s)...`);
            for (const f of highFindings) {
                const result = await createFeedbackForFinding(repoPath, f);
                if (result.created) {
                    console.log(`   ✅ feedback-${result.id} created`);
                } else if (result.skipped && result.reason === 'duplicate fingerprint') {
                    console.log(`   ⏭️  skipped (already reported)`);
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

function installRecurringSchedule(repoPath) {
    const recurringDir = path.join(repoPath, 'docs', 'specs', 'recurring');
    fs.mkdirSync(recurringDir, { recursive: true });

    const templatePath = path.join(recurringDir, 'security-scan-weekly.md');
    if (fs.existsSync(templatePath)) {
        console.log(`ℹ️  Recurring schedule already installed: docs/specs/recurring/security-scan-weekly.md`);
        return;
    }

    const content = [
        '---',
        'schedule: weekly',
        'name_pattern: security-scan-{{YYYY-WW}}',
        'recurring_slug: security-scan-weekly',
        'complexity: low',
        'cron: 0 6 * * 1',
        '---',
        '',
        '# security-scan-{{YYYY-WW}}',
        '',
        '## Summary',
        '',
        'Run the weekly security scan against the aigon repo.',
        'Orchestrates gitleaks, osv-scanner, semgrep, npm audit, and the Claude /security-review skill.',
        'HIGH survivors auto-create feedback items.',
        '',
        '## Acceptance Criteria',
        '',
        '- [ ] Run `aigon security-scan` and confirm exit 0',
        '- [ ] Review digest at `.scan/reports/<date>.md`',
        '- [ ] Triage any new HIGH-severity feedback items created',
        '- [ ] Commit updated `.scan/state.json`',
        '',
    ].join('\n');

    fs.writeFileSync(templatePath, content);
    console.log(`✅ Recurring schedule installed: docs/specs/recurring/security-scan-weekly.md`);
    console.log(`   Cron: 0 6 * * 1 (Monday 06:00 local)`);
    console.log(`   View with: aigon recurring list`);
}

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

module.exports = { createSecurityScanCommands };
