#!/usr/bin/env node
'use strict';

const a = require('assert');
const { test, report } = require('../_helpers');
const { resolveFeatureBranchForPrStatus, getFeaturePrStatusPayload } = require('../../lib/dashboard-server');

const branchResolverOptions = (overrides = {}) => ({
    readFeatureSnapshotSync: overrides.readFeatureSnapshotSync || (() => ({ agents: { cx: {} } })),
    resolveFeatureSpec: overrides.resolveFeatureSpec || (() => ({
        path: '/tmp/repo/docs/specs/features/03-in-progress/feature-256-github-pr-status-endpoint.md'
    })),
    listRepoBranches: overrides.listRepoBranches || (() => ['feature-256-cx-github-pr-status-endpoint']),
});

console.log('dashboard-pr-status-endpoint');

test('resolves solo worktree branch from snapshot agent', () => {
    const r = resolveFeatureBranchForPrStatus('/tmp/repo', '256', branchResolverOptions());
    a.ok(r.ok);
    a.strictEqual(r.branchName, 'feature-256-cx-github-pr-status-endpoint');
});

test('returns unavailable when multiple agent branches exist', () => {
    const r = resolveFeatureBranchForPrStatus('/tmp/repo', '256', branchResolverOptions({
        readFeatureSnapshotSync: () => ({ agents: {} }),
        listRepoBranches: () => [
            'feature-256-cx-github-pr-status-endpoint',
            'feature-256-cc-github-pr-status-endpoint',
        ],
    }));
    a.ok(!r.ok);
    a.match(r.message, /Multiple agent branches/);
});

test('pr payload returns non-GitHub remote unavailable shape', () => {
    const r = getFeaturePrStatusPayload('/tmp/repo', '256', {
        ...branchResolverOptions(),
        execFn: (cmd) => {
            if (cmd === 'git remote get-url origin') return 'https://gitlab.com/test/repo.git';
            return '';
        }
    });
    a.deepStrictEqual(r, {
        provider: null,
        status: 'unavailable',
        message: 'Not a GitHub remote',
    });
});

report();
