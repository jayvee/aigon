'use strict';

// Feature 672 — dashboard server security guards.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const sec = require('../../lib/dashboard-security');
const { resolveDashboardActionRepoPath } = require('../../lib/dashboard-action-command');

describe('F1: resolveServerSecurity — bind default + non-loopback gate', () => {
    it('defaults to loopback with no token', () => {
        const r = sec.resolveServerSecurity({ globalConfig: {}, env: {} });
        assert.strictEqual(r.host, '127.0.0.1');
        assert.strictEqual(r.token, null);
        assert.strictEqual(r.loopback, true);
    });

    it('honours an explicit loopback override without a token', () => {
        const r = sec.resolveServerSecurity({ globalConfig: {}, env: { AIGON_SERVER_HOST: 'localhost' } });
        assert.strictEqual(r.host, 'localhost');
        assert.strictEqual(r.loopback, true);
    });

    it('refuses a non-loopback bind without a shared secret', () => {
        assert.throws(
            () => sec.resolveServerSecurity({ globalConfig: {}, env: { AIGON_SERVER_HOST: '0.0.0.0' } }),
            (err) => err && err.code === 'AIGON_INSECURE_BIND'
        );
    });

    it('allows a non-loopback bind when a token is configured (env)', () => {
        const r = sec.resolveServerSecurity({ globalConfig: {}, env: { AIGON_SERVER_HOST: '0.0.0.0', AIGON_SERVER_TOKEN: 'secret123' } });
        assert.strictEqual(r.host, '0.0.0.0');
        assert.strictEqual(r.token, 'secret123');
        assert.strictEqual(r.loopback, false);
    });

    it('allows a non-loopback bind when a token is configured (config)', () => {
        const r = sec.resolveServerSecurity({ globalConfig: { server: { host: '192.168.1.5', token: 'abc' } }, env: {} });
        assert.strictEqual(r.host, '192.168.1.5');
        assert.strictEqual(r.token, 'abc');
        assert.ok(r.allowedHosts.includes('192.168.1.5'));
    });
});

describe('F2: resolveWithinBase — path containment', () => {
    const base = '/srv/app/assets';
    it('accepts a contained path', () => {
        assert.strictEqual(sec.resolveWithinBase(base, '/logo.svg'), path.join(base, 'logo.svg'));
    });
    it('rejects ../ traversal', () => {
        assert.strictEqual(sec.resolveWithinBase(base, '/../../../../etc/passwd'), null);
    });
    it('rejects encoded (%2e%2e) traversal', () => {
        assert.strictEqual(sec.resolveWithinBase(base, '/%2e%2e/%2e%2e/etc/passwd'), null);
    });
    it('rejects NUL byte', () => {
        assert.strictEqual(sec.resolveWithinBase(base, '/x%00.svg'), null);
    });
});

describe('F3: Host / Origin checks', () => {
    const allowedHosts = sec.buildAllowedHosts('127.0.0.1', []);

    it('allows loopback + .localhost hosts', () => {
        assert.ok(sec.isAllowedHost('localhost:4100', allowedHosts));
        assert.ok(sec.isAllowedHost('127.0.0.1:4100', allowedHosts));
        assert.ok(sec.isAllowedHost('foo.aigon.localhost', allowedHosts));
    });
    it('rejects a rebinding host', () => {
        assert.ok(!sec.isAllowedHost('evil.com', allowedHosts));
    });

    it('GET read endpoint passes with a good host and no token', () => {
        const d = sec.evaluateHttpSecurity({ method: 'GET', url: '/api/status', headers: { host: 'localhost:4100' } }, { token: null, allowedHosts });
        assert.strictEqual(d.ok, true);
    });
    it('POST from a cross-origin page is rejected', () => {
        const d = sec.evaluateHttpSecurity(
            { method: 'POST', url: '/api/action', headers: { host: 'localhost:4100', origin: 'http://evil.com' } },
            { token: null, allowedHosts }
        );
        assert.strictEqual(d.ok, false);
        assert.strictEqual(d.status, 403);
    });
    it('POST with a loopback origin passes', () => {
        const d = sec.evaluateHttpSecurity(
            { method: 'POST', url: '/api/action', headers: { host: 'localhost:4100', origin: 'http://localhost:4100' } },
            { token: null, allowedHosts }
        );
        assert.strictEqual(d.ok, true);
    });
    it('rejects a request whose Host is not allow-listed (DNS-rebinding)', () => {
        const d = sec.evaluateHttpSecurity({ method: 'GET', url: '/', headers: { host: 'attacker.example' } }, { token: null, allowedHosts });
        assert.strictEqual(d.ok, false);
    });
});

