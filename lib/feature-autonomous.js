'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const workflowSnapshotAdapter = require('./workflow-snapshot-adapter');
const { readAgentStatus } = require('./agent-status');
const { matchTmuxSessionByEntityId, toUnpaddedId } = require('./worktree');
const { buildReviewCheckFeedbackPrompt } = require('./agent-prompt-resolver');
const { parseCliOptions, getOptionValue } = require('./cli-parse');
const { readFeatureAutoState, writeFeatureAutoState } = require('./auto-session-state');

/**
 * True when an implementer is far enough along for the AutoConductor to advance
 * the solo pipeline (post-review, auto-close, etc.). Accepts the terminal
 * 'feedback-addressed' state that follows review feedback — that status is
 * *not* 'ready' or 'submitted' but is still a valid "implementation complete" signal.
 */
const _READY_STATUSES = new Set([
    'ready', 'submitted', 'feedback-addressed',
    'implementation-complete', 'revision-complete', 'research-complete',
]);
function implAgentReadyForAutonomousClose(snap, agent, featureId, mainRepo) {
    const st = snap.agents && snap.agents[agent] ? snap.agents[agent].status : null;
    if (_READY_STATUSES.has(st)) return true;
    // Drive / registry mismatch: engine often keys the lone implementer as "solo" while
    // AutoConductor is started with a concrete id (e.g. cu). Bridge so allReady and close run.
    if (agent && agent !== 'solo' && snap.agents && snap.agents.solo) {
        if (_READY_STATUSES.has(snap.agents.solo.status)) return true;
    }
    const a = readAgentStatus(featureId, agent, 'feature', { mainRepoPath: mainRepo });
    const fileSt = a && a.status != null ? String(a.status) : '';
    if (_READY_STATUSES.has(fileSt)) return true;
    if (agent && agent !== 'solo') {
        const soloA = readAgentStatus(featureId, 'solo', 'feature', { mainRepoPath: mainRepo });
        const sfs = soloA && soloA.status != null ? String(soloA.status) : '';
        if (_READY_STATUSES.has(sfs)) return true;
    }
    return false;
}

/** After review feedback injection, detect re-submit (revision) vs stale pre-review status. */
function implStatusProgressedAfterFeedback(before, after) {
    if (!after) return false;
    if (!before) return false;
    if (String(after.status || '') !== String(before.status || '')) return true;
    const au = after.updatedAt;
    const bu = before.updatedAt;
    return Boolean(au && bu && au !== bu);
}

