'use strict';

/**
 * agent-launch — internal CLI subcommand used by the scheduler's
 * `agent_prompt` kind. Spawns a fresh agent session in a tmux tab,
 * delivering an arbitrary prompt or slash-command as the first user input.
 *
 * Not user-facing: typically invoked by `lib/scheduled-kickoff.js` once a
 * scheduled `agent_prompt` job is due. Run directly with
 *   aigon agent-launch --agent <id> --prompt <string> [--repo <path>] [--label <slug>]
 * if you need to reproduce the spawn outside the scheduler.
 */

const path = require('path');

const { parseCliOptions, getOptionValue } = require('../cli-parse');
const agentRegistry = require('../agent-registry');
const wt = require('../worktree');

function _usage() {
    console.error(`Usage: aigon agent-launch --agent <id> --prompt <string> [--repo <path>] [--label <slug>]

Spawns a fresh agent session in a tmux tab, delivering --prompt as the first
user input. --prompt may be a literal string or a slash command (e.g.
"/security-review"). --label is used to name the tmux session. --repo defaults
to the current working directory.`);
}

function _shellQuote(s) {
    if (s === null || s === undefined) return '';
    const v = String(s);
    if (/^[A-Za-z0-9_./:=-]+$/.test(v)) return v;
    return `'${v.replace(/'/g, "'\\''")}'`;
}

function createAgentLaunchCommands() {
    return {
        'agent-launch': (args) => {
            const opts = parseCliOptions(args || []);
            const agentId = String(getOptionValue(opts, 'agent') || '').trim();
            const prompt = String(getOptionValue(opts, 'prompt') || '');
            const repoOpt = String(getOptionValue(opts, 'repo') || '').trim();
            const label = String(getOptionValue(opts, 'label') || '').trim() || `prompt-${Date.now().toString(36)}`;

            if (!agentId || !prompt) {
                _usage();
                process.exitCode = 1;
                return;
            }

            const knownAgents = new Set(agentRegistry.getAllAgentIds());
            if (!knownAgents.has(agentId)) {
                console.error(`❌ Unknown agent: ${agentId}`);
                process.exitCode = 1;
                return;
            }

            const repoPath = path.resolve(repoOpt || process.cwd());

            const cliConfigFn = require('../config').getAgentCliConfig;
            const cliConfig = cliConfigFn(agentId, repoPath);
            const command = cliConfig.command;
            if (!command) {
                console.error(`❌ Agent ${agentId} has no CLI command configured`);
                process.exitCode = 1;
                return;
            }

            // Build agent invocation: <command> <implementFlags> --model <m> -p '<prompt>'
            const flagTokens = require('../config').getAgentLaunchFlagTokens(command, cliConfig.implementFlag, { autonomous: false });
            const model = cliConfig.models?.implement || cliConfig.models?.review || null;
            const modelTokens = (model && agentRegistry.supportsModelFlag(agentId)) ? ['--model', model] : [];
            const promptFlag = agentRegistry.getPromptFlag(agentId);
            const promptTokens = promptFlag ? [promptFlag, _shellQuote(prompt)] : [_shellQuote(prompt)];

            // Unset CLAUDECODE before launching claude so a parent Claude
            // process does not get a "nested session" error.
            const prefix = command === 'claude' ? 'unset CLAUDECODE && ' : '';
            const cdPrefix = `cd ${_shellQuote(repoPath)} && `;
            const fullCommand = `${cdPrefix}${prefix}${command} ${[...flagTokens, ...modelTokens, ...promptTokens].filter(Boolean).join(' ')}`;

            // Build a tmux session name that doesn't collide with feature/research
            // sessions. parseTmuxSessionName never matches a `-prompt-` segment.
            const repoName = path.basename(repoPath).replace(/[^A-Za-z0-9-]/g, '-').toLowerCase() || 'repo';
            const sessionName = `${repoName}-prompt-${label}-${agentId}`;

            try {
                wt.assertTmuxAvailable();
            } catch (e) {
                console.error(`❌ ${e.message}`);
                process.exitCode = 1;
                return;
            }

            if (wt.tmuxSessionExists(sessionName)) {
                console.error(`❌ tmux session already exists: ${sessionName}`);
                process.exitCode = 1;
                return;
            }

            try {
                wt.createDetachedTmuxSession(sessionName, repoPath, fullCommand, {
                    repoPath,
                    category: 'repo',
                    agent: agentId,
                    worktreePath: repoPath,
                });
            } catch (e) {
                console.error(`❌ Failed to create tmux session: ${e.message}`);
                process.exitCode = 1;
                return;
            }

            // Best-effort terminal-tab open. In test mode (AIGON_TEST_MODE=1) and
            // in headless contexts (no GUI terminal), this no-ops with a hint.
            try {
                wt.openTerminalAppWithCommand(repoPath, `tmux attach -t ${_shellQuote(sessionName)}`, sessionName);
            } catch (e) {
                console.warn(`⚠️  Could not open terminal tab automatically: ${e.message}`);
                console.warn(`   Attach manually: tmux attach -t ${sessionName}`);
            }

            console.log(`🚀 Launched ${agentId} in tmux session ${sessionName}`);
            console.log(`   Repo:   ${repoPath}`);
            console.log(`   Prompt: ${prompt.length > 80 ? prompt.slice(0, 77) + '…' : prompt}`);
        },
    };
}

module.exports = { createAgentLaunchCommands };
