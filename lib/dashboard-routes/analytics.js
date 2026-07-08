'use strict';

const path = require('path');
const git = require('../git');
const storagePoller = require('../storage-poller');
const agentQuotaPoller = require('../agent-quota-poller');
const agentQuotaRead = require('../agent-quota-read');
const benchHydrate = require('../bench-hydrate');
const signalHealth = require('../signal-health');

module.exports = [
    {
        method: 'GET',
        path: '/api/signal-health',
        handler(req, res, ctx) {
            try {
                const reqUrl = new URL(req.url || '/api/signal-health', 'http://localhost');
                const since = reqUrl.searchParams.get('since')
                    || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
                const events = signalHealth.readSignalEvents({
                    since,
                    agent: reqUrl.searchParams.get('agent') || null,
                    kind: reqUrl.searchParams.get('kind') || null,
                    entityType: reqUrl.searchParams.get('entityType') || reqUrl.searchParams.get('entity-type') || null,
                });
                ctx.sendJson(200, {
                    since: new Date(since).toISOString(),
                    events,
                    summary: signalHealth.summarizeSignalEvents(events),
                });
            } catch (e) {
                ctx.sendJson(500, { error: e.message });
            }
        }
    },
    {
        method: 'GET',
        path: '/api/agent-quota',
        handler(req, res, ctx) {
            try {
                const state = agentQuotaRead.readFilteredAgentQuotaState(process.cwd());
                benchHydrate.mergeBenchVerdictsIntoQuota(state, process.cwd());
                ctx.sendJson(200, state);
            } catch (e) {
                ctx.sendJson(200, agentQuotaRead.emptyState());
            }
        },
    },
    {
        method: 'POST',
        path: '/api/agent-quota/refresh',
        handler(req, res, ctx) {
            try {
                const reqUrl = new URL(req.url || '/api/agent-quota/refresh', 'http://localhost');
                const force = reqUrl.searchParams.get('force') === '1';
                agentQuotaPoller.triggerRefresh({
                    repoPath: process.cwd(),
                    onRefresh: ctx.helpers.emitServerEvent,
                    force,
                });
                ctx.sendJson(200, { ok: true });
            } catch (e) {
                if (e && e.code === 'REFRESH_IN_FLIGHT') {
                    ctx.sendJson(409, { ok: false, error: 'refresh already in flight' });
                    return;
                }
                if (e && e.code === 'RATE_LIMITED') {
                    ctx.sendJson(429, { ok: false, error: 'refresh rate limited' });
                    return;
                }
                ctx.sendJson(500, { ok: false, error: e && e.message });
            }
        },
    },
    {
        method: 'POST',
        path: '/api/storage/refresh',
        handler(req, res, ctx) {
            try {
                storagePoller.triggerRefresh({ repoPath: process.cwd() });
                ctx.sendJson(200, { ok: true });
            } catch (e) {
                ctx.sendJson(500, { ok: false, error: e && e.message });
            }
        }
    },
    {
        path: '/api/analytics',
        handler(req, res, ctx) {
            const forceReload = (req.url || '').includes('force=1');
            if (forceReload) ctx.state.resetAnalyticsCache();
            const analytics = ctx.helpers.getOrRecomputeAnalytics();
            ctx.sendJson(200, analytics);
        }
    },
    {
        path: '/api/stats-aggregate',
        handler(req, res, ctx) {
            try {
                const reqUrl = new URL(req.url || '/api/stats-aggregate', 'http://localhost');
                const force = reqUrl.searchParams.get('force') === '1';
                const repoFilter = reqUrl.searchParams.get('repo');
                const statsAggregate = require('../stats-aggregate');
                const repos = ctx.routes.readConductorReposFromGlobalConfig();
                const targetRepos = repoFilter
                    ? repos.filter(r => path.resolve(r) === path.resolve(repoFilter))
                    : repos;
                const effectiveRepos = (targetRepos.length > 0 ? targetRepos : [process.cwd()]).map(r => path.resolve(r));
                const byRepo = effectiveRepos.map(repoPath => ({
                    repoPath,
                    aggregate: statsAggregate.collectAggregateStats(repoPath, { force }),
                }));
                ctx.sendJson(200, { version: statsAggregate.CACHE_VERSION, repos: byRepo });
            } catch (e) {
                res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: e.message }));
            }
        }
    },
    {
        method: 'GET',
        path: '/api/commits',
        handler(req, res, ctx) {
            try {
                const reqUrl = new URL(req.url || '/api/commits', 'http://localhost');
                const forceRefresh = reqUrl.searchParams.get('force') === '1';
                const repoFilter = reqUrl.searchParams.get('repo');
                const from = reqUrl.searchParams.get('from');
                const to = reqUrl.searchParams.get('to');
                const feature = reqUrl.searchParams.get('feature');
                const agent = reqUrl.searchParams.get('agent');
                const periodDays = ctx.routes.parsePeriodDays(reqUrl.searchParams.get('period') || '');
                const limitRaw = parseInt(reqUrl.searchParams.get('limit') || '2000', 10);
                const limit = limitRaw === 0 ? Infinity : (Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50000) : 2000);

                const repos = ctx.routes.readConductorReposFromGlobalConfig();
                const targetRepos = repoFilter
                    ? repos.filter(r => path.resolve(r) === path.resolve(repoFilter))
                    : repos;
                const effectiveRepos = targetRepos.length > 0 ? targetRepos : [process.cwd()];

                const allCommits = [];
                effectiveRepos.forEach(repoPath => {
                    const payload = git.getCommitAnalytics({ cwd: repoPath, forceRefresh });
                    (payload.commits || []).forEach(commit => {
                        allCommits.push({ ...commit, repoPath: path.resolve(repoPath) });
                    });
                });

                let filtered = git.filterCommitAnalytics(allCommits, {
                    from: from || null,
                    to: to || null,
                    feature: feature || null,
                    agent: agent || null,
                    periodDays
                });
                filtered = filtered
                    .slice()
                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

                const summary = git.buildCommitAnalyticsSummary(filtered);
                const series = git.buildCommitSeries(filtered);
                const commits = filtered.slice(0, limit);

                ctx.sendJson(200, { commits, summary, series });
            } catch (error) {
                ctx.sendJson(500, { error: error.message });
            }
        }
    },
    {
        method: 'GET',
        path: '/api/logs',
        handler(req, res, ctx) {
            const events = ctx.state.logsBuffer
                .filter(event => !(event && event.type === 'server-event' && event.action === 'quota.refreshed'));
            ctx.sendJson(200, { events });
        }
    },
];