describe('F3/F3a: token gate + cookie/query bootstrap', () => {
    const allowedHosts = sec.buildAllowedHosts('0.0.0.0', []);
    const token = 'sharedsecret';

    it('rejects a request with no token when a secret is configured', () => {
        const d = sec.evaluateHttpSecurity({ method: 'GET', url: '/', headers: { host: 'localhost:4100' } }, { token, allowedHosts });
        assert.strictEqual(d.ok, false);
        assert.strictEqual(d.status, 403);
    });
    it('accepts the X-Aigon-Token header (fetch/XHR)', () => {
        const d = sec.evaluateHttpSecurity({ method: 'GET', url: '/api/status', headers: { host: 'localhost:4100', 'x-aigon-token': token } }, { token, allowedHosts });
        assert.strictEqual(d.ok, true);
    });
    it('accepts a ?token= query on GET / and sets a bootstrap cookie', () => {
        const d = sec.evaluateHttpSecurity({ method: 'GET', url: `/?token=${token}`, headers: { host: 'localhost:4100' } }, { token, allowedHosts });
        assert.strictEqual(d.ok, true);
        assert.match(d.setCookie, /aigon_token=/);
        assert.match(d.setCookie, /HttpOnly/);
        assert.match(d.setCookie, /SameSite=Strict/);
    });
    it('accepts the bootstrap cookie for SSE /api/events', () => {
        const d = sec.evaluateHttpSecurity({ method: 'GET', url: '/api/events', headers: { host: 'localhost:4100', cookie: `aigon_token=${token}` } }, { token, allowedHosts });
        assert.strictEqual(d.ok, true);
    });
    it('rejects SSE /api/events with no cookie/token', () => {
        const d = sec.evaluateHttpSecurity({ method: 'GET', url: '/api/events', headers: { host: 'localhost:4100' } }, { token, allowedHosts });
        assert.strictEqual(d.ok, false);
    });
    it('rejects a wrong token', () => {
        const d = sec.evaluateHttpSecurity({ method: 'GET', url: '/api/status', headers: { host: 'localhost:4100', 'x-aigon-token': 'nope' } }, { token, allowedHosts });
        assert.strictEqual(d.ok, false);
    });
});

describe('F4: PTY-token mint + upgrade guard', () => {
    const allowedHosts = sec.buildAllowedHosts('0.0.0.0', []);
    const token = 'sharedsecret';

    it('GET /api/pty-token requires a valid origin (token-mint is guarded)', () => {
        const d = sec.evaluateHttpSecurity(
            { method: 'GET', url: '/api/pty-token', headers: { host: 'localhost:4100', origin: 'http://evil.com' } },
            { token: null, allowedHosts }
        );
        assert.strictEqual(d.ok, false);
    });
    it('GET /api/pty-token requires the shared secret when configured', () => {
        const d = sec.evaluateHttpSecurity(
            { method: 'GET', url: '/api/pty-token', headers: { host: 'localhost:4100', origin: 'http://localhost:4100' } },
            { token, allowedHosts }
        );
        assert.strictEqual(d.ok, false);
    });
    it('upgrade guard rejects a bad host', () => {
        const d = sec.evaluateUpgradeSecurity({ headers: { host: 'evil.com' } }, { token: null, allowedHosts });
        assert.strictEqual(d.ok, false);
    });
    it('upgrade guard does NOT treat the ?token= PTY token as the shared secret', () => {
        // The PTY single-use token lives in the query string; the shared secret
        // must come from the cookie/header, so a query-only token must fail.
        const d = sec.evaluateUpgradeSecurity(
            { url: '/api/session/pty/sess?token=ptyToken', headers: { host: 'localhost:4100' } },
            { token, allowedHosts }
        );
        assert.strictEqual(d.ok, false);
    });
    it('upgrade guard accepts the shared secret from the bootstrap cookie', () => {
        const d = sec.evaluateUpgradeSecurity(
            { url: '/api/session/pty/sess?token=ptyToken', headers: { host: 'localhost:4100', cookie: `aigon_token=${token}` } },
            { token, allowedHosts }
        );
        assert.strictEqual(d.ok, true);
    });
});

describe('F5: resolveDashboardActionRepoPath fails closed', () => {
    it('rejects an arbitrary repoPath when no repos are registered', () => {
        const r = resolveDashboardActionRepoPath('/etc', [], '/srv/app');
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.status, 403);
    });
    it('accepts the default repo when no repos are registered', () => {
        const r = resolveDashboardActionRepoPath('/srv/app', [], '/srv/app');
        assert.strictEqual(r.ok, true);
        assert.strictEqual(r.repoPath, path.resolve('/srv/app'));
    });
    it('still honours a registered repo', () => {
        const r = resolveDashboardActionRepoPath('/srv/app', ['/srv/app'], '/srv/app');
        assert.strictEqual(r.ok, true);
    });
    it('rejects an unregistered repo when repos exist', () => {
        const r = resolveDashboardActionRepoPath('/etc', ['/srv/app'], '/srv/app');
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.status, 403);
    });
});

describe('F6: token equality is constant-length-safe', () => {
    it('matches equal tokens', () => {
        assert.ok(sec.tokensMatch('abc', 'abc'));
    });
    it('rejects unequal / empty', () => {
        assert.ok(!sec.tokensMatch('abc', 'abd'));
        assert.ok(!sec.tokensMatch('abc', 'abcd'));
        assert.ok(!sec.tokensMatch('', ''));
        assert.ok(!sec.tokensMatch('abc', null));
    });
});
