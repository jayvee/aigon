'use strict';

const zlib = require('zlib');

// F590: gzip JSON responses above this serialized-byte threshold when the
// client advertises gzip support. Small bodies skip compression (CPU not worth
// it). `/api/status` on a 14-repo dataset drops from ~3.5 MB to well under 1 MB.
const GZIP_THRESHOLD_BYTES = 8 * 1024;

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

// F590: gzip-aware JSON writer for an already-serialized body. Returns the
// uncompressed byte length so callers (e.g. /api/status) can log payload size.
// SSE / WebSocket / PTY paths never go through here, so they are untouched.
function sendJsonSerialized(res, status, body, extraHeaders, req) {
    const headers = {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        ...(extraHeaders || {})
    };
    const byteLength = Buffer.byteLength(body);
    const acceptEncoding = req && req.headers ? String(req.headers['accept-encoding'] || '') : '';
    if (/\bgzip\b/.test(acceptEncoding) && byteLength > GZIP_THRESHOLD_BYTES) {
        const compressed = zlib.gzipSync(body);
        headers['content-encoding'] = 'gzip';
        headers['vary'] = 'Accept-Encoding';
        res.writeHead(status, headers);
        res.end(compressed);
    } else {
        res.writeHead(status, headers);
        res.end(body);
    }
    return byteLength;
}

function sendJson(res, status, payload, extraHeaders, req) {
    return sendJsonSerialized(res, status, JSON.stringify(payload), extraHeaders, req);
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
    sendJsonSerialized,
    matchesPath,
    GZIP_THRESHOLD_BYTES,
};
