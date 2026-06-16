'use strict';

const fs = require('fs');
const path = require('path');
const agentRegistry = require('../../agent-registry');
const { getAvailableAgents } = require('../../utils');

module.exports = function trustWorktreeCommand() {
    return (args = []) => {
        const targetPath = args[0] || process.cwd();
        const resolvedPath = path.resolve(targetPath);
        if (!fs.existsSync(resolvedPath)) {
            console.error(`❌ Path does not exist: ${resolvedPath}`);
            return;
        }
        const agents = getAvailableAgents();
        let trusted = 0;
        agents.forEach(agentId => {
            try {
                agentRegistry.ensureAgentTrust(agentId, [resolvedPath]);
                trusted++;
            } catch (_) { /* ignore agents that don't support trust */ }
        });
        if (trusted > 0) {
            console.log(`✅ Trusted ${resolvedPath} for ${trusted} agent(s)`);
        } else {
            console.log(`⚠️  No agents to trust — run 'aigon install-agent' first`);
        }
    };
};
