#!/usr/bin/env node
// REGRESSION feature 291: per-feature {agent,model,effort} captured on feature.started
// must round-trip through projector→snapshot→resolveLaunchTriplet→buildAgentLaunchInvocation.
// Covers: projector precedence, cc plain --model, cx fused -c model_reasoning_effort=, cu emits nothing, dashboard launcher beats snapshot.
'use strict';
const a = require('assert');
const { projectContext } = require('../../lib/workflow-core/projector');
const { resolveLaunchTriplet, buildAgentLaunchInvocation } = require('../../lib/agent-launch');
const ctx = projectContext([{ type:'feature.started', featureId:'291', at:'2026-04-20T10:00:00Z', mode:'solo', agents:['cc','cx','gg'], modelOverrides:{cc:'sonnet-4-6',cx:'gpt-5.4'}, effortOverrides:{cx:'high'} }]);
a.strictEqual(ctx.agents.cc.modelOverride, 'sonnet-4-6'); a.strictEqual(ctx.agents.cx.effortOverride, 'high'); a.strictEqual(ctx.agents.gg.modelOverride, null);
const snap = { agents:{ cc:{modelOverride:'sonnet-4-6'} } };
a.strictEqual(resolveLaunchTriplet({agentId:'cc',snapshot:snap,stageDefaultModel:'opus-4-7'}).modelSource, 'event');
a.strictEqual(resolveLaunchTriplet({agentId:'cc',snapshot:null,stageDefaultModel:'opus-4-7'}).model, 'opus-4-7');
a.strictEqual(resolveLaunchTriplet({agentId:'cc',snapshot:{agents:{}},stageDefaultModel:null}).model, null);
const s3 = { agents:{ cc:{modelOverride:'sonnet-4-6',effortOverride:'high'}, cx:{modelOverride:'gpt-5.4',effortOverride:'high'}, cu:{modelOverride:'x',effortOverride:'high'} } };
a.deepStrictEqual(buildAgentLaunchInvocation({agentId:'cc',snapshot:s3}).args, ['--model sonnet-4-6', '--effort high']);
a.deepStrictEqual(buildAgentLaunchInvocation({agentId:'cx',snapshot:s3}).args, ['--model gpt-5.4','-c model_reasoning_effort=high']);
a.deepStrictEqual(buildAgentLaunchInvocation({agentId:'cu',snapshot:s3}).args, []);
a.deepStrictEqual(resolveLaunchTriplet({agentId:'cc',snapshot:snap,stageDefaultModel:'opus-4-7',launcherModel:'haiku'}), {model:'haiku',effort:null,modelSource:'launcher',effortSource:'none'});
a.deepStrictEqual(buildAgentLaunchInvocation({agentId:'cx',snapshot:s3,launcherModel:'gpt-5-mini',launcherEffort:'low'}).args, ['--model gpt-5-mini','-c model_reasoning_effort=low']);
console.log('  ✓ feature 291 override regression tests passed');
