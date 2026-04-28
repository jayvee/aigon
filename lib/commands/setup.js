'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');
const workflowEngine = require('../workflow-core/engine');
const agentRegistry = require('../agent-registry');
const { loadGlobalConfig, loadProjectConfig } = require('../config');
const { LIFECYCLE_TO_FEATURE_DIR, LIFECYCLE_TO_RESEARCH_DIR } = require('../workflow-core/paths');

// Helpers split into sibling submodules under lib/commands/setup/ for navigability.
// See docs/reports/simplifications-2026-04.md and feature-415-* spec.
const seedReset = require('./setup/seed-reset');
const worktreeCleanup = require('./setup/worktree-cleanup');
const gitignoreAndHooks = require('./setup/gitignore-and-hooks');
const pidUtils = require('./setup/pid-utils');
const agentTrust = require('./setup/agent-trust');

const {
    FEATURE_STAGE_FOLDERS,
    WORKING_REPO_REGISTRY,
    SEED_RESET_TO_BACKLOG,
    canonicalSeedFeatureId,
    parseEntitySpecIdentity,
    writeJsonFile,
    rebuildSeedFeatureManifests,
    findSeedResetBaseline,
    normalizeGitHubRepoSlug,
    collectSeedResetRemoteUrls,
    parseSeedResetRemoteHeads,
    cleanupSeedResetRemoteBranches,
    closeSeedResetOpenPullRequests,
    stripSeedResetStaleConfigKeys,
} = seedReset;

const { expandHomePath, listExistingAigonWorktrees } = worktreeCleanup;

const {
    ENV_LOCAL_GITIGNORE_ENTRIES,
    ENV_LOCAL_FILE_REGEX,
    SECURITY_HOOKS_PATH,
    PRE_COMMIT_HOOK_NAME,
    PRE_COMMIT_HOOK_CONTENT,
    quoteShellArg,
    wrapAigonCommand,
    migrateAigonHookCommand,
    readGitignoreContent,
    hasGitignoreEntry,
    getEnvLocalGitignoreStatus,
    ensureEnvLocalGitignore,
    ensureLocalGitExclude,
    getInstalledVersionAt,
    getTrackedEnvLocalFiles,
    untrackFiles,
    ensurePreCommitHook,
    readHooksPath,
    isHooksPathConfigured,
    isInsideGitRepo,
    ensureHooksPathConfigured,
    gitAddPathsFromPorcelain,
} = gitignoreAndHooks;

const { listPidsUsingPath, listRepoRelatedPids, isPidAlive, killPidsHard } = pidUtils;

const {
    STAGE_TO_LIFECYCLE,
    RESEARCH_STAGE_FOLDERS,
    findSpecsWithInvalidAgentField,
    repairInvalidAgentField,
    findEntitiesMissingWorkflowState,
    bootstrapMissingWorkflowSnapshots,
} = agentTrust;

