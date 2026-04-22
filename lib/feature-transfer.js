'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const wf = require('./workflow-core');
const { getSnapshotPath } = require('./workflow-core/paths');
const { listWorktrees, filterWorktreesByFeature } = require('./git');
const {
    matchTmuxSessionByEntityId,
    buildAgentCommand,
    buildTmuxSessionName,
    ensureAgentSessions,
} = require('./worktree');

function sh(cmd, opts = {}) {
    return execSync(cmd, { stdio: 'pipe', encoding: 'utf8', ...opts });
}

function capturePaneContent(sessionName) {
    try {
        return execSync(`tmux capture-pane -t '${sessionName}' -p -S -3000`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    } catch (_) {
        return '';
    }
}

function findFeatureTmuxSessions(featureId) {
    const paddedId = String(parseInt(featureId, 10)).padStart(2, '0');
    let out;
    try { out = execSync('tmux ls', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }); }
    catch (_) { return []; }
    return out.split('\n')
        .map(line => (line.match(/^([^:]+):/) || [])[1])
        .filter(Boolean)
        .filter(name => {
            const parsed = matchTmuxSessionByEntityId(name, 'feature', paddedId);
            return !!parsed || name.includes(`f${paddedId}-`) || name.includes(`f${parseInt(featureId, 10)}-`);
        });
}

