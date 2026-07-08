'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const readline = require('readline');
const { readAgentStatus } = require('../agent-status');
const { getFeatureSubmissionEvidence } = require('../feature-command-helpers');
const { isProAvailable, getPro } = require('../pro');
const telemetry = require('../telemetry');
const { parseFrontMatter, parseYamlScalar, serializeYamlScalar, parseCliOptions, getOptionValue } = require('../cli-parse');
const { sendNudge } = require('../nudge');

module.exports = function insightsCommands(ctx) {
    const u = ctx.utils;
    const {
        getCurrentBranch,
        getCommitAnalytics,
        filterCommitAnalytics,
        buildCommitAnalyticsSummary,
        getDefaultBranch,
        getMainRepoPath,
        getStatus,
        listBranches,
        listWorktrees,
        filterWorktreesByFeature,
    } = ctx.git;

    const {
        PATHS,
        readTemplate,
        processTemplate,
        runDeployCommand,
        upsertLogFrontmatterScalars,
        getStateDir,
        safeRemoveWorktree,
        removeWorktreePermissions,
        removeWorktreeTrust,
        gcCaddyRoutes,
        getAvailableAgents,
        parseConfigScope,
    } = u;

    return {
                'insights': async (args) => {
            if (!isProAvailable()) {
                console.log('ℹ️  AADE Insights is a Pro feature — coming later.');
                console.log('   Free alternative: aigon commits, aigon board, aigon feature-status <id>');
                console.log('   Pro is in development and not yet available for purchase.');
                return;
            }

            const pro = getPro();
            const insights = pro.insights;
            const includeCoaching = args.includes('--coach');
            const refreshOnly = args.includes('--refresh');

            if (includeCoaching) {
                const projectConfig = u.loadProjectConfig();
                const tier = insights.resolveTier(projectConfig);
                const costCap = insights.getCostCap(projectConfig);

                if (tier !== 'pro') {
                    console.error('❌ AI coaching is gated to Pro tier. Set `.aigon/config.json` with `"tier": "pro"` to enable `--coach`.');
                    return;
                }

                console.log(`⚠️  AI coaching may incur API cost (cap: ~$${costCap.toFixed(2)} per request).`);
                console.log('   Proceeding with Claude API coaching using aggregated metrics only.');
                console.log('');
            }

            const payload = await insights.generateAndCacheInsights({ includeCoaching, loadProjectConfig: u.loadProjectConfig });
            const output = insights.formatInsightsForCli(payload, { includeCoaching });
            console.log(output);

            if (refreshOnly) {
                console.log(`\n✅ Refreshed cache: ${insights.CACHE_RELATIVE_PATH}`);
            }
        },

                'stats': (args) => {
            // Feature 230: terminal summary backed by stats-aggregate cache.
            // Feature 288: --feature <id> shows per-activity breakdown for a specific feature.
            const statsAggregate = require('../stats-aggregate');
            const { readStats } = require('../feature-status');
            const wantJson = args.includes('--json');
            const force = args.includes('--rebuild');
            const showAgents = args.includes('--agents');
            const showTriplets = args.includes('--triplets');

            // --feature <id> — per-activity detail for a specific feature
            const featureIdx = args.findIndex(a => a === '--feature' || a === '-f');
            const featureId = featureIdx >= 0 ? args[featureIdx + 1] : null;
            if (featureId) {
                const repoPath = process.cwd();
                const stats = readStats(repoPath, 'feature', featureId);
                if (!stats) {
                    process.stderr.write(`No stats found for feature ${featureId}.\n`);
                    process.exitCode = 1;
                    return;
                }
                if (wantJson) {
                    process.stdout.write(JSON.stringify(stats, null, 2) + '\n');
                    return;
                }
                const cost = stats.cost || {};
                process.stdout.write(`\n📊 Feature #${featureId} cost breakdown\n`);
                if (cost.workflowRunId) process.stdout.write(`   Workflow run ID: ${cost.workflowRunId}\n`);
                process.stdout.write(`   Total cost:      $${(cost.estimatedUsd || 0).toFixed(4)}\n`);
                process.stdout.write(`   Sessions:        ${cost.sessions || 0}\n`);
                if (cost.costByActivity && Object.keys(cost.costByActivity).length > 0) {
                    process.stdout.write(`   Per-activity:\n`);
                    for (const [act, row] of Object.entries(cost.costByActivity)) {
                        process.stdout.write(`     ${act.padEnd(12)} sessions=${row.sessions}  input=${row.inputTokens}  output=${row.outputTokens}  cost=$${(row.costUsd || 0).toFixed(4)}\n`);
                    }
                }
                if (cost.costByAgent && Object.keys(cost.costByAgent).length > 0) {
                    process.stdout.write(`   Per-agent:\n`);
                    for (const [agentId, row] of Object.entries(cost.costByAgent)) {
                        process.stdout.write(`     ${agentId.padEnd(4)} sessions=${row.sessions}  cost=$${(row.costUsd || 0).toFixed(4)}\n`);
                    }
                }
                process.stdout.write('\n');
                return;
            }

            // Default to the global conductor repo list, falling back to cwd.
            const { readConductorReposFromGlobalConfig } = require('../dashboard-server');
            const repoList = readConductorReposFromGlobalConfig();
            const repos = (Array.isArray(repoList) && repoList.length > 0) ? repoList : [process.cwd()];

            const byRepo = repos.map(repoPath => ({
                repoPath: path.resolve(repoPath),
                aggregate: statsAggregate.collectAggregateStats(path.resolve(repoPath), { force }),
            }));

            if (wantJson) {
                process.stdout.write(JSON.stringify({ version: statsAggregate.CACHE_VERSION, repos: byRepo }, null, 2) + '\n');
                return;
            }

            const fmtMs = (ms) => {
                if (!ms) return '—';
                const s = Math.round(ms / 1000);
                if (s < 60) return `${s}s`;
                const m = Math.round(s / 60);
                if (m < 60) return `${m}m`;
                const h = Math.floor(m / 60);
                const rem = m % 60;
                return `${h}h${rem ? ` ${rem}m` : ''}`;
            };

            for (const entry of byRepo) {
                const a = entry.aggregate;
                process.stdout.write(`\n📊 ${path.basename(entry.repoPath)} (${entry.repoPath})\n`);
                process.stdout.write(`   Features completed: ${a.totals.features}\n`);
                if (a.totals.research) process.stdout.write(`   Research completed: ${a.totals.research}\n`);
                process.stdout.write(`   Total cost (USD):   $${(a.totals.cost || 0).toFixed(2)}\n`);
                process.stdout.write(`   Total commits:      ${a.totals.commits}\n`);
                process.stdout.write(`   Lines +/-:          +${a.totals.linesAdded} / -${a.totals.linesRemoved}\n`);
                process.stdout.write(`   Avg duration:       ${fmtMs(a.avgDurationMs)}\n`);
                if (a.fastestFeature) process.stdout.write(`   Fastest feature:    #${a.fastestFeature.entityId} (${fmtMs(a.fastestFeature.durationMs)})\n`);
                if (a.mostExpensive)  process.stdout.write(`   Most expensive:     #${a.mostExpensive.entityId} ($${a.mostExpensive.cost.toFixed(2)})\n`);
                if (showAgents && a.perAgent && Object.keys(a.perAgent).length > 0) {
                    process.stdout.write(`   Per-agent:\n`);
                    for (const [agentId, row] of Object.entries(a.perAgent)) {
                        process.stdout.write(`     ${agentId.padEnd(4)} features=${row.features} cost=$${(row.cost || 0).toFixed(2)} sessions=${row.sessions || 0}\n`);
                    }
                }
                if (showTriplets && a.perTriplet && Object.keys(a.perTriplet).length > 0) {
                    process.stdout.write(`   Per-triplet (agent · model · effort):\n`);
                    const triplets = Object.values(a.perTriplet).sort((x, y) => (y.cost || 0) - (x.cost || 0));
                    for (const t of triplets) {
                        const label = `${t.agent} · ${t.model || '—'} · ${t.effort || '—'}`;
                        process.stdout.write(`     ${label.padEnd(40)} features=${t.features} cost=$${(t.cost || 0).toFixed(2)} sessions=${t.sessions || 0}\n`);
                    }
                }
                process.stdout.write(`   Cache: ${statsAggregate.cachePath(entry.repoPath)}\n`);
            }
            process.stdout.write('\n');
        },

                'commits': (args) => {
            const parseArgValue = (flag) => {
                const exact = args.find(a => a.startsWith(`${flag}=`));
                if (exact) return exact.slice(flag.length + 1);
                const idx = args.indexOf(flag);
                if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
                return null;
            };
            const parsePeriodDays = (raw) => {
                if (!raw) return null;
                const m = String(raw).trim().match(/^(\d+)([dwm])$/i);
                if (!m) return null;
                const n = parseInt(m[1], 10);
                const unit = m[2].toLowerCase();
                if (unit === 'd') return n;
                if (unit === 'w') return n * 7;
                if (unit === 'm') return n * 30;
                return null;
            };
            const parseLimit = (raw) => {
                if (!raw) return 40;
                const n = parseInt(raw, 10);
                if (!Number.isFinite(n) || n <= 0) return 40;
                return Math.min(n, 200);
            };

            const feature = parseArgValue('--feature');
            const agent = parseArgValue('--agent');
            const periodRaw = parseArgValue('--period') || '30d';
            const periodDays = parsePeriodDays(periodRaw);
            const limit = parseLimit(parseArgValue('--limit'));
            const refresh = args.includes('--refresh');

            const payload = getCommitAnalytics({ cwd: process.cwd(), forceRefresh: refresh });
            let commits = filterCommitAnalytics(payload.commits, {
                feature: feature || null,
                agent: agent || null,
                periodDays
            });
            commits = commits
                .slice()
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

            const summary = buildCommitAnalyticsSummary(commits);
            console.log(`\n📊 Commits (${periodRaw})`);
            if (feature) console.log(`Feature filter: #${String(parseInt(feature, 10))}`);
            if (agent) console.log(`Agent filter: ${agent}`);
            console.log(`Total: ${summary.total} commits`);
            console.log(`Files changed: ${summary.filesChanged}`);
            console.log(`Lines: +${summary.linesAdded} / -${summary.linesRemoved}\n`);

            if (commits.length === 0) {
                console.log('No commits found for the selected filters.');
                return;
            }

            console.log('Date       Hash     F#   Agent  Files   +Lines  -Lines  Message');
            console.log('---------  -------  ---  -----  ------  ------  ------  -------');
            commits.slice(0, limit).forEach(c => {
                const date = c.date ? c.date.slice(0, 10) : '----------';
                const hash = (c.hash || '').slice(0, 7).padEnd(7, ' ');
                const f = c.featureId ? `#${String(c.featureId).padStart(2, '0')}` : '-';
                const a = c.agent || '-';
                const files = String(c.filesChanged || 0).padStart(5, ' ');
                const add = String(c.linesAdded || 0).padStart(6, ' ');
                const rem = String(c.linesRemoved || 0).padStart(6, ' ');
                console.log(`${date}  ${hash}  ${String(f).padEnd(3, ' ')}  ${String(a).padEnd(5, ' ')}  ${files}  ${add}  ${rem}  ${c.message || ''}`);
            });

            if (commits.length > limit) {
                console.log(`\nShowing ${limit} of ${commits.length} commits. Use --limit <N> to expand.`);
            }
        },

                'capture-session-telemetry': async (args) => {
            // Transcript path can come from CLI arg (manual) or stdin JSON (CC SessionEnd hook)
            let transcriptPath = args[0] || null;

            if (!transcriptPath && !process.stdin.isTTY) {
                try {
                    const chunks = [];
                    for await (const chunk of process.stdin) chunks.push(chunk);
                    const data = JSON.parse(Buffer.concat(chunks).toString());
                    transcriptPath = data.transcript_path || null;
                } catch (_) { /* stdin not available or not JSON */ }
            }

            if (!transcriptPath) return;
            try {
                const repoPath = process.env.AIGON_PROJECT_PATH || process.cwd();
                telemetry.captureSessionTelemetry(transcriptPath, {
                    parseFrontMatter,
                    parseYamlScalar,
                    serializeYamlScalar,
                    upsertLogFrontmatterScalars,
                    logsDir: path.join(repoPath, 'docs', 'specs', 'features', 'logs'),
                    getCurrentBranch,
                });
            } catch (e) {
                // Silent failure — hook should not block the session
            }
        },

                'capture-antigravity-telemetry': async () => {
            try {
                const repoPath = process.env.AIGON_PROJECT_PATH || process.cwd();
                let featureId, agentId, entityType = 'feature', activity = 'implement';

                if (process.env.AIGON_ENTITY_TYPE && process.env.AIGON_ENTITY_ID && process.env.AIGON_AGENT_ID) {
                    entityType = process.env.AIGON_ENTITY_TYPE;
                    featureId = process.env.AIGON_ENTITY_ID;
                    agentId = process.env.AIGON_AGENT_ID;
                } else {
                    let branch;
                    try { branch = getCurrentBranch(repoPath); } catch (_) { return; }
                    if (!branch) return;
                    const m = branch.match(/^feature-(\d+)-ag-(.+)$/);
                    if (!m) return;
                    featureId = m[1];
                    agentId = 'ag';
                }
                if (agentId !== 'ag') return;

                if (process.env.AIGON_ACTIVITY) activity = process.env.AIGON_ACTIVITY;

                telemetry.parseAntigravityTranscripts(repoPath, {
                    featureId,
                    entityType,
                    repoPath,
                    activity,
                    workflowRunId: process.env.AIGON_WORKFLOW_RUN_ID || null,
                });
            } catch (_) { /* hook must not block the session */ }
        },

                'token-window': async (args) => {
            const options = parseCliOptions(args);
            const customMessage = getOptionValue(options, 'message') || null;
            const dryRun = args.includes('--dry-run');
            const agentsRaw = getOptionValue(options, 'agents');
            const agentsFilter = agentsRaw ? String(agentsRaw).split(',').map(s => s.trim()).filter(Boolean) : [];

            const globalConfig = require('../config').loadGlobalConfig();
            const twConfig = globalConfig.tokenWindow || {};
            const message = customMessage || twConfig.message || 'Checking in to align token window';
            const targetAgents = agentsFilter.length > 0 ? agentsFilter : (twConfig.targetAgents || []);

            let sessions = [];
            try {
                const { createAgentSessionService } = require('../agent-sessions');
                sessions = createAgentSessionService().listLiveSessions().sessions || [];
            } catch (e) {
                sessions = [];
            }

            const active = sessions.filter(s => s.entityId && s.agent && (s.entityType === 'f' || s.entityType === 'r'));
            const filtered = targetAgents.length > 0
                ? active.filter(s => targetAgents.includes(s.agent))
                : active;

            if (filtered.length === 0) {
                console.log('ℹ️  No active agent sessions found for token-window kickoff.');
                return;
            }

            const byEntity = new Map();
            for (const s of filtered) {
                const entityType = s.entityType === 'f' ? 'feature' : 'research';
                const key = `${entityType}:${s.entityId}`;
                if (!byEntity.has(key)) byEntity.set(key, []);
                byEntity.get(key).push(s);
            }

            let sent = 0;
            let failed = 0;
            for (const [key, sessionsGroup] of byEntity) {
                const [entityType, entityId] = key.split(':');
                for (const session of sessionsGroup) {
                    if (dryRun) {
                        console.log(`[dry-run] Would nudge ${entityType} ${entityId} ${session.agent}: ${message}`);
                        sent++;
                        continue;
                    }
                    try {
                        const repoPath = session.repoPath || process.cwd();
                        await sendNudge(repoPath, entityId, message, {
                            agentId: session.agent,
                            entityType,
                        });
                        sent++;
                        console.log(`✅ Nudge delivered to ${entityType} ${entityId} ${session.agent}`);
                    } catch (e) {
                        failed++;
                        console.error(`❌ Failed to nudge ${entityType} ${entityId} ${session.agent}: ${e.message}`);
                    }
                }
            }

            if (!dryRun && sent > 0) {
                const stateDir = path.join(process.cwd(), '.aigon', 'state');
                fs.mkdirSync(stateDir, { recursive: true });
                fs.writeFileSync(path.join(stateDir, 'last-token-kickoff'), new Date().toISOString());
                console.log(`📝 Recorded kickoff timestamp to .aigon/state/last-token-kickoff`);
            }

            console.log(`\nToken window kickoff: ${sent} sent, ${failed} failed`);
        }
    };
};
