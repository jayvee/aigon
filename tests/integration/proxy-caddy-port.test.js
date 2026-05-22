#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');

function withProxyModule(home, plistPath, fn) {
    const prevHome = process.env.HOME;
    const prevPlist = process.env.AIGON_CADDY_SYSTEM_PLIST;
    process.env.HOME = home;
    process.env.AIGON_CADDY_SYSTEM_PLIST = plistPath;
    const modulePath = require.resolve('../../lib/proxy');
    delete require.cache[modulePath];
    try {
        return fn(require('../../lib/proxy'));
    } finally {
        delete require.cache[modulePath];
        if (prevHome === undefined) delete process.env.HOME;
        else process.env.HOME = prevHome;
        if (prevPlist === undefined) delete process.env.AIGON_CADDY_SYSTEM_PLIST;
        else process.env.AIGON_CADDY_SYSTEM_PLIST = prevPlist;
    }
}

test('installed Caddy daemon forces route writes to port 80 even from stale 4080 Caddyfile', () => withTempDir('aigon-proxy-daemon-', (tmp) => {
    const home = path.join(tmp, 'home');
    const plistPath = path.join(tmp, 'com.aigon.caddy.plist');
    fs.mkdirSync(path.join(home, '.aigon', 'dev-proxy'), { recursive: true });
    fs.writeFileSync(plistPath, '<plist/>');
    fs.writeFileSync(path.join(home, '.aigon', 'dev-proxy', 'Caddyfile'), [
        '{',
        '    auto_https off',
        '    http_port 4080',
        '}',
        '',
        'aigon.localhost:4080 {',
        '    reverse_proxy localhost:4100',
        '}',
        '',
    ].join('\n'));

    withProxyModule(home, plistPath, (proxy) => {
        assert.strictEqual(proxy.getCaddyPort(), 80);
        proxy.writeCaddyfile([{ hostname: 'aigon.localhost', port: 4100, comment: 'Dashboard' }]);
        const content = fs.readFileSync(proxy.CADDYFILE_PATH, 'utf8');
        assert.ok(content.includes('http_port 80'), content);
        assert.ok(content.includes('aigon.localhost:80 {'), content);
        assert.ok(!content.includes('aigon.localhost:4080 {'), content);
    });
}));

test('without installed Caddy daemon route writes preserve explicit user-mode port', () => withTempDir('aigon-proxy-user-', (tmp) => {
    const home = path.join(tmp, 'home');
    const plistPath = path.join(tmp, 'missing-com.aigon.caddy.plist');
    fs.mkdirSync(path.join(home, '.aigon', 'dev-proxy'), { recursive: true });
    fs.writeFileSync(path.join(home, '.aigon', 'dev-proxy', 'Caddyfile'), [
        '{',
        '    auto_https off',
        '    http_port 4080',
        '}',
        '',
    ].join('\n'));

    withProxyModule(home, plistPath, (proxy) => {
        assert.strictEqual(proxy.getCaddyPort(), 4080);
        proxy.writeCaddyfile([{ hostname: 'aigon.localhost', port: 4100, comment: 'Dashboard' }]);
        const content = fs.readFileSync(proxy.CADDYFILE_PATH, 'utf8');
        assert.ok(content.includes('http_port 4080'), content);
        assert.ok(content.includes('aigon.localhost:4080 {'), content);
    });
}));

report();