async function transferFeature(repoPath, featureId, toAgent, options = {}) {
    const log = (...args) => (options.silent ? null : console.log(...args));

    // 1. Validate inputs
    const worktrees = filterWorktreesByFeature(listWorktrees(repoPath), featureId);
    if (worktrees.length === 0) throw new Error(`No worktree found for feature ${featureId}`);
    if (worktrees.length > 1) {
        throw new Error(`Feature ${featureId} has ${worktrees.length} worktrees — transfer requires exactly one (fleet mode not supported yet)`);
    }
    const oldWt = worktrees[0];
    if (oldWt.agent === toAgent) {
        log(`ℹ️  Feature ${featureId} is already assigned to ${toAgent} — nothing to do.`);
        return { skipped: true };
    }

    const snapshotPath = getSnapshotPath(repoPath, featureId);
    if (!fs.existsSync(snapshotPath)) {
        throw new Error(`No workflow snapshot at ${snapshotPath} — feature may not be started`);
    }
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    if (snapshot.lifecycle === 'done' || snapshot.lifecycle === 'closed') {
        throw new Error(`Feature ${featureId} is already ${snapshot.lifecycle} — nothing to transfer`);
    }
    const mode = snapshot.mode || 'solo_worktree';

    const newDirName = `feature-${featureId}-${toAgent}-${oldWt.desc}`;
    const newPath = path.join(path.dirname(oldWt.path), newDirName);
    if (fs.existsSync(newPath)) throw new Error(`Target path already exists: ${newPath}`);

    log(`\n🔄 Transferring feature ${featureId}: ${oldWt.agent} → ${toAgent}`);
    log(`   from: ${oldWt.path}`);
    log(`   to:   ${newPath}`);

    // 2. Capture pane output from every live session before we kill anything.
    const sessions = findFeatureTmuxSessions(featureId);
    const paneDumps = {};
    sessions.forEach(s => {
        const content = capturePaneContent(s);
        if (content) paneDumps[s] = content;
    });
    log(`   captured ${Object.keys(paneDumps).length} tmux pane(s)`);

    // 3. Write the transfer briefing for the receiving agent.
    const ts = new Date().toISOString();
    const tsSlug = ts.replace(/[:.]/g, '-');
    const logsDir = path.join(repoPath, 'docs', 'specs', 'features', 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const briefPath = path.join(logsDir, `feature-${featureId}-transfer-${tsSlug}.md`);

    let lastCommits = '';
    try { lastCommits = sh(`git -C '${oldWt.path}' log --oneline -5`).trim(); } catch (_) {}
    let uncommittedStatus = '';
    try { uncommittedStatus = sh(`git -C '${oldWt.path}' status --short`).trim(); } catch (_) {}
    let uncommittedDiff = '';
    try { uncommittedDiff = sh(`git -C '${oldWt.path}' diff --stat`).trim(); } catch (_) {}

    const briefing = [
        `# Transfer briefing — feature ${featureId}`,
        '',
        `- **From:** ${oldWt.agent}`,
        `- **To:** ${toAgent}`,
        `- **At:** ${ts}`,
        `- **Reason:** ${options.reason || 'manual transfer'}`,
        `- **Worktree moved to:** ${newPath}`,
        '',
        '## Last 5 commits on the branch',
        '```',
        lastCommits || '(none)',
        '```',
        '',
        '## Uncommitted changes at transfer time (auto-committed as `wip(transfer): …`)',
        '```',
        uncommittedStatus || '(none)',
        '```',
        '',
        uncommittedDiff ? '## Diff stat\n```\n' + uncommittedDiff + '\n```\n' : '',
        '## Previous agent terminal output',
        'The old agent was not able to complete the implementation. The most likely reason is visible at the tail of the pane dump(s) below (e.g. token/usage limits, auth prompts, errors). Read these before resuming so you understand where the previous agent stopped.',
        '',
        ...Object.entries(paneDumps).flatMap(([name, content]) => [
            `### tmux \`${name}\``,
            '```',
            content.trimEnd().split('\n').slice(-120).join('\n'),
            '```',
            '',
        ]),
        '## What to do now',
        `1. Read the spec: \`aigon feature-spec ${featureId}\``,
        '2. Inspect the `wip(transfer)` commit to see the previous agent\'s in-flight work: `git show HEAD`',
        '3. Continue the implementation. Do **not** restart from scratch.',
        `4. When finished: \`aigon agent-status submitted\``,
        '',
    ].filter(Boolean).join('\n');
    fs.writeFileSync(briefPath, briefing);
    log(`   briefing: ${briefPath}`);

    // 4. Preserve in-flight work as a commit so nothing is lost by the move.
    try {
        const status = sh(`git -C '${oldWt.path}' status --porcelain`);
        if (status.trim()) {
            sh(`git -C '${oldWt.path}' add -A`);
            sh(`git -C '${oldWt.path}' commit -m "wip(transfer): save ${oldWt.agent} state before handoff to ${toAgent}"`);
            log(`   committed uncommitted work`);
        } else {
            log(`   no uncommitted work`);
        }
    } catch (err) {
        log(`   ⚠️  commit step failed (continuing): ${err.message}`);
    }

    // 5. Kill old agent tmux sessions so nothing holds the directory open.
    sessions.forEach(s => {
        try { execSync(`tmux kill-session -t '${s}'`, { stdio: 'pipe' }); } catch (_) {}
    });
    log(`   killed ${sessions.length} tmux session(s)`);

    // 5b. Remove stale heartbeat file for the old agent
    const oldHbPath = path.join(repoPath, '.aigon', 'state', `heartbeat-${featureId}-${oldWt.agent}`);
    try { fs.unlinkSync(oldHbPath); } catch (_) { /* missing ok */ }

    // 6. Move the worktree directory. git worktree move also updates .git/worktrees metadata.
    sh(`git -C '${repoPath}' worktree move '${oldWt.path}' '${newPath}'`, { stdio: 'inherit' });
    log(`   worktree moved`);

    // 7. Re-seed the workflow engine: emit a fresh feature.started event so the
    //    projector rebuilds the agents map with the new agent. Existing history
    //    stays in events.jsonl; the projector's feature.started handler fully
    //    rewrites context.agents.
    await wf.startFeature(repoPath, featureId, mode, [toAgent]);
    log(`   workflow state re-seeded (feature.started → agents=[${toAgent}])`);

    // 8. Move the state file, if any.
    const stateDir = path.join(repoPath, '.aigon', 'state');
    const oldState = path.join(stateDir, `feature-${featureId}-${oldWt.agent}.json`);
    const newState = path.join(stateDir, `feature-${featureId}-${toAgent}.json`);
    try {
        if (fs.existsSync(oldState)) {
            const raw = JSON.parse(fs.readFileSync(oldState, 'utf8'));
            raw.agent = toAgent;
            raw.transferredFrom = oldWt.agent;
            raw.transferredAt = ts;
            fs.writeFileSync(newState, JSON.stringify(raw, null, 2));
            fs.unlinkSync(oldState);
        }
    } catch (err) {
        log(`   ⚠️  state file migration failed (continuing): ${err.message}`);
    }

    // 9. Move the autonomous-session state so the orchestrator references the new agent.
    const autoState = path.join(stateDir, `feature-${featureId}-auto.json`);
    try {
        if (fs.existsSync(autoState)) {
            const raw = JSON.parse(fs.readFileSync(autoState, 'utf8'));
            if (Array.isArray(raw.agents)) {
                raw.agents = raw.agents.map(a => (a === oldWt.agent ? toAgent : a));
            }
            raw.transferredFrom = oldWt.agent;
            raw.transferredAt = ts;
            fs.writeFileSync(autoState, JSON.stringify(raw, null, 2));
        }
    } catch (_) { /* non-fatal */ }

    // 10. Spawn the new agent's tmux session inside the moved worktree.
    let launchResult = null;
    if (options.launch !== false) {
        try {
            const desc = oldWt.desc;
            const sessionResults = ensureAgentSessions(featureId, [toAgent], {
                sessionNameBuilder: (fId, agent) => buildTmuxSessionName(fId, agent, { desc, role: 'do' }),
                cwdBuilder: () => newPath,
                commandBuilder: (fId, agent) => buildAgentCommand({
                    featureId: fId,
                    agent,
                    path: newPath,
                    desc,
                    repoPath,
                }),
                sessionMetaBuilder: (sessionName, fId, agent, cwd) => ({
                    repoPath: path.resolve(repoPath),
                    entityType: 'f',
                    entityId: fId,
                    agent,
                    role: 'do',
                    worktreePath: path.resolve(cwd),
                }),
                restartExisting: true,
            });
            launchResult = sessionResults[0] || null;
            if (launchResult && launchResult.error) {
                log(`   ⚠️  Could not spawn tmux session ${launchResult.sessionName}: ${launchResult.error.message}`);
            } else if (launchResult) {
                log(`   🧵 tmux: ${launchResult.sessionName} (spawned)`);
            }
        } catch (err) {
            log(`   ⚠️  Launch step failed (worktree is ready, just re-run feature-open): ${err.message}`);
        }
    }

    log(`\n✅ Transfer complete.`);
    if (launchResult && launchResult.sessionName && !launchResult.error) {
        log(`   attach: tmux attach -t ${launchResult.sessionName}`);
        log(`           or: aigon feature-open ${featureId} ${toAgent}`);
    } else {
        log(`   launch manually: aigon feature-open ${featureId} ${toAgent}`);
    }
    log(`   briefing:  ${path.relative(repoPath, briefPath)}`);

    return {
        featureId,
        fromAgent: oldWt.agent,
        toAgent,
        oldPath: oldWt.path,
        newPath,
        briefPath,
        killedSessions: sessions,
        launchedSession: launchResult && !launchResult.error ? launchResult.sessionName : null,
    };
}

module.exports = { transferFeature };
