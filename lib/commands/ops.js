'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const readline = require('readline');
const { readAgentStatus } = require('../agent-status');
const { getFeatureSubmissionEvidence } = require('../feature-command-helpers');
const wf = require('../workflow-core');
const { reconcileEntitySpec } = require('../spec-reconciliation');
const { safeTmuxSessionExists } = require('../dashboard-status-helpers');
const workflowRulesReport = require('../workflow-rules-report');
const { createAgentSessionService } = require('../agent-sessions');
const { STAGE_FOLDERS } = require('../workflow-core/paths');
const { parseCliOptions, getOptionValue } = require('../cli-parse');

function normalizeId(id) {
    const parsed = parseInt(String(id), 10);
    return {
        padded: String(Number.isNaN(parsed) ? id : parsed).padStart(2, '0'),
        unpadded: Number.isNaN(parsed) ? String(id) : String(parsed),
    };
}

function branchIsMerged(branchName, defaultBranch) {
    const result = spawnSync('git', ['branch', '--merged', defaultBranch], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (result.status !== 0) return false;
    return result.stdout.split('\n').some(line => line.replace(/^[*+]s+/, '').trim() === branchName);
}

function promptYesNo(message) {
    if (!process.stdin.isTTY) return Promise.resolve(false);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => {
        rl.question(`${message} [y/N] `, answer => {
            rl.close();
            resolve(/^y(es)?$/i.test(String(answer || '').trim()));
        });
    });
}

function repairFilteredStatus(statusText, { entityType, padded }) {
    if (!statusText) return '';
    const statePrefix = entityType === 'research' ? 'research' : 'feature';
    const ignoredPrefixes = [
        `.aigon/state/${statePrefix}-${padded}-`,
        `.aigon/state/heartbeat-${padded}-`,
        `.aigon/workflows/${entityType === 'research' ? 'research' : 'features'}/${padded}/`,
    ];
    return String(statusText)
        .split('\n')
        .filter(line => {
            const normalized = line.replace(/^[ MADRCU?!]+/, '').trim();
            return !ignoredPrefixes.some(prefix => normalized.startsWith(prefix));
        })
        .join('\n')
        .trim();
}

