#!/usr/bin/env node
// Feature 424: plan-mode flag on spec creation — draft agents launch in plan mode.
'use strict';
const a = require('assert');
const { getAgentCliConfig, getAgentLaunchFlagTokens } = require('../../lib/config');

// (a) cc resolves planFlag and argv includes --permission-mode plan ahead of prompt
const ccCli = getAgentCliConfig('cc');
a.strictEqual(ccCli.planFlag, '--permission-mode plan', 'cc.planFlag must be --permission-mode plan');
a.ok(ccCli.implementFlag, 'cc.implementFlag must still be set');
a.ok(ccCli.implementFlag !== ccCli.planFlag, 'cc planFlag and implementFlag must differ');

const ccTokens = getAgentLaunchFlagTokens('claude', ccCli.planFlag, { autonomous: false });
a.deepStrictEqual(ccTokens, ['--permission-mode', 'plan'], 'cc plan tokens must split correctly');

const prompt = 'draft the spec';
const ccArgv = [...ccTokens, prompt];
a.strictEqual(ccArgv[0], '--permission-mode', 'planFlag tokens precede the prompt');
a.strictEqual(ccArgv[ccArgv.length - 1], prompt, 'prompt is last');

// (b) cx has no planFlag — argv is unchanged (no spurious flags)
const cxCli = getAgentCliConfig('cx');
a.ok(cxCli.planFlag === null || cxCli.planFlag === '' || cxCli.planFlag === undefined,
    'cx planFlag must be null/empty');
const cxTokens = getAgentLaunchFlagTokens('codex', cxCli.planFlag, { autonomous: false });
a.deepStrictEqual(cxTokens, [], 'cx plan tokens must be empty');
const cxArgv = [...cxTokens, prompt];
a.deepStrictEqual(cxArgv, [prompt], 'cx argv is just the prompt — unchanged from today');

// gg also has no planFlag
const ggCli = getAgentCliConfig('gg');
a.ok(ggCli.planFlag === null || ggCli.planFlag === '' || ggCli.planFlag === undefined,
    'gg planFlag must be null/empty');

// cu has planFlag
const cuCli = getAgentCliConfig('cu');
a.ok(cuCli.planFlag, 'cu planFlag must be set');
const cuTokens = getAgentLaunchFlagTokens('agent', cuCli.planFlag, { autonomous: false });
a.ok(cuTokens.length > 0, 'cu plan tokens must not be empty');

// (c) spec-review launchers use implementFlag — verify getAgentCliConfig exposes both
//     so entity-commands.js can still pick implementFlag for review/revise paths
a.ok('implementFlag' in ccCli, 'cc.implementFlag key must exist for spec-review/revise paths');
a.ok('planFlag' in ccCli, 'cc.planFlag key must exist alongside implementFlag');
// planFlag from the template must be plan-mode, not acceptEdits
const ccTemplatePlanFlag = require('../../templates/agents/cc.json').cli.planFlag;
a.strictEqual(ccTemplatePlanFlag, '--permission-mode plan',
    'cc template planFlag must be --permission-mode plan');
const ccTemplateImplFlag = require('../../templates/agents/cc.json').cli.implementFlag;
a.ok(ccTemplateImplFlag.includes('acceptEdits'),
    'cc template implementFlag must include acceptEdits (for spec-review/revise)');

console.log('  ✓ feature 424 plan-flag-draft tests passed');
