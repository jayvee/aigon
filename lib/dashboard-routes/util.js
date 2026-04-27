'use strict';

function normalizeMethod(method) {
    return method ? String(method).toUpperCase() : null;
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk.toString('utf8'); });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (error) {
                reject(error);
            }
        });
        req.on('error', reject);
    });
}

function sendJson(res, status, payload, extraHeaders) {
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        ...(extraHeaders || {})
    });
    res.end(JSON.stringify(payload));
}

function matchesPath(routePath, reqPath) {
    if (typeof routePath === 'string') {
        return routePath === reqPath ? [] : null;
    }
    if (routePath instanceof RegExp) {
        return reqPath.match(routePath);
    }
    if (typeof routePath === 'function') {
        return routePath(reqPath);
    }
    return null;
}

module.exports = {
    normalizeMethod,
    readJsonBody,
    sendJson,
    matchesPath,
};
