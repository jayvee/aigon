'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const agentRegistry = require('../../agent-registry');
const installManifestLib = require('../../install-manifest');
const worktreeCleanup = require('./worktree-cleanup');
const gitignoreAndHooks = require('./gitignore-and-hooks');

const { expandHomePath, listExistingAigonWorktrees } = worktreeCleanup;

const {
    SECURITY_HOOKS_PATH,
    wrapAigonCommand,
    migrateAigonHookCommand,
    ensureLocalGitExclude,
    getStandardLocalGitExcludeEntries,
    ensurePreCommitHook,
    ensureHooksPathConfigured,
    getEnvLocalGitignoreStatus,
    getTrackedEnvLocalFiles,
} = gitignoreAndHooks;

module.exports = function installAgentCommand(ctx, getCommand) {
    const u = ctx.utils;
    const versionLib = ctx.version;
    const {
        PATHS,
        SPECS_ROOT,
        MARKER_START,
        MARKER_END,
        COMMAND_ALIASES,
        COMMAND_ALIAS_REVERSE,
        showPortSummary,
        getActiveProfile,
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
        extractDescription,
        formatCommandOutput,
        getProfilePlaceholders,
        computeInstructionsConfigHash,
        computeAppliedDigest,
        computeAppliedDigestDetailed,
        readAppliedDigest,
        writeAppliedDigest,
        buildDriftSummary,
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
    } = versionLib;
    const { ensureBoardMapInGitignore } = ctx.board;

    return async (args) => {
            // Use new config-driven approach
            const availableAgents = getAvailableAgents();

            // --all expands to every available agent. Used by maintainers
            // (release prepublishOnly, audit cleanup) and by the version-bump
            // auto-reinstall in lib/template-drift.js.
            const allFlag = args.includes('--all');
            const positional = args.filter(a => !a.startsWith('--'));

            if (allFlag) {
                args = [...availableAgents];
            } else if (positional.length === 0) {
                const agentList = availableAgents.join('|');
                return console.error(`Usage: aigon install-agent <${agentList}> [${agentList}] ... | --all\nExample: aigon install-agent cc ag`);
            } else {
                args = positional;
            }

            // Build alias map dynamically from agent configs
            const agentMap = buildAgentAliasMap();

            const agents = args.map(a => agentMap[a.toLowerCase()]).filter(Boolean);
            if (agents.length === 0) {
                return console.error(`❌ No valid agents specified. Available: ${availableAgents.join(', ')}`);
            }

            const uniqueAgents = [...new Set(agents)];

            const deactivated = uniqueAgents.filter(id => !agentRegistry.isAgentLaunchable(id));
            if (deactivated.length > 0) {
                for (const id of deactivated) {
                    const msg = agentRegistry.formatDeactivatedAgentMessage(id) || `agent \`${id}\` is not launchable`;
                    console.error(`❌ Cannot install: ${msg}`);
                }
                return;
            }

            try {
                try {
                    const { runPendingMigrations } = require('../../migration');
                    await runPendingMigrations(process.cwd());
                } catch (e) {
                    console.warn(`⚠️  Migration check failed during install-agent: ${e.message}`);
                }

                // Load (or create) install manifest. Install/update is allowed to
                // refresh Aigon-managed files; uninstall remains the destructive
                // path that checks for external edits before deletion.
                const repoRoot = process.cwd();
                const manifestRead = installManifestLib.readManifestRecovering(repoRoot);
                let installManifest = manifestRead.manifest;
                if (manifestRead.recovered) {
                    console.warn(`⚠️  install-manifest.json was corrupted (invalid JSON) — backed up to ${path.relative(repoRoot, manifestRead.backupPath)} and regenerating.`);
                }
                const aigonVersion = getAigonVersion() || 'unknown';
                if (!installManifest) {
                    installManifest = installManifestLib.createEmptyManifest(aigonVersion);
                }

                // 1. Vendor aigon-owned docs into .aigon/docs/ (always).
                //    Iterates templates/docs/ so newly added template files are
                //    picked up automatically. The consumer's `docs/` folder is
                //    never touched (F421).
                const lightDirectives = require('../../profile-placeholders').resolveInstructionDirectives(
                    require('../../config').loadProjectConfig(process.cwd())?.instructions
                );
                const isLightRigor = lightDirectives.testing === 'skip' && lightDirectives.logging === 'skip';
                const { stripLightOptionalBlocks } = require('../../templates');
                const docsTemplateDir = path.join(u.TEMPLATES_ROOT, 'docs');
                if (fs.existsSync(docsTemplateDir)) {
                    const docFiles = fs.readdirSync(docsTemplateDir).filter(f => f.endsWith('.md'));
                    docFiles.forEach(file => {
                        const docRaw = readTemplate(`docs/${file}`);
                        const docContent = stripLightOptionalBlocks(docRaw, isLightRigor);
                        const docPath = path.join(process.cwd(), '.aigon', 'docs', file);
                        const docStatus = safeWriteWithStatus(docPath, docContent);
                        if (docStatus !== 'unchanged') {
                            console.log(`✅ ${docStatus.charAt(0).toUpperCase() + docStatus.slice(1)}: .aigon/docs/${file}`);
                        }
                        // Record all doc files in the manifest (not just changed ones) so the
                        // lockstep check always sees a complete inventory regardless of write status.
                        installManifestLib.recordFile(installManifest, docPath, repoRoot, aigonVersion);
                    });
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

                    // Record install in manifest.agents so drift detection
                    // (F502 layers 1+2) only warns about agents the user has
                    // actually installed.
                    installManifestLib.recordAgent(installManifest, config.id, aigonVersion);

                    console.log(`\n📦 Installing ${config.displayName || config.name} (${config.id})...`);

                    // Check if the agent CLI binary is in PATH
                    const cliBinary = config.cli && config.cli.command;
                    if (cliBinary) {
                        const { isBinaryAvailable: isBinAvail } = require('../../security');
                        if (!isBinAvail(cliBinary)) {
                            const hint = config.installHint || `Install ${cliBinary} and add it to your PATH`;
                            console.warn(`   ⚠️  '${cliBinary}' not found in PATH. Install it first:`);
                            console.warn(`      ${hint}`);
                            console.log(`   Continuing with config file installation...`);
                        }
                    }

                    // Create/update .aigon/docs/agents/<agent>.md from template (preserves user additions)
                    const agentDocPath = path.join(process.cwd(), '.aigon', 'docs', 'agents', config.agentFile);
                    const agentTemplateRaw = readTemplate(config.templatePath);
                    const { resolveAgentDocPlaceholders } = require('../../profile-placeholders');
                    const agentDocPlaceholders = resolveAgentDocPlaceholders(config, repoRoot);
                    // Process template with profile-aware placeholders, then strip light-rigor blocks
                    const agentTemplateProcessed = processTemplate(agentTemplateRaw, agentDocPlaceholders);
                    const agentTemplateContent = stripLightOptionalBlocks(agentTemplateProcessed, isLightRigor);
                    // Template already contains markers, extract content between them for upsert
                    const markerContentMatch = agentTemplateContent.match(new RegExp(`${MARKER_START}\\n([\\s\\S]*?)\\n${MARKER_END}`));
                    const agentContent = markerContentMatch ? markerContentMatch[1] : agentTemplateContent;
                    const agentAction = upsertMarkedContent(agentDocPath, agentContent);
                    if (agentAction !== 'unchanged') {
                        console.log(`   ✅ ${agentAction.charAt(0).toUpperCase() + agentAction.slice(1)}: .aigon/docs/agents/${config.agentFile}`);
                    }
                    // Record per-agent doc in manifest so F502 lockstep test
                    // sees it on a fresh install. Pre-F502 manifests had these
                    // entries via migration 2.61.0 only.
                    if (fs.existsSync(agentDocPath)) {
                        installManifestLib.recordFile(installManifest, agentDocPath, repoRoot, aigonVersion);
                    }

                    // Generate and install commands from generic templates
                    if (config.outputs && config.outputs.length > 0) {
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

                        // Merge profile-derived placeholders into config once (shared across all outputs)
                        const profilePlaceholders = getProfilePlaceholders({ forCommandTemplateInstall: true, repoPath: process.cwd() });
                        const mergedConfig = { ...config, placeholders: { ...config.placeholders, ...profilePlaceholders } };

                        const commandNames = resolveAgentCommands(mergedConfig);

                        for (const outputSpec of config.outputs) {
                            // Synthetic config so helpers that read agentConfig.output continue to work.
                            const outputConfig = { ...mergedConfig, output: outputSpec };

                            // Expand ~ to home directory for global commands
                            let cmdDir = outputSpec.commandDir;
                            if (cmdDir.startsWith('~')) {
                                cmdDir = cmdDir.replace('~', process.env.HOME || process.env.USERPROFILE);
                            } else {
                                cmdDir = path.join(process.cwd(), cmdDir);
                            }

                            const isSkillMd = outputSpec.format === 'skill-md';

                            let cmdChanges = { created: 0, updated: 0 };
                            const _cryptoF502 = require('crypto');
                            const _commandsTplDir = path.join(u.TEMPLATES_ROOT, 'generic', 'commands');
                            commandNames.forEach(cmdName => {
                                // Read generic template and process placeholders (includes profile-derived values)
                                const genericContent = readGenericTemplate(`commands/${cmdName}.md`, mergedConfig);
                                const description = extractDescription(genericContent);

                                // F502: snapshot upstream template sha so drift
                                // detection can do content-based (not mtime-based)
                                // comparison against the manifest entry.
                                const _tplPath = path.join(_commandsTplDir, `${cmdName}.md`);
                                let _tplSha = null, _tplRel = null;
                                try {
                                    const buf = fs.readFileSync(_tplPath);
                                    _tplSha = _cryptoF502.createHash('sha256').update(buf).digest('hex');
                                    _tplRel = path.relative(repoRoot, _tplPath).replace(/\\/g, '/');
                                } catch (_) { /* template missing — leave nulls */ }
                                const _tplOpts = _tplSha ? { templateSha: _tplSha, templatePath: _tplRel } : {};

                                if (isSkillMd) {
                                    // Codex skill layout: one directory per command containing SKILL.md.
                                    const skillName = `${outputSpec.commandFilePrefix}${cmdName}`;
                                    const skillDir = path.join(cmdDir, skillName);
                                    const skillContent = renderSkillMd({
                                        name: skillName,
                                        description,
                                        body: genericContent,
                                    });
                                    const skillFileName = outputSpec.skillFileName || 'SKILL.md';
                                    const skillFilePath = path.join(skillDir, skillFileName);
                                    const status = safeWriteWithStatus(skillFilePath, skillContent);
                                    if (status === 'created') cmdChanges.created++;
                                    else if (status === 'updated') cmdChanges.updated++;
                                    // Record unconditionally so templateSha
                                    // backfills even on 'unchanged' runs (F502).
                                    if (fs.existsSync(skillFilePath)) {
                                        installManifestLib.recordFile(installManifest, skillFilePath, repoRoot, aigonVersion, _tplOpts);
                                    }
                                    // No alias-skill generation: implicit invocation handles intent matching.
                                    return;
                                }

                                // Format output based on agent's output format
                                const outputContent = formatCommandOutput(genericContent, description, cmdName, outputConfig);

                                // Write to agent's command directory
                                const fileName = `${outputSpec.commandFilePrefix}${cmdName}${outputSpec.commandFileExtension}`;
                                const cmdFilePath = path.join(cmdDir, fileName);
                                const status = safeWriteWithStatus(cmdFilePath, outputContent);
                                if (status === 'created') cmdChanges.created++;
                                else if (status === 'updated') cmdChanges.updated++;
                                // Record unconditionally so templateSha
                                // backfills even on 'unchanged' runs (F502).
                                if (fs.existsSync(cmdFilePath)) {
                                    installManifestLib.recordFile(installManifest, cmdFilePath, repoRoot, aigonVersion, _tplOpts);
                                }

                                // Generate short alias files in parent directory for top-level access
                                // e.g., generated alias files live in the parent dir for top-level slash access.
                                const aliases = COMMAND_ALIAS_REVERSE[cmdName] || [];
                                const aliasDir = path.dirname(cmdDir);
                                aliases.forEach(alias => {
                                    const aliasDesc = `${description} (shortcut for ${cmdName})`;
                                    const aliasContent = formatCommandOutput(genericContent, aliasDesc, cmdName, outputConfig);
                                    const aliasFileName = `${outputSpec.commandFilePrefix}${alias}${outputSpec.commandFileExtension}`;
                                    const aliasFilePath = path.join(aliasDir, aliasFileName);
                                    const aliasStatus = safeWriteWithStatus(aliasFilePath, aliasContent);
                                    if (aliasStatus === 'created') cmdChanges.created++;
                                    else if (aliasStatus === 'updated') cmdChanges.updated++;
                                    if (fs.existsSync(aliasFilePath)) {
                                        installManifestLib.recordFile(installManifest, aliasFilePath, repoRoot, aigonVersion, _tplOpts);
                                    }
                                });
                            });

                            const removed = isSkillMd
                                ? removeDeprecatedSkillDirs(cmdDir, outputConfig)
                                : removeDeprecatedCommands(cmdDir, outputConfig);

                            // Clean up deprecated alias files in parent directory (flat layout only)
                            // Uses content-based detection: only removes files containing '(shortcut for '
                            const removedAliases = [];
                            if (!isSkillMd) {
                                const aliasParentDir = path.dirname(cmdDir);
                                const expectedAliasFiles = new Set(
                                    Object.keys(COMMAND_ALIASES).map(alias =>
                                        `${outputSpec.commandFilePrefix}${alias}${outputSpec.commandFileExtension}`
                                    )
                                );
                                if (fs.existsSync(aliasParentDir)) {
                                    for (const file of fs.readdirSync(aliasParentDir)) {
                                        if (!file.endsWith(outputSpec.commandFileExtension)) continue;
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

                            // Only report if there were actual changes
                            const totalChanges = cmdChanges.created + cmdChanges.updated + removed.length + removedAliases.length + migrated.length;
                            if (totalChanges > 0) {
                                if (isSkillMd) {
                                    const parts = [];
                                    if (cmdChanges.created > 0) parts.push(`${cmdChanges.created} created`);
                                    if (cmdChanges.updated > 0) parts.push(`${cmdChanges.updated} updated`);
                                    console.log(`   ✅ Skills: ${parts.join(', ') || 'synced'} → ${outputSpec.commandDir}/aigon-*/SKILL.md`);
                                } else if (outputSpec.global) {
                                    console.log(`   ✅ Installed global prompts: ${outputSpec.commandDir}`);
                                } else {
                                    const parts = [];
                                    if (cmdChanges.created > 0) parts.push(`${cmdChanges.created} created`);
                                    if (cmdChanges.updated > 0) parts.push(`${cmdChanges.updated} updated`);
                                    console.log(`   ✅ Installed prompts: ${outputSpec.commandDir} (${parts.join(', ') || 'synced'})`);
                                }
                                if (removed.length > 0) {
                                    console.log(`   🧹 Removed ${removed.length} deprecated ${isSkillMd ? 'skill' : 'command'}(s): ${removed.join(', ')}`);
                                }
                                if (migrated.length > 0) {
                                    console.log(`   🔄 Migrated: removed ${migrated.length} old flat command(s) from parent directory`);
                                }
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
                        const extrasSkillPath = path.join(process.cwd(), extras.skill.path);
                        const skillStatus = safeWriteWithStatus(extrasSkillPath, skillContent);
                        if (skillStatus !== 'unchanged') {
                            console.log(`   ✅ ${skillStatus.charAt(0).toUpperCase() + skillStatus.slice(1)}: ${extras.skill.path}`);
                            installManifestLib.recordFile(installManifest, extrasSkillPath, repoRoot, aigonVersion);
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

                    // Antigravity plugin bundle (hooks staged via agy plugin install)
                    if (extras.plugin && extras.plugin.enabled) {
                        const pluginTemplateDir = path.join(u.TEMPLATES_ROOT, extras.plugin.templateDir);
                        const stagingRel = extras.plugin.stagingPath || '.aigon/antigravity-plugin';
                        const stagingPath = path.join(process.cwd(), stagingRel);
                        if (fs.existsSync(pluginTemplateDir)) {
                            fs.mkdirSync(path.dirname(stagingPath), { recursive: true });
                            fs.cpSync(pluginTemplateDir, stagingPath, { recursive: true, force: true });
                            console.log(`   ✅ Staged Antigravity plugin → ${stagingRel}/`);
                            const walkPluginFiles = (dir) => {
                                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                                    const full = path.join(dir, entry.name);
                                    if (entry.isDirectory()) walkPluginFiles(full);
                                    else installManifestLib.recordFile(installManifest, full, repoRoot, aigonVersion);
                                }
                            };
                            walkPluginFiles(stagingPath);
                            const { isBinaryAvailable: isBinAvail } = require('../../security');
                            if (isBinAvail('agy')) {
                                const { spawnSync } = require('child_process');
                                const result = spawnSync('agy', ['plugin', 'install', stagingPath], {
                                    encoding: 'utf8',
                                    timeout: 60000,
                                });
                                if (result.status === 0) {
                                    console.log('   ✅ Installed Antigravity plugin via agy plugin install');
                                } else {
                                    const detail = (result.stderr || result.stdout || '').trim();
                                    console.warn(`   ⚠️  agy plugin install failed${detail ? `: ${detail}` : ''}`);
                                }
                            }
                        } else {
                            console.warn(`   ⚠️  Antigravity plugin template missing: ${extras.plugin.templateDir}`);
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
                            installManifestLib.recordFile(installManifest, rulesPath, repoRoot, aigonVersion);
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

                try {
                    ensureLocalGitExclude(repoRoot, getStandardLocalGitExcludeEntries(repoRoot));
                } catch (_) { /* best-effort */ }

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

                // Write applied-digest (content-based drift detection, F497) and legacy config-hash.
                try {
                    const detailed = computeAppliedDigestDetailed(process.cwd());
                    writeAppliedDigest(process.cwd(), detailed);
                    const worktreeMarker = path.join(process.cwd(), '.aigon', 'worktree.json');
                    if (!fs.existsSync(worktreeMarker)) {
                        const configHash = computeInstructionsConfigHash();
                        safeWrite(path.join(process.cwd(), '.aigon', 'config-hash'), configHash);
                    }
                } catch (e) {
                    // Non-fatal — best-effort
                }

                // Apply agent trust settings (e.g. disable Cursor workspace trust dialog)
                try {
                    const _agentRegistryTrust = require('../../agent-registry');
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

                // Write install manifest atomically. `install-agent --all` is
                // the release/prepublish lockstep path, so make it canonical:
                // rebuild from the installed tree and prune stale/deactivated
                // agent records instead of preserving local manifest history.
                if (allFlag) {
                    installManifest = installManifestLib.synthesizeManifestFromDisk(repoRoot, aigonVersion);
                    installManifest.agents = [...uniqueAgents].sort();
                    installManifest.agentInstalls = Object.fromEntries(
                        installManifest.agents.map(agentId => [agentId, {
                            version: aigonVersion,
                            installedAt: new Date().toISOString(),
                        }])
                    );
                } else {
                    installManifest.aigonVersion = aigonVersion;
                    installManifestLib.refreshExistingFiles(installManifest, repoRoot, aigonVersion);
                }
                try {
                    installManifestLib.writeManifest(repoRoot, installManifest);
                } catch (e) {
                    console.warn(`⚠️  Could not write install manifest: ${e.message}`);
                }

                // Invalidate the F502 drift cache so the next CLI invocation
                // recomputes from the fresh manifest.
                try {
                    require('../../template-drift').clearCache(repoRoot);
                } catch (_) { /* best-effort */ }

                // Git commit suggestion - only if there are actual changes
                try {
                    const installPaths = '.aigon/docs/ .agents/ .claude/ .cursor/ .codex/ .gemini/';
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
    };
};
