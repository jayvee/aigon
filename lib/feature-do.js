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
const { readSetTag, readResearchTag, getSetMembersSorted, featurePathsForRepo } = require('./feature-sets');
const { readLatestSidecarWithSession, resolveResumeArgs } = require('./session-sidecar');

const LOGS_DIR = 'docs/specs/features/logs';
const RESEARCH_DIR = 'docs/specs/research-topics';
const RESEARCH_LOGS_DIR = 'docs/specs/research-topics/logs';
const RESEARCH_STAGE_FOLDERS = ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused'];

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

Do not restate what you read. Use it to inform your approach and avoid re-opening closed decisions.`;
}

/**
 * Normalize the `research:` frontmatter value (single int, array, or null)
 * to an array of positive integers. Drops anything non-numeric.
 */
function _normalizeResearchIds(ids) {
    if (ids === null || ids === undefined) return [];
    const arr = Array.isArray(ids) ? ids : [ids];
    return arr
        .map(v => parseInt(v, 10))
        .filter(n => Number.isFinite(n) && n > 0);
}

function _resolveResearchSpecPath(repoRoot, id) {
    for (const folder of RESEARCH_STAGE_FOLDERS) {
        const dir = path.join(repoRoot, RESEARCH_DIR, folder);
        if (!fs.existsSync(dir)) continue;
        let entries;
        try { entries = fs.readdirSync(dir); } catch (_) { continue; }
        for (const file of entries) {
            const m = file.match(/^research-(\d+)-.*\.md$/);
            if (m && parseInt(m[1], 10) === id) {
                return `./${RESEARCH_DIR}/${folder}/${file}`;
            }
        }
    }
    return null;
}

function _resolveResearchFindings(repoRoot, id) {
    const dir = path.join(repoRoot, RESEARCH_LOGS_DIR);
    if (!fs.existsSync(dir)) return [];
    let entries;
    try { entries = fs.readdirSync(dir); } catch (_) { return []; }
    return entries
        .filter(file => {
            const m = file.match(/^research-(\d+)-([a-z]{2})-findings\.md$/);
            return m && parseInt(m[1], 10) === id;
        })
        .sort()
        .map(file => `./${RESEARCH_LOGS_DIR}/${file}`);
}

/**
 * Build the {{RESEARCH_CONTEXT_SECTION}} placeholder value. Returns empty
 * string when no research IDs are provided or none resolve to on-disk
 * artifacts. Accepts a single integer or array of integers.
 */
function buildResearchContextSection(researchIds, repoRoot = process.cwd()) {
    const ids = _normalizeResearchIds(researchIds);
    if (ids.length === 0) return '';

    const sections = [];
    for (const id of ids) {
        const specPath = _resolveResearchSpecPath(repoRoot, id);
        const findings = _resolveResearchFindings(repoRoot, id);
        if (!specPath && findings.length === 0) continue;

        const lines = [];
        lines.push(`**Research ${id}:**`);
        if (specPath) lines.push(`- Spec: \`${specPath}\``);
        if (findings.length > 0) {
            lines.push('- Agent findings (read all that exist):');
            for (const p of findings) lines.push(`  - \`${p}\``);
        }
        sections.push(lines.join('\n'));
    }

    if (sections.length === 0) return '';

    return `## Step 2.6: Research context (this feature originated from research)

Before coding, read the source research in order:

${sections.join('\n\n')}

Focus on: recommended features, scope boundaries, and key tradeoffs identified in the findings. Do not restate what you read — use it to tighten your understanding of why this feature was created and what constraints the research surfaced.`;
}

/**
 * Print research context directly to stdout in instruction mode (cc reads
 * this inline). No-op when no research IDs resolve.
 */
