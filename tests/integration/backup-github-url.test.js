#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { test, report } = require('../_helpers');
const { normalizeGitHubSshToHttps } = require('../../lib/backup');

test('normalizeGitHubSshToHttps: github.com SSH to HTTPS with .git', () => {
    // REGRESSION: backup must not require SSH key passphrases for github.com
    assert.strictEqual(
        normalizeGitHubSshToHttps('git@github.com:acme/cool-vault.git'),
        'https://github.com/acme/cool-vault.git'
    );
});

test('normalizeGitHubSshToHttps: adds .git when missing', () => {
    assert.strictEqual(
        normalizeGitHubSshToHttps('git@github.com:u/aigon-vault'),
        'https://github.com/u/aigon-vault.git'
    );
});

test('normalizeGitHubSshToHttps: leaves HTTPS and non-GitHub remotes alone', () => {
    const https = 'https://github.com/u/r.git';
    assert.strictEqual(normalizeGitHubSshToHttps(https), https);
    const gl = 'git@gitlab.com:group/proj.git';
    assert.strictEqual(normalizeGitHubSshToHttps(gl), gl);
});

report();
