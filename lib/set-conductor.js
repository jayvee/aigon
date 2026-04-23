'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const featureSets = require('./feature-sets');
const workflowSnapshotAdapter = require('./workflow-snapshot-adapter');
const { parseCliOptions, getOptionValue } = require('./cli-parse');
const { buildDependencyGraph, detectCycle } = require('./feature-dependencies');
const {
    readFeatureAutoState,
    readSetAutoState,
    writeSetAutoState,
    clearSetAutoState,
} = require('./auto-session-state');
const { assertProCapability } = require('./pro');
const {
    assertTmuxAvailable,
    createDetachedTmuxSession,
    runTmux,
    shellQuote,
} = require('./worktree');
const { sendNotification, isSupervisorNotificationsEnabled } = require('./supervisor');

const DEFAULT_POLL_SECONDS = 30;

function runAigonCliCommand(mainRepoPath, args) {
    const cliPath = path.join(__dirname, '..', 'aigon-cli.js');
    return spawnSync(process.execPath, [cliPath, ...args], {
        cwd: mainRepoPath,
        encoding: 'utf8',
        stdio: 'pipe',
    });
}

function appendUnique(list, value) {
    const next = Array.isArray(list) ? [...list] : [];
    if (!next.includes(value)) next.push(value);
    return next;
}

function sleepSeconds(seconds) {
    spawnSync('sleep', [String(seconds)], { stdio: 'ignore' });
}

function listTmuxSessions() {
    try {
        assertTmuxAvailable();
        const result = runTmux(['list-sessions', '-F', '#S'], { encoding: 'utf8', stdio: 'pipe' });
        if (result.error || result.status !== 0) return [];
        return String(result.stdout || '').split('\n').map(s => s.trim()).filter(Boolean);
    } catch (_) {
        return [];
    }
}

function buildSetAutoSessionName(repoName, setSlug) {
    return `${repoName}-s${setSlug}-auto`;
}

function buildSetRunLoopCommandArgs({ setSlug, mode, stopAfter, sessionName, reviewAgent, explicitAgents, pollSeconds = DEFAULT_POLL_SECONDS }) {
    const args = [
        'set-autonomous-start',
        '__run-loop',
        setSlug,
        `--mode=${mode}`,
        `--stop-after=${stopAfter}`,
        `--session-name=${sessionName}`,
        `--poll-seconds=${pollSeconds}`,
    ];
    const agentIds = normalizeAgentIds(explicitAgents);
    if (agentIds.length > 0) args.push(`--agents=${agentIds.join(',')}`);
    if (reviewAgent) args.push(`--review-agent=${reviewAgent}`);
    return args;
}

function findSetAutoSessionName(repoName, setSlug) {
    const expected = buildSetAutoSessionName(repoName, setSlug);
    const sessions = listTmuxSessions();
    return sessions.includes(expected) ? expected : null;
}

function isFeatureDone(mainRepoPath, featureId) {
    const snapshot = workflowSnapshotAdapter.readWorkflowSnapshotSync(mainRepoPath, 'feature', featureId);
    if (!snapshot) return false;
    const stage = String(snapshot.currentSpecState || snapshot.lifecycle || '').toLowerCase();
    return stage === 'done';
}

function topoSortSetMemberIds(memberIds, graph) {
    const memberIdSet = new Set(memberIds);
    const subGraph = new Map();
    for (const id of memberIds) {
        const deps = (graph.get(id) || []).filter(dep => memberIdSet.has(dep));
        subGraph.set(id, deps);
    }

    const cycle = detectCycle(subGraph);
    if (cycle) {
        throw new Error(`Dependency cycle inside set: ${cycle.join(' -> ')}`);
    }

    const indegree = new Map(memberIds.map(id => [id, 0]));
    const reverse = new Map();
    for (const [node, deps] of subGraph.entries()) {
        for (const dep of deps) {
            indegree.set(node, (indegree.get(node) || 0) + 1);
            if (!reverse.has(dep)) reverse.set(dep, []);
            reverse.get(dep).push(node);
        }
    }

    const ready = [...indegree.entries()]
        .filter(([, deg]) => deg === 0)
        .map(([id]) => id)
        .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    const order = [];
    while (ready.length > 0) {
        const node = ready.shift();
        order.push(node);
        for (const dependent of reverse.get(node) || []) {
            indegree.set(dependent, (indegree.get(dependent) || 0) - 1);
            if (indegree.get(dependent) === 0) {
                ready.push(dependent);
                ready.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
            }
        }
    }

    if (order.length !== memberIds.length) {
        throw new Error('Failed to resolve a complete topological order for set members.');
    }
    return order;
}

