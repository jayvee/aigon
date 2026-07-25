'use strict';

/**
 * lib/dashboard-routes/failover.js — manual agent failover (F421), the endpoint
 * behind the dashboard's "Failover now →" action.
 *
 * Merged into the OSS route table by F693 (previously registered through
 * `aigon-pro/index.js` register()).
 */

const agentFailover = require('../agent-failover');

module.exports = [
    {
        method: 'POST',
        path: '/api/feature-failover',
        handler(req, res, ctx) {
            // The engine still exposes its handler as a factory over
            // { resolveRequestedRepoPath, sendJson } — bind it to this request's
            // ctx rather than rewriting the vendored engine.
            const handle = agentFailover.createFailoverRouteHandler({
                resolveRequestedRepoPath: ctx.helpers.resolveRequestedRepoPath,
                sendJson: (_res, status, payload) => ctx.sendJson(status, payload),
            });
            return handle(req, res, ctx);
        },
    },
];
