'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const agentRegistry = require('./agent-registry');
const workflowSnapshotAdapter = require('./workflow-snapshot-adapter');
const { resolveAgentPromptBody } = require('./agent-prompt-resolver');
const { parseCliOptions, getOptionValue } = require('./cli-parse');
const { getDefaultAgent } = require('./config');
const { resolveImplementationLogVariant } = require('./profile-placeholders');
const { readSetTag, getSetMembersSorted, featurePathsForRepo } = require('./feature-sets');

const LOGS_DIR = 'docs/specs/features/logs';

function buildSetMemberLogPattern(paddedId) {
    return `${LOGS_DIR}/feature-${paddedId}-*-log.md`;
}

/**
 * Build the {{SET_CONTEXT_SECTION}} placeholder value for non-slash agents (cx, etc.)
 * that inline the feature-do template. Returns empty string if no completed siblings.
 */
function buildSetContextSection(setSlug, repoRoot = process.cwd()) {
    const members = getSetMembersSorted(setSlug, featurePathsForRepo(repoRoot));
    const done = members.filter(m => m.stage === 'done' && m.paddedId);
    if (done.length === 0) return '';

    const logLines = done
        .map(m => `- Feature ${m.paddedId} logs: \`./${buildSetMemberLogPattern(m.paddedId)}\``)
        .join('\n');

    return `## Step 2.5: Set context (this feature is part of set \`${setSlug}\`)

Before coding, read these in order:
1. The implementation logs of completed siblings listed below — focus on \`## Key Decisions\`, \`## New API Surface\`, and \`## For the Next Feature in This Set\`:
${logLines}
2. The specs of your \`depends_on\` predecessors (listed in this spec's Dependencies section). These define the contracts you must honour.
3. The research source named in \`## Related\` (if present).

Do not restate what you read. Use it to inform your approach and avoid re-opening closed decisions.`;
}

/**
 * Print set context directly to stdout in instruction mode (cc reads this inline).
 */
function printSetContextInstructions(setSlug, repoRoot = process.cwd()) {
    const members = getSetMembersSorted(setSlug, featurePathsForRepo(repoRoot));
    const done = members.filter(m => m.stage === 'done' && m.paddedId);
    if (done.length === 0) return;

    console.log(`\n📚 Set context (set: ${setSlug})`);
    console.log(`   This feature is part of a set. Read completed sibling logs before coding:`);
    for (const m of done) {
        console.log(`   Feature ${m.paddedId}: ./${buildSetMemberLogPattern(m.paddedId)}`);
    }
    console.log(`   Focus on: ## Key Decisions, ## New API Surface, ## For the Next Feature in This Set`);
    console.log(`   Do not restate what you read — use it to inform your approach.`);
}