function resolveSetExecutionPlan(mainRepoPath, setSlug) {
    const paths = featureSets.featurePathsForRepo(mainRepoPath);
    const index = featureSets.scanFeatureSets(paths);
    const members = index.get(setSlug) || [];
    if (members.length === 0) {
        throw new Error(`No features tagged with set: ${setSlug}`);
    }

    const missingIds = members.filter(m => !m.paddedId);
    if (missingIds.length > 0) {
        const labels = missingIds.map(m => m.slug).join(', ');
        throw new Error(`Set members without numeric IDs must be prioritised first: ${labels}`);
    }

    const graph = buildDependencyGraph(paths);
    const memberIds = members.map(m => m.paddedId);
    const order = topoSortSetMemberIds(memberIds, graph);
    return {
        members,
        order,
    };
}

function computeRemainingOrder(order, completedIds, alreadyDoneIds = []) {
    const completed = new Set((Array.isArray(completedIds) ? completedIds : []).map(String));
    const done = new Set((Array.isArray(alreadyDoneIds) ? alreadyDoneIds : []).map(String));
    return (Array.isArray(order) ? order : []).filter(id => !completed.has(String(id)) && !done.has(String(id)));
}

function resolveFeatureAgents(mainRepoPath, featureId) {
    const auto = readFeatureAutoState(mainRepoPath, featureId);
    if (auto && Array.isArray(auto.agents) && auto.agents.length > 0) {
        return [...new Set(auto.agents.map(a => String(a).trim()).filter(Boolean))];
    }
    const snapshot = workflowSnapshotAdapter.readWorkflowSnapshotSync(mainRepoPath, 'feature', featureId);
    if (!snapshot) return [];
    const fromSnapshot = Object.keys(snapshot.agents || {}).sort((a, b) => a.localeCompare(b));
    if (fromSnapshot.length > 0) return fromSnapshot;
    if (snapshot.authorAgentId) return [String(snapshot.authorAgentId).trim()];
    return [];
}

function normalizeAgentIds(agentIds) {
    return [...new Set((Array.isArray(agentIds) ? agentIds : []).map(a => String(a || '').trim()).filter(Boolean))];
}

function startFeatureAutonomous(mainRepoPath, featureId, options) {
    const featureAuto = readFeatureAutoState(mainRepoPath, featureId);
    if (featureAuto && featureAuto.running) {
        return { attached: true };
    }

    const explicitAgents = normalizeAgentIds(options && options.agentIds);
    const agents = explicitAgents.length > 0 ? explicitAgents : resolveFeatureAgents(mainRepoPath, featureId);
    if (agents.length === 0) {
        throw new Error(`Cannot resolve agents for feature ${featureId}. Pass agents to set-autonomous-start or start this feature once first.`);
    }

    const args = ['feature-autonomous-start', featureId, ...agents];
    if (options.reviewAgent) args.push(`--review-agent=${options.reviewAgent}`);
    if (options.stopAfter) args.push(`--stop-after=${options.stopAfter}`);
    const result = runAigonCliCommand(mainRepoPath, args);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error || result.status !== 0) {
        throw new Error(`feature-autonomous-start failed for feature ${featureId}`);
    }
    return { attached: false };
}

function waitForFeatureAutonomousResult(mainRepoPath, featureId, pollSeconds) {
    for (;;) {
        if (isFeatureDone(mainRepoPath, featureId)) {
            return { status: 'done', reason: 'feature-done' };
        }
        const featureAuto = readFeatureAutoState(mainRepoPath, featureId);
        const state = String(featureAuto && featureAuto.status || '').toLowerCase();
        if (state === 'completed' || state === 'done') {
            return { status: 'done', reason: featureAuto.reason || state };
        }
        if (state === 'failed') {
            return { status: 'failed', reason: featureAuto.reason || 'feature-auto-failed' };
        }
        sleepSeconds(pollSeconds);
    }
}

async function persistSetState(mainRepoPath, setSlug, patch) {
    return writeSetAutoState(mainRepoPath, setSlug, patch);
}

function buildPauseNotificationMessage(setSlug, featureId, order) {
    const numericId = parseInt(featureId, 10);
    const featureLabel = `feature #${Number.isNaN(numericId) ? featureId : numericId}`;
    return `Set \`${setSlug}\` paused at ${featureLabel} — review failed. Run \`aigon set-autonomous-resume ${setSlug}\` to continue after fix.`;
}

