'use strict';

// Bulk entity session ensure/close helpers (F632). Behaviour unchanged from worktree.js.

const { spawnSync } = require('child_process');
const { toUnpaddedId, parseTmuxSessionName } = require('./names');
const { runTmux, tmuxSessionExists } = require('./hosts/tmux-exec');
const { createDetachedTmuxSession } = require('./hosts/tmux-lifecycle');

function ensureAgentSessions(entityId, agents, options) {
    const {
        sessionNameBuilder,
        cwdBuilder,
        commandBuilder,
        restartExisting = false,
        sessionMetaBuilder,
    } = options;

    return agents.map(agent => {
        const sessionName = sessionNameBuilder(entityId, agent);
        const command = commandBuilder ? commandBuilder(entityId, agent) : null;
        const cwd = cwdBuilder(entityId, agent);
        const meta = sessionMetaBuilder ? sessionMetaBuilder(sessionName, entityId, agent, cwd) : null;
        if (tmuxSessionExists(sessionName)) {
            if (restartExisting) {
                try { runTmux(['kill-session', '-t', sessionName], { stdio: 'ignore' }); } catch (_) { /* ignore */ }
                try {
                    createDetachedTmuxSession(sessionName, cwd, command, meta);
                    return { agent, sessionName, created: true, restarted: true, error: null };
                } catch (error) {
                    return { agent, sessionName, created: false, restarted: true, error };
                }
            }
            return { agent, sessionName, created: false, error: null };
        }
        try {
            createDetachedTmuxSession(sessionName, cwd, command, meta);
            return { agent, sessionName, created: true, error: null };
        } catch (error) {
            return { agent, sessionName, created: false, error };
        }
    });
}

function gracefullyCloseEntitySessions(entityId, entityType, options = {}) {
    const gracePeriodMs = options.gracePeriodMs || 4000;
    const currentSession = (() => {
        if (!process.env.TMUX) return null;
        const paneId = process.env.TMUX_PANE;
        const args = paneId
            ? ['display-message', '-t', paneId, '-p', '#{session_name}']
            : ['display-message', '-p', '#{session_name}'];
        const r = runTmux(args, { encoding: 'utf8', stdio: 'pipe' });
        if (r.error || r.status !== 0) return null;
        return String(r.stdout || '').trim() || null;
    })();

    function findMatchingSessions() {
        const list = runTmux(['list-sessions', '-F', '#{session_name}'], { encoding: 'utf8', stdio: 'pipe' });
        if (list.error || list.status !== 0) return [];
        return list.stdout
            .split('\n')
            .map(s => s.trim())
            .filter(Boolean)
            .filter(s => {
                if (currentSession && s === currentSession) return false;
                const parsed = parseTmuxSessionName(s);
                return parsed && parsed.type === entityType && toUnpaddedId(parsed.id) === toUnpaddedId(entityId);
            });
    }

    const matching = findMatchingSessions();
    if (matching.length === 0) return { closed: 0 };

    if (options.repoPath) {
        try {
            const telemetry = require('../telemetry');
            matching.forEach(sessionName => {
                const parsed = parseTmuxSessionName(sessionName);
                if (!parsed || parsed.agent !== 'cc') return;
                telemetry.findTranscriptFiles(entityId, options.featureDesc || '', {
                    agentId: 'cc',
                    repoPath: options.repoPath,
                });
            });
        } catch (_) { /* telemetry is best-effort */ }
    }

    matching.forEach(sessionName => {
        runTmux(['send-keys', '-t', sessionName, 'C-c'], { stdio: 'ignore' });
    });

    const deadline = Date.now() + gracePeriodMs;
    while (Date.now() < deadline) {
        const stillAlive = matching.filter(s => tmuxSessionExists(s));
        if (stillAlive.length === 0) break;
        spawnSync('sleep', ['0.5'], { stdio: 'ignore' });
    }

    let closed = 0;
    matching.forEach(sessionName => {
        if (!tmuxSessionExists(sessionName)) {
            closed++;
            return;
        }
        const kill = runTmux(['kill-session', '-t', sessionName], { stdio: 'ignore' });
        if (!kill.error && kill.status === 0) closed++;
    });

    const survivors = findMatchingSessions();
    survivors.forEach(sessionName => {
        const kill = runTmux(['kill-session', '-t', sessionName], { stdio: 'ignore' });
        if (!kill.error && kill.status === 0) closed++;
    });

    const remaining = findMatchingSessions();
    return { closed, sessions: matching, remaining };
}

module.exports = {
    ensureAgentSessions,
    gracefullyCloseEntitySessions,
};