module.exports = function setupCommands(ctx) {
    const u = ctx.utils;
    const versionLib = ctx.version;

    const {
        PATHS,
        SPECS_ROOT,
        GLOBAL_CONFIG_DIR,
        GLOBAL_CONFIG_PATH,
        MARKER_START,
        MARKER_END,
        COMMAND_ALIASES,
        COMMAND_ALIAS_REVERSE,
        showPortSummary,
        getActiveProfile,
        readBasePort,
        registerPort,
        getAvailableAgents,
        loadAgentConfig,
        buildAgentAliasMap,
        resolveAgentCommands,
        readTemplate,
        readGenericTemplate,
        processTemplate,
        safeWrite,
        safeWriteWithStatus,
        upsertMarkedContent,
        upsertRootFile,
        extractDescription,
        formatCommandOutput,
        getProfilePlaceholders,
        computeInstructionsConfigHash,
        removeDeprecatedCommands,
        removeDeprecatedSkillDirs,
        renderSkillMd,
        getStatusRaw,
    } = u;

    const {
        getAigonVersion,
        getInstalledVersion,
        setInstalledVersion,
        compareVersions,
        getChangelogEntriesSince,
        checkAigonCliOrigin,
        upgradeAigonCli,
    } = versionLib;

    const {
        ensureBoardMapInGitignore,
    } = ctx.board;

    const commands = {
        'init': (args) => {
            console.log("ACTION: Initializing Aigon in ./docs/specs ...");
            const createDirs = (root, folders) => {
                folders.forEach(f => {
                    const p = path.join(root, f);
                    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
                    // Add .gitkeep to ensure empty directories are tracked by git
                    const gitkeepPath = path.join(p, '.gitkeep');
                    if (!fs.existsSync(gitkeepPath)) {
                        fs.writeFileSync(gitkeepPath, '');
                    }
                });
            };
            createDirs(PATHS.research.root, PATHS.research.folders);
            createDirs(PATHS.features.root, PATHS.features.folders);
            createDirs(PATHS.feedback.root, PATHS.feedback.folders);
            const featLogs = path.join(PATHS.features.root, 'logs');
            if (!fs.existsSync(path.join(featLogs, 'selected'))) fs.mkdirSync(path.join(featLogs, 'selected'), { recursive: true });
            if (!fs.existsSync(path.join(featLogs, 'alternatives'))) fs.mkdirSync(path.join(featLogs, 'alternatives'), { recursive: true });
            if (!fs.existsSync(path.join(PATHS.features.root, 'evaluations'))) fs.mkdirSync(path.join(PATHS.features.root, 'evaluations'), { recursive: true });
            // Add .gitkeep to log and evaluation folders
            [path.join(featLogs, 'selected'), path.join(featLogs, 'alternatives'), path.join(PATHS.features.root, 'evaluations')].forEach(p => {
                const gitkeepPath = path.join(p, '.gitkeep');
                if (!fs.existsSync(gitkeepPath)) fs.writeFileSync(gitkeepPath, '');
            });
            const readmePath = path.join(SPECS_ROOT, 'README.md');
            if (!fs.existsSync(readmePath)) {
                const readmeContent = `# Aigon Specs\n\n**This folder is the Single Source of Truth.**\n\n## Rules\n1. READ ONLY: backlog, inbox, done.\n2. WRITE: Only edit code if feature spec is in features/in-progress.\n`;
                fs.writeFileSync(readmePath, readmeContent);
            }

            // Ensure .aigon/.board-map.json is in .gitignore
            ensureBoardMapInGitignore();
            ensureEnvLocalGitignore();
            ensurePreCommitHook();

            console.log("✅ ./docs/specs directory structure created.");

            // Rebuild manifests for any existing features/research (e.g., cloned seed repos)
            try {
                const manifests = rebuildSeedFeatureManifests(process.cwd());
                if (manifests.length > 0) {
                    console.log(`   ✓ Rebuilt ${manifests.length} manifest(s) for existing features`);
                }
                // Bootstrap workflow-core snapshots so features don't show as "legacy" on the board
                const { features: missingF, research: missingR } = findEntitiesMissingWorkflowState(process.cwd());
                const bootstrapped = bootstrapMissingWorkflowSnapshots(process.cwd(), missingF, 'feature')
                    + bootstrapMissingWorkflowSnapshots(process.cwd(), missingR, 'research');
                if (bootstrapped > 0) {
                    console.log(`   ✓ Bootstrapped workflow state for ${bootstrapped} entit${bootstrapped === 1 ? 'y' : 'ies'}`);
                }
            } catch (e) { /* non-fatal */ }

            // Auto-allocate a port in the global registry
            const initProfile = getActiveProfile();
            if (initProfile.devServer.enabled) {
                const { allocateBasePort } = u;
                const allocatedPort = allocateBasePort(process.cwd());
                console.log(`\n📋 Port ${allocatedPort} allocated (block of ${u.PORT_BLOCK_SIZE})`);
            }
            showPortSummary();

            // Recommend eslint-plugin-security for web/api profiles with ESLint
            if (initProfile.name === 'web' || initProfile.name === 'api') {
                const hasEslint = fs.existsSync(path.join(process.cwd(), '.eslintrc.json'))
                    || fs.existsSync(path.join(process.cwd(), '.eslintrc.js'))
                    || fs.existsSync(path.join(process.cwd(), '.eslintrc.cjs'))
                    || fs.existsSync(path.join(process.cwd(), '.eslintrc.yml'))
                    || fs.existsSync(path.join(process.cwd(), 'eslint.config.js'))
                    || fs.existsSync(path.join(process.cwd(), 'eslint.config.mjs'))
                    || fs.existsSync(path.join(process.cwd(), 'eslint.config.cjs'))
                    || fs.existsSync(path.join(process.cwd(), 'eslint.config.ts'));
                if (hasEslint) {
                    console.log('\n💡 Tip: Install eslint-plugin-security for OWASP pattern detection in your ESLint config:');
                    console.log('   npm install --save-dev eslint-plugin-security');
                }
            }

            // Create worktree base directory and trust it for all agents
            const repoName = path.basename(process.cwd());
            const wtBase = path.join(os.homedir(), '.aigon', 'worktrees', repoName);
            fs.mkdirSync(wtBase, { recursive: true });
            try {
                const agentRegistry = require('../agent-registry');
                const installedAgents = getAvailableAgents().filter(agentId => {
                    try {
                        return loadAgentConfig(agentId) !== null;
                    } catch (_) { return false; }
                });
                const existingWorktrees = listExistingAigonWorktrees(process.cwd());
                installedAgents.forEach(agentId => {
                    const trustTargets = agentRegistry.getTrustInstallScope(agentId) === 'all-existing-worktrees'
                        ? existingWorktrees
                        : [wtBase];
                    try { agentRegistry.ensureAgentTrust(agentId, trustTargets); } catch (_) { /* best-effort */ }
                });
            } catch (_) { /* agent trust is best-effort */ }
            console.log(`\n📂 Worktrees: ${wtBase}`);
        },

        'install-agent': async (args) => {
            // Use new config-driven approach
            const availableAgents = getAvailableAgents();

            if (args.length === 0) {
                const agentList = availableAgents.join('|');
                return console.error(`Usage: aigon install-agent <${agentList}> [${agentList}] ...\nExample: aigon install-agent cc gg`);
            }

            // Build alias map dynamically from agent configs
            const agentMap = buildAgentAliasMap();

            const agents = args.map(a => agentMap[a.toLowerCase()]).filter(Boolean);
            if (agents.length === 0) {
                return console.error(`❌ No valid agents specified. Available: ${availableAgents.join(', ')}`);
            }

            const uniqueAgents = [...new Set(agents)];

            try {
                try {
                    const { runPendingMigrations } = require('../migration');
                    await runPendingMigrations(process.cwd());
                } catch (e) {
                    console.warn(`⚠️  Migration check failed during install-agent: ${e.message}`);
                }

                // 1. Create shared workflow documentation (always)
                const workflowPath = path.join(process.cwd(), 'docs', 'development_workflow.md');
                const workflowRaw = readTemplate('docs/development_workflow.md');
                const lightDirectives = require('../profile-placeholders').resolveInstructionDirectives(
                    require('../config').loadProjectConfig(process.cwd())?.instructions
                );
                const isLightRigor = lightDirectives.testing === 'skip' && lightDirectives.logging === 'skip';
                const { stripLightOptionalBlocks } = require('../templates');
                const workflowContent = stripLightOptionalBlocks(workflowRaw, isLightRigor);
                const workflowStatus = safeWriteWithStatus(workflowPath, workflowContent);
                if (workflowStatus !== 'unchanged') {
                    console.log(`✅ ${workflowStatus.charAt(0).toUpperCase() + workflowStatus.slice(1)}: docs/development_workflow.md`);
                }

                // 2. Install each agent using its config.
                //    Aigon does not write or modify AGENTS.md / CLAUDE.md / README.md —
                //    those are user-owned. Discovery happens via per-agent skills and
                //    always-loaded rule files installed under .claude/, .cursor/, etc.
                uniqueAgents.forEach(agentKey => {
                    const config = loadAgentConfig(agentKey);
                    if (!config) {
                        console.warn(`⚠️  No config found for agent: ${agentKey}`);
                        return;
                    }

                    console.log(`\n📦 Installing ${config.displayName || config.name} (${config.id})...`);

                    // Check if the agent CLI binary is in PATH
                    const cliBinary = config.cli && config.cli.command;
                    if (cliBinary) {
                        const { isBinaryAvailable: isBinAvail } = require('../security');
                        if (!isBinAvail(cliBinary)) {
                            const hint = config.installHint || `Install ${cliBinary} and add it to your PATH`;
                            console.warn(`   ⚠️  '${cliBinary}' not found in PATH. Install it first:`);
                            console.warn(`      ${hint}`);
                            console.log(`   Continuing with config file installation...`);
                        }
                    }

                    // Create/update docs/agents/<agent>.md from template (preserves user additions)
                    const agentDocPath = path.join(process.cwd(), 'docs', 'agents', config.agentFile);
                    const agentTemplateRaw = readTemplate(config.templatePath);
                    // Process template with agent-specific placeholders, then strip light-rigor blocks
                    const agentTemplateProcessed = processTemplate(agentTemplateRaw, config.placeholders);
                    const agentTemplateContent = stripLightOptionalBlocks(agentTemplateProcessed, isLightRigor);
                    // Template already contains markers, extract content between them for upsert
                    const markerContentMatch = agentTemplateContent.match(new RegExp(`${MARKER_START}\\n([\\s\\S]*?)\\n${MARKER_END}`));
                    const agentContent = markerContentMatch ? markerContentMatch[1] : agentTemplateContent;
                    const agentAction = upsertMarkedContent(agentDocPath, agentContent);
                    if (agentAction !== 'unchanged') {
                        console.log(`   ✅ ${agentAction.charAt(0).toUpperCase() + agentAction.slice(1)}: docs/agents/${config.agentFile}`);
                    }

                    // Generate and install commands from generic templates
                    if (config.output) {
                        // Codex migration: clean up legacy ~/.codex/prompts/aigon-*.md files
                        // from previous aigon versions before installing skills.
                        if (config.id === 'cx') {
                            const legacyPromptsDir = path.join(
                                process.env.HOME || process.env.USERPROFILE || '',
                                '.codex',
                                'prompts'
                            );
                            if (fs.existsSync(legacyPromptsDir)) {
                                let removedLegacy = 0;
                                try {
                                    for (const f of fs.readdirSync(legacyPromptsDir)) {
                                        if (!f.startsWith('aigon-') || !f.endsWith('.md')) continue;
                                        try {
                                            fs.unlinkSync(path.join(legacyPromptsDir, f));
                                            removedLegacy++;
                                        } catch (_) { /* best-effort */ }
                                    }
                                } catch (_) { /* best-effort */ }
                                if (removedLegacy > 0) {
                                    console.log(`   🧹 Removed ${removedLegacy} deprecated Codex prompt file(s) from ~/.codex/prompts/`);
                                }
                            }
                            // Also remove the now-unused .codex/prompt.md (extras.prompt disabled)
                            const legacyPromptFile = path.join(process.cwd(), '.codex', 'prompt.md');
                            if (fs.existsSync(legacyPromptFile)) {
                                try {
                                    fs.unlinkSync(legacyPromptFile);
                                    console.log(`   🧹 Removed deprecated .codex/prompt.md`);
                                } catch (_) { /* best-effort */ }
                            }
                        }

                        // Expand ~ to home directory for global commands
                        let cmdDir = config.output.commandDir;
                        if (cmdDir.startsWith('~')) {
                            cmdDir = cmdDir.replace('~', process.env.HOME || process.env.USERPROFILE);
                        } else {
                            cmdDir = path.join(process.cwd(), cmdDir);
                        }

                        // Merge profile-derived placeholders into config
                        const profilePlaceholders = getProfilePlaceholders({ forCommandTemplateInstall: true, repoPath: process.cwd() });
                        const mergedConfig = { ...config, placeholders: { ...config.placeholders, ...profilePlaceholders } };

                        const isSkillMd = config.output.format === 'skill-md';

                        const commandNames = resolveAgentCommands(mergedConfig);
                        let cmdChanges = { created: 0, updated: 0 };
                        commandNames.forEach(cmdName => {
                            // Read generic template and process placeholders (includes profile-derived values)
                            const genericContent = readGenericTemplate(`commands/${cmdName}.md`, mergedConfig);
                            const description = extractDescription(genericContent);

                            if (isSkillMd) {
                                // Codex skill layout: one directory per command containing SKILL.md.
                                const skillName = `${config.output.commandFilePrefix}${cmdName}`;
                                const skillDir = path.join(cmdDir, skillName);
                                const skillContent = renderSkillMd({
                                    name: skillName,
                                    description,
                                    body: genericContent,
                                });
                                const skillFileName = config.output.skillFileName || 'SKILL.md';
                                const status = safeWriteWithStatus(path.join(skillDir, skillFileName), skillContent);
                                if (status === 'created') cmdChanges.created++;
                                else if (status === 'updated') cmdChanges.updated++;
                                // No alias-skill generation: implicit invocation handles intent matching.
                                return;
                            }

                            // Format output based on agent's output format
                            const outputContent = formatCommandOutput(genericContent, description, cmdName, config);

                            // Write to agent's command directory
                            const fileName = `${config.output.commandFilePrefix}${cmdName}${config.output.commandFileExtension}`;
                            const status = safeWriteWithStatus(path.join(cmdDir, fileName), outputContent);
                            if (status === 'created') cmdChanges.created++;
                            else if (status === 'updated') cmdChanges.updated++;

                            // Generate short alias files in parent directory for top-level access
                            // e.g., generated alias files live in the parent dir for top-level slash access.
                            const aliases = COMMAND_ALIAS_REVERSE[cmdName] || [];
                            const aliasDir = path.dirname(cmdDir);
                            aliases.forEach(alias => {
                                const aliasDesc = `${description} (shortcut for ${cmdName})`;
                                const aliasContent = formatCommandOutput(genericContent, aliasDesc, cmdName, config);
                                const aliasFileName = `${config.output.commandFilePrefix}${alias}${config.output.commandFileExtension}`;
                                const aliasStatus = safeWriteWithStatus(path.join(aliasDir, aliasFileName), aliasContent);
                                if (aliasStatus === 'created') cmdChanges.created++;
                                else if (aliasStatus === 'updated') cmdChanges.updated++;
                            });
                        });

                        const removed = isSkillMd
                            ? removeDeprecatedSkillDirs(cmdDir, config)
                            : removeDeprecatedCommands(cmdDir, config);

                        // Clean up deprecated alias files in parent directory (flat layout only)
                        // Uses content-based detection: only removes files containing '(shortcut for '
                        const removedAliases = [];
                        if (!isSkillMd) {
                            const aliasParentDir = path.dirname(cmdDir);
                            const expectedAliasFiles = new Set(
                                Object.keys(COMMAND_ALIASES).map(alias =>
                                    `${config.output.commandFilePrefix}${alias}${config.output.commandFileExtension}`
                                )
                            );
                            if (fs.existsSync(aliasParentDir)) {
                                for (const file of fs.readdirSync(aliasParentDir)) {
                                    if (!file.endsWith(config.output.commandFileExtension)) continue;
                                    const filePath = path.join(aliasParentDir, file);
                                    if (!fs.statSync(filePath).isFile()) continue;
                                    // Skip current aliases
                                    if (expectedAliasFiles.has(file)) continue;
                                    // Only remove files generated by us (contain shortcut marker in description)
                                    try {
                                        const content = fs.readFileSync(filePath, 'utf8');
                                        if (!content.includes('(shortcut for ')) continue;
                                        fs.unlinkSync(filePath);
                                        removedAliases.push(file);
                                    } catch (e) { /* ignore */ } // optional
                                }
                            }
                        }

                        const migrated = [];

                        // Contributor-only commands: installed at the root of the agent's command
                        // dir (no aigon/ subfolder), and only when running inside the aigon repo
                        // itself. Source of truth: templates/contributing/*.md
                        const contribDir = path.join(u.TEMPLATES_ROOT, 'contributing');
                        const isAigonRepo = fs.existsSync(path.join(process.cwd(), 'aigon-cli.js'));
                        let contribChanges = { created: 0, updated: 0 };
                        if (isAigonRepo && fs.existsSync(contribDir)) {
                            const contribTargetDir = isSkillMd ? cmdDir : path.dirname(cmdDir);
                            const files = fs.readdirSync(contribDir).filter(f => f.endsWith('.md'));
                            files.forEach(file => {
                                const cmdName = file.replace(/\.md$/, '');
                                const raw = fs.readFileSync(path.join(contribDir, file), 'utf8');
                                const body = processTemplate(raw, mergedConfig.placeholders);
                                const description = extractDescription(body);
                                if (isSkillMd) {
                                    const skillDir = path.join(contribTargetDir, cmdName);
                                    const skillContent = renderSkillMd({ name: cmdName, description, body });
                                    const fileName = config.output.skillFileName || 'SKILL.md';
                                    const status = safeWriteWithStatus(path.join(skillDir, fileName), skillContent);
                                    if (status === 'created') contribChanges.created++;
                                    else if (status === 'updated') contribChanges.updated++;
                                } else {
                                    const outputContent = formatCommandOutput(body, description, cmdName, config);
                                    const fileName = `${cmdName}${config.output.commandFileExtension}`;
                                    const status = safeWriteWithStatus(path.join(contribTargetDir, fileName), outputContent);
                                    if (status === 'created') contribChanges.created++;
                                    else if (status === 'updated') contribChanges.updated++;
                                }
                            });
                        }

                        // Only report if there were actual changes
                        const totalChanges = cmdChanges.created + cmdChanges.updated + removed.length + removedAliases.length + migrated.length + contribChanges.created + contribChanges.updated;
                        if (totalChanges > 0) {
                            if (isSkillMd) {
                                const parts = [];
                                if (cmdChanges.created > 0) parts.push(`${cmdChanges.created} created`);
                                if (cmdChanges.updated > 0) parts.push(`${cmdChanges.updated} updated`);
                                console.log(`   ✅ Skills: ${parts.join(', ') || 'synced'} → ${config.output.commandDir}/aigon-*/SKILL.md`);
                            } else if (config.output.global) {
                                console.log(`   ✅ Installed global prompts: ${config.output.commandDir}`);
                            } else {
                                const parts = [];
                                if (cmdChanges.created > 0) parts.push(`${cmdChanges.created} created`);
                                if (cmdChanges.updated > 0) parts.push(`${cmdChanges.updated} updated`);
                                console.log(`   ✅ Commands: ${parts.join(', ') || 'synced'}`);
                            }
                            if (removed.length > 0) {
                                console.log(`   🧹 Removed ${removed.length} deprecated ${isSkillMd ? 'skill' : 'command'}(s): ${removed.join(', ')}`);
                            }
                            if (migrated.length > 0) {
                                console.log(`   🔄 Migrated: removed ${migrated.length} old flat command(s) from parent directory`);
                            }
                        }
                    }

                    // Process extras (skill, settings, prompt, config)
                    const extras = config.extras || {};

                    // Claude: SKILL.md
                    if (extras.skill && extras.skill.enabled) {
                        // Add AGENT_FILE placeholder for skill template
                        const skillPlaceholders = { ...config.placeholders, AGENT_FILE: config.agentFile.replace('.md', '') };
                        const skillContent = processTemplate(readTemplate('generic/skill.md'), skillPlaceholders);
                        const skillStatus = safeWriteWithStatus(path.join(process.cwd(), extras.skill.path), skillContent);
                        if (skillStatus !== 'unchanged') {
                            console.log(`   ✅ ${skillStatus.charAt(0).toUpperCase() + skillStatus.slice(1)}: ${extras.skill.path}`);
                        }
                    }

                    // Settings files (Claude permissions, Gemini allowedTools)
                    if (extras.settings && extras.settings.enabled) {
                        const settingsPath = path.join(process.cwd(), extras.settings.path);
                        let settings = {};
                        let existingContent = '';
                        if (fs.existsSync(settingsPath)) {
                            try {
                                existingContent = fs.readFileSync(settingsPath, 'utf8');
                                settings = JSON.parse(existingContent);
                            } catch (e) {
                                console.warn(`   ⚠️  Could not parse existing ${extras.settings.path}, creating new one`);
                            }
                        }

                        let settingsChanged = false;

                        // Add permissions (Claude, Cursor)
                        if (extras.settings.permissions) {
                            if (!settings.permissions) settings.permissions = {};
                            if (!settings.permissions.allow) settings.permissions.allow = [];
                            if (!settings.permissions.deny) settings.permissions.deny = [];
                            extras.settings.permissions.forEach(perm => {
                                if (!settings.permissions.allow.includes(perm)) {
                                    settings.permissions.allow.push(perm);
                                    settingsChanged = true;
                                }
                            });
                            if (settingsChanged) {
                                console.log(`   ✅ Added permissions to ${extras.settings.path}`);
                            }
                        }

                        // Add deny permissions (Claude)
                        if (extras.settings.denyPermissions) {
                            if (!settings.permissions) settings.permissions = {};
                            if (!settings.permissions.deny) settings.permissions.deny = [];
                            let deniesAdded = false;
                            extras.settings.denyPermissions.forEach(perm => {
                                if (!settings.permissions.deny.includes(perm)) {
                                    settings.permissions.deny.push(perm);
                                    deniesAdded = true;
                                }
                            });
                            if (deniesAdded) {
                                console.log(`   🛡️  Added deny rules to ${extras.settings.path}`);
                                settingsChanged = true;
                            }
                        }

                        // Add Policy Engine rules (Gemini) — replaces deprecated allowedTools
                        if (extras.settings.policies) {
                            const configuredPolicyPath = expandHomePath(extras.settings.policyPath || path.join('.gemini', 'policies', 'aigon.toml'));
                            const policyFile = path.isAbsolute(configuredPolicyPath)
                                ? configuredPolicyPath
                                : path.join(process.cwd(), configuredPolicyPath);
                            const policyLines = ['# Aigon CLI — auto-generated policy rules', ''];
                            extras.settings.policies.forEach(rule => {
                                policyLines.push('[[rule]]');
                                Object.entries(rule).forEach(([key, val]) => {
                                    policyLines.push(`${key} = ${JSON.stringify(val)}`);
                                });
                                policyLines.push('');
                            });
                            const policyContent = policyLines.join('\n');
                            const existingPolicy = fs.existsSync(policyFile) ? fs.readFileSync(policyFile, 'utf8') : '';
                            if (policyContent !== existingPolicy) {
                                safeWrite(policyFile, policyContent);
                                const displayPath = policyFile.startsWith(os.homedir())
                                    ? `~${policyFile.slice(os.homedir().length)}`
                                    : path.relative(process.cwd(), policyFile);
                                console.log(`   ✅ Created ${displayPath} (Policy Engine)`);
                                settingsChanged = true;
                            }
                            // Migrate: remove deprecated allowedTools from settings if present
                            if (settings.allowedTools) {
                                delete settings.allowedTools;
                                console.log(`   🔄 Removed deprecated allowedTools from ${extras.settings.path}`);
                                settingsChanged = true;
                            }
                            // Also remove tools.allowed (alternate deprecated format)
                            if (settings.tools?.allowed) {
                                delete settings.tools.allowed;
                                if (Object.keys(settings.tools).length === 0) delete settings.tools;
                                console.log(`   🔄 Removed deprecated tools.allowed from ${extras.settings.path}`);
                                settingsChanged = true;
                            }
                        }

                        // Top-level settings key-value pairs (e.g. approvalMode for Gemini)
                        if (extras.settings.topLevelSettings) {
                            Object.entries(extras.settings.topLevelSettings).forEach(([key, value]) => {
                                if (settings[key] !== value) {
                                    settings[key] = value;
                                    settingsChanged = true;
                                }
                            });
                            if (settingsChanged) {
                                console.log(`   ✅ Added top-level settings to ${extras.settings.path}`);
                            }
                        }

                        // Legacy: Add allowedTools (Gemini) — kept for backwards compat with older Gemini CLI
                        if (extras.settings.allowedTools && !extras.settings.policies) {
                            if (!settings.allowedTools) settings.allowedTools = [];
                            let toolsAdded = false;
                            extras.settings.allowedTools.forEach(tool => {
                                if (!settings.allowedTools.includes(tool)) {
                                    settings.allowedTools.push(tool);
                                    toolsAdded = true;
                                }
                            });
                            if (toolsAdded) {
                                console.log(`   ✅ Added allowedTools to ${extras.settings.path}`);
                                settingsChanged = true;
                            }
                        }

                        // Remove legacy Claude hook keys that current Claude Code rejects.
                        if (extras.settings.path === '.claude/settings.json' && settings.hooks?.PostCommit) {
                            delete settings.hooks.PostCommit;
                            settingsChanged = true;
                            console.log(`   🔄 Removed unsupported PostCommit hook from ${extras.settings.path}`);
                        }

                        // Add SessionStart hooks (Claude, Gemini — embedded in settings file)
                        if (extras.settings.hooks) {
                            if (!settings.hooks) settings.hooks = {};
                            // Migrate existing hooks to the login-shell wrapper form.
                            // Rewrites bare 'aigon ...', hardcoded absolute paths, and stale
                            // fnm_multishells paths. Already-wrapped commands are left unchanged
                            // (idempotent). Non-Aigon hook entries are never touched.
                            Object.values(settings.hooks).forEach(hookArr => {
                                hookArr.forEach(entry => {
                                    if (entry.hooks) {
                                        entry.hooks.forEach(h => {
                                            const migrated = migrateAigonHookCommand(h.command);
                                            if (migrated !== h.command) {
                                                h.command = migrated;
                                                settingsChanged = true;
                                            }
                                        });
                                    } else {
                                        const migrated = migrateAigonHookCommand(entry.command);
                                        if (migrated !== entry.command) {
                                            entry.command = migrated;
                                            settingsChanged = true;
                                        }
                                    }
                                });
                            });
                            Object.entries(extras.settings.hooks).forEach(([event, hookConfigs]) => {
                                if (!settings.hooks[event]) settings.hooks[event] = [];
                                hookConfigs.forEach(hookConfig => {
                                    // Find existing Aigon entry (any entry with an 'aigon' command)
                                    const existingIdx = settings.hooks[event].findIndex(existing => {
                                        if (existing.hooks) {
                                            return existing.hooks.some(h => h.command && h.command.includes('aigon'));
                                        }
                                        return existing.command && existing.command.includes('aigon');
                                    });

                                    if (existingIdx >= 0 && hookConfig.hooks) {
                                        // Merge: upsert hook commands into the existing entry
                                        // (replace old aigon command if base name matches, add if missing)
                                        const existing = settings.hooks[event][existingIdx];
                                        if (!existing.hooks) existing.hooks = [];
                                        hookConfig.hooks.forEach(newHook => {
                                            // Base command name: strip leading 'aigon ' and any -- flags
                                            const baseName = newHook.command
                                                .replace(/^aigon /, '')
                                                .replace(/\s+--\S+/g, '');
                                            const existingIdx2 = existing.hooks.findIndex(h =>
                                                h.command && h.command.includes(baseName)
                                            );
                                            const resolvedHook = { ...newHook };
                                            if (resolvedHook.command && resolvedHook.command.startsWith('aigon ')) {
                                                resolvedHook.command = wrapAigonCommand(resolvedHook.command);
                                            }
                                            if (existingIdx2 >= 0) {
                                                if (existing.hooks[existingIdx2].command !== resolvedHook.command) {
                                                    existing.hooks[existingIdx2] = resolvedHook;
                                                    settingsChanged = true;
                                                }
                                            } else {
                                                existing.hooks.push(resolvedHook);
                                                settingsChanged = true;
                                            }
                                        });
                                    } else if (existingIdx < 0) {
                                        // No aigon entry exists — add the whole thing
                                        const resolved = JSON.parse(JSON.stringify(hookConfig));
                                        if (resolved.hooks) {
                                            resolved.hooks.forEach(h => {
                                                if (h.command && h.command.startsWith('aigon ')) {
                                                    h.command = wrapAigonCommand(h.command);
                                                }
                                            });
                                        } else if (resolved.command && resolved.command.startsWith('aigon ')) {
                                            resolved.command = wrapAigonCommand(resolved.command);
                                        }
                                        settings.hooks[event].push(resolved);
                                        settingsChanged = true;
                                    }
                                });
                            });
                            if (settingsChanged) {
                                console.log(`   🔄 Added hooks to ${extras.settings.path}`);
                            }
                        }

                        // Only write if something changed
                        const newContent = JSON.stringify(settings, null, 2);
                        if (newContent !== existingContent) {
                            safeWrite(settingsPath, newContent);
                        }

                        // Pre-trust hooks in ~/.gemini/trusted_hooks.json so Gemini CLI
                        // doesn't show a "new hooks detected" warning on next startup.
                        if (extras.settings.hooks && settings.hooks) {
                            try {
                                const trustedHooksPath = path.join(os.homedir(), '.gemini', 'trusted_hooks.json');
                                let trustedHooks = {};
                                if (fs.existsSync(trustedHooksPath)) {
                                    try { trustedHooks = JSON.parse(fs.readFileSync(trustedHooksPath, 'utf8')); } catch (_) { trustedHooks = {}; }
                                }
                                const projectPath = process.cwd();
                                const currentTrusted = new Set(trustedHooks[projectPath] || []);
                                Object.values(settings.hooks).forEach(hookArr => {
                                    hookArr.forEach(entry => {
                                        (entry.hooks || []).forEach(h => {
                                            if (h.type === 'command' && h.command) {
                                                currentTrusted.add(`:${h.command}`);
                                            }
                                        });
                                    });
                                });
                                trustedHooks[projectPath] = Array.from(currentTrusted);
                                fs.mkdirSync(path.dirname(trustedHooksPath), { recursive: true });
                                fs.writeFileSync(trustedHooksPath, JSON.stringify(trustedHooks, null, 2));
                            } catch (_) {
                                // Non-fatal: trusted_hooks.json update failure doesn't break install
                            }
                        }
                    }

                    // Standalone hooks file (Cursor — separate from settings)
                    if (extras.hooks && extras.hooks.enabled) {
                        const hooksPath = path.join(process.cwd(), extras.hooks.path);
                        let hooksFile = {};
                        let existingHooksContent = '';
                        if (fs.existsSync(hooksPath)) {
                            try {
                                existingHooksContent = fs.readFileSync(hooksPath, 'utf8');
                                hooksFile = JSON.parse(existingHooksContent);
                            } catch (e) {
                                console.warn(`   ⚠️  Could not parse existing ${extras.hooks.path}, creating new one`);
                            }
                        }

                        // Merge hook content
                        const hookContent = extras.hooks.content;
                        let hooksChanged = false;
                        if (hookContent.hooks) {
                            if (!hooksFile.hooks) hooksFile.hooks = {};
                            // Migrate existing aigon hook commands to the login-shell wrapper form.
                            Object.values(hooksFile.hooks).forEach(hookArr => {
                                hookArr.forEach(entry => {
                                    const migrated = migrateAigonHookCommand(entry.command);
                                    if (migrated !== entry.command) {
                                        entry.command = migrated;
                                        hooksChanged = true;
                                    }
                                });
                            });
                            Object.entries(hookContent.hooks).forEach(([event, hookConfigs]) => {
                                if (!hooksFile.hooks[event]) hooksFile.hooks[event] = [];
                                hookConfigs.forEach(hookConfig => {
                                    const aigonCmd = hookConfig.command;
                                    const alreadyExists = hooksFile.hooks[event].some(existing =>
                                        existing.command && existing.command.includes(aigonCmd)
                                    );
                                    if (!alreadyExists) {
                                        const resolvedHook = JSON.parse(JSON.stringify(hookConfig));
                                        if (resolvedHook.command && resolvedHook.command.startsWith('aigon ')) {
                                            resolvedHook.command = wrapAigonCommand(resolvedHook.command);
                                        }
                                        hooksFile.hooks[event].push(resolvedHook);
                                        hooksChanged = true;
                                    }
                                });
                            });
                        }

                        if (hooksChanged) {
                            const newHooksContent = JSON.stringify(hooksFile, null, 2);
                            if (newHooksContent !== existingHooksContent) {
                                safeWrite(hooksPath, newHooksContent);
                                console.log(`   🔄 Added SessionStart hook to ${extras.hooks.path}`);
                            }
                        }
                    }

                    // Codex: prompt.md (uses upsert to preserve user content outside markers)
                    if (extras.prompt && extras.prompt.enabled) {
                        // Add AGENT_FILE placeholder for prompt template
                        const promptPlaceholders = { ...config.placeholders, AGENT_FILE: config.agentFile };
                        const promptContent = processTemplate(readTemplate('generic/prompt.md'), promptPlaceholders);
                        // Extract content between markers (template already has markers)
                        const markerContentMatch = promptContent.match(new RegExp(`${MARKER_START}\\n([\\s\\S]*?)\\n${MARKER_END}`));
                        const innerContent = markerContentMatch ? markerContentMatch[1] : promptContent;
                        const promptPath = path.join(process.cwd(), extras.prompt.path);
                        const action = upsertMarkedContent(promptPath, innerContent);
                        if (action !== 'unchanged') {
                            console.log(`   ✅ ${action.charAt(0).toUpperCase() + action.slice(1)}: ${extras.prompt.path}`);
                        }
                    }

                    // Cursor: rules file (aigon-owned, full overwrite)
                    if (extras.rules && extras.rules.enabled) {
                        const rulesContent = readTemplate('generic/cursor-rule.mdc');
                        const rulesPath = path.join(process.cwd(), extras.rules.path);
                        const rulesStatus = safeWriteWithStatus(rulesPath, rulesContent);
                        if (rulesStatus !== 'unchanged') {
                            console.log(`   ✅ ${rulesStatus.charAt(0).toUpperCase() + rulesStatus.slice(1)}: ${extras.rules.path}`);
                        }
                    }

                    // Codex: config.toml (uses legacy template - not generic)
                    if (extras.config && extras.config.enabled) {
                        const { TEMPLATES_ROOT } = u;
                        const configPath = path.join(process.cwd(), extras.config.path);
                        let configContent = '';
                        if (fs.existsSync(configPath)) {
                            configContent = fs.readFileSync(configPath, 'utf8');
                        }
                        if (!configContent.includes('[_aigon]')) {
                            const ffConfig = fs.readFileSync(path.join(TEMPLATES_ROOT, 'cx/config.toml'), 'utf8');
                            if (configContent.length > 0 && !configContent.endsWith('\n')) {
                                configContent += '\n';
                            }
                            configContent += '\n' + ffConfig;
                            safeWrite(configPath, configContent);
                            console.log(`   ✅ Created: ${extras.config.path}`);
                        } else {
                            console.log(`   ℹ️  ${extras.config.path} already has Aigon settings`);
                        }
                    }
                });

                // Auto-allocate port in global registry (idempotent)
                const installProfile = getActiveProfile();
                if (installProfile.devServer.enabled) {
                    const { allocateBasePort } = u;
                    const allocatedPort = allocateBasePort(process.cwd());
                    console.log(`\n📋 Port ${allocatedPort} allocated (block of ${u.PORT_BLOCK_SIZE})`);
                }

                const agentNames = uniqueAgents.map(a => {
                    const cfg = loadAgentConfig(a);
                    return cfg ? (cfg.displayName || cfg.name) : a;
                }).join(', ');
                console.log(`\n🎉 Installed Aigon for: ${agentNames}`);
                showPortSummary();

                // Ensure .aigon/.board-map.json is in .gitignore
                ensureBoardMapInGitignore();
                ensurePreCommitHook();
                const hooksPathResult = ensureHooksPathConfigured();
                if (!hooksPathResult.ok) {
                    console.warn(`\n⚠️  Could not set git core.hooksPath to ${SECURITY_HOOKS_PATH}: ${hooksPathResult.error}`);
                }

                const envGitignoreStatus = getEnvLocalGitignoreStatus();
                if (!envGitignoreStatus.hasAllEntries) {
                    console.warn(`\n⚠️  .env.local is not fully gitignored in this repo.`);
                    console.warn(`    Missing entries in .gitignore: ${envGitignoreStatus.missingEntries.join(', ')}`);
                    console.warn(`    Fix: echo '.env.local' >> .gitignore && echo '.env*.local' >> .gitignore`);
                }
                const trackedEnvLocals = getTrackedEnvLocalFiles();
                if (trackedEnvLocals.length > 0) {
                    console.warn(`\n⚠️  .env.local is tracked by git — this can cause merge conflicts during feature-close.`);
                    console.warn(`    Tracked files: ${trackedEnvLocals.join(', ')}`);
                    console.warn(`    Fix: git rm --cached -- ${trackedEnvLocals.map(file => JSON.stringify(file)).join(' ')}`);
                }

                // Update installed version
                const currentVersion = getAigonVersion();
                if (currentVersion) {
                    setInstalledVersion(currentVersion);
                }

                // Write config hash for change detection on next session
                // Skip in worktrees — same reason as setInstalledVersion
                try {
                    const worktreeMarker = path.join(process.cwd(), '.aigon', 'worktree.json');
                    if (!fs.existsSync(worktreeMarker)) {
                        const configHash = computeInstructionsConfigHash();
                        safeWrite(path.join(process.cwd(), '.aigon', 'config-hash'), configHash);
                    }
                } catch (e) {
                    // Non-fatal — config hash is best-effort
                }

                // Apply agent trust settings (e.g. disable Cursor workspace trust dialog)
                try {
                    const _agentRegistryTrust = require('../agent-registry');
                    const repoName = path.basename(process.cwd());
                    const wtBase = path.join(os.homedir(), '.aigon', 'worktrees', repoName);
                    const existingWorktrees = listExistingAigonWorktrees(process.cwd());
                    uniqueAgents.forEach(agentId => {
                        const trustTargets = _agentRegistryTrust.getTrustInstallScope(agentId) === 'all-existing-worktrees'
                            ? existingWorktrees
                            : [wtBase];
                        try { _agentRegistryTrust.ensureAgentTrust(agentId, trustTargets); } catch (_) { /* best-effort */ }
                    });
                } catch (_) { /* best-effort */ }

                // Git commit suggestion - only if there are actual changes
                try {
                    const installPaths = 'docs/development_workflow.md docs/agents/ .agents/ .claude/ .cursor/ .codex/ .gemini/';
                    const gitStatus = getStatusRaw(installPaths);
                    if (gitStatus) {
                        console.log(`\n📝 To commit these changes:`);
                        console.log(`   git add ${installPaths} 2>/dev/null; git commit -m "chore: install Aigon v${currentVersion || 'latest'}"`);
                    }
                } catch (e) {
                    // Not a git repo or git not available - skip suggestion
                }

                console.log('\nOptional: to make aigon visible in your project\'s AGENTS.md, add:');
                console.log('    > This repo uses aigon for feature workflow.');
                console.log('    > See `.aigon/docs/development_workflow.md`.');
                console.log('(Aigon does not edit your AGENTS.md.)');

            } catch (e) {
                console.error(`❌ Failed: ${e.message}`);
            }
        },

        'setup': async (args = []) => {
            const { runWizard } = require('../onboarding/wizard');
            await runWizard(args);
        },

        'global-setup': async (args = []) => {
            const cfg = require('../config');
            const { TERMINAL_CONFIG_MIGRATION_VERSION } = require('../global-config-migration');

            const forceFlag = args.includes('--force');
            const nonInteractiveFlag = args.includes('--non-interactive');
            const quietFlag = args.includes('--quiet');
            const isInteractive = !nonInteractiveFlag && process.stdin.isTTY && process.stdout.isTTY;

            // Always run prerequisite checks — hard blockers print even in quiet mode
            {
                const { runPrerequisiteChecks, printPrerequisiteResults } = require('../prerequisite-checks');
                const prereqs = await runPrerequisiteChecks();
                if (prereqs.errors.length > 0) {
                    console.error('\n⚠️  Aigon prerequisite check failed:');
                    printPrerequisiteResults(prereqs, { verbose: true, prefix: '   ' });
                    console.error('\n   Run `aigon check-prerequisites` for details and remediation steps.');
                    if (!quietFlag) process.exit(1);
                } else if (!quietFlag && prereqs.warnings.length > 0) {
                    console.log('\nPrerequisite warnings:');
                    printPrerequisiteResults(prereqs, { verbose: false, prefix: '  ' });
                }
            }

            if (fs.existsSync(cfg.GLOBAL_CONFIG_PATH) && !forceFlag) {
                if (!quietFlag) {
                    console.log(`✅ Aigon global config already exists.`);
                    console.log(`   ${cfg.GLOBAL_CONFIG_PATH}`);
                    console.log(`   Run \`aigon global-setup --force\` to reconfigure.`);
                }
                return;
            }

            // Load raw existing config for selective merging on --force
            let rawConfig = {};
            if (forceFlag && fs.existsSync(cfg.GLOBAL_CONFIG_PATH)) {
                try {
                    rawConfig = JSON.parse(fs.readFileSync(cfg.GLOBAL_CONFIG_PATH, 'utf8'));
                } catch (_) { /* ignore — use empty */ }
            }

            const platformDefault = process.platform === 'darwin' ? 'apple-terminal' : null;
            let terminalApp = rawConfig.terminalApp || platformDefault;

            if (isInteractive) {
                const { selectTerminal, saveTerminalPreference } = require('../onboarding/terminal');
                console.log('');
                console.log('🚀 Welcome to Aigon! Let\'s configure your global preferences.');
                
                const terminalAppChoice = await selectTerminal(false);
                if (terminalAppChoice) {
                    saveTerminalPreference(terminalAppChoice);
                    terminalApp = terminalAppChoice;
                }
            } else if (!quietFlag) {
                console.log(`🔧 Aigon: writing default global config (non-interactive)`);
                const { saveTerminalPreference } = require('../onboarding/terminal');
                saveTerminalPreference(terminalApp);
            }

            if (isInteractive && !quietFlag) {
                console.log('');
                console.log(`✅ Global config saved:`);
                console.log(`   ${cfg.GLOBAL_CONFIG_PATH}`);
                console.log(`   terminal: ${terminalApp || 'auto-detect'}`);
                console.log('');
                console.log('💡 Next steps:');
                console.log('   cd <your-project>');
                console.log('   aigon init              # initialize a project');
                console.log('   aigon install-agent cc  # install an AI agent');
                console.log('');
            } else if (!quietFlag) {
                console.log(`   Config: ${cfg.GLOBAL_CONFIG_PATH}`);
                console.log(`   Terminal: ${terminalApp || 'auto-detect'}`);
            }
        },

        'check-prerequisites': async (args = []) => {
            const { runPrerequisiteChecks, printPrerequisiteResults } = require('../prerequisite-checks');
            const verboseFlag = args.includes('--verbose') || args.includes('-v');
            const jsonFlag = args.includes('--json');

            const results = await runPrerequisiteChecks();

            if (jsonFlag) {
                console.log(JSON.stringify(results, null, 2));
                if (!results.passed) process.exit(1);
                return;
            }

            console.log('\nPrerequisite Check\n──────────────────');
            printPrerequisiteResults(results, { verbose: verboseFlag || results.errors.length > 0 || results.warnings.length > 0 });

            if (results.errors.length === 0 && results.warnings.length === 0) {
                console.log('  ✅ All prerequisites satisfied.');
            } else if (results.errors.length === 0) {
                console.log(`\n  ✅ Core prerequisites OK — ${results.warnings.length} optional item(s) to review above.`);
            } else {
                console.error(`\n  ❌ ${results.errors.length} hard prerequisite(s) failed. Aigon will not function correctly until resolved.`);
            }

            if (!results.passed) process.exit(1);
        },

        'check-version': async (args = []) => {
            const jsonOutput = args.includes('--json');
            const collectedMessages = [];
            let origLog, origWarn;
            if (jsonOutput) {
                origLog = console.log.bind(console);
                origWarn = console.warn.bind(console);
                console.log = (...a) => collectedMessages.push(a.map(String).join(' '));
                console.warn = (...a) => collectedMessages.push(a.map(String).join(' '));
            }
            const currentVersion = getAigonVersion();
            const installedVersion = getInstalledVersion();
            const runGlobalConfigMigrations = async () => {
                const { runPendingGlobalConfigMigrations } = require('../global-config-migration');
                return runPendingGlobalConfigMigrations(installedVersion || '0.0.0', {
                    log: (message) => console.log(message),
                });
            };

            if (!currentVersion) {
                console.error('❌ Could not determine Aigon CLI version');
                process.exit(1);
            }

            // Start npm registry check early (async — collect result later)
            const { checkForUpdate, formatUpdateNotice } = require('../npm-update-check');
            const npmCheckPromise = checkForUpdate().catch(() => null);

            // Check if aigon CLI source is behind origin
            const { behind, error: originError } = checkAigonCliOrigin();
            if (behind > 0) {
                console.log(`⬆️  Aigon CLI is ${behind} commit${behind === 1 ? '' : 's'} behind origin. Run \`aigon update --pull\` to upgrade CLI and sync this project.`);
            } else if (originError) {
                console.warn(`⚠️  Could not check for a CLI upgrade from origin: ${originError}`);
            }

            if (!installedVersion || compareVersions(currentVersion, installedVersion) !== 0) {
                const from = installedVersion || 'unknown';
                console.log(`🔄 Project sync needed (project: ${from}, CLI: ${currentVersion}). Updating...`);
                await commands['update'](args);

                // Run pending global + repo migrations after version update
                try {
                    await runGlobalConfigMigrations();
                    const { runPendingMigrations } = require('../migration');
                    const results = await runPendingMigrations(process.cwd(), installedVersion || undefined);
                    if (results.some(r => r.status === 'restored')) {
                        console.warn('⚠️  Some migrations failed — check .aigon/migrations/ for details');
                    }
                } catch (e) {
                    console.warn(`⚠️  Migration check failed: ${e.message}`);
                }
            } else {
                // Version matches — check if instruction config has changed since last install
                let configChanged = false;
                try {
                    const hashPath = path.join(process.cwd(), '.aigon', 'config-hash');
                    const storedHash = fs.existsSync(hashPath) ? fs.readFileSync(hashPath, 'utf8').trim() : '';
                    const currentHash = computeInstructionsConfigHash();
                    configChanged = storedHash !== currentHash;
                } catch (e) {
                    // Non-fatal — skip config hash check
                }

                if (configChanged) {
                    console.log(`🔄 Config change detected. Reinstalling agents...`);
                    await commands['update'](args);
                    try {
                        await runGlobalConfigMigrations();
                    } catch (e) {
                        console.warn(`⚠️  Global config migration check failed: ${e.message}`);
                    }
                } else if (behind === 0) {
                    try {
                        await runGlobalConfigMigrations();
                    } catch (e) {
                        console.warn(`⚠️  Global config migration check failed: ${e.message}`);
                    }
                    console.log(`✅ Aigon is up to date (v${currentVersion})`);
                }
            }

            // Show npm registry notice (non-blocking — collected after sync work)
            try {
                const npmResult = await npmCheckPromise;
                const notice = formatUpdateNotice(npmResult);
                if (notice) console.log(notice);
            } catch (_) {
                // npm check is advisory only — never fail check-version over it
            }
            if (jsonOutput) {
                console.log = origLog;
                console.warn = origWarn;
                const msg = collectedMessages.join('\n').trim();
                process.stdout.write(msg ? JSON.stringify({ systemMessage: msg }) : '{}');
            }
        },

        'update': async (args = []) => {
            const pullFlag = args.includes('--pull');

            // Step 0: CLI upgrade (if --pull)
            if (pullFlag) {
                try {
                    upgradeAigonCli();
                } catch (e) {
                    console.error(`❌ CLI upgrade failed: ${e.message}`);
                    console.error('   Fix the issue and try again, or run `aigon update` without --pull for project sync only.');
                    return;
                }
            } else {
                // Check if behind origin and advise
                const { behind, error: originError } = checkAigonCliOrigin();
                if (behind > 0) {
                    console.log(`⬆️  Aigon CLI is ${behind} commit${behind === 1 ? '' : 's'} behind origin. Use \`aigon update --pull\` to upgrade CLI first.\n`);
                } else if (originError) {
                    console.warn(`⚠️  Could not check for a CLI upgrade from origin: ${originError}`);
                    console.warn('   Continuing with project sync only.\n');
                }
            }

            // Re-read version after potential pull
            const currentVersion = getAigonVersion();
            const installedVersion = getInstalledVersion();

            console.log("📦 Project sync: updating templates and agent configs...");
            if (installedVersion && currentVersion) {
                console.log(`   ${installedVersion} → ${currentVersion}`);
            } else if (currentVersion) {
                console.log(`   Installing version ${currentVersion}`);
            }
            console.log();

            // Show changelog entries since last installed version
            if (installedVersion && currentVersion && compareVersions(currentVersion, installedVersion) > 0) {
                const entries = getChangelogEntriesSince(installedVersion);
                if (entries.length > 0) {
                    console.log(`📋 What's new since ${installedVersion}:\n`);
                    entries.forEach(entry => {
                        console.log(`   ## ${entry.version}`);
                        // Show just the section headers and first items, not full body
                        const lines = entry.body.split('\n').filter(l => l.trim());
                        lines.slice(0, 6).forEach(line => {
                            console.log(`   ${line}`);
                        });
                        if (lines.length > 6) {
                            console.log(`   ... (${lines.length - 6} more lines)`);
                        }
                        console.log();
                    });
                }
            }

            try {
                // Track changed files for summary
                const changes = { created: [], updated: [], unchanged: [] };
                const noCommit = args.includes('--no-commit');

                // 1. Detect installed agents from project artifacts
                const _agentRegistry = require('../agent-registry');
                const installedAgents = [];
                getAvailableAgents().forEach(agentId => {
                    const config = loadAgentConfig(agentId);
                    if (!config) return;

                    const docsAgentPath = config.agentFile
                        ? path.join(process.cwd(), 'docs', 'agents', config.agentFile)
                        : null;
                    const localCommandDir = (config.output && !config.output.global && config.output.commandDir)
                        ? path.join(process.cwd(), config.output.commandDir)
                        : null;
                    const rootFilePath = config.rootFile ? path.join(process.cwd(), config.rootFile) : null;
                    const extras = config.extras || {};
                    const settingsPath = extras.settings?.enabled ? path.join(process.cwd(), extras.settings.path) : null;
                    const configPath = extras.config?.enabled ? path.join(process.cwd(), extras.config.path) : null;

                    // Check legacy detection paths from agent config
                    const legacy = _agentRegistry.getLegacyPaths(agentId);
                    const hasLegacyFile = Object.values(legacy).some(relPath =>
                        relPath && fs.existsSync(path.join(process.cwd(), relPath))
                    );

                    const isInstalled =
                        (rootFilePath && fs.existsSync(rootFilePath)) ||
                        (docsAgentPath && fs.existsSync(docsAgentPath)) ||
                        (localCommandDir && fs.existsSync(localCommandDir)) ||
                        (settingsPath && fs.existsSync(settingsPath)) ||
                        (configPath && fs.existsSync(configPath)) ||
                        hasLegacyFile;

                    if (isInstalled) {
                        installedAgents.push(agentId);
                    }
                });

                const uniqueInstalledAgents = [...new Set(installedAgents)];

                // 1.5 Migration notices for legacy root files
                const allLegacyFiles = [];
                getAvailableAgents().forEach(agentId => {
                    const legacy = _agentRegistry.getLegacyPaths(agentId);
                    for (const [key, relPath] of Object.entries(legacy)) {
                        if (relPath && fs.existsSync(path.join(process.cwd(), relPath))) {
                            allLegacyFiles.push(relPath);
                        }
                    }
                });
                if (allLegacyFiles.length > 0) {
                    console.log(`⚠️  Migration notice: AGENTS.md is now the shared root instruction file.`);
                    for (const legacyFile of allLegacyFiles) {
                        console.log(`   - Detected legacy ${legacyFile}. New installs no longer generate this file.`);
                    }
                    console.log(`   - Legacy files are not auto-deleted. Review and remove them manually when ready.\n`);
                }

                // 2. Ensure spec folder structure exists (same as init)
                const createDirs = (root, folders) => {
                    folders.forEach(f => {
                        const p = path.join(root, f);
                        if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
                    });
                };
                createDirs(PATHS.research.root, PATHS.research.folders);
                createDirs(PATHS.features.root, PATHS.features.folders);
                createDirs(PATHS.feedback.root, PATHS.feedback.folders);
                const featLogs = path.join(PATHS.features.root, 'logs');
                if (!fs.existsSync(path.join(featLogs, 'selected'))) fs.mkdirSync(path.join(featLogs, 'selected'), { recursive: true });
                if (!fs.existsSync(path.join(featLogs, 'alternatives'))) fs.mkdirSync(path.join(featLogs, 'alternatives'), { recursive: true });
                if (!fs.existsSync(path.join(PATHS.features.root, 'evaluations'))) fs.mkdirSync(path.join(PATHS.features.root, 'evaluations'), { recursive: true });
                console.log(`✅ Verified: docs/specs directory structure`);

                // 3. Update shared workflow documentation
                const workflowPath = path.join(process.cwd(), 'docs', 'development_workflow.md');
                const workflowContent = readTemplate('docs/development_workflow.md');
                const workflowStatus = safeWriteWithStatus(workflowPath, workflowContent);
                changes[workflowStatus].push('docs/development_workflow.md');
                if (workflowStatus !== 'unchanged') {
                    console.log(`✅ ${workflowStatus.charAt(0).toUpperCase() + workflowStatus.slice(1)}: docs/development_workflow.md`);
                }

                // 4. Install/update spec templates
                const specsTemplatesDir = path.join(process.cwd(), 'docs', 'specs', 'templates');
                if (!fs.existsSync(specsTemplatesDir)) {
                    fs.mkdirSync(specsTemplatesDir, { recursive: true });
                }

                const featureTemplate = readTemplate('specs/feature-template.md');
                const featureStatus = safeWriteWithStatus(path.join(specsTemplatesDir, 'feature-template.md'), featureTemplate);
                changes[featureStatus].push('docs/specs/templates/feature-template.md');
                if (featureStatus !== 'unchanged') {
                    console.log(`✅ ${featureStatus.charAt(0).toUpperCase() + featureStatus.slice(1)}: docs/specs/templates/feature-template.md`);
                }

                const researchTemplate = readTemplate('specs/research-template.md');
                const researchStatus = safeWriteWithStatus(path.join(specsTemplatesDir, 'research-template.md'), researchTemplate);
                changes[researchStatus].push('docs/specs/templates/research-template.md');
                if (researchStatus !== 'unchanged') {
                    console.log(`✅ ${researchStatus.charAt(0).toUpperCase() + researchStatus.slice(1)}: docs/specs/templates/research-template.md`);
                }

                const feedbackTemplate = readTemplate('specs/feedback-template.md');
                const feedbackStatus = safeWriteWithStatus(path.join(specsTemplatesDir, 'feedback-template.md'), feedbackTemplate);
                changes[feedbackStatus].push('docs/specs/templates/feedback-template.md');
                if (feedbackStatus !== 'unchanged') {
                    console.log(`✅ ${feedbackStatus.charAt(0).toUpperCase() + feedbackStatus.slice(1)}: docs/specs/templates/feedback-template.md`);
                }

                // 5. Re-run install-agent for detected agents
                if (uniqueInstalledAgents.length > 0) {
                    console.log(`\n📦 Re-installing agents: ${uniqueInstalledAgents.join(', ')}`);
                    commands['install-agent'](uniqueInstalledAgents);
                } else {
                    console.log(`\nℹ️  No agents detected. Run 'aigon install-agent <agent-id>' to install.`);
                }

                // 6. Update installed version
                if (currentVersion) {
                    setInstalledVersion(currentVersion);
                }

                // 6.5. Write config hash for change detection
                // Skip in worktrees — same reason as setInstalledVersion
                try {
                    const worktreeMarker = path.join(process.cwd(), '.aigon', 'worktree.json');
                    if (!fs.existsSync(worktreeMarker)) {
                        const configHash = computeInstructionsConfigHash();
                        safeWrite(path.join(process.cwd(), '.aigon', 'config-hash'), configHash);
                    }
                } catch (e) {
                    // Non-fatal
                }

                // 7. Restart server if running (only when updating from the aigon repo itself)
                const aigonRoot = path.resolve(__dirname, '..', '..');
                const isAigonRepo = path.resolve(process.cwd()) === aigonRoot;
                if (isAigonRepo) {
                    // Resolve the configured server port up-front so both restart
                    // paths can verify health afterwards. The port is centralised
                    // in `lib/config.js`; falls back gracefully if config is unreadable.
                    let configuredServerPort = null;
                    try {
                        const { getConfiguredServerPort } = require('../config');
                        configuredServerPort = getConfiguredServerPort();
                    } catch (_) { /* non-fatal */ }
                    const { waitForServerHealthy } = require('../server-runtime');
                    const verifyHealth = async (port) => {
                        if (!port) return; // can't verify without a port
                        const ok = await waitForServerHealthy(port, 5000);
                        if (ok) {
                            console.log(`✅ Server restarted and responding on port ${port}`);
                        } else {
                            console.log(`⚠️  Server was restarted but did not respond within 5s — check \`aigon server status\` and logs at ~/.aigon/logs/`);
                        }
                    };

                    try {
                        const { isServiceInstalled, restartService } = require('../supervisor-service');
                        if (isServiceInstalled()) {
                            // Delegate to launchd/systemd — avoids spawning a
                            // duplicate process that races with KeepAlive.
                            restartService();
                            console.log('\n🔄 Server restarted via system service.');
                            await verifyHealth(configuredServerPort);
                        } else {
                            // No persistent service — kill and respawn manually.
                            const { isPortInUseSync } = require('../proxy');
                            let restarted = false;
                            // Kill any process holding the server port
                            if (isPortInUseSync(configuredServerPort)) {
                                try {
                                    const pids = execSync(`lsof -ti tcp:${configuredServerPort}`, { encoding: 'utf8', stdio: 'pipe' }).trim();
                                    pids.split('\n').filter(Boolean).forEach(p => {
                                        try { process.kill(parseInt(p, 10), 'SIGTERM'); } catch (_) {}
                                    });
                                    // Wait for port to be released
                                    for (let i = 0; i < 20; i++) {
                                        if (!isPortInUseSync(configuredServerPort)) break;
                                        execSync('sleep 0.1', { stdio: 'pipe' });
                                    }
                                    restarted = true;
                                } catch (e) { /* ignore kill errors */ }
                            }
                            if (restarted) {
                                const aigonBin = path.join(aigonRoot, 'aigon-cli.js');
                                const { spawn } = require('child_process');
                                const child = spawn(process.execPath, [aigonBin, 'server', 'start'], {
                                    detached: true,
                                    stdio: 'ignore',
                                    cwd: aigonRoot,
                                });
                                child.unref();
                                console.log(`\n🔄 Server restarted (PID ${child.pid})`);
                                await verifyHealth(configuredServerPort);
                            }
                        }
                    } catch (e) {
                        // Non-fatal — server restart is best-effort
                    }
                }

                // Summary - version changed OR file changes means we updated
                const versionChanged = installedVersion && currentVersion && installedVersion !== currentVersion;
                let hasFileChanges = false;
                // Only stage paths that check-version actually writes.
                // NEVER stage docs/specs/features/ or docs/specs/research-topics/ —
                // those contain user spec files that can be dirty for unrelated reasons.
                // Bug history: broad `git add docs/` once swept a stale spec rename
                // into an auto-commit, moving a done feature back to backlog.
                const aigonPaths = [
                    'docs/development_workflow.md',
                    'docs/specs/templates/',
                    'docs/agents/',
                    '.agents/',
                    '.claude/',
                    '.cursor/',
                    '.codex/',
                    '.gemini/',
                    '.aigon/version',
                ];
                const aigonPathsStr = aigonPaths.join(' ');
                try {
                    const gitStatus = execSync(`git status --porcelain ${aigonPathsStr} 2>/dev/null`, { encoding: 'utf8' });
                    hasFileChanges = gitStatus.trim().length > 0;
                } catch (e) {
                    // Not a git repo - can't determine
                }

                // 8. Surface (but do NOT bootstrap) entities missing workflow state.
                // Folder position is no longer treated as authoritative lifecycle.
                // Users must run `aigon doctor --fix` to explicitly migrate.
                try {
                    const worktreeMarker = path.join(process.cwd(), '.aigon', 'worktree.json');
                    if (!fs.existsSync(worktreeMarker)) {
                        const { features: missingF, research: missingR } = findEntitiesMissingWorkflowState(process.cwd());
                        const totalMissing = missingF.length + missingR.length;
                        if (totalMissing > 0) {
                            console.log(`\n⚠️  ${totalMissing} entit${totalMissing === 1 ? 'y' : 'ies'} missing workflow state.`);
                            console.log(`   Run \`aigon doctor --fix\` to migrate.`);
                        }
                    }
                } catch (_) { /* non-fatal */ }

                if (versionChanged || hasFileChanges) {
                    console.log(`\n✅ Aigon updated to v${currentVersion || 'unknown'}.`);
                    showPortSummary();
                    if (hasFileChanges) {
                        if (noCommit) {
                            console.log(`\n📝 To commit these changes:`);
                            console.log(`   git add ${aigonPathsStr} 2>/dev/null; git commit -m "chore: install Aigon v${currentVersion || 'latest'}"`);
                        } else {
                            try {
                                execSync(`git add ${aigonPathsStr} 2>/dev/null`, { encoding: 'utf8' });
                                execSync(`git commit -m "chore: install Aigon v${currentVersion || 'latest'}"`, { encoding: 'utf8' });
                                console.log(`\n📦 Committed Aigon update (v${currentVersion || 'latest'}).`);
                            } catch (e) {
                                console.log(`\n⚠️  Could not auto-commit: ${e.message}`);
                                console.log(`   git add ${aigonPathsStr} 2>/dev/null; git commit -m "chore: install Aigon v${currentVersion || 'latest'}"`);
                            }
                        }
                    }
                } else {
                    console.log(`\n✅ Aigon is already up to date (v${currentVersion || 'unknown'}).`);
                }

            } catch (e) {
                console.error(`❌ Update failed: ${e.message}`);
            }
        },

        'project-context': (args = []) => {
            // Print aigon doc pointers to stdout — used by SessionStart hooks for CC and GG
            const jsonOutput = args.includes('--json');
            const template = readTemplate('generic/agents-md.md');
            const markerMatch = template.match(new RegExp(`${MARKER_START}\\n([\\s\\S]*?)\\n${MARKER_END}`));
            const content = markerMatch ? markerMatch[1] : template.replace(MARKER_START, '').replace(MARKER_END, '');
            const text = content.trim();
            if (jsonOutput) {
                // Gemini hook format: inject into LLM context (not just shown in UI)
                process.stdout.write(JSON.stringify({ hookSpecificOutput: { additionalContext: text } }));
            } else {
                console.log(text);
            }
        },

        'doctor': async (args) => {
            const {
                loadPortRegistry,
                scanPortsFromFilesystem,
                getActiveProfile: getActiveProfileFn,
                readBasePort: readBasePortFn,
                registerPort: registerPortFn,
                proxyDiagnostics: proxyDiagnosticsFn,
                isCaddyInstalled: isCaddyInstalledFn,
                parseCaddyRoutes: parseCaddyRoutesFn,
                getAvailableAgents: getAvailableAgentsFn,
                loadAgentConfig: loadAgentConfigFn,
                getAgentCliConfig: getAgentCliConfigFn,
                getModelProvenance: getModelProvenanceFn,
            } = u;

            const doRegister = args.includes('--register');
            const doFix = args.includes('--fix');
            const doRebuildStats = args.includes('--rebuild-stats');

            if (doRebuildStats) {
                // Feature 230: force-rebuild the stats aggregate cache for every
                // registered repo (and cwd as a fallback).
                const statsAggregate = require('../stats-aggregate');
                const { readConductorReposFromGlobalConfig } = require('../dashboard-server');
                const repoList = readConductorReposFromGlobalConfig();
                const repos = (Array.isArray(repoList) && repoList.length > 0) ? repoList : [process.cwd()];
                console.log('\n🧮 Rebuilding stats aggregate cache...');
                for (const repoPath of repos) {
                    const abs = require('path').resolve(repoPath);
                    try {
                        const a = statsAggregate.rebuildAggregate(abs);
                        console.log(`   ✔ ${require('path').basename(abs)}: ${a.recordCount} records (${a.totals.features}f / ${a.totals.research}r) → ${statsAggregate.cachePath(abs)}`);
                    } catch (e) {
                        console.log(`   ✖ ${abs}: ${e.message}`);
                    }
                }
                console.log('');
                return;
            }
            const { reallocatePort: reallocatePortFn, PORT_BLOCK_SIZE: blockSize } = u;
            const registry = loadPortRegistry();
            const scanned = scanPortsFromFilesystem();

            // Merge: registry entries + discovered projects (dedup by path)
            const byPath = new Map();

            // Add registry entries first
            for (const [name, entry] of Object.entries(registry)) {
                byPath.set(entry.path, {
                    name,
                    basePort: entry.basePort,
                    path: entry.path,
                    registered: true
                });
            }

            // Add scanned entries (don't overwrite registered ones, but update port if different)
            for (const project of scanned) {
                if (byPath.has(project.path)) {
                    const existing = byPath.get(project.path);
                    existing.scanned = true;
                    existing.source = project.source;
                } else {
                    byPath.set(project.path, {
                        name: project.name,
                        basePort: project.basePort,
                        path: project.path,
                        registered: false,
                        scanned: true,
                        source: project.source
                    });
                }
            }

            const allProjects = Array.from(byPath.values());

            // Register current project if --register
            if (doRegister) {
                const profile = getActiveProfileFn();
                if (profile.devServer.enabled) {
                    const result = readBasePortFn();
                    const basePort = result ? result.port : 3000;
                    const name = path.basename(process.cwd());
                    registerPortFn(name, basePort, process.cwd());
                    console.log(`✅ Registered ${name} (port ${basePort}) in global port registry.`);

                    // Refresh the data for display
                    const updatedEntry = byPath.get(process.cwd());
                    if (updatedEntry) {
                        updatedEntry.registered = true;
                    } else {
                        allProjects.push({
                            name,
                            basePort,
                            path: process.cwd(),
                            registered: true,
                            scanned: true
                        });
                    }
                } else {
                    console.log(`ℹ️  Dev server not enabled for this project profile — nothing to register.`);
                }
            }

            // --- Prerequisites Check ---
            console.log('\nPrerequisites\n─────────────');
            const { isBinaryAvailable: isBinAvailable } = require('../security');

            // Node.js version check
            const nodeVersion = process.versions.node;
            const nodeMajor = parseInt(nodeVersion.split('.')[0], 10);
            if (nodeMajor < 18) {
                console.log(`  ⚠️  Node.js ${nodeVersion} — version 18+ recommended`);
                console.log('     Install: https://nodejs.org/ or use nvm/fnm');
            } else {
                console.log(`  ✅ Node.js ${nodeVersion}`);
            }

            // Git check
            try {
                const gitVersion = execSync('git --version', { encoding: 'utf8', stdio: 'pipe' }).trim();
                console.log(`  ✅ ${gitVersion}`);
            } catch {
                console.log('  ❌ git not found — required');
                console.log('     Install: https://git-scm.com/downloads');
            }

            // tmux check
            if (isBinAvailable('tmux')) {
                try {
                    const tmuxVersion = execSync('tmux -V', { encoding: 'utf8', stdio: 'pipe' }).trim();
                    console.log(`  ✅ ${tmuxVersion}`);
                } catch {
                    console.log('  ✅ tmux is installed');
                }
            } else {
                console.log('  ⚠️  tmux not found — required for Fleet/worktree mode, optional for single-agent Drive mode');
                if (process.platform === 'darwin') {
                    console.log('     Install: brew install tmux');
                } else {
                    console.log('     Install: sudo apt install tmux  (or dnf/pacman equivalent)');
                }
            }

            // Agent CLI checks
            const _doctorRegistry = require('../agent-registry');
            const agentBinMap = _doctorRegistry.getAgentBinMap();
            const agentInstallHints = _doctorRegistry.getAgentInstallHints();
            let foundAgents = 0;
            for (const [agentId, binary] of Object.entries(agentBinMap)) {
                if (isBinAvailable(binary)) {
                    console.log(`  ✅ ${binary} (${agentId})`);
                    foundAgents++;
                } else {
                    console.log(`  ·  ${binary} (${agentId}) — not installed`);
                    console.log(`     Install: ${agentInstallHints[agentId]}`);
                }
            }
            if (foundAgents === 0) {
                console.log('  ⚠️  No agent CLIs found — install at least one to use aigon');
            }

            const checkDefaultAgentConfig = (label, config, repoPath = null) => {
                const configuredDefault = String(config?.defaultAgent || '').trim().toLowerCase();
                if (!configuredDefault) return;
                if (!agentRegistry.getAllAgentIds().includes(configuredDefault)) {
                    console.log(`  ⚠️  ${label} defaultAgent is set to '${configuredDefault}' but that agent is not registered`);
                    return;
                }
                const agentBin = agentBinMap[configuredDefault];
                if (!agentBin || isBinAvailable(agentBin)) return;
                const displayName = agentRegistry.getAgent(configuredDefault)?.displayName || configuredDefault;
                console.log(`  ⚠️  ${label} defaultAgent is set to '${configuredDefault}' but ${displayName} is not installed (${agentBin} not found in PATH)`);
                if (repoPath) {
                    console.log(`     Repo: ${repoPath}`);
                }
            };
            checkDefaultAgentConfig('Global config', loadGlobalConfig());
            checkDefaultAgentConfig('Project config', loadProjectConfig(process.cwd()), process.cwd());

            // Agent install paths — where install-agent writes per-agent commands.
            // Helps users (and us) verify that codex now installs Skills locally,
            // not deprecated prompts under ~/.codex/prompts/.
            try {
                const installPathLines = [];
                for (const agentId of getAvailableAgentsFn()) {
                    const cfg = loadAgentConfigFn(agentId);
                    if (!cfg || !cfg.output || !cfg.output.commandDir) continue;
                    let label;
                    if (cfg.output.format === 'skill-md') {
                        const skillFile = cfg.output.skillFileName || 'SKILL.md';
                        label = `${cfg.output.commandDir}/${cfg.output.commandFilePrefix}*/${skillFile}`;
                    } else if (cfg.output.global) {
                        label = `${cfg.output.commandDir} (global)`;
                    } else {
                        label = `${cfg.output.commandDir}/${cfg.output.commandFilePrefix}*${cfg.output.commandFileExtension}`;
                    }
                    installPathLines.push(`  ·  ${cfg.id} → ${label}`);
                }
                if (installPathLines.length > 0) {
                    console.log('\nAgent install paths\n───────────────────');
                    installPathLines.forEach(line => console.log(line));
                }
            } catch (_) { /* best-effort */ }

            // Warn about stale legacy ~/.codex/prompts/aigon-*.md files
            // (left over from a pre-skills install). install-agent cx
            // cleans these up; doctor surfaces them in case the user has
            // an older copy lying around.
            try {
                const legacyDir = path.join(os.homedir(), '.codex', 'prompts');
                if (fs.existsSync(legacyDir)) {
                    const stale = fs.readdirSync(legacyDir).filter(f => f.startsWith('aigon-') && f.endsWith('.md'));
                    if (stale.length > 0) {
                        console.log(`  ⚠️  Found ${stale.length} stale aigon prompt file(s) under ~/.codex/prompts/ — run \`aigon install-agent cx\` to remove them.`);
                    }
                }
            } catch (_) { /* best-effort */ }

            if (allProjects.length === 0) {
                console.log('\nPort Health Check\n─────────────────');
                console.log('No projects with port configurations found.');
                return;
            }

            // Sort by port, then name
            allProjects.sort((a, b) => a.basePort - b.basePort || a.name.localeCompare(b.name));

            // Group by basePort to detect conflicts
            const portGroups = new Map();
            for (const project of allProjects) {
                const key = project.basePort;
                if (!portGroups.has(key)) portGroups.set(key, []);
                portGroups.get(key).push(project);
            }

            // Also check for overlapping ranges (each project uses base..base+blockSize-1)
            const rangeConflicts = new Map(); // port -> [conflicting project names]
            const sortedProjects = [...allProjects];
            for (let i = 0; i < sortedProjects.length; i++) {
                for (let j = i + 1; j < sortedProjects.length; j++) {
                    const a = sortedProjects[i];
                    const b = sortedProjects[j];
                    if (a.basePort === b.basePort) continue; // handled by portGroups
                    if (Math.abs(a.basePort - b.basePort) < blockSize) {
                        const key = Math.min(a.basePort, b.basePort);
                        if (!rangeConflicts.has(key)) rangeConflicts.set(key, new Set());
                        rangeConflicts.get(key).add(a.name);
                        rangeConflicts.get(key).add(b.name);
                    }
                }
            }

            // Display table
            const { homedir } = require('os');
            const shortenPath = (p) => p && p.startsWith(homedir()) ? '~' + p.slice(homedir().length) : (p || '(unknown)');

            console.log('\nPort Health Check\n─────────────────');

            // Calculate column widths
            const maxNameLen = Math.max(4, ...allProjects.map(p => p.name.length));
            const maxPathLen = Math.max(4, ...allProjects.map(p => shortenPath(p.path).length));

            const header = `  ${'PORT'.padEnd(7)}${'REPO'.padEnd(maxNameLen + 2)}${'PATH'.padEnd(maxPathLen + 2)}REGISTERED`;
            console.log(header);

            let conflictCount = 0;
            let unregisteredCount = 0;

            for (const [port, projects] of [...portGroups.entries()].sort((a, b) => a[0] - b[0])) {
                const isConflict = projects.length > 1;
                if (isConflict) conflictCount++;

                for (const project of projects) {
                    if (!project.registered) unregisteredCount++;
                    const portStr = String(project.basePort).padEnd(7);
                    const nameStr = project.name.padEnd(maxNameLen + 2);
                    const pathStr = shortenPath(project.path).padEnd(maxPathLen + 2);
                    const regStr = project.registered ? 'yes' : 'no';
                    console.log(`  ${portStr}${nameStr}${pathStr}${regStr}`);
                }

                if (isConflict) {
                    const names = projects.map(p => p.name).join(' and ');
                    console.log(`         ⚠️  CONFLICT: ${names} both use port ${port}`);
                }

                console.log('');
            }

            // Print range conflicts (different base ports but overlapping ranges)
            for (const [, names] of rangeConflicts) {
                const nameArr = [...names];
                const involved = allProjects.filter(p => nameArr.includes(p.name));
                const portsStr = involved.map(p => `${p.name}:${p.basePort}`).join(', ');
                console.log(`  ⚠️  RANGE OVERLAP: ${portsStr} — ranges within ${blockSize} of each other`);
                conflictCount++;
            }

            // Clean dead entries (repos that no longer exist)
            let deadCount = 0;
            for (const project of allProjects) {
                if (project.registered && !fs.existsSync(project.path)) {
                    deadCount++;
                    console.log(`  🗑️  STALE: ${project.name} — ${project.path} no longer exists`);
                    if (doFix) {
                        u.deregisterPort(project.name);
                        console.log(`     ✅ Removed ${project.name} from registry`);
                    }
                }
            }

            // Fix port conflicts by re-allocating
            if (doFix && conflictCount > 0) {
                // Collect all conflicting project names
                const conflictingNames = new Set();
                for (const [, projects] of portGroups) {
                    if (projects.length > 1) {
                        // Keep the first one, re-allocate the rest
                        for (let i = 1; i < projects.length; i++) {
                            if (projects[i].registered) conflictingNames.add(projects[i].name);
                        }
                    }
                }
                for (const [, names] of rangeConflicts) {
                    // Re-allocate the second entry in each range conflict
                    const nameArr = [...names];
                    for (let i = 1; i < nameArr.length; i++) {
                        conflictingNames.add(nameArr[i]);
                    }
                }

                for (const name of conflictingNames) {
                    const newPort = reallocatePortFn(name);
                    if (newPort !== null) {
                        console.log(`  ✅ Re-allocated ${name} → port ${newPort}`);
                    }
                }
            }

            // Summary
            if (conflictCount > 0 || unregisteredCount > 0 || deadCount > 0) {
                const parts = [];
                if (conflictCount > 0) parts.push(`${conflictCount} conflict${conflictCount === 1 ? '' : 's'} found`);
                if (unregisteredCount > 0) parts.push(`${unregisteredCount} unregistered project${unregisteredCount === 1 ? '' : 's'}`);
                if (deadCount > 0) parts.push(`${deadCount} stale entr${deadCount === 1 ? 'y' : 'ies'}`);
                console.log(parts.join('. ') + '.');
            } else {
                console.log('No conflicts found.');
            }

            if (unregisteredCount > 0 && !doRegister) {
                console.log(`💡 Run \`aigon doctor --register\` to register the current project.`);
            }
            if ((conflictCount > 0 || deadCount > 0) && !doFix) {
                console.log(`💡 Run \`aigon doctor --fix\` to resolve conflicts and clean stale entries.`);
            }

            // Backup status check moved to @aigon/pro with feature 236.
            // When Pro is installed, defer to its backup engine; otherwise no
            // status row is printed (free tier has no backup capability).
            try {
                const { isProAvailable, getPro } = require('../pro');
                if (isProAvailable() && getPro() && getPro().backup && typeof getPro().backup.status === 'function') {
                    console.log('\nBackup\n──────');
                    const s = getPro().backup.status();
                    if (!s.configured) {
                        console.log('  ℹ️  Backup not configured — run `aigon backup configure` to protect your aigon data.');
                    } else {
                        console.log(`  ✅ Backup configured: ${s.remote}`);
                        console.log(`     Last push: ${s.lastPushAt || 'never'} · Schedule: ${s.schedule}${s.scheduleActive ? '' : ' (inactive)'}`);
                    }
                }
            } catch (_) { /* Pro not present — skip backup section */ }

            // --- Linux Platform Checks ---
            if (process.platform === 'linux') {
                console.log('\nLinux Platform\n──────────────');
                // Check terminal emulators
                const terminals = ['kitty', 'gnome-terminal', 'xterm'];
                const found = terminals.filter(t => {
                    try { execSync(`which ${t}`, { stdio: 'pipe' }); return true; } catch { return false; }
                });
                if (found.length > 0) {
                    console.log(`  ✅ Terminal emulators: ${found.join(', ')}`);
                } else {
                    console.log('  ⚠️  No supported terminal emulator found (kitty, gnome-terminal, xterm)');
                    console.log('     Aigon will print tmux attach commands for manual use');
                }
                // Check xdg-open
                try {
                    execSync('which xdg-open', { stdio: 'pipe' });
                    console.log('  ✅ xdg-open is available');
                } catch {
                    console.log('  ⚠️  xdg-open not found — file/URL opening may not work');
                    console.log('     Install: sudo apt install xdg-utils');
                }
            }

            // --- Proxy Health ---
            console.log('\nProxy Health (Caddy)\n────────────────────');
            try {
                const diag = proxyDiagnosticsFn();
                const ok = (v) => v ? '✅' : '❌';
                console.log(`  ${ok(diag.proxy.installed)} Caddy installed`);
                console.log(`  ${ok(diag.proxy.running)} Caddy running`);
                const routes = parseCaddyRoutesFn();
                console.log(`  ℹ️  Routes: ${routes.length} configured`);
                if (diag.fix) {
                    console.log(`\n  💡 Fix: ${diag.fix}`);
                }
            } catch (e) {
                console.log(`  ⚠️  Proxy diagnostics failed: ${e.message}`);
            }

            // --- Model Checks ---
            console.log('\nModel Health Check\n──────────────────');
            const agents = getAvailableAgentsFn();
            const noModelFlag = new Set(['cu']);
            let modelWarnings = 0;

            for (const agentId of agents) {
                const agentConfig = loadAgentConfigFn(agentId);
                if (!agentConfig) {
                    console.log(`  ❌ ${agentId}: Agent template not found`);
                    modelWarnings++;
                    continue;
                }

                const hasModels = agentConfig.cli?.models && Object.keys(agentConfig.cli.models).length > 0;

                // Warn if Cursor has models configured (they won't be used)
                if (noModelFlag.has(agentId)) {
                    const cliConfig = getAgentCliConfigFn(agentId);
                    const configuredModels = Object.entries(cliConfig.models).filter(([, v]) => v);
                    if (configuredModels.length > 0) {
                        console.log(`  ⚠️  ${agentId} (${agentConfig.name}): Models configured but CLI has no --model flag`);
                        modelWarnings++;
                    } else {
                        console.log(`  ✅ ${agentId} (${agentConfig.name}): No model flag (expected)`);
                    }
                    continue;
                }

                if (!hasModels) {
                    console.log(`  ℹ️  ${agentId} (${agentConfig.name}): No model metadata in template`);
                } else {
                    console.log(`  ✅ ${agentId} (${agentConfig.name}): Template metadata present`);
                }
            }

            console.log('');
            if (modelWarnings > 0) {
                console.log(`${modelWarnings} model warning${modelWarnings === 1 ? '' : 's'}.`);
            } else {
                console.log('No model issues found.');
            }
            console.log(`💡 Run \`aigon config models\` for full model configuration table.`);

            // --- State Reconciliation ---
            console.log('\nState Reconciliation\n────────────────────');
            const agentStatus = require('../agent-status');
            const issues = [];
            const stateDir = agentStatus.getStateDir();
            const locksDir = agentStatus.getLocksDir();

            function detectDefaultBranchForRepo(repoPath) {
                const quoted = JSON.stringify(repoPath);
                try {
                    const remoteHead = execSync(`git -C ${quoted} symbolic-ref --short refs/remotes/origin/HEAD`, { // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
                        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
                    }).trim();
                    const parsed = remoteHead.replace(/^origin\//, '').trim();
                    if (parsed) return parsed;
                } catch (_) { /* ignore */ }
                for (const candidate of ['main', 'master']) {
                    try {
                        execSync(`git -C ${quoted} show-ref --verify --quiet refs/heads/${candidate}`, { stdio: 'ignore' }); // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
                        return candidate;
                    } catch (_) { /* ignore */ }
                }
                return 'main';
            }

            function hasFeatureWorktreeCommits(id, agent) {
                const wtBase = path.join(os.homedir(), '.aigon', 'worktrees', path.basename(process.cwd()));
                // Also check legacy sibling location
                const legacyWtBase = path.resolve(process.cwd(), '..', path.basename(process.cwd()) + '-worktrees');
                const effectiveBase = fs.existsSync(wtBase) ? wtBase : (fs.existsSync(legacyWtBase) ? legacyWtBase : null);
                if (!effectiveBase) return false;
                const paddedId = String(id).padStart(2, '0');
                const unpaddedId = String(parseInt(id, 10));
                let worktreePath = null;
                try {
                    const entries = fs.readdirSync(effectiveBase);
                    const hit = entries.find(name => {
                        const m = name.match(/^feature-(\d+)-([a-z]{2})-.+$/);
                        return m && (m[1] === paddedId || m[1] === unpaddedId) && m[2] === agent;
                    });
                    if (hit) worktreePath = path.join(effectiveBase, hit);
                } catch (_) { /* ignore */ }
                if (!worktreePath) return false;
                const quoted = JSON.stringify(worktreePath);
                const defaultBranch = detectDefaultBranchForRepo(worktreePath);
                try {
                    const ahead = parseInt(execSync(`git -C ${quoted} rev-list --count ${defaultBranch}..HEAD`, {
                        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
                    }).trim(), 10);
                    return Number.isFinite(ahead) && ahead > 0;
                } catch (_) {
                    return false;
                }
            }

            function hasResearchFindingsProgress(researchId, agent) {
                const logsDir = path.join(process.cwd(), 'docs', 'specs', 'research-topics', 'logs');
                const filePath = path.join(logsDir, `research-${researchId}-${agent}-findings.md`);
                if (!fs.existsSync(filePath)) return false;
                try {
                    const content = fs.readFileSync(filePath, 'utf8');
                    const section = content.match(/^##\s+Findings\s*\r?\n([\s\S]*?)(?=^##\s+|$)/im);
                    const body = (section ? section[1] : content).split(/\r?\n/)
                        .map(line => line.trim())
                        .filter(Boolean)
                        .filter(line => !line.startsWith('- [') && !/^TBD$/i.test(line));
                    return body.length >= 3;
                } catch (_) {
                    return false;
                }
            }

            function isAgentSessionRunning(entityType, id, agent) {
                try {
                    const out = execSync('tmux list-sessions -F "#S"', {
                        encoding: 'utf8',
                        stdio: ['ignore', 'pipe', 'ignore']
                    });
                    const names = out.split('\n').map(v => v.trim()).filter(Boolean);
                    const prefix = entityType === 'research' ? `-r${parseInt(id, 10)}-${agent}` : `-f${parseInt(id, 10)}-${agent}`;
                    return names.some(name => name.includes(prefix));
                } catch (_) {
                    return false;
                }
            }

            // Check: .env.local gitignore + tracking state
            const preCommitHookPath = path.join(process.cwd(), SECURITY_HOOKS_PATH, PRE_COMMIT_HOOK_NAME);
            if (!fs.existsSync(preCommitHookPath)) {
                const issue = {
                    check: 'pre-commit-hook-missing',
                    featureId: '-',
                    message: `Missing ${SECURITY_HOOKS_PATH}/${PRE_COMMIT_HOOK_NAME}`,
                    safe: true,
                };
                issues.push(issue);
                if (doFix) {
                    ensurePreCommitHook();
                    console.log(`  ✅ pre-commit-hook-missing: created ${SECURITY_HOOKS_PATH}/${PRE_COMMIT_HOOK_NAME}`);
                } else {
                    console.log(`  ⚠️  pre-commit-hook-missing: ${issue.message}`);
                    console.log(`     💡 Run \`aigon doctor --fix\` to scaffold the hook.`);
                }
            }

            if (!isHooksPathConfigured()) {
                const issue = {
                    check: 'git-hooks-path-missing',
                    featureId: '-',
                    message: `git core.hooksPath is not set to ${SECURITY_HOOKS_PATH}`,
                    safe: true,
                };
                issues.push(issue);
                if (doFix) {
                    const hookSetup = ensureHooksPathConfigured();
                    if (hookSetup.ok) {
                        console.log(`  ✅ git-hooks-path-missing: set core.hooksPath=${SECURITY_HOOKS_PATH}`);
                    } else {
                        console.log(`  ⚠️  git-hooks-path-missing: failed to set hooksPath (${hookSetup.error})`);
                    }
                } else {
                    console.log(`  ⚠️  git-hooks-path-missing: ${issue.message}`);
                    console.log(`     💡 Run \`aigon doctor --fix\` to configure git hooks.`);
                }
            }

            const envGitignoreStatus = getEnvLocalGitignoreStatus();
            if (!envGitignoreStatus.hasAllEntries) {
                const issue = {
                    check: 'env-gitignore-missing',
                    featureId: '-',
                    message: `Missing .gitignore entries: ${envGitignoreStatus.missingEntries.join(', ')}`,
                    safe: true,
                };
                issues.push(issue);
                if (doFix) {
                    const result = ensureEnvLocalGitignore();
                    console.log(`  ✅ env-gitignore-missing: added ${result.addedEntries.join(', ')}`);
                } else {
                    console.log(`  ⚠️  env-gitignore-missing: ${issue.message}`);
                    console.log('     💡 Run `aigon doctor --fix` to add them automatically.');
                }
            }

            const trackedEnvLocals = getTrackedEnvLocalFiles();
            if (trackedEnvLocals.length > 0) {
                const issue = {
                    check: 'tracked-env-local',
                    featureId: '-',
                    message: `Tracked env-local files: ${trackedEnvLocals.join(', ')}`,
                    safe: true,
                };
                issues.push(issue);
                if (doFix) {
                    const untracked = untrackFiles(process.cwd(), trackedEnvLocals);
                    if (untracked.ok) {
                        console.log(`  ✅ tracked-env-local: untracked ${trackedEnvLocals.length} file(s)`);
                    } else {
                        console.log(`  ⚠️  tracked-env-local: failed to untrack (${untracked.error})`);
                    }
                } else {
                    console.log(`  ⚠️  tracked-env-local: ${issue.message}`);
                    console.log('     💡 Run `aigon doctor --fix` to untrack and keep local copies.');
                }
            }

            // Check: GitHub secret scanning enabled (requires gh CLI)
            const { isBinaryAvailable } = require('../security');
            if (isBinaryAvailable('gh')) {
                try {
                    // Get the remote repo in owner/repo format
                    const remoteUrl = execSync('git remote get-url origin', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
                    let ownerRepo = null;
                    // Parse SSH or HTTPS URLs
                    const sshMatch = remoteUrl.match(/[:\/]([^/]+\/[^/]+?)(?:\.git)?$/);
                    if (sshMatch) ownerRepo = sshMatch[1];

                    if (ownerRepo) {
                        const apiResult = execSync(
                            `gh api repos/${ownerRepo} --jq '.security_and_analysis.secret_scanning.status // "not_available"'`,
                            { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 }
                        ).trim();

                        if (apiResult === 'enabled') {
                            console.log(`  ✅ GitHub secret scanning: enabled (${ownerRepo})`);
                        } else {
                            const issue = {
                                check: 'github-secret-scanning-disabled',
                                featureId: '-',
                                message: `GitHub secret scanning not enabled for ${ownerRepo}`,
                                safe: false,
                            };
                            issues.push(issue);
                            console.log(`  ⚠️  github-secret-scanning-disabled: ${issue.message}`);
                            console.log(`     💡 Enable at: https://github.com/${ownerRepo}/settings/security_analysis`);
                        }

                        // Also check push protection
                        const pushProtection = execSync(
                            `gh api repos/${ownerRepo} --jq '.security_and_analysis.secret_scanning_push_protection.status // "not_available"'`,
                            { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 }
                        ).trim();

                        if (pushProtection === 'enabled') {
                            console.log(`  ✅ GitHub push protection: enabled`);
                        } else {
                            const issue = {
                                check: 'github-push-protection-disabled',
                                featureId: '-',
                                message: `GitHub push protection not enabled for ${ownerRepo}`,
                                safe: false,
                            };
                            issues.push(issue);
                            console.log(`  ⚠️  github-push-protection-disabled: ${issue.message}`);
                            console.log(`     💡 Enable at: https://github.com/${ownerRepo}/settings/security_analysis`);
                        }
                    }
                } catch (e) {
                    // gh not authenticated or API error — skip gracefully
                    console.log(`  ℹ️  GitHub secret scanning: could not check (${e.message.split('\n')[0]})`);
                }
            } else {
                console.log(`  ℹ️  GitHub secret scanning: skipped (gh CLI not installed)`);
            }

            const { writeAgentStatus } = require('../agent-status');
            const manifest = {
                readManifest(id) {
                    const manifestPath = path.join(stateDir, `feature-${id}.json`);
                    if (!fs.existsSync(manifestPath)) return null;
                    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                },
                writeManifest(id, patch) {
                    const manifestPath = path.join(stateDir, `feature-${id}.json`);
                    const current = this.readManifest(id) || { id };
                    fs.writeFileSync(manifestPath, JSON.stringify({ ...current, ...patch }, null, 2) + '\n');
                },
                writeAgentStatus(id, agent, data, prefix = 'feature') {
                    writeAgentStatus(id, agent, data, prefix);
                },
            };

            // Discover all feature manifests
            let manifestFiles = [];
            if (fs.existsSync(stateDir)) {
                try {
                    manifestFiles = fs.readdirSync(stateDir)
                        .filter(f => /^feature-\d+\.json$/.test(f))
                        .map(f => {
                            const m = f.match(/^feature-(\d+)\.json$/);
                            return m ? m[1] : null;
                        })
                        .filter(Boolean);
                } catch (e) { /* ignore */ }
            }

            // Also discover features from spec folders that may not have manifests yet
            const specsRoot = path.join(process.cwd(), 'docs', 'specs', 'features');
            const FOLDERS = [
                { folder: '01-inbox', stage: 'inbox' },
                { folder: '02-backlog', stage: 'backlog' },
                { folder: '03-in-progress', stage: 'in-progress' },
                { folder: '04-in-evaluation', stage: 'in-evaluation' },
                { folder: '05-done', stage: 'done' },
                { folder: '06-paused', stage: 'paused' },
            ];
            const folderStageById = {};
            FOLDERS.forEach(({ folder, stage }) => {
                const dir = path.join(specsRoot, folder);
                if (!fs.existsSync(dir)) return;
                try {
                    fs.readdirSync(dir).forEach(f => {
                        const m = f.match(/^feature-(\d+)-/);
                        if (m) folderStageById[m[1]] = stage;
                    });
                } catch (e) { /* ignore */ }
            });

            // Merge IDs from manifests + folders
            const allIds = [...new Set([...manifestFiles, ...Object.keys(folderStageById)])];

            for (const id of allIds) {
                let m;
                try { m = manifest.readManifest(id); } catch (e) { continue; }
                if (!m) continue;

                const folderStage = folderStageById[id] || null;

                // Check 1: stage-mismatch — manifest stage vs folder position
                if (folderStage && m.stage !== folderStage) {
                    const issue = {
                        check: 'stage-mismatch',
                        featureId: id,
                        message: `Manifest stage '${m.stage}' != folder stage '${folderStage}'`,
                        safe: true,
                    };
                    issues.push(issue);
                    if (doFix) {
                        // Safe repair: correct manifest to match folder (folder is source of truth)
                        manifest.writeManifest(id, { stage: folderStage }, { type: 'reconcile-stage', actor: 'doctor' });
                        console.log(`  ✅ stage-mismatch [feature-${id}]: fixed (${m.stage} → ${folderStage})`);
                    } else {
                        console.log(`  ⚠️  stage-mismatch [feature-${id}]: ${issue.message}`);
                    }
                }

                // Check 2: orphaned-worktree — manifest agents vs worktree existence
                if (m.agents && m.agents.length > 0 && m.stage !== 'in-progress' && m.stage !== 'in-evaluation') {
                    // For done/paused features, worktrees should not exist
                    let worktrees = [];
                    try {
                        const wtOutput = execSync('git worktree list', { encoding: 'utf8', timeout: 5000 });
                        for (const line of wtOutput.split('\n')) {
                            const wtMatch = line.match(/^([^\s]+)\s+/);
                            if (!wtMatch) continue;
                            const wtPath = wtMatch[1];
                            const base = path.basename(wtPath);
                            const paddedId = String(id).padStart(2, '0');
                            const unpaddedId = String(parseInt(id, 10));
                            if (base.match(new RegExp(`^feature-(${paddedId}|${unpaddedId})-`))) {
                                worktrees.push(wtPath);
                            }
                        }
                    } catch (e) { /* ignore */ }

                    if (worktrees.length > 0) {
                        worktrees.forEach(wtPath => {
                            const issue = {
                                check: 'orphaned-worktree',
                                featureId: id,
                                message: `Worktree exists for ${m.stage} feature: ${wtPath}`,
                                safe: false,
                            };
                            issues.push(issue);
                            console.log(`  ⚠️  orphaned-worktree [feature-${id}]: ${issue.message}`);
                        });
                    }
                }

                // Check 3: stale-pending — pending ops older than 1 hour
                if (m.pending && m.pending.length > 0) {
                    const lastEvent = m.events && m.events.length > 0 ? m.events[m.events.length - 1] : null;
                    const lastEventTime = lastEvent ? new Date(lastEvent.at).getTime() : 0;
                    const ageMs = Date.now() - lastEventTime;
                    const ONE_HOUR = 60 * 60 * 1000;
                    if (ageMs > ONE_HOUR) {
                        const ageHours = Math.round(ageMs / ONE_HOUR);
                        const issue = {
                            check: 'stale-pending',
                            featureId: id,
                            message: `Pending ops [${m.pending.join(', ')}] stale for ~${ageHours}h`,
                            safe: true,
                        };
                        issues.push(issue);
                        if (doFix) {
                            // Safe repair: clear stale pending ops
                            manifest.writeManifest(id, { pending: [] }, { type: 'reconcile-pending', actor: 'doctor' });
                            console.log(`  ✅ stale-pending [feature-${id}]: cleared ${m.pending.length} stale op(s)`);
                        } else {
                            console.log(`  ⚠️  stale-pending [feature-${id}]: ${issue.message}`);
                        }
                    }
                }

                // Check 4: dead-agent — agent status files for closed features
                if (m.stage === 'done') {
                    const agentsWithStatus = [];
                    if (fs.existsSync(stateDir)) {
                        try {
                            fs.readdirSync(stateDir)
                                .filter(f => {
                                    const paddedId = String(id).padStart(2, '0');
                                    const unpaddedId = String(parseInt(id, 10));
                                    return f.match(new RegExp(`^feature-(${paddedId}|${unpaddedId})-[a-z]+\\.json$`));
                                })
                                .forEach(f => agentsWithStatus.push(f));
                        } catch (e) { /* ignore */ }
                    }
                    if (agentsWithStatus.length > 0) {
                        const issue = {
                            check: 'dead-agent',
                            featureId: id,
                            message: `${agentsWithStatus.length} agent status file(s) for done feature: ${agentsWithStatus.join(', ')}`,
                            safe: true,
                        };
                        issues.push(issue);
                        if (doFix) {
                            agentsWithStatus.forEach(f => {
                                try { fs.unlinkSync(path.join(stateDir, f)); } catch (e) { /* ignore */ }
                            });
                            console.log(`  ✅ dead-agent [feature-${id}]: removed ${agentsWithStatus.length} agent status file(s)`);
                        } else {
                            console.log(`  ⚠️  dead-agent [feature-${id}]: ${issue.message}`);
                        }
                    }
                }

                // Check 5: stale-implementing-session-ended — implementing status with no tmux session but evidence of work
                if ((m.stage === 'in-progress' || m.stage === 'in-evaluation') && Array.isArray(m.agents)) {
                    m.agents.forEach(agent => {
                        if (!agent || agent === 'solo') return;
                        const statusPath = path.join(stateDir, `feature-${id}-${agent}.json`);
                        let agentState = null;
                        try {
                            if (fs.existsSync(statusPath)) {
                                agentState = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
                            }
                        } catch (_) { /* ignore */ }
                        const status = agentState && agentState.status ? agentState.status : 'implementing';
                        if (status !== 'implementing') return;
                        const flags = (agentState && agentState.flags && typeof agentState.flags === 'object') ? agentState.flags : {};
                        if (flags.sessionEnded) return;
                        const tmuxRunning = isAgentSessionRunning('feature', id, agent);
                        if (tmuxRunning) return;
                        if (!hasFeatureWorktreeCommits(id, agent)) return;

                        const issue = {
                            check: 'stale-implementing-session-ended',
                            featureId: id,
                            message: `Agent ${agent} has implementing status but session is ended with implementation commits`,
                            safe: true,
                        };
                        issues.push(issue);
                        if (doFix) {
                            manifest.writeAgentStatus(id, agent, {
                                status: 'implementing',
                                flags: {
                                    ...flags,
                                    sessionEnded: true,
                                    sessionEndedAt: new Date().toISOString()
                                }
                            });
                            console.log(`  ✅ stale-implementing-session-ended [feature-${id}-${agent}]: flagged sessionEnded`);
                        } else {
                            console.log(`  ⚠️  stale-implementing-session-ended [feature-${id}-${agent}]: ${issue.message}`);
                        }
                    });
                }
            }

            // Check: stale drive-style branch alongside worktree branches (feature 240)
            // A bare `feature-<num>-<slug>` branch must never coexist with a
            // worktree branch `feature-<num>-<agent>-<slug>` for the same feature —
            // feature-close resolves the drive branch first and silently merges
            // the wrong commits. Detect and guide the user through safe cleanup.
            try {
                const allBranches = execSync('git branch --format="%(refname:short)"', {
                    encoding: 'utf8',
                    stdio: ['ignore', 'pipe', 'ignore'],
                }).split('\n').map(s => s.trim()).filter(Boolean);

                const byFeatureId = new Map();
                for (const br of allBranches) {
                    const match = br.match(/^feature-(\d+)-(.+)$/);
                    if (!match) continue;
                    const [, fid, tail] = match;
                    if (!byFeatureId.has(fid)) byFeatureId.set(fid, []);
                    byFeatureId.get(fid).push({ branch: br, tail });
                }

                for (const [fid, branches] of byFeatureId) {
                    for (const drive of branches) {
                        const siblings = branches.filter(candidate => {
                            if (candidate.branch === drive.branch) return false;
                            return candidate.tail.endsWith(`-${drive.tail}`);
                        });
                        if (siblings.length === 0) continue;
                        const issue = {
                            check: 'stale-drive-branch',
                            featureId: fid,
                            message: `Stale drive-style branch ${drive.branch} alongside worktree branch(es): ${siblings.map(s => s.branch).join(', ')}`,
                            safe: false,
                        };
                        issues.push(issue);
                        console.log(`  ⚠️  stale-drive-branch [feature-${fid}]: ${issue.message}`);
                        console.log(`     💡 Recovery (after confirming the worktree branch has the real implementation):`);
                        console.log(`        git branch -D ${drive.branch}`);
                        console.log(`     If the drive branch actually has commits you need, merge them into the worktree branch first.`);
                    }
                }
            } catch (_) { /* git unavailable or not a repo — skip */ }

            // Research stale implementing session check
            const researchInProgressDir = path.join(process.cwd(), 'docs', 'specs', 'research-topics', '03-in-progress');
            if (fs.existsSync(researchInProgressDir)) {
                try {
                    fs.readdirSync(researchInProgressDir)
                        .filter(f => /^research-\d+-.+\.md$/.test(f))
                        .forEach(file => {
                            const m = file.match(/^research-(\d+)-/);
                            if (!m) return;
                            const researchId = m[1];
                            const researchLogsDir = path.join(process.cwd(), 'docs', 'specs', 'research-topics', 'logs');
                            if (!fs.existsSync(researchLogsDir)) return;
                            const findings = fs.readdirSync(researchLogsDir)
                                .filter(f => f.startsWith(`research-${researchId}-`) && f.endsWith('-findings.md'));
                            findings.forEach(findingsFile => {
                                const fm = findingsFile.match(/^research-\d+-([a-z]{2})-findings\.md$/);
                                if (!fm) return;
                                const agent = fm[1];
                                const statusPath = path.join(stateDir, `feature-${researchId}-${agent}.json`);
                                let agentState = null;
                                try {
                                    if (fs.existsSync(statusPath)) {
                                        agentState = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
                                    }
                                } catch (_) { /* ignore */ }
                                const status = agentState && agentState.status ? agentState.status : 'implementing';
                                if (status !== 'implementing') return;
                                const flags = (agentState && agentState.flags && typeof agentState.flags === 'object') ? agentState.flags : {};
                                if (flags.sessionEnded) return;
                                const tmuxRunning = isAgentSessionRunning('research', researchId, agent);
                                if (tmuxRunning) return;
                                if (!hasResearchFindingsProgress(researchId, agent)) return;
                                const issue = {
                                    check: 'stale-implementing-session-ended',
                                    featureId: `research-${researchId}`,
                                    message: `Research agent ${agent} has implementing status but session is ended with findings progress`,
                                    safe: true,
                                };
                                issues.push(issue);
                                if (doFix) {
                                    manifest.writeAgentStatus(researchId, agent, {
                                        status: 'implementing',
                                        flags: {
                                            ...flags,
                                            sessionEnded: true,
                                            sessionEndedAt: new Date().toISOString()
                                        }
                                    }, 'research');
                                    console.log(`  ✅ stale-implementing-session-ended [research-${researchId}-${agent}]: flagged sessionEnded`);
                                } else {
                                    console.log(`  ⚠️  stale-implementing-session-ended [research-${researchId}-${agent}]: ${issue.message}`);
                                }
                            });
                        });
                } catch (_) { /* ignore */ }
            }

            // Check for stale locks
            if (fs.existsSync(locksDir)) {
                try {
                    fs.readdirSync(locksDir)
                        .filter(f => f.endsWith('.lock'))
                        .forEach(lockFile => {
                            const lockFilePath = path.join(locksDir, lockFile);
                            try {
                                const content = fs.readFileSync(lockFilePath, 'utf8').trim();
                                const pid = parseInt(content, 10);
                                let alive = false;
                                if (!isNaN(pid)) {
                                    try { process.kill(pid, 0); alive = true; } catch (e) { alive = false; }
                                }
                                if (!alive) {
                                    const issue = {
                                        check: 'stale-lock',
                                        featureId: lockFile.replace('feature-', '').replace('.lock', ''),
                                        message: `Stale lock file (PID ${content} dead): ${lockFile}`,
                                        safe: true,
                                    };
                                    issues.push(issue);
                                    if (doFix) {
                                        fs.unlinkSync(lockFilePath);
                                        console.log(`  ✅ stale-lock: removed ${lockFile}`);
                                    } else {
                                        console.log(`  ⚠️  stale-lock: ${issue.message}`);
                                    }
                                }
                            } catch (e) { /* ignore */ }
                        });
                } catch (e) { /* ignore */ }
            }

            // Log migration: flatten logs/selected/ and logs/alternatives/ back to logs/
            const logsRoot = path.join(specsRoot, 'logs');
            const selectedDir = path.join(logsRoot, 'selected');
            const alternativesDir = path.join(logsRoot, 'alternatives');
            let migratedCount = 0;
            [selectedDir, alternativesDir].forEach(subdir => {
                if (!fs.existsSync(subdir)) return;
                try {
                    const files = fs.readdirSync(subdir).filter(f => f.endsWith('.md'));
                    if (files.length > 0) {
                        if (doFix) {
                            files.forEach(f => {
                                const src = path.join(subdir, f);
                                const dest = path.join(logsRoot, f);
                                if (!fs.existsSync(dest)) {
                                    fs.renameSync(src, dest);
                                    migratedCount++;
                                }
                            });
                            // Remove empty subdir
                            const remaining = fs.readdirSync(subdir);
                            if (remaining.length === 0) fs.rmdirSync(subdir);
                        } else {
                            console.log(`  ⚠️  log-migration: ${files.length} file(s) in ${path.basename(subdir)}/ need flattening`);
                            issues.push({
                                check: 'log-migration',
                                featureId: '-',
                                message: `${files.length} log file(s) in ${path.basename(subdir)}/`,
                                safe: true,
                            });
                        }
                    }
                } catch (e) { /* ignore */ }
            });
            if (doFix && migratedCount > 0) {
                console.log(`  ✅ log-migration: moved ${migratedCount} log file(s) to flat logs/`);
                // Auto-commit the log migration (tracked files moved)
                try {
                    execSync('git add docs/specs/features/logs/ && git commit -m "chore: flatten log directory structure (aigon doctor migration)"', {
                        cwd: process.cwd(),
                        stdio: 'pipe',
                    });
                    console.log(`  📝 Committed log migration`);
                } catch (e) {
                    // May fail if nothing staged (already committed) or not a git repo
                    if (e.stderr && /nothing to commit/.test(e.stderr.toString())) {
                        // Already clean — no-op
                    } else {
                        console.log(`  ⚠️  Could not auto-commit log migration — run: git add docs/specs/features/logs/ && git commit -m "chore: flatten log directory structure"`);
                    }
                }
            }

            // Check: research folder renumbering migration (04-done → 05-done, 05-paused → 06-paused)
            const researchRoot = path.join(process.cwd(), 'docs', 'specs', 'research-topics');
            const oldResearchDone = path.join(researchRoot, '04-done');
            const newResearchDone = path.join(researchRoot, '05-done');
            const oldResearchPaused = path.join(researchRoot, '05-paused');
            const newResearchPaused = path.join(researchRoot, '06-paused');
            const newResearchEval = path.join(researchRoot, '04-in-evaluation');

            // Detect old numbering: 04-done exists but 05-done doesn't
            if (fs.existsSync(oldResearchDone) && !fs.existsSync(newResearchDone) && !fs.existsSync(newResearchEval)) {
                const issue = {
                    check: 'research-folder-renumber',
                    message: 'Research folders use old numbering (04-done, 05-paused). Needs migration to 04-in-evaluation, 05-done, 06-paused.',
                    safe: true,
                };
                issues.push(issue);
                if (doFix) {
                    // Create new evaluation folder
                    fs.mkdirSync(newResearchEval, { recursive: true });
                    // Rename 05-paused → 06-paused first (if exists), then 04-done → 05-done
                    if (fs.existsSync(oldResearchPaused)) {
                        fs.renameSync(oldResearchPaused, newResearchPaused);
                        console.log(`  ✅ research-folder-renumber: 05-paused → 06-paused`);
                    }
                    fs.renameSync(oldResearchDone, newResearchDone);
                    console.log(`  ✅ research-folder-renumber: 04-done → 05-done`);
                    console.log(`  ✅ research-folder-renumber: created 04-in-evaluation`);
                } else {
                    console.log(`  ⚠️  research-folder-renumber: ${issue.message}`);
                }
            } else {
                // Ensure new folders exist even if no migration needed
                if (fs.existsSync(researchRoot)) {
                    if (!fs.existsSync(newResearchEval)) fs.mkdirSync(newResearchEval, { recursive: true });
                    if (!fs.existsSync(newResearchPaused)) fs.mkdirSync(newResearchPaused, { recursive: true });
                }
            }

            // Feature 341: check spec-level `agent:` frontmatter validity.
            console.log('\n🔍 Spec frontmatter agent field...');
            const availableForAgentCheck = getAvailableAgentsFn();
            const invalidAgentSpecs = findSpecsWithInvalidAgentField(process.cwd(), availableForAgentCheck);
            if (invalidAgentSpecs.length === 0) {
                console.log('  ✅ All specs have valid agent: frontmatter');
            } else if (doFix) {
                let repaired = 0;
                for (const s of invalidAgentSpecs) {
                    if (repairInvalidAgentField(s.specPath)) repaired += 1;
                }
                console.log(`  🔧 Stripped invalid agent: line from ${repaired} spec(s)`);
            } else {
                for (const s of invalidAgentSpecs) {
                    issues.push({
                        check: 'invalid-spec-agent-field',
                        featureId: '-',
                        message: `${path.relative(process.cwd(), s.specPath)}: ${s.reason}`,
                        safe: true,
                    });
                    console.log(`  ⚠️  invalid-spec-agent-field: ${path.relative(process.cwd(), s.specPath)} — ${s.reason}`);
                }
            }

            // Check: pending schema migrations (must run before workflow bootstrap so shape
            // is correct by the time bootstrap creates new snapshots)
            console.log('\n🔍 Schema migrations...');
            {
                const { runPendingMigrations, _internals: migInternals } = require('../migration');
                const repoPathForMig = process.cwd();
                if (migInternals.migrations.size === 0) {
                    console.log('  ✅ No migrations registered');
                } else if (doFix) {
                    try {
                        const results = await runPendingMigrations(repoPathForMig);
                        const applied = results.filter(r => r.status === 'success');
                        const failed = results.filter(r => r.status === 'restored' || r.status === 'failed');
                        if (failed.length > 0) {
                            for (const r of failed) {
                                const manifestPath = path.join(repoPathForMig, '.aigon', 'migrations', r.version, 'manifest.json');
                                issues.push({
                                    check: 'migration-failed',
                                    featureId: '-',
                                    message: `Migration ${r.version} failed — check ${manifestPath}`,
                                    safe: false,
                                });
                                console.log(`  ❌ Migration ${r.version}: failed — check ${manifestPath}`);
                            }
                        } else if (applied.length === 0) {
                            console.log('  ✅ All migrations applied');
                        }
                    } catch (e) {
                        console.warn(`  ⚠️  Migration check failed: ${e.message}`);
                    }
                } else {
                    // Detect-only: walk registry vs on-disk manifests without running
                    const pendingVersions = [...migInternals.migrations.values()]
                        .filter(({ version }) => {
                            const m = migInternals.readManifest(repoPathForMig, version);
                            return !m || m.status !== 'success';
                        })
                        .map(({ version }) => version);
                    if (pendingVersions.length === 0) {
                        console.log('  ✅ All migrations applied');
                    } else {
                        issues.push({
                            check: 'pending-migrations',
                            featureId: '-',
                            message: `${pendingVersions.length} pending migration(s): ${pendingVersions.join(', ')} (run \`aigon doctor --fix\` to apply)`,
                            safe: true,
                        });
                        console.log(`  ⚠️  ${pendingVersions.length} pending migration(s): ${pendingVersions.join(', ')} (run \`aigon doctor --fix\` to apply)`);
                    }
                }
            }

            // Check: missing workflow-core snapshots
            console.log('\n🔍 Workflow state...');
            const missing = findEntitiesMissingWorkflowState(process.cwd());
            const totalMissing = missing.features.length + missing.research.length;
            if (totalMissing === 0) {
                console.log('  ✅ All features and research have workflow state');
            } else {
                const parts = [];
                if (missing.features.length > 0) parts.push(`${missing.features.length} feature(s)`);
                if (missing.research.length > 0) parts.push(`${missing.research.length} research topic(s)`);
                if (doFix) {
                    let bootstrapped = 0;
                    bootstrapped += bootstrapMissingWorkflowSnapshots(process.cwd(), missing.features, 'feature');
                    bootstrapped += bootstrapMissingWorkflowSnapshots(process.cwd(), missing.research, 'research');
                    console.log(`  🔧 Bootstrapped workflow state for ${parts.join(' and ')}`);
                } else {
                    const issue = {
                        check: 'missing-workflow-state',
                        featureId: '-',
                        message: `${parts.join(' and ')} missing workflow state`,
                        safe: true,
                    };
                    issues.push(issue);
                    console.log(`  ⚠️  ${parts.join(' and ')} missing workflow state (run \`aigon doctor --fix\` to bootstrap)`);
                }
            }

            // Check: slug-only specs outside inbox (definitionally invalid)
            {
                const featuresRoot = path.join(process.cwd(), 'docs', 'specs', 'features');
                const researchRoot = path.join(process.cwd(), 'docs', 'specs', 'research-topics');
                // 05-done and 06-paused slug-only specs are legitimate: pre-ID historical artifacts or
                // intentionally paused before being prioritised. Leave them in place.
                const NON_INBOX_FOLDERS = ['02-backlog', '03-in-progress', '04-in-evaluation'];
                const misplacedSlugs = [];
                for (const [root, prefix] of [[featuresRoot, 'feature'], [researchRoot, 'research']]) {
                    for (const folder of NON_INBOX_FOLDERS) {
                        const dir = path.join(root, folder);
                        if (!fs.existsSync(dir)) continue;
                        for (const file of fs.readdirSync(dir)) {
                            if (!file.endsWith('.md')) continue;
                            if (!file.startsWith(`${prefix}-`)) continue;
                            const hasId = new RegExp(`^${prefix}-\\d+-`).test(file);
                            if (!hasId) misplacedSlugs.push({ file, folder, dir, prefix });
                        }
                    }
                }
                if (misplacedSlugs.length === 0) {
                    console.log('  ✅ No slug-only specs outside inbox');
                } else {
                    for (const { file, folder, dir, prefix } of misplacedSlugs) {
                        const inboxDir = path.join(path.dirname(dir), '01-inbox');
                        if (doFix) {
                            fs.mkdirSync(inboxDir, { recursive: true });
                            fs.renameSync(path.join(dir, file), path.join(inboxDir, file));
                            console.log(`  🔧 Moved misplaced slug-only spec: ${folder}/${file} → 01-inbox/${file}`);
                        } else {
                            issues.push({ check: 'misplaced-slug-spec', featureId: file, message: `Slug-only spec in ${folder}/ (should be in 01-inbox): ${file}`, safe: true });
                            console.log(`  ⚠️  misplaced-slug-spec: ${folder}/${file} belongs in 01-inbox (run \`aigon doctor --fix\` to move)`);
                        }
                    }
                }
            }

            // Check: spec folder vs workflow snapshot state mismatch
            {
                const featuresRoot = path.join(process.cwd(), 'docs', 'specs', 'features');
                const researchRoot = path.join(process.cwd(), 'docs', 'specs', 'research-topics');
                const workflowSnapshotAdapterLocal = require('../workflow-snapshot-adapter');
                const drifted = [];
                for (const [root, prefix, lifecycleMap, entityType] of [
                    [featuresRoot, 'feature', LIFECYCLE_TO_FEATURE_DIR, 'feature'],
                    [researchRoot, 'research', LIFECYCLE_TO_RESEARCH_DIR, 'research'],
                ]) {
                    const allFolders = ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused'];
                    for (const folder of allFolders) {
                        const dir = path.join(root, folder);
                        if (!fs.existsSync(dir)) continue;
                        for (const file of fs.readdirSync(dir)) {
                            if (!file.endsWith('.md')) continue;
                            const idMatch = file.match(new RegExp(`^${prefix}-(\\d+)-`));
                            if (!idMatch) continue;
                            const id = String(parseInt(idMatch[1], 10)).padStart(2, '0');
                            let snapshot;
                            try {
                                snapshot = entityType === 'feature'
                                    ? workflowSnapshotAdapterLocal.readFeatureSnapshotSync(process.cwd(), id)
                                    : workflowSnapshotAdapterLocal.readWorkflowSnapshotSync(process.cwd(), 'research', id);
                            } catch (_) { continue; }
                            if (!snapshot) continue;
                            const state = snapshot.currentSpecState || snapshot.lifecycle;
                            if (!state) continue;
                            const expectedFolder = lifecycleMap[state];
                            if (expectedFolder && expectedFolder !== folder) {
                                drifted.push({ file, id, folder, expectedFolder, entityType });
                            }
                        }
                    }
                }
                if (drifted.length === 0) {
                    console.log('  ✅ All spec folders match workflow state');
                } else {
                    for (const { file, id, folder, expectedFolder, entityType } of drifted) {
                        const root = entityType === 'feature'
                            ? path.join(process.cwd(), 'docs', 'specs', 'features')
                            : path.join(process.cwd(), 'docs', 'specs', 'research-topics');
                        if (doFix) {
                            const from = path.join(root, folder, file);
                            const toDir = path.join(root, expectedFolder);
                            fs.mkdirSync(toDir, { recursive: true });
                            fs.renameSync(from, path.join(toDir, file));
                            console.log(`  🔧 Moved drifted spec: ${folder}/${file} → ${expectedFolder}/${file}`);
                        } else {
                            issues.push({ check: 'spec-folder-drift', featureId: id, message: `${entityType} ${id} spec is in ${folder}/ but workflow state says ${expectedFolder}/`, safe: true });
                            console.log(`  ⚠️  spec-folder-drift [${entityType} ${id}]: in ${folder}/ but state says ${expectedFolder}/ (run \`aigon doctor --fix\` to correct)`);
                        }
                    }
                }
            }

            // Worktree directory checks
            const repoNameForWt = path.basename(process.cwd());
            const newWtBase = path.join(os.homedir(), '.aigon', 'worktrees', repoNameForWt);
            const legacyWtBase = path.resolve(process.cwd(), '..', `${repoNameForWt}-worktrees`);

            // Check: worktree directory exists
            if (!fs.existsSync(newWtBase)) {
                const wtIssue = {
                    check: 'worktree-dir-missing',
                    featureId: '-',
                    message: `Worktree directory missing: ${newWtBase}`,
                    safe: true,
                };
                issues.push(wtIssue);
                if (doFix) {
                    fs.mkdirSync(newWtBase, { recursive: true });
                    console.log(`  ✅ worktree-dir-missing: created ${newWtBase}`);
                } else {
                    console.log(`  ⚠️  worktree-dir-missing: ${wtIssue.message}`);
                }
            }

            // Check: legacy worktrees need migration
            if (fs.existsSync(legacyWtBase)) {
                try {
                    const legacyEntries = fs.readdirSync(legacyWtBase)
                        .filter(name => /^(feature|research)-\d+-[a-z]{2}-.+$/.test(name));
                    if (legacyEntries.length > 0) {
                        const wtIssue = {
                            check: 'legacy-worktree-location',
                            featureId: '-',
                            message: `${legacyEntries.length} worktree(s) in legacy location: ${legacyWtBase}`,
                            safe: false,
                        };
                        issues.push(wtIssue);
                        console.log(`  ⚠️  legacy-worktree-location: ${wtIssue.message}`);
                        console.log(`      New worktrees will be created under: ${newWtBase}`);
                    }
                } catch (_) { /* ignore */ }
            }

            // Check: prune worktrees for completed features (--fix only)
            if (doFix && fs.existsSync(newWtBase)) {
                try {
                    const wtEntries = fs.readdirSync(newWtBase)
                        .filter(name => /^feature-(\d+)-[a-z]{2}-.+$/.test(name));
                    wtEntries.forEach(name => {
                        const m = name.match(/^feature-(\d+)-/);
                        if (!m) return;
                        const featureId = m[1];
                        const doneDir = path.join(process.cwd(), 'docs', 'specs', 'features', '05-done');
                        if (!fs.existsSync(doneDir)) return;
                        const isDone = fs.readdirSync(doneDir).some(f =>
                            f.startsWith(`feature-${featureId}-`) || f.startsWith(`feature-${String(parseInt(featureId, 10))}-`)
                        );
                        if (isDone) {
                            const wtPath = path.join(newWtBase, name);
                            console.log(`  🧹 Pruning worktree for done feature: ${name}`);
                            try {
                                execSync(`git worktree remove --force ${JSON.stringify(wtPath)}`, {
                                    cwd: process.cwd(), stdio: 'pipe'
                                });
                            } catch (_) {
                                try { fs.rmSync(wtPath, { recursive: true, force: true }); } catch (_) { /* ignore */ }
                            }
                        }
                    });
                } catch (_) { /* ignore */ }
            }

            // Profile sync notice moved to @aigon/pro with feature 236. When
            // Pro is installed and unconfigured, nudge the user; otherwise no
            // notice (profile sync is now Pro-only).
            try {
                const { isProAvailable, getPro } = require('../pro');
                if (isProAvailable() && getPro() && getPro().profile && typeof getPro().profile.getProfileRemote === 'function') {
                    if (!getPro().profile.getProfileRemote()) {
                        console.log('');
                        console.log('ℹ️  Profile sync is not configured.');
                        console.log('   Run: aigon profile configure <git-remote-url>');
                        console.log('   Syncs ~/.aigon/ (agent definitions, named workflows) between machines.');
                    }
                }
            } catch (_) { /* ignore — profile sync notice is best-effort */ }

            // Summary
            console.log('');
            if (issues.length === 0) {
                console.log('No state issues found.');
            } else {
                const safeCount = issues.filter(i => i.safe).length;
                const unsafeCount = issues.filter(i => !i.safe).length;
                if (doFix) {
                    const fixedCount = issues.filter(i => i.safe).length;
                    console.log(`Fixed ${fixedCount} issue(s).` + (unsafeCount > 0 ? ` ${unsafeCount} issue(s) require manual attention.` : ''));
                } else {
                    console.log(`${issues.length} issue(s) found` + (safeCount > 0 ? ` (${safeCount} auto-fixable with --fix)` : '') + '.');
                }
            }
        },

        'seed-reset': async (args) => {
            const { spawnSync } = require('child_process');
            const os = require('os');

            // Seed registry — maps repo names to their canonical seed repos.
            const SEED_REGISTRY = {
                brewboard:  'https://github.com/jayvee/brewboard-seed.git',
                trailhead:  'https://github.com/jayvee/trailhead-seed.git',
            };

            const repoArg = args.find(a => !a.startsWith('--'));
            const dryRun = args.includes('--dry-run');
            const force = args.includes('--force');

            if (!repoArg) {
                console.error('Usage: aigon seed-reset <repo-path> [--dry-run] [--force]');
                console.error('\nWipes a seed repo and re-clones it from the canonical seed.');
                console.error('Three phases: Nuke → Clone → Provision.');
                console.error(`\nKnown seeds: ${Object.keys(SEED_REGISTRY).join(', ')}`);
                console.error('\nExamples:');
                console.error('  aigon seed-reset brewboard            # resolves to $HOME/src/brewboard');
                console.error('  aigon seed-reset /path/to/brewboard');
                console.error('  aigon seed-reset trailhead --dry-run');
                console.error('  aigon seed-reset brewboard --force    # skip confirmation');
                return;
            }

            // --- Resolve paths ---
            const isBareSeedName =
                Object.prototype.hasOwnProperty.call(SEED_REGISTRY, repoArg) &&
                !repoArg.includes(path.sep) &&
                !repoArg.startsWith('~') &&
                !repoArg.startsWith('.');
            const canonicalRepoArg = isBareSeedName
                ? path.join(process.env.HOME || os.homedir(), 'src', repoArg)
                : repoArg;
            const repoPath = path.resolve(canonicalRepoArg.replace(/^~/, process.env.HOME));
            const repoName = path.basename(repoPath);
            const parentDir = path.dirname(repoPath);
            const worktreeDir = path.join(os.homedir(), '.aigon', 'worktrees', repoName);
            const legacyWorktreeDir = `${repoPath}-worktrees`;

            const seedUrl = SEED_REGISTRY[repoName];
            const workingRepoUrl = WORKING_REPO_REGISTRY[repoName];
            if (!seedUrl) {
                console.error(`❌ Unknown seed repo: ${repoName}`);
                console.error(`   Known seeds: ${Object.keys(SEED_REGISTRY).join(', ')}`);
                return;
            }

            // --- Gather inventory (always runs — needed for dry-run and plan display) ---

            function gatherInventory() {
                const inv = {
                    tmuxSessions: [],
                    worktreePaths: [],
                    repoExists: fs.existsSync(repoPath),
                    worktreeDirExists: fs.existsSync(worktreeDir),
                    legacyWorktreeDirExists: fs.existsSync(legacyWorktreeDir),
                    remoteUrls: [],
                };

                // Tmux sessions matching "<repoName>-*"
                try {
                    const tmuxList = spawnSync('tmux', ['list-sessions', '-F', '#S'], { encoding: 'utf8' });
                    if (!tmuxList.error && tmuxList.status === 0) {
                        inv.tmuxSessions = tmuxList.stdout.split('\n').map(s => s.trim()).filter(s =>
                            s.toLowerCase().startsWith(repoName.toLowerCase() + '-')
                        );
                    }
                } catch (_) { /* tmux not installed or no server */ }

                // Git worktrees (only if repo exists and is a git repo)
                if (inv.repoExists && fs.existsSync(path.join(repoPath, '.git'))) {
                    try {
                        const wtOutput = execSync('git worktree list --porcelain', { cwd: repoPath, encoding: 'utf8' });
                        inv.worktreePaths = wtOutput.split('\n\n')
                            .filter(block => block.includes('worktree '))
                            .map(block => block.match(/^worktree (.+)$/m)?.[1])
                            .filter(p => p && p !== repoPath);
                    } catch (_) { /* ignore — repo may be in broken state */ }
                }

                inv.remoteUrls = collectSeedResetRemoteUrls({
                    repoName,
                    seedUrl,
                    repoPath,
                    repoExists: inv.repoExists,
                });

                return inv;
            }

            // --- Print plan ---

            function printPlan(inv) {
                console.log(`\n🔄 Resetting ${repoName} from seed: ${seedUrl}\n`);
                console.log('   Plan:');
                if (inv.tmuxSessions.length)  console.log(`   [nuke]      Kill ${inv.tmuxSessions.length} tmux session(s): ${inv.tmuxSessions.join(', ')}`);
                                              console.log(`   [nuke]      Kill agent/dev-server processes for ${repoName}`);
                if (inv.worktreePaths.length)  console.log(`   [nuke]      Remove Claude trust/permissions for ${inv.worktreePaths.length} worktree(s)`);
                                              console.log(`   [nuke]      GC stale dev-proxy entries`);
                if (inv.repoExists)           console.log(`   [nuke]      rm -rf ${repoPath}`);
                if (inv.worktreeDirExists)    console.log(`   [nuke]      rm -rf ${worktreeDir}`);
                if (inv.legacyWorktreeDirExists) console.log(`   [nuke]      rm -rf ${legacyWorktreeDir} (legacy)`);
                                              console.log(`   [nuke]      Remove Gemini session dirs for this repo`);
                if (workingRepoUrl)           console.log(`   [nuke]      Close open PRs on ${workingRepoUrl} for feature/research branches`);
                if (inv.remoteUrls.length)    console.log(`   [nuke]      Delete remote feature/research branches`);
                console.log(`   [clone]     git clone ${seedUrl} ${repoPath}`);
                if (workingRepoUrl)           console.log(`   [clone]     git remote set-url origin ${workingRepoUrl}`);
                console.log(`   [provision] aigon init`);
                console.log(`   [provision] aigon install-agent (all available agents)`);
                                              console.log(`   [provision] npm install (warm cache for worktrees)`);
                                              console.log(`   [provision] git commit (so worktrees inherit templates)`);
                if (workingRepoUrl)           console.log(`   [provision] git push --force origin HEAD:main`);
                                              console.log(`   [provision] git push --force ${seedUrl} HEAD:main (keep seed current)`);
                                              console.log(`   [provision] Ensure local git exclude for runtime files`);
                console.log('');
            }

            // --- Phase 1: NUKE — kill sessions, remove dirs ---
            // Every step is individually wrapped. Non-critical failures log warnings and continue.

            function nukePhase(inv) {
                console.log('🔥 Phase 1: Nuke\n');

                // 1a. Kill tmux sessions
                inv.tmuxSessions.forEach(sessionName => {
                    try {
                        spawnSync('tmux', ['kill-session', '-t', sessionName], { stdio: 'ignore' });
                        console.log(`   ✓ Killed tmux: ${sessionName}`);
                    } catch (_) {
                        console.log(`   ⚠️  Could not kill tmux session: ${sessionName}`);
                    }
                });

                // 1b. Kill agent processes (aigon commands, dev-servers referencing this repo)
                const agentPatterns = [
                    `aigon:feature-do.*${repoName}`,
                    `aigon:research-do.*${repoName}`,
                    `aigon:feature-code-review.*${repoName}`,
                    `aigon:feature-review.*${repoName}`,
                ];
                agentPatterns.forEach(pattern => {
                    try { spawnSync('pkill', ['-f', pattern], { stdio: 'ignore' }); } catch (_) { /* ok */ } // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
                });

                // 1c. Kill straggler processes with cwd under repo or worktree dirs.
                // Detached shells, dev servers, and agent child processes may survive tmux shutdown.
                [repoPath, worktreeDir, legacyWorktreeDir, `${repoName}-worktrees`].forEach(pattern => {
                    try {
                        spawnSync('pkill', ['-f', String(pattern)], { stdio: 'ignore' }); // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
                    } catch (_) { /* ok */ }
                });
                console.log(`   ✓ Killed agent/straggler processes`);

                // 1d. Remove worktree permissions/trust from Claude settings (before wiping dirs)
                if (inv.worktreePaths.length > 0) {
                    try {
                        const { removeWorktreePermissions, removeWorktreeTrust } = u;
                        if (removeWorktreePermissions) removeWorktreePermissions(inv.worktreePaths);
                        if (removeWorktreeTrust) removeWorktreeTrust(inv.worktreePaths);
                        console.log(`   ✓ Removed Claude trust/permissions for ${inv.worktreePaths.length} worktree(s)`);
                    } catch (e) {
                        console.log(`   ⚠️  Could not clean Claude settings: ${e.message}`);
                    }
                }

                // 1e. GC Caddy routes for dead backends
                try {
                    const { gcCaddyRoutes } = u;
                    if (gcCaddyRoutes) {
                        const removed = gcCaddyRoutes();
                        if (removed > 0) console.log(`   ✓ Cleaned ${removed} stale Caddy routes`);
                    }
                } catch (_) { /* non-fatal */ }

                // 1f. Close open PRs on the working repo before deleting branches.
                if (workingRepoUrl) {
                    try {
                        const prResult = closeSeedResetOpenPullRequests({ remoteUrl: workingRepoUrl });
                        if (prResult.closed.length > 0) {
                            console.log(`   ✓ Closed open PR(s): ${prResult.closed.map(n => `#${n}`).join(', ')}`);
                        } else if (prResult.skipped) {
                            console.log(`   ⚠️  Skipped PR cleanup (${prResult.skipped})`);
                        }
                    } catch (e) {
                        console.log(`   ⚠️  Could not close open PRs: ${e.message}`);
                    }
                }

                // 1g. Delete remote feature/research branches on seed + working remotes.
                try {
                    const remoteCleanup = cleanupSeedResetRemoteBranches({
                        remoteUrls: inv.remoteUrls,
                        repoPath,
                        repoExists: inv.repoExists,
                    });
                    Object.entries(remoteCleanup.deletedByRemote).forEach(([remoteUrl, branchNames]) => {
                        if (branchNames.length > 0) {
                            console.log(`   ✓ Deleted ${branchNames.length} remote branch(es) on ${remoteUrl}`);
                        }
                    });
                } catch (e) {
                    console.log(`   ⚠️  Could not clean remote branches: ${e.message}`);
                }

                // 1h. Remove directories with retry for ENOTEMPTY / EBUSY
                removeDirectoryRobust(repoPath, 'repo');
                removeDirectoryRobust(worktreeDir, 'worktrees');
                if (inv.legacyWorktreeDirExists) removeDirectoryRobust(legacyWorktreeDir, 'legacy worktrees');

                // 1i. Remove Gemini tmp dirs whose .project_root points into this repo
                try {
                    const geminiTmpDir = path.join(os.homedir(), '.gemini', 'tmp');
                    if (fs.existsSync(geminiTmpDir)) {
                        const pathPrefixes = [repoPath, worktreeDir, legacyWorktreeDir].filter(Boolean);
                        let removed = 0;
                        for (const entry of fs.readdirSync(geminiTmpDir)) {
                            const projectRootFile = path.join(geminiTmpDir, entry, '.project_root');
                            if (!fs.existsSync(projectRootFile)) continue;
                            const storedPath = fs.readFileSync(projectRootFile, 'utf8').trim();
                            if (pathPrefixes.some(prefix => storedPath.startsWith(prefix))) {
                                removeDirectoryRobust(path.join(geminiTmpDir, entry), `gemini/tmp/${entry}`);
                                removed++;
                            }
                        }
                        if (removed > 0) console.log(`   ✓ Removed ${removed} Gemini session dir(s)`);
                    }
                } catch (_) { /* non-fatal */ }
            }

            /**
             * Remove a directory with retries to handle ENOTEMPTY and EBUSY.
             * Processes with open file handles can cause rmSync to fail on first attempt;
             * a brief delay lets the OS release them after we killed processes above.
             */
            function removeDirectoryRobust(dirPath, label) {
                if (!fs.existsSync(dirPath)) return;

                const MAX_RETRIES = 3;
                const RETRY_DELAY_MS = 500;

                for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                    try {
                        fs.rmSync(dirPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
                        console.log(`   ✓ Removed ${label}: ${dirPath}`);
                        return;
                    } catch (e) {
                        const isRetryable = e.code === 'ENOTEMPTY' || e.code === 'EBUSY' || e.code === 'EPERM';
                        if (isRetryable && attempt < MAX_RETRIES) {
                            console.log(`   ⚠️  ${label} removal failed (${e.code}), retrying in ${RETRY_DELAY_MS}ms... (${attempt}/${MAX_RETRIES})`);
                            spawnSync('sleep', [String(RETRY_DELAY_MS / 1000)]);
                            continue;
                        }
                        // Last resort: try shell rm -rf which handles some cases fs.rmSync can't
                        try {
                            spawnSync('rm', ['-rf', dirPath], { stdio: 'ignore' }); // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
                            console.log(`   ✓ Removed ${label}: ${dirPath} (via shell fallback)`);
                            return;
                        } catch (_) {
                            console.error(`   ❌ Could not remove ${label}: ${dirPath} — ${e.message}`);
                            console.error(`      You may need to manually remove it and re-run seed-reset.`);
                        }
                    }
                }
            }

            // --- Phase 2: CLONE — single source of truth from seed repo ---
            // This is the only phase that can abort — if clone fails, there's nothing to provision.

            function clonePhase() {
                console.log('\n📦 Phase 2: Clone\n');

                // Ensure parent directory exists (handles the case where repo dir was the only
                // thing in a parent that was also removed somehow)
                if (!fs.existsSync(parentDir)) {
                    fs.mkdirSync(parentDir, { recursive: true });
                }

                try {
                    execSync(`git clone "${seedUrl}" "${repoPath}"`, { cwd: parentDir, stdio: 'pipe' });
                    console.log(`   ✓ Cloned from ${seedUrl}`);
                    if (workingRepoUrl) {
                        execSync(`git remote set-url origin "${workingRepoUrl}"`, { cwd: repoPath, stdio: 'pipe' });
                        console.log(`   ✓ Repointed origin to ${workingRepoUrl}`);
                    }
                    return true;
                } catch (e) {
                    console.error(`   ❌ Clone failed: ${e.message}`);
                    console.error(`   Cannot continue without a successful clone.`);
                    return false;
                }
            }

            // --- Phase 3: PROVISION — install agents, rebuild state, commit ---
            // Every step is non-fatal. A partial provision is better than no provision.

            async function provisionPhase() {
                console.log('\n🔧 Phase 3: Provision\n');

                const savedCwd = process.cwd();
                try {
                    process.chdir(repoPath);
                } catch (e) {
                    console.error(`   ❌ Could not chdir to ${repoPath}: ${e.message}`);
                    return;
                }

                try {
                    // 3a. Run aigon init to bootstrap workflow-core events and .aigon/ structure
                    try {
                        commands['init']([]);
                        console.log(`   ✓ Aigon initialized`);
                    } catch (e) {
                        console.log(`   ⚠️  aigon init failed: ${e.message}`);
                    }

                    // 3b. Rebuild manifests from spec folders (manifests are gitignored state)
                    try {
                        const manifests = rebuildSeedFeatureManifests(repoPath);
                        console.log(`   ✓ Rebuilt ${manifests.length} feature manifest(s)`);
                        // Bootstrap workflow-core snapshots so features don't show as "legacy" on the board
                        const { features: missingF, research: missingR } = findEntitiesMissingWorkflowState(repoPath);
                        const bootstrapped = bootstrapMissingWorkflowSnapshots(repoPath, missingF, 'feature')
                            + bootstrapMissingWorkflowSnapshots(repoPath, missingR, 'research');
                        if (bootstrapped > 0) {
                            console.log(`   ✓ Bootstrapped workflow state for ${bootstrapped} entit${bootstrapped === 1 ? 'y' : 'ies'}`);
                        }
                    } catch (e) {
                        console.log(`   ⚠️  Failed to rebuild manifests: ${e.message}`);
                    }

                    // 3c. Install all available agents
                    let cliVersion;
                    try {
                        const agentsToInstall = getAvailableAgents();
                        console.log(`   Installing agents: ${[...agentsToInstall].join(', ')}`);
                        await commands['install-agent']([...agentsToInstall]);
                        cliVersion = getAigonVersion();
                        if (cliVersion) setInstalledVersion(cliVersion);
                        console.log(`   ✓ Agents installed`);
                    } catch (e) {
                        console.log(`   ⚠️  Agent install failed: ${e.message}`);
                    }

                    // 3d. Pre-install dependencies to warm the npm/package manager cache
                    //     so worktree installs pull from local cache and are much faster.
                    //     node_modules is gitignored so this does not affect the commit.
                    try {
                        const pkgJson = path.join(repoPath, 'package.json');
                        if (fs.existsSync(pkgJson)) {
                            const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
                            const hasDeps = pkg.dependencies || pkg.devDependencies;
                            if (hasDeps) {
                                const npmResult = spawnSync('npm', ['install', '--prefer-offline'], {
                                    cwd: repoPath,
                                    stdio: 'pipe',
                                    timeout: 120000,
                                });
                                if (npmResult.status === 0) {
                                    console.log(`   ✓ Dependencies pre-installed (npm cache warmed)`);
                                } else {
                                    console.log(`   ⚠️  npm install failed (worktrees will install from registry)`);
                                }
                            }
                        }
                    } catch (e) {
                        console.log(`   ⚠️  Dependency pre-install skipped: ${e.message}`);
                    }

                    // 3e. Ensure local runtime files stay ignored via git exclude
                    // (uses local exclude instead of modifying .gitignore to avoid creating commits
                    //  for gitignore changes in a "reset to clean state" operation)
                    try {
                        const envGitignoreStatus = getEnvLocalGitignoreStatus(repoPath);
                        const localIgnoreEntries = [
                            '.aigon/state/',
                            '.aigon/locks/',
                            '.aigon/worktree.json',
                            '.aigon/.board-map.json',
                            'next-env.d.ts',
                            ...envGitignoreStatus.missingEntries,
                        ];
                        const localExclude = ensureLocalGitExclude(repoPath, localIgnoreEntries);
                        if (localExclude.addedEntries.length > 0) {
                            console.log(`   ✓ Updated local git exclude`);
                        }
                    } catch (e) {
                        console.log(`   ⚠️  Could not update local git exclude: ${e.message}`);
                    }

                    // 3e. Auto-commit so worktrees inherit current templates
                    try {
                        const statusOut = execSync('git status --porcelain', { cwd: repoPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
                        const hasChanges = statusOut.trim().length > 0;
                        if (!hasChanges) throw new Error('nothing to commit');
                        if (!gitAddPathsFromPorcelain(repoPath, statusOut)) throw new Error('nothing to commit');
                        execSync(
                            `git commit -m "chore: install Aigon v${cliVersion || 'latest'}"`,
                            { cwd: repoPath, stdio: 'pipe' }
                        );
                        console.log(`   ✓ Committed agent install (v${cliVersion || 'latest'})`);
                    } catch (_) {
                        // Nothing to commit (seed already had current artifacts) — that's fine
                    }

                    // 3f. Strip stale config keys from the freshly provisioned repo baseline.
                    try {
                        const removed = stripSeedResetStaleConfigKeys(path.join(repoPath, '.aigon', 'config.json'), ['pro']);
                        if (removed.length > 0) {
                            execSync('git add .aigon/config.json', { cwd: repoPath, stdio: 'pipe' });
                            execSync(
                                `git commit -m "chore: strip stale seed config"`,
                                { cwd: repoPath, stdio: 'pipe' }
                            );
                            console.log(`   ✓ Removed stale config key(s): ${removed.join(', ')}`);
                        }
                    } catch (e) {
                        console.log(`   ⚠️  Could not strip stale config: ${e.message}`);
                    }

                    // 3g. Force-push the fully provisioned baseline to the working remote.
                    if (workingRepoUrl) {
                        try {
                            execSync('git push --force origin HEAD:main', { cwd: repoPath, stdio: 'pipe' });
                            execSync('git fetch origin', { cwd: repoPath, stdio: 'pipe' });
                            const localHead = execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
                            const remoteHead = execSync('git rev-parse origin/main', { cwd: repoPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
                            if (localHead !== remoteHead) {
                                throw new Error(`HEAD ${localHead} != origin/main ${remoteHead}`);
                            }
                            console.log(`   ✓ Forced working remote baseline to ${localHead}`);
                        } catch (e) {
                            console.log(`   ⚠️  Could not push working remote baseline: ${e.message}`);
                        }
                    }

                    // 3h. Push the provisioned baseline back to the seed repo so future resets
                    //     start with current migration manifests and agent templates already committed.
                    try {
                        execSync(`git push --force ${JSON.stringify(seedUrl)} HEAD:main`, { cwd: repoPath, stdio: 'pipe' });
                        console.log(`   ✓ Updated seed repo with provisioned baseline`);
                    } catch (e) {
                        console.log(`   ⚠️  Could not update seed repo: ${e.message}`);
                    }
                } finally {
                    // Always restore cwd, even if provision partially failed
                    try { process.chdir(savedCwd); } catch (_) { /* best effort */ }
                }
            }

            // --- Execute ---

            const inventory = gatherInventory();
            printPlan(inventory);

            if (dryRun) {
                console.log('🔍 Dry run complete — no changes made.');
                return;
            }

            if (!force) {
                console.error('⚠️  This will destroy all work in the repo. Run with --force to confirm.');
                return;
            }

            nukePhase(inventory);

            const cloneOk = clonePhase();
            if (!cloneOk) return;

            await provisionPhase();

            console.log(`\n✅ ${repoName} reset from seed.`);
        },

        'trust-worktree': (args) => {
            const targetPath = args[0] || process.cwd();
            const resolvedPath = path.resolve(targetPath);
            if (!fs.existsSync(resolvedPath)) {
                console.error(`❌ Path does not exist: ${resolvedPath}`);
                return;
            }
            const agentRegistry = require('../agent-registry');
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
        },

    };

    return commands;
};

// Backward-compat wrapper
function createSetupCommands(overrides = {}) {
    const utils = require('../utils');
    const versionLib = require('../version');
    const specCrud = require('../spec-crud');
    const git = require('../git');
    const board = require('../board');
    const feedbackLib = require('../feedback');
    const validation = require('../validation');
    const stateMachine = require('../state-queries');

    const ctx = {
        utils: { ...utils, ...overrides },
        version: { ...versionLib, ...overrides },
        specCrud: { ...specCrud, ...overrides },
        git: { ...git, ...overrides },
        board: { ...board, ...overrides },
        feedback: { ...feedbackLib, ...overrides },
        validation: { ...validation, ...overrides },
        stateMachine,
    };
    const allCmds = module.exports(ctx);
    const names = ['init', 'install-agent', 'setup', 'global-setup', 'check-prerequisites', 'check-version', 'update', 'project-context', 'doctor', 'seed-reset', 'trust-worktree'];
    return Object.fromEntries(names.map(n => [n, allCmds[n]]).filter(([, h]) => typeof h === 'function'));
}

module.exports.createSetupCommands = createSetupCommands;
module.exports._test = {
    wrapAigonCommand,
    migrateAigonHookCommand,
    rebuildSeedFeatureManifests,
    findEntitiesMissingWorkflowState,
    bootstrapMissingWorkflowSnapshots,
    findSeedResetBaseline,
    normalizeGitHubRepoSlug,
    collectSeedResetRemoteUrls,
    parseSeedResetRemoteHeads,
    cleanupSeedResetRemoteBranches,
    closeSeedResetOpenPullRequests,
    stripSeedResetStaleConfigKeys,
    ensureEnvLocalGitignore,
    ensureLocalGitExclude,
    getInstalledVersionAt,
    getEnvLocalGitignoreStatus,
    getTrackedEnvLocalFiles,
    untrackFiles,
    ensurePreCommitHook,
    readHooksPath,
    isHooksPathConfigured,
    ensureHooksPathConfigured,
    PRE_COMMIT_HOOK_CONTENT,
};