function run(args, deps) {
    const { ctx } = deps;
    const u = ctx.utils;
    const sc = ctx.specCrud;
    const { printError } = sc;
    const {
        AGENT_CONFIGS,
        printAgentContextWarning,
        filterByFeatureId,
        findWorktrees,
        buildAgentAliasMap,
        getAvailableAgents,
        getAgentCliConfig,
        getAgentLaunchFlagTokens,
        detectActiveAgentSession,
        setTerminalTitle,
        loadProjectConfig,
    } = u;
    const { getCurrentBranch } = ctx.git;

    const options = parseCliOptions(args);
    const id = options._[0];
    const legacyAutonomous = getOptionValue(options, 'autonomous') || getOptionValue(options, 'ralph');
    if (legacyAutonomous) {
        console.error(`❌ --autonomous/--ralph was renamed to --iterate on 2026-04-07.`);
        console.error(`   Run: aigon feature-do ${id || '<id>'} --iterate`);
        process.exitCode = 1;
        return;
    }
    const iterateRequested = getOptionValue(options, 'iterate');
    if (iterateRequested) {
        // Translate --iterate to --autonomous for the loop runner, which still
        // reads the legacy flag internally (runRalphCommand internals are unchanged).
        const translatedArgs = args.map(arg =>
            arg === '--iterate' || arg.startsWith('--iterate=') ? arg.replace('--iterate', '--autonomous') : arg
        );
        return deps.runRalphCommand(translatedArgs);
    }
    printAgentContextWarning('feature-do', id);
    if (!id) return console.error(
        "Usage: aigon feature-do <ID> [--agent=<agent-id>]\n\n" +
        "Run this after 'aigon feature-start <ID>'\n\n" +
        "Examples:\n" +
        "  aigon feature-do 55             # Launch default agent (cc) from shell\n" +
        "  aigon feature-do 55 --agent=cx  # Launch Codex from shell\n" +
        "  aigon feature-do 55 --iterate # Run Autopilot retry loop\n" +
        "  /aigon:feature-do 55            # Inside agent session: show instructions"
    );

    const mainRepoPath = deps.resolveMainRepoPath(process.cwd(), deps.ctx.git);
    const activeSnapshot = workflowSnapshotAdapter.readFeatureSnapshotSync(mainRepoPath, String(id).padStart(2, '0'));
    if (!activeSnapshot) return printError('feature', id, `Run 'aigon feature-start ${id}' first.`);
    const activeSpec = deps.resolveFeatureSpecInfo(process.cwd(), String(id).padStart(2, '0'), deps.ctx.git, { requireCurrentCheckout: true });
    let found = activeSpec.path
        ? {
            file: path.basename(activeSpec.path),
            fullPath: activeSpec.path,
            folder: activeSpec.stage,
        }
        : null;
    if (!found) {
        if (activeSpec.source === 'missing-in-current-checkout') {
            process.exitCode = 1;
            return console.error(`❌ Active spec for feature "${id}" is missing in this checkout.\n\nExpected: ./${path.relative(process.cwd(), activeSpec.missingPath)}\nSync the worktree or restart the feature.`);
        }
        return printError('feature', id, `Run 'aigon feature-start ${id}' first.`);
    }

    const match = found.file.match(/^feature-(\d+)-(.*)\.md$/);
    if (!match) return console.warn("⚠️  Could not parse filename.");
    const [_, num, desc] = match;

    // Detect mode based on current location
    const cwd = process.cwd();
    const dirName = path.basename(cwd);
    const worktreeMatch = dirName.match(/^feature-(\d+)-(\w+)-(.+)$/);

    let mode, agentId;
    if (worktreeMatch) {
        agentId = worktreeMatch[2];

        // Block if in a worktree for a different feature
        const [__, wtNum] = worktreeMatch;
        if (wtNum !== num && wtNum !== String(num).padStart(2, '0')) {
            console.error(`\n❌ You are in a worktree for feature ${wtNum} but trying to work on feature ${num}.`);
            console.error(`   Switch to the correct worktree or the main repo.\n`);
            return;
        }

        // Count worktrees for this feature to distinguish drive-wt from fleet
        let featureWorktreeCount = 0;
        try {
            featureWorktreeCount = filterByFeatureId(findWorktrees(), num).length;
        } catch (e) {
            // Default to fleet if we can't count
            featureWorktreeCount = 2;
        }

        mode = featureWorktreeCount >= 1 ? 'fleet' : 'drive-wt';
    } else {
        mode = 'drive';
    }

    // Resolve the agent to use, taking worktree context into account
    const availableAgents = getAvailableAgents();
    const agentArgRaw = getOptionValue(options, 'agent');
    const agentAliasMap = buildAgentAliasMap();
    let resolvedAgent;

    if (agentId) {
        // Inside a worktree: default to the worktree's own agent
        if (agentArgRaw) {
            const normalized = agentAliasMap[agentArgRaw.toLowerCase()] || agentArgRaw.toLowerCase();
            if (normalized !== agentId) {
                console.error(`❌ Agent mismatch: this worktree belongs to agent '${agentId}', but --agent='${normalized}' was requested.`);
                console.error(`   Remove --agent to use '${agentId}', or open the correct worktree.`);
                process.exitCode = 1;
                return;
            }
            resolvedAgent = normalized;
        } else {
            resolvedAgent = agentId;
        }
    } else {
        // Drive branch mode: default to configured agent
        if (agentArgRaw) {
            const normalized = agentAliasMap[agentArgRaw.toLowerCase()] || agentArgRaw.toLowerCase();
            if (!availableAgents.includes(normalized)) {
                console.error(`❌ Unknown agent '${agentArgRaw}'. Supported agents: ${availableAgents.join(', ')}`);
                process.exitCode = 1;
                return;
            }
            resolvedAgent = normalized;
        } else {
            resolvedAgent = getDefaultAgent(cwd);
        }
    }

    if (!availableAgents.includes(resolvedAgent)) {
        console.error(`❌ Unknown agent '${resolvedAgent}'. Supported agents: ${availableAgents.join(', ')}`);
        process.exitCode = 1;
        return;
    }

    // Display header (common to both launch mode and instruction mode)
    const paddedNum = String(num).padStart(2, '0');
    if (agentId) {
        const agentConfig = AGENT_CONFIGS[agentId] || {};
        const agentName = agentConfig.name || agentId;
        if (mode === 'fleet') {
            setTerminalTitle(`🚛 Feature #${paddedNum} - ${agentName}`);
            console.log(`\n🚛 Fleet Mode - Agent: ${agentId}`);
        } else {
            setTerminalTitle(`🚗 Feature #${paddedNum} - ${agentName}`);
            console.log(`\n🚗 Drive Mode (worktree) - Agent: ${agentId}`);
        }
        console.log(`   Feature: ${num} - ${desc}`);
        console.log(`   Worktree: ${dirName}`);
    } else {
        setTerminalTitle(`🚗 Feature #${paddedNum}`);
        try {
            const currentBranch = getCurrentBranch();
            const expectedBranch = `feature-${num}-${desc}`;
            if (currentBranch !== expectedBranch) {
                console.warn(`⚠️  Warning: Current branch (${currentBranch}) doesn't match expected (${expectedBranch})`);
                console.warn(`    Run 'aigon feature-start ${num}' first.`);
            }
            console.log(`\n🚗 Drive Mode`);
            console.log(`   Feature: ${num} - ${desc}`);
            console.log(`   Branch: ${currentBranch}`);
        } catch (e) {
            console.error(`❌ Could not determine git branch: ${e.message}`);
            return;
        }
    }

    // Detect whether we're already inside an active agent session
    const sessionInfo = detectActiveAgentSession();

    // Detect set slug from spec frontmatter for both launch and instruction modes.
    let setSlug = null;
    try {
        const specContent = fs.readFileSync(found.fullPath, 'utf8');
        setSlug = readSetTag(specContent);
    } catch (_) {}

    if (!sessionInfo.detected) {
        // --- LAUNCH MODE: spawn the selected agent in this context ---
        const cliConfig = getAgentCliConfig(resolvedAgent);
        const featureId = paddedNum;

        // Build SET_CONTEXT_SECTION for non-slash agents that inline the template.
        let setContextSection = '';
        if (setSlug) {
            setContextSection = buildSetContextSection(setSlug, cwd);
        }

        const prompt = resolveAgentPromptBody({
            agentId: resolvedAgent,
            verb: 'do',
            featureId,
            cliConfig,
            extraPlaceholders: { SET_CONTEXT_SECTION: setContextSection },
        });
        const model = cliConfig.models?.['implement'];

        if (!agentRegistry.supportsModelFlag(resolvedAgent) && model) {
            const _agentName = agentRegistry.getAgent(resolvedAgent)?.displayName || resolvedAgent;
            console.warn(`⚠️  Model config ignored for ${_agentName} — model selection is not supported via CLI flag`);
        }
        const modelTokens = (model && agentRegistry.supportsModelFlag(resolvedAgent)) ? ['--model', model] : [];
        const flagTokens = getAgentLaunchFlagTokens(cliConfig.command, cliConfig.implementFlag, { autonomous: false });
        const spawnArgs = [...flagTokens, ...modelTokens, prompt];

        const agentDisplayName = AGENT_CONFIGS[resolvedAgent]?.name || resolvedAgent;
        console.log(`\n🚀 Launching ${agentDisplayName}...`);
        console.log(`   Agent:   ${resolvedAgent}`);
        console.log(`   Command: ${cliConfig.command} ${spawnArgs.join(' ')}`);
        console.log(`   Dir:     ${cwd}\n`);

        const env = { ...process.env };
        if (cliConfig.command === 'claude') {
            // Unset CLAUDECODE to prevent "nested session" error
            delete env.CLAUDECODE;
        }

        const result = spawnSync(cliConfig.command, spawnArgs, { stdio: 'inherit', env, cwd });
        if (result.error) {
            console.error(`❌ Failed to launch agent: ${result.error.message}`);
            process.exitCode = 1;
        } else if (result.status !== 0) {
            process.exitCode = result.status || 1;
        }
        return;
    }

    // --- INSTRUCTION MODE: already inside an agent session, show next steps ---
    console.log(`\nℹ️  Running inside ${sessionInfo.agentName} session — showing instructions (nested launch prevented).`);

    // Check if spec exists and print content inline (saves agent a file read)
    const resolvedSpec = deps.resolveFeatureSpecInfo(cwd, num, deps.ctx.git);
    if (resolvedSpec.path) {
        console.log(`\n📋 Spec: ./${path.relative(cwd, resolvedSpec.path)}`);
        try {
            const specContent = fs.readFileSync(resolvedSpec.path, 'utf8');
            console.log(`\n--- SPEC CONTENT (already in context — no need to read the file) ---`);
            console.log(specContent);
            console.log(`--- END SPEC ---`);
        } catch (e) {
            // Fall back to letting the agent read it
        }
    }

    // Print set context if this spec is part of a set (instruction mode — cc reads this directly).
    if (setSlug) {
        printSetContextInstructions(setSlug, cwd);
    }

    const logVariant = resolveImplementationLogVariant(mode, loadProjectConfig(cwd).logging_level);
    const logDir = './docs/specs/features/logs/';
    if (logVariant === 'skip') {
        console.log(`📝 Log: not required in this mode (spec + commits are the record).`);
    } else {
        const logPattern = (mode === 'fleet' || mode === 'drive-wt') ? `feature-${num}-${agentId}-*-log.md` : `feature-${num}-*-log.md`;
        console.log(`📝 Log: ${logDir}${logPattern}`);
    }

    console.log(`\n📝 Next Steps:`);
    console.log(`   1. Implement the feature according to the spec above`);
    console.log(`   2. Commit your code with conventional commits (feat:, fix:, chore:)`);
    if (logVariant !== 'skip') {
        console.log(`   3. Update the implementation log`);
        console.log(`   4. Commit the log file`);
    }

    if (mode === 'fleet') {
        console.log(`\n⚠️  IMPORTANT:`);
        console.log(`   - Do NOT run 'aigon feature-close' from a worktree`);
        console.log(`   - Return to main repo when done`);
        console.log(`   - Run 'aigon feature-eval ${num}' to compare implementations`);
    } else if (mode === 'drive-wt') {
        console.log(`\n⚠️  IMPORTANT:`);
        console.log(`   - Do NOT run 'aigon feature-close' from a worktree`);
        console.log(`   - Return to main repo when done`);
        console.log(`   - Run 'aigon feature-close ${num}' from the main repo`);
    } else {
        console.log(`\n   When done: aigon feature-close ${num}`);
    }
}

module.exports = { run, buildSetMemberLogPattern, buildSetContextSection };
