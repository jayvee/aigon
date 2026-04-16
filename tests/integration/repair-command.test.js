#!/usr/bin/env node
'use strict';

// REGRESSION: prevents repair command from being silently unregistered or
// losing its CLI metadata entry (feature 261)

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createAllCommands } = require('../../lib/commands/shared');

const commands = createAllCommands();
assert.strictEqual(typeof commands.repair, 'function', 'repair command must be registered');

const miscSrc = fs.readFileSync(path.join(__dirname, '../../lib/commands/misc.js'), 'utf8');
assert.ok(/Usage: aigon repair <feature\|research> <ID> \[--dry-run\]/.test(miscSrc), 'repair usage text must exist');
assert.ok(/Repair diagnosis for/.test(miscSrc), 'repair must print a diagnosis section');
assert.ok(/No repair needed/.test(miscSrc), 'repair must support a no-op path');

const templatesSrc = fs.readFileSync(path.join(__dirname, '../../lib/templates.js'), 'utf8');
assert.ok(/'repair': \{ argHints: '<feature\|research> <ID> \[--dry-run\]'/m.test(templatesSrc), 'command metadata must expose repair');

console.log('  ✓ repair command registration + metadata checks');
