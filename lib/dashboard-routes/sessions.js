'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { getDefaultAgent, getAgentCliConfig } = require('../config');
const agentRegistry = require('../agent-registry');
const {
    matchTmuxSessionByEntityId,
    tmuxSessionExists,
    createDetachedTmuxSession,
    getEnrichedSessions,
    runTmux,
    openTerminalAppWithCommand,
    shellQuote,
    toUnpaddedId,
} = require('../worktree');
const { findFirstTmuxSessionByPrefix } = require('../dashboard-status-helpers');
const { mintPtyToken } = require('../pty-session-handler');

module.exports = [
    {
        method: 'POST',
        path: '/api/attach',
        handler(req, res, ctx) {
            ctx.readJsonBody().then(payload => {
                const featureId = String(payload.featureId || '').trim();
                const agentId = String(payload.agentId || '').trim();
                const repoPath = String(payload.repoPath || '').trim();
                const requestedSession = String(payload.tmuxSession || '').trim();
                if (!featureId || !agentId || agentId === 'solo') {
                    ctx.sendJson(400, { error: 'featureId and non-solo agentId are required' });
                    return;
                }

                let tmuxInfo = null;
                if (requestedSession) {
                    const match = matchTmuxSessionByEntityId(requestedSession, featureId);
                    if (!match || match.type !== 'f' || match.agent !== agentId) {
                        ctx.sendJson(400, { error: 'tmuxSession does not match featureId/agentId' });
                        return;
                    }
                    tmuxInfo = {
                        sessionName: requestedSession,
                        running: tmuxSessionExists(requestedSession)
                    };
                } else {
                    tmuxInfo = ctx.routes.safeTmuxSessionExists(featureId, agentId);
                }
                if (!tmuxInfo || !tmuxInfo.running) {
                    ctx.sendJson(409, { error: `tmux session not running for F${featureId} ${agentId}` });
                    return;
                }
                const sessionName = tmuxInfo.sessionName;

                try {
                    openTerminalAppWithCommand(repoPath || process.cwd(), `tmux attach -t ${shellQuote(sessionName)}`, sessionName);
                    ctx.sendJson(200, { ok: true, message: `Attached to ${sessionName}`, command: `tmux attach -t ${sessionName}` });
                } catch (e) {
                    ctx.sendJson(500, { error: `Failed to open terminal: ${e.message}` });
                }
            }).catch(() => ctx.sendJson(400, { error: 'Invalid JSON body' }));
        }
    },
    {
        method: 'POST',
        path: '/api/session/ask',
        handler(req, res, ctx) {
            ctx.readJsonBody().then(payload => {
                const repoPath = String(payload.repoPath || '').trim();
                const prompt = String(payload.prompt || payload.message || '').trim();
                if (!repoPath) {
                    ctx.sendJson(400, { error: 'repoPath is required' });
                    return;
                }
                try {
                    const absRepo = path.resolve(repoPath);
                    const agentId = String(payload.agentId || getDefaultAgent(absRepo)).trim();
                    const repoName = path.basename(absRepo);
                    const sessionName = `ask-${repoName}-${agentId}`;
                    const cliConfig = getAgentCliConfig(agentId, absRepo);
                    const agentBin = cliConfig.command || agentId;
                    const flags = cliConfig.implementFlag || '';
                    const promptFlagToken = agentRegistry.getPromptFlag(agentId) || '';
                    const promptArg = prompt ? ' ' + (promptFlagToken ? `${promptFlagToken} ` : '') + shellQuote(prompt) : '';
                    const agentCmd = flags ? `${agentBin} ${flags}${promptArg}` : `${agentBin}${promptArg}`;
                    if (tmuxSessionExists(sessionName)) {
                        if (prompt) {
                            runTmux(['send-keys', '-t', sessionName, '-l', prompt], { stdio: 'ignore' });
                            runTmux(['send-keys', '-t', sessionName, 'Enter'], { stdio: 'ignore' });
                        }
                        openTerminalAppWithCommand(absRepo, `tmux attach -t ${shellQuote(sessionName)}`, sessionName);
                        ctx.sendJson(200, { ok: true, message: `Attached to existing session ${sessionName}`, sessionName });
                    } else {
                        createDetachedTmuxSession(sessionName, absRepo, agentCmd, {
                            category: 'repo',
                            repoPath: absRepo,
                            agent: agentId,
                            worktreePath: absRepo,
                        });
                        openTerminalAppWithCommand(absRepo, `tmux attach -t ${shellQuote(sessionName)}`, sessionName);
                        ctx.sendJson(200, { ok: true, message: `Started ask session for ${repoName} (${agentId})`, sessionName });
                    }
                } catch (e) {
                    ctx.sendJson(500, { error: `Failed to start ask session: ${e.message}` });
                }
            }).catch(() => ctx.sendJson(400, { error: 'Invalid JSON body' }));
        }
    },
    {
        method: 'GET',
        path: '/api/supervisor/status',
        handler(req, res, ctx) {
            const supervisorStatus = typeof ctx.options.getSupervisorStatus === 'function'
                ? ctx.options.getSupervisorStatus()
                : { running: false, lastSweepAt: null, sweepCount: 0 };
            ctx.sendJson(200, supervisorStatus);
        }
    },
    {
        method: 'GET',
        path: '/api/sessions',
        handler(req, res, ctx) {
            try {
                const enriched = getEnrichedSessions();
                const repos = ctx.routes.readConductorReposFromGlobalConfig().map(r => path.resolve(r));
                ctx.sendJson(200, { ...enriched, repos });
            } catch (e) {
                ctx.sendJson(200, { sessions: [], orphanCount: 0, error: e.message });
            }
        }
    },
    {
        method: 'POST',
        path: '/api/session/run',
        handler(req, res, ctx) {
            ctx.readJsonBody().then(payload => {
                const command = String(payload.command || '').trim();
                const cwd = String(payload.cwd || '').trim() || process.cwd();
                if (!command) {
                    ctx.sendJson(400, { error: 'command is required' });
                    return;
                }
                try {
                    const effectiveCwd = fs.existsSync(cwd) ? cwd : process.cwd();
                    const sessionStartTime = Date.now();
                    const resolved = ctx.routes.resolveDashboardSessionCommand(command);
                    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
                    const result = spawnSync(resolved.bin, resolved.args, {
                        cwd: effectiveCwd,
                        encoding: 'utf8',
                        timeout: 120000,
                        maxBuffer: 1024 * 1024,
                        env: { ...process.env, AIGON_DASHBOARD: '1' }
                    });
                    const exitCode = result.status !== null ? result.status : 1;
                    ctx.helpers.logToLogs({
                        type: 'session',
                        action: 'session/run',
                        args: [],
                        repoPath: effectiveCwd,
                        command,
                        exitCode,
                        ok: exitCode === 0,
                        stdout: result.stdout || '',
                        stderr: result.stderr || '',
                        duration: Date.now() - sessionStartTime
                    });
                    ctx.sendJson(200, { ok: exitCode === 0, stdout: result.stdout || '', stderr: result.stderr || '', exitCode });
                } catch (e) {
                    ctx.sendJson(500, { error: e.message });
                }
            }).catch(() => ctx.sendJson(400, { error: 'Invalid JSON body' }));
        }
    },
    {
        method: 'POST',
        path: '/api/session/stop',
        handler(req, res, ctx) {
            ctx.readJsonBody().then(payload => {
                const sessionName = String(payload.sessionName || '').trim();
                if (!sessionName) {
                    ctx.sendJson(400, { error: 'sessionName is required' });
                    return;
                }
                try {
                    runTmux(['kill-session', '-t', sessionName], { stdio: 'ignore' });
                    ctx.helpers.log(`Session killed: ${sessionName}`);
                    ctx.sendJson(200, { ok: true });
                } catch (e) {
                    ctx.sendJson(500, { error: e.message });
                }
            }).catch(() => ctx.sendJson(400, { error: 'Invalid JSON body' }));
        }
    },
    {
        method: 'POST',
        path: '/api/sessions/cleanup',
        handler(req, res, ctx) {
            try {
                const { sessions } = getEnrichedSessions();
                const orphans = sessions.filter(s => s.orphan);
                const killed = [];
                const failed = [];
                for (const session of orphans) {
                    const name = session.sessionName || session.name;
                    if (!name) continue;
                    try {
                        runTmux(['kill-session', '-t', name], { stdio: 'ignore' });
                        killed.push(name);
                    } catch (e) {
                        failed.push({ name, error: e.message });
                    }
                }
                ctx.helpers.log(`Sessions cleanup: killed ${killed.length} orphan(s)${failed.length ? `, ${failed.length} failed` : ''}`);
                ctx.sendJson(200, { count: killed.length, killed, failed });
            } catch (e) {
                ctx.sendJson(500, { error: e.message });
            }
        }
    },
    {
        method: 'GET',
        path: '/api/session/status',
        handler(req, res, ctx) {
            const sessionParam = (req.url || '').split('?')[1] || '';
            const session = (sessionParam.match(/(?:^|&)session=([^&]*)/) || [])[1] || '';
            if (!session) {
                ctx.sendJson(400, { error: 'session query param is required' });
                return;
            }
            const running = tmuxSessionExists(session);
            ctx.sendJson(200, { running });
        }
    },
    {
        method: 'POST',
        path: '/api/session/view',
        handler(req, res, ctx) {
            ctx.readJsonBody().then(payload => {
                const sessionName = String(payload.sessionName || '').trim();
                const repoPath = ctx.helpers.resolveRequestedRepoPathOrRespond(res, payload.repoPath);
                if (!repoPath) return;
                if (!sessionName) {
                    ctx.sendJson(400, { error: 'sessionName is required' });
                    return;
                }
                if (!tmuxSessionExists(sessionName)) {
                    ctx.sendJson(409, { error: `Session "${sessionName}" is not running` });
                    return;
                }
                try {
                    openTerminalAppWithCommand(repoPath, `tmux attach -t ${shellQuote(sessionName)}`, sessionName);
                    ctx.sendJson(200, { ok: true, message: `Viewing ${sessionName}` });
                } catch (e) {
                    ctx.sendJson(500, { error: `Failed to open terminal: ${e.message}` });
                }
            }).catch(() => ctx.sendJson(400, { error: 'Invalid JSON body' }));
        }
    },
    {
        method: 'GET',
        path: /^\/api\/peek\/(\d+)\/([a-zA-Z0-9_-]+)$/,
        handler(req, res, ctx, match) {
            const fid = toUnpaddedId(match[1]);
            const agentId = match[2];
            const url = new URL(req.url, `http://${req.headers.host}`);
            const repoPath = ctx.helpers.resolveRequestedRepoPathOrRespond(res, String(url.searchParams.get('repoPath') || '').trim());
            if (!repoPath) return;
            const rawLines = parseInt(url.searchParams.get('lines') || '20', 10);
            const linesParam = Math.min(Math.max(Number.isFinite(rawLines) && rawLines > 0 ? rawLines : 20, 1), 200);

            const repo = path.basename(repoPath);
            let sessionName = null;
            for (const typeChar of ['f', 'r']) {
                const candidate = `${repo}-${typeChar}${fid}-${agentId}`;
                if (tmuxSessionExists(candidate)) { sessionName = candidate; break; }
            }
            if (!sessionName) {
                const evalPrefixF = `${repo}-f${fid}-eval`;
                sessionName = findFirstTmuxSessionByPrefix(evalPrefixF, s => s) || null;
            }
            if (!sessionName) {
                const evalResearch = `${repo}-r${fid}-eval-${agentId}`;
                if (tmuxSessionExists(evalResearch)) sessionName = evalResearch;
            }
            if (!sessionName) {
                const reviewCandidate = `${repo}-f${fid}-review-${agentId}`;
                if (tmuxSessionExists(reviewCandidate)) sessionName = reviewCandidate;
            }
            if (!sessionName) {
                const reviewRCandidate = `${repo}-r${fid}-review-${agentId}`;
                if (tmuxSessionExists(reviewRCandidate)) sessionName = reviewRCandidate;
            }

            if (!sessionName) {
                ctx.sendJson(200, { lines: [], sessionName: '', uptime: '', lastActivity: '', alive: false });
                return;
            }

            try {
                const snap = runTmux(['capture-pane', '-t', sessionName, '-p', '-S', '-200'], { encoding: 'utf8', stdio: 'pipe' });
                const rawOutput = (!snap.error && snap.status === 0) ? (snap.stdout || '') : '';
                const cleaned = rawOutput.replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '\n');
                const allLines = cleaned.split('\n');
                const lines = allLines.slice(-Math.min(linesParam, allLines.length));
                const { uptime, lastActivity } = ctx.routes.getTmuxSessionPeekMeta(sessionName);
                ctx.sendJson(200, { lines, sessionName, uptime, lastActivity, alive: true });
            } catch (e) {
                ctx.sendJson(500, { error: e.message });
            }
        }
    },
    {
        method: 'GET',
        path: '/api/pty-token',
        handler(req, res, ctx) {
            ctx.sendJson(200, { token: mintPtyToken() });
        }
    },
    {
        method: 'GET',
        path: '/api/session/stream',
        handler(req, res, ctx) {
            const qs = (req.url || '').split('?')[1] || '';
            const nameMatch = qs.match(/(?:^|&)name=([^&]*)/);
            const sessionName = decodeURIComponent(nameMatch ? nameMatch[1] : '').trim();

            if (!sessionName) {
                ctx.sendJson(400, { error: 'name query param is required' });
                return;
            }
            if (!tmuxSessionExists(sessionName)) {
                res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
                res.write(`event: end\ndata: ${JSON.stringify({ alive: false })}\n\n`);
                res.end();
                return;
            }

            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
                'X-Accel-Buffering': 'no',
            });
            res.write(': connected\n\n');

            let lastOutput = null;
            function poll() {
                if (!tmuxSessionExists(sessionName)) {
                    try { res.write(`event: end\ndata: ${JSON.stringify({ alive: false })}\n\n`); res.end(); } catch (_) {}
                    clearInterval(timer);
                    return;
                }
                try {
                    const snap = runTmux(['capture-pane', '-t', sessionName, '-p', '-e', '-S', '-500'], { encoding: 'utf8', stdio: 'pipe' });
                    const output = (!snap.error && snap.status === 0) ? (snap.stdout || '') : '';
                    if (output !== lastOutput) {
                        lastOutput = output;
                        res.write(`data: ${JSON.stringify({ output })}\n\n`);
                    }
                } catch (_) {}
            }

            poll();
            const timer = setInterval(poll, 600);
            req.on('close', () => clearInterval(timer));
        }
    },
    {
        method: 'POST',
        path: '/api/session/terminal-input',
        handler(req, res, ctx) {
            ctx.readJsonBody().then(payload => {
                const sessionName = String(payload.name || '').trim();
                const text = String(payload.text || '');
                const enter = payload.enter !== false;
                if (!sessionName) {
                    ctx.sendJson(400, { error: 'name is required' });
                    return;
                }
                if (!tmuxSessionExists(sessionName)) {
                    ctx.sendJson(409, { error: `Session "${sessionName}" is not running` });
                    return;
                }
                const sanitized = text.replace(/[\x00-\x08\x0e-\x1f]/g, '');
                try {
                    if (sanitized) runTmux(['send-keys', '-t', sessionName, '-l', sanitized], { stdio: 'ignore' });
                    if (enter) runTmux(['send-keys', '-t', sessionName, 'Enter'], { stdio: 'ignore' });
                    ctx.sendJson(200, { ok: true });
                } catch (e) {
                    ctx.sendJson(500, { error: e.message });
                }
            }).catch(() => ctx.sendJson(400, { error: 'Invalid JSON body' }));
        }
    },
];