// Keep the tmux session alive while paused so the user can attach and inspect.
// Exits when the state is cleared (reset) or changed away from paused-on-failure.
function waitWhilePaused(mainRepoPath, setSlug) {
    console.log('\n⏸  SetConductor paused — session kept alive for inspection.');
    console.log(`   Run: aigon set-autonomous-resume ${setSlug}   (after fixing the failing feature)`);
    console.log(`   Run: aigon set-autonomous-reset ${setSlug}    (to discard and clear state)\n`);
    for (;;) {
        sleepSeconds(30);
        const state = readSetAutoState(mainRepoPath, setSlug);
        if (!state || state.status !== 'paused-on-failure') break;
    }
}

function notifySetPausedOnFailure(setSlug, featureId, order) {
    try {
        if (!isSupervisorNotificationsEnabled()) return;
        const message = buildPauseNotificationMessage(setSlug, featureId, order);
        sendNotification(message, 'Aigon Set Paused');
    } catch (_) {
        // non-fatal
    }
}

async function runLoop(rawArgs, mainRepoPath) {
    const options = parseCliOptions(rawArgs || []);
    const setSlug = String(options._[1] || '').trim();
    const explicitAgents = normalizeAgentIds(String(getOptionValue(options, 'agents') || '').split(','));
    const mode = String(getOptionValue(options, 'mode') || 'sequential').trim();
    const reviewAgent = String(getOptionValue(options, 'review-agent') || '').trim() || null;
    const stopAfter = String(getOptionValue(options, 'stop-after') || 'close').trim();
    const sessionName = String(getOptionValue(options, 'session-name') || '').trim() || null;
    const pollSeconds = Math.max(5, parseInt(String(getOptionValue(options, 'poll-seconds') || DEFAULT_POLL_SECONDS), 10) || DEFAULT_POLL_SECONDS);
    if (!featureSets.isValidSetSlug(setSlug)) {
        console.error('Usage: aigon set-autonomous-start __run-loop <slug> --mode=sequential [--review-agent=<agent>] [--stop-after=close]');
        process.exitCode = 1;
        return;
    }
    if (mode !== 'sequential') {
        console.error(`❌ Unsupported mode: ${mode}. Only --mode=sequential is available.`);
        process.exitCode = 1;
        return;
    }
    if (stopAfter !== 'close') {
        console.error(`❌ Unsupported --stop-after=${stopAfter}. Only --stop-after=close is available.`);
        process.exitCode = 1;
        return;
    }
    if (!assertProCapability('Autonomous set orchestration', 'aigon set list')) {
        process.exitCode = 1;
        return;
    }

    const { members, order } = resolveSetExecutionPlan(mainRepoPath, setSlug);
    const existing = readSetAutoState(mainRepoPath, setSlug) || {};
    let completed = new Set((Array.isArray(existing.completed) ? existing.completed : []).map(String));
    let failed = Array.isArray(existing.failed) ? existing.failed.map(String) : [];
    let currentFeature = null;

    await persistSetState(mainRepoPath, setSlug, {
        setSlug,
        members: members.map(m => m.paddedId),
        order: [...order],
        agents: explicitAgents,
        currentFeature: null,
        completed: [...completed],
        failed,
        status: 'running',
        running: true,
        mode,
        reviewAgent,
        stopAfter,
        sessionName,
    });

    try {
        console.log(`🤖 SetConductor started for set "${setSlug}"`);
        console.log(`   mode: ${mode} | stop-after: ${stopAfter} | poll: ${pollSeconds}s${explicitAgents.length > 0 ? ` | agents: ${explicitAgents.join(', ')}` : ''}`);
        for (const featureId of order) {
            if (completed.has(featureId)) {
                continue;
            }
            if (isFeatureDone(mainRepoPath, featureId)) {
                completed.add(featureId);
                await persistSetState(mainRepoPath, setSlug, {
                    currentFeature: null,
                    completed: [...completed],
                    failed,
                    status: 'running',
                    running: true,
                });
                continue;
            }

            currentFeature = featureId;
            await persistSetState(mainRepoPath, setSlug, {
                currentFeature,
                completed: [...completed],
                failed,
                status: 'running',
                running: true,
            });

            try {
                startFeatureAutonomous(mainRepoPath, featureId, { agentIds: explicitAgents, reviewAgent, stopAfter });
            } catch (error) {
                failed = appendUnique(failed, featureId);
                await persistSetState(mainRepoPath, setSlug, {
                    currentFeature,
                    completed: [...completed],
                    failed,
                    failedFeature: featureId,
                    status: 'paused-on-failure',
                    running: false,
                    endedAt: new Date().toISOString(),
                    reason: error.message,
                });
                notifySetPausedOnFailure(setSlug, featureId, order);
                waitWhilePaused(mainRepoPath, setSlug);
                return;
            }

            const result = waitForFeatureAutonomousResult(mainRepoPath, featureId, pollSeconds);
            if (result.status === 'failed') {
                failed = appendUnique(failed, featureId);
                await persistSetState(mainRepoPath, setSlug, {
                    currentFeature,
                    completed: [...completed],
                    failed,
                    failedFeature: featureId,
                    status: 'paused-on-failure',
                    running: false,
                    endedAt: new Date().toISOString(),
                    reason: result.reason,
                });
                notifySetPausedOnFailure(setSlug, featureId, order);
                waitWhilePaused(mainRepoPath, setSlug);
                return;
            }

            completed.add(featureId);
            await persistSetState(mainRepoPath, setSlug, {
                currentFeature: null,
                completed: [...completed],
                failed,
                status: 'running',
                running: true,
            });
        }

        await persistSetState(mainRepoPath, setSlug, {
            currentFeature: null,
            completed: [...completed],
            failed,
            status: 'done',
            running: false,
            endedAt: new Date().toISOString(),
        });

        if (sessionName) {
            runTmux(['kill-session', '-t', sessionName], { stdio: 'ignore' });
        }
    } catch (error) {
        await persistSetState(mainRepoPath, setSlug, {
            currentFeature,
            completed: [...completed],
            failed,
            failedFeature: currentFeature,
            status: 'paused-on-failure',
            running: false,
            endedAt: new Date().toISOString(),
            reason: error.message,
        });
        if (currentFeature) notifySetPausedOnFailure(setSlug, currentFeature, order);
        waitWhilePaused(mainRepoPath, setSlug);
    }
}

