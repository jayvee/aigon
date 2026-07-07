'use strict';

const { normalizeMethod, readJsonBody, sendJson, sendJsonSerialized, matchesPath } = require('./dashboard-routes/util');
const recommendationsRoutes = require('./dashboard-routes/recommendations');
const entitiesRoutes = require('./dashboard-routes/entities');
const sessionsRoutes = require('./dashboard-routes/sessions');
const configRoutes = require('./dashboard-routes/config');
const analyticsRoutes = require('./dashboard-routes/analytics');
const transcriptRoutes = require('./dashboard-routes/transcripts');
const commitsRoutes = require('./dashboard-routes/commits');
const systemRoutes = require('./dashboard-routes/system');
const eventsRoutes = require('./dashboard-routes/events');
const versionStatusRoutes = require('./dashboard-routes/version-status');

function buildRouteContext(req, res, serverCtx) {
    return {
        req,
        res,
        state: serverCtx.state,
        helpers: serverCtx.helpers,
        routes: serverCtx.routes,
        options: serverCtx.options || {},
        readJsonBody: () => readJsonBody(req),
        // F590: thread `req` so sendJson can negotiate gzip via Accept-Encoding.
        sendJson: (status, payload, headers) => sendJson(res, status, payload, headers, req),
        // Send an already-serialized JSON body (skips a re-stringify); returns
        // the uncompressed byte count for request-size logging.
        sendJsonSerialized: (status, body, headers) => sendJsonSerialized(res, status, body, headers, req),
        sendJsonBody(status, payload, headers) {
            sendJson(res, status, payload, headers, req);
        },
        getLatestStatus: () => serverCtx.state.getLatestStatus(),
        setLatestStatus: (next) => serverCtx.state.setLatestStatus(next),
        getStatusVersion: () => serverCtx.state.getStatusVersion(),
        getSerializedStatusBody: () => serverCtx.state.getSerializedStatusBody(),
        getGlobalConfig: () => serverCtx.state.getGlobalConfig(),
        setGlobalConfig: next => serverCtx.state.setGlobalConfig(next),
        getNotificationUnreadCount: () => serverCtx.state.getNotificationUnreadCount(),
        setNotificationUnreadCount: next => serverCtx.state.setNotificationUnreadCount(next),
    };
}

function createDashboardRouteDispatcher(serverCtx) {
    const routes = [
        ...analyticsRoutes,
        ...entitiesRoutes,
        ...sessionsRoutes,
        ...transcriptRoutes,
        ...commitsRoutes,
        ...systemRoutes,
        ...eventsRoutes,
        ...versionStatusRoutes,
        ...configRoutes,
        ...recommendationsRoutes,
    ];

    return {
        dispatchOssRoute(method, reqPath, req, res) {
            const methodKey = normalizeMethod(method);
            for (const route of routes) {
                if (route.method && normalizeMethod(route.method) !== methodKey) continue;
                const match = matchesPath(route.path, reqPath);
                if (!match) continue;
                route.handler(req, res, buildRouteContext(req, res, serverCtx), match);
                return true;
            }
            return false;
        }
    };
}

module.exports = {
    createDashboardRouteDispatcher,
};
