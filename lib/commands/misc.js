'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const readline = require('readline');
const { writeAgentStatusAt, readAgentStatus } = require('../agent-status');
const { isProAvailable, getPro } = require('../pro');
const { runSecurityScan } = require('../security');
const telemetry = require('../telemetry');
const { getSnapshotPath, getSnapshotPathForEntity } = require('../workflow-core/paths');
const featureReviewState = require('../feature-review-state');
const researchReviewState = require('../research-review-state');
const wf = require('../workflow-core');
const featureSpecResolver = require('../feature-spec-resolver');
const { collectFeatureDeepStatus } = require('../feature-status');
const { safeTmuxSessionExists } = require('../dashboard-status-helpers');
const { emitHeartbeat } = require('../workflow-heartbeat');
const workflowRulesReport = require('../workflow-rules-report');
const { parseTmuxSessionName } = require('../worktree');
const workflowDefinitions = require('../workflow-definitions');

function runGitRead(cwd, args) {
    const result = spawnSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (result.error || result.status !== 0) {
        throw result.error || new Error(`git ${args.join(' ')} exited with code ${result.status}`);
    }
    return (result.stdout || '').trim();
}

function isIgnoredFeatureSubmissionPath(featureNum, relativePath) {
    const normalizedFeatureId = String(parseInt(String(featureNum), 10) || featureNum).padStart(2, '0');
    const normalizedPath = String(relativePath || '').replace(/\\/g, '/');
    if (!normalizedPath) return true;
    if (normalizedPath.startsWith('.aigon/')) return true;
    if (normalizedPath.startsWith('docs/specs/features/logs/')) {
        return normalizedPath.startsWith(`docs/specs/features/logs/feature-${normalizedFeatureId}-`);
    }
    return false;
}

function normalizeId(id) {
    const parsed = parseInt(String(id), 10);
    return {
        padded: String(Number.isNaN(parsed) ? id : parsed).padStart(2, '0'),
        unpadded: Number.isNaN(parsed) ? String(id) : String(parsed),
    };
}