async function start(rawArgs, mainRepoPath, options = {}) {
    const cliOptions = parseCliOptions(rawArgs || []);
    if (cliOptions._[0] === '__run-loop') {
        return runLoop(rawArgs, mainRepoPath);
    }
    const setSlug = String(cliOptions._[0] || '').trim();
    const explicitAgents = normalizeAgentIds(cliOptions._.slice(1));
    const mode = String(getOptionValue(cliOptions, 'mode') || 'sequential').trim();
    const reviewAgent = String(getOptionValue(cliOptions, 'review-agent') || '').trim() || null;
    const stopAfter = String(getOptionValue(cliOptions, 'stop-after') || 'close').trim();
    if (!setSlug) {
        console.error('Usage: aigon set-autonomous-start <slug> [agents...] [--mode=sequential] [--review-agent=<agent>] [--stop-after=close]');
        process.exitCode = 1;
        return;
    }
    if (!featureSets.isValidSetSlug(setSlug)) {
        console.error(`❌ Invalid set slug: "${setSlug}"`);
        process.exitCode = 1;
        return;
    }
    if (mode !== 'sequential') {
        console.error(`❌ Unsupported mode: ${mode}. Only --mode=sequential is available.`);
        process.exitCode = 1;
        return;
    }
    if (stopAfter !== 'close') {
        console.error(`❌ Unsupported --stop-after=${stopAfter}. Only --stop-after=close is available.`);
        process.exitCode = 1;
        return;
    }
    if (!assertProCapability('Autonomous set orchestration', 'aigon set list')) {
        process.exitCode = 1;
        return;
    }
    assertTmuxAvailable();

    // Fail fast on topology/cycle issues before spawning the detached loop.
    const plan = resolveSetExecutionPlan(mainRepoPath, setSlug);
    const repoName = path.basename(mainRepoPath);
    const sessionName = buildSetAutoSessionName(repoName, setSlug);
    const existingSession = findSetAutoSessionName(repoName, setSlug);
    const existing = readSetAutoState(mainRepoPath, setSlug);
    if (options.resumeOnly && !existing) {
        console.error(`❌ No paused/stopped run found for set: ${setSlug}`);
        process.exitCode = 1;
        return;
    }
    if (existing && existing.status === 'done') {
        console.log(`✅ Set "${setSlug}" is already done.`);
        return;
    }

    // On resume: kill the paused-on-failure session (which is alive in a wait loop)
    // before spawning a fresh run-loop session.
    if (existingSession && existing && existing.status === 'paused-on-failure') {
        runTmux(['kill-session', '-t', existingSession], { stdio: 'ignore' });
        console.log(`   Killed paused session: ${existingSession}`);
    } else if (existingSession) {
        console.error(`❌ SetConductor already running: ${existingSession}`);
        process.exitCode = 1;
        return;
    }

    const cliPath = path.join(__dirname, '..', 'aigon-cli.js');
    const cmdParts = [
        process.execPath,
        cliPath,
        ...buildSetRunLoopCommandArgs({
            setSlug,
            mode,
            stopAfter,
            sessionName,
            reviewAgent,
            explicitAgents,
        }),
    ];
    const loopCmd = cmdParts.map(v => shellQuote(String(v))).join(' ');

    await persistSetState(mainRepoPath, setSlug, {
        setSlug,
        members: plan.members.map(m => m.paddedId),
        order: [...plan.order],
        agents: explicitAgents,
        currentFeature: existing && existing.currentFeature ? existing.currentFeature : null,
        completed: Array.isArray(existing && existing.completed) ? existing.completed : [],
        failed: Array.isArray(existing && existing.failed) ? existing.failed : [],
        status: 'starting',
        running: false,
        mode,
        reviewAgent,
        stopAfter,
        sessionName,
    });

    createDetachedTmuxSession(sessionName, mainRepoPath, loopCmd, {
        repoPath: mainRepoPath,
        worktreePath: mainRepoPath,
        role: 'auto',
    });

    await persistSetState(mainRepoPath, setSlug, {
        status: 'running',
        running: true,
        sessionName,
        agents: explicitAgents,
        mode,
        reviewAgent,
        stopAfter,
    });

    console.log(`✅ SetConductor started: ${sessionName}`);
    console.log(`   Attach: tmux attach -t ${sessionName}`);
    if (explicitAgents.length > 0) console.log(`   Agents: ${explicitAgents.join(', ')}`);
}