function printResearchContextInstructions(researchIds, repoRoot = process.cwd()) {
    const ids = _normalizeResearchIds(researchIds);
    if (ids.length === 0) return;

    const blocks = [];
    for (const id of ids) {
        const specPath = _resolveResearchSpecPath(repoRoot, id);
        const findings = _resolveResearchFindings(repoRoot, id);
        if (!specPath && findings.length === 0) continue;
        blocks.push({ id, specPath, findings });
    }
    if (blocks.length === 0) return;

    console.log(`\n📚 Research context`);
    console.log(`   This feature originated from research. Read the source material before coding:`);
    for (const b of blocks) {
        if (b.specPath) console.log(`   Research ${b.id} spec: ${b.specPath}`);
        for (const f of b.findings) console.log(`   Research ${b.id} findings: ${f}`);
    }
    console.log(`   Focus on: recommended features, scope boundaries, key tradeoffs.`);
    console.log(`   Do not restate what you read — use it to inform your approach.`);
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

/**
 * Handle `aigon feature-do <ID> --resume [--agent <id>]`.
 *
 * Resolution order:
 *   1. If a tmux session for <ID>+<agent> is still alive → reattach it.
 *   2. Else look up the most recent sidecar with agentSessionId populated.
 *   3. If found → spawn the agent with its resume flag.
 *   4. If not found → exit non-zero with a repair hint.
 */
function _handleResume({ id, options, deps, u }) {
    const {
        AGENT_CONFIGS,
        buildAgentAliasMap,
        getAvailableAgents,
        getAgentCliConfig,
    } = u;
    const { tmuxSessionExists, buildTmuxSessionName, runTmux } = require('./worktree');
    const { toUnpaddedId } = require('./worktree');
    const { spawnSync } = require('child_process');

    if (!id) {
        console.error('Usage: aigon feature-do <ID> --resume [--agent=<agent-id>]');
        process.exitCode = 1;
        return;
    }

    const mainRepoPath = deps.resolveMainRepoPath(process.cwd(), deps.ctx.git);
    const paddedId = String(id).padStart(2, '0');
    const unpadded = toUnpaddedId(paddedId);

    // Resolve agent
    const agentArgRaw = getOptionValue(options, 'agent');
    const agentAliasMap = buildAgentAliasMap();
    const availableAgents = getAvailableAgents();
    let agentId;
    if (agentArgRaw) {
        agentId = agentAliasMap[agentArgRaw.toLowerCase()] || agentArgRaw.toLowerCase();
        if (!availableAgents.includes(agentId)) {
            console.error(`❌ Unknown agent '${agentArgRaw}'.`);
            process.exitCode = 1;
            return;
        }
    } else {
        agentId = require('./config').getDefaultAgent(process.cwd());
    }

    // Step 1: check live tmux session
    const sidecarDir = require('path').join(require('path').resolve(mainRepoPath), '.aigon', 'sessions');
    const fs2 = require('fs');
    let liveTmuxSession = null;
    if (fs2.existsSync(sidecarDir)) {
        for (const f of fs2.readdirSync(sidecarDir)) {
            if (!f.endsWith('.json')) continue;
            try {
                const raw = JSON.parse(fs2.readFileSync(require('path').join(sidecarDir, f), 'utf8'));
                if (!raw || raw.entityType !== 'f') continue;
                if (String(raw.entityId) !== String(unpadded) && String(raw.entityId) !== paddedId) continue;
                if (raw.agent !== agentId) continue;
                if (raw.sessionName && tmuxSessionExists(raw.sessionName)) {
                    liveTmuxSession = raw.sessionName;
                    break;
                }
            } catch (_) {}
        }
    }

    if (liveTmuxSession) {
        console.log(`\n🔗 Reattaching live tmux session: ${liveTmuxSession}`);
        const result = spawnSync('tmux', ['attach-session', '-t', liveTmuxSession], { stdio: 'inherit' });
        if (result.error) {
            console.error(`❌ Failed to attach: ${result.error.message}`);
            process.exitCode = 1;
        }
        return;
    }

    // Step 2: look up sidecar with agentSessionId
    const sidecar = readLatestSidecarWithSession(mainRepoPath, 'f', unpadded, agentId);
    if (!sidecar) {
        console.error(`❌ No recorded agent session found for feature ${paddedId} (agent: ${agentId}).`);
        console.error(`   The session sidecar may not have captured the agent's session ID yet,`);
        console.error(`   or this feature was started before session-ID capture was enabled.`);
        console.error(`   Manual recovery: claude --resume (interactive picker)`);
        process.exitCode = 1;
        return;
    }

    // Step 3: spawn agent with resume flag
    const resumeSpec = resolveResumeArgs(agentId, sidecar.agentSessionId);
    if (!resumeSpec) {
        console.error(`❌ Resume is not supported for agent '${agentId}'.`);
        process.exitCode = 1;
        return;
    }

    const cliConfig = getAgentCliConfig(agentId);
    const command = cliConfig.command;

    let spawnCmd, spawnArgs;
    if (resumeSpec.isSubcommand) {
        // e.g. codex resume <id>
        spawnArgs = [...resumeSpec.prependArgs];
        spawnCmd = command;
    } else {
        spawnArgs = [...resumeSpec.appendArgs];
        spawnCmd = command;
    }

    const env = { ...process.env };
    if (command === 'claude') delete env.CLAUDECODE;

    console.log(`\n🔄 Resuming ${AGENT_CONFIGS[agentId]?.name || agentId} session ${sidecar.agentSessionId}`);
    console.log(`   ${command} ${spawnArgs.join(' ')}`);
    console.log(`   Original session: ${sidecar.sessionName || '(unknown)'}, created ${sidecar.createdAt || '(unknown)'}\n`);

    const result = spawnSync(spawnCmd, spawnArgs, { stdio: 'inherit', env, cwd: sidecar.worktreePath || process.cwd() });
    if (result.error) {
        console.error(`❌ Failed to resume agent: ${result.error.message}`);
        process.exitCode = 1;
    } else if (result.status !== 0) {
        process.exitCode = result.status || 1;
    }
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
    const resumeRequested = getOptionValue(options, 'resume');
    if (resumeRequested !== undefined && resumeRequested !== false) {
        return _handleResume({ id, options, deps, u });
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

    // Detect set slug + research IDs from spec frontmatter for both launch and instruction modes.
    let setSlug = null;
    let researchIds = null;
    try {
        const specContent = fs.readFileSync(found.fullPath, 'utf8');
        setSlug = readSetTag(specContent);
        researchIds = readResearchTag(specContent);
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

        // Build RESEARCH_CONTEXT_SECTION — independent of set membership;
        // resolves spec + findings paths from the `research:` frontmatter.
        const researchContextSection = buildResearchContextSection(researchIds, cwd);

        const prompt = resolveAgentPromptBody({
            agentId: resolvedAgent,
            verb: 'do',
            featureId,
            cliConfig,
            extraPlaceholders: {
                SET_CONTEXT_SECTION: setContextSection,
                RESEARCH_CONTEXT_SECTION: researchContextSection,
            },
        });
        const model = cliConfig.models?.['implement'];

        if (!agentRegistry.supportsModelFlag(resolvedAgent) && model) {
            const _agentName = agentRegistry.getAgent(resolvedAgent)?.displayName || resolvedAgent;
            console.warn(`⚠️  Model config ignored for ${_agentName} — model selection is not supported via CLI flag`);
        }
        const modelTokens = (model && agentRegistry.supportsModelFlag(resolvedAgent)) ? ['--model', model] : [];
        const flagTokens = getAgentLaunchFlagTokens(cliConfig.command, cliConfig.implementFlag, { autonomous: false });
        const promptFlag = agentRegistry.getPromptFlag(resolvedAgent);
        const spawnArgs = [...flagTokens, ...modelTokens, ...(promptFlag ? [promptFlag] : []), prompt];

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

    // Print research context regardless of set membership.
    if (researchIds) {
        printResearchContextInstructions(researchIds, cwd);
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

module.exports = {
    run,
    buildSetMemberLogPattern,
    buildSetContextSection,
    buildResearchContextSection,
    printResearchContextInstructions,
};
