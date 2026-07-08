#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, report } = require('../_helpers');
const {
    validateFeatureAutonomousPayload,
    buildFeatureAutonomousCliArgv,
} = require('../../lib/feature-autonomous-payload');
const { buildAgentLaunchInvocation } = require('../../lib/agent-launch');
const { parseAgentOverrideMap } = require('../../lib/cli-parse');

const registry = {
    getAllAgentIds: () => ['cc', 'cx', 'gg', 'cu'],
    // F592: payload validation resolves launchable (non-deactivated) agents.
    getLaunchableAgentIds: () => ['cc', 'cx', 'cu'],
};

test('autonomous payload serializes reviewer triplets with parseable agent=value entries', () => {
    const validated = validateFeatureAutonomousPayload({
        featureId: '10',
        agents: ['cc'],
        stopAfter: 'close',
        reviewAgent: 'cx',
        models: 'cc=sonnet',
        efforts: 'cc=high',
        reviewModel: 'gpt-5.4-mini',
        reviewEffort: 'low',
    }, registry);
    assert.strictEqual(validated.ok, true);
    assert.strictEqual(validated.normalized.modelsCsv, 'cc=sonnet,cx=gpt-5.4-mini');
    assert.strictEqual(validated.normalized.effortsCsv, 'cc=high,cx=low');
    const argv = buildFeatureAutonomousCliArgv(validated.normalized);
    assert.ok(argv.includes('--models=cc=sonnet,cx=gpt-5.4-mini'));
    assert.ok(argv.includes('--efforts=cc=high,cx=low'));
});

test('agent override parser keeps legacy autonomous agent:value payloads readable', () => {
    assert.deepStrictEqual(parseAgentOverrideMap('cc=sonnet,cx:gpt-5.4-mini,gg:none'), {
        cc: 'sonnet',
        cx: 'gpt-5.4-mini',
        gg: null,
    });
});

test('AutoConductor user-facing start forwards triplets into the inner run-loop', () => {
    const body = fs.readFileSync(path.join(__dirname, '../../lib/feature-autonomous.js'), 'utf8');
    assert.ok(body.includes('loopCmdParts.push(`--models=${modelsForChild}`)'), 'models must reach __run-loop');
    assert.ok(body.includes('loopCmdParts.push(`--efforts=${effortsForChild}`)'), 'efforts must reach __run-loop');
    assert.ok(body.includes('launcherModel: getAgentOverride(loopModelOverrides, reviewAgent)'), 'review launch must use reviewer model override');
    assert.ok(body.includes('launcherModel: getAgentOverride(loopModelOverrides, effectiveEvalAgent)'), 'eval launch must use evaluator model override');
});

test('launch resolution ignores stale configured models that are no longer in the agent picker', () => {
    const stale = buildAgentLaunchInvocation({
        agentId: 'cx',
        snapshot: null,
        stageDefaultModel: 'gpt-5.1-codex-mini',
    });
    assert.strictEqual(stale.resolved.model, null);
    assert.deepStrictEqual(stale.args, []);

    const current = buildAgentLaunchInvocation({
        agentId: 'cx',
        snapshot: null,
        stageDefaultModel: 'gpt-5.4-mini',
    });
    assert.strictEqual(current.resolved.model, 'gpt-5.4-mini');
    assert.ok(current.args.some(arg => arg.includes('--model gpt-5.4-mini')));
});

// REGRESSION: failover must not pass the exhausted agent's modelOverride to the replacement runtime agent.
test('launch resolution ignores slot modelOverride when invalid for replacement agent', () => {
    const snapshot = {
        agents: {
            cc: {
                modelOverride: 'claude-opus-4-8',
                effortOverride: 'medium',
                currentAgentId: 'cx',
            },
        },
    };
    const failover = buildAgentLaunchInvocation({
        agentId: 'cx',
        slotAgentId: 'cc',
        snapshot,
        stageDefaultModel: 'gpt-5.5',
    });
    assert.strictEqual(failover.resolved.model, 'gpt-5.5');
    assert.strictEqual(failover.resolved.modelSource, 'config');
    assert.ok(failover.args.some((arg) => arg.includes('--model gpt-5.5')));

    const handoff = buildAgentLaunchInvocation({
        agentId: 'cu',
        slotAgentId: 'cc',
        snapshot,
        stageDefaultModel: 'composer-2.5',
        launcherModel: 'composer-2.5',
    });
    assert.strictEqual(handoff.resolved.model, 'composer-2.5');
    assert.strictEqual(handoff.resolved.modelSource, 'launcher');
});

report();
