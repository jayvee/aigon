'use strict';

/**
 * feature-draft — launch an interactive agent session to collaboratively
 * draft a feature spec. No commits, no branches, no workflow transitions.
 *
 * The agent runs in the foreground attached to the user's TTY via
 * spawnSync stdio:inherit. The user drives the conversation; aigon just
 * opens the door and checks the file state afterwards.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, execSync } = require('child_process');
const agentRegistry = require('./agent-registry');
const { getAgentCliConfig, getAgentLaunchFlagTokens } = require('./config');

const DRAFT_PROMPT_TEMPLATE = path.join(__dirname, '..', 'templates', 'prompts', 'feature-draft.md');

function _hashFile(filePath) {
    try {
        return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    } catch {
        return null;
    }
}

function _binaryOnPath(bin) {
    try {
        execSync(`command -v ${bin}`, { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

function buildDraftContextMessage(specPath, description) {
    const template = fs.readFileSync(DRAFT_PROMPT_TEMPLATE, 'utf8');
    return template
        .replace(/\{\{SPEC_PATH\}\}/g, () => specPath)
        .replace(/\{\{DESCRIPTION\}\}/g, () => description || '');
}

function _isMeaningfulSectionContent(content) {
    if (!content) return false;
    const normalized = content
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/```[\s\S]*?```/g, '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .filter(line => line !== '-' && line !== '- [ ]' && line !== '[ ]' && line !== '- Research:');
    return normalized.length > 0;
}

function getPopulatedDraftSections(specPath) {
    let content = '';
    try {
        content = fs.readFileSync(specPath, 'utf8');
    } catch {
        return [];
    }

    const sections = ['Summary', 'User Stories', 'Acceptance Criteria', 'Technical Approach'];
    return sections.filter(section => {
        const match = content.match(new RegExp(`^## ${section}\\r?\\n([\\s\\S]*?)(?=^## |\\Z)`, 'm'));
        return _isMeaningfulSectionContent(match && match[1]);
    });
}

/**
 * Launch the named agent interactively with the drafting context message
 * as the opening turn. Blocks until the agent session exits.
 *
 * @param {string} specPath Absolute or relative path to the bare spec file
 * @param {string} agentId  Agent id (cc, gg, cx, cu, ...)
 * @param {string} description The short description the user passed on the CLI
 * @returns {number|null} The child exit code, or null if we never launched.
 */
function draftSpecWithAgent(specPath, agentId, description) {
    const agent = agentRegistry.getAgent(agentId);
    if (!agent) {
        const valid = agentRegistry.getAllAgentIds().join(', ');
        console.error(`❌ Unknown agent '${agentId}'. Valid agents: ${valid}`);
        return null;
    }

    const binary = agent.cli && agent.cli.command;
    if (!binary) {
        console.error(`❌ Agent '${agentId}' has no CLI command configured.`);
        return null;
    }

    if (!_binaryOnPath(binary)) {
        const hint = agent.installHint ? `  Install with: ${agent.installHint}` : '';
        console.error(`❌ Agent '${agentId}' requires the \`${binary}\` CLI on your PATH.`);
        if (hint) console.error(hint);
        console.error(`\nThe bare spec was still created at ${specPath} — you can fill it in manually or rerun with --agent once the CLI is installed.`);
        return null;
    }

    const cliConfig = getAgentCliConfig(agentId);
    const flagTokens = getAgentLaunchFlagTokens(binary, cliConfig.planFlag, { autonomous: false });
    const contextMessage = buildDraftContextMessage(specPath, description);
    const beforeHash = _hashFile(specPath);

    console.log(`\n🖊️  Launching ${agent.displayName || agent.name} to draft the spec...`);
    console.log(`   Spec: ${specPath}`);
    console.log(`   Exit the agent session (e.g. /exit) when you're done.\n`);

    // Unset CLAUDECODE when spawning claude from inside another Claude Code
    // session so the child does not error with "nested session".
    const env = { ...process.env };
    if (binary === 'claude') {
        delete env.CLAUDECODE;
    }
    env.AIGON_ACTIVITY = 'draft';

    const result = spawnSync(binary, [...flagTokens, contextMessage], {
        stdio: 'inherit',
        cwd: process.cwd(),
        env,
    });

    const afterHash = _hashFile(specPath);
    const unchanged = beforeHash && afterHash && beforeHash === afterHash;

    console.log('');
    if (unchanged) {
        console.warn(`⚠️  The spec file was not modified during the session.`);
        console.warn(`   The bare spec is still at ${specPath}.`);
        console.warn(`   You can re-run with --agent, or fill it in manually.`);
    } else {
        const slug = path.basename(specPath).replace(/^feature-/, '').replace(/\.md$/, '');
        const populatedSections = getPopulatedDraftSections(specPath);
        console.log(`✓ Spec drafted at ${specPath}`);
        console.log(`  Sections populated: ${populatedSections.length ? populatedSections.join(', ') : 'none detected beyond template'}`);
        console.log(`  Next: aigon feature-prioritise ${slug}`);
    }

    return result.status;
}

module.exports = {
    draftSpecWithAgent,
    buildDraftContextMessage,
    getPopulatedDraftSections,
};
