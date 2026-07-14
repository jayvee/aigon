'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const sec = require('../../lib/dashboard-security');
const { resolveDashboardActionRepoPath } = require('../../lib/dashboard-action-command');

describe('dashboard server security', () => {
    it('requires a token for non-loopback binds', () => {
        const defaults = sec.resolveServerSecurity({ globalConfig: {}, env: {} });
        assert.deepStrictEqual(
            (({ host, token, loopback }) => ({ host, token, loopback }))(defaults),
            { host: '127.0.0.1', token: null, loopback: true }
        );
        assert.strictEqual(sec.resolveServerSecurity({ globalConfig: {}, env: { AIGON_SERVER_HOST: 'localhost' } }).loopback, true);
        assert.throws(
            () => sec.resolveServerSecurity({ globalConfig: {}, env: { AIGON_SERVER_HOST: '0.0.0.0' } }),
            error => error?.code === 'AIGON_INSECURE_BIND'
        );
        for (const [input, hostAllowed] of [
            [{ globalConfig: {}, env: { AIGON_SERVER_HOST: '0.0.0.0', AIGON_SERVER_TOKEN: 'secret' } }, false],
            [{ globalConfig: { server: { host: '192.168.1.5', token: 'secret' } }, env: {} }, true],
        ]) {
            const result = sec.resolveServerSecurity(input);
            assert.strictEqual(result.token, 'secret');
            assert.strictEqual(result.loopback, false);
            assert.strictEqual(result.allowedHosts.includes(result.host), hostAllowed);
        }
    });

    it('contains static paths and rejects traversal or malformed encodings', () => {
        const base = '/srv/app/assets';
        assert.strictEqual(sec.resolveWithinBase(base, '/logo.svg'), path.join(base, 'logo.svg'));
        for (const requestPath of ['/../../../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/x%00.svg']) {
            assert.strictEqual(sec.resolveWithinBase(base, requestPath), null, requestPath);
        }
    });

    it('enforces Host and Origin checks', () => {
        const allowedHosts = sec.buildAllowedHosts('127.0.0.1', []);
        for (const host of ['localhost:4100', '127.0.0.1:4100', 'foo.aigon.localhost']) {
            assert.strictEqual(sec.isAllowedHost(host, allowedHosts), true, host);
        }
        assert.strictEqual(sec.isAllowedHost('evil.com', allowedHosts), false);
        for (const [request, ok] of [
            [{ method: 'GET', url: '/api/status', headers: { host: 'localhost:4100' } }, true],
            [{ method: 'POST', url: '/api/action', headers: { host: 'localhost:4100', origin: 'http://evil.com' } }, false],
            [{ method: 'POST', url: '/api/action', headers: { host: 'localhost:4100', origin: 'http://localhost:4100' } }, true],
            [{ method: 'GET', url: '/', headers: { host: 'attacker.example' } }, false],
        ]) assert.strictEqual(sec.evaluateHttpSecurity(request, { token: null, allowedHosts }).ok, ok);
        const remote = sec.buildAllowedHosts('0.0.0.0', ['192.168.1.5']);
        assert.strictEqual(sec.evaluateHttpSecurity({
            method: 'POST', url: '/api/action',
            headers: { host: '192.168.1.5:4100', origin: 'http://192.168.1.5:4100', 'x-aigon-token': 'secret' },
        }, { token: 'secret', allowedHosts: remote }).ok, true);
    });

    it('accepts tokens only through supported header, query bootstrap, or cookie paths', () => {
        const allowedHosts = sec.buildAllowedHosts('0.0.0.0', []);
        const security = { token: 'sharedsecret', allowedHosts };
        for (const [request, ok] of [
            [{ method: 'GET', url: '/', headers: { host: 'localhost:4100' } }, false],
            [{ method: 'GET', url: '/api/status', headers: { host: 'localhost:4100', 'x-aigon-token': 'sharedsecret' } }, true],
            [{ method: 'GET', url: '/api/events', headers: { host: 'localhost:4100', cookie: 'aigon_token=sharedsecret' } }, true],
            [{ method: 'GET', url: '/api/events', headers: { host: 'localhost:4100' } }, false],
            [{ method: 'GET', url: '/api/status', headers: { host: 'localhost:4100', 'x-aigon-token': 'nope' } }, false],
            [{ method: 'GET', url: '/api/status', headers: { host: 'localhost:4100', cookie: 'aigon_token=%' } }, false],
        ]) assert.strictEqual(sec.evaluateHttpSecurity(request, security).ok, ok);
        const bootstrap = sec.evaluateHttpSecurity(
            { method: 'GET', url: '/?token=sharedsecret', headers: { host: 'localhost:4100' } }, security
        );
        assert.strictEqual(bootstrap.ok, true);
        assert.match(bootstrap.setCookie, /aigon_token=.*HttpOnly.*SameSite=Strict/);
    });

    it('guards PTY token minting and websocket upgrades', () => {
        const allowedHosts = sec.buildAllowedHosts('0.0.0.0', []);
        const token = 'sharedsecret';
        assert.strictEqual(sec.evaluateHttpSecurity(
            { method: 'GET', url: '/api/pty-token', headers: { host: 'localhost:4100', origin: 'http://evil.com' } },
            { token: null, allowedHosts }
        ).ok, false);
        assert.strictEqual(sec.evaluateHttpSecurity(
            { method: 'GET', url: '/api/pty-token', headers: { host: 'localhost:4100', origin: 'http://localhost:4100' } },
            { token, allowedHosts }
        ).ok, false);
        for (const [headers, ok] of [
            [{ host: 'evil.com' }, false],
            [{ host: 'localhost:4100' }, false],
            [{ host: 'localhost:4100', cookie: `aigon_token=${token}` }, true],
        ]) {
            const request = { url: '/api/session/pty/sess?token=ptyToken', headers };
            assert.strictEqual(sec.evaluateUpgradeSecurity(request, { token, allowedHosts }).ok, ok);
        }
    });

    it('fails closed for unregistered action repository paths', () => {
        for (const [requested, registered, ok] of [
            ['/etc', [], false], ['/srv/app', [], true], ['/srv/app', ['/srv/app'], true], ['/etc', ['/srv/app'], false],
        ]) {
            const result = resolveDashboardActionRepoPath(requested, registered, '/srv/app');
            assert.strictEqual(result.ok, ok, requested);
            if (ok) assert.strictEqual(result.repoPath, path.resolve('/srv/app'));
            else assert.strictEqual(result.status, 403);
        }
    });

    it('compares tokens without accepting empty or mismatched values', () => {
        assert.strictEqual(sec.tokensMatch('abc', 'abc'), true);
        for (const pair of [['abc', 'abd'], ['abc', 'abcd'], ['', ''], ['abc', null]]) {
            assert.strictEqual(sec.tokensMatch(...pair), false);
        }
    });
});
