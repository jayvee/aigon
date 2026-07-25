'use strict';

/**
 * lib/dashboard-routes/scheduling.js — Recurring features (F701) and
 * Scheduled Kickoffs (F703, F704).
 *
 * Merged into the OSS route table by F693 (previously registered through
 * `aigon-pro/index.js` register()).
 */

const os = require('os');
const path = require('path');
const recurring = require('../recurring');
const scheduledKickoff = require('../scheduled-kickoff');

/**
 * Resolve which repos a scheduling request applies to. An explicit `repoPath`
 * must be one of the registered conductor repos; with none given, every
 * registered repo is targeted (falling back to cwd for an unregistered install).
 * Responds 403 and returns null when the hint is not registered.
 */
function resolveDashboardRepoTargets(ctx, repoHint) {
    const registered = ctx.routes.readConductorReposFromGlobalConfig().map(r => path.resolve(String(r)));
    if (repoHint) {
        const abs = path.resolve(repoHint.startsWith('~') ? repoHint.replace(/^~/, os.homedir()) : repoHint);
        if (registered.length > 0 && !registered.includes(abs)) {
            ctx.sendJson(403, { error: 'repoPath is not registered with dashboard' });
            return null;
        }
        return [abs];
    }
    if (registered.length > 0) return registered;
    return [path.resolve(process.cwd())];
}

function displayRepoPath(repoPath) {
    const home = os.homedir();
    return repoPath.startsWith(home) ? '~' + repoPath.slice(home.length) : repoPath;
}

function repoHintFrom(req, fallbackPath) {
    const url = new URL(req.url || fallbackPath, 'http://localhost');
    return {
        url,
        hint: String(url.searchParams.get('repoPath') || url.searchParams.get('path') || '').trim(),
    };
}

module.exports = [
    {
        method: 'GET',
        path: '/api/recurring/status',
        handler(req, res, ctx) {
            try {
                const { hint } = repoHintFrom(req, '/api/recurring/status');
                const targets = resolveDashboardRepoTargets(ctx, hint);
                if (!targets) return;
                const items = [];
                for (const repoPath of targets) {
                    for (const item of recurring.listRecurringStatus(repoPath)) {
                        items.push({ ...item, repoPath, displayPath: displayRepoPath(repoPath) });
                    }
                }
                items.sort((a, b) => String(a.displayPath).localeCompare(String(b.displayPath)) ||
                    String(a.recurringSlug).localeCompare(String(b.recurringSlug)));
                ctx.sendJson(200, { items });
            } catch (e) {
                ctx.sendJson(500, { error: e.message });
            }
        },
    },
    {
        method: 'GET',
        path: '/api/schedule/jobs',
        handler(req, res, ctx) {
            try {
                const { url, hint } = repoHintFrom(req, '/api/schedule/jobs');
                const includeAll = url.searchParams.get('all') === '1' || url.searchParams.get('all') === 'true';
                const targets = resolveDashboardRepoTargets(ctx, hint);
                if (!targets) return;
                const jobs = [];
                for (const repoPath of targets) {
                    for (const j of scheduledKickoff.listJobs(repoPath, { includeAll })) {
                        jobs.push({ ...j, repoPath, displayPath: displayRepoPath(repoPath) });
                    }
                }
                jobs.sort((a, b) => String(a.runAt).localeCompare(String(b.runAt)));
                ctx.sendJson(200, { jobs });
            } catch (e) {
                ctx.sendJson(500, { error: e.message });
            }
        },
    },
    {
        method: 'POST',
        path: '/api/schedule/add',
        handler(req, res, ctx) {
            return ctx.readJsonBody()
                .then(payload => {
                    try {
                        const repoRes = scheduledKickoff.resolveRepoForScheduleCli(payload.repoPath != null ? String(payload.repoPath) : '');
                        if (!repoRes.ok) { ctx.sendJson(400, { error: repoRes.error }); return; }
                        const kind = String(payload.kind || '').trim();
                        const entityId = String(payload.entityId || '').trim();
                        const runAt = String(payload.runAt || '').trim();
                        const r = scheduledKickoff.addJob(repoRes.repoPath, { kind, entityId, runAt, payload: payload.payload || {} });
                        if (!r.ok) { ctx.sendJson(400, { error: r.error }); return; }
                        ctx.sendJson(200, { ok: true, job: r.job });
                    } catch (e) { ctx.sendJson(500, { error: e.message }); }
                })
                .catch(() => ctx.sendJson(400, { error: 'Invalid JSON body' }));
        },
    },
    {
        method: 'POST',
        path: '/api/schedule/cancel',
        handler(req, res, ctx) {
            return ctx.readJsonBody()
                .then(payload => {
                    try {
                        const repoRes = scheduledKickoff.resolveRepoForScheduleCli(payload.repoPath != null ? String(payload.repoPath) : '');
                        if (!repoRes.ok) { ctx.sendJson(400, { error: repoRes.error }); return; }
                        const jobId = String(payload.jobId || '').trim();
                        const r = scheduledKickoff.cancelJob(repoRes.repoPath, jobId);
                        if (!r.ok) { ctx.sendJson(400, { error: r.error }); return; }
                        ctx.sendJson(200, { ok: true, job: r.job, noop: Boolean(r.noop) });
                    } catch (e) { ctx.sendJson(500, { error: e.message }); }
                })
                .catch(() => ctx.sendJson(400, { error: 'Invalid JSON body' }));
        },
    },
];
