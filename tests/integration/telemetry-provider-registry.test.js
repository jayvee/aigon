#!/usr/bin/env node
'use strict';

// REGRESSION F634: unknown telemetryStrategy degrades to null provider, not throw
const assert = require('assert');
const { test, report } = require('../_helpers');
const { getProviderByStrategy } = require('../../lib/telemetry/providers/registry');

test('getProviderByStrategy: known strategies resolve to provider modules', () => {
    assert.strictEqual(getProviderByStrategy('claude-transcript').strategyId, 'claude-transcript');
    assert.strictEqual(getProviderByStrategy('codex-transcript').strategyId, 'codex-transcript');
    assert.strictEqual(getProviderByStrategy('gemini-transcript').strategyId, 'gemini-transcript');
});

test('getProviderByStrategy: unknown strategy returns null without throwing', () => {
    assert.strictEqual(getProviderByStrategy('not-a-real-strategy'), null);
    assert.strictEqual(getProviderByStrategy(null), null);
    assert.strictEqual(getProviderByStrategy(''), null);
});

report();
