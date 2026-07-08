'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { parseLogFrontmatterForBackfill } = require('./feature-command-helpers');

function run(args, deps) {
    const { readConductorReposFromGlobalConfig } = deps;

            const dryRun = args.includes('--dry-run');
            const repoArg = args.find(a => a.startsWith('--repo='));
            const targetRepo = repoArg ? repoArg.slice('--repo='.length) : null;
            const excludeAboveArg = args.find(a => a.startsWith('--exclude-above='));
            const excludeAboveHours = excludeAboveArg ? parseFloat(excludeAboveArg.slice('--exclude-above='.length)) : null;
            // Active hours: 08:00 – 23:00 local → anything outside = "autonomous"
            const activeHourStart = 8;
            const activeHourEnd = 23;

            const repos = readConductorReposFromGlobalConfig();
            if (!repos || repos.length === 0) {
                return console.error('❌ No repos registered in global config. Add repos to ~/.aigon/config.json first.');
            }

            // repos is an array of path strings
            const repoPaths = repos.map(r => (typeof r === 'string' ? r : r.path)).filter(Boolean);

            const filteredPaths = targetRepo
                ? repoPaths.filter(p => p.includes(targetRepo))
                : repoPaths;

            if (filteredPaths.length === 0) {
                return console.error(`❌ No repos matched --repo=${targetRepo}`);
            }

            let totalPatched = 0;
            let totalSkipped = 0;
            let totalErrors = 0;

            filteredPaths.forEach(repoPath => {
                if (!repoPath || !fs.existsSync(repoPath)) return;

                const logsDir = path.join(repoPath, 'docs/specs/features/logs');
                if (!fs.existsSync(logsDir)) return;

                const logFiles = fs.readdirSync(logsDir)
                    .filter(f => f.endsWith('-log.md') && !fs.lstatSync(path.join(logsDir, f)).isDirectory())
                    .sort();

                console.log(`\n📁 ${repoPath} (${logFiles.length} logs)`);

                logFiles.forEach(logFile => {
                    const logPath = path.join(logsDir, logFile);
                    let content;
                    try { content = fs.readFileSync(logPath, 'utf8'); } catch (e) { totalErrors++; return; }

                    const { fields, events } = parseLogFrontmatterForBackfill(content);
                    const patches = {};

                    // --- Infer startedAt ---
                    if (!fields.startedAt) {
                        let startedAt = null;
                        try {
                            const gitOut = execSync(
                                `git -C "${repoPath}" log --follow --diff-filter=A --format="%aI" -- "docs/specs/features/logs/${logFile}" 2>/dev/null`,
                                { encoding: 'utf8', timeout: 8000 }
                            ).trim();
                            if (gitOut) startedAt = gitOut.split('\n').pop().trim(); // oldest = last line
                        } catch (_) {}

                        // Also try logs/ root (before selected/)
                        if (!startedAt) {
                            try {
                                const gitOut = execSync(
                                    `git -C "${repoPath}" log --follow --diff-filter=A --format="%aI" -- "docs/specs/features/logs/${logFile}" 2>/dev/null`,
                                    { encoding: 'utf8', timeout: 8000 }
                                ).trim();
                                if (gitOut) startedAt = gitOut.split('\n').pop().trim();
                            } catch (_) {}
                        }

                        if (startedAt) patches.setStartedAt = startedAt;
                    }

                    // --- Infer completedAt ---
                    if (!fields.completedAt) {
                        let completedAt = null;
                        try {
                            const gitOut = execSync(
                                `git -C "${repoPath}" log --diff-filter=A --format="%aI" -- "docs/specs/features/logs/${logFile}" 2>/dev/null`,
                                { encoding: 'utf8', timeout: 8000 }
                            ).trim();
                            if (gitOut) completedAt = gitOut.split('\n')[0].trim(); // newest = first line
                        } catch (_) {}

                        if (!completedAt) {
                            try {
                                const gitOut = execSync(
                                    `git -C "${repoPath}" log -1 --format="%aI" -- "docs/specs/features/logs/${logFile}" 2>/dev/null`,
                                    { encoding: 'utf8', timeout: 8000 }
                                ).trim();
                                if (gitOut) completedAt = gitOut.trim();
                            } catch (_) {}
                        }

                        if (completedAt) patches.forceCompletedAt = completedAt;
                    }

                    // --- Auto-set cycleTimeExclude if --exclude-above threshold exceeded ---
                    if (excludeAboveHours !== null && !isNaN(excludeAboveHours) && fields.cycleTimeExclude === undefined) {
                        const startTs = patches.setStartedAt || fields.startedAt;
                        const endTs = patches.forceCompletedAt || fields.completedAt;
                        if (startTs && endTs) {
                            const durationHours = (new Date(endTs).getTime() - new Date(startTs).getTime()) / 3600000;
                            if (durationHours > excludeAboveHours) {
                                patches.setCycleTimeExclude = true;
                            }
                        }
                    }

                    // --- Infer autonomyRatio ---
                    if (fields.autonomyRatio === undefined) {
                        let autonomyRatio = null;
                        try {
                            const featureMatch = logFile.match(/^feature-(\d+)-/);
                            if (featureMatch) {
                                const gitOut = execSync(
                                    `git -C "${repoPath}" log --format="%aI" -- "docs/specs/features/logs/${logFile}" "docs/specs/features/logs/${logFile}" 2>/dev/null`,
                                    { encoding: 'utf8', timeout: 8000 }
                                ).trim();
                                if (gitOut) {
                                    const commitTimes = gitOut.split('\n').map(s => s.trim()).filter(Boolean);
                                    if (commitTimes.length > 0) {
                                        const autonomous = commitTimes.filter(ts => {
                                            const d = new Date(ts);
                                            const hour = d.getHours(); // local time
                                            return hour < activeHourStart || hour >= activeHourEnd;
                                        });
                                        autonomyRatio = (autonomous.length / commitTimes.length).toFixed(2);
                                    }
                                }
                            }
                        } catch (_) {}

                        if (autonomyRatio !== null) patches.setAutonomyRatio = autonomyRatio;
                    }

                    const patchCount = Object.keys(patches).length;
                    if (patchCount === 0) {
                        totalSkipped++;
                        return;
                    }

                    const patchDesc = Object.entries(patches).map(([k, v]) => {
                        const name = k.replace('set', '').replace('force', '').toLowerCase();
                        const val = typeof v === 'string' ? v.slice(0, 10) : v;
                        return `${name}=${val}`;
                    }).join(', ');

                    console.log(`  ${dryRun ? '[dry-run] ' : ''}${logFile}: ${patchDesc}`);

                    if (!dryRun) {
                        // NOTE: Log frontmatter writes removed — timestamps now live in manifests.
                        // This command is now dry-run only (reports what would change).
                        console.log(`    ⚠️  Skipped write — log frontmatter is deprecated. Use manifests for timestamps.`);
                        totalSkipped++;
                    } else {
                        totalPatched++;
                    }
                });
            });

            console.log(`\n${dryRun ? '[dry-run] ' : ''}✅ Done: ${totalPatched} patched, ${totalSkipped} skipped (already set), ${totalErrors} errors`);
            if (dryRun) console.log('   Run without --dry-run to apply patches.');
}

module.exports = { run };
