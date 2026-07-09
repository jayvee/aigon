'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { GLOBAL_CONFIG_DIR } = require('../config');
const {
    parseDashboardActionRequest,
    buildDashboardActionCommandArgs,
    verifyFeatureStartRegistration,
} = require('../dashboard-action-command');

const LIVE_LOG_DIR = path.join(GLOBAL_CONFIG_DIR, 'server', 'action-logs');

async function runDashboardInteractiveAction(request) {
    const parsed = parseDashboardActionRequest(request, {
        registeredRepos: request && request.registeredRepos,
        defaultRepoPath: request && request.defaultRepoPath
    });
    if (!parsed.ok) {
        return parsed;
    }

    const actionId = request && request.actionId;
    const activeActionLogs = request && request.activeActionLogs;

    let logStream = null;
    if (actionId && activeActionLogs) {
        try { fs.mkdirSync(LIVE_LOG_DIR, { recursive: true }); } catch (_) {}
        const logPath = path.join(LIVE_LOG_DIR, `${actionId}.log`);
        activeActionLogs.set(actionId, {
            logPath,
            lines: [],
            done: false,
            action: parsed.action,
            featureId: parsed.args && parsed.args[0] != null ? String(parsed.args[0]) : null,
            repoPath: parsed.repoPath,
        });
        try { logStream = fs.createWriteStream(logPath, { flags: 'w' }); } catch (_) {}
    }

    const cliArgs = buildDashboardActionCommandArgs(parsed.action, parsed.args);

    return new Promise((resolve) => {
        const child = spawn(process.execPath, cliArgs, {
            cwd: parsed.repoPath,
            env: { ...process.env, AIGON_INVOKED_BY_DASHBOARD: '1' },
        });

        let stdout = '';
        let stderr = '';

        function appendOutput(chunk, src) {
            if (src === 'stdout') stdout += chunk;
            else stderr += chunk;
            if (actionId && activeActionLogs) {
                const entry = activeActionLogs.get(actionId);
                if (entry) {
                    const newLines = chunk.split('\n').filter(l => l.length > 0);
                    entry.lines.push(...newLines);
                }
            }
            if (logStream) { try { logStream.write(chunk); } catch (_) {} }
        }

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', chunk => appendOutput(chunk, 'stdout'));
        child.stderr.on('data', chunk => appendOutput(chunk, 'stderr'));

        child.on('error', (err) => {
            if (logStream) { try { logStream.destroy(); } catch (_) {} }
            if (actionId && activeActionLogs) {
                const entry = activeActionLogs.get(actionId);
                if (entry) {
                    try { fs.unlinkSync(entry.logPath); } catch (_) {}
                    activeActionLogs.delete(actionId);
                }
            }
            resolve({ ok: false, status: 500, error: `Failed to run action: ${err.message}` });
        });

        child.on('close', (code) => {
            if (logStream) { try { logStream.end(); } catch (_) {} }
            if (actionId && activeActionLogs) {
                const entry = activeActionLogs.get(actionId);
                if (entry) {
                    entry.done = true;
                    try { fs.unlinkSync(entry.logPath); } catch (_) {}
                    setTimeout(() => activeActionLogs.delete(actionId), 30000);
                }
            }

            const exitCode = typeof code === 'number' ? code : 1;
            const payload = {
                ok: exitCode === 0,
                action: parsed.action,
                args: parsed.args,
                repoPath: parsed.repoPath,
                command: `aigon ${parsed.action}${parsed.args.length ? ` ${parsed.args.join(' ')}` : ''}`,
                exitCode,
                stdout: stdout || '',
                stderr: stderr || ''
            };

            if (exitCode !== 0) {
                const stderrText = (stderr || '').trim();
                const errorLine = stderrText.split('\n').find(l => l.includes('❌') || l.includes('🔒'));
                const errorMsg = errorLine
                    ? errorLine.replace(/^.*[❌🔒]\s*/, '').trim()
                    : (stderrText.split('\n')[0] || `Action failed with exit code ${exitCode}`);
                return resolve({
                    ...payload,
                    ok: false,
                    status: 422,
                    error: `Action failed: ${errorMsg}`,
                });
            }

            if (parsed.action === 'feature-start' && parsed.args.length >= 2) {
                const featureId = parsed.args[0];
                const expectedAgents = parsed.args.slice(1).filter(arg => !String(arg).startsWith('--'));
                try {
                    const verification = verifyFeatureStartRegistration(parsed.repoPath, featureId, expectedAgents);
                    if (!verification.ok) {
                        payload.ok = false;
                        payload.status = 422;
                        payload.error = verification.error;
                    }
                } catch (e) {
                    // Verification is best-effort.
                }
            }

            resolve(payload);
        });
    });
}

module.exports = {
    runDashboardInteractiveAction,
};
