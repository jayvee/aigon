'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const { writeAgentStatusAt, readAgentStatus } = require('../agent-status');
const { isProAvailable, getPro } = require('../pro');
const { runSecurityScan } = require('../security');
const telemetry = require('../telemetry');
const { getSnapshotPath } = require('../workflow-core/paths');
const featureReviewState = require('../feature-review-state');
const researchReviewState = require('../research-review-state');
const wf = require('../workflow-core');
const { emitHeartbeat } = require('../workflow-heartbeat');
const { writeStats } = require('../feature-status');
const workflowRulesReport = require('../workflow-rules-report');
const { parseTmuxSessionName } = require('../worktree');

module.exports = function miscCommands(ctx) {
    const u = ctx.utils;
    const { getCurrentBranch, getCommitAnalytics, filterCommitAnalytics, buildCommitAnalyticsSummary } = ctx.git;

    const {
        PATHS,
        readTemplate,
        runDeployCommand,
        parseFrontMatter,
        parseYamlScalar,
        serializeYamlScalar,
        upsertLogFrontmatterScalars,
    } = u;

    return {
        'agent-status': (args) => {
            const status = args[0];
            const validStatuses = ['implementing', 'waiting', 'submitted', 'error', 'reviewing', 'review-complete'];
            if (!status || !validStatuses.includes(status)) {
                return console.error(`Usage: aigon agent-status <status>\n\nValid statuses: ${validStatuses.join(', ')}\n\nExample: aigon agent-status waiting`);
            }

            // Detect branch
            const branch = getCurrentBranch();
            if (!branch) {
                return console.error('❌ Could not detect current branch.');
            }

            let reviewSessionInfo = null;
            if (status === 'reviewing' || status === 'review-complete') {
                try {
                    const sessionName = execSync('tmux display-message -p "#S"', {
                        encoding: 'utf8',
                        stdio: ['ignore', 'pipe', 'ignore']
                    }).trim();
                    const parsedSession = parseTmuxSessionName(sessionName);
                    if (parsedSession && (parsedSession.type === 'f' || parsedSession.type === 'r') && /^review-[a-z]{2}$/.test(parsedSession.agent)) {
                        reviewSessionInfo = {
                            featureNum: parsedSession.id.padStart(2, '0'),
                            agentId: parsedSession.agent.replace(/^review-/, ''),
                            entityType: parsedSession.type === 'r' ? 'research' : 'feature',
                        };
                    }
                } catch (_) { /* not in tmux or not a review session */ }
            }

            // Parse feature ID and agent from branch name
            // Arena/worktree: feature-<ID>-<agent>-<desc>
            // Solo: feature-<ID>-<desc>
            const arenaMatch = branch.match(/^feature-(\d+)-([a-z]{2})-(.+)$/);
            const soloMatch = branch.match(/^feature-(\d+)-(.+)$/);

            let featureNum, agentId, entityType = 'feature';
            if (reviewSessionInfo) {
                featureNum = reviewSessionInfo.featureNum;
                agentId = reviewSessionInfo.agentId;
                entityType = reviewSessionInfo.entityType || 'feature';
            } else if (arenaMatch) {
                featureNum = arenaMatch[1].padStart(2, '0');
                agentId = arenaMatch[2];
            } else if (soloMatch) {
                featureNum = soloMatch[1].padStart(2, '0');
                agentId = 'solo';
            } else {
                // Not on a feature branch — check if we're in a research tmux session.
                // Research agents run on main branch, so detect context from TMUX pane title
                // or from the session name in the TMUX env var.
                const tmuxEnv = process.env.TMUX || '';
                let researchDetected = false;
                if (tmuxEnv) {
                    try {
                        const { execSync } = require('child_process');
                        const sessionName = execSync('tmux display-message -p "#S"', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
                        const researchMatch = sessionName.match(/^.+-r(\d+)-([a-z]{2})(?:-|$)/);
                        if (researchMatch) {
                            featureNum = researchMatch[1].padStart(2, '0');
                            agentId = researchMatch[2];
                            entityType = 'research';
                            researchDetected = true;
                        }
                    } catch (e) { /* not in tmux */ }
                }
                if (!researchDetected) {
                    return console.error(`❌ Branch "${branch}" does not match a feature branch pattern (feature-<ID>-...).\n   For research, use: aigon research-submit <ID> <agent>`);
                }
            }

            // Resolve main repo: worktrees write to the main repo's state dir
            let mainRepo = process.cwd();
            const worktreeJsonPath = path.join(process.cwd(), '.aigon', 'worktree.json');
            if (fs.existsSync(worktreeJsonPath)) {
                try {
                    const wj = JSON.parse(fs.readFileSync(worktreeJsonPath, 'utf8'));
                    if (wj.mainRepo) mainRepo = wj.mainRepo;
                } catch (e) { /* use cwd fallback */ }
            }

            // Security scan gate for submitted status (feature-submit)
            if (status === 'submitted') {
                const scanResult = runSecurityScan('featureSubmit');
                if (!scanResult.passed) {
                    console.error(`🔒 agent-status submitted blocked by security scan failure.`);
                    console.error(`   Fix the issues above, then re-run: aigon agent-status submitted`);
                    return;
                }
            }

            if (status === 'reviewing' || status === 'review-complete') {
                const reviewStore = entityType === 'research' ? researchReviewState : featureReviewState;
                try {
                    if (status === 'reviewing') {
                        reviewStore.markReviewingSync(mainRepo, featureNum, agentId, new Date().toISOString());
                    } else {
                        reviewStore.completeReviewSync(mainRepo, featureNum, agentId, new Date().toISOString());
                    }
                    console.log(`✅ Review status updated: ${status} (${entityType} ${featureNum}, ${agentId})`);
                } catch (err) {
                    console.error(`❌ Failed to update review status: ${err.message}`);
                }
                if (entityType === 'feature') {
                    try {
                        writeStats(mainRepo, 'feature', featureNum, {
                            lastActivityAt: new Date().toISOString(),
                        });
                    } catch (_) { /* best-effort */ }
                }
                return;
            }

            // Write status to main repo's .aigon/state/{prefix}-{id}-{agent}.json (legacy)
            const manifestPrefix = entityType === 'research' ? 'research' : 'feature';
            writeAgentStatusAt(mainRepo, featureNum, agentId, {
                status,
                worktreePath: process.cwd(),
                ...(status === 'submitted' ? { flags: {} } : {}),
            }, manifestPrefix);

            // Update lastActivityAt in persistent stats record
            if (entityType === 'feature') {
                try {
                    writeStats(mainRepo, 'feature', featureNum, {
                        lastActivityAt: new Date().toISOString(),
                    });
                } catch (_) { /* best-effort */ }
            }

            // Emit engine signal when workflow-core state exists for this feature.
            // Signals are emitted alongside legacy writes for backward compat.
            if (entityType === 'feature') {
                const snapshotPath = getSnapshotPath(mainRepo, featureNum);
                if (fs.existsSync(snapshotPath)) {
                    const signalMap = {
                        'submitted': 'agent-ready',
                        'error': 'agent-failed',
                        'waiting': 'agent-waiting',
                    };
                    const signal = signalMap[status];
                    // `feature-start` is the control-plane entrypoint that establishes running agents.
                    // `agent-status implementing` is runtime metadata only; re-emitting `agent-started`
                    // here races the workflow lock and causes redundant writes on every feature launch.
                    if (status === 'implementing') {
                        emitHeartbeat(mainRepo, featureNum, agentId)
                            .catch((err) => {
                                console.error(`⚠️  Engine heartbeat failed: ${err.message}`);
                            });
                    } else if (signal) {
                        wf.emitSignal(mainRepo, featureNum, signal, agentId)
                            .catch((err) => {
                                console.error(`⚠️  Engine signal "${signal}" failed: ${err.message}`);
                            });
                    }
                }
            }

            // Find log file name for the confirmation message (best-effort)
            let logLabel = `${entityType}-${featureNum}-${agentId}`;
            try {
                const logsDir = path.join(PATHS.features.root, 'logs');
                if (fs.existsSync(logsDir)) {
                    const logPattern = agentId === 'solo'
                        ? `feature-${featureNum}-`
                        : `feature-${featureNum}-${agentId}-`;
                    const logFiles = fs.readdirSync(logsDir)
                        .filter(f => f.startsWith(logPattern) && f.endsWith('-log.md'));
                    const filtered = agentId === 'solo'
                        ? logFiles.filter(f => !f.match(new RegExp(`^feature-${featureNum}-[a-z]{2}-`)))
                        : logFiles;
                    if (filtered.length > 0) logLabel = filtered[0];
                }
            } catch (e) { /* ignore */ }

            console.log(`✅ Status updated: ${status} (${logLabel})`);
        },

        'check-agent-signal': () => {
            // GG AfterAgent advisory hook: warn (don't block) if agent hasn't signaled.
            const branch = getCurrentBranch();
            if (!branch) return;

            const arenaMatch = branch.match(/^feature-(\d+)-([a-z]{2})-(.+)$/);
            const soloMatch = branch.match(/^feature-(\d+)-(.+)$/);

            let featureNum, agentId;
            if (arenaMatch) {
                featureNum = arenaMatch[1].padStart(2, '0');
                agentId = arenaMatch[2];
            } else if (soloMatch) {
                featureNum = soloMatch[1].padStart(2, '0');
                agentId = 'solo';
            } else {
                return; // Not on a feature branch
            }

            let mainRepo = process.cwd();
            const worktreeJsonPath = path.join(process.cwd(), '.aigon', 'worktree.json');
            if (fs.existsSync(worktreeJsonPath)) {
                try {
                    const wj = JSON.parse(fs.readFileSync(worktreeJsonPath, 'utf8'));
                    if (wj.mainRepo) mainRepo = wj.mainRepo;
                } catch (e) { /* use cwd fallback */ }
            }

            const agentState = readAgentStatus(featureNum, agentId, 'feature', { mainRepoPath: mainRepo });
            if (!agentState || (agentState.status !== 'submitted' && agentState.status !== 'implementing')) {
                console.warn(`⚠️  Advisory: agent ${agentId} has not signaled lifecycle status for feature ${featureNum}. Consider running \`aigon agent-status submitted\`.`);
            }
            // Advisory only — always exit 0
        },

        'check-agent-submitted': () => {
            // CC Stop hook enforcement: check if agent-status submitted was called.
            // Returns non-zero exit code if not submitted, blocking session exit.
            const branch = getCurrentBranch();
            if (!branch) {
                // Not on a branch — can't enforce, allow exit
                return;
            }

            const arenaMatch = branch.match(/^feature-(\d+)-([a-z]{2})-(.+)$/);
            const soloMatch = branch.match(/^feature-(\d+)-(.+)$/);

            let featureNum, agentId;
            if (arenaMatch) {
                featureNum = arenaMatch[1].padStart(2, '0');
                agentId = arenaMatch[2];
            } else if (soloMatch) {
                featureNum = soloMatch[1].padStart(2, '0');
                agentId = 'solo';
            } else {
                // Not on a feature branch — allow exit
                return;
            }

            // Check main repo for agent status
            let mainRepo = process.cwd();
            const worktreeJsonPath = path.join(process.cwd(), '.aigon', 'worktree.json');
            if (fs.existsSync(worktreeJsonPath)) {
                try {
                    const wj = JSON.parse(fs.readFileSync(worktreeJsonPath, 'utf8'));
                    if (wj.mainRepo) mainRepo = wj.mainRepo;
                } catch (e) { /* use cwd fallback */ }
            }

            const agentState = readAgentStatus(featureNum, agentId, 'feature', { mainRepoPath: mainRepo });
            if (agentState && agentState.status === 'submitted') {
                // Already submitted — allow exit
                return;
            }

            // Not submitted — block exit
            console.error(`⚠️  You haven't submitted your work. Run \`aigon agent-status submitted\` first.`);
            process.exitCode = 1;
        },

        'force-agent-ready': (args) => {
            const featureId = args[0];
            const agentId = args[1];
            if (!featureId || !agentId) {
                return console.error('Usage: aigon force-agent-ready <featureId> <agentId>');
            }
            const paddedId = String(parseInt(featureId, 10)).padStart(2, '0');
            const mainRepo = process.cwd();
            const snapshotPath = getSnapshotPath(mainRepo, paddedId);
            if (!fs.existsSync(snapshotPath)) {
                return console.error(`❌ No workflow engine state for feature ${paddedId}. Force-ready requires engine state.`);
            }
            wf.forceAgentReady(mainRepo, paddedId, agentId)
                .then(() => console.log(`✅ Agent ${agentId} forced to ready state for feature ${paddedId}`))
                .catch((err) => console.error(`❌ Force-ready failed: ${err.message}`));
        },

        'drop-agent': (args) => {
            const featureId = args[0];
            const agentId = args[1];
            if (!featureId || !agentId) {
                return console.error('Usage: aigon drop-agent <featureId> <agentId>');
            }
            const paddedId = String(parseInt(featureId, 10)).padStart(2, '0');
            const mainRepo = process.cwd();
            const snapshotPath = getSnapshotPath(mainRepo, paddedId);
            if (!fs.existsSync(snapshotPath)) {
                return console.error(`❌ No workflow engine state for feature ${paddedId}. Drop-agent requires engine state.`);
            }
            wf.dropAgent(mainRepo, paddedId, agentId)
                .then(() => console.log(`✅ Agent ${agentId} dropped from feature ${paddedId}`))
                .catch((err) => console.error(`❌ Drop-agent failed: ${err.message}`));
        },

        'status': (args) => {
            const idArg = args[0] && !args[0].startsWith('--') ? args[0] : null;
            const logsDir = path.join(PATHS.features.root, 'logs');
            const inProgressDir = path.join(PATHS.features.root, '03-in-progress');

            if (!fs.existsSync(logsDir)) {
                return console.error('❌ No logs directory found. Run aigon feature-start first.');
            }

            // Helper: extract feature name from spec filename
            function featureNameFromSpec(filename) {
                // feature-31-log-status-tracking.md -> log-status-tracking
                const m = filename.match(/^feature-\d+-(.+)\.md$/);
                return m ? m[1] : filename;
            }

            let featureIds = [];
            if (idArg) {
                featureIds = [String(parseInt(idArg, 10)).padStart(2, '0')];
            } else {
                // Find all in-progress features
                if (!fs.existsSync(inProgressDir)) {
                    return console.log('No features in progress.');
                }
                featureIds = fs.readdirSync(inProgressDir)
                    .filter(f => f.match(/^feature-\d+-.+\.md$/))
                    .map(f => {
                        const m = f.match(/^feature-(\d+)-/);
                        return m ? m[1].padStart(2, '0') : null;
                    })
                    .filter(Boolean);
            }

            if (featureIds.length === 0) {
                return console.log('No features in progress.');
            }

            let anyOutput = false;
            featureIds.forEach(featureNum => {
                // Get feature name from spec file
                let featureName = featureNum;
                if (fs.existsSync(inProgressDir)) {
                    const specFile = fs.readdirSync(inProgressDir).find(f => f.startsWith(`feature-${featureNum}-`));
                    if (specFile) featureName = featureNameFromSpec(specFile);
                }

                // Find all log files for this feature (excluding selected/alternatives subdirs)
                const allLogs = fs.readdirSync(logsDir)
                    .filter(f => f.startsWith(`feature-${featureNum}-`) && f.endsWith('-log.md'));

                if (allLogs.length === 0) return;

                anyOutput = true;
                console.log(`\n#${featureNum}  ${featureName}`);

                allLogs.forEach(logFile => {
                    // Determine agent label
                    // Arena: feature-31-cc-desc-log.md -> cc
                    // Solo: feature-31-desc-log.md -> solo
                    const arenaM = logFile.match(new RegExp(`^feature-${featureNum}-([a-z]{2})-`));
                    const agent = arenaM ? arenaM[1] : 'solo';

                    let status = 'unknown';
                    let timeStr = '';
                    try {
                        const agentState = readAgentStatus(featureNum, agent);
                        if (agentState) {
                            status = agentState.status || 'unknown';
                            if (agentState.updatedAt) {
                                const d = new Date(agentState.updatedAt);
                                if (!isNaN(d)) {
                                    timeStr = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                                }
                            }
                        }
                    } catch (e) { /* skip */ }

                    const statusPad = status.padEnd(14);
                    const agentPad = agent.padEnd(6);
                    console.log(`  ${agentPad} ${statusPad} ${timeStr}`);
                });
            });

            if (!anyOutput) {
                console.log(idArg ? `No log files found for feature #${idArg}.` : 'No log files found for in-progress features.');
            }
        },

        'deploy': (args) => {
            const isPreview = args.includes('--preview');
            const exitCode = runDeployCommand(isPreview);
            if (exitCode !== 0) process.exitCode = exitCode;
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

        'insights': async (args) => {
            if (!isProAvailable()) {
                console.log('ℹ️  AADE Insights requires Aigon Pro.');
                console.log('   Unlock workflow insights, coaching, and amplification metrics.');
                console.log('   Upgrade at: https://aigon.build/pro');
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

        'capture-session-telemetry': (args) => {
            const transcriptPath = args[0] || null;
            if (!transcriptPath) return;
            try {
                telemetry.captureSessionTelemetry(transcriptPath, {
                    parseFrontMatter,
                    parseYamlScalar,
                    serializeYamlScalar,
                    upsertLogFrontmatterScalars,
                    logsDir: path.join(PATHS.features.root, 'logs'),
                    getCurrentBranch,
                });
            } catch (e) {
                // Silent failure — hook should not block the session
            }
        },

        'security-scan-commit': () => {
            // Scan the last commit for secrets using gitleaks.
            // This remains available as a manual utility command.
            const { isBinaryAvailable } = require('../security');
            const { getEffectiveConfig } = require('../config');

            const config = getEffectiveConfig();
            const security = config.security || {};

            if (security.enabled === false || security.mode === 'off') return;

            const scannerDefs = security.scannerDefs || {};
            const def = scannerDefs.gitleaks || {};
            // Use gitleaks git log mode to scan the last commit
            const command = def.commitCommand || 'gitleaks git --no-banner --log-opts="-1"';
            const binary = command.trim().split(/\s+/)[0];

            if (!binary || !isBinaryAvailable(binary)) return;

            try {
                execSync(command, {
                    encoding: 'utf8',
                    cwd: process.cwd(),
                    stdio: ['pipe', 'pipe', 'pipe'],
                    timeout: 60000,
                });
            } catch (err) {
                const output = (err.stdout || '') + (err.stderr || '');
                console.error('⚠️  Gitleaks found potential secrets in your last commit:');
                if (output.trim()) {
                    const lines = output.trim().split('\n').slice(0, 30);
                    console.error(lines.join('\n'));
                }
                console.error('\nThe commit has already been made. To fix:');
                console.error('  1. Remove the secret from the file');
                console.error('  2. Amend the commit: git commit --amend');
                console.error('  3. If pushed, rotate the exposed credential immediately');
            }
        },

        'rollout': (args) => {
            const { execSync } = require('child_process');
            const version = require('../../package.json').version;
            const dryRun = args.includes('--dry-run');
            const repos = readConductorReposFromGlobalConfig();
            const aigonRoot = process.cwd();

            // Detect which agents are installed per repo
            function detectAgents(repoPath) {
                const agents = [];
                const fs = require('fs');
                const path = require('path');
                if (fs.existsSync(path.join(repoPath, '.claude', 'commands', 'aigon'))) agents.push('cc');
                if (fs.existsSync(path.join(repoPath, '.gemini', 'settings.json'))) agents.push('gg');
                if (fs.existsSync(path.join(repoPath, '.cursor', 'commands'))) agents.push('cu');
                if (fs.existsSync(path.join(repoPath, '.codex'))) agents.push('cx');
                return agents;
            }

            console.log(`\n🚀 Rolling out Aigon v${version} to ${repos.length} repos${dryRun ? ' (dry run)' : ''}\n`);

            let updated = 0;
            let skipped = 0;

            for (const repo of repos) {
                const name = require('path').basename(repo);
                if (repo === aigonRoot || name === 'aigon-site') {
                    console.log(`  ⏭️  ${name} (skipped — aigon repo)`);
                    skipped++;
                    continue;
                }
                if (!require('fs').existsSync(repo)) {
                    console.log(`  ⚠️  ${name} (not found)`);
                    skipped++;
                    continue;
                }

                const agents = detectAgents(repo);
                if (agents.length === 0) {
                    console.log(`  ⏭️  ${name} (no agents installed)`);
                    skipped++;
                    continue;
                }

                if (dryRun) {
                    console.log(`  📋 ${name} — would install for: ${agents.join(', ')}`);
                    continue;
                }

                try {
                    // Install agents
                    const agentArgs = agents.join(' ');
                    execSync(`aigon install-agent ${agentArgs}`, { cwd: repo, stdio: 'pipe' });

                    // Commit
                    execSync('git add docs/ AGENTS.md .claude/ .cursor/ .codex/ .gemini/ .aigon/ 2>/dev/null; git commit --no-verify -m "chore: install Aigon v' + version + '" 2>/dev/null || true', {
                        cwd: repo, stdio: 'pipe', shell: true
                    });

                    console.log(`  ✅ ${name} — updated (${agents.join(', ')})`);
                    updated++;
                } catch (e) {
                    console.error(`  ❌ ${name} — ${e.message.split('\n')[0]}`);
                }
            }

            console.log(`\n${dryRun ? 'Would update' : 'Updated'}: ${updated}  Skipped: ${skipped}\n`);
        },

        'next': () => {
            console.log(`ℹ️  'aigon next' is an agent-only command.\n\nRun it inside your agent session:\n  /aigon:next\n\nOr use the short alias:\n  /an`);
        },

        'workflow-rules': (args) => {
            const asJson = args.includes('--json');
            if (asJson) {
                process.stdout.write(JSON.stringify(workflowRulesReport.buildWorkflowRulesJson(), null, 2) + '\n');
                return;
            }
            process.stdout.write(workflowRulesReport.buildWorkflowRulesReport());
        },

        'help': () => {
            const helpText = readTemplate('help.txt');
            process.stdout.write(helpText);
        },
    };
};

// Backward-compat wrapper
function createMiscCommands(overrides = {}) {
    const utils = require('../utils');
    const git = require('../git');
    const board = require('../board');
    const feedbackLib = require('../feedback');
    const validation = require('../validation');
    const stateMachine = require('../state-queries');

    const ctx = {
        utils: { ...utils, ...overrides },
        git: { ...git, ...overrides },
        board: { ...board, ...overrides },
        feedback: { ...feedbackLib, ...overrides },
        validation: { ...validation, ...overrides },
        stateMachine,
    };
    const allCmds = module.exports(ctx);
    const names = ['agent-status', 'status', 'deploy', 'commits', 'insights', 'capture-session-telemetry', 'security-scan-commit', 'next', 'workflow-rules', 'help', 'rollout'];
    return Object.fromEntries(names.map(n => [n, allCmds[n]]).filter(([, h]) => typeof h === 'function'));
}

module.exports.createMiscCommands = createMiscCommands;
