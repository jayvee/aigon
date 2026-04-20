#!/usr/bin/env node
// REGRESSION feature 291: per-feature {agent, model, effort} triplet captured on
// feature.started must survive every respawn path. Exercises the four load-bearing
// seams:
//   1. projector — `feature.started` { modelOverrides, effortOverrides }
//      populates snapshot.agents[id].modelOverride/effortOverride
//   2. resolveLaunchTriplet — precedence: event override > stage default > null
//   3. buildAgentLaunchInvocation — produces the right CLI args per agent:
//      - cc: `--model <m>`, no effort flag (effort ignored silently)
//      - cx: `--model <m>` + `-c model_reasoning_effort=<e>` (fused flag)
//      - cu: no flag emitted (agent cannot inject model/effort)
//   4. stats-aggregate — perTriplet rollup keyed on `${agent}|${model}|${effort}`
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { projectContext } = require('../../lib/workflow-core/projector');
const { resolveLaunchTriplet, buildAgentLaunchInvocation } = require('../../lib/agent-launch');
const sa = require('../../lib/stats-aggregate');

function makeStartedEvent(overrides = {}) {
    return {
        type: 'feature.started',
        featureId: '291',
        at: '2026-04-20T10:00:00Z',
        mode: 'solo_branch',
        agents: ['cc', 'cx', 'gg'],
        ...overrides,
    };
}

// --- (1) projector surfaces overrides per agent -----------------------------
{
    const ctx = projectContext([
        makeStartedEvent({
            modelOverrides: { cc: 'sonnet-4-6', cx: 'gpt-5.4' },
            effortOverrides: { cx: 'high' },
        }),
    ]);
    assert.strictEqual(ctx.agents.cc.modelOverride, 'sonnet-4-6', 'cc model override projected');
    assert.strictEqual(ctx.agents.cc.effortOverride, null, 'cc has no effort override');
    assert.strictEqual(ctx.agents.cx.modelOverride, 'gpt-5.4', 'cx model override projected');
    assert.strictEqual(ctx.agents.cx.effortOverride, 'high', 'cx effort override projected');
    assert.strictEqual(ctx.agents.gg.modelOverride, null, 'gg has no model override');
    assert.strictEqual(ctx.agents.gg.effortOverride, null, 'gg has no effort override');
    console.log('  ✓ projector: feature.started overrides populate snapshot.agents[id]');
}

// --- (1b) projector with no overrides emits null fields (not undefined) -----
{
    const ctx = projectContext([makeStartedEvent()]);
    assert.strictEqual(ctx.agents.cc.modelOverride, null);
    assert.strictEqual(ctx.agents.cc.effortOverride, null);
    console.log('  ✓ projector: missing overrides default to null, not undefined');
}

// --- (2) resolveLaunchTriplet precedence ------------------------------------
{
    // event override wins over stage default
    const snap = { agents: { cc: { modelOverride: 'sonnet-4-6', effortOverride: null } } };
    const r1 = resolveLaunchTriplet({ agentId: 'cc', snapshot: snap, stageDefaultModel: 'opus-4-7' });
    assert.strictEqual(r1.model, 'sonnet-4-6', 'event override wins');
    assert.strictEqual(r1.modelSource, 'event');

    // no override → stage default
    const snap2 = { agents: { cc: { modelOverride: null, effortOverride: null } } };
    const r2 = resolveLaunchTriplet({ agentId: 'cc', snapshot: snap2, stageDefaultModel: 'opus-4-7' });
    assert.strictEqual(r2.model, 'opus-4-7');
    assert.strictEqual(r2.modelSource, 'config');

    // no override, no default → null
    const r3 = resolveLaunchTriplet({ agentId: 'cc', snapshot: snap2, stageDefaultModel: null });
    assert.strictEqual(r3.model, null);
    assert.strictEqual(r3.modelSource, 'none');

    // snapshot absent — should not throw
    const r4 = resolveLaunchTriplet({ agentId: 'cc', snapshot: null, stageDefaultModel: 'opus-4-7' });
    assert.strictEqual(r4.model, 'opus-4-7');

    console.log('  ✓ resolveLaunchTriplet: override > stageDefault > null');
}

