#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { test, report } = require('../_helpers');
const ta = require('../../lib/terminal-adapters');
const { canonicalizeTerminalApp } = require('../../lib/global-config-migration');
const { getTerminalConfigHelpIds } = require('../../lib/commands/infra');

const SYN_ID = '_test-ghostty-syn_';
const SYN_ALIAS = `${SYN_ID}-alias`;

function addSyn() {
    ta.registerAdapter({
        id: SYN_ID, name: SYN_ID, displayName: 'Ghostty (test)', pickerLabel: 'Ghostty (test)',
        platforms: ['darwin'], aliases: [SYN_ALIAS], hiddenFromPicker: false,
        detect: () => false, launch() {}, split: null,
    });
}

function removeSyn() {
    const i = ta.adapters.findIndex(a => (a.id || a.name) === SYN_ID);
    if (i !== -1) ta.adapters.splice(i, 1);
}

// ---------------------------------------------------------------------------
// Baseline surfaces
// ---------------------------------------------------------------------------

for (const id of ['warp', 'iterm2', 'apple-terminal']) {
    test(`${id} in getDashboardOptions`, () => assert.ok(ta.getDashboardOptions().includes(id)));
    test(`${id} in getPickerOptions darwin`, () => assert.ok(ta.getPickerOptions({ platform: 'darwin' }).map(o => o.value).includes(id)));
    test(`isValidId ${id}`, () => assert.ok(ta.isValidId(id)));
    test(`canonicalize ${id} → ${id}`, () => assert.strictEqual(ta.canonicalize(id), id));
}

test('getDisplayName warp', () => assert.strictEqual(ta.getDisplayName('warp'), 'Warp'));
test('getDisplayName iterm2', () => assert.strictEqual(ta.getDisplayName('iterm2'), 'iTerm2'));
test('getDisplayName apple-terminal', () => assert.strictEqual(ta.getDisplayName('apple-terminal'), 'Terminal.app'));

test('canonicalize "terminal" alias → apple-terminal', () => assert.strictEqual(ta.canonicalize('terminal'), 'apple-terminal'));
test('canonicalize unknown → null', () => assert.strictEqual(ta.canonicalize('definitely-not-a-real-terminal'), null));
test('isValidId unknown → false', () => assert.ok(!ta.isValidId('definitely-not-a-real-terminal')));

test('linux adapters absent from darwin picker', () => {
    const values = ta.getPickerOptions({ platform: 'darwin' }).map(o => o.value);
    assert.ok(!values.includes('kitty'));
});

test('canonicalizeTerminalApp delegates to registry', () => {
    assert.strictEqual(canonicalizeTerminalApp('warp'), 'warp');
    assert.strictEqual(canonicalizeTerminalApp('terminal'), 'apple-terminal');
    assert.strictEqual(canonicalizeTerminalApp('definitely-not-a-real-terminal'), null);
});

test('getTerminalConfigHelpIds covers darwin terminals', () => {
    const ids = getTerminalConfigHelpIds();
    assert.ok(ids.includes('warp') && ids.includes('iterm2') && ids.includes('apple-terminal') && ids.includes('ghostty'));
});

// ---------------------------------------------------------------------------
// Drift prevention: synthetic adapter propagates to all six surfaces
// ---------------------------------------------------------------------------

const driftCases = [
    ['getPickerOptions', () => ta.getPickerOptions({ platform: 'darwin' }).map(o => o.value).includes(SYN_ID)],
    ['getDashboardOptions', () => ta.getDashboardOptions().includes(SYN_ID)],
    ['getDisplayName', () => ta.getDisplayName(SYN_ID) === 'Ghostty (test)'],
    ['canonicalize by id', () => ta.canonicalize(SYN_ID) === SYN_ID],
    ['canonicalize by alias', () => ta.canonicalize(SYN_ALIAS) === SYN_ID],
    ['isValidId', () => ta.isValidId(SYN_ID)],
    ['getTerminalConfigHelpIds', () => getTerminalConfigHelpIds().includes(SYN_ID)],
];

for (const [label, check] of driftCases) {
    test(`synthetic adapter in ${label}`, () => {
        try { addSyn(); assert.ok(check(), `${label} missing synthetic adapter`); }
        finally { removeSyn(); }
    });
}

removeSyn();
report();
