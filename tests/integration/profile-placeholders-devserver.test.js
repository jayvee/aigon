#!/usr/bin/env node
'use strict';

const a = require('assert');
const fs = require('fs');
const path = require('path');
const { withTempDir, test, report } = require('../_helpers');
const { getActiveProfile, getProfilePlaceholders } = require('../../lib/profile-placeholders');

test('project devServer.enabled false overrides web profile defaults', () => withTempDir((dir) => {
    fs.mkdirSync(path.join(dir, '.aigon'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.aigon', 'config.json'), JSON.stringify({
        profile: 'web',
        devServer: { enabled: false },
        instructions: { rigor: 'light' },
    }, null, 2) + '\n');

    const profile = getActiveProfile(dir);
    a.strictEqual(profile.devServer.enabled, false);
}));

test('feature-do placeholders omit dev-server guidance when project disables dev server', () => withTempDir((dir) => {
    const cwd = process.cwd();
    try {
        fs.mkdirSync(path.join(dir, '.aigon'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.aigon', 'config.json'), JSON.stringify({
            profile: 'web',
            devServer: { enabled: false },
            instructions: { rigor: 'light' },
        }, null, 2) + '\n');

        process.chdir(dir);
        const placeholders = getProfilePlaceholders();
        a.ok(!String(placeholders.TESTING_STEPS_SECTION || '').includes('aigon dev-server start'));
        a.ok(!String(placeholders.DEV_SERVER_SECTION || '').includes('dev server'));
        a.strictEqual(placeholders.STOP_DEV_SERVER_STEP, '');
    } finally {
        process.chdir(cwd);
    }
}));

report();