function branchIsMerged(branchName, defaultBranch) {
    try {
        const merged = execSync(`git branch --merged ${defaultBranch}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        return merged.split('\n').some(line => line.replace(/^[*+]\s+/, '').trim() === branchName);
    } catch (_) {
        return false;
    }
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

function promptText(message, defaultValue = '') {
    if (!process.stdin.isTTY) return Promise.resolve(defaultValue);
    const suffix = defaultValue ? ` (${defaultValue})` : '';
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => {
        rl.question(`${message}${suffix}: `, answer => {
            rl.close();
            const trimmed = String(answer || '').trim();
            resolve(trimmed || defaultValue);
        });
    });
}

async function promptForWorkflowDefinition(draft) {
    const next = { ...draft };
    next.label = next.label || await promptText('Label', next.slug);
    next.description = next.description || await promptText('Description', '');

    if (!next.agents || next.agents.length === 0) {
        next.agents = workflowDefinitions.normalizeAgentList(
            await promptText('Implementing agents (comma-separated)', 'cc')
        );
    }

    const isFleet = next.agents.length > 1;
    if (isFleet) {
        next.reviewAgent = null;
        if (!next.evalAgent) {
            const response = await promptText('Eval agent', next.agents[0] || '');
            next.evalAgent = response ? response.toLowerCase() : null;
        }
    } else {
        next.evalAgent = null;
        if (next.reviewAgent === undefined) {
            const response = await promptText('Review agent', '');
            next.reviewAgent = response ? response.toLowerCase() : null;
        }
    }

    if (!next.stopAfter) {
        next.stopAfter = await promptText(
            isFleet
                ? 'Stop after (implement|eval|close)'
                : 'Stop after (implement|review|close)',
            'close'
        );
    }

    return next;
}

function parseWorkflowStageFlags(values = []) {
    return values
        .map(value => String(value || '').trim())
        .filter(Boolean)
        .map(value => {
            const separator = value.indexOf(':');
            const type = separator === -1 ? value : value.slice(0, separator);
            const agents = separator === -1 ? '' : value.slice(separator + 1);
            return {
                type: String(type || '').trim().toLowerCase(),
                agents: workflowDefinitions.normalizeAgentList(agents),
            };
        });
}

function workflowUsage() {
    return [
        'Usage:',
        '  aigon workflow create <slug> [--project|--global] [--label <text>] [--description <text>] [--agents <csv>] [--eval-agent <id>] [--review-agent <id>] [--stop-after <implement|eval|review|close>]',
        '  aigon workflow create <slug> [--project|--global] --version 2 --stage <type[:agents]> [--stage <type[:agents]> ...]',
        '  aigon workflow list',
        '  aigon workflow show <slug>',
        '  aigon workflow delete <slug> [--project|--global]',
        '',
        'Examples:',
        '  aigon workflow create team-fleet --agents cc,gg,cx --eval-agent gg --stop-after eval',
        '  aigon workflow create solo-review --agents cc --review-agent gg',
        '  aigon workflow create reviewed-close --version 2 --stage implement:cc --stage review:gg --stage counter-review:cc --stage close',
        '  aigon workflow list',
        '  aigon workflow show fleet',
        '  aigon workflow delete team-fleet --global',
    ].join('\n');
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

function getFeatureSubmissionEvidence(repoPath, featureNum, defaultBranch) {
    const baseBranch = defaultBranch || 'main';
    try {
        const mergeBase = runGitRead(repoPath, ['merge-base', 'HEAD', baseBranch]);
        const commitsRaw = runGitRead(repoPath, ['log', '--no-merges', '--format=%H%x09%s', `${mergeBase}..HEAD`]);
        const commits = commitsRaw
            ? commitsRaw.split('\n').map(line => {
                const [sha, ...rest] = line.split('\t');
                return { sha: sha || '', subject: rest.join('\t').trim() };
            }).filter(entry => entry.sha)
            : [];
        const substantiveCommits = commits.filter(entry => !/^chore: worktree setup for\b/i.test(entry.subject));

        const changedFilesRaw = runGitRead(repoPath, ['diff', '--name-only', `${mergeBase}..HEAD`]);
        const changedFiles = changedFilesRaw ? changedFilesRaw.split('\n').map(line => line.trim()).filter(Boolean) : [];
        const substantiveFiles = changedFiles.filter(file => !isIgnoredFeatureSubmissionPath(featureNum, file));

        if (substantiveCommits.length === 0) {
            return {
                ok: false,
                reason: 'no substantive commits found beyond worktree setup',
                changedFiles,
                substantiveFiles,
                substantiveCommits,
            };
        }

        if (substantiveFiles.length === 0) {
            return {
                ok: false,
                reason: 'no implementation files changed beyond feature logs/state files',
                changedFiles,
                substantiveFiles,
                substantiveCommits,
            };
        }

        return {
            ok: true,
            reason: null,
            changedFiles,
            substantiveFiles,
            substantiveCommits,
        };
    } catch (error) {
        return {
            ok: false,
            reason: `could not inspect git history (${error.message})`,
            changedFiles: [],
            substantiveFiles: [],
            substantiveCommits: [],
        };
    }
}

module.exports = function miscCommands(ctx) {
    const u = ctx.utils;
    const {
        getCurrentBranch,
        getCommitAnalytics,
        filterCommitAnalytics,
        buildCommitAnalyticsSummary,
        getDefaultBranch,
        getStatus,
        listBranches,
        listWorktrees,
        filterWorktreesByFeature,
    } = ctx.git;

    const {
        PATHS,
        readTemplate,
        runDeployCommand,
        parseFrontMatter,
        parseYamlScalar,
        serializeYamlScalar,
        upsertLogFrontmatterScalars,
        findFile,
        getStateDir,
        safeRemoveWorktree,
        removeWorktreePermissions,
        removeWorktreeTrust,
        gcCaddyRoutes,
        parseCliOptions,
        getOptionValue,
        getOptionValues,
        getAvailableAgents,
        parseConfigScope,
    } = u;

    return {
        'agent-status': (args) => {
            const status = args[0];
            const validStatuses = ['implementing', 'waiting', 'submitted', 'error', 'reviewing', 'review-complete', 'feedback-addressed'];
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
                    if (parsedSession && (parsedSession.type === 'f' || parsedSession.type === 'r') && parsedSession.role === 'review' && parsedSession.agent) {
                        reviewSessionInfo = {
                            featureNum: parsedSession.id.padStart(2, '0'),
                            agentId: parsedSession.agent,
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
            // Priority 1: explicit env vars from shell trap wrapper (always correct)
            if (process.env.AIGON_ENTITY_TYPE && process.env.AIGON_ENTITY_ID && process.env.AIGON_AGENT_ID) {
                entityType = process.env.AIGON_ENTITY_TYPE;
                featureNum = process.env.AIGON_ENTITY_ID.padStart(2, '0');
                agentId = process.env.AIGON_AGENT_ID;
            } else if (reviewSessionInfo) {
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
            } else if (process.env.AIGON_PROJECT_PATH) {
                // Shell trap exports AIGON_PROJECT_PATH; use it when worktree.json is absent
                // (worktrees at ~/.aigon/worktrees/ don't have .aigon/worktree.json)
                mainRepo = process.env.AIGON_PROJECT_PATH;
            }

            // Security scan gate for submitted lifecycle signaling.
            if (status === 'submitted') {
                if (entityType === 'feature') {
                    const evidence = getFeatureSubmissionEvidence(process.cwd(), featureNum, getDefaultBranch ? getDefaultBranch() : 'main');
                    if (!evidence.ok) {
                        console.error(`❌ agent-status submitted blocked: ${evidence.reason}.`);
                        if (evidence.changedFiles.length > 0) {
                            console.error(`   Branch-only files: ${evidence.changedFiles.join(', ')}`);
                        }
                        console.error('   Add and commit real implementation work before submitting.');
                        process.exitCode = 1;
                        return;
                    }
                }
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
                return;
            }

            // Write status to main repo's .aigon/state/{prefix}-{id}-{agent}.json (legacy)
            const manifestPrefix = entityType === 'research' ? 'research' : 'feature';
            writeAgentStatusAt(mainRepo, featureNum, agentId, {
                status,
                worktreePath: process.cwd(),
                ...(status === 'submitted' ? { flags: {} } : {}),
            }, manifestPrefix);

            // Emit engine signal when workflow-core state exists for this entity.
            // Signals are emitted alongside legacy writes for backward compat.
            {
                const snapshotPath = entityType === 'research'
                    ? getSnapshotPathForEntity(mainRepo, 'research', featureNum)
                    : getSnapshotPath(mainRepo, featureNum);
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
                        emitHeartbeat(mainRepo, featureNum, agentId, { entityType })
                            .catch((err) => {
                                console.error(`⚠️  Engine heartbeat failed: ${err.message}`);
                            });
                    } else if (signal) {
                        wf.emitSignal(mainRepo, featureNum, signal, agentId, { entityType })
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

            let featureNum, agentId;
            if (arenaMatch) {
                featureNum = arenaMatch[1].padStart(2, '0');
                agentId = arenaMatch[2];
            } else {
                // Not on an agent worktree branch — allow exit. Plain Drive-mode
                // feature branches (feature-<id>-<slug>) are normal user sessions
                // and must not be blocked by the CC Stop hook.
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
            } else if (process.env.AIGON_PROJECT_PATH) {
                // Shell trap exports AIGON_PROJECT_PATH; use it when worktree.json is absent
                mainRepo = process.env.AIGON_PROJECT_PATH;
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
            // Check both feature and research snapshots
            const featureSnap = getSnapshotPath(mainRepo, paddedId);
            const researchSnap = getSnapshotPathForEntity(mainRepo, 'research', paddedId);
            const entityType = fs.existsSync(researchSnap) ? 'research'
                : fs.existsSync(featureSnap) ? 'feature' : null;
            if (!entityType) {
                return console.error(`❌ No workflow engine state for ${paddedId}. Force-ready requires engine state.`);
            }
            wf.forceEntityAgentReady(mainRepo, entityType, paddedId, agentId)
                .then(() => console.log(`✅ Agent ${agentId} forced to ready state for ${entityType} ${paddedId}`))
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
            const featureSnap = getSnapshotPath(mainRepo, paddedId);
            const researchSnap = getSnapshotPathForEntity(mainRepo, 'research', paddedId);
            const entityType = fs.existsSync(researchSnap) ? 'research'
                : fs.existsSync(featureSnap) ? 'feature' : null;
            if (!entityType) {
                return console.error(`❌ No workflow engine state for ${paddedId}. Drop-agent requires engine state.`);
            }
            wf.dropEntityAgent(mainRepo, entityType, paddedId, agentId)
                .then(() => console.log(`✅ Agent ${agentId} dropped from ${entityType} ${paddedId}`))
                .catch((err) => console.error(`❌ Drop-agent failed: ${err.message}`));
        },

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
            const featureStatus = entityType === 'feature'
                ? collectFeatureDeepStatus(repoPath, padded, { entityType: 'feature', currentCheckoutPath: repoPath })
                : null;

            const visibleSpec = entityType === 'feature'
                ? featureSpecResolver.resolveFeatureSpec(repoPath, padded, { snapshot })
                : (findFile ? findFile(PATHS.research, padded, PATHS.research.folders) : null);
            const visibleStage = entityType === 'feature'
                ? (featureStatus?.spec?.specPath
                    ? (String(featureStatus.spec.specPath).includes('05-done') ? 'done'
                        : String(featureStatus.spec.specPath).includes('04-in-evaluation') ? 'in-evaluation'
                        : String(featureStatus.spec.specPath).includes('03-in-progress') ? 'in-progress'
                        : 'backlog')
                    : visibleSpec?.stage || null)
                : (visibleSpec?.folder
                    ? (visibleSpec.folder === '05-done' ? 'done'
                        : visibleSpec.folder === '04-in-evaluation' ? 'in-evaluation'
                        : visibleSpec.folder === '03-in-progress' ? 'in-progress'
                        : visibleSpec.folder === '06-paused' ? 'paused'
                        : visibleSpec.folder === '02-backlog' ? 'backlog'
                        : visibleSpec.folder === '01-inbox' ? 'inbox'
                        : visibleSpec.folder)
                    : visibleSpec?.stage || null);
            const currentLifecycle = snapshot ? (snapshot.currentSpecState || snapshot.lifecycle || null) : null;
            const doneSpecExists = visibleStage === 'done';

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
            if (doneSpecExists && currentLifecycle && currentLifecycle !== 'done') {
                repairActions.push(`reconcile workflow to done (${currentLifecycle} → done)`);
            }
            if (doneSpecExists && stateFiles.length > 0) repairActions.push(`remove ${stateFiles.length} stale state file(s)`);
            if (doneSpecExists && heartbeatFiles.length > 0) repairActions.push(`remove ${heartbeatFiles.length} stale heartbeat file(s)`);
            if (liveSessions.length > 0) repairActions.push(`close ${liveSessions.length} stale session(s)`);
            if (entityType === 'feature' && worktrees.length > 0 && dirtyWorktrees.length === 0) {
                repairActions.push(`remove ${worktrees.length} stale worktree(s)`);
            }
            if (entityType === 'feature' && branches.length > 0 && unmergedBranches.length === 0) {
                repairActions.push(`delete ${branches.length} stale branch(es)`);
            }

            console.log(`\n🔎 Repair diagnosis for ${entityType} ${padded}`);
            console.log(`   spec: ${visibleStage || 'missing'}`);
            console.log(`   workflow: ${currentLifecycle || 'missing'}`);
            console.log(`   state files: ${stateFiles.length}`);
            console.log(`   heartbeat files: ${heartbeatFiles.length}`);
            console.log(`   sessions: ${liveSessions.length}`);
            console.log(`   branches: ${branches.length}`);
            console.log(`   worktrees: ${worktrees.length}`);
            console.log(`   plan: ${repairActions.length > 0 ? repairActions.join('; ') : 'No repair needed'}`);

            const unsafeBranchState = doneSpecExists && currentLifecycle && currentLifecycle !== 'done'
                && (unmergedBranches.length > 0 || (currentBranchMatchesTarget && !branchIsMerged(currentBranch, defaultBranch)));
            if (dirtyWorktrees.length > 0 || dirtyBranches.length > 0 || unsafeBranchState) {
                console.error(`❌ Repair refused for ${entityType} ${padded}: dirty or unmerged work still exists.`);
                dirtyWorktrees.forEach(wt => console.error(`   - dirty worktree: ${wt.path}`));
                dirtyBranches.forEach(branch => console.error(`   - dirty branch: ${branch}`));
                unmergedBranches.forEach(branch => console.error(`   - unmerged branch: ${branch}`));
                return;
            }

            if (!snapshot && !visibleSpec && stateFiles.length === 0 && heartbeatFiles.length === 0 && liveSessions.length === 0 && branches.length === 0 && worktrees.length === 0) {
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

            if (doneSpecExists && currentLifecycle && currentLifecycle !== 'done') {
                try {
                    await wf.closeEntity(repoPath, entityType, padded);
                    console.log(`   ✅ Reconciled workflow to done`);
                } catch (e) {
                    console.warn(`   ⚠️  Could not reconcile workflow: ${e.message}`);
                }
            }

            if (doneSpecExists) {
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

        'stats': (args) => {
            // Feature 230: terminal summary backed by stats-aggregate cache.
            const statsAggregate = require('../stats-aggregate');
            const wantJson = args.includes('--json');
            const force = args.includes('--rebuild');
            const showAgents = args.includes('--agents');

            // Default to the global conductor repo list, falling back to cwd.
            const { readConductorReposFromGlobalConfig } = require('../dashboard');
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
                process.stdout.write(`   Cache: ${statsAggregate.cachePath(entry.repoPath)}\n`);
            }
            process.stdout.write('\n');
        },

        'help': () => {
            const helpText = readTemplate('help.txt');
            process.stdout.write(helpText);
        },

        'workflow': async (args) => {
            const subcommand = String(args[0] || '').trim().toLowerCase();
            if (!subcommand || subcommand.startsWith('-')) {
                process.exitCode = 1;
                console.error(workflowUsage());
                return;
            }

            const repoPath = process.cwd();
            const availableAgents = getAvailableAgents();

            if (subcommand === 'create') {
                const { scope, remainingArgs } = parseConfigScope(args.slice(1));
                const options = parseCliOptions(remainingArgs);
                const slug = workflowDefinitions.normalizeWorkflowSlug(options._[0]);
                if (!slug) {
                    process.exitCode = 1;
                    console.error('❌ workflow create requires a slug.\n');
                    console.error(workflowUsage());
                    return;
                }

                let draft = {
                    slug,
                    label: getOptionValue(options, 'label'),
                    description: getOptionValue(options, 'description'),
                    version: getOptionValue(options, 'version')
                        ? parseInt(String(getOptionValue(options, 'version')), 10)
                        : undefined,
                    agents: workflowDefinitions.normalizeAgentList([
                        ...getOptionValues(options, 'agents'),
                        ...getOptionValues(options, 'agent'),
                    ]),
                    evalAgent: getOptionValue(options, 'eval-agent') || null,
                    reviewAgent: getOptionValue(options, 'review-agent') || null,
                    stopAfter: getOptionValue(options, 'stop-after') || null,
                };
                const parsedStages = parseWorkflowStageFlags(getOptionValues(options, 'stage'));
                if (parsedStages.length > 0) {
                    draft.stages = parsedStages;
                }

                if (draft.stages && draft.stages.length > 0 && draft.version === undefined) {
                    draft.version = 2;
                }

                const needsInteractive = draft.agents.length === 0 && (!draft.stages || draft.stages.length === 0);

                if (needsInteractive) {
                    if (!process.stdin.isTTY) {
                        process.exitCode = 1;
                        console.error('❌ Missing workflow fields. Re-run interactively or pass flags for agents/stop-after.');
                        return;
                    }
                    draft = await promptForWorkflowDefinition(draft);
                }

                try {
                    const saved = workflowDefinitions.saveWorkflowDefinition(scope, repoPath, draft, { availableAgents });
                    console.log(`✅ Saved ${scope} workflow: ${saved.slug}`);
                    console.log(`   Source: ${saved.source}`);
                    console.log(`   Path: ${workflowDefinitions.getWorkflowDefinitionPath(saved, repoPath)}`);
                    console.log(`   ${workflowDefinitions.formatWorkflowSummary(saved)}`);
                } catch (error) {
                    process.exitCode = 1;
                    console.error(`❌ ${error.message}`);
                }
                return;
            }

            if (subcommand === 'list') {
                const definitions = workflowDefinitions.listAvailableWorkflows(repoPath);
                console.log('Available workflows:');
                definitions.forEach(definition => {
                    const pathText = workflowDefinitions.getWorkflowDefinitionPath(definition, repoPath) || 'built-in';
                    const readOnlyText = definition.readOnly ? 'read-only' : 'editable';
                    console.log(`  ${definition.slug.padEnd(16)} ${definition.source.padEnd(8)} ${readOnlyText.padEnd(9)} ${workflowDefinitions.formatWorkflowSummary(definition)}`);
                    if (definition.description) console.log(`    ${definition.description}`);
                    console.log(`    ${pathText}`);
                });
                return;
            }

            if (subcommand === 'show') {
                const options = parseCliOptions(args.slice(1));
                const slug = options._[0];
                const definition = workflowDefinitions.resolveWorkflowDefinition(repoPath, slug);
                if (!definition) {
                    process.exitCode = 1;
                    console.error(`❌ Unknown workflow: ${slug || '(missing slug)'}`);
                    return;
                }
                console.log(JSON.stringify({
                    slug: definition.slug,
                    label: definition.label,
                    description: definition.description,
                    version: definition.version || null,
                    stages: definition.stages || null,
                    agents: definition.agents,
                    evalAgent: definition.evalAgent || null,
                    reviewAgent: definition.reviewAgent || null,
                    stopAfter: definition.stopAfter,
                    source: definition.source,
                    readOnly: definition.readOnly,
                    path: workflowDefinitions.getWorkflowDefinitionPath(definition, repoPath),
                }, null, 2));
                return;
            }

            if (subcommand === 'delete') {
                const { scope, remainingArgs } = parseConfigScope(args.slice(1));
                const options = parseCliOptions(remainingArgs);
                const slug = options._[0];
                if (!slug) {
                    process.exitCode = 1;
                    console.error('❌ workflow delete requires a slug.');
                    return;
                }

                const explicitScope = args.slice(1).includes('--global') || args.slice(1).includes('--project') ? scope : null;
                try {
                    const removed = workflowDefinitions.deleteWorkflowDefinition(repoPath, slug, explicitScope);
                    console.log(`✅ Deleted ${removed.scope} workflow: ${removed.slug}`);
                    if (workflowDefinitions.BUILTIN_WORKFLOWS[removed.slug]) {
                        console.log(`   Built-in workflow "${removed.slug}" remains available.`);
                    }
                } catch (error) {
                    process.exitCode = 1;
                    console.error(`❌ ${error.message}`);
                }
                return;
            }

            process.exitCode = 1;
            console.error(`❌ Unknown workflow subcommand: ${subcommand}\n`);
            console.error(workflowUsage());
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
    const names = ['agent-status', 'repair', 'status', 'deploy', 'commits', 'insights', 'capture-session-telemetry', 'security-scan-commit', 'check-agent-signal', 'check-agent-submitted', 'next', 'workflow-rules', 'workflow', 'help', 'rollout', 'stats'];
    return Object.fromEntries(names.map(n => [n, allCmds[n]]).filter(([, h]) => typeof h === 'function'));
}

module.exports.createMiscCommands = createMiscCommands;
module.exports.getFeatureSubmissionEvidence = getFeatureSubmissionEvidence;
