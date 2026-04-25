'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const readline = require('readline');
const { writeAgentStatusAt, writeAwaitingInput, readAgentStatus } = require('../agent-status');
const { isProAvailable, getPro } = require('../pro');
const { runSecurityScan } = require('../security');
const telemetry = require('../telemetry');
const { getSnapshotPath, getSnapshotPathForEntity } = require('../workflow-core/paths');
const featureReviewState = require('../feature-review-state');
const researchReviewState = require('../research-review-state');
const wf = require('../workflow-core');
const { reconcileEntitySpec } = require('../spec-reconciliation');
const { safeTmuxSessionExists } = require('../dashboard-status-helpers');
const { emitHeartbeat } = require('../workflow-heartbeat');
const workflowRulesReport = require('../workflow-rules-report');
const { parseTmuxSessionName } = require('../worktree');
const { sendNudge } = require('../nudge');
const { parseFrontMatter, parseYamlScalar, serializeYamlScalar, parseCliOptions, getOptionValue, getOptionValues } = require('../cli-parse');
const { checkScope, printScopeWarnings } = require('../scope-check');

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
    const result = spawnSync('git', ['branch', '--merged', defaultBranch], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (result.status !== 0) return false;
    return result.stdout.split('\n').some(line => line.replace(/^[*+]\s+/, '').trim() === branchName);
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
        nudge: async (args) => {
            const options = parseCliOptions(args);
            const id = options._[0];
            const role = String(getOptionValue(options, 'role') || 'do').trim() || 'do';
            let agentId = null;
            let message = null;
            const positionals = options._.slice(1);
            if (positionals.length >= 2) {
                agentId = positionals[0];
                message = positionals.slice(1).join(' ');
            } else if (positionals.length === 1) {
                message = positionals[0];
            }
            const entityType = getOptionValue(options, 'entity') || null;
            if (!id || !message) {
                console.error('Usage: aigon nudge <ID> [agent] "message" [--role=do|review|spec-review|auto] [--entity=feature|research]');
                process.exitCode = 1;
                return;
            }
            try {
                const repoPath = getMainRepoPath ? getMainRepoPath(process.cwd()) : process.cwd();
                const result = await sendNudge(repoPath, id, message, { agentId, role, entityType });
                console.log(`✅ Nudge delivered to ${result.sessionName}`);
            } catch (error) {
                console.error(`❌ ${error.message}`);
                if (error.paneTail) {
                    console.error('\nPane tail:\n');
                    console.error(error.paneTail);
                }
                process.exitCode = 1;
            }
        },
        'agent-status': async (args) => {
            const status = args[0];
            const validStatuses = ['implementing', 'waiting', 'submitted', 'error', 'reviewing', 'review-complete', 'feedback-addressed', 'awaiting-input'];
            if (!status || !validStatuses.includes(status)) {
                return console.error(`Usage: aigon agent-status <status> [message]\n\nValid statuses: ${validStatuses.join(', ')}\n\nExample: aigon agent-status awaiting-input "Pick which features to create"`);
            }
            const awaitingMessage = status === 'awaiting-input' ? (args.slice(1).join(' ').trim() || null) : undefined;
            if (status === 'awaiting-input' && !awaitingMessage) {
                return console.error('Usage: aigon agent-status awaiting-input "<message>"');
            }

            // Explicit-args override: `aigon agent-status submitted <ID> <agent>`
            // Short-circuits branch + tmux detection so the command works from any shell context
            // (e.g. main branch after a research findings commit). Entity type auto-detected from snapshot.
            const explicitArg1 = args[1];
            const explicitArg2 = args[2];
            const hasExplicitArgs = status === 'submitted'
                && explicitArg1 && !explicitArg1.startsWith('--')
                && explicitArg2 && !explicitArg2.startsWith('--');

            // Detect branch (skipped when explicit args provided)
            const branch = hasExplicitArgs ? null : getCurrentBranch();
            if (!hasExplicitArgs && !branch) {
                return console.error('❌ Could not detect current branch.');
            }

            let reviewSessionInfo = null;
            if (!hasExplicitArgs && (status === 'reviewing' || status === 'review-complete')) {
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
            const arenaMatch = branch ? branch.match(/^feature-(\d+)-([a-z]{2})-(.+)$/) : null;
            const soloMatch = branch ? branch.match(/^feature-(\d+)-(.+)$/) : null;

            let featureNum, agentId, entityType = 'feature';
            let explicitMainRepo = null;
            if (hasExplicitArgs) {
                // Resolve main repo early so snapshot lookups find the right state dir.
                // Prefer cwd if it already holds workflow state; only fall back to
                // AIGON_PROJECT_PATH when we're clearly inside an unconfigured worktree.
                let mainRepoEarly = process.cwd();
                const worktreeJsonEarly = path.join(process.cwd(), '.aigon', 'worktree.json');
                const cwdHasWorkflows = fs.existsSync(path.join(process.cwd(), '.aigon', 'workflows'));
                if (fs.existsSync(worktreeJsonEarly)) {
                    try {
                        const wj = JSON.parse(fs.readFileSync(worktreeJsonEarly, 'utf8'));
                        if (wj.mainRepo) mainRepoEarly = wj.mainRepo;
                    } catch (_) {}
                } else if (!cwdHasWorkflows && process.env.AIGON_PROJECT_PATH) {
                    mainRepoEarly = process.env.AIGON_PROJECT_PATH;
                }
                explicitMainRepo = mainRepoEarly;
                featureNum = String(explicitArg1).padStart(2, '0');
                agentId = explicitArg2;
                const researchSnap = getSnapshotPathForEntity(mainRepoEarly, 'research', featureNum);
                const featureSnap = getSnapshotPath(mainRepoEarly, featureNum);
                const hasResearch = fs.existsSync(researchSnap);
                const hasFeature = fs.existsSync(featureSnap);
                if (hasResearch && hasFeature) {
                    return console.error(`❌ Both feature and research snapshots exist for ID ${featureNum}. Pass an unambiguous ID.`);
                }
                if (!hasResearch && !hasFeature) {
                    return console.error(`❌ No workflow snapshot found for ID ${featureNum}. Start it first (feature-start / research-start).`);
                }
                entityType = hasResearch ? 'research' : 'feature';
                if (entityType === 'research') {
                    const findingsFile = path.join(mainRepoEarly, 'docs/specs/research-topics/logs', `research-${featureNum}-${agentId}-findings.md`);
                    const findingsFileUnpadded = path.join(mainRepoEarly, 'docs/specs/research-topics/logs', `research-${parseInt(featureNum, 10)}-${agentId}-findings.md`);
                    if (!fs.existsSync(findingsFile) && !fs.existsSync(findingsFileUnpadded)) {
                        return console.error(`❌ Findings file not found: research-${featureNum}-${agentId}-findings.md\n   Write findings before submitting.`);
                    }
                }
            }
            // Priority 1: explicit env vars from shell trap wrapper (always correct)
            else if (process.env.AIGON_ENTITY_TYPE && process.env.AIGON_ENTITY_ID && process.env.AIGON_AGENT_ID) {
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
                    return console.error(`❌ Branch "${branch}" does not match a feature branch pattern (feature-<ID>-...).\n   Use explicit form: aigon agent-status submitted <ID> <agent>`);
                }
            }

            // Resolve main repo: worktrees write to the main repo's state dir
            let mainRepo;
            if (explicitMainRepo) {
                mainRepo = explicitMainRepo;
            } else {
                mainRepo = process.cwd();
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
            }

            // awaiting-input is a display-only signal — write the prompt and exit.
            // Does not touch the workflow engine or review state.
            if (status === 'awaiting-input') {
                try {
                    const manifestPrefix = entityType === 'research' ? 'research' : 'feature';
                    writeAwaitingInput(mainRepo, featureNum, agentId, awaitingMessage, manifestPrefix);
                    console.log(`✅ Awaiting input: ${entityType} ${featureNum} ${agentId} — ${awaitingMessage}`);
                } catch (err) {
                    console.error(`❌ Failed to record awaiting-input: ${err.message}`);
                    process.exitCode = 1;
                }
                return;
            }

            // Security / evidence / scope gates for feature submit (branch-context path only).
            // Explicit `aigon agent-status submitted <ID> <agent>` skips these — it is the out-of-band
            // form (e.g. from `main` with no feature-branch commits) per F339 acceptance criteria.
            if (status === 'submitted') {
                const skipFeatureBranchGates = hasExplicitArgs;
                if (entityType === 'feature' && !skipFeatureBranchGates) {
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
                if (entityType === 'feature' && !skipFeatureBranchGates) {
                    const scanResult = runSecurityScan('featureSubmit');
                    if (!scanResult.passed) {
                        console.error(`🔒 agent-status submitted blocked by security scan failure.`);
                        console.error(`   Fix the issues above, then re-run: aigon agent-status submitted`);
                        return;
                    }
                }
                if (entityType === 'feature' && !skipFeatureBranchGates) {
                    const isForce = args.slice(1).includes('--force');
                    const defaultBranch = getDefaultBranch ? getDefaultBranch() : 'main';
                    const scopeResult = checkScope(mainRepo, featureNum, defaultBranch);
                    if (scopeResult.warnings.length > 0) {
                        printScopeWarnings(scopeResult);
                        if (scopeResult.hasErrors) {
                            console.error('\n❌ Scope check blocked: spec files cannot be moved manually.');
                            console.error('   Use aigon CLI commands for spec state transitions.');
                            process.exitCode = 1;
                            return;
                        }
                        if (!isForce) {
                            console.warn('\n   To submit anyway without these warnings: aigon agent-status submitted --force');
                        }
                    }
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

            const manifestPrefix = entityType === 'research' ? 'research' : 'feature';
            const snapshotPath = entityType === 'research'
                ? getSnapshotPathForEntity(mainRepo, 'research', featureNum)
                : getSnapshotPath(mainRepo, featureNum);
            const hasWorkflowState = fs.existsSync(snapshotPath);
            const lastExitCode = process.env.AIGON_EXIT_CODE != null ? Number(process.env.AIGON_EXIT_CODE) : null;
            let lastPaneTail = null;
            if (process.env.AIGON_PANE_TAIL_B64) {
                try {
                    lastPaneTail = Buffer.from(String(process.env.AIGON_PANE_TAIL_B64), 'base64').toString('utf8').slice(-8000);
                } catch (_) {
                    lastPaneTail = null;
                }
            }
            const runtimeAgentId = String(process.env.AIGON_RUNTIME_AGENT_ID || agentId || '').trim().toLowerCase() || agentId;
            const signalMap = {
                'submitted': 'agent-ready',
                'error': 'agent-failed',
                'waiting': 'agent-waiting',
            };
            const signal = signalMap[status];

            if (status === 'submitted') {
                if (!hasWorkflowState) {
                    console.error(`❌ Cannot submit ${entityType} ${featureNum}: workflow state is not initialized.`);
                    console.error(`   Run the appropriate start command again or repair the workflow state before retrying.`);
                    process.exitCode = 1;
                    return;
                }
                try {
                    await wf.emitSignal(mainRepo, featureNum, signal, agentId, { entityType });
                } catch (err) {
                    console.error(`❌ Failed to record submitted state for ${entityType} ${featureNum} (${agentId}): ${err.message}`);
                    process.exitCode = 1;
                    return;
                }
            }

            // Write status to main repo's .aigon/state/{prefix}-{id}-{agent}.json (legacy cache)
            writeAgentStatusAt(mainRepo, featureNum, agentId, {
                status,
                worktreePath: process.cwd(),
                lastExitCode: Number.isFinite(lastExitCode) ? lastExitCode : null,
                lastPaneTail,
                runtimeAgentId,
                ...(status === 'submitted' ? { flags: {} } : {}),
            }, manifestPrefix);

            // Emit non-submit engine signals alongside legacy writes for backward compat.
            if (hasWorkflowState) {
                // `feature-start` is the control-plane entrypoint that establishes running agents.
                // `agent-status implementing` is runtime metadata only; re-emitting `agent-started`
                // here races the workflow lock and causes redundant writes on every feature launch.
                if (status === 'implementing') {
                    emitHeartbeat(mainRepo, featureNum, agentId, { entityType })
                        .catch((err) => {
                            console.error(`⚠️  Engine heartbeat failed: ${err.message}`);
                        });
                } else if (signal && status !== 'submitted') {
                    wf.emitSignal(mainRepo, featureNum, signal, agentId, { entityType })
                        .catch((err) => {
                            console.error(`⚠️  Engine signal "${signal}" failed: ${err.message}`);
                        });
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

        'session-list': () => {
            // Print all live tmux sessions Aigon manages: entity-bound and repo-level.
            // Columns: category | entity | role | agent | session name | tmux ID | status.
            try {
                const { getEnrichedSessions } = require('../worktree');
                const { sessions } = getEnrichedSessions();
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

        'help': () => {
            const helpText = processTemplate(readTemplate('help.txt'));
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
    const names = ['agent-status', 'repair', 'status', 'deploy', 'commits', 'insights', 'capture-session-telemetry', 'security-scan-commit', 'check-agent-signal', 'check-agent-submitted', 'next', 'workflow-rules', 'help', 'rollout', 'stats'];
    return Object.fromEntries(names.map(n => [n, allCmds[n]]).filter(([, h]) => typeof h === 'function'));
}

module.exports.createMiscCommands = createMiscCommands;
module.exports.getFeatureSubmissionEvidence = getFeatureSubmissionEvidence;