function readWorkflowEvents(repoPath, featureId) {
    const eventsPath = path.join(repoPath, '.aigon', 'workflows', 'features', String(featureId), 'events.jsonl');
    try {
        return fs.readFileSync(eventsPath, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map(line => JSON.parse(line));
    } catch (_) {
        return [];
    }
}

function hasCodeRevisionCompletedEvent(repoPath, featureId, revisionAgent) {
    return readWorkflowEvents(repoPath, featureId).some(event => {
        if (!event || event.type !== 'feature.code_revision.completed') return false;
        return !revisionAgent || !event.revisionAgentId || event.revisionAgentId === revisionAgent;
    });
}

function isCodeRevisionInProgress(snapshot) {
    return Boolean(
        snapshot
        && (
            snapshot.currentSpecState === 'code_revision_in_progress'
            || snapshot.lifecycle === 'code_revision_in_progress'
            || (snapshot.codeReview && snapshot.codeReview.requestRevision !== false && snapshot.codeReview.reviewCompletedAt && !snapshot.codeReview.revisionCompletedAt)
        )
    );
}

function isCodeRevisionComplete(snapshot, repoPath, featureId, revisionAgent) {
    return Boolean(
        snapshot
        && (
            snapshot.currentSpecState === 'code_revision_complete'
            || snapshot.lifecycle === 'code_revision_complete'
            || (snapshot.codeReview && snapshot.codeReview.revisionCompletedAt)
            || hasCodeRevisionCompletedEvent(repoPath, featureId, revisionAgent)
        )
    );
}

function runAigonCliCommand(mainRepoPath, args) {
    const cliPath = path.join(__dirname, '..', 'aigon-cli.js');
    const isFeatureClose = (args[0] || '') === 'feature-close';
    // REGRESSION: pipe + large feature-close (merge) output can fill OS pipe buffers; the
    // child blocks on write while spawnSync waits on exit — AutoConductor never sets closeTriggered.
    return spawnSync(process.execPath, [cliPath, ...args], {
        cwd: mainRepoPath,
        encoding: isFeatureClose ? undefined : 'utf8',
        stdio: isFeatureClose ? 'inherit' : 'pipe',
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
}

function persistFeatureAutoState(repoPath, featureId, patch) {
    try { return writeFeatureAutoState(repoPath, featureId, patch); } catch (_) { return null; }
}

function readPersistedFeatureAutoState(repoPath, featureId) {
    try { return readFeatureAutoState(repoPath, featureId); } catch (_) { return null; }
}

function findAutoSessionNameByFeatureId(assertTmuxAvailable, featureId) {
    try {
        assertTmuxAvailable();
        const result = spawnSync('tmux', ['list-sessions', '-F', '#S'], { encoding: 'utf8', stdio: 'pipe' });
        if (result.error || result.status !== 0) return null;
        const sessions = (result.stdout || '').split('\n').map(s => s.trim()).filter(Boolean);
        const match = sessions.find(sessionName => {
            const parsed = matchTmuxSessionByEntityId(sessionName, featureId);
            return parsed && parsed.type === 'f' && parsed.role === 'auto';
        });
        return match || null;
    } catch (_) { return null; }
}

async function run(args, deps) {
    const {
        ctx,
    } = deps;
    const u = ctx.utils;
    const sc = ctx.specCrud;
    const { findFile } = sc;
    const {
        PATHS,
        filterByFeatureId,
        findWorktrees,
        buildAgentCommand,
        buildTmuxSessionName,
        tmuxSessionExists,
        createDetachedTmuxSession,
        assertTmuxAvailable,
        getAvailableAgents,
        shellQuote,
    } = u;

    const options = parseCliOptions(args);
    const subcommand = options._[0];
    const mainRepo = deps.resolveMainRepoPath(process.cwd(), deps.ctx.git);
    const selfCommands = deps.cmds;

    if (subcommand === '__run-loop') {
        const featureNum = String(options._[1] || '').trim();
        if (!featureNum || !/^\d+$/.test(featureNum)) {
            console.error('Usage: aigon feature-autonomous-start __run-loop <feature-id> --agents=<agent,agent> --stop-after=<implement|eval|review|close> [--eval-agent=<agent>] [--review-agent=<agent>]');
            process.exitCode = 1;
            return;
        }

        const agentsRaw = String(getOptionValue(options, 'agents') || '').trim();
        const agentIds = agentsRaw.split(',').map(v => v.trim()).filter(Boolean);
        if (agentIds.length === 0) {
            console.error('❌ Missing --agents for AutoConductor loop.');
            process.exitCode = 1;
            return;
        }
        const stopAfter = String(getOptionValue(options, 'stop-after') || 'close').trim();
        if (!['implement', 'eval', 'review', 'close'].includes(stopAfter)) {
            console.error(`❌ Invalid --stop-after value: ${stopAfter}`);
            process.exitCode = 1;
            return;
        }
        const evalAgent = String(getOptionValue(options, 'eval-agent') || '').trim() || null;
        const reviewAgent = String(getOptionValue(options, 'review-agent') || '').trim() || null;
        const workflowSlug = String(getOptionValue(options, 'workflow') || '').trim() || null;
        const loopSessionName = String(getOptionValue(options, 'session-name') || '').trim() || null;
        const pollSeconds = Math.max(5, parseInt(String(getOptionValue(options, 'poll-seconds') || '30'), 10) || 30);
        const isFleet = agentIds.length > 1;
        const effectiveStopAfter = isFleet
            ? stopAfter
            : (stopAfter === 'eval' ? 'close' : stopAfter);
        const effectiveEvalAgent = isFleet ? (evalAgent || agentIds[0]) : null;
        const updateAutoState = (patch) => persistFeatureAutoState(mainRepo, featureNum, {
            sessionName: loopSessionName,
            agents: agentIds,
            stopAfter: effectiveStopAfter,
            evalAgent: effectiveEvalAgent,
            reviewAgent,
            workflowSlug,
            mode: isFleet ? 'fleet' : 'solo_worktree',
            ...patch,
        });
        let finalAutoState = null;
        const finishAuto = (status, patch = {}) => {
            finalAutoState = {
                status,
                running: false,
                endedAt: new Date().toISOString(),
                ...patch,
            };
        };
        const stopAutoSession = () => {
            const mySession = loopSessionName || findAutoSessionNameByFeatureId(assertTmuxAvailable, featureNum);
            if (mySession) spawnSync('tmux', ['kill-session', '-t', mySession], { stdio: 'ignore' });
        };
        // Must persist before kill-session: the loop runs inside that tmux; killing it can
        // terminate this process before the outer `finally` runs, losing `status: completed`.
        const persistFinishState = () => {
            if (finalAutoState) updateAutoState(finalAutoState);
        };

        // Solo review validation
        if (isFleet && effectiveStopAfter === 'review') {
            console.error('❌ --stop-after=review is only supported in solo mode.');
            process.exitCode = 1;
            return;
        }
        if (!isFleet && effectiveStopAfter === 'review' && !reviewAgent) {
            console.error('❌ --stop-after=review requires --review-agent to be set.');
            process.exitCode = 1;
            return;
        }
        if (!isFleet && reviewAgent && agentIds.includes(reviewAgent)) {
            console.log(`⚠️  Review agent (${reviewAgent}) is the same as implementing agent. Proceeding anyway.`);
        }
        let evalTriggered = false;
        let evalStarted = false;      // eval session is confirmed running + state='evaluating'
        let expectedEvalSessionName = null;
        let closeTriggered = false;
        let postTriggerPolls = 0;
        // MERGE + engine updates can exceed 10×poll (e.g. 30s) on large feature-close.
        const MAX_POST_TRIGGER_POLLS = 40;
        let evalClosePolls = 0;
        const MAX_EVAL_CLOSE_POLLS = 120; // 60 min at 30s intervals
        // Solo review state
        let reviewTriggered = false;
        let reviewStarted = false;
        let expectedReviewSessionName = null;
        let reviewClosePolls = 0;
        const MAX_REVIEW_CLOSE_POLLS = 120; // 60 min at 30s intervals
        // Feedback injection state (solo mode: implement → review → address feedback → close)
        let feedbackInjected = false;
        let feedbackAddressed = false;
        let feedbackPolls = 0;
        const MAX_FEEDBACK_POLLS = 120; // 60 min at 30s intervals
        let implStatusAtFeedbackInject = null;

        console.log(`🤖 AutoConductor started for feature ${featureNum}`);
        console.log(`   agents: ${agentIds.join(', ')}`);
        console.log(`   stop-after: ${effectiveStopAfter}`);
        if (isFleet) {
            console.log(`   evaluator: ${effectiveEvalAgent}`);
        }
        if (!isFleet && reviewAgent) {
            console.log(`   review-agent: ${reviewAgent}`);
        }
        console.log(`   poll interval: ${pollSeconds}s`);
        console.log('');
        updateAutoState({ status: 'running', running: true });

        const readFeatureSnap = () =>
            workflowSnapshotAdapter.readWorkflowSnapshotSyncUncached(mainRepo, 'feature', featureNum);
        const everyImplReady = (snap) => agentIds.every((agent) =>
            implAgentReadyForAutonomousClose(snap, agent, featureNum, mainRepo)
        );

        try {
            // Derive featureDesc from the spec filename in the snapshot so the
            // eval session name/command are built correctly (featureDesc is not
            // passed into __run-loop — it lives in the outer code path).
            let featureDesc = featureNum;  // fallback

            while (true) {
                const snapshot = readFeatureSnap();
                if (!snapshot) {
                    console.error(`❌ No workflow snapshot found for feature ${featureNum}.`);
                    finishAuto('failed', { reason: 'snapshot-missing' });
                    process.exitCode = 1;
                    return;
                }
                // Update featureDesc from snapshot specPath on first read
                if (snapshot.specPath) {
                    const m = path.basename(snapshot.specPath).match(/^feature-\d+-(.+)\.md$/);
                    if (m) featureDesc = m[1];
                }
                const stage = snapshot.currentSpecState || snapshot.lifecycle || 'unknown';
                const agentStatuses = agentIds.map(agent => {
                    const s = snapshot.agents && snapshot.agents[agent] ? snapshot.agents[agent].status : null;
                    return `${agent}=${s}`;
                });
                const allReady = everyImplReady(snapshot);
                updateAutoState({
                    workflowState: stage,
                    allReady,
                    closeTriggered,
                    evalTriggered,
                    reviewTriggered,
                    feedbackInjected,
                });

                // Verbose debug logging every poll
                console.log(`[${new Date().toLocaleTimeString()}] state=${stage} agents=[${agentStatuses.join(', ')}] allReady=${allReady} evalTriggered=${evalTriggered} reviewTriggered=${reviewTriggered} feedbackInjected=${feedbackInjected} closeTriggered=${closeTriggered} isFleet=${isFleet} effectiveStopAfter=${effectiveStopAfter}`);

                if (effectiveStopAfter === 'implement' && allReady) {
                    console.log('✅ Implementation complete. AutoConductor stopping at implement.');
                    if (isFleet) {
                        console.log(`➡️  Next step: aigon feature-eval ${featureNum} --agent=${effectiveEvalAgent}`);
                    } else {
                        console.log(`➡️  Next step: aigon feature-close ${featureNum}`);
                    }
                    finishAuto('stopped', { reason: 'stop-after-implement', workflowState: stage });
                    persistFinishState();
                    stopAutoSession();
                    return;
                }

                if (!isFleet) {
                // Solo: after allReady, optionally spawn review, then close
                    const soloReadyToAdvance = allReady && effectiveStopAfter !== 'implement';

                    // Step 1: Spawn review session if --review-agent is set
                    if (soloReadyToAdvance && reviewAgent && !reviewTriggered) {
                        const reviewWorktrees = filterByFeatureId(findWorktrees(), featureNum);
                        const reviewWorktree = reviewWorktrees[0];
                        if (!reviewWorktree || !reviewWorktree.path) {
                            console.error(`❌ No worktree found for feature ${featureNum}; cannot start review session.`);
                            finishAuto('failed', { reason: 'review-worktree-missing', workflowState: stage });
                            process.exitCode = 1;
                            return;
                        }
                        const reviewSessionName = buildTmuxSessionName(featureNum, reviewAgent, {
                            repo: path.basename(mainRepo),
                            desc: featureDesc,
                            entityType: 'f',
                            role: 'review'
                        });
                        expectedReviewSessionName = reviewSessionName;
                        const reviewCommand = buildAgentCommand({
                            agent: reviewAgent,
                            featureId: featureNum,
                            path: reviewWorktree.path,
                            desc: featureDesc,
                            repoPath: mainRepo
                        }, 'review');

                        console.log(`🔍 Spawning review session: ${reviewSessionName}`);

                        if (tmuxSessionExists(reviewSessionName)) {
                            console.log(`ℹ️  Review session already running: ${reviewSessionName}`);
                        } else {
                            createDetachedTmuxSession(reviewSessionName, reviewWorktree.path, reviewCommand, {
                                repoPath: mainRepo,
                                entityType: 'f',
                                entityId: featureNum,
                                agent: reviewAgent,
                                role: 'review',
                                worktreePath: reviewWorktree.path,
                            });
                            if (!tmuxSessionExists(reviewSessionName)) {
                                console.error(`❌ Review session did not start: ${reviewSessionName}`);
                                finishAuto('failed', { reason: 'review-session-start-failed', workflowState: stage });
                                process.exitCode = 1;
                                return;
                            }
                            console.log(`✅ Started review session: ${reviewSessionName}`);
                        }
                        reviewTriggered = true;
                        postTriggerPolls = 0;
                    }

                    // Step 2: Wait for review session to start
                    if (reviewTriggered && !reviewStarted) {
                        postTriggerPolls++;
                        const reviewSessionRunning = expectedReviewSessionName ? tmuxSessionExists(expectedReviewSessionName) : false;
                        console.log(`  [review-start ${postTriggerPolls}/${MAX_POST_TRIGGER_POLLS}] reviewSession=${expectedReviewSessionName} running=${reviewSessionRunning}`);
                        if (reviewSessionRunning) {
                            reviewStarted = true;
                            postTriggerPolls = 0;
                            if (effectiveStopAfter === 'review') {
                                console.log('✅ Review started. AutoConductor stopping at review.');
                                console.log(`➡️  Wait for the review agent to finish, then: aigon feature-close ${featureNum}`);
                                finishAuto('stopped', { reason: 'stop-after-review', workflowState: stage });
                                persistFinishState();
                                stopAutoSession();
                                return;
                            }
                            console.log('✅ Review started. Waiting for review agent to complete...');
                        }
                        if (!reviewStarted && postTriggerPolls >= MAX_POST_TRIGGER_POLLS) {
                            console.error(`❌ Review session did not start after ${MAX_POST_TRIGGER_POLLS} polls.`);
                            finishAuto('failed', { reason: 'review-session-timeout', workflowState: stage });
                            process.exitCode = 1;
                            return;
                        }
                    }

                    // Step 3: If review is active, wait for the engine to enter code revision.
                    if (reviewStarted && effectiveStopAfter === 'close' && !closeTriggered && !feedbackInjected) {
                        reviewClosePolls++;
                        const reviewSessionRunning = expectedReviewSessionName ? tmuxSessionExists(expectedReviewSessionName) : false;
                        const reviewSnapshot = readFeatureSnap();
                        const engineRevisionReady = isCodeRevisionInProgress(reviewSnapshot);
                        const reviewCompleted = engineRevisionReady;
                        console.log(`  [review-close ${reviewClosePolls}/${MAX_REVIEW_CLOSE_POLLS}] reviewSession running=${reviewSessionRunning} engineRevisionReady=${engineRevisionReady}`);

                        if (reviewCompleted) {
                            console.log('✅ Review completion signaled. Injecting feedback prompt into implementation session...');
                            // Step 3.5: Inject feedback prompt into implementing agent's tmux session
                            const implAgent = agentIds[0];
                            const implSessionName = buildTmuxSessionName(featureNum, implAgent, {
                                repo: path.basename(mainRepo),
                                desc: featureDesc,
                                entityType: 'f',
                                role: 'do'
                            });
                            if (tmuxSessionExists(implSessionName)) {
                                const feedbackPrompt = buildReviewCheckFeedbackPrompt(implAgent, featureNum);
                                spawnSync('tmux', ['send-keys', '-t', implSessionName, '-l', feedbackPrompt], { stdio: 'ignore' });
                                // Give Codex a moment to render the injected text before submitting it.
                                spawnSync('sleep', ['0.1'], { stdio: 'ignore' });
                                spawnSync('tmux', ['send-keys', '-t', implSessionName, 'C-m'], { stdio: 'ignore' });
                                console.log(`📝 Feedback prompt injected into session: ${implSessionName}`);
                                feedbackInjected = true;
                                implStatusAtFeedbackInject = readAgentStatus(featureNum, implAgent, 'feature', { mainRepoPath: mainRepo });
                            } else {
                                console.log(`⚠️  Implementation session not found (${implSessionName}). Proceeding to close without feedback injection.`);
                                feedbackInjected = true;
                                feedbackAddressed = true;
                            }
                            // Continue polling — don't fall through to close yet
                            spawnSync('sleep', [String(pollSeconds)], { stdio: 'ignore' });
                            continue;
                        } else if (!reviewSessionRunning) {
                            console.error('❌ Review session exited before recording code review completion.');
                            console.error(`   Re-run review or signal manually with \`aigon agent-status review-complete\`, then close: aigon feature-close ${featureNum}`);
                            finishAuto('failed', { reason: 'review-exited-without-signal', workflowState: stage });
                            process.exitCode = 1;
                            return;
                        } else if (reviewClosePolls >= MAX_REVIEW_CLOSE_POLLS) {
                            console.error(`❌ Review session timed out after ${MAX_REVIEW_CLOSE_POLLS} polls.`);
                            console.error(`   Run manually: aigon feature-close ${featureNum}`);
                            finishAuto('failed', { reason: 'review-timeout', workflowState: stage });
                            process.exitCode = 1;
                            return;
                        } else {
                            // Still waiting for review to finish — continue polling
                            spawnSync('sleep', [String(pollSeconds)], { stdio: 'ignore' });
                            continue;
                        }
                    }

                    // Step 3.5: Wait for implementing agent to address feedback
                    if (feedbackInjected && !feedbackAddressed && !closeTriggered) {
                        feedbackPolls++;
                        const implAgent = agentIds[0];
                        const implSessionRunning = (() => {
                            const sn = buildTmuxSessionName(featureNum, implAgent, {
                                repo: path.basename(mainRepo),
                                desc: featureDesc,
                                entityType: 'f',
                                role: 'do'
                            });
                            return tmuxSessionExists(sn);
                        })();
                        const implStatus = readAgentStatus(featureNum, implAgent, 'feature', { mainRepoPath: mainRepo });
                        const snapFb = readFeatureSnap();
                        const engineRevisionComplete = isCodeRevisionComplete(snapFb, mainRepo, featureNum, implAgent);
                        const signaled = implStatus && (implStatus.status === 'feedback-addressed' || implStatus.status === 'revision-complete');
                        const progressed = implStatusProgressedAfterFeedback(implStatusAtFeedbackInject, implStatus);
                        const readyAfterFeedback = implAgentReadyForAutonomousClose(snapFb, implAgent, featureNum, mainRepo);
                        console.log(`  [feedback ${feedbackPolls}/${MAX_FEEDBACK_POLLS}] implSession running=${implSessionRunning} status=${implStatus && implStatus.status} engineRevisionComplete=${engineRevisionComplete} signaled=${signaled} progressed=${progressed} readyAfterFeedback=${readyAfterFeedback}`);

                        if (engineRevisionComplete) {
                            console.log('✅ Code revision completed in workflow state. Proceeding to close.');
                            feedbackAddressed = true;
                            // Fall through to close logic below
                        } else if (signaled) {
                            console.log('✅ Implementing agent addressed feedback. Proceeding to close.');
                            feedbackAddressed = true;
                            // Fall through to close logic below
                        } else if (progressed && readyAfterFeedback) {
                            // REGRESSION: agents often re-run `agent-status submitted` after revision instead of
                            // `feedback-addressed`, leaving the inner loop (and set outer loop) stuck forever.
                            console.log('✅ Implementer re-signaled after review feedback. Proceeding to close.');
                            feedbackAddressed = true;
                        } else if (!implSessionRunning) {
                            console.log('⚠️  Implementation session exited. Treating feedback as addressed.');
                            feedbackAddressed = true;
                            // Fall through to close logic below
                        } else if (feedbackPolls >= MAX_FEEDBACK_POLLS) {
                            console.error(`❌ Feedback addressing timed out after ${MAX_FEEDBACK_POLLS} polls.`);
                            console.error(`   Run manually: aigon feature-close ${featureNum}`);
                            finishAuto('failed', { reason: 'feedback-timeout', workflowState: stage });
                            process.exitCode = 1;
                            return;
                        } else {
                            // Still waiting for feedback to be addressed
                            spawnSync('sleep', [String(pollSeconds)], { stdio: 'ignore' });
                            continue;
                        }
                    }

                    // Step 4: Close (either no review, review completed + feedback addressed, or no review agent)
                    // Re-read here: (1) 'feedback-addressed' was not in the early 'allReady' gate before we added it;
                    // (2) same-iteration fall-through from the feedback step must not use the loop-start snapshot.
                    const snapForClose = readFeatureSnap() || snapshot;
                    const engineRevisionComplete = reviewAgent ? isCodeRevisionComplete(snapForClose, mainRepo, featureNum, agentIds[0]) : false;
                    const reviewCompleted = !reviewAgent || engineRevisionComplete;
                    const feedbackDone = !reviewAgent || engineRevisionComplete || !feedbackInjected || feedbackAddressed;
                    const allReadyForClose = everyImplReady(snapForClose);
                    const soloReadyForFeatureClose = allReadyForClose && effectiveStopAfter !== 'implement';
                    const readyToClose = soloReadyForFeatureClose && effectiveStopAfter === 'close'
                        && (!reviewAgent || (reviewStarted && reviewCompleted))
                        && feedbackDone;
                    if (readyToClose && !closeTriggered) {
                        console.log(`🚀 Triggering: aigon feature-close ${featureNum}`);
                        const closeResult = runAigonCliCommand(mainRepo, ['feature-close', featureNum]);
                        if (closeResult.stdout) process.stdout.write(closeResult.stdout);
                        if (closeResult.stderr) process.stderr.write(closeResult.stderr);
                        if (closeResult.error || closeResult.status !== 0) {
                            console.error(`❌ feature-close failed for feature ${featureNum}.`);
                            finishAuto('failed', { reason: 'feature-close-failed', workflowState: stage });
                            process.exitCode = 1;
                            return;
                        }
                        closeTriggered = true;
                        postTriggerPolls = 0;
                    }
                    if (closeTriggered) {
                        postTriggerPolls++;
                        const next = readFeatureSnap();
                        if (next && (next.currentSpecState === 'done' || next.lifecycle === 'done')) {
                            console.log('✅ Feature closed. AutoConductor finished.');
                            finishAuto('completed', { reason: 'feature-closed', workflowState: next.currentSpecState || next.lifecycle || 'done' });
                            persistFinishState();
                            stopAutoSession();
                            return;
                        }
                        if (postTriggerPolls >= MAX_POST_TRIGGER_POLLS) {
                            console.error(`❌ feature-close succeeded but state did not reach 'done' after ${MAX_POST_TRIGGER_POLLS} polls. Exiting.`);
                            finishAuto('failed', { reason: 'feature-close-state-timeout', workflowState: next?.currentSpecState || next?.lifecycle || stage });
                            process.exitCode = 1;
                            return;
                        }
                    }
                } else {
                // Fleet mode: trigger eval when all agents are ready, then optionally wait for close
                    const shouldTriggerEval = (effectiveStopAfter === 'eval' || effectiveStopAfter === 'close');
                    if (shouldTriggerEval && allReady && !evalTriggered) {
                        // Spawn the eval agent session — the agent does the state transition
                        // itself (feature-eval --no-launch from inside the session).
                        const evalSessionName = buildTmuxSessionName(featureNum, effectiveEvalAgent, {
                            repo: path.basename(mainRepo),
                            desc: featureDesc,
                            entityType: 'f',
                            role: 'eval'
                        });
                        expectedEvalSessionName = evalSessionName;
                        const evalCommand = buildAgentCommand({
                            agent: effectiveEvalAgent,
                            featureId: featureNum,
                            path: mainRepo,
                            desc: featureDesc,
                            repoPath: mainRepo
                        }, 'evaluate');

                        console.log(`🔍 Eval session name: ${evalSessionName}`);
                        console.log(`🔍 Eval cwd: ${mainRepo}`);
                        console.log(`🔍 Eval command (first 200 chars): ${evalCommand.slice(0, 200)}`);

                        if (tmuxSessionExists(evalSessionName)) {
                            console.log(`ℹ️  Eval session already running: ${evalSessionName}`);
                        } else {
                            createDetachedTmuxSession(evalSessionName, mainRepo, evalCommand, {
                                repoPath: mainRepo,
                                entityType: 'f',
                                entityId: featureNum,
                                agent: effectiveEvalAgent,
                                role: 'eval',
                                worktreePath: mainRepo,
                            });
                            if (!tmuxSessionExists(evalSessionName)) {
                                console.error(`❌ Eval session did not start: ${evalSessionName}`);
                                finishAuto('failed', { reason: 'eval-session-start-failed', workflowState: stage });
                                process.exitCode = 1;
                                return;
                            }
                            console.log(`✅ Started eval session: ${evalSessionName}`);
                        }
                        evalTriggered = true;
                        postTriggerPolls = 0;
                    }

                    // Phase 1: wait for eval session to start (state → 'evaluating')
                    if (evalTriggered && !evalStarted) {
                        postTriggerPolls++;
                        const next = readFeatureSnap();
                        const evalSessionRunning = expectedEvalSessionName ? tmuxSessionExists(expectedEvalSessionName) : false;
                        console.log(`  [eval-start ${postTriggerPolls}/${MAX_POST_TRIGGER_POLLS}] state=${next?.currentSpecState} evalSession=${expectedEvalSessionName} running=${evalSessionRunning}`);
                        if (next && next.currentSpecState === 'evaluating' && evalSessionRunning) {
                            evalStarted = true;
                            postTriggerPolls = 0;
                            if (effectiveStopAfter === 'eval') {
                                console.log('✅ Evaluation started. AutoConductor finished.');
                                console.log('➡️  Next step: choose winner, then run aigon feature-close <id> <winner-agent>');
                                finishAuto('stopped', { reason: 'stop-after-eval', workflowState: next.currentSpecState || 'evaluating' });
                                persistFinishState();
                                stopAutoSession();
                                return;
                            }
                            console.log('✅ Evaluation started. Waiting for eval agent to complete and close...');
                        }
                        if (!evalStarted && postTriggerPolls >= MAX_POST_TRIGGER_POLLS) {
                            const next2 = readFeatureSnap();
                            const running2 = expectedEvalSessionName ? tmuxSessionExists(expectedEvalSessionName) : false;
                            console.error(`❌ State did not reach 'evaluating' after ${MAX_POST_TRIGGER_POLLS} polls. state=${next2?.currentSpecState} evalSessionRunning=${running2}`);
                            finishAuto('failed', { reason: 'eval-start-timeout', workflowState: next2?.currentSpecState || next2?.lifecycle || stage });
                            process.exitCode = 1;
                            return;
                        }
                    }
                    // Phase 2 (close mode only): poll for winner in eval file, then close
                    if (evalStarted && effectiveStopAfter === 'close') {
                        evalClosePolls++;
                        const next = readFeatureSnap();
                        const evalSessionRunning = expectedEvalSessionName ? tmuxSessionExists(expectedEvalSessionName) : false;

                        // Parse winner from eval file on every poll (agent may still be running when it writes the file)
                        const numStr = String(featureNum).padStart(2, '0');
                        const evalFilePath = path.join(mainRepo, 'docs', 'specs', 'features', 'evaluations', `feature-${numStr}-eval.md`);
                        let winner = null;
                        if (!closeTriggered && fs.existsSync(evalFilePath)) {
                            try {
                                const evalContent = fs.readFileSync(evalFilePath, 'utf8');
                                const agentPattern = agentIds.length > 0 ? agentIds.join('|') : '[a-z]{2,4}';
                                const m = evalContent.match(new RegExp(`\\*\\*Winner:\\*\\*\\s+(${agentPattern})\\b`, 'i'));
                                if (m) winner = m[1].toLowerCase();
                            } catch (_) { /* ignore read errors */ }
                        }

                        console.log(`  [eval-close ${evalClosePolls}/${MAX_EVAL_CLOSE_POLLS}] state=${next?.currentSpecState} evalSession running=${evalSessionRunning} winner=${winner || 'none'} closeTriggered=${closeTriggered}`);

                        // Already closed — wait for state to confirm
                        if (closeTriggered) {
                            if (next && (next.currentSpecState === 'done' || next.lifecycle === 'done')) {
                                console.log('✅ Feature closed autonomously. AutoConductor finished.');
                                finishAuto('completed', { reason: 'feature-closed', workflowState: next.currentSpecState || next.lifecycle || 'done' });
                                persistFinishState();
                                stopAutoSession();
                                return;
                            }
                            if (evalClosePolls >= MAX_EVAL_CLOSE_POLLS) {
                                console.error(`❌ feature-close ran but state never reached 'done' after ${MAX_EVAL_CLOSE_POLLS} polls.`);
                                finishAuto('failed', { reason: 'feature-close-state-timeout', workflowState: next?.currentSpecState || next?.lifecycle || stage });
                                process.exitCode = 1;
                                return;
                            }
                        } else if (winner) {
                            // Winner written to eval file — close now (session may still be running)
                            console.log(`🏆 Winner: ${winner} — closing feature ${featureNum}`);
                            const closeResult = runAigonCliCommand(mainRepo, ['feature-close', featureNum, winner]);
                            if (closeResult.stdout) process.stdout.write(closeResult.stdout);
                            if (closeResult.stderr) process.stderr.write(closeResult.stderr);
                            if (closeResult.error || closeResult.status !== 0) {
                                console.error(`❌ feature-close failed for feature ${featureNum} with winner ${winner}.`);
                                finishAuto('failed', { reason: 'feature-close-failed', workflowState: stage, winner });
                                process.exitCode = 1;
                                return;
                            }
                            closeTriggered = true;
                            evalClosePolls = 0; // reset counter for post-close confirmation
                        } else if (!evalSessionRunning) {
                            // Session exited without writing a winner — error
                            console.error(`❌ Eval agent exited but no winner found in eval file: ${evalFilePath}`);
                            console.error(`   The eval file must contain: **Winner:** <agent-code>`);
                            console.error(`   Run manually: aigon feature-close ${featureNum} <winner-agent>`);
                            finishAuto('failed', { reason: 'eval-exited-without-winner', workflowState: stage });
                            process.exitCode = 1;
                            return;
                        }

                        if (evalClosePolls >= MAX_EVAL_CLOSE_POLLS) {
                            console.error(`❌ Autonomous eval/close timed out after ${MAX_EVAL_CLOSE_POLLS} polls.`);
                            console.error(`   Run: aigon feature-close ${featureNum} <winner-agent>`);
                            finishAuto('failed', { reason: 'eval-close-timeout', workflowState: stage });
                            process.exitCode = 1;
                            return;
                        }
                    }
                }

                spawnSync('sleep', [String(pollSeconds)], { stdio: 'ignore' });
            }
        } catch (error) {
            finishAuto('failed', { reason: 'uncaught-error', error: error.message });
            throw error;
        } finally {
            if (finalAutoState) updateAutoState(finalAutoState);
        }
    }

    if (subcommand === 'status') {
        const idArg = String(options._[1] || '').trim();
        if (!idArg) {
            console.error('Usage: aigon feature-autonomous-start status <feature-id>');
            process.exitCode = 1;
            return;
        }
        const snapshot = workflowSnapshotAdapter.readWorkflowSnapshotSync(mainRepo, 'feature', idArg);
        const persistedAuto = readPersistedFeatureAutoState(mainRepo, idArg);
        const autoSessionName = findAutoSessionNameByFeatureId(assertTmuxAvailable, idArg);
        const autoSessionRunning = Boolean(autoSessionName);

        const uid = toUnpaddedId(idArg);
        console.log(`Feature ${String(idArg).padStart(2, '0')} autonomous status`);
        console.log(`Tmux: match *-f${uid}-auto* (session name uses an unpadded id, e.g. 01 -> f1 not f01)`);
        const lastStatus = persistedAuto && persistedAuto.status ? persistedAuto.status : null;
        console.log(`AutoConductor: ${autoSessionRunning ? 'running' : `not running${lastStatus ? ` (last: ${lastStatus})` : ''}`}`);
        if (autoSessionName) console.log(`Session: ${autoSessionName}`);
        else if (persistedAuto && persistedAuto.sessionName) console.log(`Last session: ${persistedAuto.sessionName}`);
        console.log(`Workflow state: ${snapshot ? (snapshot.currentSpecState || snapshot.lifecycle || 'unknown') : 'unknown (snapshot missing)'}`);
        if (persistedAuto && persistedAuto.reason) console.log(`Last result: ${persistedAuto.reason}`);
        if (persistedAuto && persistedAuto.updatedAt) console.log(`Last update: ${persistedAuto.updatedAt}`);
        if (snapshot && snapshot.agents) {
            const agents = Object.keys(snapshot.agents).sort((a, b) => a.localeCompare(b));
            if (agents.length > 0) {
                console.log(`Agents: ${agents.map(agent => `${agent}:${snapshot.agents[agent].status || 'unknown'}`).join(', ')}`);
            }
        }
        // Show review session state if any exists
        try {
            assertTmuxAvailable();
            const tmuxResult = spawnSync('tmux', ['list-sessions', '-F', '#S'], { encoding: 'utf8', stdio: 'pipe' });
            if (!tmuxResult.error && tmuxResult.status === 0) {
                const sessions = (tmuxResult.stdout || '').split('\n').map(s => s.trim()).filter(Boolean);
                const reviewSession = sessions.find(s => {
                    const parsed = matchTmuxSessionByEntityId(s, idArg);
                    return parsed && parsed.type === 'f' && parsed.role === 'review';
                });
                if (reviewSession) {
                    console.log(`Review session: running (${reviewSession})`);
                }
            }
        } catch (_) { /* tmux not available */ }
        return;
    }

    const featureId = subcommand;
    if (!featureId || featureId.startsWith('-')) {
        console.error('Usage: aigon feature-autonomous-start <feature-id> <agents...> [--eval-agent=<agent>] [--review-agent=<agent>] [--stop-after=implement|eval|review|close] [--workflow=<slug>]');
        console.error('       aigon feature-autonomous-start status <feature-id>');
        console.error('\nExamples:');
        console.error('  aigon feature-autonomous-start 42 cc');
        console.error('  aigon feature-autonomous-start 42 cc --review-agent=gg --stop-after=close');
        console.error('  aigon feature-autonomous-start 42 cc gg --eval-agent=gg --stop-after=eval');
        console.error('  aigon feature-autonomous-start 42 --workflow=solo-reviewed');
        console.error('  aigon feature-autonomous-start status 42');
        process.exitCode = 1;
        return;
    }

    const workflowSlug = String(getOptionValue(options, 'workflow') || '').trim() || null;
    let workflowDefaults = null;
    if (workflowSlug) {
        const workflowDefs = require('./workflow-definitions');
        const def = workflowDefs.resolve(workflowSlug, mainRepo);
        if (!def) {
            console.error(`❌ Workflow not found: ${workflowSlug}`);
            console.error('   Run: aigon workflow list');
            process.exitCode = 1;
            return;
        }
        workflowDefaults = workflowDefs.resolveAutonomousInputs(def);
        if (workflowDefaults.models && Object.keys(workflowDefaults.models).length > 0) {
            console.log('ℹ️  Per-stage model overrides are resolved but not yet applied at agent launch in this version; set AIGON_<AGENT>_<STAGE>_MODEL env vars to override.');
        }
    }

    const positionalAgents = options._.slice(1);
    const stopAfterCli = getOptionValue(options, 'stop-after');
    const stopAfter = String(stopAfterCli != null
        ? stopAfterCli
        : (workflowDefaults ? workflowDefaults.stopAfter : 'close')).trim();
    if (!['implement', 'eval', 'review', 'close'].includes(stopAfter)) {
        console.error('❌ --stop-after must be one of: implement, eval, review, close');
        process.exitCode = 1;
        return;
    }
    const evalAgentCli = getOptionValue(options, 'eval-agent');
    const reviewAgentCli = getOptionValue(options, 'review-agent');
    const evalAgentOption = String(evalAgentCli != null
        ? evalAgentCli
        : (workflowDefaults && workflowDefaults.evalAgent) || '').trim() || null;
    const reviewAgentOption = String(reviewAgentCli != null
        ? reviewAgentCli
        : (workflowDefaults && workflowDefaults.reviewAgent) || '').trim() || null;
    let agentIds = positionalAgents.length > 0
        ? positionalAgents
        : (workflowDefaults ? [...workflowDefaults.agents] : []);
    if (agentIds.length === 0) {
        console.error('❌ At least one implementation agent is required (positional args or --workflow=<slug>).');
        process.exitCode = 1;
        return;
    }

    const availableAgents = getAvailableAgents();
    const invalidAgents = agentIds.filter(a => !availableAgents.includes(a));
    if (invalidAgents.length > 0) {
        console.error(`❌ Unknown agent(s): ${invalidAgents.join(', ')}. Available: ${availableAgents.join(', ')}`);
        process.exitCode = 1;
        return;
    }
    if (reviewAgentOption && !availableAgents.includes(reviewAgentOption)) {
        console.error(`❌ Unknown review agent: ${reviewAgentOption}. Available: ${availableAgents.join(', ')}`);
        process.exitCode = 1;
        return;
    }

    // Pro gate only for a valid user-facing start invocation. Internal/status
    // subcommands are dispatched above and never reach here.
    const { assertProCapability } = require('./pro');
    if (!assertProCapability('Autonomous orchestration', 'aigon feature-start <id> + aigon feature-do <id>')) {
        process.exitCode = 1;
        return;
    }

    let existingWorktrees = [];
    try {
        existingWorktrees = filterByFeatureId(findWorktrees(), featureId);
    } catch (e) { /* no worktrees */ }

    let found = findFile(PATHS.features, featureId, ['02-backlog', '03-in-progress']);
    if (!found) {
        console.error(`❌ Could not find feature "${featureId}" in backlog or in-progress.`);
        process.exitCode = 1;
        return;
    }

    const match = found.file.match(/^feature-(\d+)-(.*)\.md$/);
    if (!match) {
        console.error('❌ Could not parse feature filename.');
        process.exitCode = 1;
        return;
    }
    const [, featureNum, featureDesc] = match;

    if (existingWorktrees.length > 0) {
        agentIds = existingWorktrees.map(wt => wt.agent);
        console.log(`ℹ️  Feature ${featureNum} already has worktrees; using existing agents: ${agentIds.join(', ')}`);
    } else {
        console.log(`🚀 Running feature-start for feature ${featureNum} with agents: ${agentIds.join(', ')}`);
        const startArgv = [featureId, ...agentIds];
        const modelsCli = getOptionValue(options, 'models');
        const effortsCli = getOptionValue(options, 'efforts');
        if (modelsCli) startArgv.push(`--models=${String(modelsCli)}`);
        if (effortsCli) startArgv.push(`--efforts=${String(effortsCli)}`);
        await selfCommands['feature-start'](startArgv);

        try {
            existingWorktrees = filterByFeatureId(findWorktrees(), featureId);
        } catch (e) { /* ignore */ }

        if (existingWorktrees.length === 0) {
            console.error('❌ Feature setup failed — no worktrees created.');
            process.exitCode = 1;
            return;
        }
        agentIds = existingWorktrees.map(wt => wt.agent);
    }

    const isFleet = agentIds.length > 1;
    let effectiveStopAfter = stopAfter;
    if (isFleet && effectiveStopAfter === 'review') {
        console.error('❌ --stop-after=review is only supported in solo mode.');
        process.exitCode = 1;
        return;
    }
    if (!isFleet && effectiveStopAfter === 'eval') {
        console.log('ℹ️  Solo mode has no eval stage; treating --stop-after=eval as --stop-after=close.');
        effectiveStopAfter = 'close';
    }
    const evalAgent = isFleet ? (evalAgentOption || agentIds[0]) : null;
    if (isFleet && evalAgent && !availableAgents.includes(evalAgent)) {
        console.error(`❌ Unknown eval agent: ${evalAgent}. Available: ${availableAgents.join(', ')}`);
        process.exitCode = 1;
        return;
    }
    if (!isFleet && evalAgentOption) {
        console.log('ℹ️  --eval-agent is ignored in solo mode.');
    }
    // Review agent: solo-only
    const reviewAgent = !isFleet ? reviewAgentOption : null;
    if (isFleet && reviewAgentOption) {
        console.log('ℹ️  --review-agent is ignored in Fleet mode (Fleet has its own eval/close path).');
    }
    if (!isFleet && effectiveStopAfter === 'review' && !reviewAgent) {
        console.error('❌ --stop-after=review requires --review-agent to be set.');
        process.exitCode = 1;
        return;
    }
    if (!isFleet && reviewAgent && agentIds.includes(reviewAgent)) {
        console.log(`⚠️  Review agent (${reviewAgent}) is the same as implementing agent. Proceeding anyway.`);
    }

    try {
        assertTmuxAvailable();
    } catch (e) {
        console.error(`❌ ${e.message}\n   feature-autonomous-start requires tmux.`);
        process.exitCode = 1;
        return;
    }

    const existingAuto = findAutoSessionNameByFeatureId(assertTmuxAvailable, featureNum);
    if (existingAuto) {
        console.error(`❌ AutoConductor already running: ${existingAuto}`);
        console.error(`   Check status: aigon feature-autonomous-start status ${featureNum}`);
        process.exitCode = 1;
        return;
    }

    const autoSessionName = buildTmuxSessionName(featureNum, null, { role: 'auto', desc: featureDesc, repo: path.basename(mainRepo) });
    // REGRESSION: must be repo-root aigon-cli (one `..` from lib/). A second `..` points
    // outside the repo — the __run-loop process exits immediately and no review/close runs.
    const cliPath = path.join(__dirname, '..', 'aigon-cli.js');
    const loopCmdParts = [
        process.execPath, cliPath, 'feature-autonomous-start', '__run-loop', featureNum,
        `--agents=${agentIds.join(',')}`,
        `--stop-after=${effectiveStopAfter}`,
        `--session-name=${autoSessionName}`,
        '--poll-seconds=30'
    ];
    if (isFleet && evalAgent) loopCmdParts.push(`--eval-agent=${evalAgent}`);
    if (!isFleet && reviewAgent) loopCmdParts.push(`--review-agent=${reviewAgent}`);
    if (workflowSlug) loopCmdParts.push(`--workflow=${workflowSlug}`);
    const loopCmd = loopCmdParts.map(part => shellQuote(String(part))).join(' ');

    console.log(`🤖 AutoConductor config:`);
    console.log(`   feature: ${featureNum} | agents: ${agentIds.join(', ')} | stop-after: ${effectiveStopAfter}${isFleet && evalAgent ? ` | eval-agent: ${evalAgent}` : ''}${!isFleet && reviewAgent ? ` | review-agent: ${reviewAgent}` : ''}`);
    console.log(`   loop cmd: ${loopCmd}`);
    persistFeatureAutoState(mainRepo, featureNum, {
        status: 'starting',
        running: false,
        sessionName: autoSessionName,
        agents: agentIds,
        stopAfter: effectiveStopAfter,
        evalAgent,
        reviewAgent,
        workflowSlug,
        mode: isFleet ? 'fleet' : 'solo_worktree',
    });
    createDetachedTmuxSession(autoSessionName, mainRepo, loopCmd, {
        repoPath: mainRepo,
        entityType: 'f',
        entityId: featureNum,
        agent: null,
        role: 'auto',
        worktreePath: mainRepo,
    });
    persistFeatureAutoState(mainRepo, featureNum, {
        status: 'running',
        running: true,
        sessionName: autoSessionName,
        agents: agentIds,
        stopAfter: effectiveStopAfter,
        evalAgent,
        reviewAgent,
        workflowSlug,
        mode: isFleet ? 'fleet' : 'solo_worktree',
    });
    console.log(`✅ AutoConductor started: ${autoSessionName}`);
    console.log(`   Attach: tmux attach -t ${autoSessionName}`);
    console.log(`   Status: aigon feature-autonomous-start status ${featureNum}`);
}

module.exports = { run, implAgentReadyForAutonomousClose };
