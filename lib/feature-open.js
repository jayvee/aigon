'use strict';

const agentRegistry = require('./agent-registry');

function run(args, deps) {
    const {
        findWorktrees,
        filterByFeatureId,
        buildAgentAliasMap,
        buildAgentCommand,
        openInWarpSplitPanes,
        openSingleWorktree,
        getEffectiveConfig,
        u,
        AGENT_CONFIGS,
    } = deps;

            const featureIds = [];
            let agentCode = null;
            let terminalOverride = null;
            let allFlag = false;
            args.forEach(arg => {
                if (arg.startsWith('--terminal=')) terminalOverride = arg.split('=')[1];
                else if (arg.startsWith('-t=')) terminalOverride = arg.split('=')[1];
                else if (arg.startsWith('--agent=')) agentCode = arg.split('=')[1];
                else if (arg === '--all') allFlag = true;
                else if (/^\d+$/.test(arg)) featureIds.push(arg);
                else if (!arg.startsWith('-')) agentCode = arg; // legacy positional
            });

            if (featureIds.length === 0) {
                console.error(`❌ Feature ID is required.\n`);
                console.error(`Usage:`);
                console.error(`  aigon feature-open <ID> [agent]          Open single worktree`);
                console.error(`  aigon feature-open <ID> --all           Open all Fleet worktrees side-by-side`);
                console.error(`  aigon feature-open <ID> <ID>... [--agent=<code>]`);
                console.error(`                                           Open multiple features side-by-side`);
                return;
            }

            // Find all worktrees
            let allWorktrees;
            try {
                allWorktrees = findWorktrees();
            } catch (e) {
                return console.error(`❌ Could not list worktrees: ${e.message}`);
            }

            if (allWorktrees.length === 0) {
                return console.error(`❌ No worktrees found.\n\n   Create one with: aigon feature-start <ID> <agent>`);
            }

            // Determine terminal app (project config > global config > default)
            const effectiveConfig = getEffectiveConfig();
            const terminalApp = terminalOverride || effectiveConfig.terminalApp || 'apple-terminal';

            // Determine mode
            if (featureIds.length > 1) {
                // --- PARALLEL MODE: multiple features side-by-side ---
                const worktreeConfigs = [];
                const errors = [];

                for (const fid of featureIds) {
                    let matches = filterByFeatureId(allWorktrees, fid);

                    if (agentCode) {
                        const agentMap = buildAgentAliasMap();
                        const normalizedAgent = agentMap[agentCode.toLowerCase()] || agentCode.toLowerCase();
                        matches = matches.filter(wt => wt.agent === normalizedAgent);
                    }

                    if (matches.length === 0) {
                        errors.push(`Feature ${fid}: no worktree found${agentCode ? ` for agent ${agentCode}` : ''}`);
                    } else if (matches.length > 1 && !agentCode) {
                        const agents = matches.map(wt => wt.agent).join(', ');
                        errors.push(`Feature ${fid}: multiple worktrees (${agents}). Use --agent=<code> to specify.`);
                    } else {
                        const wt = matches[0];
                        worktreeConfigs.push({ ...wt, agentCommand: buildAgentCommand(wt) });
                    }
                }

                if (errors.length > 0) {
                    console.error(`❌ Cannot open parallel worktrees:\n`);
                    errors.forEach(err => console.error(`   ${err}`));
                    return;
                }

                const idsLabel = featureIds.join(', ');

                if (terminalApp === 'warp') {
                    const configName = `parallel-features-${featureIds.join('-')}`;
                    const title = `Parallel: Features ${idsLabel}`;

                    try {
                        const configFile = openInWarpSplitPanes(worktreeConfigs, configName, title);

                        console.log(`\n🚀 Opening ${worktreeConfigs.length} features side-by-side in Warp:`);
                        console.log(`   Features: ${idsLabel}\n`);
                        worktreeConfigs.forEach(wt => {
                            console.log(`   ${wt.featureId.padEnd(4)} ${wt.agent.padEnd(8)} → ${wt.path}`);
                        });
                        console.log(`\n   Warp config: ${configFile}`);
                    } catch (e) {
                        console.error(`❌ Failed to open Warp: ${e.message}`);
                    }
                } else {
                    console.log(`\n🚀 Opening ${worktreeConfigs.length} features via tmux sessions:`);
                    worktreeConfigs.forEach(wt => {
                        openSingleWorktree(wt, wt.agentCommand, terminalApp);
                    });
                }
            } else if (allFlag) {
                // --- ARENA MODE: all agents for one feature side-by-side ---
                const featureId = featureIds[0];
                const paddedId = String(featureId).padStart(2, '0');
                let worktrees = filterByFeatureId(allWorktrees, featureId);

                if (worktrees.length === 0) {
                    return console.error(`❌ No worktrees found for feature ${featureId}.\n\n   Create worktrees with: aigon feature-start ${featureId} cc gg`);
                }

                if (worktrees.length < 2) {
                    return console.error(`❌ Only 1 worktree found for feature ${featureId}. Use \`aigon feature-open ${featureId}\` for single worktrees.\n\n   To add more agents: aigon feature-start ${featureId} cc gg cx`);
                }

                // Sort by port offset order (cc=+1, gg=+2, cx=+3, cu=+4)
                const agentOrder = agentRegistry.getSortedAgentIds();
                worktrees.sort((a, b) => {
                    const aIdx = agentOrder.indexOf(a.agent);
                    const bIdx = agentOrder.indexOf(b.agent);
                    return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
                });

                const profile = u.getActiveProfile();
                const worktreeConfigs = worktrees.map(wt => {
                    const agentMeta = AGENT_CONFIGS[wt.agent] || {};
                    const port = profile.devServer.enabled ? (profile.devServer.ports[wt.agent] || agentMeta.port) : null;
                    const portLabel = port ? `🔌 ${agentMeta.name || wt.agent} — Port ${port}` : null;
                    return {
                        ...wt,
                        agentCommand: buildAgentCommand(wt),
                        portLabel
                    };
                });

                if (terminalApp === 'warp') {
                    const configName = `arena-feature-${paddedId}`;
                    const desc = worktreeConfigs[0].desc;
                    const title = `Arena: Feature ${paddedId} - ${desc}`;

                    try {
                        const configFile = openInWarpSplitPanes(worktreeConfigs, configName, title, 'cyan');

                        console.log(`\n🚀 Opening ${worktreeConfigs.length} worktrees side-by-side in Warp:`);
                        console.log(`   Feature: ${paddedId} - ${desc}\n`);
                        worktreeConfigs.forEach(wt => {
                            console.log(`   ${wt.agent.padEnd(8)} → ${wt.path}`);
                        });
                        console.log(`\n   Warp config: ${configFile}`);
                    } catch (e) {
                        console.error(`❌ Failed to open Warp: ${e.message}`);
                    }
                } else {
                    console.log(`\n🚀 Opening ${worktreeConfigs.length} Fleet worktrees via tmux sessions:`);
                    worktreeConfigs.forEach(wt => {
                        openSingleWorktree(wt, wt.agentCommand, terminalApp);
                    });
                }
            } else {
                // --- SINGLE MODE: open one worktree ---
                const featureId = featureIds[0];
                let worktrees = filterByFeatureId(allWorktrees, featureId);

                if (worktrees.length === 0) {
                    return console.error(`❌ No worktrees found for feature ${featureId}`);
                }

                // Filter by agent if provided
                if (agentCode) {
                    const agentMap = buildAgentAliasMap();
                    const normalizedAgent = agentMap[agentCode.toLowerCase()] || agentCode.toLowerCase();
                    worktrees = worktrees.filter(wt => wt.agent === normalizedAgent);

                    if (worktrees.length === 0) {
                        return console.error(`❌ No worktree found for feature ${featureId} with agent ${agentCode}`);
                    }
                }

                // Select worktree: if multiple, pick most recently modified
                let selectedWt;
                if (worktrees.length === 1) {
                    selectedWt = worktrees[0];
                } else {
                    worktrees.sort((a, b) => b.mtime - a.mtime);
                    selectedWt = worktrees[0];
                    console.log(`ℹ️  Multiple worktrees found, opening most recent:`);
                    worktrees.forEach((wt, i) => {
                        const marker = i === 0 ? '→' : ' ';
                        console.log(`   ${marker} ${wt.featureId}-${wt.agent}: ${wt.path}`);
                    });
                }

                const agentCommand = buildAgentCommand(selectedWt);
                openSingleWorktree(selectedWt, agentCommand, terminalApp);
            }
}

module.exports = { run };