module.exports = function opsCommands(ctx) {
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
                'repair': async (args = []) => {
            const entityType = String(args[0] || '').toLowerCase();
            const rawId = args[1];
            const dryRun = args.includes('--dry-run');

            if (!entityType || !rawId) {
                return console.error(
                    'Usage: aigon repair <feature|research> <ID> [--dry-run]\n\n' +
                    'Reconcile safe drift without resetting or discarding work.'
                );
            }
            if (!['feature', 'research'].includes(entityType)) {
                return console.error(`❌ Unsupported entity type: ${entityType}. Use feature or research.`);
            }

            const repoPath = process.cwd();
            const { padded, unpadded } = normalizeId(rawId);
            const idParts = [...new Set([padded, unpadded])];
            const stateDir = getStateDir();
            const statePrefix = entityType === 'research' ? 'research' : 'feature';
            const currentBranch = getCurrentBranch(repoPath) || '';
            const defaultBranch = getDefaultBranch ? getDefaultBranch() : 'main';
            const currentBranchMatchesTarget = idParts.some(id =>
                currentBranch === `${statePrefix}-${id}` || currentBranch.startsWith(`${statePrefix}-${id}-`)
            );

            const stateFiles = fs.existsSync(stateDir)
                ? fs.readdirSync(stateDir).filter(file =>
                    file.endsWith('.json') && idParts.some(id => file.startsWith(`${statePrefix}-${id}-`))
                )
                : [];
            const heartbeatFiles = fs.existsSync(stateDir)
                ? fs.readdirSync(stateDir).filter(file =>
                    idParts.some(id => file.startsWith(`heartbeat-${id}-`))
                )
                : [];
            const branches = listBranches().filter(branch =>
                idParts.some(id => branch === `${statePrefix}-${id}` || branch.startsWith(`${statePrefix}-${id}-`)
                    ) && branch !== currentBranch
            );
            const worktrees = entityType === 'feature'
                ? filterWorktreesByFeature(listWorktrees(), padded)
                : [];

            const snapshot = entityType === 'feature'
                ? await wf.showFeatureOrNull(repoPath, padded)
                : await wf.showResearchOrNull(repoPath, padded);
            const currentLifecycle = snapshot ? (snapshot.currentSpecState || snapshot.lifecycle || null) : null;
            const specReconciliation = reconcileEntitySpec(repoPath, entityType, padded, { snapshot, dryRun: true });
            const workflowDone = currentLifecycle === 'done';

            const agentIds = new Set();
            if (snapshot?.agents) {
                Object.keys(snapshot.agents).forEach(agentId => agentIds.add(agentId));
            }
            stateFiles.forEach(file => {
                const m = file.match(new RegExp(`^${statePrefix}-\\d+-([a-z0-9_-]+)\\.json$`));
                if (m && m[1]) agentIds.add(m[1]);
            });
            heartbeatFiles.forEach(file => {
                const m = file.match(/^heartbeat-\d+-([a-z0-9_-]+)$/);
                if (m && m[1]) agentIds.add(m[1]);
            });

            const liveSessions = [];
            for (const agentId of agentIds) {
                const session = safeTmuxSessionExists(padded, agentId, { isResearch: entityType === 'research' });
                if (session && session.running) {
                    liveSessions.push({ agentId, sessionName: session.sessionName });
                }
            }

            const currentRepoStatus = repairFilteredStatus(getStatus ? getStatus(repoPath) : '', { entityType, padded });
            const dirtyWorktrees = [];
            for (const wt of worktrees) {
                const worktreeStatus = repairFilteredStatus(getStatus ? getStatus(wt.path) : '', { entityType, padded });
                if (worktreeStatus) {
                    dirtyWorktrees.push(wt);
                }
            }
            if (currentRepoStatus && !dirtyWorktrees.some(wt => wt.path === repoPath)) {
                dirtyWorktrees.push({ path: repoPath });
            }

            const dirtyBranches = [];
            const unmergedBranches = [];
            for (const branch of branches) {
                const merged = branchIsMerged(branch, defaultBranch);
                if (!merged) {
                    unmergedBranches.push(branch);
                }
            }
            if (currentBranchMatchesTarget && currentRepoStatus) {
                dirtyBranches.push(currentBranch);
            }

            const repairActions = [];
            if (specReconciliation.driftDetected) {
                repairActions.push(`reconcile spec location (${specReconciliation.currentPath} → ${specReconciliation.expectedPath})`);
            }
            if (workflowDone && stateFiles.length > 0) repairActions.push(`remove ${stateFiles.length} stale state file(s)`);
            if (workflowDone && heartbeatFiles.length > 0) repairActions.push(`remove ${heartbeatFiles.length} stale heartbeat file(s)`);
            if (liveSessions.length > 0) repairActions.push(`close ${liveSessions.length} stale session(s)`);
            if (entityType === 'feature' && worktrees.length > 0 && dirtyWorktrees.length === 0) {
                repairActions.push(`remove ${worktrees.length} stale worktree(s)`);
            }
            if (entityType === 'feature' && branches.length > 0 && unmergedBranches.length === 0) {
                repairActions.push(`delete ${branches.length} stale branch(es)`);
            }

            console.log(`\n🔎 Repair diagnosis for ${entityType} ${padded}`);
            console.log(`   spec: ${specReconciliation.currentPath || 'missing'}`);
            console.log(`   workflow: ${currentLifecycle || 'missing'}`);
            console.log(`   state files: ${stateFiles.length}`);
            console.log(`   heartbeat files: ${heartbeatFiles.length}`);
            console.log(`   sessions: ${liveSessions.length}`);
            console.log(`   branches: ${branches.length}`);
            console.log(`   worktrees: ${worktrees.length}`);
            console.log(`   plan: ${repairActions.length > 0 ? repairActions.join('; ') : 'No repair needed'}`);

            if (dirtyWorktrees.length > 0 || dirtyBranches.length > 0) {
                console.error(`❌ Repair refused for ${entityType} ${padded}: dirty or unmerged work still exists.`);
                dirtyWorktrees.forEach(wt => console.error(`   - dirty worktree: ${wt.path}`));
                dirtyBranches.forEach(branch => console.error(`   - dirty branch: ${branch}`));
                unmergedBranches.forEach(branch => console.error(`   - unmerged branch: ${branch}`));
                return;
            }

            if (!snapshot && !specReconciliation.currentPath && stateFiles.length === 0 && heartbeatFiles.length === 0 && liveSessions.length === 0 && branches.length === 0 && worktrees.length === 0) {
                return console.error(`❌ Could not find ${entityType} ${padded}.`);
            }

            if (dryRun) {
                return;
            }

            if (!repairActions.length) {
                console.log(`\n✅ No repair needed.`);
                return;
            }

            const destructiveCleanupPlanned = entityType === 'feature'
                && ((worktrees.length > 0 && repairActions.some(action => action.includes('worktree'))) || (branches.length > 0 && repairActions.some(action => action.includes('branch'))));
            if (destructiveCleanupPlanned) {
                const proceed = await promptYesNo(`Destructive cleanup is planned for ${entityType} ${padded}. Continue`);
                if (!proceed) {
                    console.log(`\n🛑 Repair cancelled.`);
                    return;
                }
            }

            if (liveSessions.length > 0) {
                try {
                    liveSessions.forEach(({ sessionName }) => {
                        execSync(`tmux kill-session -t ${sessionName}`, { stdio: 'pipe' });
                        console.log(`   🗑️  Closed session: ${sessionName}`);
                    });
                } catch (e) {
                    console.warn(`   ⚠️  session cleanup failed: ${e.message}`);
                }
            }

            if (specReconciliation.driftDetected) {
                reconcileEntitySpec(repoPath, entityType, padded, { snapshot });
            }

            if (workflowDone) {
                for (const file of [...stateFiles, ...heartbeatFiles]) {
                    try {
                        fs.unlinkSync(path.join(stateDir, file));
                        console.log(`   🗑️  Removed ${file}`);
                    } catch (_) { /* ignore */ }
                }
            }

            if (entityType === 'feature' && worktrees.length > 0) {
                const removedWorktreePaths = [];
                worktrees.forEach(wt => {
                    if (safeRemoveWorktree && safeRemoveWorktree(wt.path)) {
                        removedWorktreePaths.push(wt.path);
                        console.log(`   🗑️  Removed worktree: ${wt.path}`);
                    }
                });
                if (removedWorktreePaths.length > 0) {
                    if (removeWorktreePermissions) removeWorktreePermissions(removedWorktreePaths);
                    if (removeWorktreeTrust) removeWorktreeTrust(removedWorktreePaths);
                }
                try {
                    if (gcCaddyRoutes) gcCaddyRoutes();
                } catch (_) { /* non-fatal */ }
            }
            if (entityType === 'feature' && branches.length > 0 && unmergedBranches.length === 0) {
                branches.forEach(branch => {
                    try {
                        execSync(`git branch -D ${branch}`, { stdio: 'pipe' });
                        console.log(`   🗑️  Deleted branch: ${branch}`);
                    } catch (_) { /* ignore */ }
                });
            }

            console.log(`\n✅ Repair complete for ${entityType} ${padded}.`);
        },

                'status': (args) => {
            const idArg = args[0] && !args[0].startsWith('--') ? args[0] : null;
            const logsDir = path.join(PATHS.features.root, 'logs');
            const inProgressDir = path.join(PATHS.features.root, STAGE_FOLDERS.IN_PROGRESS);

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

                'session-list': () => {
            // Print all live tmux sessions Aigon manages: entity-bound and repo-level.
            // Columns: category | entity | role | agent | session name | tmux ID | status.
            try {
                // F554: route session listing through the AgentSessionService so the
                // CLI no longer reaches into worktree's tmux internals directly.
                const { createAgentSessionService } = require('../agent-sessions');
                const { sessions } = createAgentSessionService().listLiveSessions();
                if (!sessions.length) {
                    console.log('No active tmux sessions.');
                    return;
                }
                const rows = sessions.map(s => {
                    const entity = s.entityType && s.entityId
                        ? `${s.entityType}${s.entityId}`
                        : (s.category === 'repo' && s.repoPath ? `repo:${path.basename(s.repoPath)}` : '-');
                    const status = s.orphan ? `orphan(${s.orphan.reason || 'unknown'})` : (s.attached ? 'attached' : 'detached');
                    return {
                        category: s.category || 'entity',
                        entity,
                        role: s.role || '-',
                        agent: s.agent || '-',
                        name: s.name,
                        tmuxId: s.tmuxId || '-',
                        status,
                    };
                });
                const headers = ['CATEGORY', 'ENTITY', 'ROLE', 'AGENT', 'SESSION', 'TMUX', 'STATUS'];
                const widths = headers.map((h, i) => {
                    const key = ['category', 'entity', 'role', 'agent', 'name', 'tmuxId', 'status'][i];
                    return Math.max(h.length, ...rows.map(r => String(r[key]).length));
                });
                const formatRow = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join('  ');
                console.log(formatRow(headers));
                console.log(formatRow(widths.map(w => '-'.repeat(w))));
                rows.forEach(r => {
                    console.log(formatRow([r.category, r.entity, r.role, r.agent, r.name, r.tmuxId, r.status]));
                });
            } catch (e) {
                console.error(`❌ ${e.message}`);
                process.exitCode = 1;
            }
        },

                'deploy': (args) => {
            const isPreview = args.includes('--preview');
            const exitCode = runDeployCommand(isPreview);
            if (exitCode !== 0) process.exitCode = exitCode;
        },

                'rollout': (args) => {
            const { execSync } = require('child_process');
            const { readConductorReposFromGlobalConfig } = require('../config');
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
                    execSync('git add docs/ AGENTS.md .claude/ .cursor/ .codex/ .aigon/ 2>/dev/null; git commit --no-verify -m "chore: install Aigon v' + version + '" 2>/dev/null || true', {
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

                'help': () => {
            const helpText = processTemplate(readTemplate('help.txt'));
            process.stdout.write(helpText);
        },

                'workflow-rules': (args) => {
            const asJson = args.includes('--json');
            if (asJson) {
                process.stdout.write(JSON.stringify(workflowRulesReport.buildWorkflowRulesJson(), null, 2) + '\n');
                return;
            }
            process.stdout.write(workflowRulesReport.buildWorkflowRulesReport());
        },

                'agent-probe': async (args = []) => {
            if (args.includes('--include-bench')) {
                console.error('Error: agent-probe --include-bench was removed from OSS Aigon.');
                console.error('Benchmark results are Pro/maintainer-owned. Use agent-probe --quota for user diagnostics.');
                process.exitCode = 1;
                return;
            }
            if (args.includes('--quota')) {
                const quotaProbe = require('../quota-probe');
                const agentRegistry = require('../agent-registry');
                const allAgentsFlag = args.includes('--all-agents');
                const allModelsFlag = args.includes('--all') || args.includes('--all-models');
                const debug = args.includes('--debug');
                const modelIdx = args.indexOf('--model');
                const explicitModel = modelIdx >= 0 ? args[modelIdx + 1] : null;
                const positionals = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--model');
                const target = positionals.find(a => a !== 'true');
                const slash = target && target.includes('/') ? target.split('/') : null;
                const targetAgent = slash ? slash[0] : target;
                const targetModel = slash ? slash.slice(1).join('/') : explicitModel;
                const agentIds = allAgentsFlag
                    ? agentRegistry.getLaunchableAgentIds()
                    : targetAgent
                    ? [targetAgent]
                    : agentRegistry.getLaunchableAgentIds().filter(id => ['cc', 'op', 'cx'].includes(id));

                const rows = [];
                let fullyDepleted = false;
                const providerQuotaPoller = require('../provider-quota-poller');
                const polledProviders = new Set();
                for (const agentId of agentIds) {
                    const deactivatedMsg = agentRegistry.formatDeactivatedAgentMessage(agentId);
                    if (deactivatedMsg) {
                        console.error(`❌ ${deactivatedMsg}`);
                        process.exitCode = 1;
                        return;
                    }
                    let targets;
                    try {
                        targets = quotaProbe.listTargets(agentId, { allModels: allModelsFlag, explicitModel: targetModel });
                    } catch (err) {
                        console.error(`❌ ${err.message}`);
                        process.exitCode = 1;
                        return;
                    }
                    const agentRows = [];
                    for (const targetInfo of targets) {
                        const label = targetInfo.label || targetInfo.value || '(agent default)';
                        process.stdout.write(`  ${agentId.padEnd(4)}  ${label.slice(0, 38).padEnd(38)}  `);
                        const probed = quotaProbe.probePair({
                            repoPath: process.cwd(),
                            agentId,
                            modelValue: targetInfo.value,
                            modelLabel: label,
                            force: true,
                        });
                        const entry = probed.entry;
                        const reset = quotaProbe.formatReset(entry);
                        console.log(`${entry.verdict.padEnd(9)}  reset=${reset}  probed=${entry.lastProbedAt}`);
                        if (debug) {
                            console.log(`      pattern: ${entry.matchedPatternId || 'no match — please file a quota-pattern PR'}`);
                            console.log(`      raw: ${entry.lastProbeOutput || '(empty)'}`);
                        }
                        rows.push({ agentId, model: targetInfo.value, entry });
                        agentRows.push(entry);
                    }
                    if (agentRows.length > 0 && !agentRows.some(e => e.verdict === 'available' || e.verdict === 'unknown')) {
                        fullyDepleted = true;
                    }
                    const agentConfig = agentRegistry.getAgent(agentId);
                    const providerIds = agentConfig && Array.isArray(agentConfig.quotaProviders) ? agentConfig.quotaProviders : [];
                    for (const providerId of providerIds) {
                        if (polledProviders.has(providerId)) continue;
                        polledProviders.add(providerId);
                        process.stdout.write(`  ${providerId.padEnd(4)}  ${'(provider wallet)'.padEnd(38)}  `);
                        const polled = await providerQuotaPoller.pollProvider(providerId, { repoPath: process.cwd(), force: true });
                        const entry = polled.entry;
                        const balance = entry.balanceUsd != null ? `$${entry.balanceUsd.toFixed(2)}` : 'unknown';
                        console.log(`${entry.verdict.padEnd(9)}  balance=${balance}  polled=${entry.lastPolledAt}`);
                        rows.push({ providerId, entry });
                        if (entry.verdict === 'depleted') fullyDepleted = true;
                    }
                }
                const counts = rows.reduce((acc, row) => {
                    acc[row.entry.verdict] = (acc[row.entry.verdict] || 0) + 1;
                    return acc;
                }, {});
                console.log(`\nquota: ${counts.available || 0} available  ${counts.depleted || 0} depleted  ${counts.unknown || 0} unknown  ${counts.error || 0} error`);
                if (fullyDepleted) process.exitCode = 1;
                return;
            }
            const probeScript = path.join(__dirname, '..', '..', 'scripts', 'probe-agent.js');
            const result = require('child_process').spawnSync(
                process.execPath, [probeScript, ...args],
                { stdio: 'inherit', env: process.env }
            );
            if (result.error) { console.error(`❌ ${result.error.message}`); process.exitCode = 1; }
            else if (result.status !== 0) process.exitCode = result.status;
        },

                'agent-quota': async (args = []) => {
            const sub = args[0];
            if (sub === 'refresh') {
                const force = args.includes('--force');
                const agentQuotaPoller = require('../agent-quota-poller');
                try {
                    await agentQuotaPoller.triggerRefresh({ repoPath: process.cwd(), force });
                    console.log('✅ Agent quota refresh complete');
                } catch (e) {
                    if (e && e.code === 'REFRESH_IN_FLIGHT') {
                        console.error('❌ Agent quota refresh already in flight');
                    } else if (e && e.code === 'RATE_LIMITED') {
                        console.error('❌ Agent quota refresh rate limited — use --force to override');
                    } else {
                        console.error(`❌ ${e && e.message ? e.message : 'refresh failed'}`);
                    }
                    process.exitCode = 1;
                }
                return;
            }
            console.error('Usage: aigon agent-quota refresh [--force]');
            process.exitCode = 1;
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
        }
    };
};
