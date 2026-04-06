'use strict';

/**
 * lib/pro-bridge.js — single seam for @aigon/pro integration.
 *
 * Open-source aigon code never reaches into `@aigon/pro` directly. Instead it
 * exposes extension points here, and the bridge invites Pro to subscribe at
 * startup. This keeps Pro-aware branches out of unrelated modules and lets
 * the Pro API surface evolve without scattering changes through the codebase.
 *
 * Currently implements **plugin route registration** (Option B from the
 * feature spec). The bridge holds an in-process route registry; Pro fills it
 * via its `register()` export at server startup; `dashboard-server.js` calls
 * `dispatchProRoute()` once per request before any Pro-specific logic.
 *
 * Future extension shapes (event bus, anti-corruption read layer) will live
 * in this same module so there is exactly one place that knows about Pro.
 */

const { isProAvailable, getPro } = require('./pro');

// method -> Map(path -> handler)
const routes = new Map();
let initialized = false;
let initializedHelpers = null;

function normalizeMethod(method) {
    return String(method || 'GET').toUpperCase();
}

/**
 * Build the bridge API handed to Pro at registration time.
 * Pro never imports anything from the open-source codebase directly — it
 * receives a small, stable surface here.
 */
function buildBridgeApi(helpers) {
    return {
        registerRoute(method, path, handler) {
            if (typeof handler !== 'function') {
                throw new Error(`pro-bridge.registerRoute: handler for ${method} ${path} must be a function`);
            }
            const key = normalizeMethod(method);
            if (!routes.has(key)) routes.set(key, new Map());
            routes.get(key).set(String(path), handler);
        },
        helpers,
    };
}

/**
 * Initialize the bridge once during server startup. Idempotent.
 *
 * @param {object} opts
 * @param {object} opts.helpers - shared helpers passed to Pro handlers
 *   (e.g. `loadProjectConfig`, `resolveRequestedRepoPath`, `sendJson`).
 *   These form the contract between aigon and @aigon/pro — adding new
 *   helpers is backward-compatible; removing or changing existing helpers
 *   is a breaking change requiring a coordinated bump on both sides.
 */
function initialize({ helpers } = {}) {
    if (initialized) return;
    initialized = true;
    initializedHelpers = helpers || {};

    if (!isProAvailable()) return;

    const pro = getPro();
    const api = buildBridgeApi(initializedHelpers);

    if (typeof pro.register === 'function') {
        try {
            pro.register(api);
            return;
        } catch (err) {
            // Pro registration must not crash the open-source server. Log and
            // fall through to legacy wiring so existing routes keep working.
            // eslint-disable-next-line no-console
            console.error(`[pro-bridge] @aigon/pro register() failed: ${err.message}`);
        }
    }

    // Backward-compat: older @aigon/pro versions don't expose register().
    // Wire the legacy /api/insights routes from `pro.insights` so the bridge
    // still owns the only Pro-aware code path in the dashboard server.
    wireLegacyInsightsRoutes(api, pro);
}

function wireLegacyInsightsRoutes(api, pro) {
    if (!pro || !pro.insights) return;
    const { loadProjectConfig, resolveRequestedRepoPath, sendJson } = api.helpers;
    const insights = pro.insights;

    api.registerRoute('GET', '/api/insights', (req, res, ctx) => {
        const repoResolution = resolveRequestedRepoPath(String(ctx.url.searchParams.get('repoPath') || '').trim());
        if (!repoResolution.ok) return sendJson(res, repoResolution.status || 400, { error: repoResolution.error || 'Invalid repoPath' });
        const repoPath = repoResolution.repoPath;
        const cached = insights.readInsightsCache(repoPath);
        if (cached) return sendJson(res, 200, cached);
        insights.generateAndCacheInsights({ repoPath, includeCoaching: false, loadProjectConfig })
            .then(payload => sendJson(res, 200, payload))
            .catch(err => sendJson(res, 500, { error: err.message }));
    });

    api.registerRoute('POST', '/api/insights/refresh', (req, res, ctx) => {
        ctx.readJsonBody().then(payload => {
            const repoResolution = resolveRequestedRepoPath(payload.repoPath);
            if (!repoResolution.ok) return sendJson(res, repoResolution.status || 400, { error: repoResolution.error || 'Invalid repoPath' });
            insights.generateAndCacheInsights({ repoPath: repoResolution.repoPath, includeCoaching: false, loadProjectConfig })
                .then(next => sendJson(res, 200, next))
                .catch(err => sendJson(res, 500, { error: err.message }));
        }).catch(() => sendJson(res, 400, { error: 'Invalid JSON body' }));
    });
}

/**
 * Dispatch a request to a Pro-registered route. Returns true if a route
 * matched and was invoked, false otherwise. The dashboard server calls this
 * once per request before falling through to its own routes.
 *
 * If Pro is not available, every Pro route returns a uniform `proRequired`
 * response so the dashboard never has to know which paths are Pro-owned.
 */
function dispatchProRoute(method, reqPath, req, res) {
    const methodKey = normalizeMethod(method);

    if (!isProAvailable()) {
        // No Pro routes are registered, but the dashboard needs to know
        // whether a path *would* be Pro-owned so it can return a stable
        // upgrade payload. We can't know without Pro installed, so we
        // simply return false here and let the dashboard fall through.
        // The previous Pro-required stub responses are no longer needed —
        // unmatched paths return 404 like any other route.
        return false;
    }

    const methodRoutes = routes.get(methodKey);
    if (!methodRoutes) return false;
    const handler = methodRoutes.get(reqPath);
    if (!handler) return false;

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const ctx = {
        url,
        readJsonBody: () => readJsonBody(req),
    };

    try {
        const result = handler(req, res, ctx);
        if (result && typeof result.catch === 'function') {
            result.catch(err => {
                if (!res.headersSent) {
                    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: err.message }));
                }
            });
        }
    } catch (err) {
        if (!res.headersSent) {
            res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ error: err.message }));
        }
    }
    return true;
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk.toString('utf8'); });
        req.on('end', () => {
            if (!body) return resolve({});
            try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
        req.on('error', reject);
    });
}

/**
 * Test-only: clear bridge state between runs. Not part of the public contract.
 */
function _resetForTests() {
    routes.clear();
    initialized = false;
    initializedHelpers = null;
}

module.exports = {
    initialize,
    dispatchProRoute,
    _resetForTests,
};