async function stop(rawArgs, mainRepoPath) {
    const options = parseCliOptions(rawArgs || []);
    const setSlug = String(options._[0] || '').trim();
    if (!setSlug) {
        console.error('Usage: aigon set-autonomous-stop <slug>');
        process.exitCode = 1;
        return;
    }
    if (!featureSets.isValidSetSlug(setSlug)) {
        console.error(`❌ Invalid set slug: "${setSlug}"`);
        process.exitCode = 1;
        return;
    }
    const repoName = path.basename(mainRepoPath);
    const sessionName = findSetAutoSessionName(repoName, setSlug);
    if (sessionName) {
        runTmux(['kill-session', '-t', sessionName], { stdio: 'ignore' });
    }
    const existing = readSetAutoState(mainRepoPath, setSlug);
    if (!existing && !sessionName) {
        console.log(`No running or persisted set-auto state for "${setSlug}".`);
        return;
    }
    await persistSetState(mainRepoPath, setSlug, {
        status: 'stopped',
        running: false,
        endedAt: new Date().toISOString(),
        reason: 'stopped-by-user',
        currentFeature: null,
    });
    console.log(`✅ Stopped set autonomous run: ${setSlug}`);
}

async function reset(rawArgs, mainRepoPath) {
    const options = parseCliOptions(rawArgs || []);
    const setSlug = String(options._[0] || '').trim();
    if (!setSlug) {
        console.error('Usage: aigon set-autonomous-reset <slug>');
        process.exitCode = 1;
        return;
    }
    if (!featureSets.isValidSetSlug(setSlug)) {
        console.error(`❌ Invalid set slug: "${setSlug}"`);
        process.exitCode = 1;
        return;
    }
    const repoName = path.basename(mainRepoPath);
    const sessionName = findSetAutoSessionName(repoName, setSlug);
    if (sessionName) runTmux(['kill-session', '-t', sessionName], { stdio: 'ignore' });
    await clearSetAutoState(mainRepoPath, setSlug);
    console.log(`✅ Reset set autonomous state: ${setSlug}`);
}

async function run(commandName, args, deps = {}) {
    const mainRepoPath = deps.mainRepoPath || process.cwd();
    if (commandName === 'set-autonomous-start') return start(args, mainRepoPath);
    if (commandName === 'set-autonomous-resume') return start(args, mainRepoPath, { resumeOnly: true });
    if (commandName === 'set-autonomous-stop') return stop(args, mainRepoPath);
    if (commandName === 'set-autonomous-reset') return reset(args, mainRepoPath);
}

module.exports = {
    run,
    buildSetAutoSessionName,
    buildSetRunLoopCommandArgs,
    resolveSetExecutionPlan,
    topoSortSetMemberIds,
    computeRemainingOrder,
    buildPauseNotificationMessage,
    startFeatureAutonomous,
};
