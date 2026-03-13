'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

const utils = require('../utils');

let _cachedCommands = null;

function createAllCommands(overrides = {}) {
    if (_cachedCommands && Object.keys(overrides).length === 0) return _cachedCommands;
    const scope = { ...utils, ...overrides };
    const { detectEditor, openInEditor, detectActiveAgentSession, printAgentContextWarning, normalizeMode, isSameProviderFamily, loadGlobalConfig, loadProfilePresetStrings, loadProjectConfig, saveProjectConfig, saveGlobalConfig, resolveConfigKeyAlias, getNestedValue, setNestedValue, parseConfigScope, getConfigValueWithProvenance, getEffectiveConfig, readBasePort, showPortSummary, sanitizeForDns, getAppId, isPortAvailable, allocatePort, isProxyAvailable, loadProxyRegistry, saveProxyRegistry, loadPortRegistry, savePortRegistry, registerPort, deregisterPort, scanPortsFromFilesystem, generateCaddyfile, reloadCaddy, registerDevServer, deregisterDevServer, gcDevServers, detectDevServerContext, getDevProxyUrl, getDevServerLogPath, spawnDevServer, waitForHealthy, openInBrowser, readConductorReposFromGlobalConfig, parseSimpleFrontMatter, normalizeDashboardStatus, parseFeatureSpecFileName, inferDashboardNextCommand, safeTmuxSessionExists, collectDashboardStatusData, escapeForHtmlScript, buildDashboardHtml, escapeAppleScriptString, captureDashboardScreenshot, writeRepoRegistry, readRadarMeta, writeRadarMeta, removeRadarMeta, isRadarAlive, sendMacNotification, requestRadarJson, renderRadarMenubarFromStatus, writeRadarLaunchdPlist, runRadarServiceDaemon, detectProjectProfile, getActiveProfile, getProfilePlaceholders, getAgentCliConfig, parseCliFlagTokens, getAgentLaunchFlagTokens, getModelProvenance, getWorktreeBase, findWorktrees, filterByFeatureId, buildAgentCommand, buildResearchAgentCommand, toUnpaddedId, buildTmuxSessionName, buildResearchTmuxSessionName, matchTmuxSessionByEntityId, assertTmuxAvailable, tmuxSessionExists, createDetachedTmuxSession, shellQuote, openTerminalAppWithCommand, ensureTmuxSessionForWorktree, openInWarpSplitPanes, closeWarpWindow, openSingleWorktree, addWorktreePermissions, removeWorktreePermissions, presetWorktreeTrust, removeWorktreeTrust, presetCodexTrust, parseHooksFile, getDefinedHooks, executeHook, runPreHook, runPostHook, slugify, parseCliOptions, getOptionValue, getOptionValues, normalizeFeedbackStatus, getFeedbackFolderFromStatus, normalizeFeedbackSeverity, normalizeTag, parseTagListValue, normalizeTagList, parseNumericArray, stripInlineYamlComment, splitInlineYamlArray, parseYamlScalar, parseFrontMatter, serializeYamlScalar, serializeFeedbackFrontMatter, escapeRegex, extractMarkdownSection, extractFeedbackSummary, normalizeFeedbackMetadata, buildFeedbackDocumentContent, readFeedbackDocument, collectFeedbackItems, tokenizeText, jaccardSimilarity, findDuplicateFeedbackCandidates, buildFeedbackTriageRecommendation, formatFeedbackFieldValue, getNextId, findFile, findUnprioritizedFile, moveFile, modifySpecFile, printNextSteps, printSpecInfo, printError, createSpecFile, setupWorktreeEnvironment, ensureAgentSessions, resolveDevServerUrl, organizeLogFiles, runGit, setTerminalTitle, safeWrite, safeWriteWithStatus, getAigonVersion, getInstalledVersion, setInstalledVersion, getChangelogEntriesSince, compareVersions, removeDeprecatedCommands, migrateOldFlatCommands, upsertMarkedContent, readTemplate, loadAgentConfig, getAvailableAgents, buildAgentAliasMap, processTemplate, readGenericTemplate, extractDescription, formatCommandOutput, getScaffoldContent, getRootFileContent, syncAgentsMdFile, collectBoardItems, getWorktreeInfo, getCurrentBranch, saveBoardMapping, loadBoardMapping, getBoardAction, displayBoardKanbanView, displayKanbanSection, displayBoardListView, displayListSection, ensureBoardMapInGitignore, formatTimestamp, parseRalphProgress, parseFeatureValidation, detectNodePackageManager, detectNodeTestCommand, detectValidationCommand, buildRalphPrompt, getCurrentHead, getGitStatusPorcelain, getChangedFilesInRange, getCommitSummariesInRange, ensureRalphCommit, runRalphAgentIteration, runRalphValidation, appendRalphProgressEntry, runRalphCommand, parseAcceptanceCriteria, classifyCriterion, getPackageJsonScripts, getProfileValidationCommands, evaluateAllSubjectiveCriteria, updateSpecCheckboxes, runSmartValidation, formatCriteriaResults, runFeatureValidateCommand, resolveDeployCommand, runDeployCommand, PROVIDER_FAMILIES, SPECS_ROOT, TEMPLATES_ROOT, CLAUDE_SETTINGS_PATH, HOOKS_FILE_PATH, PROJECT_CONFIG_PATH, GLOBAL_CONFIG_DIR, GLOBAL_CONFIG_PATH, RADAR_DEFAULT_PORT, RADAR_PID_FILE, RADAR_LOG_FILE, RADAR_META_FILE, DEFAULT_GLOBAL_CONFIG, PROFILE_PRESET_STRING_FILES, PROFILE_PRESETS, DEV_PROXY_DIR, DEV_PROXY_REGISTRY, DEV_PROXY_CADDYFILE, DEV_PROXY_LOGS_DIR, PORT_REGISTRY_PATH, PATHS, FEEDBACK_STATUS_TO_FOLDER, FEEDBACK_FOLDER_TO_STATUS, FEEDBACK_STATUS_FLAG_TO_FOLDER, FEEDBACK_ACTION_TO_STATUS, FEEDBACK_DEFAULT_LIST_FOLDERS, VERSION_FILE, MARKER_START, MARKER_END, COMMAND_REGISTRY, COMMAND_ALIASES, COMMAND_ALIAS_REVERSE, COMMAND_ARG_HINTS, COMMANDS_DISABLE_MODEL_INVOCATION, AGENT_CONFIGS } = scope;

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
        
        console.log("✅ ./docs/specs directory structure created.");
        showPortSummary();

        // Auto-register in global port registry
        const initProfile = getActiveProfile();
        if (initProfile.devServer.enabled) {
            const portResult = readBasePort();
            if (portResult) {
                registerPort(path.basename(process.cwd()), portResult.port, process.cwd());
            }
        }
    },
    'feature-create': (args) => {
        const name = args[0];
        createSpecFile({
            input: name,
            usage: 'aigon feature-create <name>',
            example: 'aigon feature-create dark-mode',
            inboxDir: path.join(PATHS.features.root, '01-inbox'),
            existsLabel: 'Feature',
            build: (value) => {
                const slug = slugify(value);
                const filename = `feature-${slug}.md`;
                const filePath = path.join(PATHS.features.root, '01-inbox', filename);
                const template = readTemplate('specs/feature-template.md');
                return {
                    filename,
                    filePath,
                    content: template.replace(/\{\{NAME\}\}/g, value),
                    nextMessage: `📝 Edit the spec, then prioritise it using command: feature-prioritise ${slug}`
                };
            }
        });
    },
    'research-create': (args) => {
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
    'feedback-create': (args) => {
        const title = args[0];
        const created = createSpecFile({
            input: title,
            usage: 'aigon feedback-create <title>',
            example: 'aigon feedback-create "Login fails on Safari"',
            inboxDir: path.join(PATHS.feedback.root, FEEDBACK_STATUS_TO_FOLDER['inbox']),
            existsLabel: 'Feedback',
            build: (value) => {
                const nextId = getNextId(PATHS.feedback);
                const slug = slugify(value);
                const filename = `feedback-${nextId}-${slug}.md`;
                const filePath = path.join(PATHS.feedback.root, FEEDBACK_STATUS_TO_FOLDER['inbox'], filename);
                const projectTemplatePath = path.join(SPECS_ROOT, 'templates', 'feedback-template.md');
                const template = fs.existsSync(projectTemplatePath)
                    ? fs.readFileSync(projectTemplatePath, 'utf8')
                    : readTemplate('specs/feedback-template.md');
                const parsedTemplate = parseFrontMatter(template);

                const metadata = normalizeFeedbackMetadata(parsedTemplate.data, {
                    id: nextId,
                    title: value,
                    status: 'inbox',
                    type: 'bug',
                    reporter: { name: '', identifier: '' },
                    source: { channel: '', reference: '' }
                });
                metadata.id = nextId;
                metadata.title = value;
                metadata.status = 'inbox';

                return {
                    filename,
                    filePath,
                    content: buildFeedbackDocumentContent(metadata, parsedTemplate.body),
                    nextMessage: `📝 Next: fill in summary/evidence, then triage with: aigon feedback-triage ${nextId}`
                };
            }
        });
        if (!created) return;
    },
    'feedback-list': (args) => {
        const options = parseCliOptions(args);
        const includeAll = options.all !== undefined;

        const explicitStatusFlags = Object.keys(FEEDBACK_STATUS_FLAG_TO_FOLDER)
            .filter(flag => options[flag] !== undefined);
        const targetFolders = includeAll
            ? PATHS.feedback.folders
            : explicitStatusFlags.length > 0
                ? explicitStatusFlags.map(flag => FEEDBACK_STATUS_FLAG_TO_FOLDER[flag])
                : FEEDBACK_DEFAULT_LIST_FOLDERS;

        const typeFilterRaw = getOptionValue(options, 'type');
        const typeFilter = typeFilterRaw ? String(typeFilterRaw).trim().toLowerCase() : null;
        const severityFilter = normalizeFeedbackSeverity(getOptionValue(options, 'severity'));

        const tagFilters = [...new Set([
            ...normalizeTagList(getOptionValue(options, 'tags')),
            ...normalizeTagList(options.tag !== undefined ? getOptionValues(options, 'tag') : [])
        ])];

        const items = collectFeedbackItems(targetFolders).filter(item => {
            const itemType = String(item.metadata.type || '').toLowerCase();
            const itemSeverity = normalizeFeedbackSeverity(item.metadata.severity);
            const itemTags = normalizeTagList(item.metadata.tags);

            if (typeFilter && itemType !== typeFilter) return false;
            if (severityFilter && itemSeverity !== severityFilter) return false;
            if (tagFilters.length > 0 && !tagFilters.every(tag => itemTags.includes(tag))) return false;
            return true;
        });

        const filterParts = [];
        if (includeAll) {
            filterParts.push('status=all');
        } else if (explicitStatusFlags.length > 0) {
            filterParts.push(`status=${explicitStatusFlags.join(',')}`);
        } else {
            filterParts.push('status=inbox,triaged,actionable');
        }
        if (typeFilter) filterParts.push(`type=${typeFilter}`);
        if (severityFilter) filterParts.push(`severity=${severityFilter}`);
        if (tagFilters.length > 0) filterParts.push(`tag=${tagFilters.join(',')}`);

        if (items.length === 0) {
            console.log('\nNo feedback items matched the current filters.');
            console.log(`   Filters: ${filterParts.join(' | ')}`);
            return;
        }

        console.log(`\n📬 Feedback items (${items.length})`);
        console.log(`   Filters: ${filterParts.join(' | ')}`);

        items.forEach(item => {
            const idLabel = item.metadata.id > 0 ? `#${item.metadata.id}` : '#?';
            const typeLabel = item.metadata.type || 'unknown';
            const severityLabel = item.metadata.severity || '-';
            const tagsLabel = item.metadata.tags && item.metadata.tags.length > 0
                ? item.metadata.tags.join(', ')
                : '-';
            const relPath = `./${path.relative(process.cwd(), item.fullPath)}`;

            console.log(`\n- ${idLabel} [${item.metadata.status}] ${item.metadata.title}`);
            console.log(`  type=${typeLabel}  severity=${severityLabel}  tags=${tagsLabel}`);
            if (item.metadata.duplicate_of) {
                console.log(`  duplicate_of=#${item.metadata.duplicate_of}`);
            }
            console.log(`  path=${relPath}`);
        });
    },
    'feedback-triage': (args) => {
        const id = args[0];
        if (!id) {
            return console.error(
                "Usage: aigon feedback-triage <ID> [--type <type>] [--severity <severity|none>] [--tags <csv|none>] [--tag <tag>] [--status <status>] [--duplicate-of <ID|none>] [--action <keep|mark-duplicate|promote-feature|promote-research|wont-fix>] [--apply] [--yes]"
            );
        }

        const options = parseCliOptions(args.slice(1));
        const found = findFile(PATHS.feedback, id, PATHS.feedback.folders);
        if (!found) return console.error(`❌ Could not find feedback "${id}" in docs/specs/feedback/.`);

        const item = readFeedbackDocument(found);
        const allItems = collectFeedbackItems(PATHS.feedback.folders);
        const duplicateCandidates = findDuplicateFeedbackCandidates(item, allItems, 5);

        const proposed = JSON.parse(JSON.stringify(item.metadata));

        const typeOption = getOptionValue(options, 'type');
        if (typeOption !== undefined) {
            const normalizedType = String(typeOption).trim().toLowerCase();
            if (!normalizedType) {
                return console.error('❌ --type cannot be empty.');
            }
            proposed.type = normalizedType;
        }

        const severityOption = getOptionValue(options, 'severity');
        if (severityOption !== undefined) {
            const normalizedSeverity = normalizeFeedbackSeverity(severityOption);
            if (normalizedSeverity) {
                proposed.severity = normalizedSeverity;
            } else {
                delete proposed.severity;
            }
        }

        let clearTags = false;
        const collectedTags = [];
        if (options.tags !== undefined) {
            const tags = parseTagListValue(getOptionValue(options, 'tags'));
            if (Array.isArray(tags) && tags.length === 0) clearTags = true;
            if (Array.isArray(tags) && tags.length > 0) collectedTags.push(...tags);
        }
        if (options.tag !== undefined) {
            const tags = parseTagListValue(getOptionValues(options, 'tag'));
            if (Array.isArray(tags) && tags.length === 0) clearTags = true;
            if (Array.isArray(tags) && tags.length > 0) collectedTags.push(...tags);
        }
        if (options.tags !== undefined || options.tag !== undefined) {
            if (clearTags) {
                delete proposed.tags;
            } else {
                const uniqueTags = [...new Set(collectedTags)];
                if (uniqueTags.length > 0) {
                    proposed.tags = uniqueTags;
                } else {
                    delete proposed.tags;
                }
            }
        }

        const duplicateOption = getOptionValue(options, 'duplicate-of');
        if (duplicateOption !== undefined) {
            const duplicateText = String(duplicateOption).trim().toLowerCase();
            if (duplicateText === 'none' || duplicateText === 'null') {
                delete proposed.duplicate_of;
            } else {
                const duplicateId = parseInt(duplicateText, 10);
                if (!Number.isFinite(duplicateId) || duplicateId <= 0) {
                    return console.error('❌ --duplicate-of must be a positive numeric ID or "none".');
                }
                if (duplicateId === proposed.id) {
                    return console.error('❌ --duplicate-of cannot reference the same feedback ID.');
                }
                proposed.duplicate_of = duplicateId;
            }
        }

        const statusRaw = getOptionValue(options, 'status');
        const statusOption = statusRaw !== undefined ? normalizeFeedbackStatus(statusRaw) : null;
        if (statusRaw !== undefined && !statusOption) {
            return console.error('❌ Invalid --status. Use: inbox, triaged, actionable, done, wont-fix, duplicate');
        }

        const actionAliases = {
            'keep': 'keep',
            'mark-duplicate': 'mark-duplicate',
            'mark_duplicate': 'mark-duplicate',
            'duplicate': 'duplicate',
            'promote-feature': 'promote-feature',
            'promote_feature': 'promote-feature',
            'promote-research': 'promote-research',
            'promote_research': 'promote-research',
            'wont-fix': 'wont-fix',
            'wontfix': 'wont-fix'
        };
        const actionRaw = getOptionValue(options, 'action');
        const actionOption = actionRaw !== undefined
            ? actionAliases[String(actionRaw).trim().toLowerCase()]
            : null;
        if (actionRaw !== undefined && !actionOption) {
            return console.error('❌ Invalid --action. Use: keep, mark-duplicate, promote-feature, promote-research, wont-fix');
        }

        let nextStatus = statusOption;
        if (!nextStatus && actionOption) {
            nextStatus = FEEDBACK_ACTION_TO_STATUS[actionOption];
        }
        if (!nextStatus) {
            nextStatus = item.metadata.status === 'inbox' ? 'triaged' : (item.metadata.status || 'triaged');
        }
        proposed.status = nextStatus;

        if (proposed.duplicate_of && statusRaw === undefined && actionRaw === undefined) {
            proposed.status = 'duplicate';
        }
        if (proposed.status === 'duplicate' && !proposed.duplicate_of && duplicateCandidates.length > 0) {
            proposed.duplicate_of = duplicateCandidates[0].id;
        }
        if (proposed.status !== 'duplicate') {
            delete proposed.duplicate_of;
        }

        const recommendation = buildFeedbackTriageRecommendation(proposed, duplicateCandidates);
        const targetFolder = getFeedbackFolderFromStatus(proposed.status) || found.folder;

        const changedFields = [];
        const trackedFields = ['type', 'severity', 'status', 'duplicate_of'];
        trackedFields.forEach(field => {
            const currentValue = item.metadata[field];
            const nextValue = proposed[field];
            if (JSON.stringify(currentValue) !== JSON.stringify(nextValue)) {
                changedFields.push(`${field}: ${formatFeedbackFieldValue(currentValue)} -> ${formatFeedbackFieldValue(nextValue)}`);
            }
        });
        const currentTags = normalizeTagList(item.metadata.tags);
        const nextTags = normalizeTagList(proposed.tags);
        if (JSON.stringify(currentTags) !== JSON.stringify(nextTags)) {
            changedFields.push(`tags: ${formatFeedbackFieldValue(currentTags)} -> ${formatFeedbackFieldValue(nextTags)}`);
        }
        if (found.folder !== targetFolder) {
            changedFields.push(`folder: ${found.folder} -> ${targetFolder}`);
        }

        console.log(`\n📋 Feedback #${item.metadata.id}: ${item.metadata.title}`);
        console.log(`   Path: ./${path.relative(process.cwd(), found.fullPath)}`);
        console.log(`   Current: status=${item.metadata.status}, type=${item.metadata.type}, severity=${item.metadata.severity || 'unset'}, tags=${formatFeedbackFieldValue(item.metadata.tags)}`);
        console.log(`   Proposed: status=${proposed.status}, type=${proposed.type}, severity=${proposed.severity || 'unset'}, tags=${formatFeedbackFieldValue(proposed.tags)}`);
        if (proposed.duplicate_of) {
            console.log(`   Proposed duplicate_of: #${proposed.duplicate_of}`);
        }

        if (duplicateCandidates.length > 0) {
            console.log('\n🔎 Duplicate candidates:');
            duplicateCandidates.forEach(candidate => {
                console.log(`   #${candidate.id} (${Math.round(candidate.score * 100)}%) [${candidate.status}] ${candidate.title}`);
            });
        } else {
            console.log('\n🔎 Duplicate candidates: none found');
        }

        console.log(`\n🤖 Suggested next action: ${recommendation.action}`);
        console.log(`   Reason: ${recommendation.reason}`);

        if (changedFields.length === 0) {
            console.log('\nℹ️  No metadata changes are proposed.');
        } else {
            console.log('\n🛠️  Proposed changes:');
            changedFields.forEach(change => console.log(`   - ${change}`));
        }

        const applyRequested = options.apply !== undefined;
        const confirmed = options.yes !== undefined;
        const replayArgs = args
            .slice(1)
            .filter(arg => arg !== '--apply' && arg !== '--yes');

        if (!applyRequested) {
            console.log('\n🔒 Preview only. No changes written.');
            console.log(`   To apply: aigon feedback-triage ${id}${replayArgs.length ? ` ${replayArgs.join(' ')}` : ''} --apply --yes`);
            return;
        }

        if (!confirmed) {
            console.log('\n⚠️  Confirmation required. Re-run with --yes to apply these changes.');
            return;
        }

        if (proposed.status === 'duplicate' && !proposed.duplicate_of) {
            return console.error('❌ Duplicate status requires duplicate_of. Pass --duplicate-of <ID>.');
        }

        if (changedFields.length === 0) {
            console.log('\n✅ Nothing to apply.');
            return;
        }

        modifySpecFile(found.fullPath, ({ body }) => buildFeedbackDocumentContent(proposed, body));

        if (targetFolder !== found.folder) {
            moveFile(found, targetFolder);
        } else {
            console.log(`✅ Updated: ./${path.relative(process.cwd(), found.fullPath)}`);
        }

        console.log(`✅ Applied triage for feedback #${proposed.id}.`);
    },
    'research-prioritise': (args) => {
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
        // Also handles files without the prefix (e.g. topic-name.md -> research-55-topic-name.md)
        const prefix = PATHS.research.prefix;
        const baseName = found.file.replace(/\.md$/, '').replace(new RegExp(`^${prefix}-`), '');
        const newName = `${prefix}-${paddedId}-${baseName}.md`;
        moveFile(found, '02-backlog', newName);
        console.log(`📋 Assigned ID: ${paddedId}`);
    },
    'research-setup': (args) => {
        const id = args[0];
        const agentIds = args.slice(1);
        const mode = agentIds.length > 0 ? 'fleet' : 'drive';

        if (!id) {
            return console.error("Usage: aigon research-setup <ID> [agents...]\n\nExamples:\n  aigon research-setup 05              # Drive mode\n  aigon research-setup 05 cc gg        # Fleet mode");
        }

        // Find in backlog or in-progress (may already be started)
        let found = findFile(PATHS.research, id, ['02-backlog', '03-in-progress']);
        if (!found) return console.error(`❌ Could not find research "${id}" in backlog or in-progress.`);

        // Extract research name from filename
        const match = found.file.match(/^research-(\d+)-(.*)\.md$/);
        const researchNum = match ? match[1] : id;
        const researchName = match ? match[2] : 'research';

        // Move to in-progress if in backlog
        if (found.folder === '02-backlog') {
            found = moveFile(found, '03-in-progress');
        } else {
            console.log(`ℹ️  Research already in progress: ${found.file}`);
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
            console.log(`\n💡 Next steps:`);
            console.log(`   Option 1: Open all agents side-by-side:`);
            console.log(`     aigon research-open ${researchNum}`);
            console.log(`\n   Option 2: Run each agent individually:`);
            const firstAgent = agentIds[0];
            const firstAgentConfig = loadAgentConfig(firstAgent);
            const cmdPrefix = firstAgentConfig?.placeholders?.CMD_PREFIX || '/aigon:';
            console.log(`     [Open each agent terminal] ${cmdPrefix}research-do ${researchNum}`);
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
        if (!id) return console.error("Usage: aigon research-do <ID>\n\nRun this after 'aigon research-setup <ID>'\n\nExamples:\n  aigon research-do 05     # In Drive mode\n  aigon research-do 05     # In Fleet mode (writes to your findings file)");

        // Find the research topic
        let found = findFile(PATHS.research, id, ['03-in-progress']);
        if (!found) return printError('research', id, `Run 'aigon research-setup ${id}' first.`);

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
        const id = args[0];
        printAgentContextWarning('research-synthesize', id);
    },
    'research-close': (args) => {
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

        // Move to done (both modes, or arena with --complete)
        moveFile(found, '04-done');

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
            return console.error(`❌ Findings file not found: research-${researchNum}-${agentId}-findings.md\n\nRun 'aigon research-setup ${researchNum} ${agentId}' first.`);
        }

        let content = fs.readFileSync(findingsFile, 'utf8');
        const nowIso = new Date().toISOString();
        const newFrontMatter = `---\nstatus: submitted\nupdated: ${nowIso}\n---\n`;

        if (content.startsWith('---\n')) {
            content = content.replace(/^---\n[\s\S]*?\n---\n/, newFrontMatter);
        } else {
            content = newFrontMatter + '\n' + content;
        }

        fs.writeFileSync(findingsFile, content);
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
            return console.error(`❌ Could not find research "${id}" in progress.\n\nRun 'aigon research-setup ${id} [agents...]' first.`);
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
            return console.error(`❌ Research ${paddedId} is not in Fleet mode.\n\nTo start Fleet research:\n  aigon research-setup ${paddedId} cc gg cx\n\nFor Drive research, open a terminal manually and run:\n  /aigon:research-do ${paddedId}`);
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
    'feature-prioritise': (args) => {
        let name = args[0];
        if (!name) return console.error("Usage: aigon feature-prioritise <name or letter>");

        // Check if argument is a single letter (from board mapping)
        if (name.length === 1 && name >= 'a' && name <= 'z') {
            const mapping = loadBoardMapping();
            if (mapping && mapping.features[name]) {
                const mappedName = mapping.features[name];
                console.log(`📍 Letter '${name}' maps to: ${mappedName}`);
                name = mappedName;
            } else {
                return console.error(`❌ Letter '${name}' not found in board mapping. Run 'aigon board' first.`);
            }
        }

        const found = findUnprioritizedFile(PATHS.features, name);
        if (!found) return printError('unprioritized feature', name, 'Run `aigon feature-create <name>` first.');
        const nextId = getNextId(PATHS.features);
        const paddedId = String(nextId).padStart(2, '0');
        // Transform: feature-dark-mode.md -> feature-55-dark-mode.md
        // Also handles files without the prefix (e.g. dark-mode.md -> feature-55-dark-mode.md)
        const prefix = PATHS.features.prefix;
        const baseName = found.file.replace(/\.md$/, '').replace(new RegExp(`^${prefix}-`), '');
        const newName = `${prefix}-${paddedId}-${baseName}.md`;
        moveFile(found, '02-backlog', newName);

        // Commit the prioritisation so it's available in worktrees
        try {
            runGit(`git add docs/specs/features/`);
            runGit(`git commit -m "chore: prioritise feature ${paddedId} - move to backlog"`);
            console.log(`📝 Committed feature prioritisation`);
        } catch (e) {
            console.warn(`⚠️  Could not commit: ${e.message}`);
        }

        console.log(`📋 Assigned ID: ${paddedId}`);
        printNextSteps([
            `Drive (branch):   aigon feature-setup ${paddedId}`,
            `Drive (worktree): aigon feature-setup ${paddedId} <agent>`,
            `Fleet:            aigon feature-setup ${paddedId} <agent1> <agent2> [agent3]`
        ]);
    },
    'feature-now': (args) => {
        const name = args.join(' ').trim();
        if (!name) return console.error("Usage: aigon feature-now <name>\nFast-track: create + prioritise + setup in one step (Drive mode)\nExample: aigon feature-now dark-mode");

        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

        // Check for existing feature with same slug
        const existing = findFile(PATHS.features, slug);
        if (existing) {
            return console.error(`❌ Feature already exists: ${existing.file} (in ${existing.folder})`);
        }

        // Assign ID
        const nextId = getNextId(PATHS.features);
        const paddedId = String(nextId).padStart(2, '0');
        const filename = `feature-${paddedId}-${slug}.md`;

        // Run pre-hook
        const hookContext = {
            featureId: paddedId,
            featureName: slug,
            mode: 'drive',
            agents: []
        };
        if (!runPreHook('feature-now', hookContext)) {
            return;
        }

        // Ensure in-progress directory exists
        const inProgressDir = path.join(PATHS.features.root, '03-in-progress');
        if (!fs.existsSync(inProgressDir)) {
            fs.mkdirSync(inProgressDir, { recursive: true });
        }

        // Create spec directly in 03-in-progress
        const template = readTemplate('specs/feature-template.md');
        const content = template.replace(/\{\{NAME\}\}/g, name);
        const specPath = path.join(inProgressDir, filename);
        fs.writeFileSync(specPath, content);
        console.log(`✅ Created spec: ./docs/specs/features/03-in-progress/${filename}`);

        // Create branch
        const branchName = `feature-${paddedId}-${slug}`;
        try {
            runGit(`git checkout -b ${branchName}`);
            console.log(`🌿 Created branch: ${branchName}`);
        } catch (e) {
            try {
                runGit(`git checkout ${branchName}`);
                console.log(`🌿 Switched to branch: ${branchName}`);
            } catch (e2) {
                console.error(`❌ Failed to create/switch branch: ${e2.message}`);
                return;
            }
        }

        // Create log file
        const logsDir = path.join(PATHS.features.root, 'logs');
        if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
        const logName = `feature-${paddedId}-${slug}-log.md`;
        const logPath = path.join(logsDir, logName);
        if (!fs.existsSync(logPath)) {
            const logTemplate = `# Implementation Log: Feature ${paddedId} - ${slug}\n\n## Plan\n\n## Progress\n\n## Decisions\n`;
            fs.writeFileSync(logPath, logTemplate);
            console.log(`📝 Log: ./docs/specs/features/logs/${logName}`);
        }

        // Single atomic commit
        try {
            runGit(`git add docs/specs/features/`);
            runGit(`git commit -m "chore: create and start feature ${paddedId} - ${slug}"`);
            console.log(`📝 Committed feature creation and setup`);
        } catch (e) {
            console.warn(`⚠️  Could not commit: ${e.message}`);
        }

        // Run post-hook
        runPostHook('feature-now', hookContext);

        console.log(`\n🚗 Feature ${paddedId} ready for implementation!`);
        console.log(`   Spec: ./docs/specs/features/03-in-progress/${filename}`);
        console.log(`   Log:  ./docs/specs/features/logs/${logName}`);
        console.log(`   Branch: ${branchName}`);
        console.log(`\n📝 Next: Write the spec, then implement.`);
        console.log(`   When done: aigon feature-close ${paddedId}`);
    },
    'feature-setup': (args) => {
        const name = args[0];
        const agentIds = args.slice(1);
        const mode = agentIds.length > 0 ? 'fleet' : 'drive';

        if (!name) {
            return console.error("Usage: aigon feature-setup <ID> [agents...]\n\nExamples:\n  aigon feature-setup 55              # Drive mode (branch)\n  aigon feature-setup 55 cc           # Drive mode (worktree, for parallel development)\n  aigon feature-setup 55 cc gg cx cu  # Fleet mode (multiple agents compete)");
        }

        // Find the feature first to get context for hooks
        let found = findFile(PATHS.features, name, ['02-backlog', '03-in-progress']);
        if (!found) return console.error(`❌ Could not find feature "${name}" in backlog or in-progress.`);

        const preMatch = found.file.match(/^feature-(\d+)-(.*)\.md$/);
        const featureId = preMatch ? preMatch[1] : name;
        const featureName = preMatch ? preMatch[2] : '';

        // Run pre-hook (can abort the command)
        const hookContext = {
            featureId,
            featureName,
            mode,
            agents: agentIds
        };
        if (!runPreHook('feature-setup', hookContext)) {
            return;
        }

        // Re-find and move spec to in-progress
        found = findFile(PATHS.features, name, ['02-backlog']);
        let movedFromBacklog = false;
        if (found) {
            moveFile(found, '03-in-progress');
            movedFromBacklog = true;
            found = findFile(PATHS.features, name, ['03-in-progress']);
        } else {
            found = findFile(PATHS.features, name, ['03-in-progress']);
            if (!found) return console.error(`❌ Could not find feature "${name}" in backlog or in-progress.`);
        }

        const match = found.file.match(/^feature-(\d+)-(.*)\.md$/);
        if (!match) return console.warn("⚠️  Could not parse filename for branch creation.");
        const [_, num, desc] = match;

        // Commit the spec move first (important for worktrees)
        if (movedFromBacklog) {
            try {
                runGit(`git add docs/specs/features/`);
                runGit(`git commit -m "chore: start feature ${num} - move spec to in-progress"`);
                console.log(`📝 Committed spec move to in-progress`);
            } catch (e) {
                if (mode !== 'drive') {
                    console.error(`❌ Could not commit spec move: ${e.message}`);
                    console.error(`   Worktrees require the spec move to be committed before creation.`);
                    console.error(`   Fix any uncommitted changes and try again.`);
                    return;
                }
                console.warn(`⚠️  Could not commit spec move: ${e.message}`);
            }
        }

        // Create log directory
        const logsDir = path.join(PATHS.features.root, 'logs');
        if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

        if (mode === 'drive') {
            // Drive mode: Create branch
            const branchName = `feature-${num}-${desc}`;
            try {
                runGit(`git checkout -b ${branchName}`);
                console.log(`🌿 Created branch: ${branchName}`);
            } catch (e) {
                // Branch may already exist
                try {
                    runGit(`git checkout ${branchName}`);
                    console.log(`🌿 Switched to branch: ${branchName}`);
                } catch (e2) {
                    console.error(`❌ Failed to create/switch branch: ${e2.message}`);
                    return;
                }
            }

            // Create log file
            const logName = `feature-${num}-${desc}-log.md`;
            const logPath = path.join(logsDir, logName);
            if (!fs.existsSync(logPath)) {
                const nowIso = new Date().toISOString();
                const template = `---\nstatus: implementing\nupdated: ${nowIso}\n---\n\n# Implementation Log: Feature ${num} - ${desc}\n\n## Plan\n\n## Progress\n\n## Decisions\n`;
                fs.writeFileSync(logPath, template);
                console.log(`📝 Log: ./docs/specs/features/logs/${logName}`);
            }

            console.log(`\n🚗 Drive mode. Ready to implement in current directory.`);
            console.log(`   When done: aigon feature-close ${num}`);
        } else {
            // Fleet/worktree mode: Create worktrees
            const wtBase = getWorktreeBase();
            if (!fs.existsSync(wtBase)) {
                fs.mkdirSync(wtBase, { recursive: true });
            }
            const effectiveConfig = getEffectiveConfig();
            const terminalPreference = effectiveConfig.terminal || 'warp';
            const useTmux = terminalPreference === 'tmux';
            if (useTmux) {
                try {
                    assertTmuxAvailable();
                } catch (e) {
                    console.error(`❌ ${e.message}`);
                    console.error(`   Install tmux: brew install tmux`);
                    return;
                }
            }

            const profile = getActiveProfile();
            if (profile.devServer.enabled && !readBasePort()) {
                console.warn(`\n⚠️  No PORT found in .env.local or .env — using default ports`);
                console.warn(`   💡 Add PORT=<number> to .env.local to avoid clashes with other projects`);
            }

            // Auto-register in global port registry
            if (profile.devServer.enabled) {
                const portResult = readBasePort();
                if (portResult) {
                    registerPort(path.basename(process.cwd()), portResult.port, process.cwd());
                }
            }

            const createdWorktrees = [];
            agentIds.forEach(agentId => {
                const branchName = `feature-${num}-${agentId}-${desc}`;
                const worktreePath = `${wtBase}/feature-${num}-${agentId}-${desc}`;

                if (fs.existsSync(worktreePath)) {
                    console.warn(`⚠️  Worktree path ${worktreePath} already exists. Skipping.`);
                    if (useTmux) {
                        try {
                            const wtConfig = {
                                path: worktreePath,
                                featureId: num,
                                agent: agentId
                            };
                            const agentCommand = buildAgentCommand(wtConfig);
                            const { sessionName, created } = ensureTmuxSessionForWorktree(wtConfig, agentCommand);
                            console.log(`   🧵 tmux: ${sessionName}${created ? ' (created)' : ' (already exists)'}`);
                        } catch (tmuxErr) {
                            console.warn(`   ⚠️  Could not create tmux session: ${tmuxErr.message}`);
                        }
                    }
                } else {
                    try {
                        runGit(`git worktree add ${worktreePath} -b ${branchName}`);
                        console.log(`📂 Worktree: ${worktreePath}`);
                        createdWorktrees.push({ agentId, worktreePath });

                        // Verify spec exists in the worktree
                        const wtSpecDir = path.join(worktreePath, 'docs', 'specs', 'features', '03-in-progress');
                        const specExistsInWt = fs.existsSync(wtSpecDir) &&
                            fs.readdirSync(wtSpecDir).some(f => f.startsWith(`feature-${num}-`) && f.endsWith('.md'));
                        if (!specExistsInWt) {
                            console.warn(`⚠️  Spec not found in worktree 03-in-progress.`);
                            console.warn(`   The spec move may not have been committed. Run from the worktree:`);
                            console.warn(`   git checkout main -- docs/specs/features/03-in-progress/`);
                            console.warn(`   git commit -m "chore: sync spec to worktree branch"`);
                        }

                        setupWorktreeEnvironment(worktreePath, {
                            featureId: num,
                            agentId,
                            desc,
                            profile,
                            logsDirPath: path.join(worktreePath, 'docs/specs/features/logs')
                        });

                        if (useTmux) {
                            try {
                                const wtConfig = {
                                    path: worktreePath,
                                    featureId: num,
                                    agent: agentId
                                };
                                const agentCommand = buildAgentCommand(wtConfig);
                                const { sessionName, created } = ensureTmuxSessionForWorktree(wtConfig, agentCommand);
                                console.log(`   🧵 tmux: ${sessionName}${created ? ' (created)' : ' (already exists)'}`);
                            } catch (tmuxErr) {
                                console.warn(`   ⚠️  Could not create tmux session: ${tmuxErr.message}`);
                            }
                        }
                    } catch (e) {
                        console.error(`❌ Failed to create worktree for ${agentId}: ${e.message}`);
                    }
                }
            });

            // Add read permissions for all worktrees to Claude settings
            const allWorktreePaths = agentIds.map(agentId => `${wtBase}/feature-${num}-${agentId}-${desc}`);
            addWorktreePermissions(allWorktreePaths);
            presetWorktreeTrust(allWorktreePaths);
            if (agentIds.includes('cx')) {
                presetCodexTrust();
            }

            // Create tmux sessions if terminal is configured as tmux
            const fleetEffectiveConfig = getEffectiveConfig();
            const fleetTerminal = fleetEffectiveConfig.terminal;
            if (fleetTerminal === 'tmux' && createdWorktrees.length > 0) {
                console.log(`\n🖥️  Creating tmux sessions...`);
                const worktreeByAgent = new Map(createdWorktrees.map(wt => [wt.agentId, wt.worktreePath]));
                const sessionResults = ensureAgentSessions(num, createdWorktrees.map(wt => wt.agentId), {
                    sessionNameBuilder: (featureId, agent) => buildTmuxSessionName(featureId, agent, { desc }),
                    cwdBuilder: (_, agent) => worktreeByAgent.get(agent),
                    commandBuilder: (featureId, agent) => {
                        const wt = {
                            featureId,
                            agent,
                            path: worktreeByAgent.get(agent),
                            desc
                        };
                        return buildAgentCommand(wt);
                    }
                });
                sessionResults.forEach(result => {
                    if (result.error) {
                        console.warn(`   ⚠️  Could not create tmux session ${result.sessionName}: ${result.error.message}`);
                    } else {
                        console.log(`   ✓ ${result.sessionName}${result.created ? ' → started' : ' (already exists)'}`);
                    }
                });
                const repoName = path.basename(process.cwd());
                console.log(`\n   Attach: tmux attach -t ${repoName}-f${parseInt(num, 10)}-<agent>-${desc}`);
                console.log(`   List:   tmux ls`);
            }

            if (agentIds.length === 1) {
                const portSuffix = profile.devServer.enabled
                    ? ` (PORT=${profile.devServer.ports[agentIds[0]] || AGENT_CONFIGS[agentIds[0]]?.port || 3000})`
                    : '';
                console.log(`\n🚗 Drive worktree created for parallel development!`);
                console.log(`\n📂 Worktree: ${wtBase}/feature-${num}-${agentIds[0]}-${desc}${portSuffix}`);
                console.log(`\n💡 Next: Open the worktree with the agent CLI:`);
                console.log(`   aigon worktree-open ${num}                    # Opens in configured terminal (default: Warp)`);
                console.log(`   aigon worktree-open ${num} --terminal=code    # Opens in VS Code`);
                if (useTmux) {
                    console.log(`   aigon worktree-open ${num} --terminal=tmux    # Attaches to the tmux session`);
                }
                console.log(`\n   Or manually: Open the worktree and run /aigon-feature-do ${num}`);
                console.log(`   When done: aigon feature-close ${num}`);
            } else {
                console.log(`\n🏁 Fleet started with ${agentIds.length} agents!`);
                console.log(`\n📂 Worktrees created:`);
                agentIds.forEach(agentId => {
                    const portSuffix = profile.devServer.enabled
                        ? ` (PORT=${profile.devServer.ports[agentId] || AGENT_CONFIGS[agentId]?.port || 3000})`
                        : '';
                    console.log(`   ${agentId}: ${wtBase}/feature-${num}-${agentId}-${desc}${portSuffix}`);
                });
                console.log(`\n💡 Next: Open all worktrees side-by-side:`);
                console.log(`   aigon worktree-open ${num} --all`);
                console.log(`\n   Or open individually:`);
                agentIds.forEach(agentId => {
                    console.log(`   aigon worktree-open ${num} ${agentId}`);
                });
                console.log(`\n   Or manually: Open each worktree and run /aigon-feature-do ${num}`);
                console.log(`   When done: aigon feature-eval ${num}`);
            }
        }

        // Run post-hook (won't fail the command)
        runPostHook('feature-setup', hookContext);
    },
    'feature-do': (args) => {
        const options = parseCliOptions(args);
        const id = options._[0];
        const ralphRequested = getOptionValue(options, 'autonomous') || getOptionValue(options, 'ralph');
        if (ralphRequested) {
            return runRalphCommand(args);
        }
        printAgentContextWarning('feature-do', id);
        if (!id) return console.error(
            "Usage: aigon feature-do <ID> [--agent=<cc|gg|cx|cu>]\n\n" +
            "Run this after 'aigon feature-setup <ID>'\n\n" +
            "Examples:\n" +
            "  aigon feature-do 55             # Launch default agent (cc) from shell\n" +
            "  aigon feature-do 55 --agent=cx  # Launch Codex from shell\n" +
            "  aigon feature-do 55 --autonomous # Run Autopilot autonomous loop\n" +
            "  /aigon:feature-do 55            # Inside agent session: show instructions"
        );

        // Find the feature spec
        let found = findFile(PATHS.features, id, ['03-in-progress']);
        if (!found) return printError('feature', id, `Run 'aigon feature-setup ${id}' first.`);

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

            // Verify we're in the right worktree
            const [__, wtNum] = worktreeMatch;
            if (wtNum !== num && wtNum !== String(num).padStart(2, '0')) {
                console.warn(`⚠️  Warning: Directory feature ID (${wtNum}) doesn't match argument (${num})`);
            }

            // Count worktrees for this feature to distinguish drive-wt from fleet
            let featureWorktreeCount = 0;
            try {
                const wtOutput = execSync('git worktree list', { encoding: 'utf8' });
                const paddedNum = String(num).padStart(2, '0');
                const unpaddedNum = String(parseInt(num, 10));
                wtOutput.split('\n').forEach(line => {
                    if (line.match(new RegExp(`feature-(${paddedNum}|${unpaddedNum})-\\w+-`))) {
                        featureWorktreeCount++;
                    }
                });
            } catch (e) {
                // Default to fleet if we can't count
                featureWorktreeCount = 2;
            }

            mode = featureWorktreeCount > 1 ? 'fleet' : 'drive-wt';
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
            // Drive branch mode: default to cc
            if (agentArgRaw) {
                const normalized = agentAliasMap[agentArgRaw.toLowerCase()] || agentArgRaw.toLowerCase();
                if (!availableAgents.includes(normalized)) {
                    console.error(`❌ Unknown agent '${agentArgRaw}'. Supported agents: ${availableAgents.join(', ')}`);
                    process.exitCode = 1;
                    return;
                }
                resolvedAgent = normalized;
            } else {
                resolvedAgent = 'cc';
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
                const currentBranch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
                const expectedBranch = `feature-${num}-${desc}`;
                if (currentBranch !== expectedBranch) {
                    console.warn(`⚠️  Warning: Current branch (${currentBranch}) doesn't match expected (${expectedBranch})`);
                    console.warn(`    Run 'aigon feature-setup ${num}' first.`);
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

        if (!sessionInfo.detected) {
            // --- LAUNCH MODE: spawn the selected agent in this context ---
            const cliConfig = getAgentCliConfig(resolvedAgent);
            const featureId = paddedNum;
            const prompt = cliConfig.implementPrompt.replace('{featureId}', featureId);
            const model = cliConfig.models?.['implement'];

            if (resolvedAgent === 'cu' && model) {
                console.warn(`⚠️  Model config ignored for Cursor — model selection is UI-only (no --model flag)`);
            }
            const modelTokens = (model && resolvedAgent !== 'cu') ? ['--model', model] : [];
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

        // Check if spec exists
        const specPath = path.join(cwd, 'docs', 'specs', 'features', '03-in-progress');
        if (fs.existsSync(specPath)) {
            const specFiles = fs.readdirSync(specPath).filter(f => f.startsWith(`feature-${num}-`) && f.endsWith('.md'));
            if (specFiles.length > 0) {
                console.log(`\n📋 Spec: ./docs/specs/features/03-in-progress/${specFiles[0]}`);
            }
        }

        // Show log file location
        const logDir = './docs/specs/features/logs/';
        const logPattern = (mode === 'fleet' || mode === 'drive-wt') ? `feature-${num}-${agentId}-*-log.md` : `feature-${num}-*-log.md`;
        console.log(`📝 Log: ${logDir}${logPattern}`);

        console.log(`\n📝 Next Steps:`);
        console.log(`   1. Read the spec in ./docs/specs/features/03-in-progress/`);
        console.log(`   2. Implement the feature according to the spec`);
        console.log(`   3. Test your changes`);
        console.log(`   4. Commit your code with conventional commits (feat:, fix:, chore:)`);
        console.log(`   5. Update the implementation log`);
        console.log(`   6. Commit the log file`);

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
    },
    'feature-validate': (args) => {
        return runFeatureValidateCommand(args);
    },
    'feature-eval': (args) => {
        const options = parseCliOptions(args);
        const allowSameModel = args.includes('--allow-same-model-judge');
        const forceEval = args.includes('--force');
        // Strip flags so positional arg parsing is unaffected
        const positionalArgs = args.filter(a => a !== '--allow-same-model-judge' && a !== '--force' && !a.startsWith('--agent'));
        const name = positionalArgs[0];
        if (!name) return console.error("Usage: aigon feature-eval <ID> [--agent=<agent>] [--allow-same-model-judge] [--force]\n\nExamples:\n  aigon feature-eval 55            # Auto-launches agent to evaluate\n  aigon feature-eval 55 --agent=gg # Launch specific agent\n  aigon feature-eval 55 --allow-same-model-judge  # Skip bias warning\n  aigon feature-eval 55 --force                    # Skip agent completion check");

        // Detect whether we're already inside an active agent session
        const sessionInfo = detectActiveAgentSession();

        if (!sessionInfo.detected) {
            // --- LAUNCH MODE: spawn the selected agent to perform the evaluation ---
            const agentArgRaw = getOptionValue(options, 'agent');
            const agentAliasMap = buildAgentAliasMap();
            const availableAgents = getAvailableAgents();
            let resolvedAgent = 'cc'; // default evaluator

            if (agentArgRaw) {
                const normalized = agentAliasMap[agentArgRaw.toLowerCase()] || agentArgRaw.toLowerCase();
                if (!availableAgents.includes(normalized)) {
                    console.error(`❌ Unknown agent '${agentArgRaw}'. Supported agents: ${availableAgents.join(', ')}`);
                    process.exitCode = 1;
                    return;
                }
                resolvedAgent = normalized;
            }

            const cliConfig = getAgentCliConfig(resolvedAgent);
            const evalPrompt = (cliConfig.evalPrompt || '/aigon:feature-eval {featureId}').replace('{featureId}', name);
            // Pass through flags to the eval prompt
            const flagSuffix = [
                allowSameModel ? ' --allow-same-model-judge' : '',
                forceEval ? ' --force' : '',
            ].join('');
            const prompt = evalPrompt + flagSuffix;
            const model = cliConfig.models?.['evaluate'];

            if (resolvedAgent === 'cu' && model) {
                console.warn(`⚠️  Model config ignored for Cursor — model selection is UI-only (no --model flag)`);
            }
            const modelTokens = (model && resolvedAgent !== 'cu') ? ['--model', model] : [];
            const flagTokens = getAgentLaunchFlagTokens(cliConfig.command, cliConfig.implementFlag, { autonomous: false });
            const spawnArgs = [...flagTokens, ...modelTokens, prompt];

            const agentDisplayName = AGENT_CONFIGS[resolvedAgent]?.name || resolvedAgent;
            console.log(`\n📊 Launching ${agentDisplayName} for evaluation...`);
            console.log(`   Agent:   ${resolvedAgent}`);
            console.log(`   Command: ${cliConfig.command} ${spawnArgs.join(' ')}`);
            console.log('');

            const env = { ...process.env };
            if (cliConfig.command === 'claude') {
                delete env.CLAUDECODE;
            }

            const result = spawnSync(cliConfig.command, spawnArgs, { stdio: 'inherit', env });
            if (result.error) {
                console.error(`❌ Failed to launch agent: ${result.error.message}`);
                process.exitCode = 1;
            } else if (result.status !== 0) {
                process.exitCode = result.status || 1;
            }
            return;
        }

        // Find the feature (may already be in evaluation)
        let found = findFile(PATHS.features, name, ['03-in-progress']);
        if (found) {
            moveFile(found, '04-in-evaluation');
            found = findFile(PATHS.features, name, ['04-in-evaluation']);
        } else {
            found = findFile(PATHS.features, name, ['04-in-evaluation']);
            if (!found) return console.error(`❌ Could not find feature "${name}" in in-progress or in-evaluation.`);
            console.log(`ℹ️  Feature already in evaluation: ${found.file}`);
        }

        const match = found.file.match(/^feature-(\d+)-(.*)\.md$/);
        if (!match) return console.warn("⚠️  Could not parse filename.");
        const [_, num, desc] = match;

        // Detect mode: Find all worktrees for this feature
        let worktrees = [];
        try {
            const stdout = execSync('git worktree list', { encoding: 'utf8' });
            const lines = stdout.split('\n');
            lines.forEach(line => {
                const wtMatch = line.match(/^([^\s]+)\s+/);
                if (!wtMatch) return;
                const wtPath = wtMatch[1];
                // Match worktrees for this feature by path pattern
                const featureMatch = wtPath.match(new RegExp(`feature-${num}-(\\w+)-`));
                if (featureMatch) {
                    const agentId = featureMatch[1];
                    // Look up agent name from config
                    const agentConfig = loadAgentConfig(agentId);
                    const agentName = agentConfig ? agentConfig.name : agentId;
                    worktrees.push({ path: wtPath, agent: agentId, name: agentName });
                }
            });
        } catch (e) {
            console.warn("⚠️  Could not list worktrees");
        }

        const mode = worktrees.length > 1 ? 'fleet' : 'drive';

        // --- Agent completion check ---
        if (worktrees.length > 0 && !forceEval) {
            const incompleteAgents = [];
            worktrees.forEach(w => {
                // Log files live in the worktree: docs/specs/features/logs/feature-{num}-{agent}-{desc}-log.md
                const worktreeLogsDir = path.join(w.path, 'docs/specs/features/logs');
                if (!fs.existsSync(worktreeLogsDir)) return;
                try {
                    const logFiles = fs.readdirSync(worktreeLogsDir)
                        .filter(f => f.startsWith(`feature-${num}-${w.agent}-`) && f.endsWith('-log.md'));
                    if (logFiles.length === 0) return;
                    const logContent = fs.readFileSync(path.join(worktreeLogsDir, logFiles[0]), 'utf8');
                    const frontMatter = logContent.match(/^---\n([\s\S]*?)\n---\n/);
                    if (!frontMatter) return;
                    const statusMatch = frontMatter[1].match(/status:\s*(\S+)/);
                    const status = statusMatch ? statusMatch[1] : null;
                    if (status && status !== 'submitted') {
                        incompleteAgents.push({ agent: w.agent, name: w.name, status });
                    }
                } catch (e) { /* skip on read error */ }
            });

            if (incompleteAgents.length > 0) {
                console.log('');
                console.log(`⚠️  ${incompleteAgents.length} agent(s) not yet submitted:`);
                incompleteAgents.forEach(a => {
                    console.log(`   ${a.agent} (${a.name}) — status: ${a.status}`);
                    console.log(`     → aigon worktree-open ${num} ${a.agent}`);
                });
                console.log('');
                console.log(`   To proceed anyway: aigon feature-eval ${num} --force`);
                console.log('');
                return;
            }
        }

        // --- Cross-provider bias detection ---
        const evalSession = detectActiveAgentSession();
        const evalAgent = evalSession.detected ? evalSession.agentId : null;
        const evalCliConfig = evalAgent ? getAgentCliConfig(evalAgent) : null;
        const evalModel = evalCliConfig?.models?.['evaluate'] || null;

        if (!allowSameModel && evalAgent) {
            if (mode === 'fleet') {
                // Fleet: warn if evaluator matches ANY implementer's family
                const sameFamily = worktrees.filter(w => isSameProviderFamily(evalAgent, w.agent));
                if (sameFamily.length > 0) {
                    const evalFamily = PROVIDER_FAMILIES[evalAgent] || evalAgent;
                    const implAgents = sameFamily.map(w => w.agent).join(', ');
                    const altAgents = Object.keys(PROVIDER_FAMILIES)
                        .filter(a => !isSameProviderFamily(evalAgent, a) && PROVIDER_FAMILIES[a] !== 'varies')
                        .slice(0, 2);
                    console.log('');
                    console.log('⚠️  Self-evaluation bias warning:');
                    console.log(`   Evaluator:    ${evalAgent} (${evalFamily})`);
                    console.log(`   Implementer(s) same family: ${implAgents}`);
                    console.log('');
                    console.log('   Same-family evaluation inflates win rates by ~25% (MT-Bench, 2023).');
                    if (altAgents.length > 0) {
                        const alt = altAgents[0];
                        console.log(`   Consider:  aigon feature-eval ${num} --agent=${alt}`);
                    }
                    console.log(`   Or suppress: aigon feature-eval ${num} --allow-same-model-judge`);
                    console.log('');
                }
            } else {
                // Solo: detect implementer from worktree or branch
                let implAgent = null;
                if (worktrees.length === 1) {
                    implAgent = worktrees[0].agent;
                } else {
                    // Try to infer from branch name
                    try {
                        const branch = execSync('git branch --show-current', { stdio: 'pipe', encoding: 'utf8' }).trim();
                        const branchMatch = branch.match(/^feature-\d+-([a-z]{2})-/);
                        if (branchMatch) implAgent = branchMatch[1];
                    } catch (_) { /* ignore */ }
                }

                if (implAgent && isSameProviderFamily(evalAgent, implAgent)) {
                    const evalFamily = PROVIDER_FAMILIES[evalAgent] || evalAgent;
                    const altAgents = Object.keys(PROVIDER_FAMILIES)
                        .filter(a => !isSameProviderFamily(evalAgent, a) && PROVIDER_FAMILIES[a] !== 'varies')
                        .slice(0, 2);
                    console.log('');
                    console.log('⚠️  Self-evaluation bias warning:');
                    console.log(`   Implementer: ${implAgent} (${PROVIDER_FAMILIES[implAgent] || implAgent})`);
                    console.log(`   Evaluator:   ${evalAgent} (${evalFamily})`);
                    console.log('');
                    console.log('   Same-family evaluation inflates win rates by ~25% (MT-Bench, 2023).');
                    if (altAgents.length > 0) {
                        const alt = altAgents[0];
                        console.log(`   Consider:  aigon feature-eval ${num} --agent=${alt}`);
                    }
                    console.log(`   Or suppress: aigon feature-eval ${num} --allow-same-model-judge`);
                    console.log('');
                }
            }
        }

        // Create evaluation template
        const evalsDir = path.join(PATHS.features.root, 'evaluations');
        if (!fs.existsSync(evalsDir)) fs.mkdirSync(evalsDir, { recursive: true });

        const evalFile = path.join(evalsDir, `feature-${num}-eval.md`);
        if (!fs.existsSync(evalFile)) {
            let evalTemplate;

            if (mode === 'fleet') {
                // Fleet mode: comparison template
                const agentList = worktrees.map(w => `- [ ] **${w.agent}** (${w.name}): \`${w.path}\``).join('\n');

                evalTemplate = `# Evaluation: Feature ${num} - ${desc}

**Mode:** Fleet (Multi-agent comparison)

## Spec
See: \`./docs/specs/features/04-in-evaluation/${found.file}\`

## Implementations to Compare

${agentList}

## Evaluation Criteria

| Criteria | ${worktrees.map(w => w.agent).join(' | ')} |
|----------|${worktrees.map(() => '---').join('|')}|
| Code Quality | ${worktrees.map(() => '').join(' | ')} |
| Spec Compliance | ${worktrees.map(() => '').join(' | ')} |
| Performance | ${worktrees.map(() => '').join(' | ')} |
| Maintainability | ${worktrees.map(() => '').join(' | ')} |

## Summary

### Strengths & Weaknesses

${worktrees.map(w => `#### ${w.agent} (${w.name})
- Strengths:
- Weaknesses:
`).join('\n')}

## Recommendation

**Winner:** (to be determined after review)

**Rationale:**

`;
            } else {
                // Drive mode: code review template
                // Determine branch name: if there's a drive worktree, use its branch name
                const soloBranch = worktrees.length === 1
                    ? `feature-${num}-${worktrees[0].agent}-${desc}`
                    : `feature-${num}-${desc}`;
                evalTemplate = `# Evaluation: Feature ${num} - ${desc}

**Mode:** Drive (Code review)

## Spec
See: \`./docs/specs/features/04-in-evaluation/${found.file}\`

## Implementation
Branch: \`${soloBranch}\`

## Code Review Checklist

### Spec Compliance
- [ ] All requirements from spec are met
- [ ] Feature works as described
- [ ] Edge cases are handled

### Code Quality
- [ ] Follows project coding standards
- [ ] Code is readable and maintainable
- [ ] Proper error handling
- [ ] No obvious bugs or issues

### Testing
- [ ] Feature has been tested manually
- [ ] Tests pass (if applicable)
- [ ] Edge cases are tested

### Documentation
- [ ] Code is adequately commented where needed
- [ ] README updated (if needed)
- [ ] Breaking changes documented (if any)

### Security
- [ ] No obvious security vulnerabilities
- [ ] Input validation where needed
- [ ] No hardcoded secrets or credentials

## Review Notes

### Strengths


### Areas for Improvement


## Decision

- [ ] **Approved** - Ready to merge
- [ ] **Needs Changes** - Issues must be addressed before merging

**Rationale:**

`;
            }

            fs.writeFileSync(evalFile, evalTemplate);
            console.log(`📝 Created: ./docs/specs/features/evaluations/feature-${num}-eval.md`);
        } else {
            console.log(`ℹ️  Evaluation file already exists: feature-${num}-eval.md`);
        }

        // Commit the changes
        try {
            runGit(`git add docs/specs/features/`);
            runGit(`git commit -m "chore: move feature ${num} to evaluation"`);
            console.log(`📝 Committed evaluation setup`);
        } catch (e) {
            // May fail if no changes, that's ok
        }

        console.log(`\n📋 Feature ${num} ready for evaluation`);
        console.log(`   Mode: ${mode === 'fleet' ? '🚛 Fleet (comparison)' : '🚗 Drive (code review)'}`);
        if (evalAgent) {
            const modelDisplay = evalModel ? evalModel : '(default)';
            console.log(`   Evaluator: ${evalAgent} (${PROVIDER_FAMILIES[evalAgent] || 'unknown'}) — model: ${modelDisplay}`);
        }

        if (mode === 'fleet') {
            console.log(`\n📂 Worktrees to compare:`);
            worktrees.forEach(w => console.log(`   ${w.agent}: ${w.path}`));
            console.log(`\n🔍 Review each implementation, then pick a winner.`);
            console.log(`\n⚠️  TO MERGE THE WINNER INTO MAIN, run:`);
            worktrees.forEach(w => {
                console.log(`   aigon feature-close ${num} ${w.agent}    # merge ${w.name}'s implementation`);
            });
        } else {
            console.log(`\n🔍 Review the implementation and complete the evaluation checklist.`);
            console.log(`\n⚠️  TO MERGE INTO MAIN, run:`);
            console.log(`   aigon feature-close ${num}`);
        }
    },
    'feature-review': (args) => {
        const id = args[0];
        printAgentContextWarning('feature-review', id);
    },
    'feature-close': (args) => {
        const keepBranch = args.includes('--keep-branch');

        // Parse --adopt flag and its trailing values (e.g. --adopt cc cu, --adopt all)
        let adoptAgents = [];
        const adoptIdx = args.indexOf('--adopt');
        if (adoptIdx !== -1) {
            for (let i = adoptIdx + 1; i < args.length; i++) {
                if (args[i].startsWith('--')) break;
                adoptAgents.push(args[i].toLowerCase());
            }
            if (adoptAgents.length === 0) {
                return console.error("Usage: --adopt requires at least one agent code or 'all'\n  Example: aigon feature-close 12 cx --adopt cc cu");
            }
        }

        // Positional args: everything before any flags
        const positionalArgs = [];
        for (const a of args) {
            if (a.startsWith('--')) break;
            positionalArgs.push(a);
        }
        const name = positionalArgs[0];
        const agentId = positionalArgs[1]; // Optional - if provided, multi-agent mode
        if (!name) return console.error("Usage: aigon feature-close <ID> [agent] [--adopt <agents...|all>] [--keep-branch]\n  Without agent: Drive mode (merges feature-ID-desc)\n  With agent: Fleet mode (merges feature-ID-agent-desc, cleans up worktree)\n  --adopt: print diffs from losing agents for selective adoption (Fleet only)\n  --keep-branch: Don't delete the local branch after merge");

        // Validate --adopt is only used in arena (multi-agent) mode
        if (adoptAgents.length > 0 && !agentId) {
            return console.error("❌ --adopt is only available in Fleet (multi-agent) mode.\n   Usage: aigon feature-close <ID> <winning-agent> --adopt <agents...|all>");
        }

        const found = findFile(PATHS.features, name, ['04-in-evaluation', '03-in-progress']);
        if (!found) return console.error(`❌ Could not find feature "${name}" in in-evaluation or in-progress.`);
        const match = found.file.match(/^feature-(\d+)-(.*)\.md$/);
        if (!match) return console.warn("⚠️  Bad filename. Cannot parse ID.");
        const [_, num, desc] = match;

        // Build hook context
        const hookContext = {
            featureId: num,
            featureName: desc,
            agent: agentId || '',
            adoptAgents: adoptAgents
        };

        // Run pre-hook (can abort the command)
        if (!runPreHook('feature-close', hookContext)) {
            return;
        }

        let branchName, worktreePath, mode;

        if (agentId) {
            // Multi-agent mode: feature-55-cc-dark-mode
            branchName = `feature-${num}-${agentId}-${desc}`;
            worktreePath = `${getWorktreeBase()}/feature-${num}-${agentId}-${desc}`;
            mode = 'multi-agent';
        } else {
            // Drive mode: feature-55-dark-mode
            branchName = `feature-${num}-${desc}`;
            worktreePath = null;
            mode = 'drive';
        }

        // Check if branch exists before attempting merge
        try {
            execSync(`git rev-parse --verify ${branchName}`, { encoding: 'utf8', stdio: 'pipe' });
        } catch (e) {
            if (agentId) {
                // Explicit agent specified but branch not found
                const altBranch = `feature-${num}-${desc}`;
                console.error(`❌ Branch not found: ${branchName}`);
                console.error(`   Did you mean: aigon feature-close ${num}?`);
                console.error(`   Looking for: ${altBranch}`);
                return;
            }

            // Drive branch not found — check for Drive worktree (auto-detect)
            let featureWorktrees = [];
            try {
                const wtOutput = execSync('git worktree list', { encoding: 'utf8' });
                const paddedNum = String(num).padStart(2, '0');
                const unpaddedNum = String(parseInt(num, 10));
                wtOutput.split('\n').forEach(line => {
                    const wtMatch = line.match(/^([^\s]+)\s+/);
                    if (!wtMatch) return;
                    const wtPath = wtMatch[1];
                    const featureMatch = wtPath.match(new RegExp(`feature-(${paddedNum}|${unpaddedNum})-(\\w+)-`));
                    if (featureMatch) {
                        featureWorktrees.push({ path: wtPath, agent: featureMatch[2] });
                    }
                });
            } catch (wtErr) {
                // Ignore worktree listing errors
            }

            if (featureWorktrees.length === 1) {
                // Auto-detect: single worktree = Drive worktree mode
                const detectedAgent = featureWorktrees[0].agent;
                branchName = `feature-${num}-${detectedAgent}-${desc}`;
                worktreePath = featureWorktrees[0].path;
                mode = 'multi-agent';
                console.log(`🔍 Auto-detected Drive worktree (agent: ${detectedAgent})`);

                // Verify this branch exists
                try {
                    execSync(`git rev-parse --verify ${branchName}`, { encoding: 'utf8', stdio: 'pipe' });
                } catch (e2) {
                    console.error(`❌ Branch not found: ${branchName}`);
                    return;
                }
            } else if (featureWorktrees.length > 1) {
                console.error(`❌ Branch not found: ${branchName}`);
                console.error(`   Multiple worktrees found for feature ${num}. Specify the agent:`);
                featureWorktrees.forEach(wt => {
                    console.error(`   aigon feature-close ${num} ${wt.agent}`);
                });
                return;
            } else {
                console.error(`❌ Branch not found: ${branchName}`);
                console.error(`   Run 'aigon feature-setup ${num}' first.`);
                return;
            }
        }

        // Drive mode: auto-commit uncommitted changes before close
        // In fleet/worktree mode, feature-submit handles this.
        // In drive mode, there is no submit step — close is the final command.
        if (mode === 'drive') {
            const currentBranch = getCurrentBranch();
            if (currentBranch === branchName) {
                const uncommitted = getGitStatusPorcelain();
                if (uncommitted) {
                    console.log(`\n📦 Uncommitted changes detected on ${branchName} — auto-committing before close...`);
                    try {
                        runGit(`git add -A`);
                        runGit(`git commit -m "feat: implementation for feature ${num}"`);
                        console.log(`✅ Auto-committed implementation changes`);
                    } catch (e) {
                        console.error(`❌ Auto-commit failed. Please commit your changes manually before closing.`);
                        return;
                    }
                }
            }
        }

        // Push branch to origin before merging (to save work remotely)
        try {
            runGit(`git push -u origin ${branchName}`);
            console.log(`📤 Pushed branch to origin: ${branchName}`);
        } catch (e) {
            // Push failed - warn but continue (remote might not exist or branch already pushed)
            console.warn(`⚠️  Could not push to origin (continuing anyway): ${e.message || 'push failed'}`);
        }

        // Detect default branch (main or master)
        let defaultBranch;
        try {
            // Try to get the default branch from remote
            defaultBranch = execSync('git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || echo refs/heads/main', { encoding: 'utf8' }).trim().replace('refs/remotes/origin/', '').replace('refs/heads/', '');
        } catch (e) {
            defaultBranch = 'main';
        }
        // Fallback: check if main exists, otherwise use master
        try {
            execSync(`git rev-parse --verify ${defaultBranch}`, { encoding: 'utf8', stdio: 'pipe' });
        } catch (e) {
            defaultBranch = 'master';
        }

        // Switch to default branch before merging
        try {
            runGit(`git checkout ${defaultBranch}`);
            console.log(`🌿 Switched to ${defaultBranch}`);
        } catch (e) {
            console.error(`❌ Failed to switch to ${defaultBranch}. Are you in the main repository?`);
            return;
        }

        // Merge the branch FIRST (before moving files, so merge doesn't reintroduce them)
        const mergeMsg = agentId
            ? `Merge feature ${num} from agent ${agentId}`
            : `Merge feature ${num}`;
        try {
            runGit(`git merge --no-ff ${branchName} -m "${mergeMsg}"`);
            console.log(`✅ Merged branch: ${branchName}`);
        } catch (e) {
            console.error(`❌ Merge failed. You may need to resolve conflicts manually.`);
            return;
        }

        // Move spec to done (after merge so it doesn't get reintroduced)
        // Re-find the file since merge may have changed things
        const postMergeFound = findFile(PATHS.features, name, ['04-in-evaluation', '03-in-progress']);
        if (postMergeFound) {
            moveFile(postMergeFound, '05-done');
            console.log(`📋 Moved spec to done`);
        }

        // Organize log files (for both modes)
        organizeLogFiles(num, agentId);

        // Commit the moved spec and log files
        try {
            runGit(`git add docs/specs/features/`);
            runGit(`git commit -m "chore: complete feature ${num} - move spec and logs"`);
            console.log(`📝 Committed spec and log file moves`);
        } catch (e) {
            // May fail if no changes to commit, that's ok
        }

        // Clean up worktree if it exists (multi-agent mode or drive-wt)
        let worktreeRemoved = false;
        if (worktreePath && fs.existsSync(worktreePath)) {
            try {
                execSync(`git worktree remove "${worktreePath}" --force`);
                console.log(`🧹 Removed worktree: ${worktreePath}`);
                worktreeRemoved = true;
            } catch (e) {
                console.warn(`⚠️  Could not automatically remove worktree: ${worktreePath}`);
            }
        }

        // Delete the merged branch locally (skip if --keep-branch or worktree removal already handled it)
        if (keepBranch) {
            console.log(`📌 Keeping branch: ${branchName} (--keep-branch)`);
        } else if (worktreeRemoved) {
            // Worktree removal may have already deleted the branch; clean up if it still exists
            try {
                execSync(`git rev-parse --verify ${branchName}`, { stdio: 'pipe' });
                runGit(`git branch -d ${branchName}`);
                console.log(`🗑️  Deleted branch: ${branchName}`);
            } catch (e) {
                // Branch already gone from worktree removal — expected
            }
        } else {
            try {
                runGit(`git branch -d ${branchName}`);
                console.log(`🗑️  Deleted branch: ${branchName}`);
            } catch (e) {
                // Branch deletion is optional, don't fail if it doesn't work
            }
        }

        // In multi-agent mode, handle losing branches and adoption
        if (agentId) {
            // Find all other branches for this feature, extracting agent ID from each
            const losingBranches = []; // { branch, agent }
            try {
                const branchOutput = execSync('git branch --list', { encoding: 'utf8' });
                const branches = branchOutput.split('\n').map(b => b.trim().replace(/^[*+]\s+/, ''));
                const featurePattern = new RegExp(`^feature-${num}-(\\w+)-`);
                branches.forEach(branch => {
                    const m = branch.match(featurePattern);
                    if (m && branch !== branchName) {
                        losingBranches.push({ branch, agent: m[1] });
                    }
                });
            } catch (e) {
                // Ignore errors listing branches
            }

            // Resolve --adopt all to all losing agent IDs
            if (adoptAgents.includes('all')) {
                if (losingBranches.length === 0) {
                    console.warn(`\n⚠️  --adopt all: no losing branches found. Continuing normally.`);
                    adoptAgents = [];
                } else {
                    adoptAgents = losingBranches.map(lb => lb.agent);
                }
            }

            // Validate requested adopt agents exist in losing branches
            if (adoptAgents.length > 0) {
                const losingAgentIds = losingBranches.map(lb => lb.agent);
                const invalidAgents = adoptAgents.filter(a => !losingAgentIds.includes(a));
                if (invalidAgents.length > 0) {
                    console.error(`❌ No losing branch found for agent(s): ${invalidAgents.join(', ')}`);
                    if (losingAgentIds.length > 0) {
                        console.error(`   Available losing agents: ${losingAgentIds.join(', ')}`);
                    }
                    return;
                }
            }

            // Print adoption diffs
            if (adoptAgents.length > 0) {
                console.log(`\n🔍 Adoption diffs from ${adoptAgents.length} agent(s):`);
                for (const adoptAgent of adoptAgents) {
                    const lb = losingBranches.find(l => l.agent === adoptAgent);
                    if (!lb) continue;
                    console.log(`\n${'='.repeat(72)}`);
                    console.log(`📋 DIFF FROM AGENT: ${adoptAgent} (${lb.branch})`);
                    console.log(`${'='.repeat(72)}`);
                    try {
                        const diff = execSync(`git diff HEAD ${lb.branch}`, {
                            encoding: 'utf8',
                            maxBuffer: 10 * 1024 * 1024
                        });
                        if (diff.trim()) {
                            console.log(diff);
                        } else {
                            console.log(`   (no unique changes — diff is empty)`);
                        }
                    } catch (diffErr) {
                        console.error(`   ❌ Failed to generate diff for ${adoptAgent}: ${diffErr.message || 'diff failed'}`);
                    }
                }
                console.log(`\n${'='.repeat(72)}`);
                console.log(`END OF ADOPTION DIFFS`);
                console.log(`${'='.repeat(72)}`);
            }

            if (losingBranches.length > 0) {
                console.log(`\n📦 Found ${losingBranches.length} other implementation(s):`);

                // Partition: adopted branches kept for reference, others show cleanup
                const adoptedBranches = losingBranches.filter(lb => adoptAgents.includes(lb.agent));
                const nonAdoptedBranches = losingBranches.filter(lb => !adoptAgents.includes(lb.agent));

                if (adoptedBranches.length > 0) {
                    console.log(`\n   📌 Kept for adoption reference:`);
                    adoptedBranches.forEach(lb => console.log(`      - ${lb.branch} (agent: ${lb.agent})`));
                }
                if (nonAdoptedBranches.length > 0) {
                    nonAdoptedBranches.forEach(lb => console.log(`   - ${lb.branch}`));
                    console.log(`\n🧹 Cleanup options:`);
                    console.log(`   aigon feature-cleanup ${num}         # Delete worktrees and local branches`);
                    console.log(`   aigon feature-cleanup ${num} --push  # Push branches to origin first, then delete`);
                }
            }
        }

        console.log(`\n✅ Feature ${num} complete! (${mode} mode)`);

        // Auto-deploy if workflow.deployAfterDone is set
        const deployAfterDone = loadProjectConfig()?.workflow?.deployAfterDone;
        if (deployAfterDone) {
            console.log(`\n🚀 Deploying (workflow.deployAfterDone)...`);
            const deployExitCode = runDeployCommand(deployAfterDone === 'preview');
            if (deployExitCode !== 0) {
                console.error(`\n⚠️  Deploy failed (exit ${deployExitCode}) — merge is intact, deploy manually with: aigon deploy`);
                process.exitCode = deployExitCode;
            } else {
                console.log(`✅ Deployed.`);
            }
        }

        // Run post-hook (won't fail the command)
        runPostHook('feature-close', hookContext);
    },
    'feature-cleanup': (args) => {
        const id = args[0];
        const pushFlag = args.includes('--push');
        if (!id) return console.error("Usage: aigon feature-cleanup <ID> [--push]\n\nRemoves all worktrees and branches for a feature.\n\nOptions:\n  --push  Push branches to origin before deleting locally\n\nExample: aigon feature-cleanup 55");

        const paddedId = String(id).padStart(2, '0');
        const unpaddedId = String(parseInt(id, 10));

        // Build hook context
        const hookContext = {
            featureId: paddedId
        };

        // Run pre-hook (can abort the command)
        if (!runPreHook('feature-cleanup', hookContext)) {
            return;
        }

        // Remove worktrees and collect paths for permission cleanup
        let worktreeCount = 0;
        const removedWorktreePaths = [];
        try {
            const stdout = execSync('git worktree list', { encoding: 'utf8' });
            const lines = stdout.split('\n');
            lines.forEach(line => {
                const match = line.match(/^([^\s]+)\s+/);
                if (!match) return;
                const wtPath = match[1];
                if (wtPath === process.cwd()) return;
                if (wtPath.includes(`feature-${paddedId}-`) || wtPath.includes(`feature-${unpaddedId}-`)) {
                    console.log(`   Removing worktree: ${wtPath}`);
                    removedWorktreePaths.push(wtPath);
                    try { execSync(`git worktree remove "${wtPath}" --force`); worktreeCount++; }
                    catch (err) { console.error(`   ❌ Failed to remove ${wtPath}`); }
                }
            });
        } catch (e) { console.error("❌ Error reading git worktrees."); }

        // Clean up worktree permissions and trust from Claude settings
        if (removedWorktreePaths.length > 0) {
            removeWorktreePermissions(removedWorktreePaths);
            removeWorktreeTrust(removedWorktreePaths);
        }

        // Find and handle branches
        const featureBranches = [];
        try {
            const branchOutput = execSync('git branch --list', { encoding: 'utf8' });
            const branches = branchOutput.split('\n').map(b => b.trim().replace('* ', '')).filter(b => b);
            branches.forEach(branch => {
                if (branch.startsWith(`feature-${paddedId}-`) || branch.startsWith(`feature-${unpaddedId}-`)) {
                    featureBranches.push(branch);
                }
            });
        } catch (e) {
            // Ignore errors
        }

        let branchCount = 0;
        if (featureBranches.length > 0) {
            featureBranches.forEach(branch => {
                if (pushFlag) {
                    try {
                        execSync(`git push -u origin ${branch}`, { stdio: 'pipe' });
                        console.log(`   📤 Pushed: ${branch}`);
                    } catch (e) {
                        console.warn(`   ⚠️  Could not push ${branch} (may already exist on remote)`);
                    }
                }
                try {
                    execSync(`git branch -D ${branch}`, { stdio: 'pipe' });
                    console.log(`   🗑️  Deleted local branch: ${branch}`);
                    branchCount++;
                } catch (e) {
                    console.error(`   ❌ Failed to delete ${branch}`);
                }
            });
        }

        console.log(`\n✅ Cleanup complete: ${worktreeCount} worktree(s), ${branchCount} branch(es) removed.`);
        if (!pushFlag && branchCount > 0) {
            console.log(`💡 Tip: Use 'aigon feature-cleanup ${id} --push' to push branches to origin before deleting.`);
        }

        // Run post-hook (won't fail the command)
        runPostHook('feature-cleanup', hookContext);
    },

    'agent-status': (args) => {
        const status = args[0];
        const validStatuses = ['implementing', 'waiting', 'submitted'];
        if (!status || !validStatuses.includes(status)) {
            return console.error(`Usage: aigon agent-status <status>\n\nValid statuses: ${validStatuses.join(', ')}\n\nExample: aigon agent-status waiting`);
        }

        // Detect branch
        let branch;
        try {
            branch = require('child_process').execSync('git branch --show-current', { encoding: 'utf8' }).trim();
        } catch (e) {
            return console.error('❌ Could not detect current branch.');
        }

        // Parse feature ID and agent from branch name
        // Arena/worktree: feature-<ID>-<agent>-<desc>
        // Solo: feature-<ID>-<desc>
        const arenaMatch = branch.match(/^feature-(\d+)-([a-z]{2})-(.+)$/);
        const soloMatch = branch.match(/^feature-(\d+)-(.+)$/);

        let featureNum, agentId;
        if (arenaMatch) {
            featureNum = arenaMatch[1].padStart(2, '0');
            agentId = arenaMatch[2];
        } else if (soloMatch) {
            featureNum = soloMatch[1].padStart(2, '0');
            agentId = null; // solo
        } else {
            return console.error(`❌ Branch "${branch}" does not match a feature branch pattern (feature-<ID>-...)`);
        }

        // Glob for the matching log file
        const logsDir = path.join(PATHS.features.root, 'logs');
        if (!fs.existsSync(logsDir)) {
            return console.error(`❌ Logs directory not found: ${logsDir}`);
        }

        const logPattern = agentId
            ? `feature-${featureNum}-${agentId}-`
            : `feature-${featureNum}-`;
        const logFiles = fs.readdirSync(logsDir)
            .filter(f => f.startsWith(logPattern) && f.endsWith('-log.md') && !f.includes('/selected/') && !f.includes('/alternatives/'));

        // For drive mode, exclude files with an agent suffix (2-letter code after the ID)
        const filteredLogs = agentId
            ? logFiles
            : logFiles.filter(f => !f.match(new RegExp(`^feature-${featureNum}-[a-z]{2}-`)));

        if (filteredLogs.length === 0) {
            return console.error(`❌ No log file found matching feature-${featureNum}${agentId ? '-' + agentId : ''}-*-log.md in ${logsDir}`);
        }

        const logFile = filteredLogs[0];
        const logPath = path.join(logsDir, logFile);
        let content = fs.readFileSync(logPath, 'utf8');

        const nowIso = new Date().toISOString();
        const newFrontMatter = `---\nstatus: ${status}\nupdated: ${nowIso}\n---\n`;

        // Replace existing front matter or prepend
        if (content.startsWith('---\n')) {
            content = content.replace(/^---\n[\s\S]*?\n---\n/, newFrontMatter);
        } else {
            content = newFrontMatter + '\n' + content;
        }

        fs.writeFileSync(logPath, content);
        console.log(`✅ Status updated: ${status} (${logFile})`);
    },

    'status': (args) => {
        const idArg = args[0] && !args[0].startsWith('--') ? args[0] : null;
        const logsDir = path.join(PATHS.features.root, 'logs');
        const inProgressDir = path.join(PATHS.features.root, '03-in-progress');

        if (!fs.existsSync(logsDir)) {
            return console.error('❌ No logs directory found. Run aigon feature-setup first.');
        }

        // Helper: parse front matter from log file content
        function parseFrontMatter(content) {
            const match = content.match(/^---\n([\s\S]*?)\n---\n/);
            if (!match) return null;
            const fm = {};
            match[1].split('\n').forEach(line => {
                const [key, ...rest] = line.split(':');
                if (key && rest.length) fm[key.trim()] = rest.join(':').trim();
            });
            return fm;
        }

        // Helper: extract feature name from spec filename
        function featureNameFromSpec(filename) {
            // feature-31-log-status-tracking.md -> log-status-tracking
            const m = filename.match(/^feature-\d+-(.+)\.md$/);
            return m ? m[1] : filename;
        }

        let featureIds = [];
        if (idArg) {
            featureIds = [String(parseInt(idArg, 10)).padStart(2, '0')];
        } else {
            // Find all in-progress features
            if (!fs.existsSync(inProgressDir)) {
                return console.log('No features in progress.');
            }
            featureIds = fs.readdirSync(inProgressDir)
                .filter(f => f.match(/^feature-\d+-.+\.md$/))
                .map(f => {
                    const m = f.match(/^feature-(\d+)-/);
                    return m ? m[1].padStart(2, '0') : null;
                })
                .filter(Boolean);
        }

        if (featureIds.length === 0) {
            return console.log('No features in progress.');
        }

        let anyOutput = false;
        featureIds.forEach(featureNum => {
            // Get feature name from spec file
            let featureName = featureNum;
            if (fs.existsSync(inProgressDir)) {
                const specFile = fs.readdirSync(inProgressDir).find(f => f.startsWith(`feature-${featureNum}-`));
                if (specFile) featureName = featureNameFromSpec(specFile);
            }

            // Find all log files for this feature (excluding selected/alternatives subdirs)
            const allLogs = fs.readdirSync(logsDir)
                .filter(f => f.startsWith(`feature-${featureNum}-`) && f.endsWith('-log.md'));

            if (allLogs.length === 0) return;

            anyOutput = true;
            console.log(`\n#${featureNum}  ${featureName}`);

            allLogs.forEach(logFile => {
                const logPath = path.join(logsDir, logFile);
                const content = fs.readFileSync(logPath, 'utf8');
                const fm = parseFrontMatter(content);
                const status = fm ? fm.status || 'unknown' : 'unknown';
                const updated = fm ? fm.updated || '' : '';

                // Determine agent label
                // Arena: feature-31-cc-desc-log.md -> cc
                // Solo: feature-31-desc-log.md -> solo
                const arenaM = logFile.match(new RegExp(`^feature-${featureNum}-([a-z]{2})-`));
                const agent = arenaM ? arenaM[1] : 'solo';

                // Format time from ISO string
                let timeStr = '';
                if (updated) {
                    const d = new Date(updated);
                    if (!isNaN(d)) {
                        timeStr = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                    }
                }

                const statusPad = status.padEnd(14);
                const agentPad = agent.padEnd(6);
                console.log(`  ${agentPad} ${statusPad} ${timeStr}`);
            });
        });

        if (!anyOutput) {
            console.log(idArg ? `No log files found for feature #${idArg}.` : 'No log files found for in-progress features.');
        }
    },

    'deploy': (args) => {
        const isPreview = args.includes('--preview');
        const exitCode = runDeployCommand(isPreview);
        if (exitCode !== 0) process.exitCode = exitCode;
    },

    'feature-autopilot': (args) => {
        const options = parseCliOptions(args);
        const subcommand = options._[0];

        // --- Subcommands: status, stop, attach ---
        if (subcommand === 'status') {
            const idArg = options._[1];
            const worktrees = findWorktrees();
            const featureIds = idArg
                ? [idArg]
                : [...new Set(worktrees.map(wt => wt.featureId))];

            if (featureIds.length === 0) {
                console.log('No active worktrees found.');
                return;
            }

            featureIds.forEach(fid => {
                const fWorktrees = filterByFeatureId(worktrees, fid);
                if (fWorktrees.length === 0) return;

                const desc = fWorktrees[0].desc || '';
                console.log(`\n🎭 Conductor: Feature ${fid} — ${desc}`);
                console.log('━'.repeat(40));
                console.log(`${'Agent'.padEnd(7)} ${'Status'.padEnd(15)} Updated`);

                fWorktrees.forEach(wt => {
                    const logsDir = path.join(wt.path, 'docs/specs/features/logs');
                    let status = 'unknown';
                    let updatedStr = '';
                    try {
                        const logFiles = fs.readdirSync(logsDir)
                            .filter(f => f.startsWith(`feature-${wt.featureId}-${wt.agent}-`) && f.endsWith('-log.md'));
                        if (logFiles.length > 0) {
                            const content = fs.readFileSync(path.join(logsDir, logFiles[0]), 'utf8');
                            const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
                            if (fmMatch) {
                                const sm = fmMatch[1].match(/status:\s*(\S+)/);
                                if (sm) status = sm[1];
                                const um = fmMatch[1].match(/updated:\s*(\S+)/);
                                if (um) {
                                    const d = new Date(um[1]);
                                    const diffMs = Date.now() - d.getTime();
                                    const diffMin = Math.floor(diffMs / 60000);
                                    updatedStr = diffMin < 1 ? 'just now' : `${diffMin}m ago`;
                                }
                            }
                        }
                    } catch (e) { /* skip */ }

                    // Check if tmux session is alive
                    const tmuxInfo = safeTmuxSessionExists(wt.featureId, wt.agent);
                    const alive = tmuxInfo && tmuxInfo.running;
                    const statusDisplay = alive ? status : `${status} (session dead)`;

                    console.log(`${wt.agent.padEnd(7)} ${statusDisplay.padEnd(15)} ${updatedStr}`);
                });
            });
            return;
        }

        if (subcommand === 'stop') {
            const id = options._[1];
            if (!id) {
                console.error('Usage: aigon feature-autopilot stop <feature-id>');
                return;
            }
            // Reuse sessions-close logic
            commands['sessions-close']([id]);
            return;
        }

        if (subcommand === 'attach') {
            const id = options._[1];
            const agent = options._[2];
            if (!id || !agent) {
                console.error('Usage: aigon feature-autopilot attach <feature-id> <agent>');
                return;
            }
            const tmuxInfo = safeTmuxSessionExists(id, agent);
            if (!tmuxInfo || !tmuxInfo.running) {
                console.error(`❌ No tmux session found for F${id} ${agent}`);
                console.error(`   Run: aigon feature-autopilot status ${id}`);
                return;
            }
            try {
                const { status } = spawnSync('tmux', ['attach', '-t', tmuxInfo.sessionName], { stdio: 'inherit' });
                if (status !== 0) console.error(`❌ Failed to attach to ${tmuxInfo.sessionName}`);
            } catch (e) {
                console.error(`❌ ${e.message}`);
            }
            return;
        }

        // --- Main feature-autopilot command: aigon feature-autopilot <feature-id> [agents...] ---
        const featureId = subcommand;
        if (!featureId || featureId.startsWith('-')) {
            console.error('Usage: aigon feature-autopilot <feature-id> [agents...]');
            console.error('       aigon feature-autopilot status [feature-id]');
            console.error('       aigon feature-autopilot stop <feature-id>');
            console.error('       aigon feature-autopilot attach <feature-id> <agent>');
            console.error('\nExamples:');
            console.error('  aigon feature-autopilot 42 cc gg cx         # Arena: 3 agents compete');
            console.error('  aigon feature-autopilot 42                  # Use defaultAgents from config');
            console.error('  aigon feature-autopilot 42 --max-iterations=8');
            console.error('  aigon feature-autopilot 42 --auto-eval      # Auto-run feature-eval on completion');
            return;
        }

        // Resolve agents: positional args after feature-id, or config defaults
        const positionalAgents = options._.slice(1);
        const effectiveConfig = getEffectiveConfig();
        const conductorConfig = effectiveConfig.conductor || {};
        let agentIds = positionalAgents.length > 0
            ? positionalAgents
            : (conductorConfig.defaultAgents || ['cc', 'gg']);

        // Validate agents
        const availableAgents = getAvailableAgents();
        const invalidAgents = agentIds.filter(a => !availableAgents.includes(a));
        if (invalidAgents.length > 0) {
            console.error(`❌ Unknown agent(s): ${invalidAgents.join(', ')}. Available: ${availableAgents.join(', ')}`);
            return;
        }

        if (agentIds.length < 2) {
            console.error('❌ Arena mode requires at least 2 agents.');
            console.error(`   Got: ${agentIds.join(', ')}`);
            return;
        }

        const maxIterationsRaw = getOptionValue(options, 'max-iterations');
        const configMaxIterations = conductorConfig.maxIterations;
        const maxIterations = maxIterationsRaw !== undefined
            ? parseInt(maxIterationsRaw, 10)
            : (Number.isInteger(configMaxIterations) && configMaxIterations > 0 ? configMaxIterations : 5);
        const autoEval = getOptionValue(options, 'auto-eval') !== undefined || conductorConfig.autoEval === true;
        const pollIntervalRaw = getOptionValue(options, 'poll-interval');
        const pollInterval = pollIntervalRaw !== undefined
            ? parseInt(pollIntervalRaw, 10) * 1000
            : ((conductorConfig.pollInterval || 30) * 1000);

        // --- Setup Phase ---
        // Check if feature already has worktrees set up
        let existingWorktrees = [];
        try {
            existingWorktrees = filterByFeatureId(findWorktrees(), featureId);
        } catch (e) { /* no worktrees */ }

        let found = findFile(PATHS.features, featureId, ['02-backlog', '03-in-progress']);
        if (!found) {
            console.error(`❌ Could not find feature "${featureId}" in backlog or in-progress.`);
            return;
        }

        const match = found.file.match(/^feature-(\d+)-(.*)\.md$/);
        if (!match) {
            console.error('❌ Could not parse feature filename.');
            return;
        }
        const [, featureNum, featureDesc] = match;

        if (existingWorktrees.length > 0) {
            // Feature already set up — use existing worktrees
            agentIds = existingWorktrees.map(wt => wt.agent);
            console.log(`\n🎭 Conductor: Feature ${featureNum} — ${featureDesc}`);
            console.log(`   Using existing worktrees (${agentIds.length} agents: ${agentIds.join(', ')})`);
        } else {
            // Run feature-setup
            console.log(`\n🎭 Conductor: Feature ${featureNum} — ${featureDesc}`);
            console.log(`   Setting up arena with ${agentIds.length} agents: ${agentIds.join(', ')}`);
            commands['feature-setup']([featureId, ...agentIds]);

            // Verify worktrees were created
            try {
                existingWorktrees = filterByFeatureId(findWorktrees(), featureId);
            } catch (e) { /* ignore */ }

            if (existingWorktrees.length === 0) {
                console.error('❌ Feature setup failed — no worktrees created.');
                return;
            }
            // Update agentIds to match what was actually created
            agentIds = existingWorktrees.map(wt => wt.agent);
        }

        // --- Spawn Phase ---
        console.log(`\n🚀 Spawning autonomous Ralph loops...`);
        try {
            assertTmuxAvailable();
        } catch (e) {
            console.error(`❌ ${e.message}`);
            console.error('   Conductor requires tmux. Install: brew install tmux');
            return;
        }

        const spawnedAgents = [];
        existingWorktrees.forEach(wt => {
            const sessionName = buildTmuxSessionName(wt.featureId, wt.agent, { desc: wt.desc });

            // Check if agent already submitted (don't re-spawn)
            const logsDir = path.join(wt.path, 'docs/specs/features/logs');
            try {
                const logFiles = fs.readdirSync(logsDir)
                    .filter(f => f.startsWith(`feature-${featureNum}-${wt.agent}-`) && f.endsWith('-log.md'));
                if (logFiles.length > 0) {
                    const content = fs.readFileSync(path.join(logsDir, logFiles[0]), 'utf8');
                    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
                    if (fmMatch) {
                        const sm = fmMatch[1].match(/status:\s*(\S+)/);
                        if (sm && sm[1] === 'submitted') {
                            console.log(`   ✓ ${wt.agent} — already submitted, skipping`);
                            spawnedAgents.push({ ...wt, alreadySubmitted: true });
                            return;
                        }
                    }
                }
            } catch (e) { /* proceed with spawn */ }

            // Kill existing session (may have a stale agent running — check both old and new naming)
            const existingTmux = safeTmuxSessionExists(wt.featureId, wt.agent);
            if (existingTmux && existingTmux.running) {
                spawnSync('tmux', ['kill-session', '-t', existingTmux.sessionName], { stdio: 'ignore' });
                console.log(`   ↩️ ${wt.agent} — killed stale session, respawning`);
            }

            // Create fresh session with autonomous command as initial process
            const cmd = `aigon feature-do ${featureNum} --autonomous --auto-submit --agent=${wt.agent} --max-iterations=${maxIterations}`;
            try {
                createDetachedTmuxSession(sessionName, wt.path, cmd);
            } catch (e) {
                console.error(`   ❌ ${wt.agent} — failed to create tmux session: ${e.message}`);
                return;
            }
            console.log(`   ✓ ${wt.agent} — spawned in ${sessionName}`);
            spawnedAgents.push({ ...wt, alreadySubmitted: false });
        });

        if (spawnedAgents.length === 0) {
            console.error('❌ No agents spawned.');
            return;
        }

        // --- Monitor Phase ---
        const allAlreadySubmitted = spawnedAgents.every(a => a.alreadySubmitted);
        if (allAlreadySubmitted) {
            console.log(`\n✅ All agents already submitted!`);
        } else {
            console.log(`\n⏱  Monitoring ${spawnedAgents.length} agents (polling every ${pollInterval / 1000}s, Ctrl+C to stop)...\n`);

            let interrupted = false;
            const sigintHandler = () => { interrupted = true; };
            process.on('SIGINT', sigintHandler);

            // Track previous statuses to detect individual agent submissions
            const previousStatuses = {};
            spawnedAgents.forEach(wt => {
                previousStatuses[wt.agent] = wt.alreadySubmitted ? 'submitted' : 'unknown';
            });

            try {
                while (!interrupted) {
                    // Sleep for poll interval
                    try {
                        spawnSync('sleep', [String(pollInterval / 1000)], { stdio: 'ignore' });
                    } catch (e) { break; }

                    if (interrupted) break;

                    // Read status from each agent's log file
                    let allSubmitted = true;
                    const statusRows = [];

                    spawnedAgents.forEach(wt => {
                        const logsDir = path.join(wt.path, 'docs/specs/features/logs');
                        let status = 'unknown';
                        let updatedStr = '';
                        try {
                            const logFiles = fs.readdirSync(logsDir)
                                .filter(f => f.startsWith(`feature-${featureNum}-${wt.agent}-`) && f.endsWith('-log.md'));
                            if (logFiles.length > 0) {
                                const content = fs.readFileSync(path.join(logsDir, logFiles[0]), 'utf8');
                                const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
                                if (fmMatch) {
                                    const sm = fmMatch[1].match(/status:\s*(\S+)/);
                                    if (sm) status = sm[1];
                                    const um = fmMatch[1].match(/updated:\s*(\S+)/);
                                    if (um) {
                                        const d = new Date(um[1]);
                                        const diffMs = Date.now() - d.getTime();
                                        const diffMin = Math.floor(diffMs / 60000);
                                        updatedStr = diffMin < 1 ? 'just now' : `${diffMin}m ago`;
                                    }
                                }
                            }
                        } catch (e) { /* skip */ }

                        // Notify when an individual agent transitions to submitted
                        if (status === 'submitted' && previousStatuses[wt.agent] !== 'submitted') {
                            try {
                                execSync(`osascript -e 'display notification "Agent ${wt.agent} submitted Feature #${featureNum}" with title "Aigon Conductor"'`);
                            } catch (e) { /* notification failed, not critical */ }
                        }
                        previousStatuses[wt.agent] = status;

                        if (status !== 'submitted') allSubmitted = false;
                        statusRows.push({ agent: wt.agent, status, updatedStr });
                    });

                    // Print status table
                    const now = new Date().toLocaleTimeString();
                    console.log(`[${now}] ${'Agent'.padEnd(7)} ${'Status'.padEnd(15)} Updated`);
                    statusRows.forEach(row => {
                        console.log(`         ${row.agent.padEnd(7)} ${row.status.padEnd(15)} ${row.updatedStr}`);
                    });
                    console.log('');

                    if (allSubmitted) {
                        console.log('✅ All agents submitted!');
                        try {
                            execSync(`osascript -e 'display notification "All agents submitted for Feature #${featureNum}" with title "Aigon Conductor"'`);
                        } catch (e) { /* notification failed, not critical */ }
                        break;
                    }
                }
            } finally {
                process.removeListener('SIGINT', sigintHandler);
            }

            if (interrupted) {
                console.log('\n⏸  Monitoring stopped. Agents are still running in their tmux sessions.');
                console.log(`   Resume:  aigon feature-autopilot status ${featureNum}`);
                console.log(`   Stop:    aigon feature-autopilot stop ${featureNum}`);
                console.log(`   Attach:  aigon feature-autopilot attach ${featureNum} <agent>`);
                return;
            }
        }

        // --- Eval Phase ---
        if (autoEval) {
            console.log(`\n📊 Auto-running evaluation...`);
            commands['feature-eval']([featureNum, '--force']);
        } else {
            console.log(`\n📊 Ready for evaluation:`);
            console.log(`   aigon feature-eval ${featureNum}`);
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
                    const content = fs.readFileSync(path.join(logsDir, file), 'utf8');
                    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
                    if (fmMatch) {
                        const sm = fmMatch[1].match(/status:\s*(\S+)/);
                        if (sm) status = sm[1];
                        const um = fmMatch[1].match(/updated:\s*(\S+)/);
                        if (um) {
                            const d = new Date(um[1]);
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
            commands['sessions-close']([id]);
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
        const effectiveConfig = getEffectiveConfig();
        const conductorConfig = effectiveConfig.conductor || {};
        let agentIds = positionalAgents.length > 0
            ? positionalAgents
            : (conductorConfig.defaultAgents || ['cc', 'gg']);

        const availableAgents = getAvailableAgents();
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

        if (existingFindings.length === 0) {
            console.log(`\n🔬 Research Autopilot: Research ${researchNum} — ${researchDesc}`);
            console.log(`   Setting up Fleet research with ${agentIds.length} agents: ${agentIds.join(', ')}`);
            commands['research-setup']([researchId, ...agentIds]);
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

        const spawnedAgents = [];
        agentIds.forEach(agentId => {
            const sessionName = buildResearchTmuxSessionName(researchNum, agentId);
            const findingsFile = path.join(logsDir, `research-${researchNum}-${agentId}-findings.md`);

            // Check if already submitted
            if (fs.existsSync(findingsFile)) {
                try {
                    const fileContent = fs.readFileSync(findingsFile, 'utf8');
                    const fmMatch = fileContent.match(/^---\n([\s\S]*?)\n---\n/);
                    if (fmMatch) {
                        const sm = fmMatch[1].match(/status:\s*(\S+)/);
                        if (sm && sm[1] === 'submitted') {
                            console.log(`   ✓ ${agentId} — already submitted, skipping`);
                            spawnedAgents.push({ agent: agentId, alreadySubmitted: true });
                            return;
                        }
                    }
                } catch (e) { /* proceed */ }
            }

            // Kill existing session (check both old and new naming)
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
                        const findingsFile = path.join(logsDir, `research-${researchNum}-${agent}-findings.md`);
                        let status = 'unknown';
                        let updatedStr = '';
                        try {
                            const fileContent = fs.readFileSync(findingsFile, 'utf8');
                            const fmMatch = fileContent.match(/^---\n([\s\S]*?)\n---\n/);
                            if (fmMatch) {
                                const sm = fmMatch[1].match(/status:\s*(\S+)/);
                                if (sm) status = sm[1];
                                const um = fmMatch[1].match(/updated:\s*(\S+)/);
                                if (um) {
                                    const d = new Date(um[1]);
                                    const diffMs = Date.now() - d.getTime();
                                    const diffMin = Math.floor(diffMs / 60000);
                                    updatedStr = diffMin < 1 ? 'just now' : `${diffMin}m ago`;
                                }
                            }
                        } catch (e) { /* skip */ }

                        if (status === 'submitted' && previousStatuses[agent] !== 'submitted') {
                            try {
                                execSync(`osascript -e 'display notification "Agent ${agent} submitted Research #${researchNum}" with title "Aigon Research Autopilot"'`);
                            } catch (e) { /* notification failed */ }
                        }
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
                        try {
                            execSync(`osascript -e 'display notification "All agents submitted for Research #${researchNum}" with title "Aigon Research Autopilot"'`);
                        } catch (e) { /* notification failed */ }
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
            commands['research-synthesize']([researchNum]);
        } else {
            console.log(`\n📊 Ready for synthesis:`);
            console.log(`   aigon research-synthesize ${researchNum}`);
        }
    },

    'radar': async (args) => {
        const options = parseCliOptions(args);
        const sub = options._[0];

        if (getOptionValue(options, 'daemon') !== undefined) {
            const daemonPortRaw = getOptionValue(options, 'port');
            const daemonPort = daemonPortRaw !== undefined ? parseInt(String(daemonPortRaw), 10) : RADAR_DEFAULT_PORT;
            runRadarServiceDaemon(daemonPort);
            return;
        }

        const meta = readRadarMeta();
        const configuredPortRaw = getOptionValue(options, 'port');
        const port = configuredPortRaw !== undefined
            ? parseInt(String(configuredPortRaw), 10)
            : (meta && Number.isInteger(meta.port) ? meta.port : RADAR_DEFAULT_PORT);
        if (!Number.isInteger(port) || port <= 0 || port > 65535) {
            console.error('❌ Invalid port. Use: --port <1-65535>');
            process.exitCode = 1;
            return;
        }

        if (sub === 'start') {
            const pid = isRadarAlive();
            if (pid) {
                console.log(`⚠️  Radar already running (PID ${pid})`);
                console.log('   Run: aigon radar stop');
                return;
            }

            if (fs.existsSync(RADAR_PID_FILE)) fs.unlinkSync(RADAR_PID_FILE);
            removeRadarMeta();
            fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });

            const { spawn } = require('child_process');
            const child = spawn(process.execPath, [__filename, 'radar', '--daemon', `--port=${port}`], {
                detached: true,
                stdio: 'ignore',
                env: process.env
            });
            child.unref();
            fs.writeFileSync(RADAR_PID_FILE, String(child.pid));
            writeRadarMeta({ pid: child.pid, port, startedAt: new Date().toISOString() });
            console.log(`✅ Radar started (PID ${child.pid})`);
            console.log(`   API:       http://127.0.0.1:${port}/api/status`);
            console.log(`   Dashboard: http://127.0.0.1:${port}`);
            console.log(`📋 Logs: ${RADAR_LOG_FILE}`);
            return;
        }

        if (sub === 'stop') {
            const pid = isRadarAlive();
            if (!pid) {
                console.log('⛔ Radar is not running.');
                if (fs.existsSync(RADAR_PID_FILE)) fs.unlinkSync(RADAR_PID_FILE);
                removeRadarMeta();
                return;
            }
            try {
                process.kill(pid, 'SIGTERM');
                if (fs.existsSync(RADAR_PID_FILE)) fs.unlinkSync(RADAR_PID_FILE);
                removeRadarMeta();
                console.log(`✅ Radar stopped (PID ${pid})`);
            } catch (e) {
                console.error(`❌ Failed to stop radar: ${e.message}`);
                process.exitCode = 1;
            }
            return;
        }

        if (sub === 'status') {
            const pid = isRadarAlive();
            const statusPort = meta && Number.isInteger(meta.port) ? meta.port : RADAR_DEFAULT_PORT;
            console.log(`Radar:     ${pid ? `✅ running (PID ${pid})` : '⛔ stopped'}`);
            if (pid) {
                console.log(`Port:      ${statusPort}`);
                console.log(`Dashboard: http://127.0.0.1:${statusPort}`);
            }

            const repos = readConductorReposFromGlobalConfig();
            if (repos.length === 0) {
                console.log('Repos:     (none — run: aigon radar add)');
            } else {
                console.log(`Repos (${repos.length}):`);
                repos.forEach(r => console.log(`  ${r}`));
            }

            if (pid) {
                try {
                    const payload = await requestRadarJson('/api/status', statusPort);
                    const summary = payload.summary || {};
                    console.log(`Summary:   ${summary.total || 0} total · ${summary.implementing || 0} implementing · ${summary.waiting || 0} waiting · ${summary.submitted || 0} submitted · ${summary.error || 0} error`);
                } catch (e) {
                    console.log(`Summary:   unavailable (${e.message})`);
                }
            }
            return;
        }

        if (sub === 'add') {
            const repoPath = path.resolve(options._[1] || process.cwd());
            const repos = readConductorReposFromGlobalConfig();
            if (repos.includes(repoPath)) {
                console.log(`⚠️  Already registered: ${repoPath}`);
                return;
            }
            repos.push(repoPath);
            writeRepoRegistry(repos);
            console.log(`✅ Registered: ${repoPath}`);
            console.log(`   Total repos: ${repos.length}`);
            return;
        }

        if (sub === 'remove') {
            const repoPath = path.resolve(options._[1] || process.cwd());
            const repos = readConductorReposFromGlobalConfig();
            const idx = repos.indexOf(repoPath);
            if (idx === -1) {
                console.log(`⚠️  Not registered: ${repoPath}`);
                return;
            }
            repos.splice(idx, 1);
            writeRepoRegistry(repos);
            console.log(`✅ Removed: ${repoPath}`);
            return;
        }

        if (sub === 'list') {
            const repos = readConductorReposFromGlobalConfig();
            if (repos.length === 0) {
                console.log('No repos registered. Run: aigon radar add');
                return;
            }
            console.log(`Watched repos (${repos.length}):`);
            repos.forEach(r => console.log(`  ${r}`));
            return;
        }

        if (sub === 'open') {
            const url = `http://127.0.0.1:${port}`;
            const noOpen = getOptionValue(options, 'no-open') !== undefined;
            const screenshot = getOptionValue(options, 'screenshot') !== undefined;
            const output = String(getOptionValue(options, 'output') || path.join(process.cwd(), 'docs', 'assets', 'dashboard-screenshot.png'));
            const widthRaw = getOptionValue(options, 'width');
            const heightRaw = getOptionValue(options, 'height');
            const width = widthRaw !== undefined ? parseInt(String(widthRaw), 10) : 1280;
            const height = heightRaw !== undefined ? parseInt(String(heightRaw), 10) : 800;

            if (screenshot) {
                const healthy = await waitForHealthy(url, 15000, 400);
                if (!healthy) {
                    console.error('❌ Radar is not running or not healthy.');
                    process.exitCode = 1;
                    return;
                }
                try {
                    const result = await captureDashboardScreenshot(url, output, width, height);
                    console.log(`📸 Screenshot saved: ${output}`);
                    console.log(`   Capture method: ${result.method}`);
                } catch (e) {
                    console.error(`❌ Screenshot failed: ${e.message}`);
                    process.exitCode = 1;
                }
                return;
            }

            if (!noOpen) {
                try { openInBrowser(url); } catch (e) { console.warn(`⚠️  Could not open browser: ${e.message}`); }
            }
            console.log(`🌐 Radar dashboard: ${url}`);
            return;
        }

        if (sub === 'install') {
            if (process.platform !== 'darwin') {
                console.error('❌ radar install currently supports macOS launchd only.');
                process.exitCode = 1;
                return;
            }
            try {
                const plistPath = writeRadarLaunchdPlist(port);
                const uid = process.getuid ? process.getuid() : null;
                if (uid !== null) {
                    try { execSync(`launchctl bootout gui/${uid} ${shellQuote(plistPath)}`, { stdio: 'ignore' }); } catch (e) { /* ignore */ }
                    try { execSync(`launchctl bootstrap gui/${uid} ${shellQuote(plistPath)}`, { stdio: 'ignore' }); } catch (e) {
                        execSync(`launchctl load ${shellQuote(plistPath)}`, { stdio: 'ignore' });
                    }
                } else {
                    execSync(`launchctl load ${shellQuote(plistPath)}`, { stdio: 'ignore' });
                }
                console.log(`✅ Installed launchd service: ${plistPath}`);
                console.log('   Radar will start automatically on login.');
            } catch (e) {
                console.error(`❌ Failed to install launchd service: ${e.message}`);
                process.exitCode = 1;
            }
            return;
        }

        if (sub === 'uninstall') {
            if (process.platform !== 'darwin') {
                console.error('❌ radar uninstall currently supports macOS launchd only.');
                process.exitCode = 1;
                return;
            }
            const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.aigon.radar.plist');
            try {
                const uid = process.getuid ? process.getuid() : null;
                if (fs.existsSync(plistPath)) {
                    if (uid !== null) {
                        try { execSync(`launchctl bootout gui/${uid} ${shellQuote(plistPath)}`, { stdio: 'ignore' }); } catch (e) {
                            try { execSync(`launchctl unload ${shellQuote(plistPath)}`, { stdio: 'ignore' }); } catch (_) { /* ignore */ }
                        }
                    } else {
                        try { execSync(`launchctl unload ${shellQuote(plistPath)}`, { stdio: 'ignore' }); } catch (e) { /* ignore */ }
                    }
                    fs.unlinkSync(plistPath);
                    console.log(`✅ Removed launchd service: ${plistPath}`);
                } else {
                    console.log('⚠️  Launchd service not installed.');
                }
            } catch (e) {
                console.error(`❌ Failed to uninstall launchd service: ${e.message}`);
                process.exitCode = 1;
            }
            return;
        }

        if (sub === 'menubar-render') {
            try {
                const payload = await requestRadarJson('/api/status', port);
                renderRadarMenubarFromStatus(payload, port);
            } catch (e) {
                console.log('⚙ offline');
                console.log('---');
                console.log(`Radar offline (port ${port})`);
                console.log(`Start Radar | bash="${process.execPath}" param1="${__filename}" param2=radar param3=start terminal=false`);
            }
            return;
        }

        if (sub === 'menubar-install') {
            const swiftBarApp = '/Applications/SwiftBar.app';
            const xbarApp = '/Applications/xbar.app';
            const swiftBarDir = path.join(os.homedir(), '.swiftbar');
            const xbarDir = path.join(os.homedir(), 'Library', 'Application Support', 'xbar', 'plugins');

            let pluginDir;
            let appName;

            if (fs.existsSync(swiftBarApp)) {
                pluginDir = swiftBarDir;
                appName = 'SwiftBar';
            } else if (fs.existsSync(xbarApp)) {
                pluginDir = xbarDir;
                appName = 'xbar';
            } else {
                console.error('❌ Neither SwiftBar nor xbar found in /Applications/');
                console.error('');
                console.error('   Install SwiftBar (recommended):');
                console.error('   brew install --cask swiftbar');
                console.error('');
                console.error('   Or install xbar:');
                console.error('   brew install --cask xbar');
                process.exitCode = 1;
                return;
            }

            if (!fs.existsSync(pluginDir)) fs.mkdirSync(pluginDir, { recursive: true });
            const pluginPath = path.join(pluginDir, 'aigon.30s.sh');
            const pluginContent = `#!/bin/bash
# Aigon Radar Menubar Plugin
# Installed by: aigon radar menubar-install
# Refresh: every 30 seconds (.30s. in filename)

"${process.execPath}" "${__filename}" radar menubar-render
`;
            fs.writeFileSync(pluginPath, pluginContent);
            fs.chmodSync(pluginPath, '755');

            console.log(`✅ Menubar plugin installed for ${appName}`);
            console.log(`   Plugin: ${pluginPath}`);
            console.log('   Refresh: every 30 seconds');
            if (readConductorReposFromGlobalConfig().length === 0) {
                console.log('   ⚠️  No repos registered. Run: aigon radar add');
            }
            return;
        }

        if (sub === 'menubar-uninstall') {
            const swiftBarPlugin = path.join(os.homedir(), '.swiftbar', 'aigon.30s.sh');
            const xbarPlugin = path.join(os.homedir(), 'Library', 'Application Support', 'xbar', 'plugins', 'aigon.30s.sh');

            let removed = false;
            if (fs.existsSync(swiftBarPlugin)) {
                fs.unlinkSync(swiftBarPlugin);
                console.log(`✅ Removed SwiftBar plugin: ${swiftBarPlugin}`);
                removed = true;
            }
            if (fs.existsSync(xbarPlugin)) {
                fs.unlinkSync(xbarPlugin);
                console.log(`✅ Removed xbar plugin: ${xbarPlugin}`);
                removed = true;
            }
            if (!removed) {
                console.log('⚠️  No menubar plugin found to remove.');
            }
            return;
        }

        if (sub === 'vscode-install') {
            const vsixPath = path.join(__dirname, 'vscode-extension', 'aigon-conductor-1.0.0.vsix');
            if (!fs.existsSync(vsixPath)) {
                console.error(`❌ Extension bundle not found: ${vsixPath}`);
                console.error('   Try rebuilding: cd vscode-extension && npm run package');
                process.exitCode = 1;
                return;
            }
            try {
                execSync('code --version', { stdio: 'ignore' });
                execSync(`code --install-extension "${vsixPath}" --force`, { stdio: 'inherit' });
                console.log('✅ Aigon extension installed. Reload VS Code to activate.');
            } catch (e) {
                console.error(`❌ Installation failed: ${e.message}`);
                process.exitCode = 1;
            }
            return;
        }

        if (sub === 'vscode-uninstall') {
            try {
                execSync('code --version', { stdio: 'ignore' });
                execSync('code --uninstall-extension aigon.aigon-conductor', { stdio: 'inherit' });
                console.log('✅ Aigon extension uninstalled.');
            } catch (e) {
                console.error(`❌ Uninstall failed: ${e.message}`);
                process.exitCode = 1;
            }
            return;
        }

        console.log('Usage: aigon radar <subcommand>\n');
        console.log('Subcommands:');
        console.log('  start [--port <N>]      Start Radar service in the background');
        console.log('  stop                    Stop Radar service');
        console.log('  status                  Show Radar state, repos, and summary');
        console.log('  add [path]              Register a repo (default: cwd)');
        console.log('  remove [path]           Unregister a repo (default: cwd)');
        console.log('  list                    List registered repos');
        console.log('  open                    Open dashboard in browser');
        console.log('  install                 Install launchd auto-start service (macOS)');
        console.log('  uninstall               Remove launchd service (macOS)');
        console.log('  menubar-install         Install SwiftBar/xbar plugin');
        console.log('  menubar-uninstall       Remove SwiftBar/xbar plugin');
        console.log('  menubar-render          Render menubar output (plugin internal)');
        console.log('  vscode-install          Install VS Code extension');
        console.log('  vscode-uninstall        Uninstall VS Code extension');
    },

    'conductor': (args) => {
        const CONDUCTOR_PID_FILE = path.join(GLOBAL_CONFIG_DIR, 'conductor.pid');
        const CONDUCTOR_LOG_FILE = path.join(GLOBAL_CONFIG_DIR, 'conductor.log');

        // --- Helpers ---

        function readConductorRepos() {
            try {
                if (!fs.existsSync(GLOBAL_CONFIG_PATH)) return [];
                const cfg = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf8'));
                return Array.isArray(cfg.repos) ? cfg.repos : [];
            } catch (e) {
                return [];
            }
        }

        function writeConductorRepos(repos) {
            let cfg = {};
            try {
                if (fs.existsSync(GLOBAL_CONFIG_PATH)) {
                    cfg = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf8'));
                }
            } catch (e) { /* start fresh */ }
            cfg.repos = repos;
            if (!fs.existsSync(GLOBAL_CONFIG_DIR)) fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
            fs.writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
        }

        function isDaemonAlive() {
            if (!fs.existsSync(CONDUCTOR_PID_FILE)) return false;
            try {
                const pid = parseInt(fs.readFileSync(CONDUCTOR_PID_FILE, 'utf8').trim(), 10);
                process.kill(pid, 0);
                return pid;
            } catch (e) {
                return false;
            }
        }

        function parseFrontMatterStatus(content) {
            const m = content.match(/^---\n([\s\S]*?)\n---\n/);
            if (!m) return null;
            const sm = m[1].match(/status:\s*(\S+)/);
            return sm ? sm[1] : null;
        }

        // --- Daemon implementation (runs as detached child) ---

        function runConductorDaemon() {
            const { execSync: exec } = require('child_process');

            function log(msg) {
                try {
                    fs.appendFileSync(CONDUCTOR_LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
                } catch (e) { /* ignore */ }
            }

            // Write our own PID (complements what the parent wrote — same value)
            fs.writeFileSync(CONDUCTOR_PID_FILE, String(process.pid));
            log(`Conductor daemon started (PID ${process.pid})`);

            // In-memory state: log file key -> last status
            const lastStatus = {};
            // Track which feature+repo combos have had all-submitted notification sent
            const allSubmittedNotified = new Set();

            function sendNotification(message, title) {
                try {
                    exec(`osascript -e 'display notification "${message}" with title "${title}"'`);
                } catch (e) {
                    log(`Notification failed: ${e.message}`);
                }
            }

            function poll() {
                let repos;
                try {
                    repos = readConductorRepos();
                } catch (e) {
                    log(`Error reading config: ${e.message}`);
                    return;
                }

                repos.forEach(repoPath => {
                    // Collect log files from main repo + worktrees
                    const mainLogsDir = path.join(repoPath, 'docs', 'specs', 'features', 'logs');
                    const allLogEntries = []; // { logFile, logPath }

                    // Main repo logs
                    if (fs.existsSync(mainLogsDir)) {
                        try {
                            fs.readdirSync(mainLogsDir)
                                .filter(f => /^feature-\d+-.+-log\.md$/.test(f))
                                .forEach(f => allLogEntries.push({ logFile: f, logPath: path.join(mainLogsDir, f) }));
                        } catch (e) {
                            log(`Error reading logs dir ${mainLogsDir}: ${e.message}`);
                        }
                    }

                    // Worktree logs
                    const worktreeBaseDir = repoPath + '-worktrees';
                    if (fs.existsSync(worktreeBaseDir)) {
                        try {
                            fs.readdirSync(worktreeBaseDir).forEach(dirName => {
                                const wtLogsDir = path.join(worktreeBaseDir, dirName, 'docs', 'specs', 'features', 'logs');
                                if (!fs.existsSync(wtLogsDir)) return;
                                try {
                                    fs.readdirSync(wtLogsDir)
                                        .filter(f => /^feature-\d+-.+-log\.md$/.test(f))
                                        .forEach(f => allLogEntries.push({ logFile: f, logPath: path.join(wtLogsDir, f) }));
                                } catch (e) { /* skip */ }
                            });
                        } catch (e) { /* skip */ }
                    }

                    if (allLogEntries.length === 0) return;

                    // Deduplicate: same logFile name may appear in main + worktree; prefer worktree (more up-to-date)
                    const byName = {};
                    allLogEntries.forEach(entry => {
                        byName[entry.logFile] = entry; // last wins = worktree overwrites main
                    });
                    const logEntries = Object.values(byName);

                    // Per-feature tracking for all-submitted notification
                    const featureAgents = {}; // featureId -> { total, submitted, name }

                    logEntries.forEach(({ logFile, logPath }) => {
                        let content;
                        try { content = fs.readFileSync(logPath, 'utf8'); } catch (e) { return; }

                        const status = parseFrontMatterStatus(content) || 'unknown';
                        const key = `${repoPath}:${logFile}`;
                        const prev = lastStatus[key];
                        lastStatus[key] = status;

                        // Parse feature ID and agent
                        const arenaM = logFile.match(/^feature-(\d+)-([a-z]{2})-(.+)-log\.md$/);
                        const soloM = logFile.match(/^feature-(\d+)-(.+)-log\.md$/);
                        const featureId = arenaM ? arenaM[1] : (soloM ? soloM[1] : null);
                        const agent = arenaM ? arenaM[2] : 'solo';
                        const featureName = arenaM ? arenaM[3] : (soloM ? soloM[2] : featureId);

                        if (!featureId) return;

                        // Track totals for all-submitted check
                        if (!featureAgents[featureId]) featureAgents[featureId] = { total: 0, submitted: 0, name: featureName };
                        featureAgents[featureId].total++;
                        if (status === 'submitted') featureAgents[featureId].submitted++;

                        // Notify on transition to waiting
                        if (prev !== undefined && prev !== 'waiting' && status === 'waiting') {
                            const repoName = path.basename(repoPath);
                            sendNotification(
                                `${agent} is waiting on #${featureId} ${featureName}`,
                                `Aigon · ${repoName}`
                            );
                            log(`Notified: ${agent} waiting on #${featureId} in ${repoName}`);
                        }
                    });

                    // Check all-submitted per feature
                    Object.entries(featureAgents).forEach(([featureId, data]) => {
                        const allKey = `${repoPath}:${featureId}`;
                        if (data.total > 0 && data.submitted === data.total && !allSubmittedNotified.has(allKey)) {
                            allSubmittedNotified.add(allKey);
                            const repoName = path.basename(repoPath);
                            sendNotification(
                                `All agents submitted #${featureId} ${data.name} — ready for eval`,
                                `Aigon · ${repoName}`
                            );
                            log(`Notified: all submitted #${featureId} in ${repoName}`);
                        }
                        // Reset if no longer all submitted (e.g. new agent added)
                        if (data.submitted < data.total) {
                            allSubmittedNotified.delete(allKey);
                        }
                    });
                });

                log(`Poll complete (${repos.length} repo${repos.length !== 1 ? 's' : ''})`);
            }

            // Initial poll then every 30 seconds
            try { poll(); } catch (e) { log(`Poll error: ${e.message}`); }
            setInterval(() => {
                try { poll(); } catch (e) { log(`Poll error: ${e.message}`); }
            }, 30000);

            // Keep process alive
            process.stdin.resume();
        }

        // --- Subcommand dispatch ---

        const sub = args[0];
        const deprecatedMap = {
            start: 'start',
            stop: 'stop',
            status: 'status',
            add: 'add',
            remove: 'remove',
            list: 'list',
            'vscode-install': 'vscode-install',
            'vscode-uninstall': 'vscode-uninstall',
            'menubar-install': 'menubar-install',
            'menubar-uninstall': 'menubar-uninstall',
            'menubar-render': 'menubar-render',
        };

        if (deprecatedMap[sub]) {
            if (sub !== 'menubar-render') {
                console.log(`⚠ 'aigon conductor ${sub}' is deprecated — use 'aigon radar ${deprecatedMap[sub]}' instead.`);
            }
            return commands.radar([deprecatedMap[sub], ...args.slice(1)]);
        }

        // Internal: daemon mode (called as detached child)
        if (sub === '--daemon') {
            return runConductorDaemon();
        }

        if (sub === 'start') {
            const pid = isDaemonAlive();
            if (pid) {
                console.log(`⚠️  Conductor already running (PID ${pid})`);
                console.log(`   Run: aigon conductor stop`);
                return;
            }
            // Clear stale PID file
            if (fs.existsSync(CONDUCTOR_PID_FILE)) fs.unlinkSync(CONDUCTOR_PID_FILE);

            const { spawn } = require('child_process');
            const child = spawn(process.execPath, [__filename, 'conductor', '--daemon'], {
                detached: true,
                stdio: 'ignore',
                env: process.env
            });
            child.unref();
            if (!fs.existsSync(GLOBAL_CONFIG_DIR)) fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
            fs.writeFileSync(CONDUCTOR_PID_FILE, String(child.pid));
            console.log(`✅ Conductor started (PID ${child.pid})`);
            console.log(`   Polling every 30s across ${readConductorRepos().length} repo(s)`);
            console.log(`📋 Logs: ${CONDUCTOR_LOG_FILE}`);
            return;
        }

        if (sub === 'stop') {
            const pid = isDaemonAlive();
            if (!pid) {
                console.log('⛔ Conductor is not running.');
                if (fs.existsSync(CONDUCTOR_PID_FILE)) fs.unlinkSync(CONDUCTOR_PID_FILE);
                return;
            }
            try {
                process.kill(pid, 'SIGTERM');
                fs.unlinkSync(CONDUCTOR_PID_FILE);
                console.log(`✅ Conductor stopped (PID ${pid})`);
            } catch (e) {
                console.error(`❌ Failed to stop conductor: ${e.message}`);
            }
            return;
        }

        if (sub === 'status') {
            const pid = isDaemonAlive();
            console.log(`Conductor: ${pid ? `✅ running (PID ${pid})` : '⛔ stopped'}`);

            const repos = readConductorRepos();
            if (repos.length === 0) {
                console.log('Repos:     (none — run: aigon conductor add)');
            } else {
                console.log(`Repos (${repos.length}):`);
                repos.forEach(r => console.log(`  ${r}`));
            }

            // Last log line
            if (fs.existsSync(CONDUCTOR_LOG_FILE)) {
                const lines = fs.readFileSync(CONDUCTOR_LOG_FILE, 'utf8').trim().split('\n');
                const last = lines[lines.length - 1];
                if (last) console.log(`Last poll: ${last}`);
            }

            // Show currently waiting agents
            const waiting = [];
            repos.forEach(repoPath => {
                const logsDir = path.join(repoPath, 'docs', 'specs', 'features', 'logs');
                if (!fs.existsSync(logsDir)) return;
                fs.readdirSync(logsDir)
                    .filter(f => /^feature-\d+-.+-log\.md$/.test(f))
                    .forEach(logFile => {
                        try {
                            const content = fs.readFileSync(path.join(logsDir, logFile), 'utf8');
                            const status = parseFrontMatterStatus(content);
                            if (status === 'waiting') {
                                const arenaM = logFile.match(/^feature-(\d+)-([a-z]{2})-(.+)-log\.md$/);
                                const soloM = logFile.match(/^feature-(\d+)-(.+)-log\.md$/);
                                const featureId = arenaM ? arenaM[1] : soloM?.[1];
                                const agent = arenaM ? arenaM[2] : 'solo';
                                const name = arenaM ? arenaM[3] : soloM?.[2];
                                waiting.push(`  ${path.basename(repoPath)}: #${featureId} ${name} (${agent})`);
                            }
                        } catch (e) { /* skip */ }
                    });
            });
            if (waiting.length > 0) {
                console.log(`Waiting agents (${waiting.length}):`);
                waiting.forEach(w => console.log(w));
            } else if (repos.length > 0) {
                console.log('Waiting:   none');
            }
            return;
        }

        if (sub === 'add') {
            const repoPath = path.resolve(args[1] || process.cwd());
            const repos = readConductorRepos();
            if (repos.includes(repoPath)) {
                console.log(`⚠️  Already registered: ${repoPath}`);
                return;
            }
            repos.push(repoPath);
            writeConductorRepos(repos);
            console.log(`✅ Registered: ${repoPath}`);
            console.log(`   Total repos: ${repos.length}`);
            return;
        }

        if (sub === 'remove') {
            const repoPath = path.resolve(args[1] || process.cwd());
            const repos = readConductorRepos();
            const idx = repos.indexOf(repoPath);
            if (idx === -1) {
                console.log(`⚠️  Not registered: ${repoPath}`);
                return;
            }
            repos.splice(idx, 1);
            writeConductorRepos(repos);
            console.log(`✅ Removed: ${repoPath}`);
            return;
        }

        if (sub === 'list') {
            const repos = readConductorRepos();
            if (repos.length === 0) {
                console.log('No repos registered. Run: aigon conductor add');
                return;
            }
            console.log(`Watched repos (${repos.length}):`);
            repos.forEach(r => console.log(`  ${r}`));
            return;
        }

        if (sub === 'vscode-install') {
            const vsixPath = path.join(__dirname, 'vscode-extension', 'aigon-conductor-1.0.0.vsix');
            if (!fs.existsSync(vsixPath)) {
                console.error(`❌ Extension bundle not found: ${vsixPath}`);
                console.error(`   Try rebuilding: cd vscode-extension && npm run package`);
                return;
            }
            // Check code CLI is available
            try {
                execSync('code --version', { stdio: 'ignore' });
            } catch (e) {
                console.error('❌ VS Code CLI not found. Make sure "code" is in your PATH.');
                console.error('   In VS Code: Cmd+Shift+P → "Shell Command: Install \'code\' command in PATH"');
                return;
            }
            console.log('📦 Installing Aigon Conductor extension...');
            try {
                execSync(`code --install-extension "${vsixPath}" --force`, { stdio: 'inherit' });
                console.log('✅ Aigon Conductor installed. Reload VS Code to activate.');
            } catch (e) {
                console.error(`❌ Installation failed: ${e.message}`);
            }
            return;
        }

        if (sub === 'vscode-uninstall') {
            try {
                execSync('code --version', { stdio: 'ignore' });
            } catch (e) {
                console.error('❌ VS Code CLI not found.');
                return;
            }
            console.log('🗑️  Uninstalling Aigon Conductor extension...');
            try {
                execSync('code --uninstall-extension aigon.aigon-conductor', { stdio: 'inherit' });
                console.log('✅ Aigon Conductor uninstalled.');
            } catch (e) {
                console.error(`❌ Uninstall failed: ${e.message}`);
            }
            return;
        }

        if (sub === 'menubar-render') {
            const repos = readConductorRepos();
            if (repos.length === 0) {
                console.log('⚙ –');
                console.log('---');
                console.log('No repos registered');
                console.log('Run: aigon conductor add | href=https://github.com/jviner/aigon');
                return;
            }

            const nodeExec = process.execPath;
            const aigonScript = __filename;
            let waitingCount = 0;
            let implementingCount = 0;
            const sections = [];
            const attentionItems = []; // { repoShort, fid, name, reason, action }

            repos.forEach(repoPath => {
                const inProgressDir = path.join(repoPath, 'docs', 'specs', 'features', '03-in-progress');
                const inEvalDir = path.join(repoPath, 'docs', 'specs', 'features', '04-in-evaluation');
                const logsDir = path.join(repoPath, 'docs', 'specs', 'features', 'logs');

                // Source of truth: specs in 03-in-progress/ and 04-in-evaluation/
                let specFiles = []; // { file, stage: 'in-progress' | 'in-evaluation' }
                const stageDirs = [
                    { dir: inProgressDir, stage: 'in-progress' },
                    { dir: inEvalDir, stage: 'in-evaluation' }
                ];
                stageDirs.forEach(({ dir, stage }) => {
                    if (fs.existsSync(dir)) {
                        try {
                            fs.readdirSync(dir)
                                .filter(f => /^feature-\d+-.+\.md$/.test(f))
                                .forEach(f => specFiles.push({ file: f, stage }));
                        } catch (e) { /* skip */ }
                    }
                });

                if (specFiles.length === 0) return;

                // Build a map of log statuses for enrichment
                const logStatuses = {}; // key: "featureId" or "featureId-agent" -> status

                // Collect all log directories: main repo + worktrees
                const allLogDirs = [];
                if (fs.existsSync(logsDir)) allLogDirs.push(logsDir);
                const worktreeBaseDir = repoPath + '-worktrees';
                if (fs.existsSync(worktreeBaseDir)) {
                    try {
                        fs.readdirSync(worktreeBaseDir).forEach(dirName => {
                            const wtLogsDir = path.join(worktreeBaseDir, dirName, 'docs', 'specs', 'features', 'logs');
                            if (fs.existsSync(wtLogsDir)) allLogDirs.push(wtLogsDir);
                        });
                    } catch (e) { /* skip */ }
                }

                allLogDirs.forEach(logDir => {
                    try {
                        fs.readdirSync(logDir)
                            .filter(f => /^feature-\d+-.+-log\.md$/.test(f))
                            .forEach(logFile => {
                                const logPath = path.join(logDir, logFile);
                                let content;
                                try { content = fs.readFileSync(logPath, 'utf8'); } catch (e) { return; }
                                const status = parseFrontMatterStatus(content);

                                const arenaM = logFile.match(/^feature-(\d+)-([a-z]{2})-(.+)-log\.md$/);
                                const soloM = logFile.match(/^feature-(\d+)-(.+)-log\.md$/);
                                const featureId = arenaM ? arenaM[1] : (soloM ? soloM[1] : null);
                                const agent = arenaM ? arenaM[2] : null;

                                if (!featureId) return;
                                if (agent) {
                                    logStatuses[`${featureId}-${agent}`] = status || 'implementing';
                                } else {
                                    logStatuses[featureId] = status || 'implementing';
                                }
                            });
                    } catch (e) { /* skip */ }
                });

                // Discover worktrees for this repo to detect fleet agents
                const worktreeAgents = {}; // featureId -> [agent, agent, ...]
                if (fs.existsSync(worktreeBaseDir)) {
                    try {
                        fs.readdirSync(worktreeBaseDir).forEach(dirName => {
                            const wtM = dirName.match(/^feature-(\d+)-([a-z]{2})-.+$/);
                            if (wtM) {
                                const fid = wtM[1];
                                if (!worktreeAgents[fid]) worktreeAgents[fid] = [];
                                worktreeAgents[fid].push(wtM[2]);
                            }
                        });
                    } catch (e) { /* skip */ }
                }

                // Group by feature from specs, enrich with log status + worktree agents
                const features = {};
                specFiles.forEach(({ file: specFile, stage }) => {
                    const m = specFile.match(/^feature-(\d+)-(.+)\.md$/);
                    if (!m) return;
                    const featureId = m[1];
                    const featureName = m[2];

                    if (!features[featureId]) features[featureId] = { name: featureName, agents: [], stage };

                    // Collect known agents from both log files and worktrees
                    const agentSet = new Set();
                    Object.keys(logStatuses)
                        .filter(k => k.startsWith(`${featureId}-`) && k.includes('-'))
                        .forEach(k => agentSet.add(k.split('-').slice(1).join('-')));
                    if (worktreeAgents[featureId]) {
                        worktreeAgents[featureId].forEach(a => agentSet.add(a));
                    }

                    if (agentSet.size > 0) {
                        // Fleet mode: multiple agents (from logs and/or worktrees)
                        agentSet.forEach(agent => {
                            const status = logStatuses[`${featureId}-${agent}`] || 'implementing';
                            features[featureId].agents.push({ agent, status });
                            if (status === 'waiting') waitingCount++;
                            else if (status === 'implementing') implementingCount++;
                        });
                    } else {
                        // Solo mode: single log or no log
                        const status = logStatuses[featureId] || 'implementing';
                        features[featureId].agents.push({ agent: 'solo', status });
                        if (status === 'waiting') waitingCount++;
                        else if (status === 'implementing') implementingCount++;
                    }
                });

                if (Object.keys(features).length === 0) return;

                const repoShort = repoPath.replace(os.homedir(), '~');
                const lines = [];
                lines.push(repoShort + ' | size=14');

                Object.entries(features).sort((a, b) => a[0].localeCompare(b[0])).forEach(([fid, data]) => {
                    lines.push(`#${fid} ${data.name} | size=13`);
                    data.agents.forEach(({ agent, status }) => {
                        const icon = status === 'waiting' ? '●' : status === 'submitted' ? '✓' : '○';
                        const focusParams = agent === 'solo'
                            ? `param1="${aigonScript}" param2=terminal-focus param3=${fid} param4=--repo param5="${repoPath}"`
                            : `param1="${aigonScript}" param2=terminal-focus param3=${fid} param4=${agent} param5=--repo param6="${repoPath}"`;
                        const paddedId = String(fid).padStart(2, '0');
                        const slashCmd = `/afd ${paddedId}`;

                        lines.push(`-- ${icon} ${agent}: ${status} | bash="${nodeExec}" ${focusParams} terminal=false`);
                        lines.push(`-- ${icon} ${agent}: ${status} — copy cmd | alternate=true bash=/bin/bash param1=-c param2="echo '${slashCmd}' | pbcopy" terminal=false`);
                    });

                    // Detect attention-worthy states
                    const hasWaiting = data.agents.some(a => a.status === 'waiting');
                    const allSubmitted = data.agents.length > 0 && data.agents.every(a => a.status === 'submitted');
                    const paddedFid = String(fid).padStart(2, '0');

                    if (data.stage === 'in-evaluation') {
                        // Check eval file for progress
                        const evalsDir = path.join(repoPath, 'docs', 'specs', 'features', 'evaluations');
                        const evalFile = path.join(evalsDir, `feature-${fid}-eval.md`);
                        let evalReason = 'Evaluating';
                        if (fs.existsSync(evalFile)) {
                            try {
                                const content = fs.readFileSync(evalFile, 'utf8');
                                const winnerMatch = content.match(/\*\*Winner[:\s]*\*?\*?\s*(.+)/i);
                                if (winnerMatch) {
                                    const val = winnerMatch[1].replace(/\*+/g, '').trim();
                                    if (val && !val.includes('to be determined') && !val.includes('TBD') && val !== '()') {
                                        evalReason = 'Pick winner';
                                    }
                                }
                            } catch (e) { /* skip */ }
                        }
                        attentionItems.push({ repoShort, repoPath, fid, name: data.name, reason: evalReason, action: `/afe ${paddedFid}`, actionLabel: 'Continue eval' });
                    } else if (allSubmitted) {
                        attentionItems.push({ repoShort, repoPath, fid, name: data.name, reason: 'All agents submitted', action: `/afe ${paddedFid}`, actionLabel: 'Run eval' });
                    } else if (hasWaiting) {
                        const waitingAgents = data.agents.filter(a => a.status === 'waiting').map(a => a.agent).join(', ');
                        attentionItems.push({ repoShort, repoPath, fid, name: data.name, reason: `${waitingAgents} waiting`, action: null, actionLabel: 'Focus agent' });
                    }
                });

                sections.push(lines);
            });

            // Menubar title
            if (attentionItems.length > 0) {
                console.log(`⚙ ${attentionItems.length} need${attentionItems.length === 1 ? 's' : ''} attention`);
            } else if (waitingCount > 0) {
                console.log(`⚙ ${waitingCount} waiting`);
            } else if (implementingCount > 0) {
                console.log(`⚙ ${implementingCount} running`);
            } else {
                console.log('⚙ –');
            }
            console.log('---');

            // Needs Attention section (pinned to top)
            if (attentionItems.length > 0) {
                console.log('⚠ Needs Attention | size=14');
                attentionItems.forEach(item => {
                    const repoName = path.basename(item.repoPath);
                    const paddedId = String(item.fid).padStart(2, '0');
                    const label = `#${item.fid} ${item.name}: ${item.reason}`;
                    if (item.action) {
                        // Clicking copies the action command
                        console.log(`-- ${label} | bash=/bin/bash param1=-c param2="echo '${item.action}' | pbcopy" terminal=false`);
                        console.log(`-- ${label} — copy: ${item.action} | alternate=true bash=/bin/bash param1=-c param2="echo '${item.action}' | pbcopy" terminal=false`);
                    } else {
                        // Focus the waiting agent
                        console.log(`-- ${label} | bash="${nodeExec}" param1="${aigonScript}" param2=terminal-focus param3=${item.fid} param4=--repo param5="${item.repoPath}" terminal=false`);
                    }
                });
                console.log('---');
            }

            if (sections.length === 0) {
                console.log('No active features');
            } else {
                sections.forEach((lines, i) => {
                    if (i > 0) console.log('---');
                    lines.forEach(l => console.log(l));
                });
            }

            console.log('---');
            console.log('Refresh | refresh=true');
            return;
        }

        if (sub === 'menubar-install') {
            // Detect SwiftBar or xbar
            const swiftBarApp = '/Applications/SwiftBar.app';
            const xbarApp = '/Applications/xbar.app';
            const swiftBarDir = path.join(os.homedir(), '.swiftbar');
            const xbarDir = path.join(os.homedir(), 'Library', 'Application Support', 'xbar', 'plugins');

            let pluginDir;
            let appName;

            if (fs.existsSync(swiftBarApp)) {
                pluginDir = swiftBarDir;
                appName = 'SwiftBar';
            } else if (fs.existsSync(xbarApp)) {
                pluginDir = xbarDir;
                appName = 'xbar';
            } else {
                console.error('❌ Neither SwiftBar nor xbar found in /Applications/');
                console.error('');
                console.error('   Install SwiftBar (recommended):');
                console.error('   brew install --cask swiftbar');
                console.error('');
                console.error('   Or install xbar:');
                console.error('   brew install --cask xbar');
                return;
            }

            if (!fs.existsSync(pluginDir)) {
                fs.mkdirSync(pluginDir, { recursive: true });
            }

            const pluginPath = path.join(pluginDir, 'aigon.30s.sh');
            const nodeExec = process.execPath;
            const aigonScript = __filename;

            const pluginContent = `#!/bin/bash
# Aigon Conductor Menubar Plugin
# Installed by: aigon conductor menubar-install
# Refresh: every 30 seconds (.30s. in filename)

"${nodeExec}" "${aigonScript}" conductor menubar-render
`;

            fs.writeFileSync(pluginPath, pluginContent);
            fs.chmodSync(pluginPath, '755');

            console.log(`✅ Menubar plugin installed for ${appName}`);
            console.log(`   Plugin: ${pluginPath}`);
            console.log(`   Refresh: every 30 seconds`);
            console.log('');
            console.log(`   Make sure ${appName} is running to see the menubar icon.`);
            if (readConductorRepos().length === 0) {
                console.log('');
                console.log('   ⚠️  No repos registered. Run: aigon conductor add');
            }
            return;
        }

        if (sub === 'menubar-uninstall') {
            const swiftBarPlugin = path.join(os.homedir(), '.swiftbar', 'aigon.30s.sh');
            const xbarPlugin = path.join(os.homedir(), 'Library', 'Application Support', 'xbar', 'plugins', 'aigon.30s.sh');

            let removed = false;
            if (fs.existsSync(swiftBarPlugin)) {
                fs.unlinkSync(swiftBarPlugin);
                console.log(`✅ Removed SwiftBar plugin: ${swiftBarPlugin}`);
                removed = true;
            }
            if (fs.existsSync(xbarPlugin)) {
                fs.unlinkSync(xbarPlugin);
                console.log(`✅ Removed xbar plugin: ${xbarPlugin}`);
                removed = true;
            }
            if (!removed) {
                console.log('⚠️  No menubar plugin found to remove.');
            }
            return;
        }

        // Default: show usage
        console.log('Usage: aigon conductor <subcommand>\n');
        console.log('Subcommands:');
        console.log('  start              Start the background daemon');
        console.log('  stop               Stop the daemon');
        console.log('  status             Show daemon state, watched repos, waiting agents');
        console.log('  add [path]         Register a repo (default: cwd)');
        console.log('  remove [path]      Unregister a repo (default: cwd)');
        console.log('  list               List registered repos');
        console.log('  vscode-install     Install the Aigon VS Code extension');
        console.log('  vscode-uninstall   Uninstall the Aigon VS Code extension');
        console.log('  menubar-install    Install SwiftBar/xbar menubar plugin');
        console.log('  menubar-uninstall  Remove the menubar plugin');
        console.log('  menubar-render     Output menubar plugin content (used by plugin)');
    },

    'dashboard': async (args) => {
        console.log(`⚠ 'aigon dashboard' is deprecated — use 'aigon radar open' instead.`);
        return commands.radar(['open', ...args]);
    },

    'terminal-focus': (args) => {
        // Parse --repo flag from args
        let repoFlag = null;
        const filteredArgs = [];
        for (let i = 0; i < args.length; i++) {
            if (args[i] === '--repo' && args[i + 1]) {
                repoFlag = args[i + 1];
                i++; // skip value
            } else if (args[i].startsWith('--repo=')) {
                repoFlag = args[i].slice('--repo='.length);
            } else {
                filteredArgs.push(args[i]);
            }
        }

        const featureId = filteredArgs[0];
        if (!featureId) {
            console.error('Usage: aigon terminal-focus <featureId> [agent] [--repo <path>]');
            console.error('  Opens or focuses the terminal for a running feature agent.');
            return;
        }
        const requestedAgent = filteredArgs[1] || null;

        // Resolve terminal preference: project config > global config > default
        const effectiveConfig = getEffectiveConfig();
        const terminal = effectiveConfig.terminal || 'warp';

        const repoPath = repoFlag || process.cwd();

        // Scan worktrees directory directly (works cross-repo, no git dependency)
        const worktreeBaseDir = repoPath + '-worktrees';
        const worktrees = [];
        if (fs.existsSync(worktreeBaseDir)) {
            try {
                fs.readdirSync(worktreeBaseDir).forEach(dirName => {
                    const wtM = dirName.match(/^feature-(\d+)-([a-z]{2})-(.+)$/);
                    if (wtM) {
                        const wtPath = path.join(worktreeBaseDir, dirName);
                        worktrees.push({
                            path: wtPath,
                            featureId: wtM[1],
                            agent: wtM[2],
                            desc: wtM[3],
                            mtime: fs.existsSync(wtPath) ? fs.statSync(wtPath).mtime : new Date(0)
                        });
                    }
                });
            } catch (e) { /* skip */ }
        }

        // Also try git worktree list if in the right repo
        if (worktrees.length === 0) {
            try {
                const found = findWorktrees();
                worktrees.push(...found);
            } catch (e) { /* skip */ }
        }

        const matching = filterByFeatureId(worktrees, featureId);

        if (matching.length > 0) {
            let target;
            if (requestedAgent) {
                target = matching.find(wt => wt.agent === requestedAgent);
                if (!target) {
                    console.error(`❌ No worktree found for feature #${featureId} agent ${requestedAgent}`);
                    console.error(`   Available: ${matching.map(wt => wt.agent).join(', ')}`);
                    return;
                }
            } else {
                // Pick most recently modified
                target = matching.sort((a, b) => b.mtime - a.mtime)[0];
            }

            const focusCommand = terminal === 'tmux'
                ? buildAgentCommand(target)
                : 'echo "Ready — run your agent command here"';
            openSingleWorktree(target, focusCommand, terminal);
            return;
        }

        // No worktree — solo branch mode. Open terminal at repo root.
        const fakeWt = {
            path: repoPath,
            featureId: String(featureId).padStart(2, '0'),
            agent: requestedAgent || 'solo',
            desc: 'branch-mode'
        };
        const fallbackCommand = terminal === 'tmux' ? '' : 'echo "Ready — run your agent command here"';
        openSingleWorktree(fakeWt, fallbackCommand, terminal);
    },

    'board': (args) => {
        const flags = new Set(args.filter(a => a.startsWith('--')));
        const listMode = flags.has('--list');
        const showFeatures = flags.has('--features');
        const showResearch = flags.has('--research');
        const showAll = flags.has('--all');
        const showActive = flags.has('--active');
        const showInbox = flags.has('--inbox');
        const showBacklog = flags.has('--backlog');
        const showDone = flags.has('--done');
        const showActions = !flags.has('--no-actions');

        // If neither --features nor --research, show both
        const includeFeatures = !showResearch || showFeatures;
        const includeResearch = !showFeatures || showResearch;

        if (listMode) {
            // Detailed list view
            displayBoardListView({
                includeFeatures,
                includeResearch,
                showAll,
                showActive,
                showInbox,
                showBacklog,
                showDone,
                showActions
            });
        } else {
            // Kanban board view
            displayBoardKanbanView({
                includeFeatures,
                includeResearch,
                showAll,
                showActive,
                showInbox,
                showBacklog,
                showDone,
                showActions
            });
        }
    },
    'install-agent': (args) => {
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
            // 1. Create shared workflow documentation (always)
            const workflowPath = path.join(process.cwd(), 'docs', 'development_workflow.md');
            const workflowContent = readTemplate('docs/development_workflow.md');
            const workflowStatus = safeWriteWithStatus(workflowPath, workflowContent);
            if (workflowStatus !== 'unchanged') {
                console.log(`✅ ${workflowStatus.charAt(0).toUpperCase() + workflowStatus.slice(1)}: docs/development_workflow.md`);
            }

            // 2. Create/update shared AGENTS.md root instructions
            const agentsMdStatus = syncAgentsMdFile();
            if (agentsMdStatus !== 'unchanged') {
                console.log(`✅ ${agentsMdStatus.charAt(0).toUpperCase() + agentsMdStatus.slice(1)}: AGENTS.md`);
            }

            // 3. Install each agent using its config
            uniqueAgents.forEach(agentKey => {
                const config = loadAgentConfig(agentKey);
                if (!config) {
                    console.warn(`⚠️  No config found for agent: ${agentKey}`);
                    return;
                }

                console.log(`\n📦 Installing ${config.name} (${config.id})...`);

                // Create/update docs/agents/<agent>.md from template (preserves user additions)
                const agentDocPath = path.join(process.cwd(), 'docs', 'agents', config.agentFile);
                const agentTemplateRaw = readTemplate(config.templatePath);
                // Process template with agent-specific placeholders
                const agentTemplateContent = processTemplate(agentTemplateRaw, config.placeholders);
                // Template already contains markers, extract content between them for upsert
                const markerContentMatch = agentTemplateContent.match(new RegExp(`${MARKER_START}\\n([\\s\\S]*?)\\n${MARKER_END}`));
                const agentContent = markerContentMatch ? markerContentMatch[1] : agentTemplateContent;
                const agentAction = upsertMarkedContent(agentDocPath, agentContent);
                if (agentAction !== 'unchanged') {
                    console.log(`   ✅ ${agentAction.charAt(0).toUpperCase() + agentAction.slice(1)}: docs/agents/${config.agentFile}`);
                }

                // Create/update root <AGENT>.md with markers (if agent uses one)
                if (config.rootFile) {
                    const rootFilePath = path.join(process.cwd(), config.rootFile);
                    const rootContent = getRootFileContent(config);
                    const markedContent = `${MARKER_START}\n${rootContent}\n${MARKER_END}`;

                    if (!fs.existsSync(rootFilePath)) {
                        // First creation: prepend scaffold sections above markers
                        safeWrite(rootFilePath, getScaffoldContent() + markedContent + '\n');
                        console.log(`   ✅ Created: ${config.rootFile}`);
                    } else {
                        // File exists: only update marker content (preserves scaffold & user edits)
                        const action = upsertMarkedContent(rootFilePath, rootContent);
                        if (action !== 'unchanged') {
                            console.log(`   ✅ ${action.charAt(0).toUpperCase() + action.slice(1)}: ${config.rootFile}`);
                        }
                    }
                }

                // Generate and install commands from generic templates
                if (config.commands && config.commands.length > 0 && config.output) {
                    // Expand ~ to home directory for global commands
                    let cmdDir = config.output.commandDir;
                    if (cmdDir.startsWith('~')) {
                        cmdDir = cmdDir.replace('~', process.env.HOME || process.env.USERPROFILE);
                    } else {
                        cmdDir = path.join(process.cwd(), cmdDir);
                    }

                    // Merge profile-derived placeholders into config
                    const profilePlaceholders = getProfilePlaceholders();
                    const mergedConfig = { ...config, placeholders: { ...config.placeholders, ...profilePlaceholders } };

                    let cmdChanges = { created: 0, updated: 0 };
                    mergedConfig.commands.forEach(cmdName => {
                        // Read generic template and process placeholders (includes profile-derived values)
                        const genericContent = readGenericTemplate(`commands/${cmdName}.md`, mergedConfig);
                        const description = extractDescription(genericContent);

                        // Format output based on agent's output format
                        const outputContent = formatCommandOutput(genericContent, description, cmdName, config);

                        // Write to agent's command directory
                        const fileName = `${config.output.commandFilePrefix}${cmdName}${config.output.commandFileExtension}`;
                        const status = safeWriteWithStatus(path.join(cmdDir, fileName), outputContent);
                        if (status === 'created') cmdChanges.created++;
                        else if (status === 'updated') cmdChanges.updated++;

                        // Generate short alias files in parent directory for top-level access
                        // e.g., .claude/commands/fs.md → user types /fs instead of /aigon:feature-submit
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

                    const removed = removeDeprecatedCommands(cmdDir, config);

                    // Clean up deprecated alias files in parent directory
                    // Uses content-based detection: only removes files containing '(shortcut for '
                    const aliasParentDir = path.dirname(cmdDir);
                    const expectedAliasFiles = new Set(
                        Object.keys(COMMAND_ALIASES).map(alias =>
                            `${config.output.commandFilePrefix}${alias}${config.output.commandFileExtension}`
                        )
                    );
                    const removedAliases = [];
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
                            } catch (e) { /* ignore */ }
                        }
                    }

                    // Migrate: clean up old flat commands when agent now uses subdirectory
                    // e.g., CC moved from .claude/commands/aigon-*.md to .claude/commands/aigon/*.md
                    const migrated = migrateOldFlatCommands(cmdDir, config);

                    // Only report if there were actual changes
                    const totalChanges = cmdChanges.created + cmdChanges.updated + removed.length + removedAliases.length + migrated.length;
                    if (totalChanges > 0) {
                        if (config.output.global) {
                            console.log(`   ✅ Installed global prompts: ${config.output.commandDir}`);
                            console.log(`   ⚠️  Note: Codex prompts are global (shared across all projects)`);
                        } else {
                            const parts = [];
                            if (cmdChanges.created > 0) parts.push(`${cmdChanges.created} created`);
                            if (cmdChanges.updated > 0) parts.push(`${cmdChanges.updated} updated`);
                            console.log(`   ✅ Commands: ${parts.join(', ') || 'synced'}`);
                        }
                        if (removed.length > 0) {
                            console.log(`   🧹 Removed ${removed.length} deprecated command(s): ${removed.join(', ')}`);
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

                    // Add allowedTools (Gemini)
                    if (extras.settings.allowedTools) {
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

                    // Add SessionStart hooks (Claude, Gemini — embedded in settings file)
                    if (extras.settings.hooks) {
                        if (!settings.hooks) settings.hooks = {};
                        Object.entries(extras.settings.hooks).forEach(([event, hookConfigs]) => {
                            if (!settings.hooks[event]) settings.hooks[event] = [];
                            hookConfigs.forEach(hookConfig => {
                                // Check if an Aigon hook already exists (by matching command string)
                                const aigonCmd = 'aigon check-version';
                                const alreadyExists = settings.hooks[event].some(existing => {
                                    // Claude/Gemini format: nested hooks array with command field
                                    if (existing.hooks) {
                                        return existing.hooks.some(h => h.command && h.command.includes(aigonCmd));
                                    }
                                    // Flat format: command field directly
                                    return existing.command && existing.command.includes(aigonCmd);
                                });
                                if (!alreadyExists) {
                                    settings.hooks[event].push(hookConfig);
                                    settingsChanged = true;
                                }
                            });
                        });
                        if (settingsChanged) {
                            console.log(`   🔄 Added SessionStart hook to ${extras.settings.path}`);
                        }
                    }

                    // Only write if something changed
                    const newContent = JSON.stringify(settings, null, 2);
                    if (newContent !== existingContent) {
                        safeWrite(settingsPath, newContent);
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
                        Object.entries(hookContent.hooks).forEach(([event, hookConfigs]) => {
                            if (!hooksFile.hooks[event]) hooksFile.hooks[event] = [];
                            hookConfigs.forEach(hookConfig => {
                                const aigonCmd = 'aigon check-version';
                                const alreadyExists = hooksFile.hooks[event].some(existing =>
                                    existing.command && existing.command.includes(aigonCmd)
                                );
                                if (!alreadyExists) {
                                    hooksFile.hooks[event].push(hookConfig);
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

                // Codex: config.toml (uses legacy template - not generic)
                if (extras.config && extras.config.enabled) {
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

            const agentNames = uniqueAgents.map(a => {
                const cfg = loadAgentConfig(a);
                return cfg ? cfg.name : a;
            }).join(', ');
            console.log(`\n🎉 Installed Aigon for: ${agentNames}`);
            showPortSummary();

            // Ensure .aigon/.board-map.json is in .gitignore
            ensureBoardMapInGitignore();

            // Update installed version
            const currentVersion = getAigonVersion();
            if (currentVersion) {
                setInstalledVersion(currentVersion);
            }

            // Git commit suggestion - only if there are actual changes
            try {
                const gitStatus = execSync('git status --porcelain docs/ AGENTS.md CLAUDE.md .claude/ .cursor/ .codex/ .gemini/ 2>/dev/null', { encoding: 'utf8' });
                if (gitStatus.trim()) {
                    console.log(`\n📝 To commit these changes:`);
                    console.log(`   git add docs/ AGENTS.md CLAUDE.md .claude/ .cursor/ .codex/ .gemini/ 2>/dev/null; git commit -m "chore: install Aigon v${currentVersion || 'latest'}"`);
                }
            } catch (e) {
                // Not a git repo or git not available - skip suggestion
            }

        } catch (e) {
            console.error(`❌ Failed: ${e.message}`);
        }
    },
    'check-version': (args = []) => {
        const currentVersion = getAigonVersion();
        const installedVersion = getInstalledVersion();

        if (!currentVersion) {
            console.error('❌ Could not determine Aigon CLI version');
            process.exit(1);
        }

        if (!installedVersion || compareVersions(currentVersion, installedVersion) !== 0) {
            const from = installedVersion || 'unknown';
            console.log(`🔄 Aigon version mismatch (project: ${from}, CLI: ${currentVersion}). Updating...`);
            commands['update'](args);
        } else {
            console.log(`✅ Aigon is up to date (v${currentVersion})`);
        }
    },
    'update': (args = []) => {
        const currentVersion = getAigonVersion();
        const installedVersion = getInstalledVersion();

        console.log("🔄 Updating Aigon installation...");
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
            const installedAgents = [];
            const legacyGeminiRootPath = path.join(process.cwd(), 'GEMINI.md');
            const legacyCodexPromptPath = path.join(process.cwd(), '.codex', 'prompt.md');
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

                const isInstalled =
                    (rootFilePath && fs.existsSync(rootFilePath)) ||
                    (docsAgentPath && fs.existsSync(docsAgentPath)) ||
                    (localCommandDir && fs.existsSync(localCommandDir)) ||
                    (settingsPath && fs.existsSync(settingsPath)) ||
                    (configPath && fs.existsSync(configPath)) ||
                    (agentId === 'gg' && fs.existsSync(legacyGeminiRootPath)) ||
                    (agentId === 'cx' && fs.existsSync(legacyCodexPromptPath));

                if (isInstalled) {
                    installedAgents.push(agentId);
                }
            });

            const uniqueInstalledAgents = [...new Set(installedAgents)];

            // 1.5 Migration notices for legacy root files
            if (fs.existsSync(legacyGeminiRootPath) || fs.existsSync(legacyCodexPromptPath)) {
                console.log(`⚠️  Migration notice: AGENTS.md is now the shared root instruction file.`);
                if (fs.existsSync(legacyGeminiRootPath)) {
                    console.log(`   - Detected legacy GEMINI.md. New installs no longer generate this file.`);
                }
                if (fs.existsSync(legacyCodexPromptPath)) {
                    console.log(`   - Detected legacy .codex/prompt.md. New installs no longer generate this file.`);
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
                console.log(`\nℹ️  No agents detected. Run 'aigon install-agent <cc|gg|cx|cu>' to install.`);
            }

            // 6. Update installed version
            if (currentVersion) {
                setInstalledVersion(currentVersion);
            }

            // Summary - version changed OR file changes means we updated
            const versionChanged = installedVersion && currentVersion && installedVersion !== currentVersion;
            let hasFileChanges = false;
            const aigonPaths = 'docs/ AGENTS.md CLAUDE.md .claude/ .cursor/ .codex/ .gemini/ .aigon/';
            try {
                const gitStatus = execSync(`git status --porcelain ${aigonPaths} 2>/dev/null`, { encoding: 'utf8' });
                hasFileChanges = gitStatus.trim().length > 0;
            } catch (e) {
                // Not a git repo - can't determine
            }

            if (versionChanged || hasFileChanges) {
                console.log(`\n✅ Aigon updated to v${currentVersion || 'unknown'}.`);
                showPortSummary();
                if (hasFileChanges) {
                    if (noCommit) {
                        console.log(`\n📝 To commit these changes:`);
                        console.log(`   git add ${aigonPaths} 2>/dev/null; git commit -m "chore: update Aigon to v${currentVersion || 'latest'}"`);
                    } else {
                        try {
                            execSync(`git add ${aigonPaths} 2>/dev/null`, { encoding: 'utf8' });
                            execSync(`git commit -m "chore: update Aigon to v${currentVersion || 'latest'}"`, { encoding: 'utf8' });
                            console.log(`\n📦 Committed Aigon update (v${currentVersion || 'latest'}).`);
                        } catch (e) {
                            console.log(`\n⚠️  Could not auto-commit: ${e.message}`);
                            console.log(`   git add ${aigonPaths} 2>/dev/null; git commit -m "chore: update Aigon to v${currentVersion || 'latest'}"`);
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

    'hooks': (args) => {
        const subcommand = args[0] || 'list';

        if (subcommand === 'list') {
            const hooks = getDefinedHooks();

            if (hooks.length === 0) {
                console.log(`\n🪝 No hooks defined.`);
                console.log(`\n   Create hooks in: docs/aigon-hooks.md`);
                console.log(`\n   Example format:`);
                console.log(`   ## pre-feature-setup`);
                console.log(`   \`\`\`bash`);
                console.log(`   echo "Setting up feature $AIGON_FEATURE_ID in $AIGON_MODE mode"`);
                console.log(`   \`\`\``);
                return;
            }

            console.log(`\n🪝 Defined Hooks (${hooks.length}):\n`);

            // Group by command
            const byCommand = {};
            hooks.forEach(hook => {
                if (!byCommand[hook.command]) {
                    byCommand[hook.command] = [];
                }
                byCommand[hook.command].push(hook);
            });

            Object.entries(byCommand).forEach(([command, cmdHooks]) => {
                console.log(`   ${command}:`);
                cmdHooks.forEach(hook => {
                    const preview = hook.script.split('\n')[0].substring(0, 50);
                    console.log(`      ${hook.type}: ${preview}${hook.script.length > 50 ? '...' : ''}`);
                });
            });

            console.log(`\n   Hooks file: docs/aigon-hooks.md`);
        } else {
            console.error(`Unknown hooks subcommand: ${subcommand}`);
            console.error(`Usage: aigon hooks [list]`);
        }
    },

    'config': (args) => {
        const subcommand = args[0];

        if (subcommand === 'init') {
            const { scope } = parseConfigScope(args.slice(1));

            if (scope === 'global') {
                // Create global config file
                if (!fs.existsSync(GLOBAL_CONFIG_DIR)) {
                    fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
                }

                if (fs.existsSync(GLOBAL_CONFIG_PATH)) {
                    console.log(`ℹ️  Config already exists: ${GLOBAL_CONFIG_PATH}`);
                    console.log(`   Edit it to customize agent CLI commands.`);
                    return;
                }

                fs.writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(DEFAULT_GLOBAL_CONFIG, null, 2));
                console.log(`✅ Created: ${GLOBAL_CONFIG_PATH}`);
                console.log(`\n   The config includes default "yolo mode" flags that auto-approve commands.`);
                console.log(`   To use stricter permissions, set implementFlag to "" (empty string) for any agent.`);
                console.log(`\n   You can customize:`);
                console.log(`   - terminal: Terminal to use (warp, code, cursor, terminal, tmux)`);
                console.log(`   - tmuxApp: Terminal app for tmux sessions (terminal, iterm2)`);
                console.log(`   - agents.{id}.cli: Override CLI command for each agent`);
                console.log(`   - agents.{id}.implementFlag: Override CLI flags (set to "" to require manual approval)`);
                console.log(`\n   Example (corporate/safer defaults - removes auto-approval flags):`);
                console.log(`   {`);
                console.log(`     "terminal": "warp",             // warp, code, cursor, terminal, tmux`);
                console.log(`     "tmuxApp": "iterm2",            // terminal (Terminal.app) or iterm2`);
                console.log(`     "agents": {`);
                console.log(`       "cc": { "cli": "claude", "implementFlag": "" },`);
                console.log(`       "cu": { "cli": "agent", "implementFlag": "" },`);
                console.log(`       "gg": { "cli": "gemini", "implementFlag": "" },`);
                console.log(`       "cx": { "cli": "codex", "implementFlag": "" }`);
                console.log(`     }`);
                console.log(`   }`);
                console.log(`\n   Default flags (can be overridden):`);
                console.log(`   - cc: --permission-mode acceptEdits`);
                console.log(`   - cu: --force`);
                console.log(`   - gg: --yolo`);
                console.log(`   - cx: (none; interactive by default, --full-auto is applied only in --autonomous mode)`);
            } else {
                // Create project config file with detected profile
                const detectedProfile = detectProjectProfile();
                const projectConfig = {
                    profile: detectedProfile
                };
                
                if (fs.existsSync(PROJECT_CONFIG_PATH)) {
                    console.log(`ℹ️  Config already exists: ${PROJECT_CONFIG_PATH}`);
                    console.log(`   Edit it to customize project settings.`);
                    return;
                }

                saveProjectConfig(projectConfig);
                console.log(`✅ Created: ${PROJECT_CONFIG_PATH}`);
                console.log(`\n   Profile: ${detectedProfile} (auto-detected)`);
                console.log(`\n   You can customize:`);
                console.log(`   - profile: Project profile (web, api, ios, android, library, generic)`);
                console.log(`   - fleet.testInstructions: Custom test instructions`);
                console.log(`   - agents.{id}.cli: Override CLI command for each agent`);
                console.log(`   - agents.{id}.implementFlag: Override CLI flags`);
                console.log(`\n💡 Run 'aigon update' to regenerate templates with the new profile.`);
            }
        } else if (subcommand === 'set') {
            const { scope, remainingArgs } = parseConfigScope(args.slice(1));
            
            if (remainingArgs.length < 2) {
                console.error(`Usage: aigon config set [--global|--project] <key> <value>`);
                console.error(`\n  --global   - Set in global config (~/.aigon/config.json)`);
                console.error(`  --project   - Set in project config (.aigon/config.json) [default]`);
                console.error(`\n  Examples:`);
                console.error(`    aigon config set profile web`);
                console.error(`    aigon config set --global terminal warp`);
                console.error(`    aigon config set fleet.testInstructions "run npm test"`);
                return;
            }
            
            const key = remainingArgs[0];
            const value = remainingArgs.slice(1).join(' '); // Join remaining args in case value has spaces
            
            // Try to parse as JSON if it looks like JSON, otherwise treat as string
            let parsedValue = value;
            if ((value.startsWith('{') && value.endsWith('}')) || 
                (value.startsWith('[') && value.endsWith(']'))) {
                try {
                    parsedValue = JSON.parse(value);
                } catch (e) {
                    // Not valid JSON, use as string
                }
            } else if (value === 'true') {
                parsedValue = true;
            } else if (value === 'false') {
                parsedValue = false;
            } else if (value === 'null') {
                parsedValue = null;
            } else if (/^-?\d+$/.test(value)) {
                parsedValue = parseInt(value, 10);
            } else if (/^-?\d+\.\d+$/.test(value)) {
                parsedValue = parseFloat(value);
            }
            
            if (scope === 'global') {
                const config = loadGlobalConfig();
                setNestedValue(config, key, parsedValue);
                saveGlobalConfig(config);
                console.log(`✅ Set ${key} = ${JSON.stringify(parsedValue)}`);
                console.log(`   Saved to: ${GLOBAL_CONFIG_PATH}`);
            } else {
                const config = loadProjectConfig();
                setNestedValue(config, key, parsedValue);
                saveProjectConfig(config);
                console.log(`✅ Set ${key} = ${JSON.stringify(parsedValue)}`);
                console.log(`   Saved to: ${PROJECT_CONFIG_PATH}`);
            }
        } else if (subcommand === 'get') {
            if (args.length < 2) {
                console.error(`Usage: aigon config get <key>`);
                console.error(`\n  Examples:`);
                console.error(`    aigon config get profile`);
                console.error(`    aigon config get terminal`);
                console.error(`    aigon config get fleet.testInstructions`);
                return;
            }
            
            const key = args[1];
            const result = getConfigValueWithProvenance(key);
            
            if (result.value === undefined) {
                console.log(`❌ Config key "${key}" not found`);
                return;
            }
            
            const valueStr = typeof result.value === 'string' ? result.value : JSON.stringify(result.value);
            let sourceStr;
            if (result.source === 'project') {
                sourceStr = `.aigon/config.json`;
            } else if (result.source === 'global') {
                sourceStr = `~/.aigon/config.json`;
            } else {
                sourceStr = `default`;
            }
            
            console.log(`${valueStr} (from ${sourceStr})`);
        } else if (subcommand === 'show') {
            // For 'show', check flags directly (don't default to project - default to merged)
            const hasGlobal = args.slice(1).includes('--global');
            const hasProject = args.slice(1).includes('--project');
            
            if (hasGlobal) {
                const config = loadGlobalConfig();
                console.log(`\n📋 Global Configuration (~/.aigon/config.json):\n`);
                console.log(JSON.stringify(config, null, 2));
                console.log(`\n   Config file: ${GLOBAL_CONFIG_PATH}`);
                console.log(`   Exists: ${fs.existsSync(GLOBAL_CONFIG_PATH) ? 'yes' : 'no (using defaults)'}`);
            } else if (hasProject) {
                const config = loadProjectConfig();
                console.log(`\n📋 Project Configuration (.aigon/config.json):\n`);
                if (Object.keys(config).length === 0) {
                    console.log(`   (empty - using auto-detection)`);
                } else {
                    console.log(JSON.stringify(config, null, 2));
                }
                console.log(`\n   Config file: ${PROJECT_CONFIG_PATH}`);
                console.log(`   Exists: ${fs.existsSync(PROJECT_CONFIG_PATH) ? 'yes' : 'no (using auto-detection)'}`);
            } else {
                // Show merged effective config (default for 'show')
                const effectiveConfig = getEffectiveConfig();
                
                console.log(`\n📋 Effective Configuration (merged from all levels):\n`);
                console.log(JSON.stringify(effectiveConfig, null, 2));
                console.log(`\n   Precedence: project > global > defaults`);
                console.log(`\n   Project config: ${PROJECT_CONFIG_PATH}`);
                console.log(`   ${fs.existsSync(PROJECT_CONFIG_PATH) ? '✅ exists' : '❌ not found (using auto-detection)'}`);
                console.log(`\n   Global config: ${GLOBAL_CONFIG_PATH}`);
                console.log(`   ${fs.existsSync(GLOBAL_CONFIG_PATH) ? '✅ exists' : '❌ not found (using defaults)'}`);
            }
        } else if (subcommand === 'models') {
            const agents = getAvailableAgents();
            const taskTypes = ['research', 'implement', 'evaluate'];
            // Agents without --model CLI flag support
            const noModelFlag = new Set(['cu']);

            const rows = [];
            for (const agentId of agents) {
                const agentConfig = loadAgentConfig(agentId);
                if (!agentConfig) continue;

                for (const taskType of taskTypes) {
                    const provenance = getModelProvenance(agentId, taskType);
                    let model, source;
                    if (noModelFlag.has(agentId)) {
                        model = '(n/a — no CLI flag)';
                        source = '-';
                    } else if (provenance.source === 'none') {
                        model = '(not set)';
                        source = '-';
                    } else {
                        model = provenance.value;
                        source = provenance.source;
                    }
                    rows.push({ agent: agentId, task: taskType, model, source });
                }
            }

            // Calculate column widths
            const colAgent = Math.max(5, ...rows.map(r => r.agent.length));
            const colTask = Math.max(10, ...rows.map(r => r.task.length));
            const colModel = Math.max(5, ...rows.map(r => r.model.length));
            const colSource = Math.max(6, ...rows.map(r => r.source.length));

            console.log(`\nModel Configuration (resolved):\n`);
            console.log(`  ${'AGENT'.padEnd(colAgent + 2)}${'TASK'.padEnd(colTask + 2)}${'MODEL'.padEnd(colModel + 2)}SOURCE`);
            console.log(`  ${'─'.repeat(colAgent)}  ${'─'.repeat(colTask)}  ${'─'.repeat(colModel)}  ${'─'.repeat(colSource)}`);

            for (const row of rows) {
                console.log(`  ${row.agent.padEnd(colAgent + 2)}${row.task.padEnd(colTask + 2)}${row.model.padEnd(colModel + 2)}${row.source}`);
            }

            console.log(`\n  Precedence: env var > project config > global config > template default`);
            console.log(`  Env var pattern: AIGON_{AGENT}_{TASK}_MODEL (e.g. AIGON_CC_RESEARCH_MODEL=haiku)`);
        } else {
            console.error(`Usage: aigon config <init|set|get|show|models>`);
            console.error(`\n  init [--global]     - Initialize config (project by default, --global for user-wide)`);
            console.error(`  set [--global] <key> <value>`);
            console.error(`                       - Set config value (project by default)`);
            console.error(`  get <key>           - Get config value with provenance`);
            console.error(`  show [--global|--project]`);
            console.error(`                       - Show config (merged by default, --global or --project for specific level)`);
            console.error(`  models              - Show resolved model configuration for all agents`);
            console.error(`\n  Examples:`);
            console.error(`    aigon config init                    # Create project config`);
            console.error(`    aigon config init --global           # Create global config`);
            console.error(`    aigon config set profile web        # Set project profile`);
            console.error(`    aigon config set --global terminal warp`);
            console.error(`    aigon config get profile             # Show value + source`);
            console.error(`    aigon config show                   # Show merged config`);
            console.error(`    aigon config show --project         # Show project config only`);
            console.error(`    aigon config models                 # Show model config for all agents`);
        }
    },

    'profile': (args) => {
        const subcommand = args[0] || 'show';

        if (subcommand === 'show') {
            const profile = getActiveProfile();
            const projectConfig = loadProjectConfig();
            console.log(`\n📋 Project Profile: ${profile.name}${profile.detected ? ' (auto-detected)' : ' (set in .aigon/config.json)'}`);
            console.log(`\n   Dev server: ${profile.devServer.enabled ? 'enabled' : 'disabled'}`);
            if (profile.devServer.enabled) {
                showPortSummary();
            }
            console.log(`\n   Test instructions:`);
            profile.testInstructions.split('\n').forEach(line => console.log(`     ${line}`));
            if (profile.depCheck) {
                console.log(`\n   Dependency check: yes`);
            }
            if (profile.setupEnvLine) {
                console.log(`   .env.local setup: yes`);
            }
            console.log(`\n   Config file: ${PROJECT_CONFIG_PATH}`);
            console.log(`   Exists: ${fs.existsSync(PROJECT_CONFIG_PATH) ? 'yes' : 'no (using auto-detection)'}`);
            if (Object.keys(projectConfig).length > 0) {
                console.log(`\n   Raw config:`);
                console.log(`   ${JSON.stringify(projectConfig, null, 2).split('\n').join('\n   ')}`);
            }
        } else if (subcommand === 'set') {
            const profileName = args[1];
            if (!profileName) {
                console.error(`Usage: aigon profile set <type>`);
                console.error(`\nAvailable profiles: ${Object.keys(PROFILE_PRESETS).join(', ')}`);
                return;
            }
            if (!PROFILE_PRESETS[profileName]) {
                console.error(`❌ Unknown profile: ${profileName}`);
                console.error(`Available profiles: ${Object.keys(PROFILE_PRESETS).join(', ')}`);
                return;
            }
            const projectConfig = loadProjectConfig();
            projectConfig.profile = profileName;
            saveProjectConfig(projectConfig);
            console.log(`✅ Profile set to: ${profileName}`);
            console.log(`   Saved to: ${PROJECT_CONFIG_PATH}`);
            console.log(`\n💡 Run 'aigon update' to regenerate templates with the new profile.`);
        } else if (subcommand === 'detect') {
            const detected = detectProjectProfile();
            console.log(`\n🔍 Auto-detected profile: ${detected}`);
            const preset = PROFILE_PRESETS[detected];
            console.log(`   Dev server: ${preset.devServer.enabled ? 'enabled' : 'disabled'}`);
            if (preset.devServer.enabled && Object.keys(preset.devServer.ports).length > 0) {
                console.log(`   Ports: ${Object.entries(preset.devServer.ports).map(([k, v]) => `${k}=${v}`).join(', ')}`);
            }
            const projectConfig = loadProjectConfig();
            if (projectConfig.profile) {
                console.log(`\n   ⚠️  Note: .aigon/config.json overrides detection with profile "${projectConfig.profile}"`);
            }
        } else {
            console.error(`Usage: aigon profile [show|set|detect]`);
            console.error(`\n  show    - Display current profile and settings`);
            console.error(`  set     - Set project profile (web, api, ios, android, library, generic)`);
            console.error(`  detect  - Show what auto-detection would choose`);
        }
    },

    'worktree-open': (args) => {
        // Parse arguments: collect feature IDs, flags, and optional agent code
        const featureIds = [];
        let agentCode = null;
        let terminalOverride = null;
        let allFlag = false;

        args.forEach(arg => {
            if (arg.startsWith('--terminal=')) {
                terminalOverride = arg.split('=')[1];
            } else if (arg.startsWith('-t=')) {
                terminalOverride = arg.split('=')[1];
            } else if (arg.startsWith('--agent=')) {
                agentCode = arg.split('=')[1];
            } else if (arg === '--all') {
                allFlag = true;
            } else if (/^\d+$/.test(arg)) {
                featureIds.push(arg);
            } else if (!arg.startsWith('-')) {
                // Legacy: positional agent code (e.g. `worktree-open 55 cc`)
                agentCode = arg;
            }
        });

        if (featureIds.length === 0) {
            console.error(`❌ Feature ID is required.\n`);
            console.error(`Usage:`);
            console.error(`  aigon worktree-open <ID> [agent]         Open single worktree`);
            console.error(`  aigon worktree-open <ID> --all           Open all Fleet worktrees side-by-side`);
            console.error(`  aigon worktree-open <ID> <ID>... [--agent=<code>]`);
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
            return console.error(`❌ No worktrees found.\n\n   Create one with: aigon feature-setup <ID> <agent>`);
        }

        // Determine terminal (project config > global config > default)
        const effectiveConfig = getEffectiveConfig();
        const terminal = terminalOverride || effectiveConfig.terminal;

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
                    // Pick first match (if --agent filtered, there's 1; otherwise exactly 1 exists)
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

            if (terminal === 'warp') {
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
            } else if (terminal === 'tmux') {
                console.log(`\n🚀 Opening ${worktreeConfigs.length} features via tmux sessions:`);
                worktreeConfigs.forEach(wt => {
                    openSingleWorktree(wt, wt.agentCommand, terminal);
                });
            } else {
                console.log(`\n📋 Parallel worktrees for features ${idsLabel}:`);
                console.log(`   (Side-by-side launch requires Warp terminal. Use --terminal=warp)\n`);
                worktreeConfigs.forEach(wt => {
                    console.log(`   Feature ${wt.featureId} (${wt.agent}):`);
                    console.log(`     cd ${wt.path}`);
                    console.log(`     ${wt.agentCommand}\n`);
                });
            }
        } else if (allFlag) {
            // --- ARENA MODE: all agents for one feature side-by-side ---
            const featureId = featureIds[0];
            const paddedId = String(featureId).padStart(2, '0');
            let worktrees = filterByFeatureId(allWorktrees, featureId);

            if (worktrees.length === 0) {
                return console.error(`❌ No worktrees found for feature ${featureId}.\n\n   Create worktrees with: aigon feature-setup ${featureId} cc gg`);
            }

            if (worktrees.length < 2) {
                return console.error(`❌ Only 1 worktree found for feature ${featureId}. Use \`aigon worktree-open ${featureId}\` for single worktrees.\n\n   To add more agents: aigon feature-setup ${featureId} cc gg cx`);
            }

            // Sort by port offset order (cc=+1, gg=+2, cx=+3, cu=+4)
            const agentOrder = ['cc', 'gg', 'cx', 'cu'];
            worktrees.sort((a, b) => {
                const aIdx = agentOrder.indexOf(a.agent);
                const bIdx = agentOrder.indexOf(b.agent);
                return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
            });

            const profile = getActiveProfile();
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

            if (terminal === 'warp') {
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
            } else if (terminal === 'tmux') {
                console.log(`\n🚀 Opening ${worktreeConfigs.length} Fleet worktrees via tmux sessions:`);
                worktreeConfigs.forEach(wt => {
                    openSingleWorktree(wt, wt.agentCommand, terminal);
                });
            } else {
                const desc = worktreeConfigs[0].desc;
                console.log(`\n📋 Fleet worktrees for feature ${paddedId} - ${desc}:`);
                console.log(`   (Side-by-side launch requires Warp terminal. Use --terminal=warp)\n`);
                worktreeConfigs.forEach(wt => {
                    console.log(`   ${wt.agent}:`);
                    console.log(`     cd ${wt.path}`);
                    console.log(`     ${wt.agentCommand}\n`);
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
            openSingleWorktree(selectedWt, agentCommand, terminal);
        }
    },

    'sessions-close': (args) => {
        const id = args.find(a => !a.startsWith('--'));

        if (!id) {
            console.error('Usage: aigon sessions-close <ID>');
            console.error('\n  aigon sessions-close 05   # Kill all agents, tmux sessions + close Warp tab for #05');
            return;
        }

        const paddedId = String(parseInt(id, 10)).padStart(2, '0');

        // Kill agent processes for this ID across all agent types and command types
        const killPatterns = [
            `aigon:feature-do ${paddedId}`,
            `aigon:feature-review ${paddedId}`,
            `aigon:research-do ${paddedId}`,
        ];

        console.log(`\nClosing all agent sessions for #${paddedId}...\n`);

        let foundAny = false;
        killPatterns.forEach(pattern => {
            try {
                // SIGTERM (default) — graceful exit; agents flush buffers and close connections
                execSync(`pkill -f "${pattern}"`, { stdio: 'ignore' });
                foundAny = true;
                console.log(`   ✓ ${pattern}`);
            } catch (e) {
                // pkill exits 1 when no processes match — that's fine
            }
        });

        // Brief wait for processes to exit cleanly, then SIGKILL any stragglers
        if (foundAny) {
            try { execSync('sleep 1', { stdio: 'ignore' }); } catch (e) { /* ignore */ }
            killPatterns.forEach(pattern => {
                try {
                    execSync(`pkill -9 -f "${pattern}"`, { stdio: 'ignore' });
                } catch (e) {
                    // Already exited — this is the expected path
                }
            });
        }

        if (!foundAny) {
            console.log('   (no running agent processes found for this ID)');
        }

        // Kill tmux sessions for this feature ID
        let closedTmuxSessions = 0;
        try {
            const tmuxList = spawnSync('tmux', ['list-sessions', '-F', '#S'], { encoding: 'utf8' });
            if (!tmuxList.error && tmuxList.status === 0) {
                const sessions = tmuxList.stdout
                    .split('\n')
                    .map(line => line.trim())
                    .filter(Boolean);
                sessions.forEach(sessionName => {
                    if (!matchTmuxSessionByEntityId(sessionName, id)) return;

                    const kill = spawnSync('tmux', ['kill-session', '-t', sessionName], { stdio: 'ignore' });
                    if (!kill.error && kill.status === 0) {
                        closedTmuxSessions++;
                        console.log(`   ✓ tmux ${sessionName}`);
                    }
                });
            }
        } catch (e) {
            // No tmux server running or tmux not installed.
        }

        // Try to close the Warp arena tab/window
        const warpTitleHints = [
            `Arena Research: ${paddedId}`,
            `Arena: Feature ${paddedId}`,
        ];

        let warpClosed = false;
        for (const hint of warpTitleHints) {
            if (closeWarpWindow(hint)) {
                warpClosed = true;
            }
        }

        if (warpClosed) {
            console.log('\n✅ Warp Fleet tab closed.');
        } else {
            const tmuxSuffix = closedTmuxSessions > 0 ? ` Closed ${closedTmuxSessions} tmux session(s).` : '';
            console.log(`\n✅ Done. (Close the Warp tab manually if still open.)${tmuxSuffix}`);
        }
    },

    'doctor': (args) => {
        const doRegister = args.includes('--register');
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
            const profile = getActiveProfile();
            if (profile.devServer.enabled) {
                const result = readBasePort();
                const basePort = result ? result.port : 3000;
                const name = path.basename(process.cwd());
                registerPort(name, basePort, process.cwd());
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

        // Also check for overlapping ranges (each project uses base..base+4)
        const rangeConflicts = new Map(); // port -> [conflicting project names]
        const sortedProjects = [...allProjects];
        for (let i = 0; i < sortedProjects.length; i++) {
            for (let j = i + 1; j < sortedProjects.length; j++) {
                const a = sortedProjects[i];
                const b = sortedProjects[j];
                if (a.basePort === b.basePort) continue; // handled by portGroups
                if (Math.abs(a.basePort - b.basePort) < 5) {
                    const key = Math.min(a.basePort, b.basePort);
                    if (!rangeConflicts.has(key)) rangeConflicts.set(key, new Set());
                    rangeConflicts.get(key).add(a.name);
                    rangeConflicts.get(key).add(b.name);
                }
            }
        }

        // Display table
        const homedir = os.homedir();
        const shortenPath = (p) => p.startsWith(homedir) ? '~' + p.slice(homedir.length) : p;

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

            // Check range overlaps for this port group's projects
            for (const project of projects) {
                for (const [, conflictNames] of rangeConflicts) {
                    if (conflictNames.has(project.name) && conflictNames.size > 1) {
                        // Only print range conflict once per group
                    }
                }
            }

            console.log('');
        }

        // Print range conflicts (different base ports but overlapping ranges)
        for (const [, names] of rangeConflicts) {
            const nameArr = [...names];
            const involved = allProjects.filter(p => nameArr.includes(p.name));
            const portsStr = involved.map(p => `${p.name}:${p.basePort}`).join(', ');
            console.log(`  ⚠️  RANGE OVERLAP: ${portsStr} — ranges within 5 of each other`);
            conflictCount++;
        }

        // Summary
        if (conflictCount > 0 || unregisteredCount > 0) {
            const parts = [];
            if (conflictCount > 0) parts.push(`${conflictCount} conflict${conflictCount === 1 ? '' : 's'} found`);
            if (unregisteredCount > 0) parts.push(`${unregisteredCount} unregistered project${unregisteredCount === 1 ? '' : 's'}`);
            console.log(parts.join('. ') + '.');
        } else {
            console.log('No conflicts found.');
        }

        if (unregisteredCount > 0 && !doRegister) {
            console.log(`💡 Run \`aigon doctor --register\` to register the current project.`);
        }

        // --- Model Checks ---
        console.log('\nModel Health Check\n──────────────────');
        const agents = getAvailableAgents();
        const noModelFlag = new Set(['cu']);
        let modelWarnings = 0;
        let modelInfos = 0;

        for (const agentId of agents) {
            const agentConfig = loadAgentConfig(agentId);
            if (!agentConfig) {
                console.log(`  ❌ ${agentId}: Agent template not found`);
                modelWarnings++;
                continue;
            }

            const hasModels = agentConfig.cli?.models && Object.keys(agentConfig.cli.models).length > 0;

            // Warn if Cursor has models configured (they won't be used)
            if (noModelFlag.has(agentId)) {
                const cliConfig = getAgentCliConfig(agentId);
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
                console.log(`  ℹ️  ${agentId} (${agentConfig.name}): No default models in template`);
                modelInfos++;
            } else {
                console.log(`  ✅ ${agentId} (${agentConfig.name}): Template models loaded`);
            }
        }

        console.log('');
        if (modelWarnings > 0) {
            console.log(`${modelWarnings} model warning${modelWarnings === 1 ? '' : 's'}.`);
        } else {
            console.log('No model issues found.');
        }
        console.log(`💡 Run \`aigon config models\` for full model configuration table.`);
    },

    'proxy-setup': async () => {
        console.log('\n🔧 Setting up local dev proxy (Caddy + dnsmasq)...\n');

        // Check for Homebrew
        try {
            execSync('brew --version', { stdio: 'pipe' });
        } catch (e) {
            console.error('❌ Homebrew is required. Install from https://brew.sh');
            return;
        }

        // Install/verify Caddy
        try {
            const version = execSync('caddy version', { stdio: 'pipe' }).toString().trim();
            console.log(`   ✅ Caddy installed: ${version}`);
        } catch (e) {
            console.log('   📦 Installing Caddy...');
            try {
                execSync('brew install caddy', { stdio: 'inherit' });
                console.log('   ✅ Caddy installed');
            } catch (e2) {
                console.error(`   ❌ Failed to install Caddy: ${e2.message}`);
                return;
            }
        }

        // Install/verify dnsmasq
        try {
            execSync('brew list dnsmasq', { stdio: 'pipe' });
            console.log('   ✅ dnsmasq installed');
        } catch (e) {
            console.log('   📦 Installing dnsmasq...');
            try {
                execSync('brew install dnsmasq', { stdio: 'inherit' });
                console.log('   ✅ dnsmasq installed');
            } catch (e2) {
                console.error(`   ❌ Failed to install dnsmasq: ${e2.message}`);
                return;
            }
        }

        // Configure dnsmasq for .test wildcard
        const brewPrefix = execSync('brew --prefix', { stdio: 'pipe' }).toString().trim();
        const dnsmasqConf = path.join(brewPrefix, 'etc', 'dnsmasq.conf');
        const testEntry = 'address=/.test/127.0.0.1';

        try {
            const confContent = fs.existsSync(dnsmasqConf) ? fs.readFileSync(dnsmasqConf, 'utf8') : '';
            if (!confContent.includes(testEntry)) {
                fs.appendFileSync(dnsmasqConf, `\n# Aigon dev proxy — resolve *.test to localhost\n${testEntry}\n`);
                console.log('   ✅ Configured dnsmasq for *.test → 127.0.0.1');
            } else {
                console.log('   ✅ dnsmasq already configured for *.test');
            }
        } catch (e) {
            console.error(`   ❌ Could not configure dnsmasq: ${e.message}`);
            return;
        }

        // Start dnsmasq service
        try {
            execSync('sudo brew services start dnsmasq', { stdio: 'inherit' });
            console.log('   ✅ dnsmasq service started');
        } catch (e) {
            console.warn(`   ⚠️  Could not start dnsmasq: ${e.message}`);
        }

        // Create /etc/resolver/test
        const resolverDir = '/etc/resolver';
        const resolverFile = path.join(resolverDir, 'test');
        try {
            if (fs.existsSync(resolverFile)) {
                console.log('   ✅ /etc/resolver/test already exists');
            } else {
                console.log('\n   📝 Creating /etc/resolver/test (requires sudo)...');
                execSync(`sudo mkdir -p ${resolverDir} && sudo bash -c 'echo "nameserver 127.0.0.1" > ${resolverFile}'`, { stdio: 'inherit' });
                console.log('   ✅ /etc/resolver/test created');
            }
        } catch (e) {
            console.error(`   ❌ Could not create resolver: ${e.message}`);
            console.error(`   Manual fix: sudo mkdir -p /etc/resolver && sudo bash -c 'echo "nameserver 127.0.0.1" > /etc/resolver/test'`);
        }

        // Write initial Caddyfile and configure Caddy via Homebrew service
        if (!fs.existsSync(DEV_PROXY_DIR)) {
            fs.mkdirSync(DEV_PROXY_DIR, { recursive: true });
        }
        const registry = loadProxyRegistry();
        const caddyfile = generateCaddyfile(registry);
        fs.writeFileSync(DEV_PROXY_CADDYFILE, caddyfile);

        // Symlink our Caddyfile to Homebrew's expected location
        const brewCaddyfile = path.join(brewPrefix, 'etc', 'Caddyfile');
        try {
            // Back up existing Caddyfile if it's not already our symlink
            if (fs.existsSync(brewCaddyfile)) {
                const stat = fs.lstatSync(brewCaddyfile);
                if (stat.isSymbolicLink()) {
                    const target = fs.readlinkSync(brewCaddyfile);
                    if (target === DEV_PROXY_CADDYFILE) {
                        console.log('   ✅ Caddyfile symlink already configured');
                    } else {
                        fs.unlinkSync(brewCaddyfile);
                        fs.symlinkSync(DEV_PROXY_CADDYFILE, brewCaddyfile);
                        console.log('   ✅ Caddyfile symlink updated');
                    }
                } else {
                    const backupPath = brewCaddyfile + '.bak';
                    fs.renameSync(brewCaddyfile, backupPath);
                    fs.symlinkSync(DEV_PROXY_CADDYFILE, brewCaddyfile);
                    console.log(`   ✅ Caddyfile symlinked (original backed up to ${backupPath})`);
                }
            } else {
                fs.symlinkSync(DEV_PROXY_CADDYFILE, brewCaddyfile);
                console.log('   ✅ Caddyfile symlinked');
            }
        } catch (e) {
            console.warn(`   ⚠️  Could not symlink Caddyfile: ${e.message}`);
            console.warn(`   Manual fix: ln -sf "${DEV_PROXY_CADDYFILE}" "${brewCaddyfile}"`);
        }

        // Start/restart Caddy via brew services as root (required for port 80)
        try {
            try { execSync('brew services stop caddy', { stdio: 'pipe' }); } catch (e) { /* not running */ }
            try { execSync('sudo brew services stop caddy', { stdio: 'pipe' }); } catch (e) { /* not running */ }
            execSync('sudo brew services start caddy', { stdio: 'inherit' });
            console.log('   ✅ Caddy service started (root, port 80)');
        } catch (e) {
            console.warn(`   ⚠️  Could not start Caddy service: ${e.message}`);
            console.warn('   Manual fix: sudo brew services start caddy');
        }

        // Verify
        console.log('\n   🔍 Verifying setup...');
        try {
            const result = execSync('dig +short test.test @127.0.0.1', { stdio: 'pipe' }).toString().trim();
            if (result === '127.0.0.1') {
                console.log('   ✅ DNS resolution working: *.test → 127.0.0.1');
            } else {
                console.warn(`   ⚠️  DNS returned "${result}" instead of "127.0.0.1"`);
                console.warn('   dnsmasq may need a restart: sudo brew services restart dnsmasq');
            }
        } catch (e) {
            console.warn('   ⚠️  Could not verify DNS (dig command failed)');
            console.warn('   Try: dig +short anything.test @127.0.0.1');
        }

        console.log('\n✅ Dev proxy setup complete!');
        console.log('   All *.test domains now resolve to localhost.');
        console.log('   Use `aigon dev-server start` in any project to register a dev server.\n');
    },

    'dev-server': async (args) => {
        const subcommand = args[0];

        if (subcommand === 'start') {
            const registerOnly = args.includes('--register-only');
            const autoOpen = args.includes('--open');
            const context = detectDevServerContext();
            const proxyAvailable = isProxyAvailable();
            const projectConfig = loadProjectConfig();
            const profile = getActiveProfile();

            // Determine preferred port
            const devProxy = projectConfig.devProxy || {};
            const basePort = devProxy.basePort || 3000;
            const agentOffsets = { cc: 1, gg: 2, cx: 3, cu: 4 };
            const offset = context.agentId ? (agentOffsets[context.agentId] || 0) : 0;

            // Check for explicit --port flag
            const portFlagIdx = args.indexOf('--port');
            let preferredPort;
            if (portFlagIdx !== -1 && args[portFlagIdx + 1]) {
                preferredPort = parseInt(args[portFlagIdx + 1], 10);
            } else {
                preferredPort = basePort + offset;
            }

            // Allocate port
            let port;
            try {
                port = await allocatePort(preferredPort);
            } catch (e) {
                console.error(`❌ ${e.message}`);
                return;
            }

            // Write PORT to .env.local
            const envLocalPath = path.join(process.cwd(), '.env.local');
            let envContent = '';
            if (fs.existsSync(envLocalPath)) {
                envContent = fs.readFileSync(envLocalPath, 'utf8');
                // Replace existing PORT line
                if (envContent.match(/^PORT=\d+/m)) {
                    envContent = envContent.replace(/^PORT=\d+/m, `PORT=${port}`);
                } else {
                    envContent = envContent.trimEnd() + `\nPORT=${port}\n`;
                }
            } else {
                envContent = `PORT=${port}\n`;
            }
            fs.writeFileSync(envLocalPath, envContent);

            const startCmd = devProxy.command || 'npm run dev';
            const useProxy = proxyAvailable && profile.devServer && profile.devServer.enabled;
            const url = useProxy ? getDevProxyUrl(context.appId, context.serverId) : `http://localhost:${port}`;
            const logPath = getDevServerLogPath(context.appId, context.serverId);
            const healthCheckPath = devProxy.healthCheck || '/';
            const healthUrl = `http://localhost:${port}${healthCheckPath}`;

            if (useProxy) {
                // Register with proxy (PID 0 for now, updated after spawn)
                registerDevServer(context.appId, context.serverId, port, process.cwd(), 0);
            }

            if (!registerOnly) {
                // Spawn the dev server process
                console.log(`\n⏳ Starting dev server: ${startCmd}`);
                const pid = spawnDevServer(startCmd, port, logPath, process.cwd());

                // Update registry with real PID
                if (useProxy) {
                    registerDevServer(context.appId, context.serverId, port, process.cwd(), pid);
                }

                // Wait for health check
                process.stdout.write(`   Waiting for server on port ${port}...`);
                const healthy = await waitForHealthy(healthUrl);

                if (healthy) {
                    console.log(' ready!');
                    if (autoOpen) {
                        openInBrowser(url);
                    }
                } else {
                    console.log(' (timeout — server may still be starting)');
                    console.log(`   Check logs: aigon dev-server logs`);
                }

                if (useProxy) {
                    console.log(`\n🌐 Dev server running`);
                    console.log(`   URL:  ${url}`);
                    console.log(`   Port: ${port}  PID: ${pid}`);
                    if (context.serverId) {
                        console.log(`   ID:   ${context.serverId} (${context.appId})`);
                    }
                    console.log(`   Logs: aigon dev-server logs`);
                    console.log(`\n   Open: ${url}\n`);
                } else {
                    console.log(`\n📡 Dev server running`);
                    console.log(`   URL:  ${url}`);
                    console.log(`   Port: ${port}  PID: ${pid}`);
                    if (!proxyAvailable) {
                        console.log(`\n   💡 Run \`aigon proxy-setup\` for subdomain routing (e.g., ${getDevProxyUrl(context.appId, context.serverId)})`);
                    }
                    console.log(`   Logs: aigon dev-server logs`);
                    console.log(`\n   Open: ${url}\n`);
                }
            } else {
                // Register-only mode (manual process management)
                if (useProxy) {
                    console.log(`\n🌐 Dev server registered with proxy`);
                    console.log(`   URL:  ${url}`);
                    console.log(`   Port: ${port}`);
                    if (context.serverId) {
                        console.log(`   ID:   ${context.serverId} (${context.appId})`);
                    }
                    console.log(`\n   Start your dev server: PORT=${port} ${startCmd}`);
                    console.log(`   Then open: ${url}\n`);
                } else {
                    console.log(`\n📡 Dev server configured`);
                    console.log(`   Port: ${port}`);
                    console.log(`   URL:  ${url}`);
                    if (!proxyAvailable) {
                        console.log(`\n   💡 Run \`aigon proxy-setup\` for subdomain routing (e.g., ${getDevProxyUrl(context.appId, context.serverId)})`);
                    }
                    console.log(`\n   Start your dev server: PORT=${port} ${startCmd}\n`);
                }
            }

        } else if (subcommand === 'stop') {
            const serverId = args[1];
            const context = detectDevServerContext();
            const targetServerId = serverId || context.serverId;
            const appId = context.appId;

            if (!targetServerId && targetServerId !== '') {
                console.error('❌ Could not detect server ID. Specify it: aigon dev-server stop <serverId>');
                console.error('   Run `aigon dev-server list` to see active servers.');
                return;
            }

            // Kill the process if it's running
            const registry = loadProxyRegistry();
            const serverEntry = registry[appId] && registry[appId][targetServerId];
            if (serverEntry && serverEntry.pid > 0) {
                try {
                    // Kill the process group (negative PID kills the group)
                    process.kill(-serverEntry.pid, 'SIGTERM');
                    console.log(`   Stopped process (PID ${serverEntry.pid})`);
                } catch (e) {
                    if (e.code !== 'ESRCH') {
                        // ESRCH = process doesn't exist, which is fine
                        try { process.kill(serverEntry.pid, 'SIGTERM'); } catch (e2) { /* ignore */ }
                    }
                }
            }

            deregisterDevServer(appId, targetServerId);
            const hostname = targetServerId ? `${targetServerId}.${appId}.test` : `${appId}.test`;
            console.log(`✅ Stopped and deregistered ${hostname}`);

        } else if (subcommand === 'list') {
            const registry = loadProxyRegistry();
            const hasEntries = Object.keys(registry).length > 0 &&
                Object.values(registry).some(servers => Object.keys(servers).length > 0);

            if (!hasEntries) {
                console.log('\nNo active dev servers.\n');
                console.log('   Start one: aigon dev-server start');
                return;
            }

            console.log('\n   APP            SERVER      PORT   URL                              PID');
            console.log('   ' + '─'.repeat(75));
            for (const [appId, servers] of Object.entries(registry)) {
                for (const [serverId, info] of Object.entries(servers)) {
                    const url = getDevProxyUrl(appId, serverId);
                    const pidStr = info.pid ? String(info.pid) : '-';
                    // Check if PID is alive
                    let alive = false;
                    if (info.pid > 0) {
                        try { process.kill(info.pid, 0); alive = true; } catch (e) { /* dead */ }
                    }
                    const status = alive ? '' : ' (dead)';
                    console.log(`   ${appId.padEnd(15)} ${(serverId || '(main)').padEnd(11)} ${String(info.port).padEnd(6)} ${url.padEnd(36)} ${pidStr}${status}`);
                }
            }
            console.log('');

        } else if (subcommand === 'gc') {
            const removed = gcDevServers();
            if (removed > 0) {
                console.log(`✅ Removed ${removed} dead server${removed === 1 ? '' : 's'} from registry`);
            } else {
                console.log('No dead servers found.');
            }

        } else if (subcommand === 'logs') {
            const serverId = args[1];
            const context = detectDevServerContext();
            const targetServerId = serverId || context.serverId;
            const appId = context.appId;
            const logPath = getDevServerLogPath(appId, targetServerId);

            if (!fs.existsSync(logPath)) {
                console.error(`No log file found at ${logPath}`);
                console.error('   The dev server may not have been started with `aigon dev-server start`.');
                return;
            }

            // Check for --follow / -f flag
            const follow = args.includes('--follow') || args.includes('-f');
            // Check for --tail / -n flag
            const tailIdx = args.indexOf('--tail');
            const nIdx = args.indexOf('-n');
            const tailLines = tailIdx !== -1 ? parseInt(args[tailIdx + 1], 10) : (nIdx !== -1 ? parseInt(args[nIdx + 1], 10) : 50);

            if (follow) {
                // Use tail -f to follow logs (blocks until Ctrl+C)
                const { spawn: spawnFollow } = require('child_process');
                const tail = spawnFollow('tail', ['-f', '-n', String(tailLines), logPath], {
                    stdio: 'inherit'
                });
                tail.on('exit', () => process.exit(0));
                // Handle Ctrl+C gracefully
                process.on('SIGINT', () => { tail.kill(); process.exit(0); });
            } else {
                // Print last N lines
                const content = fs.readFileSync(logPath, 'utf8');
                const lines = content.split('\n');
                const start = Math.max(0, lines.length - tailLines);
                console.log(lines.slice(start).join('\n'));
            }

        } else if (subcommand === 'url') {
            const context = detectDevServerContext();
            const proxyAvailable = isProxyAvailable();
            console.log(resolveDevServerUrl(context, proxyAvailable));

        } else if (subcommand === 'open') {
            const context = detectDevServerContext();
            const proxyAvailable = isProxyAvailable();
            const url = resolveDevServerUrl(context, proxyAvailable);

            console.log(`🌐 Opening ${url}`);
            openInBrowser(url);

        } else {
            console.error(`Usage: aigon dev-server <start|stop|list|logs|gc|url|open>`);
            console.error(`\n  start [--port N] [--open]  - Start dev server, register with proxy`);
            console.error(`  start --register-only      - Register port mapping only (don't start process)`);
            console.error(`  stop [serverId]            - Stop process and deregister from proxy`);
            console.error(`  open                       - Open dev server URL in default browser`);
            console.error(`  list                       - Show all active dev servers`);
            console.error(`  logs [-f] [-n N]           - Show dev server output (default: last 50 lines)`);
            console.error(`  gc                         - Remove entries for dead processes`);
            console.error(`  url                        - Print URL for current context (for scripting)`);
        }
    },

    'next': () => {
        console.log(`ℹ️  'aigon next' is an agent-only command.\n\nRun it inside your agent session:\n  /aigon:next\n\nOr use the short alias:\n  /an`);
    },

    'help': () => {
        const helpText = readTemplate('help.txt');
        process.stdout.write(helpText);
    },

    // --- Deprecated aliases (print warning, then delegate to new command) ---
    'feature-implement': (args) => {
        console.warn('⚠️  Deprecated: "feature-implement" has been renamed to "feature-do". Please update your workflow.');
        commands['feature-do'](args);
    },
    'feature-done': (args) => {
        console.warn('⚠️  Deprecated: "feature-done" has been renamed to "feature-close". Please update your workflow.');
        commands['feature-close'](args);
    },
    'research-conduct': (args) => {
        console.warn('⚠️  Deprecated: "research-conduct" has been renamed to "research-do". Please update your workflow.');
        commands['research-do'](args);
    },
    'research-done': (args) => {
        console.warn('⚠️  Deprecated: "research-done" has been renamed to "research-close". Please update your workflow.');
        commands['research-close'](args);
    },
    'conduct': (args) => {
        console.warn('⚠️  Deprecated: "conduct" has been renamed to "feature-autopilot". Please update your workflow.');
        commands['feature-autopilot'](args);
    },
};

    if (Object.keys(overrides).length === 0) _cachedCommands = commands;
    return commands;
}

module.exports = { createAllCommands };
