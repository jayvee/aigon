#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { test, withTempDir, report } = require('../_helpers');
const { isAigonSourceRepo } = require('../../lib/repo-identity');

test('isAigonSourceRepo detects the checked-out Aigon package root', () => {
    assert.strictEqual(isAigonSourceRepo(process.cwd()), true);
});

test('isAigonSourceRepo rejects unrelated repos', () => withTempDir('aigon-repo-id-', (dir) => {
    assert.strictEqual(isAigonSourceRepo(dir), false);
}));

report();
