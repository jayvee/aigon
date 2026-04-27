'use strict';

const fs = require('fs');
const path = require('path');
const git = require('../git');
const budgetPoller = require('../budget-poller');

module.exports = [
    {
        method: 'GET',
        path: '/api/budget',
        handler(req, res, ctx) {
            try {
                const data = budgetPoller.readCache(process.cwd());
                let lastTokenKickoffAt = null;
                try {
                    const kickoffPath = path.join(process.cwd(), '.aigon', 'state', 'last-token-kickoff');
                    if (fs.existsSync(kickoffPath)) {
                        lastTokenKickoffAt = fs.readFileSync(kickoffPath, 'utf8').trim() || null;
                    }
                } catch (_) {}
                ctx.sendJson(200, { ...(data || { cc: null, cx: null, gg: null, km: null }), lastTokenKickoffAt });
            } catch (e) {
                ctx.sendJson(200, { cc: null, cx: null, gg: null, km: null, lastTokenKickoffAt: null });
            }
        }
    },
    {
        method: 'POST',
        path: '/api/budget/refresh',
        handler(req, res, ctx) {
            try {
                budgetPoller.triggerRefresh({ repoPath: process.cwd() });
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
            ctx.sendJson(200, { events: ctx.state.logsBuffer.slice() });
        }
    },
];
