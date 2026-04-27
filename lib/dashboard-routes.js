'use strict';

const { normalizeMethod, readJsonBody, sendJson, matchesPath } = require('./dashboard-routes/util');
const recommendationsRoutes = require('./dashboard-routes/recommendations');
const entitiesRoutes = require('./dashboard-routes/entities');
const sessionsRoutes = require('./dashboard-routes/sessions');
const configRoutes = require('./dashboard-routes/config');
const analyticsRoutes = require('./dashboard-routes/analytics');
const systemRoutes = require('./dashboard-routes/system');

function buildRouteContext(req, res, serverCtx) {
    return {
        req,
        res,
        state: serverCtx.state,
        helpers: serverCtx.helpers,
        routes: serverCtx.routes,
        options: serverCtx.options || {},
        readJsonBody: () => readJsonBody(req),
        sendJson: (status, payload, headers) => sendJson(res, status, payload, headers),
        sendJsonBody(status, payload, headers) {
            sendJson(res, status, payload, headers);
        },
        getLatestStatus: () => serverCtx.state.getLatestStatus(),
        setLatestStatus: (next) => serverCtx.state.setLatestStatus(next),
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
        ...systemRoutes,
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
