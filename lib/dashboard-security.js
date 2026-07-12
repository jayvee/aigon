'use strict';

// ── Dashboard server security (feature 672) ────────────────────────────────
// The local dashboard is the control plane for autonomous coding agents: it can
// spawn agents, open PTYs, inject keystrokes, run lifecycle actions, and read
// files. This module restores the "trusted localhost" boundary the rest of the
// code assumes:
//   • bind to loopback by default; non-loopback bind requires a shared secret
//   • Host / Origin / Referer validation (DNS-rebinding + drive-by CSRF defense)
//   • a shared-secret token gate (header for XHR/fetch, cookie/query bootstrap
//     for header-less document + SSE loads)
//   • path containment for static file handlers
// See docs/architecture.md § "Dashboard security" and SECURITY.md.

const path = require('path');
const crypto = require('crypto');

const DEFAULT_HOST = '127.0.0.1';
const COOKIE_NAME = 'aigon_token';
// F6: cap request bodies (defense-in-depth; DoS is out of scope per SECURITY.md).
const MAX_BODY_BYTES = 1 * 1024 * 1024;

// ── Host helpers ───────────────────────────────────────────────────────────
function isLoopbackHost(host) {
    const h = String(host || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
    if (!h) return false;
    return h === 'localhost' || h === '::1' || h === '0:0:0:0:0:0:0:1' || /^127\./.test(h);
}

/** Extract the hostname (no port) from a `Host` header, handling IPv6 brackets. */
function hostnameFromHeader(hostHeader) {
    const h = String(hostHeader || '').trim();
    if (!h) return '';
    if (h.startsWith('[')) {
        const end = h.indexOf(']');
        return (end >= 0 ? h.slice(0, end + 1) : h).toLowerCase();
    }
    const colon = h.indexOf(':');
    return (colon >= 0 ? h.slice(0, colon) : h).toLowerCase();
}

/** Build the Host allow-list: loopback names + the (non-wildcard) bind host + extras. */
function buildAllowedHosts(bindHost, extraHosts = []) {
    const base = ['localhost', '127.0.0.1', '::1', '[::1]'];
    const h = String(bindHost || '').trim().toLowerCase();
    if (h && h !== '0.0.0.0' && h !== '::' && h !== '[::]' && !base.includes(h)) {
        base.push(h);
    }
    const extras = (Array.isArray(extraHosts) ? extraHosts : [])
        .map(x => String(x || '').trim().toLowerCase())
        .filter(Boolean);
    return [...new Set([...base, ...extras])];
}

function isAllowedHost(hostHeader, allowedHosts) {
    const hn = hostnameFromHeader(hostHeader);
    if (!hn) return false;
    if (hn === 'localhost' || hn.endsWith('.localhost')) return true;
    const list = Array.isArray(allowedHosts) ? allowedHosts : [];
    if (list.includes(hn)) return true;
    if (hn === '[::1]' && list.includes('::1')) return true;
    return false;
}

// ── Origin / Referer ───────────────────────────────────────────────────────
// Moved here from pty-session-handler.js so the HTTP guard and the PTY WebSocket
// upgrade guard share one definition (spec F3/F4).
function isValidOrigin(origin) {
    if (!origin) return false;
    try {
        const u = new URL(origin);
        const h = u.hostname;
        const okProto = u.protocol === 'http:' || u.protocol === 'https:';
        return okProto && (
            h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost')
        );
    } catch (_) {
        return false;
    }
}

// ── Path containment (F2) ──────────────────────────────────────────────────
/**
 * Resolve `reqPath` under `baseDir` and guarantee the result stays contained.
 * Returns the absolute path, or null if the request escapes the base (traversal),
 * contains an encoded traversal segment, or is otherwise malformed.
 */
function resolveWithinBase(baseDir, reqPath) {
    const base = path.resolve(String(baseDir || ''));
    let decoded;
    try {
        decoded = decodeURIComponent(String(reqPath || ''));
    } catch (_) {
        return null; // malformed percent-encoding
    }
    if (decoded.includes('\0')) return null;
    // Belt-and-suspenders: reject any `..` segment before join normalizes it away.
    if (decoded.split(/[\\/]+/).some(seg => seg === '..')) return null;
    const resolved = path.join(base, decoded);
    if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
    return resolved;
}

// ── Token transport (F3a) ──────────────────────────────────────────────────
function parseCookies(cookieHeader) {
    const out = {};
    String(cookieHeader || '').split(';').forEach(part => {
        const idx = part.indexOf('=');
        if (idx < 0) return;
        const k = part.slice(0, idx).trim();
        const v = part.slice(idx + 1).trim();
        if (k) out[k] = decodeURIComponent(v);
    });
    return out;
}

/**
 * Extract a candidate shared-secret token from the request. XHR/fetch send it in
 * the `X-Aigon-Token` header; header-less document + SSE loads use a `?token=`
 * query param (bootstrap) or the `aigon_token` cookie set during that bootstrap.
 * `allowQuery: false` is used on the PTY WebSocket upgrade, where the `?token=`
 * param is the single-use PTY token, not the shared secret.
 */
function extractRequestToken(req, { allowQuery = true } = {}) {
    const headers = (req && req.headers) || {};
    const headerToken = headers['x-aigon-token'];
    if (headerToken) return { token: String(headerToken), source: 'header' };
    if (allowQuery) {
        const qs = String((req && req.url) || '').split('?')[1] || '';
        const qToken = new URLSearchParams(qs).get('token');
        if (qToken) return { token: qToken, source: 'query' };
    }
    const cookies = parseCookies(headers.cookie || '');
    if (cookies[COOKIE_NAME]) return { token: cookies[COOKIE_NAME], source: 'cookie' };
    return { token: '', source: null };
}

function tokensMatch(a, b) {
    if (!a || !b) return false;
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (ba.length !== bb.length) return false;
    try {
        return crypto.timingSafeEqual(ba, bb);
    } catch (_) {
        return false;
    }
}

function buildSessionCookie(token) {
    // No `Secure` flag — the dashboard is served over http on loopback.
    return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/`;
}

// ── Bind + secret resolution (F1) ──────────────────────────────────────────
/**
 * Resolve the bind host, shared secret, and Host allow-list from env + config.
 * Throws AIGON_INSECURE_BIND when a non-loopback bind is requested without a
 * configured shared secret (the server must refuse to start in that case).
 */
function resolveServerSecurity({ globalConfig = {}, env = process.env } = {}) {
    const serverCfg = (globalConfig && globalConfig.server) || {};
    const host = String(env.AIGON_SERVER_HOST || serverCfg.host || '').trim() || DEFAULT_HOST;
    const token = String(env.AIGON_SERVER_TOKEN || serverCfg.token || '').trim() || null;
    const loopback = isLoopbackHost(host);

    if (!loopback && !token) {
        const err = new Error(
            `Refusing to bind the Aigon dashboard to non-loopback host "${host}" without a shared secret.\n` +
            `  Non-loopback access exposes agent control, PTY shells, and file reads to the network.\n` +
            `  Fix: set AIGON_SERVER_TOKEN (or config "server.token") to a strong secret to opt in,\n` +
            `       or unset AIGON_SERVER_HOST to bind to 127.0.0.1 (the secure default).`
        );
        err.code = 'AIGON_INSECURE_BIND';
        throw err;
    }

    const extraHosts = String(env.AIGON_SERVER_ALLOWED_HOSTS || serverCfg.allowedHosts || '')
        .split(',').map(s => s.trim()).filter(Boolean);
    return {
        host,
        token,
        loopback,
        allowedHosts: buildAllowedHosts(host, extraHosts),
    };
}

// ── Central HTTP request guard (F3/F3a) ─────────────────────────────────────
/**
 * Evaluate an inbound HTTP request against the security policy. Returns
 * `{ ok, status, error, setCookie }`. Call before route dispatch / static
 * handling; on `ok:false` reply with `status`, otherwise honour `setCookie`.
 */
function evaluateHttpSecurity(req, { token = null, allowedHosts = [] } = {}) {
    const method = String((req && req.method) || 'GET').toUpperCase();
    const url = String((req && req.url) || '/');
    const reqPath = url.split('?')[0];
    const headers = (req && req.headers) || {};

    // 1. Host check — DNS-rebinding defense. Applies in every mode.
    if (headers.host && !isAllowedHost(headers.host, allowedHosts)) {
        return { ok: false, status: 403, error: 'Forbidden: host not allowed' };
    }

    // 2. Origin/Referer check for state-changing methods and the PTY-token mint.
    const isStateChanging = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
    const isTokenMint = reqPath === '/api/pty-token';
    if (isStateChanging || isTokenMint) {
        const origin = headers.origin || '';
        const referer = headers.referer || headers.referrer || '';
        if (origin) {
            if (!isValidOrigin(origin)) return { ok: false, status: 403, error: 'Forbidden: cross-origin request' };
        } else if (referer) {
            if (!isValidOrigin(referer)) return { ok: false, status: 403, error: 'Forbidden: cross-origin referer' };
        }
        // No Origin/Referer (non-browser client): allowed here; the token gate
        // below still applies whenever a shared secret is configured.
    }

    // 3. Shared-secret token gate — engages only when a secret is configured
    //    (i.e. non-loopback opt-in). Every route is gated, including read GETs.
    if (token) {
        const { token: supplied, source } = extractRequestToken(req, { allowQuery: true });
        if (!tokensMatch(supplied, token)) {
            return { ok: false, status: 403, error: 'Forbidden: missing or invalid token' };
        }
        // Bootstrap: a query-param token (document navigation / SSE) mints an
        // HttpOnly cookie so subsequent header-less loads authenticate.
        if (source === 'query') {
            return { ok: true, setCookie: buildSessionCookie(token) };
        }
    }

    return { ok: true };
}

/**
 * Guard for the PTY WebSocket upgrade (F4). Runs Host + shared-secret checks
 * before the existing Origin allow-list and single-use PTY token in
 * pty-session-handler.js. The `?token=` query param is the PTY token here, so
 * the shared secret is only read from the header or the bootstrap cookie.
 */
function evaluateUpgradeSecurity(req, { token = null, allowedHosts = [] } = {}) {
    const headers = (req && req.headers) || {};
    if (headers.host && !isAllowedHost(headers.host, allowedHosts)) {
        return { ok: false, status: 403, error: 'Forbidden: host not allowed' };
    }
    if (token) {
        const { token: supplied } = extractRequestToken(req, { allowQuery: false });
        if (!tokensMatch(supplied, token)) {
            return { ok: false, status: 403, error: 'Forbidden: missing or invalid token' };
        }
    }
    return { ok: true };
}

module.exports = {
    DEFAULT_HOST,
    COOKIE_NAME,
    MAX_BODY_BYTES,
    isLoopbackHost,
    hostnameFromHeader,
    buildAllowedHosts,
    isAllowedHost,
    isValidOrigin,
    resolveWithinBase,
    parseCookies,
    extractRequestToken,
    tokensMatch,
    buildSessionCookie,
    resolveServerSecurity,
    evaluateHttpSecurity,
    evaluateUpgradeSecurity,
};