// --- (3) buildAgentLaunchInvocation per-agent CLI fragments -----------------
{
    const snap = {
        agents: {
            cc: { modelOverride: 'sonnet-4-6', effortOverride: 'high' },
            cx: { modelOverride: 'gpt-5.4', effortOverride: 'high' },
            cu: { modelOverride: 'whatever', effortOverride: 'high' },
        },
    };

    // cc: model flag present, no effort injection
    const cc = buildAgentLaunchInvocation({ agentId: 'cc', snapshot: snap });
    assert.deepStrictEqual(cc.args, ['--model sonnet-4-6'], 'cc emits --model but no effort flag');
    assert.deepStrictEqual(cc.envExports, []);

    // cx: model flag + fused effort flag via `-c ...=<value>`
    const cx = buildAgentLaunchInvocation({ agentId: 'cx', snapshot: snap });
    assert.deepStrictEqual(cx.args, ['--model gpt-5.4', '-c model_reasoning_effort=high'],
        'cx fuses effort onto -c model_reasoning_effort=');

    // cu: no modelFlag, no effortFlag — nothing emitted
    const cu = buildAgentLaunchInvocation({ agentId: 'cu', snapshot: snap });
    assert.deepStrictEqual(cu.args, [], 'cu emits nothing even though triplet is set');

    console.log('  ✓ buildAgentLaunchInvocation: per-agent CLI args match agent JSON flags');
}

// --- (3b) shell-quoting for unsafe values -----------------------------------
{
    const snap = { agents: { cc: { modelOverride: "weird model'name" } } };
    const inv = buildAgentLaunchInvocation({ agentId: 'cc', snapshot: snap });
    // Should be single-quoted with embedded quote escaped
    assert.ok(inv.args[0].startsWith("--model '"), 'value requiring quoting is quoted');
    assert.ok(inv.args[0].includes("'\\''"), 'single-quote is backslash-escaped');
    console.log('  ✓ buildAgentLaunchInvocation: shell-quotes values with special characters');
}

// --- (4) stats-aggregate perTriplet rollup ----------------------------------
{
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-triplet-'));
    try {
        const mk = (id, obj) => {
            const d = path.join(tmp, '.aigon', 'workflows', 'features', id);
            fs.mkdirSync(d, { recursive: true });
            fs.writeFileSync(path.join(d, 'stats.json'), JSON.stringify(obj));
        };
        mk('300', {
            completedAt: '2026-04-20T00:00:00Z',
            durationMs: 300000, commitCount: 2,
            cost: {
                estimatedUsd: 1.5,
                byAgent: {
                    cc: { costUsd: 1.0, sessions: 1, model: 'sonnet-4-6', modelOverride: 'sonnet-4-6', effortOverride: null },
                    cx: { costUsd: 0.5, sessions: 2, model: 'gpt-5.4', modelOverride: 'gpt-5.4', effortOverride: 'high' },
                },
            },
        });
        // Second feature with cc on a different model → different triplet key
        mk('301', {
            completedAt: '2026-04-21T00:00:00Z',
            durationMs: 600000, commitCount: 1,
            cost: {
                estimatedUsd: 2.0,
                byAgent: {
                    cc: { costUsd: 2.0, sessions: 1, model: 'opus-4-7', modelOverride: 'opus-4-7', effortOverride: null },
                },
            },
        });

        const ag = sa.rebuildAggregate(tmp);
        assert.ok(ag.perTriplet, 'perTriplet rollup exists');

        const tripletKeys = Object.keys(ag.perTriplet).sort();
        assert.deepStrictEqual(tripletKeys.sort(), [
            'cc|opus-4-7|',
            'cc|sonnet-4-6|',
            'cx|gpt-5.4|high',
        ].sort(), 'triplet keys encode agent|model|effort');

        assert.strictEqual(ag.perTriplet['cc|sonnet-4-6|'].cost, 1.0);
        assert.strictEqual(ag.perTriplet['cc|sonnet-4-6|'].features, 1);
        assert.strictEqual(ag.perTriplet['cc|opus-4-7|'].cost, 2.0);
        assert.strictEqual(ag.perTriplet['cx|gpt-5.4|high'].cost, 0.5);
        assert.strictEqual(ag.perTriplet['cx|gpt-5.4|high'].effort, 'high');
        assert.strictEqual(ag.perTriplet['cx|gpt-5.4|high'].sessions, 2);

        console.log('  ✓ stats-aggregate: perTriplet rollup splits cost by {agent,model,effort}');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

// --- (4b) stats-aggregate CACHE_VERSION bumped on schema change -------------
assert.ok(sa.CACHE_VERSION >= 2, 'CACHE_VERSION must be bumped when perTriplet is added');
console.log('  ✓ stats-aggregate: CACHE_VERSION bumped to invalidate pre-feature-291 caches');

console.log('\nfeature 291 override regression tests passed');
