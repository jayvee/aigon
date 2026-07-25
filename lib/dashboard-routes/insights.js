'use strict';

/**
 * lib/dashboard-routes/insights.js — Insights (F114) and Benchmark Matrix (F707).
 *
 * These handlers came from `aigon-pro/index.js` `register()`, where they were
 * installed through the pro-bridge closure. F693 merged Pro into OSS: they are
 * now ordinary route-table entries and take their dependencies from `ctx`
 * rather than from an injected `helpers` bag.
 */

const path = require('path');
const insights = require('../insights');
const benchmarkArtifacts = require('../benchmark-artifacts');
const { loadProjectConfig } = require('../config');

module.exports = [
    {
        method: 'GET',
        path: '/api/insights',
        handler(req, res, ctx) {
            const url = new URL(req.url || '/api/insights', 'http://localhost');
            const requested = String(url.searchParams.get('repoPath') || '').trim();
            const repoResolution = ctx.helpers.resolveRequestedRepoPath(requested);
            if (!repoResolution.ok) {
                return ctx.sendJson(repoResolution.status || 400, { error: repoResolution.error || 'Invalid repoPath' });
            }
            const repoPath = repoResolution.repoPath;
            const cached = insights.readInsightsCache(repoPath);
            if (cached) return ctx.sendJson(200, cached);

            return insights.generateAndCacheInsights({ repoPath, includeCoaching: false, loadProjectConfig })
                .then(payload => ctx.sendJson(200, payload))
                .catch(err => ctx.sendJson(500, { error: err.message }));
        },
    },
    {
        method: 'POST',
        path: '/api/insights/refresh',
        handler(req, res, ctx) {
            return ctx.readJsonBody()
                .catch(() => { ctx.sendJson(400, { error: 'Invalid JSON body' }); return null; })
                .then(payload => {
                    if (!payload) return;
                    const repoResolution = ctx.helpers.resolveRequestedRepoPath(payload.repoPath);
                    if (!repoResolution.ok) {
                        return ctx.sendJson(repoResolution.status || 400, { error: repoResolution.error || 'Invalid repoPath' });
                    }
                    return insights.generateAndCacheInsights({
                        repoPath: repoResolution.repoPath,
                        includeCoaching: false,
                        loadProjectConfig,
                    })
                        .then(next => ctx.sendJson(200, next))
                        .catch(err => ctx.sendJson(500, { error: err.message }));
                });
        },
    },
    {
        method: 'GET',
        path: '/api/benchmarks/latest',
        handler(req, res, ctx) {
            const url = new URL(req.url || '/api/benchmarks/latest', 'http://localhost');
            const requested = String(url.searchParams.get('repoPath') || '').trim();
            const repoResolution = ctx.helpers.resolveRequestedRepoPath(requested);
            if (!repoResolution.ok) {
                return ctx.sendJson(repoResolution.status || 400, { error: repoResolution.error || 'Invalid repoPath' });
            }
            try {
                // Auto-fallback: if the requested repo has no benchmark JSON, scan
                // every registered conductor repo and use the first one that does.
                // Surface `sourceRepo` and `sourceRepoFellBack` so the UI can tell
                // the user which repo's data they're looking at.
                const requestedRepo = repoResolution.repoPath;
                let sourceRepo = requestedRepo;
                let fellBack = false;
                if (!benchmarkArtifacts.repoHasBenchmarks(requestedRepo)) {
                    const candidates = ctx.routes.readConductorReposFromGlobalConfig()
                        .map((p) => path.resolve(String(p)));
                    for (const cand of candidates) {
                        if (cand === requestedRepo) continue;
                        if (benchmarkArtifacts.repoHasBenchmarks(cand)) {
                            sourceRepo = cand;
                            fellBack = true;
                            break;
                        }
                    }
                }
                const payload = benchmarkArtifacts.buildLatestMatrix(sourceRepo);
                payload.sourceRepo = sourceRepo;
                payload.requestedRepo = requestedRepo;
                payload.sourceRepoFellBack = fellBack;
                return ctx.sendJson(200, payload);
            } catch (e) {
                return ctx.sendJson(500, { error: e.message });
            }
        },
    },
];
