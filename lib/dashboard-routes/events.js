'use strict';

// F622: GET /api/events — SSE live push channel.

module.exports = [
    {
        method: 'GET',
        path: '/api/events',
        handler(req, res, ctx) {
            if (!ctx.helpers.handleSseEventsRequest) {
                res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
                res.end('SSE not available');
                return;
            }
            ctx.helpers.handleSseEventsRequest(req, res);
        },
    },
];
