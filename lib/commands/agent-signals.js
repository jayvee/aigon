'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const readline = require('readline');
const { readAgentStatus } = require('../agent-status');
const { getFeatureSubmissionEvidence } = require('../feature-command-helpers');
const { runSecurityScan } = require('../security');
const telemetry = require('../telemetry');
const { getSnapshotPath, getSnapshotPathForEntity, STAGE_FOLDERS } = require('../workflow-core/paths');
const wf = require('../workflow-core');
const { parseTmuxSessionName } = require('../agent-sessions/names');
const { createAgentSessionService } = require('../agent-sessions');
const { sendNudge } = require('../nudge');
const { emitHeartbeat } = require('../workflow-heartbeat');
const { parseFrontMatter, parseYamlScalar, serializeYamlScalar, parseCliOptions, getOptionValue } = require('../cli-parse');
const { checkScope, printScopeWarnings } = require('../scope-check');
const { detectActiveAgentSession, ROOT_DIR, getActiveProfile } = require('../config');

module.exports = function agentSignalsCommands(ctx) {
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
            let status = args[0];
            const validStatuses = [
                // Start-of-session signals
                'implementing', 'reviewing', 'addressing-code-review', 'addressing-spec-review', 'spec-reviewing',
                // Completion signals (new canonical names)
                'implementation-complete', 'revision-complete', 'review-complete',
                'spec-review-complete', 'research-complete',
                // Deprecated aliases (still accepted; warn + remap)
                'feedback-addressed',
                // Other lifecycle statuses
                'waiting', 'error', 'awaiting-input',
            ];
            // F501: `submitted` is no longer a valid status. The deprecation shipped in F339;
            // any agent that still calls it has a stale install — install-drift is Spec B.
            if (status === 'submitted') {
                console.error(`❌ 'aigon agent-status submitted' is no longer supported. Use 'implementation-complete' (initial) or 'revision-complete' (after review fixes).`);
                process.exitCode = 1;
                return;
            }
            if (!status || !validStatuses.includes(status)) {
                return console.error(`Usage: aigon agent-status <status> [message]\n\nValid statuses: ${validStatuses.join(', ')}\n\nExample: aigon agent-status awaiting-input "Pick which features to create"`);
            }

            // Deprecation warning + alias resolution for legacy completion signals.
            const FEEDBACK_ADDRESSED_ALIAS = 'feedback-addressed';
            const isDeprecatedSubmitted = false; // F501: hard-errored above
            const isDeprecatedFeedbackAddressed = status === FEEDBACK_ADDRESSED_ALIAS;
            if (isDeprecatedFeedbackAddressed) {
                console.warn(`⚠️  'aigon agent-status feedback-addressed' is deprecated. Use 'revision-complete' to end a revision pass (single signal replaces feedback-addressed + submitted).`);
                // No-op alias: exit 0 without advancing state. The agent must call
                // revision-complete to actually end the revision pass.
                return;
            }

            const awaitingMessage = status === 'awaiting-input' ? (args.slice(1).join(' ').trim() || null) : undefined;
            if (status === 'awaiting-input' && !awaitingMessage) {
                return console.error('Usage: aigon agent-status awaiting-input "<message>"');
            }

            // Explicit-args override: `aigon agent-status <signal> <ID> <agent>`
            // Short-circuits branch + tmux detection so the command works from any shell context
            // (e.g. main branch after a research findings commit). Entity type auto-detected from snapshot.
            const explicitArg1 = args[1];
            const explicitArg2 = args[2];
            const completionSignals = new Set(['implementation-complete', 'revision-complete', 'research-complete', 'spec-review-complete']);
            const hasExplicitArgs = completionSignals.has(status)
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
                    // Both exist — disambiguate by lifecycle. Prefer the active (non-done) one.
                    let featureLifecycle, researchLifecycle;
                    try { featureLifecycle = JSON.parse(fs.readFileSync(featureSnap, 'utf8')).lifecycle; } catch (_) {}
                    try { researchLifecycle = JSON.parse(fs.readFileSync(researchSnap, 'utf8')).lifecycle; } catch (_) {}
                    if (featureLifecycle === 'done' && researchLifecycle !== 'done') {
                        entityType = 'research';
                    } else if (researchLifecycle === 'done' && featureLifecycle !== 'done') {
                        entityType = 'feature';
                    } else {
                        return console.error(`❌ Both feature and research snapshots exist for ID ${featureNum}. Pass an unambiguous ID.`);
                    }
                } else if (!hasResearch && !hasFeature) {
                    return console.error(`❌ No workflow snapshot found for ID ${featureNum}. Start it first (feature-start / research-start).`);
                } else {
                    entityType = hasResearch ? 'research' : 'feature';
                }
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
                // Not on a feature branch — look up the session sidecar for entity binding.
                // Session name regex is not used; sidecars are written at session launch time.
                const tmuxEnv = process.env.TMUX || '';
                let sidecarDetected = false;
                if (tmuxEnv) {
                    try {
                        const { execSync } = require('child_process');
                        const sessionName = execSync('tmux display-message -p "#S"', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
                        const sessionsDir = path.join(process.cwd(), '.aigon', 'sessions');
                        const sidecarPath = path.join(sessionsDir, `${sessionName}.json`);
                        if (fs.existsSync(sidecarPath)) {
                            const sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
                            if (sidecar.entityId && sidecar.agent && sidecar.entityType) {
                                featureNum = String(sidecar.entityId).padStart(2, '0');
                                agentId = sidecar.agent;
                                entityType = sidecar.entityType === 'r' ? 'research' : 'feature';
                                sidecarDetected = true;
                            }
                        }
                    } catch (e) { /* not in tmux or sidecar unreadable */ }
                }
                if (!sidecarDetected) {
                    return console.error(`❌ Branch "${branch}" does not match a feature branch pattern (feature-<ID>-...).\n   Use explicit form: aigon agent-status <implementation-complete|revision-complete|research-complete> <ID> <agent>`);
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

            const manifestPrefix = entityType === 'research' ? 'research' : 'feature';
            const existingAgentState = readAgentStatus(featureNum, agentId, manifestPrefix, { mainRepoPath: mainRepo });
            const recordedTaskType = existingAgentState && typeof existingAgentState.taskType === 'string'
                ? existingAgentState.taskType
                : null;

            // Mismatch detection: confirm the completion signal matches the recorded
            // taskType (set at session start by the shell trap or by feature-code-revise).
            // Absent taskType → legacy in-flight session, accept without checking.
            if (!hasExplicitArgs && (status === 'implementation-complete' || status === 'revision-complete' || status === 'spec-review-complete' || status === 'research-complete')) {
                const expectedByStatus = {
                    'implementation-complete': new Set(['do']),
                    'revision-complete': new Set(['revise']),
                    'spec-review-complete': new Set(['spec-review', 'spec-revise', 'spec-check']),
                    'research-complete': new Set(['do']),
                };

                if (recordedTaskType && expectedByStatus[status] && !expectedByStatus[status].has(recordedTaskType)) {
                    const expectedList = [...expectedByStatus[status]];
                    const expectedSignal = expectedList[0] === 'do'
                        ? (entityType === 'research' ? 'research-complete' : 'implementation-complete')
                        : expectedList[0] === 'revise'
                            ? 'revision-complete'
                            : 'spec-review-complete';
                    console.error(`❌ Signal '${status}' is not valid for a '${recordedTaskType}' session. Expected: '${expectedSignal}'.`);
                    process.exitCode = 1;
                    return;
                }
            }

            // Security / evidence / scope gates for feature submit (branch-context path only).
            // Explicit `aigon agent-status <completion> <ID> <agent>` skips these — it is the out-of-band
            // form (e.g. from `main` with no feature-branch commits) per F339 acceptance criteria.
            const isFeatureSubmit = (status === 'implementation-complete' || status === 'revision-complete') && entityType === 'feature';
            if (isFeatureSubmit) {
                const skipFeatureBranchGates = hasExplicitArgs;
                if (entityType === 'feature' && !skipFeatureBranchGates) {
                    const evidence = getFeatureSubmissionEvidence(process.cwd(), featureNum, getDefaultBranch ? getDefaultBranch() : 'main');
                    if (!evidence.ok) {
                        console.error(`❌ agent-status ${status} blocked: ${evidence.reason}.`);
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
                        console.error(`🔒 agent-status ${status} blocked by security scan failure.`);
                        console.error(`   Fix the issues above, then re-run: aigon agent-status ${status}`);
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
                            console.warn(`\n   To submit anyway without these warnings: aigon agent-status ${status} --force`);
                        }
                    }
                }
                if (entityType === 'feature' && !skipFeatureBranchGates) {
                    try {
                        const featureSpecResolver = require('../feature-spec-resolver');
                        const { validatePreauthorisations, formatPreauthWarning } = require('../spec-preauth');
                        const resolved = featureSpecResolver.resolveFeatureSpec(mainRepo, featureNum);
                        if (resolved && resolved.path) {
                            const defaultBranch = getDefaultBranch ? getDefaultBranch() : 'main';
                            const preauth = validatePreauthorisations(
                                resolved.path,
                                process.cwd(),
                                defaultBranch,
                                'HEAD',
                            );
                            if (!preauth.ok && preauth.unmatched.length > 0) {
                                console.warn(`\n⚠️  ${formatPreauthWarning(preauth.unmatched)}`);
                                console.warn('   This may block feature-close until resolved.');
                            }
                        }
                    } catch (_) { /* advisory only */ }
                    try {
                        const featureSpecResolver = require('../feature-spec-resolver');
                        const {
                            validateCriteriaAttestation,
                            formatCriteriaAttestationWarning,
                        } = require('../criteria-attestation');
                        const resolved = featureSpecResolver.resolveFeatureSpec(mainRepo, featureNum);
                        if (resolved && resolved.path) {
                            const attestation = validateCriteriaAttestation(
                                resolved.path,
                                mainRepo,
                                featureNum,
                                { cwd: process.cwd() },
                            );
                            if (!attestation.skipped && attestation.unattested.length > 0) {
                                console.warn(`\n⚠️  ${formatCriteriaAttestationWarning(attestation.unattested)}`);
                                console.warn('   Add ## Criteria Attestation lines to the implementation log if you want a per-criterion audit trail (optional — does not block close).');
                            }
                        }
                    } catch (_) { /* advisory only */ }
                }
            }

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

            // Start-of-session lifecycle signals — record the taskType so subsequent
            // completion signals can validate that the right one is being called.
            const startTaskType = process.env.AIGON_TASK_TYPE
                || (status === 'implementing' ? 'do'
                    : status === 'reviewing' ? 'review'
                    : status === 'addressing-code-review' ? 'revise'
                    : status === 'addressing-spec-review' ? 'spec-revise'
                    : status === 'spec-reviewing' ? 'spec-review'
                    : null);
            const isStartSignal = status === 'implementing' || status === 'reviewing' || status === 'addressing-code-review' || status === 'addressing-spec-review' || status === 'spec-reviewing';

            const signalPayload = {
                worktreePath: process.cwd(),
                lastExitCode: Number.isFinite(lastExitCode) ? lastExitCode : null,
                lastPaneTail,
                runtimeAgentId,
                taskType: isStartSignal ? startTaskType : (recordedTaskType || process.env.AIGON_TASK_TYPE),
                message: awaitingMessage,
            };

            if (status === 'review-complete') {
                // F501: review-complete now requires an explicit verdict flag.
                // No default — silently routing every clean review through a
                // revision cycle was the original phantom-state bug.
                const flags = args.slice(1).filter(a => typeof a === 'string' && a.startsWith('--'));
                const hasApprove = flags.includes('--approve');
                const hasRequestRevision = flags.includes('--request-revision');
                if (hasApprove && hasRequestRevision) {
                    console.error(`❌ Pass exactly one of --approve or --request-revision.`);
                    process.exitCode = 1;
                    return;
                }
                if (!hasApprove && !hasRequestRevision) {
                    console.error(`❌ aigon agent-status review-complete requires a verdict.\n   Use --approve for a clean review, --request-revision when fixes are needed.`);
                    process.exitCode = 1;
                    return;
                }
                signalPayload.verdict = hasApprove ? 'approve' : 'request-revision';
                signalPayload.requestRevision = hasRequestRevision;
            }

            try {
                const service = createAgentSessionService({ repoPath: mainRepo, host: null });
                await service.recordSessionSignal({
                    entityType,
                    entityId: featureNum,
                    agentId,
                    role: signalPayload.taskType || startTaskType,
                    status,
                    source: status === 'review-complete' && signalPayload.verdict === 'approve'
                        ? 'agent-status/review-complete --approve'
                        : status === 'review-complete'
                            ? 'agent-status/review-complete --request-revision'
                            : `agent-status/${status}`,
                    payload: signalPayload,
                });
            } catch (err) {
                if (status === 'awaiting-input') {
                    console.error(`❌ Failed to record awaiting-input: ${err.message}`);
                } else {
                    console.error(`❌ Failed to record '${status}' for ${entityType} ${featureNum} (${agentId}): ${err.message}`);
                }
                process.exitCode = 1;
                return;
            }

            if (hasWorkflowState && status === 'implementing') {
                // Auto-start dev server for all agents equally — driven by config, not agent instructions.
                if (entityType === 'feature') {
                    try {
                        const profile = getActiveProfile(mainRepo);
                        if (profile.devServer && profile.devServer.enabled) {
                            const aigonCli = path.join(ROOT_DIR, 'aigon-cli.js');
                            const child = require('child_process').spawn(process.execPath, [aigonCli, 'dev-server', 'start'], {
                                cwd: process.cwd(),
                                detached: true,
                                stdio: 'ignore',
                            });
                            child.unref();
                        }
                    } catch (_) { /* non-fatal */ }
                }
                emitHeartbeat(mainRepo, featureNum, agentId, { entityType })
                    .catch((err) => {
                        console.error(`⚠️  Engine heartbeat failed: ${err.message}`);
                    });
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

                'check-agent-signal': (args = []) => {
            // GG AfterAgent advisory hook: warn (don't block) if agent hasn't signaled.
            const jsonOutput = args.includes('--json');
            const branch = getCurrentBranch();
            if (!branch) {
                if (jsonOutput) process.stdout.write('{}');
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
                if (jsonOutput) process.stdout.write('{}');
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
            // F501 backward compat: old agent status files may still hold 'submitted'.
            const SIGNALED = new Set(['submitted', 'implementing', 'implementation-complete', 'addressing-code-review', 'revision-complete']);
            if (!agentState || !SIGNALED.has(agentState.status)) {
                if (jsonOutput) {
                    process.stdout.write(JSON.stringify({ systemMessage: `⚠️  Advisory: agent ${agentId} has not signaled lifecycle status for feature ${featureNum}. Consider running \`aigon agent-status implementation-complete\`.` }));
                } else {
                    console.warn(`⚠️  Advisory: agent ${agentId} has not signaled lifecycle status for feature ${featureNum}. Consider running \`aigon agent-status implementation-complete\`.`);
                }
            } else if (jsonOutput) {
                process.stdout.write('{}');
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
            // F501 backward compat: old agent status files may still hold 'submitted'.
            const COMPLETED = new Set(['submitted', 'implementation-complete', 'revision-complete', 'research-complete']);
            if (agentState && COMPLETED.has(agentState.status)) {
                // Already completed — allow exit
                return;
            }

            // Not completed — block exit
            console.error(`⚠️  You haven't submitted your work. Run \`aigon agent-status implementation-complete\` (or \`revision-complete\` after addressing review feedback) first.`);
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

                'agent-resume': async (args) => {
            const resume = require('../agent-resume');
            try {
                await resume.runAgentResume(args);
                console.log('✅ Session resumed (tmux spawned). Restore agent-status was written from prior quota pause.');
            } catch (err) {
                console.error(err.message || String(err));
                process.exitCode = 1;
            }
        },

                'agent-context': async (args = []) => {
            const session = detectActiveAgentSession();
            if (args.includes('--id-only')) {
                if (session.detected && session.agentId) {
                    console.log(session.agentId);
                } else {
                    process.exitCode = 1;
                }
                return;
            }
            if (args.includes('--json')) {
                console.log(JSON.stringify(session, null, 2));
                if (!session.detected) process.exitCode = 1;
                return;
            }
            if (session.detected && session.agentId) {
                console.log(`${session.agentId}\t${session.agentName || session.agentId}`);
                return;
            }
            console.error('No active Aigon agent session detected.');
            process.exitCode = 1;
        }
    };
};
