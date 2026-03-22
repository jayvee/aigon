'use strict';

const fs = require('fs');
const path = require('path');
const { readAgentStatus, writeAgentStatus } = require('../manifest');
const { assertOnDefaultBranch } = require('../git');
const { runSecurityScan } = require('../security');

module.exports = function researchCommands(ctx) {
    const u = ctx.utils;

    const {
        PATHS,
        slugify,
        readTemplate,
        createSpecFile,
        findFile,
        findUnprioritizedFile,
        moveFile,
        getNextId,
        printError,
        printAgentContextWarning,
        loadAgentConfig,
        buildResearchAgentCommand,
        buildResearchTmuxSessionName,
        getEffectiveConfig,
        assertTmuxAvailable,
        ensureAgentSessions,
        openTerminalAppWithCommand,
        openInWarpSplitPanes,
        shellQuote,
        tmuxSessionExists,
        safeTmuxSessionExists,
        createDetachedTmuxSession,
        parseCliOptions,
        getOptionValue,
    } = u;

    const {
        loadBoardMapping,
    } = ctx.board;

    // Helper functions for synthesis agent checking
    function collectIncompleteResearchSynthesisAgents({ researchNum, logsDir, loadAgentConfigFn }) {
        if (!logsDir || !fs.existsSync(logsDir)) return [];

        const incompleteAgents = [];
        const findingsFiles = fs.readdirSync(logsDir)
            .filter(f => f.startsWith(`research-${researchNum}-`) && f.endsWith('-findings.md'))
            .sort();

        findingsFiles.forEach(file => {
            const match = file.match(/^research-\d+-([a-z]{2})-findings\.md$/);
            if (!match) return;

            try {
                const agent = match[1];
                const agentState = readAgentStatus(researchNum, agent);
                const status = agentState ? (agentState.status || 'unknown') : 'unknown';
                if (status !== 'submitted') {
                    const agentConfig = loadAgentConfigFn(agent);
                    incompleteAgents.push({
                        agent,
                        name: agentConfig?.name || agent,
                        status
                    });
                }
            } catch (e) { /* skip on read error */ }
        });

        return incompleteAgents;
    }

    return {
        'research-create': (args) => {
            try { assertOnDefaultBranch(); } catch (e) { return console.error(`❌ ${e.message}`); }
            const name = args[0];
            createSpecFile({
                input: name,
                usage: 'aigon research-create <name>',
                example: 'aigon research-create api-design',
                inboxDir: path.join(PATHS.research.root, '01-inbox'),
                existsLabel: 'Research topic',
                build: (value) => {
                    const slug = slugify(value);
                    const filename = `research-${slug}.md`;
                    const filePath = path.join(PATHS.research.root, '01-inbox', filename);
                    const template = readTemplate('specs/research-template.md');
                    return {
                        filename,
                        filePath,
                        content: template.replace(/\{\{NAME\}\}/g, value),
                        nextMessage: `📝 Edit the topic, then prioritise it using command: research-prioritise ${slug}`
                    };
                }
            });
        },

        'research-prioritise': (args) => {
            try { assertOnDefaultBranch(); } catch (e) { return console.error(`❌ ${e.message}`); }
            let name = args[0];
            if (!name) return console.error("Usage: aigon research-prioritise <name or letter>");

            // Check if argument is a single letter (from board mapping)
            if (name.length === 1 && name >= 'a' && name <= 'z') {
                const mapping = loadBoardMapping();
                if (mapping && mapping.research[name]) {
                    const mappedName = mapping.research[name];
                    console.log(`📍 Letter '${name}' maps to: ${mappedName}`);
                    name = mappedName;
                } else {
                    return console.error(`❌ Letter '${name}' not found in board mapping. Run 'aigon board' first.`);
                }
            }

            const found = findUnprioritizedFile(PATHS.research, name);
            if (!found) return printError('unprioritized research', name, 'Run `aigon research-create <name>` first.');
            const nextId = getNextId(PATHS.research);
            const paddedId = String(nextId).padStart(2, '0');
            // Transform: research-topic-name.md -> research-55-topic-name.md
            const prefix = PATHS.research.prefix;
            const baseName = found.file.replace(/\.md$/, '').replace(new RegExp(`^${prefix}-`), '');
            const newName = `${prefix}-${paddedId}-${baseName}.md`;
            moveFile(found, '02-backlog', newName, { actor: 'cli/research-prioritise' });
            console.log(`📋 Assigned ID: ${paddedId}`);
        },

        'research-start': (args) => {
            try { assertOnDefaultBranch(); } catch (e) { return console.error(`❌ ${e.message}`); }
            const options = parseCliOptions(args);
            const id = options._[0];
            const agentIds = options._.slice(1);
            const mode = agentIds.length > 0 ? 'fleet' : 'drive';
            const backgroundRequested = getOptionValue(options, 'background') !== undefined;
            const foregroundRequested = getOptionValue(options, 'foreground') !== undefined;
            if (backgroundRequested && foregroundRequested) {
                return console.error('❌ Use either --background or --foreground (not both).');
            }
            const startConfig = getEffectiveConfig();
            const backgroundByConfig = Boolean(startConfig.backgroundAgents);
            const backgroundMode = backgroundRequested
                ? true
                : (foregroundRequested ? false : backgroundByConfig);

            if (!id) {
                return console.error("Usage: aigon research-start <ID> [agents...] [--background|--foreground]\n\nExamples:\n  aigon research-start 05                     # Drive mode\n  aigon research-start 05 cc gg               # Fleet mode\n  aigon research-start 05 cc gg --background  # Fleet mode without opening terminals");
            }

            // Find in backlog or in-progress (may already be started)
            let found = findFile(PATHS.research, id, ['02-backlog', '03-in-progress']);
            if (!found) return console.error(`❌ Could not find research "${id}" in backlog or in-progress.`);

            // Extract research name from filename
            const match = found.file.match(/^research-(\d+)-(.*)\.md$/);
            const researchNum = match ? match[1] : id;
            const researchName = match ? match[2] : 'research';

            // If already in-progress, skip the move but allow session creation
            const alreadyInProgress = found.folder === '03-in-progress';
            if (!alreadyInProgress) {
                // Move to in-progress from backlog
                found = moveFile(found, '03-in-progress', null, { actor: 'cli/research-start' });
            } else if (mode === 'drive') {
                const runningId = String(parseInt(researchNum, 10) || researchNum);
                console.log(`ℹ️  Research ${runningId} is already in progress. Use \`research-open ${runningId}\` to re-attach.`);
                return;
            }

            if (mode === 'fleet') {
                // Fleet mode: Create findings files for each agent
                const logsDir = path.join(PATHS.research.root, 'logs');
                if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

                const findingsTemplate = readTemplate('specs/research-findings-template.md');
                const createdFiles = [];

                agentIds.forEach(agentId => {
                    const agentConfig = loadAgentConfig(agentId);
                    const agentName = agentConfig ? agentConfig.name : agentId;

                    const findingsFilename = `research-${researchNum}-${agentId}-findings.md`;
                    const findingsPath = path.join(logsDir, findingsFilename);

                    if (fs.existsSync(findingsPath)) {
                        console.log(`ℹ️  Findings file already exists: ${findingsFilename}`);
                    } else {
                        // Process template with placeholders
                        const content = findingsTemplate
                            .replace(/\{\{TOPIC_NAME\}\}/g, researchName.replace(/-/g, ' '))
                            .replace(/\{\{AGENT_NAME\}\}/g, agentName)
                            .replace(/\{\{AGENT_ID\}\}/g, agentId)
                            .replace(/\{\{ID\}\}/g, researchNum)
                            .replace(/\{\{DATE\}\}/g, new Date().toISOString().split('T')[0]);

                        fs.writeFileSync(findingsPath, content);
                        createdFiles.push(findingsFilename);
                        console.log(`📝 Created: logs/${findingsFilename}`);
                    }
                });

                console.log(`\n🚛 Fleet mode started with ${agentIds.length} agents!`);
                console.log(`\n📋 Research topic: ./docs/specs/research-topics/03-in-progress/${found.file}`);
                console.log(`\n📂 Agent findings files:`);
                agentIds.forEach(agentId => {
                    const agentConfig = loadAgentConfig(agentId);
                    const agentName = agentConfig ? agentConfig.name : agentId;
                    console.log(`   ${agentId} (${agentName}): logs/research-${researchNum}-${agentId}-findings.md`);
                });

                // Always create tmux sessions (aligned with feature-start behaviour)
                const fleetConfig = getEffectiveConfig();
                const fleetTerminal = fleetConfig.terminal;
                if (fleetTerminal === 'tmux') {
                    try {
                        assertTmuxAvailable();
                    } catch (e) {
                        console.error(`\n❌ ${e.message}`);
                        console.error('   tmux is required. Install: brew install tmux');
                        return;
                    }
                    console.log(`\n🖥️  Creating tmux sessions...`);
                    const cwd = process.cwd();
                    const commandByAgent = new Map(agentIds.map(id => [id, buildResearchAgentCommand(id, researchNum)]));
                    const sessionResults = ensureAgentSessions(researchNum, agentIds, {
                        sessionNameBuilder: (id, agent) => buildResearchTmuxSessionName(id, agent),
                        cwdBuilder: () => cwd,
                        commandBuilder: (_, agent) => commandByAgent.get(agent)
                    });
                    sessionResults.forEach(result => {
                        if (result.error) {
                            console.warn(`   ⚠️  Could not create tmux session ${result.sessionName}: ${result.error.message}`);
                        } else {
                            console.log(`   ✓ ${result.sessionName}${result.created ? ' → started' : ' (already exists)'}`);
                        }
                    });

                    if (backgroundMode) {
                        console.log(`\n🟡 Background mode — sessions created but not opened.`);
                        console.log(`   View all: aigon research-open ${researchNum}`);
                    } else {
                        console.log(`\n🚀 Opening agent terminals...`);
                        agentIds.forEach(agentId => {
                            const sessionName = buildResearchTmuxSessionName(researchNum, agentId);
                            try {
                                openTerminalAppWithCommand(cwd, `tmux attach -t ${shellQuote(sessionName)}`, sessionName);
                            } catch (e) {
                                console.warn(`   ⚠️  Could not open terminal for ${sessionName}: ${e.message}`);
                            }
                        });
                    }
                } else {
                    console.log(`\n💡 Next steps:`);
                    console.log(`   Open all agents side-by-side:`);
                    console.log(`     aigon research-open ${researchNum}`);
                }
                console.log(`\n   When all agents finish: aigon research-synthesize ${researchNum}`);
            } else {
                // Drive mode: Just move to in-progress
                console.log(`\n🚗 Drive mode. Research moved to in-progress.`);
                console.log(`📋 Topic: ./docs/specs/research-topics/03-in-progress/${found.file}`);
                console.log(`\n💡 Next: Run agent with /aigon-research-do ${researchNum}`);
                console.log(`   When done: aigon research-close ${researchNum}`);
            }
        },

        'research-do': (args) => {
            const id = args[0];
            printAgentContextWarning('research-do', id);
            if (!id) return console.error("Usage: aigon research-do <ID>\n\nRun this after 'aigon research-start <ID>'\n\nExamples:\n  aigon research-do 05     # In Drive mode\n  aigon research-do 05     # In Fleet mode (writes to your findings file)");

            // Find the research topic
            let found = findFile(PATHS.research, id, ['03-in-progress']);
            if (!found) return printError('research', id, `Run 'aigon research-start ${id}' first.`);

            const match = found.file.match(/^research-(\d+)-(.*)\.md$/);
            if (!match) return console.warn("⚠️  Could not parse filename.");
            const [_, num, desc] = match;

            // Check for fleet mode by looking for findings files
            const logsDir = path.join(PATHS.research.root, 'logs');
            let findingsFiles = [];
            if (fs.existsSync(logsDir)) {
                const files = fs.readdirSync(logsDir);
                findingsFiles = files.filter(f =>
                    f.startsWith(`research-${num}-`) && f.endsWith('-findings.md')
                );
            }

            const isFleetMode = findingsFiles.length > 0;

            console.log(`\n📋 Research ${num}: ${desc.replace(/-/g, ' ')}`);
            console.log(`   Mode: ${isFleetMode ? '🚛 Fleet' : '🚗 Drive'}`);
            console.log(`\n📄 Topic: ./docs/specs/research-topics/03-in-progress/${found.file}`);

            if (isFleetMode) {
                console.log(`\n📂 Findings files:`);
                findingsFiles.forEach(file => {
                    const agentMatch = file.match(/^research-\d+-(\w+)-findings\.md$/);
                    const agentId = agentMatch ? agentMatch[1] : 'unknown';
                    const agentConfig = loadAgentConfig(agentId);
                    const agentName = agentConfig ? agentConfig.name : agentId;
                    console.log(`   ${agentId} (${agentName}): logs/${file}`);
                });

                console.log(`\n📝 Next Steps:`);
                console.log(`   1. Read the research topic (questions and scope)`);
                console.log(`   2. Write your findings to YOUR findings file only`);
                console.log(`   3. Do NOT modify other agents' files or the main doc`);
                console.log(`\n⚠️  IMPORTANT:`);
                console.log(`   - Do NOT run 'aigon research-close' from an agent session`);
                console.log(`   - The user will run 'aigon research-synthesize ${num}' after all findings are submitted`);
            } else {
                console.log(`\n📝 Next Steps:`);
                console.log(`   1. Read the research topic`);
                console.log(`   2. Conduct research based on questions and scope`);
                console.log(`   3. Write findings to the ## Findings section of the topic file`);
                console.log(`   4. Include sources and recommendation`);
                console.log(`\n   When done: aigon research-close ${num}`);
            }
        },

        'research-synthesize': (args) => {
            try { assertOnDefaultBranch(); } catch (e) { return console.error(`❌ ${e.message}`); }
            const forceSynthesis = args.includes('--force');
            const positionalArgs = args.filter(a => a !== '--force');
            const id = positionalArgs[0];
            if (!id) {
                return console.error(
                    "Usage: aigon research-synthesize <ID> [--force]\n\n" +
                    "Compare and synthesize research findings after agents submit.\n\n" +
                    "Examples:\n" +
                    "  aigon research-synthesize 05          # Continue when all findings are submitted\n" +
                    "  aigon research-synthesize 05 --force  # Synthesize even if some agents are unfinished"
                );
            }

            const found = findFile(PATHS.research, id, ['03-in-progress']);
            if (!found) return console.error(`❌ Could not find research "${id}" in progress.\n\nRun 'aigon research-start ${id} [agents...]' first.`);

            const match = found.file.match(/^research-(\d+)-(.*)\.md$/);
            if (!match) return console.warn("⚠️  Could not parse research filename.");
            const [_, researchNum] = match;

            if (!forceSynthesis) {
                const logsDir = path.join(PATHS.research.root, 'logs');
                const incompleteAgents = collectIncompleteResearchSynthesisAgents({ researchNum, logsDir, loadAgentConfigFn: loadAgentConfig });
                if (incompleteAgents.length > 0) {
                    console.log('');
                    console.log(`⚠️  ${incompleteAgents.length} agent(s) not yet submitted:`);
                    incompleteAgents.forEach(a => {
                        console.log(`   ${a.agent} (${a.name}) — status: ${a.status}`);
                        const reconnectCmd = `aigon terminal-focus ${researchNum} ${a.agent} --research`;
                        console.log(`     → ${reconnectCmd}`);
                    });
                    console.log('');
                    console.log(`   To proceed anyway: aigon research-synthesize ${researchNum} --force`);
                    console.log('');
                    return;
                }
            }

            printAgentContextWarning('research-synthesize', id);
        },

        'research-close': (args) => {
            try { assertOnDefaultBranch(); } catch (e) { return console.error(`❌ ${e.message}`); }
            const id = args[0];
            const forceComplete = args.includes('--complete');

            if (!id) return console.error("Usage: aigon research-close <ID> [--complete]\n\nOptions:\n  --complete  Move directly to done without showing summary");

            const found = findFile(PATHS.research, id, ['03-in-progress']);
            if (!found) return console.error(`❌ Could not find research "${id}" in in-progress.`);

            // Extract research ID from filename
            const match = found.file.match(/^research-(\d+)-(.*)\.md$/);
            const researchNum = match ? match[1] : id;
            const researchName = match ? match[2] : 'research';

            // Check for fleet mode by looking for findings files
            const logsDir = path.join(PATHS.research.root, 'logs');
            let findingsFiles = [];
            if (fs.existsSync(logsDir)) {
                const files = fs.readdirSync(logsDir);
                findingsFiles = files.filter(f =>
                    f.startsWith(`research-${researchNum}-`) && f.endsWith('-findings.md')
                );
            }

            const isFleetMode = findingsFiles.length > 0;

            if (isFleetMode && !forceComplete) {
                // Fleet mode: Show summary and suggest using research-synthesize
                console.log(`\n📋 Research ${researchNum}: ${researchName.replace(/-/g, ' ')} - Fleet Mode`);
                console.log(`\nFound ${findingsFiles.length} agent findings:\n`);

                findingsFiles.forEach(file => {
                    const agentMatch = file.match(/^research-\d+-(\w+)-findings\.md$/);
                    const agentId = agentMatch ? agentMatch[1] : 'unknown';
                    const agentConfig = loadAgentConfig(agentId);
                    const agentName = agentConfig ? agentConfig.name : agentId;
                    console.log(`   • ${agentName} (${agentId}): logs/${file}`);
                });

                console.log(`\n📋 Main research doc: ./docs/specs/research-topics/03-in-progress/${found.file}`);
                console.log(`\n💡 To synthesize findings with an agent:`);
                console.log(`   /aigon-research-synthesize ${researchNum}`);
                console.log(`\n   Or to complete without synthesis:`);
                console.log(`   aigon research-close ${researchNum} --complete`);
                return;
            }

            // --- Security scan gate ---
            const scanResult = runSecurityScan('researchClose');
            if (!scanResult.passed) {
                console.error(`🔒 research-close aborted due to security scan failure.`);
                return;
            }

            // Move to done (both modes, or arena with --complete)
            moveFile(found, '04-done', null, { actor: 'cli/research-close' });

            // Gracefully close all agent tmux sessions for this research
            try {
                const { gracefullyCloseEntitySessions } = require('../worktree');
                const result = gracefullyCloseEntitySessions(researchNum, 'r', {
                    repoPath: process.cwd(),
                });
                if (result.closed > 0) {
                    console.log(`🧹 Closed ${result.closed} agent session(s)`);
                }
            } catch (e) { /* non-fatal */ }

            if (isFleetMode) {
                console.log(`\n✅ Research ${researchNum} complete! (Fleet mode)`);
                console.log(`📂 Findings files preserved in: ./docs/specs/research-topics/logs/`);
            } else {
                console.log(`\n✅ Research ${researchNum} complete! (Drive mode)`);
            }
        },

        'research-submit': (args) => {
            const id = args[0];
            const agentArg = args[1];
            printAgentContextWarning('research-submit', id);

            if (!id) {
                return console.error(
                    "Usage: aigon research-submit <ID> [agent]\n\n" +
                    "Signal that research findings are complete.\n\n" +
                    "Examples:\n" +
                    "  aigon research-submit 05 cc   # Mark cc's findings as submitted\n" +
                    "  /aigon:research-submit 05     # Inside agent session: show instructions"
                );
            }

            const found = findFile(PATHS.research, id, ['03-in-progress']);
            if (!found) return console.error(`❌ Could not find research "${id}" in in-progress.`);

            const match = found.file.match(/^research-(\d+)-(.*)\.md$/);
            if (!match) return console.warn("⚠️  Could not parse filename.");
            const [_, researchNum] = match;

            // Determine agent: from arg or try to auto-detect from findings files
            const logsDir = path.join(PATHS.research.root, 'logs');
            let agentId = agentArg;

            if (!agentId) {
                // Try to detect from available findings files (single agent = auto-select)
                if (fs.existsSync(logsDir)) {
                    const files = fs.readdirSync(logsDir);
                    const findingsFiles = files.filter(f =>
                        f.startsWith(`research-${researchNum}-`) && f.endsWith('-findings.md')
                    );
                    if (findingsFiles.length === 1) {
                        const agentMatch = findingsFiles[0].match(/^research-\d+-(\w+)-findings\.md$/);
                        if (agentMatch) agentId = agentMatch[1];
                    } else if (findingsFiles.length > 1) {
                        return console.error(
                            `❌ Multiple agents found. Specify which agent to submit:\n` +
                            findingsFiles.map(f => {
                                const m = f.match(/^research-\d+-(\w+)-findings\.md$/);
                                return `   aigon research-submit ${researchNum} ${m ? m[1] : '?'}`;
                            }).join('\n')
                        );
                    }
                }
            }

            if (!agentId) {
                return console.error(`❌ Could not detect agent. Specify: aigon research-submit ${researchNum} <agent>`);
            }

            const findingsFile = path.join(logsDir, `research-${researchNum}-${agentId}-findings.md`);
            if (!fs.existsSync(findingsFile)) {
                return console.error(`❌ Findings file not found: research-${researchNum}-${agentId}-findings.md\n\nRun 'aigon research-start ${researchNum} ${agentId}' first.`);
            }

            // Write submitted status to manifest
            writeAgentStatus(researchNum, agentId, { status: 'submitted', flags: {} });

            console.log(`✅ Research ${researchNum} findings submitted (${agentId})`);
            console.log(`   File: docs/specs/research-topics/logs/research-${researchNum}-${agentId}-findings.md`);
        },

        'research-open': (args) => {
            const id = args[0];
            let terminalOverride = null;

            // Parse terminal override flag
            args.forEach(arg => {
                if (arg.startsWith('--terminal=')) {
                    terminalOverride = arg.split('=')[1];
                } else if (arg.startsWith('-t=')) {
                    terminalOverride = arg.split('=')[1];
                }
            });

            if (!id) {
                console.error(`❌ Research ID is required.\n`);
                console.error(`Usage:`);
                console.error(`  aigon research-open <ID> [--terminal=<type>]`);
                console.error(`\nExamples:`);
                console.error(`  aigon research-open 05              # Open all Fleet agents side-by-side`);
                console.error(`  aigon research-open 05 --terminal=code # Open in VS Code (manual setup)`);
                return;
            }

            // Find the research topic
            let found = findFile(PATHS.research, id, ['03-in-progress']);
            if (!found) {
                return console.error(`❌ Could not find research "${id}" in progress.\n\nRun 'aigon research-start ${id} [agents...]' first.`);
            }

            const match = found.file.match(/^research-(\d+)-(.*)\.md$/);
            if (!match) {
                return console.error(`❌ Could not parse research filename: ${found.file}`);
            }
            const [_, researchNum, researchName] = match;
            const paddedId = String(researchNum).padStart(2, '0');

            // Check for fleet mode by looking for findings files
            const logsDir = path.join(PATHS.research.root, 'logs');
            let findingsFiles = [];
            if (fs.existsSync(logsDir)) {
                const files = fs.readdirSync(logsDir);
                findingsFiles = files.filter(f =>
                    f.startsWith(`research-${researchNum}-`) && f.endsWith('-findings.md')
                );
            }

            if (findingsFiles.length === 0) {
                return console.error(`❌ Research ${paddedId} is not in Fleet mode.\n\nTo start Fleet research:\n  aigon research-start ${paddedId} cc gg cx\n\nFor Drive research, open a terminal manually and run:\n  /aigon:research-do ${paddedId}`);
            }

            // Extract agent IDs from findings filenames
            const agentConfigs = [];
            const errors = [];

            findingsFiles.forEach(file => {
                const agentMatch = file.match(/^research-\d+-(\w+)-findings\.md$/);
                if (!agentMatch) {
                    errors.push(`Could not parse agent ID from filename: ${file}`);
                    return;
                }

                const agentId = agentMatch[1];
                const agentConfig = loadAgentConfig(agentId);

                if (!agentConfig) {
                    errors.push(`Agent "${agentId}" is not configured. Install with: aigon install-agent ${agentId}`);
                    return;
                }

                agentConfigs.push({
                    agent: agentId,
                    agentName: agentConfig.name || agentId,
                    researchId: paddedId,
                    agentCommand: buildResearchAgentCommand(agentId, paddedId)
                });
            });

            if (errors.length > 0) {
                console.error(`❌ Errors detected:\n`);
                errors.forEach(err => console.error(`   ${err}`));
                return;
            }

            if (agentConfigs.length === 0) {
                return console.error(`❌ No valid agents found for research ${paddedId}.`);
            }

            // Sort alphabetically by agent for consistent ordering
            agentConfigs.sort((a, b) => a.agent.localeCompare(b.agent));

            // Determine terminal
            const effectiveConfig = getEffectiveConfig();
            const terminal = terminalOverride || effectiveConfig.terminal;

            if (terminal === 'warp') {
                const configName = `arena-research-${paddedId}`;
                const title = `Arena Research: ${paddedId} - ${researchName.replace(/-/g, ' ')}`;

                // Create config objects for Warp (all use main repo directory)
                const researchConfigs = agentConfigs.map(config => ({
                    path: process.cwd(),
                    agent: config.agent,
                    researchId: config.researchId,
                    agentCommand: config.agentCommand
                }));

                try {
                    const configFile = openInWarpSplitPanes(researchConfigs, configName, title);

                    console.log(`\n🚀 Opening ${agentConfigs.length} agents side-by-side in Warp:`);
                    console.log(`   Research: ${paddedId} - ${researchName.replace(/-/g, ' ')}\n`);
                    agentConfigs.forEach(config => {
                        console.log(`   ${config.agent.padEnd(8)} → ${process.cwd()}`);
                    });
                    console.log(`\n   Warp config: ${configFile}`);
                } catch (e) {
                    console.error(`❌ Failed to open Warp: ${e.message}`);
                }
            } else if (terminal === 'tmux') {
                try {
                    assertTmuxAvailable();
                } catch (e) {
                    console.error(`❌ ${e.message}`);
                    console.error(`   Install tmux: brew install tmux`);
                    return;
                }

                console.log(`\n🚀 Opening ${agentConfigs.length} agents via tmux for research ${paddedId}:`);
                console.log(`   Research: ${paddedId} - ${researchName.replace(/-/g, ' ')}\n`);

                const cwd = process.cwd();
                const commandByAgent = new Map(agentConfigs.map(config => [config.agent, config.agentCommand]));
                const sessionResults = ensureAgentSessions(researchNum, agentConfigs.map(config => config.agent), {
                    sessionNameBuilder: (id, agent) => buildResearchTmuxSessionName(id, agent),
                    cwdBuilder: () => cwd,
                    commandBuilder: (_, agent) => commandByAgent.get(agent)
                });
                sessionResults.forEach(result => {
                    if (result.error) {
                        console.warn(`   ⚠️  Could not create tmux session ${result.sessionName}: ${result.error.message}`);
                    } else {
                        console.log(`   ✓ ${result.sessionName}${result.created ? ' → started' : ' (already exists)'}`);
                    }
                });

                const repoName = path.basename(process.cwd());
                console.log(`\n   Attach: tmux attach -t ${repoName}-r${parseInt(researchNum, 10)}-<agent>`);
                console.log(`   List:   tmux ls`);

                // Open terminal windows for each session
                agentConfigs.forEach(config => {
                    const sessionName = buildResearchTmuxSessionName(researchNum, config.agent);
                    try {
                        openTerminalAppWithCommand(cwd, `tmux attach -t ${shellQuote(sessionName)}`, sessionName);
                    } catch (e) {
                        console.warn(`   ⚠️  Could not open terminal for ${sessionName}: ${e.message}`);
                    }
                });
            } else {
                // Non-Warp/tmux terminals: print manual setup instructions
                console.log(`\n📋 Fleet research ${paddedId} - ${researchName.replace(/-/g, ' ')}:`);
                console.log(`   (Side-by-side launch requires Warp or tmux. Use --terminal=warp or --terminal=tmux)\n`);
                agentConfigs.forEach(config => {
                    console.log(`   ${config.agent} (${config.agentName}):`);
                    console.log(`     cd ${process.cwd()}`);
                    console.log(`     ${config.agentCommand}\n`);
                });
            }
        },

        'research-autopilot': (args) => {
            const options = parseCliOptions(args);
            const subcommand = options._[0];

            // --- Subcommands: status, stop ---
            if (subcommand === 'status') {
                const idArg = options._[1];
                const logsDir = path.join(PATHS.research.root, 'logs');

                if (!idArg) {
                    return console.error('Usage: aigon research-autopilot status <research-id>');
                }

                const found = findFile(PATHS.research, idArg, ['03-in-progress']);
                if (!found) return console.error(`❌ Could not find research "${idArg}" in in-progress.`);
                const match = found.file.match(/^research-(\d+)-(.*)\.md$/);
                const researchNum = match ? match[1] : idArg;

                if (!fs.existsSync(logsDir)) return console.log('No findings files found.');

                const findingsFiles = fs.readdirSync(logsDir)
                    .filter(f => f.startsWith(`research-${researchNum}-`) && f.endsWith('-findings.md'));

                if (findingsFiles.length === 0) return console.log('No Fleet research agents found.');

                console.log(`\n🔬 Research Autopilot: Research ${researchNum}`);
                console.log('━'.repeat(40));
                console.log(`${'Agent'.padEnd(7)} ${'Status'.padEnd(15)} Updated`);

                findingsFiles.forEach(file => {
                    const agentMatch = file.match(/^research-\d+-(\w+)-findings\.md$/);
                    const agentId = agentMatch ? agentMatch[1] : 'unknown';
                    let status = 'unknown';
                    let updatedStr = '';
                    try {
                        const agentState = readAgentStatus(researchNum, agentId);
                        if (agentState) {
                            status = agentState.status || 'unknown';
                            if (agentState.updatedAt) {
                                const d = new Date(agentState.updatedAt);
                                const diffMs = Date.now() - d.getTime();
                                const diffMin = Math.floor(diffMs / 60000);
                                updatedStr = diffMin < 1 ? 'just now' : `${diffMin}m ago`;
                            }
                        }
                    } catch (e) { /* skip */ }
                    console.log(`${agentId.padEnd(7)} ${status.padEnd(15)} ${updatedStr}`);
                });
                return;
            }

            if (subcommand === 'stop') {
                const id = options._[1];
                if (!id) {
                    console.error('Usage: aigon research-autopilot stop <research-id>');
                    return;
                }
                // Use sessions-close logic via a fresh ctx call
                const allCommands = require('./shared').createAllCommands();
                allCommands['sessions-close']([id]);
                return;
            }

            // --- Main research-autopilot command ---
            const researchId = subcommand;
            if (!researchId || researchId.startsWith('-')) {
                console.error('Usage: aigon research-autopilot <research-id> [agents...]');
                console.error('       aigon research-autopilot status <research-id>');
                console.error('       aigon research-autopilot stop <research-id>');
                console.error('\nExamples:');
                console.error('  aigon research-autopilot 08 cc gg cx     # Fleet: 3 agents research in parallel');
                console.error('  aigon research-autopilot 08               # Use defaultAgents from config');
                return;
            }

            const positionalAgents = options._.slice(1);
            const effectiveConfig = u.getEffectiveConfig();
            const conductorConfig = effectiveConfig.conductor || {};
            let agentIds = positionalAgents.length > 0
                ? positionalAgents
                : (conductorConfig.defaultAgents || ['cc', 'gg']);

            const availableAgents = u.getAvailableAgents();
            const invalidAgents = agentIds.filter(a => !availableAgents.includes(a));
            if (invalidAgents.length > 0) {
                console.error(`❌ Unknown agent(s): ${invalidAgents.join(', ')}. Available: ${availableAgents.join(', ')}`);
                return;
            }

            if (agentIds.length < 2) {
                console.error('❌ Research autopilot requires at least 2 agents.');
                return;
            }

            const pollIntervalRaw = getOptionValue(options, 'poll-interval');
            const pollInterval = pollIntervalRaw !== undefined
                ? parseInt(pollIntervalRaw, 10) * 1000
                : ((conductorConfig.pollInterval || 30) * 1000);
            const autoSynthesize = getOptionValue(options, 'auto-synthesize') !== undefined;

            let found = findFile(PATHS.research, researchId, ['02-backlog', '03-in-progress']);
            if (!found) {
                console.error(`❌ Could not find research "${researchId}" in backlog or in-progress.`);
                return;
            }

            const match = found.file.match(/^research-(\d+)-(.*)\.md$/);
            if (!match) {
                console.error('❌ Could not parse research filename.');
                return;
            }
            const [, researchNum, researchDesc] = match;

            // Setup Fleet research if not already set up
            const logsDir = path.join(PATHS.research.root, 'logs');
            const existingFindings = fs.existsSync(logsDir)
                ? fs.readdirSync(logsDir).filter(f => f.startsWith(`research-${researchNum}-`) && f.endsWith('-findings.md'))
                : [];

            // Get reference to self for calling research-start
            const selfCommands = module.exports(ctx);

            if (existingFindings.length === 0) {
                console.log(`\n🔬 Research Autopilot: Research ${researchNum} — ${researchDesc}`);
                console.log(`   Setting up Fleet research with ${agentIds.length} agents: ${agentIds.join(', ')}`);
                selfCommands['research-start']([researchId, ...agentIds]);
            } else {
                agentIds = existingFindings.map(f => {
                    const m = f.match(/^research-\d+-(\w+)-findings\.md$/);
                    return m ? m[1] : null;
                }).filter(Boolean);
                console.log(`\n🔬 Research Autopilot: Research ${researchNum} — ${researchDesc}`);
                console.log(`   Using existing Fleet setup (${agentIds.length} agents: ${agentIds.join(', ')})`);
            }

            // Spawn tmux sessions for each agent
            console.log(`\n🚀 Spawning research agents...`);
            try {
                assertTmuxAvailable();
            } catch (e) {
                console.error(`❌ ${e.message}`);
                console.error('   Research autopilot requires tmux. Install: brew install tmux');
                return;
            }

            const { spawnSync } = require('child_process');
            const spawnedAgents = [];
            agentIds.forEach(agentId => {
                const sessionName = buildResearchTmuxSessionName(researchNum, agentId);
                const findingsFile = path.join(logsDir, `research-${researchNum}-${agentId}-findings.md`);

                // Check if already submitted
                try {
                    const agentState = readAgentStatus(researchNum, agentId);
                    if (agentState && agentState.status === 'submitted') {
                        console.log(`   ✓ ${agentId} — already submitted, skipping`);
                        spawnedAgents.push({ agent: agentId, alreadySubmitted: true });
                        return;
                    }
                } catch (e) { /* proceed */ }

                // Kill existing session
                const existingTmux = safeTmuxSessionExists(researchNum, agentId);
                if (existingTmux && existingTmux.running) {
                    spawnSync('tmux', ['kill-session', '-t', existingTmux.sessionName], { stdio: 'ignore' });
                }

                const cmd = buildResearchAgentCommand(agentId, researchNum);

                try {
                    createDetachedTmuxSession(sessionName, process.cwd(), cmd);
                } catch (e) {
                    console.error(`   ❌ ${agentId} — failed to create tmux session: ${e.message}`);
                    return;
                }
                console.log(`   ✓ ${agentId} — spawned in ${sessionName}`);
                spawnedAgents.push({ agent: agentId, alreadySubmitted: false });
            });

            if (spawnedAgents.length === 0) {
                console.error('❌ No agents spawned.');
                return;
            }

            // Monitor Phase
            const allAlreadySubmitted = spawnedAgents.every(a => a.alreadySubmitted);
            if (allAlreadySubmitted) {
                console.log(`\n✅ All agents already submitted!`);
            } else {
                console.log(`\n⏱  Monitoring ${spawnedAgents.length} agents (polling every ${pollInterval / 1000}s, Ctrl+C to stop)...\n`);

                let interrupted = false;
                const sigintHandler = () => { interrupted = true; };
                process.on('SIGINT', sigintHandler);

                const previousStatuses = {};
                spawnedAgents.forEach(a => { previousStatuses[a.agent] = a.alreadySubmitted ? 'submitted' : 'unknown'; });

                try {
                    while (!interrupted) {
                        try { spawnSync('sleep', [String(pollInterval / 1000)], { stdio: 'ignore' }); } catch (e) { break; }
                        if (interrupted) break;

                        let allSubmitted = true;
                        const statusRows = [];

                        spawnedAgents.forEach(({ agent }) => {
                            let status = 'unknown';
                            let updatedStr = '';
                            try {
                                const agentState = readAgentStatus(researchNum, agent);
                                if (agentState) {
                                    status = agentState.status || 'unknown';
                                    if (agentState.updatedAt) {
                                        const d = new Date(agentState.updatedAt);
                                        const diffMs = Date.now() - d.getTime();
                                        const diffMin = Math.floor(diffMs / 60000);
                                        updatedStr = diffMin < 1 ? 'just now' : `${diffMin}m ago`;
                                    }
                                }
                            } catch (e) { /* skip */ }

                            previousStatuses[agent] = status;
                            if (status !== 'submitted') allSubmitted = false;
                            statusRows.push({ agent, status, updatedStr });
                        });

                        const now = new Date().toLocaleTimeString();
                        console.log(`[${now}] ${'Agent'.padEnd(7)} ${'Status'.padEnd(15)} Updated`);
                        statusRows.forEach(row => {
                            console.log(`         ${row.agent.padEnd(7)} ${row.status.padEnd(15)} ${row.updatedStr}`);
                        });
                        console.log('');

                        if (allSubmitted) {
                            console.log('✅ All agents submitted!');
                            break;
                        }
                    }
                } finally {
                    process.removeListener('SIGINT', sigintHandler);
                }

                if (interrupted) {
                    console.log('\n⏸  Monitoring stopped. Agents are still running in their tmux sessions.');
                    console.log(`   Resume:  aigon research-autopilot status ${researchNum}`);
                    console.log(`   Stop:    aigon research-autopilot stop ${researchNum}`);
                    return;
                }
            }

            // Synthesize Phase
            if (autoSynthesize) {
                console.log(`\n📊 Auto-running synthesis...`);
                selfCommands['research-synthesize']([researchNum]);
            } else {
                console.log(`\n📊 Ready for synthesis:`);
                console.log(`   aigon research-synthesize ${researchNum}`);
            }
        },
    };
};

// Backward-compat wrapper
function createResearchCommands(overrides = {}) {
    const utils = require('../utils');
    const git = require('../git');
    const board = require('../board');
    const feedbackLib = require('../feedback');
    const validation = require('../validation');
    const stateMachine = require('../state-machine');

    const ctx = {
        utils: { ...utils, ...overrides },
        git: { ...git, ...overrides },
        board: { ...board, ...overrides },
        feedback: { ...feedbackLib, ...overrides },
        validation: { ...validation, ...overrides },
        stateMachine,
    };
    const allCmds = module.exports(ctx);
    const names = [
        'research-create', 'research-prioritise', 'research-start', 'research-open',
        'research-do', 'research-submit', 'research-synthesize', 'research-close',
        'research-autopilot'
    ];
    return Object.fromEntries(names.map(n => [n, allCmds[n]]).filter(([, h]) => typeof h === 'function'));
}

module.exports.createResearchCommands = createResearchCommands;
