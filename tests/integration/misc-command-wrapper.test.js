#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { test, report } = require('../_helpers');
const { createMiscCommands } = require('../../lib/commands/misc');

test('createMiscCommands exposes Gemini hook commands', () => {
    const commands = createMiscCommands();
    assert.strictEqual(typeof commands['check-agent-signal'], 'function');
    assert.strictEqual(typeof commands['check-agent-submitted'], 'function');
});

report();
