'use strict';

const { parseCliOptions, getOptionValue } = require('../cli-parse');
const agentAvailability = require('../agent-availability');
const agentRegistry = require('../agent-registry');

function createAgentCommands() {
    return {
        agent: async (args) => {
            const sub = String(args[0] || '').trim().toLowerCase();
            const rest = args.slice(1);
            if (sub === 'disable') return agentDisable(rest);
            if (sub === 'enable') return agentEnable(rest);
            if (sub === 'availability') return agentAvailabilityCmd(rest);
            printAgentHelp();
            process.exitCode = sub ? 1 : 0;
        },
    };
}

function resolveScope(options) {
    if (getOptionValue(options, 'project') !== undefined) return 'project';
    if (getOptionValue(options, 'global') !== undefined) return 'global';
    return 'global';
}

function resolveAgentArg(options) {
    const raw = options._[0];
    if (!raw) return null;
    return agentAvailability.normalizeAgentId(raw);
}

function agentDisable(args) {
    const options = parseCliOptions(args);
    const agentId = resolveAgentArg(options);
    if (!agentId) {
        console.error('Usage: aigon agent disable <agent> [--reason=<reason>] [--note=<text>] [--global|--project]');
        process.exitCode = 1;
        return;
    }
    if (!agentRegistry.getAgent(agentId)) {
        console.error(`❌ Unknown agent '${options._[0]}'.`);
        process.exitCode = 1;
        return;
    }
    const scope = resolveScope(options);
    const reason = String(getOptionValue(options, 'reason') || 'manual').trim();
    const note = getOptionValue(options, 'note');
    try {
        agentAvailability.disableAgent(agentId, {
            reason,
            note: note != null ? String(note) : null,
            scope,
            repoPath: process.cwd(),
        });
        console.log(`✅ Disabled agent '${agentId}' (${scope}, reason: ${reason}).`);
    } catch (e) {
        console.error(`❌ ${e.message}`);
        process.exitCode = 1;
    }
}

function agentEnable(args) {
    const options = parseCliOptions(args);
    const agentId = resolveAgentArg(options);
    if (!agentId) {
        console.error('Usage: aigon agent enable <agent> [--global|--project]');
        process.exitCode = 1;
        return;
    }
    if (!agentRegistry.getAgent(agentId)) {
        console.error(`❌ Unknown agent '${options._[0]}'.`);
        process.exitCode = 1;
        return;
    }
    const scope = resolveScope(options);
    try {
        agentAvailability.enableAgent(agentId, { scope, repoPath: process.cwd() });
        console.log(`✅ Enabled agent '${agentId}' (${scope}).`);
    } catch (e) {
        console.error(`❌ ${e.message}`);
        process.exitCode = 1;
    }
}

function agentAvailabilityCmd(args) {
    const options = parseCliOptions(args);
    const includeAll = getOptionValue(options, 'all') !== undefined;
    process.stdout.write(agentAvailability.formatAvailabilityReport(process.cwd(), { includeAll }));
}

function printAgentHelp() {
    console.error('Usage: aigon agent <disable|enable|availability>');
    console.error('  disable <agent> [--reason=<reason>] [--note=<text>] [--global|--project]');
    console.error('  enable <agent> [--global|--project]');
    console.error('  availability [--all]');
}

module.exports = { createAgentCommands };
