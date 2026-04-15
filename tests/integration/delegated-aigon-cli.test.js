#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = (relPath) => fs.readFileSync(path.join(__dirname, '..', '..', relPath), 'utf8');

const actionScopeSrc = read('lib/action-scope.js');
const featureSrc = read('lib/commands/feature.js');
const entitySrc = read('lib/entity.js');

assert.ok(
    /execFileSync\('aigon', \[action, \.\.\.args\.map\(arg => String\(arg\)\)\]/.test(actionScopeSrc),
    'delegated commands must run the installed aigon CLI on PATH'
);

assert.ok(
    !/path\.join\((result|target)\.delegate, 'aigon-cli\.js'\)/.test(featureSrc),
    'feature command delegation must not assume aigon-cli.js exists in the target repo'
);

assert.ok(
    !/path\.join\(target\.repoPath, 'aigon-cli\.js'\)/.test(featureSrc),
    'feature server restart must not assume aigon-cli.js exists in the target repo'
);

assert.ok(
    /runDelegatedAigonCommand\(result\.delegate, 'feature-start', args\)/.test(featureSrc),
    'feature-start delegation must flow through the shared aigon helper'
);

assert.ok(
    /runDelegatedAigonCommand\(target\.delegate, 'feature-close', args\)/.test(featureSrc),
    'feature-close delegation must flow through the shared aigon helper'
);

assert.ok(
    !/path\.join\(result\.delegate, 'aigon-cli\.js'\)/.test(entitySrc),
    'entity delegation must not assume aigon-cli.js exists in the target repo'
);

assert.ok(
    /runDelegatedAigonCommand\(result\.delegate, action, \[name\]\)/.test(entitySrc),
    'entity delegation must flow through the shared aigon helper'
);

console.log('ok delegated-aigon-cli');
