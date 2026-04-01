'use strict';

const fs = require('fs');
const path = require('path');
const { runSecurityScan } = require('../security');
const entity = require('../entity');
const wf = require('../workflow-core');
const agentRegistry = require('../agent-registry');

module.exports = function researchCommands(ctx) {
    const u = ctx.utils;
    const def = entity.RESEARCH_DEF;

    const {
        PATHS,
        readTemplate,
        findFile,
        printError,
        printAgentContextWarning,
        loadAgentConfig,
        buildAgentCommand,
        buildTmuxSessionName,
        getEffectiveConfig,
        assertTmuxAvailable,
        ensureAgentSessions,
        openTerminalAppWithCommand,
        openInWarpSplitPanes,
        shellQuote,
        safeTmuxSessionExists,
        createDetachedTmuxSession,
        parseCliOptions,
        getOptionValue,
        getAvailableAgents,
    } = u;

    function parseResearchFile(found) {
        if (!found || !found.file) return null;
        const match = found.file.match(/^research-(\d+)-(.+)\.md$/);
        if (!match) return null;
        return { num: match[1], desc: match[2] };
    }

    function resolveResearchSpec(id, folders) {
        const found = findFile(PATHS.research, id, folders);
        if (!found) return null;
        const parsed = parseResearchFile(found);
        if (!parsed) return null;
        return { found, ...parsed };
    }

    function collectIncompleteResearchAgents(researchNum) {
        const logsDir = path.join(PATHS.research.root, 'logs');
        if (!fs.existsSync(logsDir)) return [];
        const findingsFiles = fs.readdirSync(logsDir)
            .filter(f => f.startsWith(`research-${researchNum}-`) && f.endsWith('-findings.md'))
            .sort();
        const incomplete = [];
        const { readWorkflowSnapshotSync } = require('../workflow-snapshot-adapter');
        const checkSnapshot = readWorkflowSnapshotSync(process.cwd(), 'research', researchNum);
        findingsFiles.forEach(file => {
            const m = file.match(/^research-\d+-([a-z]{2})-findings\.md$/);
            if (!m) return;
            const agent = m[1];
            let status = 'unknown';
            if (checkSnapshot && checkSnapshot.agents && checkSnapshot.agents[agent]) {
                status = checkSnapshot.agents[agent].status || 'unknown';
            }
            if (status !== 'ready') {
                const config = loadAgentConfig(agent);
                incomplete.push({ agent, name: config?.name || agent, status });
            }
        });
        return incomplete;
    }

    return {
        'research-create': (args) => {
            entity.entityCreate(def, args[0], ctx);
        },

        'research-prioritise': (args) => {
            if (!args[0]) return console.error("Usage: aigon research-prioritise <name or letter>");
            entity.entityPrioritise(def, args[0], ctx);
        },

        'research-start': async (args) => {
            const options = parseCliOptions(args);
            const id = options._[0];
            const agentIds = options._.slice(1);
            const startMode = agentIds.length > 0 ? 'fleet' : 'drive';
            const backgroundRequested = getOptionValue(options, 'background') !== undefined;
            const foregroundRequested = getOptionValue(options, 'foreground') !== undefined;
            if (backgroundRequested && foregroundRequested) {
                console.error('❌ Use either --background or --foreground (not both).');
                return;
            }
            if (!id) {
                console.error('Usage: aigon research-start <ID> [agents...] [--background|--foreground]');
                return;
            }
            const backgroundByConfig = Boolean(getEffectiveConfig().backgroundAgents);
            const backgroundMode = backgroundRequested ? true : (foregroundRequested ? false : backgroundByConfig);

            let spec = resolveResearchSpec(id, ['02-backlog', '03-in-progress']);
            if (!spec) {
                console.error(`❌ Could not find research "${id}" in backlog or in-progress.`);
                return;
            }
            if (spec.found.folder === '03-in-progress' && agentIds.length === 0) {
                console.log(`ℹ️  Research ${String(parseInt(spec.num, 10) || spec.num)} is already in progress.`);
                return;
            }

            const repoPath = process.cwd();
            const workflowMode = agentIds.length > 1 ? 'fleet' : 'solo';
            const existingSnapshot = await wf.showResearchOrNull(repoPath, spec.num);
            const needsStart = !existingSnapshot || existingSnapshot.lifecycle === 'backlog';
            if (!existingSnapshot && spec.found.folder === '03-in-progress') {
                await wf.migrateEntityLifecycleIfNeeded({
                    repoPath,
                    entityType: 'research',
                    entityId: spec.num,
                    mode: workflowMode,
                    agents: agentIds,
                    readyAgents: [],
                    lifecycle: 'implementing',
                });
            } else if (needsStart) {
                await wf.startResearch(repoPath, spec.num, workflowMode, agentIds);
            }

            // Spec move is recorded by the engine; no git commit needed
            // (research has no worktree inheritance requirement like feature-start)
            spec = resolveResearchSpec(spec.num, ['03-in-progress']) || spec;
            const num = spec.num;
            const desc = spec.desc;
            const found = spec.found;
            const mode = startMode;

            if (mode === 'fleet') {
                // Fleet mode: Create findings files for each agent
                const logsDir = path.join(PATHS.research.root, 'logs');
                if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

                const findingsTemplate = readTemplate('specs/research-findings-template.md');
                const researchName = desc;

                agentIds.forEach(agentId => {
                    const agentConfig = loadAgentConfig(agentId);
                    const agentName = agentConfig ? agentConfig.name : agentId;
                    const findingsFilename = `research-${num}-${agentId}-findings.md`;
                    const findingsPath = path.join(logsDir, findingsFilename);

                    if (fs.existsSync(findingsPath)) {
                        console.log(`ℹ️  Findings file already exists: ${findingsFilename}`);
                    } else {
                        const content = findingsTemplate
                            .replace(/\{\{TOPIC_NAME\}\}/g, researchName.replace(/-/g, ' '))
                            .replace(/\{\{AGENT_NAME\}\}/g, agentName)
                            .replace(/\{\{AGENT_ID\}\}/g, agentId)
                            .replace(/\{\{ID\}\}/g, num)
                            .replace(/\{\{DATE\}\}/g, new Date().toISOString().split('T')[0]);
                        fs.writeFileSync(findingsPath, content);
                        console.log(`📝 Created: logs/${findingsFilename}`);
                    }
                });

                console.log(`\n🚛 Fleet mode started with ${agentIds.length} agents!`);
                console.log(`\n📋 Research topic: ./docs/specs/research-topics/03-in-progress/${found.file}`);
                console.log(`\n📂 Agent findings files:`);
                agentIds.forEach(agentId => {
                    const agentConfig = loadAgentConfig(agentId);
                    const agentName = agentConfig ? agentConfig.name : agentId;
                    console.log(`   ${agentId} (${agentName}): logs/research-${num}-${agentId}-findings.md`);
                });

                // Create tmux sessions
                const fleetConfig = getEffectiveConfig();
                const fleetTerminal = fleetConfig.terminal;
                if (fleetTerminal === 'tmux') {
                    entity.createFleetSessions(def, num, desc, agentIds, ctx, {
                        cwdBuilder: () => process.cwd(),
                        commandBuilder: (_, agent) => buildAgentCommand({
                            agent,
                            featureId: num,
                            entityType: 'research',
                        }),
                        backgroundMode,
                    });
                } else {
                    console.log(`\n💡 Next steps:`);
                    console.log(`   Open all agents side-by-side:`);
                    console.log(`     aigon research-open ${num}`);
                }
                console.log(`\n   When all agents finish: aigon research-eval ${num}`);
            } else {
                // Drive mode
                console.log(`\n🚗 Drive mode. Research moved to in-progress.`);
                console.log(`📋 Topic: ./docs/specs/research-topics/03-in-progress/${found.file}`);
                console.log(`\n💡 Next: Run agent with /aigon-research-do ${num}`);
                console.log(`   When done: aigon research-close ${num}`);
            }
        },

        'research-do': (args) => {
            const id = args[0];
            printAgentContextWarning('research-do', id);
            if (!id) return console.error("Usage: aigon research-do <ID>\n\nRun this after 'aigon research-start <ID>'");

            let found = findFile(PATHS.research, id, ['03-in-progress']);
            if (!found) return printError('research', id, `Run 'aigon research-start ${id}' first.`);

            const match = found.file.match(/^research-(\d+)-(.*)\.md$/);
            if (!match) return console.warn("⚠️  Could not parse filename.");
            const [_, num, desc] = match;

            // Check for fleet mode by looking for findings files
            const logsDir = path.join(PATHS.research.root, 'logs');
            let findingsFiles = [];
            if (fs.existsSync(logsDir)) {
                findingsFiles = fs.readdirSync(logsDir).filter(f =>
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
                console.log(`   - The user will run 'aigon research-eval ${num}' after all findings are submitted`);
            } else {
                console.log(`\n📝 Next Steps:`);
                console.log(`   1. Read the research topic`);
                console.log(`   2. Conduct research based on questions and scope`);
                console.log(`   3. Write findings to the ## Findings section of the topic file`);
                console.log(`   4. Include sources and recommendation`);
                console.log(`\n   When done: aigon research-close ${num}`);
            }
        },

        'research-eval': async (args) => {
            const forceEval = args.includes('--force');
            const setupOnly = args.includes('--setup-only');
            const positionalArgs = args.filter(a => !a.startsWith('--'));
            const id = positionalArgs[0];
            if (!id) {
                return console.error(
                    "Usage: aigon research-eval <ID> [--force]\n\n" +
                    "Evaluate and synthesize research findings after agents submit.\n" +
                    "Transitions research from in-progress to in-evaluation.\n\n" +
                    "Examples:\n" +
                    "  aigon research-eval 05          # Continue when all findings are submitted\n" +
                    "  aigon research-eval 05 --force  # Evaluate even if some agents are unfinished"
                );
            }

            const spec = resolveResearchSpec(id, ['03-in-progress', '04-in-evaluation']);
            if (!spec) {
                console.error(`❌ Could not find research "${id}" in progress or in-evaluation.`);
                return;
            }

            if (spec.found.folder === '03-in-progress' && !forceEval) {
                const incomplete = collectIncompleteResearchAgents(spec.num);
                if (incomplete.length > 0) {
                    console.log('');
                    console.log(`⚠️  ${incomplete.length} agent(s) not yet submitted:`);
                    incomplete.forEach(a => {
                        console.log(`   ${a.agent} (${a.name}) — status: ${a.status}`);
                        console.log(`     → aigon terminal-focus ${spec.num} ${a.agent} --research`);
                    });
                    console.log('');
                    console.log(`   To proceed anyway: aigon research-eval ${spec.num} --force`);
                    console.log('');
                    return;
                }
            }

            if (!setupOnly) {
                const repoPath = process.cwd();
                const snapshot = await wf.showResearchOrNull(repoPath, spec.num);
                if (!snapshot) {
                    await wf.migrateEntityLifecycleIfNeeded({
                        repoPath,
                        entityType: 'research',
                        entityId: spec.num,
                        mode: 'solo',
                        agents: [],
                        lifecycle: spec.found.folder === '04-in-evaluation' ? 'evaluating' : 'implementing',
                    });
                }
                await wf.requestResearchEval(repoPath, spec.num);
                console.log(`📋 Research ${spec.num} moved to in-evaluation.`);
            }
            if (setupOnly) return;

            printAgentContextWarning('research-eval', id);
        },

        'research-review': async (args) => {
            const id = args[0];
            if (!id) {
                return console.error(
                    "Usage: aigon research-review <ID>\n\n" +
                    "Launches a review agent to check research findings for rigor,\n" +
                    "completeness, and accuracy. Must be run from the main repo."
                );
            }

            const spec = resolveResearchSpec(id, ['03-in-progress']);
            if (!spec) {
                console.error(`❌ Could not find research "${id}" in progress.`);
                return;
            }

            const forceReview = args.includes('--force');
            if (!forceReview) {
                const incomplete = collectIncompleteResearchAgents(spec.num);
                if (incomplete.length > 0) {
                    console.log('');
                    console.log(`⚠️  ${incomplete.length} agent(s) not yet submitted:`);
                    incomplete.forEach(a => {
                        console.log(`   ${a.agent} (${a.name}) — status: ${a.status}`);
                    });
                    console.log('');
                    console.log(`   To proceed anyway: aigon research-review ${spec.num} --force`);
                    console.log('');
                    return;
                }
            }

            const repoPath = process.cwd();
            const snapshot = await wf.showResearchOrNull(repoPath, spec.num);
            if (!snapshot) {
                await wf.migrateEntityLifecycleIfNeeded({
                    repoPath,
                    entityType: 'research',
                    entityId: spec.num,
                    mode: 'solo',
                    agents: [],
                    lifecycle: 'implementing',
                });
            }
            await wf.requestResearchReview(repoPath, spec.num);
            console.log(`📋 Research ${spec.num} moved to reviewing.`);
            printAgentContextWarning('research-review', id);
        },

        'research-close': async (args) => {
            const id = args[0];
            if (!id) return console.error("Usage: aigon research-close <ID>");
            const closeSpec = resolveResearchSpec(id, ['04-in-evaluation', '03-in-progress']);
            if (!closeSpec) {
                console.error(`❌ Could not find research "${id}" in in-evaluation or in-progress.`);
                return;
            }
            const { num } = closeSpec;
            if (closeSpec.found.folder === '03-in-progress') {
                console.log(`⚠️  Research ${num} is still in-progress (eval hasn't run). Closing anyway.`);
            }

            // Check for fleet mode
            const logsDir = path.join(PATHS.research.root, 'logs');
            let findingsFiles = [];
            if (fs.existsSync(logsDir)) {
                findingsFiles = fs.readdirSync(logsDir).filter(f =>
                    f.startsWith(`research-${num}-`) && f.endsWith('-findings.md')
                );
            }
            const isFleetMode = findingsFiles.length > 0;

            // Security scan gate
            const scanResult = runSecurityScan('researchClose');
            if (!scanResult.passed) {
                console.error(`🔒 research-close aborted due to security scan failure.`);
                return;
            }

            const repoPath = process.cwd();
            const snapshot = await wf.showResearchOrNull(repoPath, num);
            if (!snapshot) {
                await wf.migrateEntityLifecycleIfNeeded({
                    repoPath,
                    entityType: 'research',
                    entityId: num,
                    mode: isFleetMode ? 'fleet' : 'solo',
                    agents: [],
                    lifecycle: closeSpec.found.folder === '04-in-evaluation' ? 'evaluating' : 'implementing',
                });
            }
            await wf.closeResearch(repoPath, num);
            entity.entityCloseFinalize(def, { num }, ctx);

            if (isFleetMode) {
                console.log(`\n✅ Research ${num} complete! (Fleet mode)`);
                console.log(`📂 Findings files preserved in: ./docs/specs/research-topics/logs/`);
            } else {
                console.log(`\n✅ Research ${num} complete! (Drive mode)`);
            }
        },

        'research-submit': (args) => {
            const id = args[0];
            const agentArg = args[1];
            printAgentContextWarning('research-submit', id);

            if (!id) {
                return console.error(
                    "Usage: aigon research-submit <ID> [agent]\n\n" +
                    "Signal that research findings are complete."
                );
            }

            const found = findFile(PATHS.research, id, ['03-in-progress']);
            if (!found) return console.error(`❌ Could not find research "${id}" in in-progress.`);

            const match = found.file.match(/^research-(\d+)-(.*)\.md$/);
            if (!match) return console.warn("⚠️  Could not parse filename.");
            const researchNum = match[1];

            // Determine agent
            const logsDir = path.join(PATHS.research.root, 'logs');
            let agentId = agentArg;

            if (!agentId) {
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
                return console.error(`❌ Findings file not found: research-${researchNum}-${agentId}-findings.md`);
            }

            entity.entitySubmit(def, researchNum, agentId, ctx);
            console.log(`   File: docs/specs/research-topics/logs/research-${researchNum}-${agentId}-findings.md`);
        },

        'research-open': (args) => {
            const id = args[0];
            let terminalOverride = null;
            args.forEach(arg => {
                if (arg.startsWith('--terminal=')) terminalOverride = arg.split('=')[1];
                else if (arg.startsWith('-t=')) terminalOverride = arg.split('=')[1];
            });

            if (!id) {
                console.error(`❌ Research ID is required.\nUsage: aigon research-open <ID> [--terminal=<type>]`);
                return;
            }

            let found = findFile(PATHS.research, id, ['03-in-progress']);
            if (!found) return console.error(`❌ Could not find research "${id}" in progress.`);

            const match = found.file.match(/^research-(\d+)-(.*)\.md$/);
            if (!match) return console.error(`❌ Could not parse research filename: ${found.file}`);
            const [_, researchNum, researchName] = match;
            const paddedId = String(researchNum).padStart(2, '0');

            const logsDir = path.join(PATHS.research.root, 'logs');
            let findingsFiles = [];
            if (fs.existsSync(logsDir)) {
                findingsFiles = fs.readdirSync(logsDir).filter(f =>
                    f.startsWith(`research-${researchNum}-`) && f.endsWith('-findings.md')
                );
            }

            if (findingsFiles.length === 0) {
                return console.error(`❌ Research ${paddedId} is not in Fleet mode.`);
            }

            const agentConfigs = [];
            const errors = [];
            findingsFiles.forEach(file => {
                const agentMatch = file.match(/^research-\d+-(\w+)-findings\.md$/);
                if (!agentMatch) { errors.push(`Could not parse agent ID from filename: ${file}`); return; }
                const agentId = agentMatch[1];
                const agentConfig = loadAgentConfig(agentId);
                if (!agentConfig) { errors.push(`Agent "${agentId}" is not configured.`); return; }
                agentConfigs.push({
                    agent: agentId,
                    agentName: agentConfig.name || agentId,
                    researchId: paddedId,
                    agentCommand: buildAgentCommand({ agent: agentId, featureId: paddedId, entityType: 'research' }),
                });
            });

            if (errors.length > 0) { errors.forEach(err => console.error(`   ${err}`)); return; }
            if (agentConfigs.length === 0) return console.error(`❌ No valid agents found.`);
            agentConfigs.sort((a, b) => a.agent.localeCompare(b.agent));

            const effectiveConfig = getEffectiveConfig();
            const requestedTerminal = terminalOverride || effectiveConfig.terminal;
            const terminal = process.platform === 'linux' && (requestedTerminal === 'warp' || requestedTerminal === 'terminal')
                ? 'tmux'
                : requestedTerminal;

            if (process.platform === 'linux' && terminal !== requestedTerminal) {
                console.log(`⚠️  Terminal "${requestedTerminal}" is not supported on Linux for research-open. Falling back to tmux.`);
            }

            if (terminal === 'warp') {
                const configName = `arena-research-${paddedId}`;
                const title = `Arena Research: ${paddedId} - ${researchName.replace(/-/g, ' ')}`;
                const researchConfigs = agentConfigs.map(config => ({
                    path: process.cwd(), agent: config.agent, researchId: config.researchId, agentCommand: config.agentCommand
                }));
                try {
                    const configFile = openInWarpSplitPanes(researchConfigs, configName, title);
                    console.log(`\n🚀 Opening ${agentConfigs.length} agents side-by-side in Warp:`);
                    agentConfigs.forEach(config => console.log(`   ${config.agent.padEnd(8)} → ${process.cwd()}`));
                    console.log(`\n   Warp config: ${configFile}`);
                } catch (e) { console.error(`❌ Failed to open Warp: ${e.message}`); }
            } else if (terminal === 'tmux') {
                try { assertTmuxAvailable(); } catch (e) { return console.error(`❌ ${e.message}`); }
                console.log(`\n🚀 Opening ${agentConfigs.length} agents via tmux for research ${paddedId}:`);
                const cwd = process.cwd();
                const commandByAgent = new Map(agentConfigs.map(c => [c.agent, c.agentCommand]));
                const sessionResults = ensureAgentSessions(researchNum, agentConfigs.map(c => c.agent), {
                    sessionNameBuilder: (id, agent) => buildTmuxSessionName(id, agent, { entityType: 'r' }),
                    cwdBuilder: () => cwd,
                    commandBuilder: (_, agent) => commandByAgent.get(agent)
                });
                sessionResults.forEach(result => {
                    if (result.error) console.warn(`   ⚠️  ${result.sessionName}: ${result.error.message}`);
                    else console.log(`   ✓ ${result.sessionName}${result.created ? ' → started' : ' (already exists)'}`);
                });

                agentConfigs.forEach(config => {
                    const sessionName = buildTmuxSessionName(researchNum, config.agent, { entityType: 'r' });
                    try { openTerminalAppWithCommand(cwd, `tmux attach -t ${shellQuote(sessionName)}`, sessionName); }
                    catch (e) { console.warn(`   ⚠️  Could not open terminal for ${sessionName}: ${e.message}`); }
                });
            } else {
                console.log(`\n📋 Fleet research ${paddedId}:`);
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

            if (subcommand === 'status') {
                const idArg = options._[1];
                if (!idArg) return console.error('Usage: aigon research-autopilot status <research-id>');
                const found = findFile(PATHS.research, idArg, ['03-in-progress']);
                if (!found) return console.error(`❌ Could not find research "${idArg}" in in-progress.`);
                const match = found.file.match(/^research-(\d+)-(.*)\.md$/);
                const researchNum = match ? match[1] : idArg;
                const logsDir = path.join(PATHS.research.root, 'logs');
                if (!fs.existsSync(logsDir)) return console.log('No findings files found.');
                const findingsFiles = fs.readdirSync(logsDir)
                    .filter(f => f.startsWith(`research-${researchNum}-`) && f.endsWith('-findings.md'));
                if (findingsFiles.length === 0) return console.log('No Fleet research agents found.');
                console.log(`\n🔬 Research Autopilot: Research ${researchNum}`);
                console.log('━'.repeat(40));
                console.log(`${'Agent'.padEnd(7)} ${'Status'.padEnd(15)} Updated`);
                const { readWorkflowSnapshotSync: readSnapSync } = require('../workflow-snapshot-adapter');
                const snapshot = readSnapSync(process.cwd(), 'research', researchNum);
                findingsFiles.forEach(file => {
                    const agentMatch = file.match(/^research-\d+-(\w+)-findings\.md$/);
                    const agentId = agentMatch ? agentMatch[1] : 'unknown';
                    let status = 'unknown', updatedStr = '';
                    if (snapshot && snapshot.agents && snapshot.agents[agentId]) {
                        const agent = snapshot.agents[agentId];
                        status = agent.status || 'unknown';
                        if (agent.lastHeartbeatAt) {
                            const d = new Date(agent.lastHeartbeatAt);
                            const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
                            updatedStr = diffMin < 1 ? 'just now' : `${diffMin}m ago`;
                        }
                    }
                    console.log(`${agentId.padEnd(7)} ${status.padEnd(15)} ${updatedStr}`);
                });
                return;
            }

            if (subcommand === 'stop') {
                const id = options._[1];
                if (!id) return console.error('Usage: aigon research-autopilot stop <research-id>');
                const allCommands = require('./shared').createAllCommands();
                allCommands['sessions-close']([id]);
                return;
            }

            // Main research-autopilot command
            const researchId = subcommand;
            if (!researchId || researchId.startsWith('-')) {
                return console.error('Usage: aigon research-autopilot <research-id> [agents...]');
            }

            const positionalAgents = options._.slice(1);
            const effectiveConfig = u.getEffectiveConfig();
            const conductorConfig = effectiveConfig.conductor || {};
            let agentIds = positionalAgents.length > 0
                ? positionalAgents
                : (conductorConfig.defaultAgents || agentRegistry.getDefaultFleetAgents());

            const availableAgents = getAvailableAgents();
            const invalidAgents = agentIds.filter(a => !availableAgents.includes(a));
            if (invalidAgents.length > 0) {
                return console.error(`❌ Unknown agent(s): ${invalidAgents.join(', ')}. Available: ${availableAgents.join(', ')}`);
            }
            if (agentIds.length < 2) return console.error('❌ Research autopilot requires at least 2 agents.');

            const pollIntervalRaw = getOptionValue(options, 'poll-interval');
            const pollInterval = pollIntervalRaw !== undefined
                ? parseInt(pollIntervalRaw, 10) * 1000
                : ((conductorConfig.pollInterval || 30) * 1000);
            const autoEval = getOptionValue(options, 'auto-eval') !== undefined
                || getOptionValue(options, 'auto-synthesize') !== undefined;

            let found = findFile(PATHS.research, researchId, ['02-backlog', '03-in-progress']);
            if (!found) return console.error(`❌ Could not find research "${researchId}" in backlog or in-progress.`);

            const match = found.file.match(/^research-(\d+)-(.*)\.md$/);
            if (!match) return console.error('❌ Could not parse research filename.');
            const [, researchNum, researchDesc] = match;

            const logsDir = path.join(PATHS.research.root, 'logs');
            const existingFindings = fs.existsSync(logsDir)
                ? fs.readdirSync(logsDir).filter(f => f.startsWith(`research-${researchNum}-`) && f.endsWith('-findings.md'))
                : [];

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

            // Spawn tmux sessions
            console.log(`\n🚀 Spawning research agents...`);
            try { assertTmuxAvailable(); } catch (e) {
                return console.error(`❌ ${e.message}\n   Research autopilot requires tmux.`);
            }

            const { spawnSync } = require('child_process');
            const { readWorkflowSnapshotSync: readSnapSync2 } = require('../workflow-snapshot-adapter');
            const spawnSnapshot = readSnapSync2(process.cwd(), 'research', researchNum);
            const spawnedAgents = [];
            agentIds.forEach(agentId => {
                const sessionName = buildTmuxSessionName(researchNum, agentId, { entityType: 'r' });

                if (spawnSnapshot && spawnSnapshot.agents && spawnSnapshot.agents[agentId]) {
                    const engineStatus = spawnSnapshot.agents[agentId].status;
                    if (engineStatus === 'ready') {
                        console.log(`   ✓ ${agentId} — already submitted, skipping`);
                        spawnedAgents.push({ agent: agentId, alreadySubmitted: true });
                        return;
                    }
                }

                const existingTmux = safeTmuxSessionExists(researchNum, agentId);
                if (existingTmux && existingTmux.running) {
                    spawnSync('tmux', ['kill-session', '-t', existingTmux.sessionName], { stdio: 'ignore' });
                }

                const cmd = buildAgentCommand({ agent: agentId, featureId: researchNum, entityType: 'research' });
                try {
                    createDetachedTmuxSession(sessionName, process.cwd(), cmd);
                } catch (e) {
                    console.error(`   ❌ ${agentId} — failed: ${e.message}`);
                    return;
                }
                console.log(`   ✓ ${agentId} — spawned in ${sessionName}`);
                spawnedAgents.push({ agent: agentId, alreadySubmitted: false });
            });

            if (spawnedAgents.length === 0) return console.error('❌ No agents spawned.');

            // Monitor
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
                        const { readWorkflowSnapshotSync: readSnapSync3 } = require('../workflow-snapshot-adapter');
                        const monitorSnapshot = readSnapSync3(process.cwd(), 'research', researchNum);
                        spawnedAgents.forEach(({ agent }) => {
                            let status = 'unknown', updatedStr = '';
                            if (monitorSnapshot && monitorSnapshot.agents && monitorSnapshot.agents[agent]) {
                                const agentData = monitorSnapshot.agents[agent];
                                status = agentData.status || 'unknown';
                                if (agentData.lastHeartbeatAt) {
                                    const diffMin = Math.floor((Date.now() - new Date(agentData.lastHeartbeatAt).getTime()) / 60000);
                                    updatedStr = diffMin < 1 ? 'just now' : `${diffMin}m ago`;
                                }
                            }
                            previousStatuses[agent] = status;
                            if (status !== 'ready') allSubmitted = false;
                            statusRows.push({ agent, status, updatedStr });
                        });
                        const now = new Date().toLocaleTimeString();
                        console.log(`[${now}] ${'Agent'.padEnd(7)} ${'Status'.padEnd(15)} Updated`);
                        statusRows.forEach(row => console.log(`         ${row.agent.padEnd(7)} ${row.status.padEnd(15)} ${row.updatedStr}`));
                        console.log('');
                        if (allSubmitted) { console.log('✅ All agents submitted!'); break; }
                    }
                } finally { process.removeListener('SIGINT', sigintHandler); }
                if (interrupted) {
                    console.log('\n⏸  Monitoring stopped.');
                    console.log(`   Resume:  aigon research-autopilot status ${researchNum}`);
                    console.log(`   Stop:    aigon research-autopilot stop ${researchNum}`);
                    return;
                }
            }

            if (autoEval) {
                console.log(`\n📊 Auto-running evaluation...`);
                selfCommands['research-eval']([researchNum]);
            } else {
                console.log(`\n📊 Ready for evaluation:\n   aigon research-eval ${researchNum}`);
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
    const stateMachine = require('../state-queries');

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
        'research-do', 'research-submit', 'research-review', 'research-eval', 'research-close',
        'research-autopilot'
    ];
    return Object.fromEntries(names.map(n => [n, allCmds[n]]).filter(([, h]) => typeof h === 'function'));
}

module.exports.createResearchCommands = createResearchCommands;
