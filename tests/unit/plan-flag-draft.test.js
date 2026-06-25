#!/usr/bin/env node
// F424: plan-mode flag on spec creation — draft agents launch in plan mode.
'use strict';

const assert = require('assert');
const { test, report } = require('../_helpers');
const { getAgentCliConfig, getAgentLaunchFlagTokens } = require('../../lib/config');

test('cc: planFlag is --permission-mode plan and differs from implementFlag', () => {
    const ccCli = getAgentCliConfig('cc');
    assert.strictEqual(ccCli.planFlag, '--permission-mode plan', 'cc.planFlag must be --permission-mode plan');
    assert.ok(ccCli.implementFlag, 'cc.implementFlag must still be set');
    assert.ok(ccCli.implementFlag !== ccCli.planFlag, 'cc planFlag and implementFlag must differ');
});

test('cc: plan tokens split correctly and precede the prompt in argv', () => {
    const ccCli = getAgentCliConfig('cc');
    const ccTokens = getAgentLaunchFlagTokens('claude', ccCli.planFlag, { autonomous: false });
    assert.deepStrictEqual(ccTokens, ['--permission-mode', 'plan'], 'cc plan tokens must split correctly');
    const ccArgv = [...ccTokens, 'draft the spec'];
    assert.strictEqual(ccArgv[0], '--permission-mode', 'planFlag tokens precede the prompt');
    assert.strictEqual(ccArgv[ccArgv.length - 1], 'draft the spec', 'prompt is last');
});

test('cx: no planFlag — argv only has the sandbox bypass flag', () => {
    const cxCli = getAgentCliConfig('cx');
    assert.ok(cxCli.planFlag === null || cxCli.planFlag === '' || cxCli.planFlag === undefined, 'cx planFlag must be null/empty');
    const cxTokens = getAgentLaunchFlagTokens('codex', cxCli.planFlag, { autonomous: false });
    assert.deepStrictEqual(cxTokens, ['--dangerously-bypass-approvals-and-sandbox'], 'cx plan tokens must only have the sandbox bypass flag');
});

test('ag: no planFlag', () => {
    const agCli = getAgentCliConfig('ag');
    assert.ok(agCli.planFlag === null || agCli.planFlag === '' || agCli.planFlag === undefined, 'ag planFlag must be null/empty');
});

test('cu: planFlag is set and produces non-empty tokens', () => {
    const cuCli = getAgentCliConfig('cu');
    assert.ok(cuCli.planFlag, 'cu planFlag must be set');
    const cuTokens = getAgentLaunchFlagTokens('agent', cuCli.planFlag, { autonomous: false });
    assert.ok(cuTokens.length > 0, 'cu plan tokens must not be empty');
});

test('cc template: planFlag is plan-mode, implementFlag includes acceptEdits', () => {
    const ccCli = getAgentCliConfig('cc');
    assert.ok('implementFlag' in ccCli, 'cc.implementFlag key must exist for spec-review/revise paths');
    assert.ok('planFlag' in ccCli, 'cc.planFlag key must exist alongside implementFlag');
    const ccTemplate = require('../../templates/agents/cc.json');
    assert.strictEqual(ccTemplate.cli.planFlag, '--permission-mode plan', 'cc template planFlag must be --permission-mode plan');
    assert.ok(ccTemplate.cli.implementFlag.includes('acceptEdits'), 'cc template implementFlag must include acceptEdits');
});

report();
