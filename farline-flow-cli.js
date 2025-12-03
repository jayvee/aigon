#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

// --- Editor Detection & Auto-Open ---

function detectEditor() {
    // 1. Explicit override (FF_EDITOR=code, or FF_EDITOR=none to disable)
    const override = process.env.FF_EDITOR;
    if (override) {
        if (override === 'none' || override === 'false' || override === '0') {
            return null;
        }
        return override;
    }

    // 2. Detect IDE from environment (order matters - check forks before VS Code)

    // Cursor (VS Code fork)
    if (process.env.CURSOR_TRACE_ID) {
        return 'cursor';
    }

    // Windsurf (VS Code fork)
    if (process.env.TERM_PROGRAM === 'windsurf') {
        return 'windsurf';
    }

    // VS Code (check after forks)
    if (process.env.TERM_PROGRAM === 'vscode' || process.env.VSCODE_IPC_HOOK_CLI) {
        return 'code';
    }

    // Zed
    if (process.env.TERM_PROGRAM === 'zed') {
        return 'zed';
    }

    // No IDE detected - don't auto-open (avoid hijacking terminal with vim/nano)
    return null;
}

function openInEditor(filePath) {
    const editor = detectEditor();
    if (!editor) return;

    try {
        spawnSync(editor, [filePath], { stdio: 'ignore' });
    } catch (e) {
        // Silently fail - opening editor is nice-to-have, not critical
    }
}

// --- Configuration ---
const SPECS_ROOT = path.join(process.cwd(), 'docs', 'specs');
const TEMPLATES_ROOT = path.join(__dirname, 'templates');
const CLAUDE_SETTINGS_PATH = path.join(process.cwd(), '.claude', 'settings.json');

// --- Worktree Permission Helpers ---

function addWorktreePermissions(worktreePaths) {
    // Add read permissions for worktrees to Claude settings
    if (!fs.existsSync(CLAUDE_SETTINGS_PATH)) return;

    try {
        const settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf8'));
        if (!settings.permissions) settings.permissions = {};
        if (!settings.permissions.allow) settings.permissions.allow = [];

        // Convert relative paths to absolute for permissions
        const cwd = process.cwd();
        worktreePaths.forEach(relativePath => {
            const absolutePath = path.resolve(cwd, relativePath);
            const readPermission = `Read(${absolutePath}/**)`;

            if (!settings.permissions.allow.includes(readPermission)) {
                settings.permissions.allow.push(readPermission);
            }
        });

        fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2));
        console.log(`🔓 Added worktree read permissions to .claude/settings.json`);
    } catch (e) {
        console.warn(`⚠️  Could not update Claude settings: ${e.message}`);
    }
}

function removeWorktreePermissions(worktreePaths) {
    // Remove read permissions for worktrees from Claude settings
    if (!fs.existsSync(CLAUDE_SETTINGS_PATH)) return;

    try {
        const settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf8'));
        if (!settings.permissions || !settings.permissions.allow) return;

        const cwd = process.cwd();
        worktreePaths.forEach(relativePath => {
            const absolutePath = path.resolve(cwd, relativePath);
            const readPermission = `Read(${absolutePath}/**)`;

            const index = settings.permissions.allow.indexOf(readPermission);
            if (index > -1) {
                settings.permissions.allow.splice(index, 1);
            }
        });

        fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2));
    } catch (e) {
        // Silent fail on cleanup
    }
}

const PATHS = {
    research: {
        root: path.join(SPECS_ROOT, 'research-topics'),
        folders: ['01-inbox', '02-backlog', '03-in-progress', '04-done', '05-paused'],
        prefix: 'research'
    },
    features: {
        root: path.join(SPECS_ROOT, 'features'),
        folders: ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused'],
        prefix: 'feature'
    }
};

// --- Helper Functions ---

function getNextId(typeConfig) {
    let maxId = 0;
    typeConfig.folders.forEach(folder => {
        const dir = path.join(typeConfig.root, folder);
        if (!fs.existsSync(dir)) return;
        const files = fs.readdirSync(dir);
        files.forEach(file => {
            const regex = new RegExp(`^${typeConfig.prefix}-(\\d+)-`);
            const match = file.match(regex);
            if (match) {
                const num = parseInt(match[1], 10);
                if (num > maxId) maxId = num;
            }
        });
    });
    return maxId + 1;
}

function findFile(typeConfig, nameOrId, searchFolders = typeConfig.folders) {
    const isId = /^\d+$/.test(nameOrId);
    for (const folder of searchFolders) {
        const dir = path.join(typeConfig.root, folder);
        if (!fs.existsSync(dir)) continue;
        const files = fs.readdirSync(dir);
        for (const file of files) {
            if (!file.endsWith('.md')) continue;
            if (isId) {
                // Match files with ID: feature-55-description.md or feature-01-description.md
                // Support both padded (01) and unpadded (1) IDs
                const paddedId = String(nameOrId).padStart(2, '0');
                const unpadded = String(parseInt(nameOrId, 10));
                if (file.startsWith(`${typeConfig.prefix}-${paddedId}-`) ||
                    file.startsWith(`${typeConfig.prefix}-${unpadded}-`)) {
                    return { file, folder, fullPath: path.join(dir, file) };
                }
            } else {
                // Match files by name (with or without ID)
                // e.g., "dark-mode" matches both "feature-dark-mode.md" and "feature-55-dark-mode.md"
                if (file.includes(nameOrId)) {
                    return { file, folder, fullPath: path.join(dir, file) };
                }
            }
        }
    }
    return null;
}

// Find unprioritized file (no ID) in inbox: feature-description.md
function findUnprioritizedFile(typeConfig, name) {
    const dir = path.join(typeConfig.root, '01-inbox');
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir);
    for (const file of files) {
        if (!file.endsWith('.md')) continue;
        // Match files WITHOUT an ID: feature-description.md (not feature-55-description.md)
        const hasId = new RegExp(`^${typeConfig.prefix}-\\d+-`).test(file);
        if (!hasId && file.includes(name)) {
            return { file, folder: '01-inbox', fullPath: path.join(dir, file) };
        }
    }
    return null;
}

function moveFile(fileObj, targetFolder, newFilename = null) {
    const targetDir = path.join(path.dirname(path.dirname(fileObj.fullPath)), targetFolder);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    const destName = newFilename || fileObj.file;
    const destPath = path.join(targetDir, destName);
    fs.renameSync(fileObj.fullPath, destPath);
    console.log(`✅ Moved: ${fileObj.file} -> ${targetFolder}/${destName}`);
    return { ...fileObj, folder: targetFolder, file: destName, fullPath: destPath };
}

function organizeLogFiles(featureNum, winnerAgentId) {
    const logsRoot = path.join(PATHS.features.root, 'logs');
    const selectedDir = path.join(logsRoot, 'selected');
    const alternativesDir = path.join(logsRoot, 'alternatives');
    if (!fs.existsSync(logsRoot)) return;
    if (!fs.existsSync(selectedDir)) fs.mkdirSync(selectedDir, { recursive: true });
    if (!fs.existsSync(alternativesDir)) fs.mkdirSync(alternativesDir, { recursive: true });
    const files = fs.readdirSync(logsRoot);
    console.log("\n📁 Organizing Log Files...");
    files.forEach(file => {
        if (fs.lstatSync(path.join(logsRoot, file)).isDirectory()) return;
        if (!file.startsWith(`feature-${featureNum}-`)) return;
        const srcPath = path.join(logsRoot, file);
        // In multi-agent mode, winner has agent ID in filename
        // In solo mode, there's no agent ID so it's always the winner
        const isWinner = !winnerAgentId || file.includes(`-${winnerAgentId}-`) || file.includes(`-${winnerAgentId}.`) || file === `feature-${featureNum}-log.md`;
        if (isWinner) {
            const destPath = path.join(selectedDir, file);
            fs.renameSync(srcPath, destPath);
            console.log(`   ⭐ Selected: ${file} -> logs/selected/`);
        } else {
            const destPath = path.join(alternativesDir, file);
            fs.renameSync(srcPath, destPath);
            console.log(`   📁 Alternative: ${file} -> logs/alternatives/`);
        }
    });
}

function runGit(command, options = {}) {
    console.log(`Running git: ${command}`);
    try {
        execSync(command, { stdio: 'inherit', ...options });
    } catch (e) {
        console.error("❌ Git command failed.");
        throw e; // Re-throw so callers can handle the failure
    }
}

function safeWrite(filePath, content) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content);
}

// Append or replace content between markers in a file
const MARKER_START = '<!-- FARLINE_FLOW_START -->';
const MARKER_END = '<!-- FARLINE_FLOW_END -->';

function upsertMarkedContent(filePath, content) {
    const markedContent = `${MARKER_START}\n${content}\n${MARKER_END}`;

    if (!fs.existsSync(filePath)) {
        safeWrite(filePath, markedContent);
        return 'created';
    }

    const existing = fs.readFileSync(filePath, 'utf8');
    const markerRegex = new RegExp(`${MARKER_START}[\\s\\S]*?${MARKER_END}`, 'g');

    if (markerRegex.test(existing)) {
        // Replace existing marked section
        const updated = existing.replace(markerRegex, markedContent);
        fs.writeFileSync(filePath, updated);
        return 'updated';
    } else {
        // Append to end of file
        fs.writeFileSync(filePath, existing.trimEnd() + '\n\n' + markedContent + '\n');
        return 'appended';
    }
}

// Read template file from templates directory
function readTemplate(relativePath) {
    const templatePath = path.join(TEMPLATES_ROOT, relativePath);
    if (!fs.existsSync(templatePath)) {
        throw new Error(`Template not found: ${relativePath}`);
    }
    return fs.readFileSync(templatePath, 'utf8');
}

// --- Generic Template System ---

// Load agent config from templates/agents/<id>.json
function loadAgentConfig(agentId) {
    const configPath = path.join(TEMPLATES_ROOT, 'agents', `${agentId}.json`);
    if (!fs.existsSync(configPath)) {
        return null;
    }
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

// Get list of all available agents by scanning templates/agents/
function getAvailableAgents() {
    const agentsDir = path.join(TEMPLATES_ROOT, 'agents');
    if (!fs.existsSync(agentsDir)) return [];
    return fs.readdirSync(agentsDir)
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
}

// Build alias map dynamically from all agent configs
function buildAgentAliasMap() {
    const aliasMap = {};
    getAvailableAgents().forEach(agentId => {
        const config = loadAgentConfig(agentId);
        if (config && config.aliases) {
            config.aliases.forEach(alias => {
                aliasMap[alias.toLowerCase()] = agentId;
            });
        }
    });
    return aliasMap;
}

// Replace placeholders in template content
function processTemplate(content, placeholders) {
    let result = content;
    Object.entries(placeholders).forEach(([key, value]) => {
        // Match {{KEY}} pattern (our placeholder syntax)
        const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
        result = result.replace(regex, value);
    });
    return result;
}

// Read generic template and process with agent config
function readGenericTemplate(templateName, agentConfig) {
    const templatePath = path.join(TEMPLATES_ROOT, 'generic', templateName);
    if (!fs.existsSync(templatePath)) {
        throw new Error(`Generic template not found: ${templateName}`);
    }
    const content = fs.readFileSync(templatePath, 'utf8');
    return processTemplate(content, agentConfig.placeholders);
}

// Extract description from template's HTML comment
function extractDescription(content) {
    const match = content.match(/<!--\s*description:\s*(.+?)\s*-->/);
    return match ? match[1].trim() : '';
}

// Format command output based on agent's output format
function formatCommandOutput(content, description, commandName, agentConfig) {
    const output = agentConfig.output;

    // Remove the description comment from the content
    const cleanContent = content.replace(/<!--\s*description:.*?-->\n?/, '');

    if (output.format === 'markdown') {
        // Generate frontmatter
        const frontmatterFields = output.frontmatter || ['description'];
        const frontmatterLines = [];
        if (frontmatterFields.includes('description')) {
            frontmatterLines.push(`description: ${description}`);
        }
        if (frontmatterFields.includes('args')) {
            // For codex, add args hint
            frontmatterLines.push('args: feature_id');
        }
        return `---\n${frontmatterLines.join('\n')}\n---\n${cleanContent}`;
    }
    else if (output.format === 'toml') {
        return `name = "${commandName}"
description = "${description}"
prompt = """
${cleanContent.trim()}
"""
`;
    }

    return cleanContent;
}

// --- Agent Configuration (Legacy - for backwards compatibility) ---

const AGENT_CONFIGS = {
    cc: {
        id: 'cc',
        name: 'Claude',
        rootFile: 'CLAUDE.md',
        agentFile: 'claude.md',
        templatePath: 'docs/agents/claude.md'
    },
    gg: {
        id: 'gg',
        name: 'Gemini',
        rootFile: 'GEMINI.md',
        agentFile: 'gemini.md',
        templatePath: 'docs/agents/gemini.md'
    },
    cx: {
        id: 'cx',
        name: 'Codex',
        rootFile: null,  // Codex uses ~/.codex/prompt.md instead of a project root file
        agentFile: 'codex.md',
        templatePath: 'docs/agents/codex.md'
    }
};

function getRootFileContent(agentConfig) {
    return `## Farline Flow

This project uses the Farline Flow development workflow.

- ${agentConfig.name}-specific notes: \`docs/agents/${agentConfig.agentFile}\`
- Development workflow: \`docs/development_workflow.md\`
`;
}

// --- Commands ---

const commands = {
    'init': (args) => {
        console.log("ACTION: Initializing Farline Flow in ./docs/specs ...");
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
            const readmeContent = `# Farline Flow Specs\n\n**This folder is the Single Source of Truth.**\n\n## Rules\n1. READ ONLY: backlog, inbox, done.\n2. WRITE: Only edit code if feature spec is in features/in-progress.\n`;
            fs.writeFileSync(readmePath, readmeContent);
        }
        console.log("✅ ./docs/specs directory structure created.");
    },
    'feature-create': (args) => {
        const name = args[0];
        if (!name) return console.error("Usage: ff feature-create <name>\nExample: ff feature-create dark-mode");

        // Ensure inbox exists
        const inboxDir = path.join(PATHS.features.root, '01-inbox');
        if (!fs.existsSync(inboxDir)) {
            fs.mkdirSync(inboxDir, { recursive: true });
        }

        // Create filename: feature-dark-mode.md
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const filename = `feature-${slug}.md`;
        const filePath = path.join(inboxDir, filename);

        if (fs.existsSync(filePath)) {
            return console.error(`❌ Feature already exists: ${filename}`);
        }

        // Read template and replace placeholder
        const template = readTemplate('specs/feature-template.md');
        const content = template.replace(/\{\{NAME\}\}/g, name);

        fs.writeFileSync(filePath, content);
        console.log(`✅ Created: ./docs/specs/features/01-inbox/${filename}`);
        openInEditor(filePath);
        console.log(`📝 Edit the spec, then prioritise it using command: feature-prioritise ${slug}`);
    },
    'research-create': (args) => {
        const name = args[0];
        if (!name) return console.error("Usage: ff research-create <name>\nExample: ff research-create api-design");

        // Ensure inbox exists
        const inboxDir = path.join(PATHS.research.root, '01-inbox');
        if (!fs.existsSync(inboxDir)) {
            fs.mkdirSync(inboxDir, { recursive: true });
        }

        // Create filename: research-api-design.md
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const filename = `research-${slug}.md`;
        const filePath = path.join(inboxDir, filename);

        if (fs.existsSync(filePath)) {
            return console.error(`❌ Research topic already exists: ${filename}`);
        }

        // Read template and replace placeholder
        const template = readTemplate('specs/research-template.md');
        const content = template.replace(/\{\{NAME\}\}/g, name);

        fs.writeFileSync(filePath, content);
        console.log(`✅ Created: ./docs/specs/research-topics/01-inbox/${filename}`);
        openInEditor(filePath);
        console.log(`📝 Edit the topic, then prioritise it using command: research-prioritise ${slug}`);
    },
    'research-prioritise': (args) => {
        const name = args[0];
        if (!name) return console.error("Usage: ff research-prioritise <name>");
        const found = findUnprioritizedFile(PATHS.research, name);
        if (!found) return console.error(`❌ Could not find unprioritized research "${name}" in inbox.`);
        const nextId = getNextId(PATHS.research);
        const paddedId = String(nextId).padStart(2, '0');
        // Transform: research-topic-name.md -> research-55-topic-name.md
        const newName = found.file.replace(
            new RegExp(`^${PATHS.research.prefix}-`),
            `${PATHS.research.prefix}-${paddedId}-`
        );
        moveFile(found, '02-backlog', newName);
        console.log(`📋 Assigned ID: ${paddedId}`);
    },
    'research-start': (args) => {
        const name = args[0];
        if (!name) return console.error("Usage: ff research-start <name|ID>");
        const found = findFile(PATHS.research, name, ['02-backlog']);
        if (!found) return console.error(`❌ Could not find research "${name}" in backlog.`);
        moveFile(found, '03-in-progress');
    },
    'research-done': (args) => {
        const name = args[0];
        if (!name) return console.error("Usage: ff research-done <name|ID>");
        const found = findFile(PATHS.research, name, ['03-in-progress']);
        if (!found) return console.error(`❌ Could not find research "${name}" in in-progress.`);
        moveFile(found, '04-done');
    },
    'feature-prioritise': (args) => {
        const name = args[0];
        if (!name) return console.error("Usage: ff feature-prioritise <name>");
        const found = findUnprioritizedFile(PATHS.features, name);
        if (!found) return console.error(`❌ Could not find unprioritized feature "${name}" in inbox.`);
        const nextId = getNextId(PATHS.features);
        const paddedId = String(nextId).padStart(2, '0');
        // Transform: feature-dark-mode.md -> feature-55-dark-mode.md
        const newName = found.file.replace(
            new RegExp(`^${PATHS.features.prefix}-`),
            `${PATHS.features.prefix}-${paddedId}-`
        );
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
        console.log(`🚀 Next: feature-start ${paddedId}`);
        console.log(`   Solo mode: feature-start ${paddedId}`);
        console.log(`   Multi-agent: feature-start ${paddedId} <agent> [agent2] [agent3]`);
    },
    'feature-start': (args) => {
        const name = args[0];
        const agentIds = args.slice(1); // Optional - if provided, multi-agent mode with worktree(s)
        if (!name) return console.error("Usage: ff feature-start <ID> [agent] [agent2] [agent3]\n  Without agent: solo mode (branch only)\n  With agent(s): multi-agent mode (worktree per agent)\n\nExamples:\n  ff feature-start 55           # Solo mode\n  ff feature-start 55 cc        # Single agent worktree\n  ff feature-start 55 cc gg cx  # Bakeoff with 3 agents");

        // Find and move spec to in-progress
        let found = findFile(PATHS.features, name, ['02-backlog']);
        let movedFromBacklog = false;
        if (found) {
            moveFile(found, '03-in-progress');
            movedFromBacklog = true;
            // Update found to point to new location
            found = findFile(PATHS.features, name, ['03-in-progress']);
        } else {
            found = findFile(PATHS.features, name, ['03-in-progress']);
            if (!found) return console.error(`❌ Could not find feature "${name}" in backlog or in-progress.`);
        }

        const match = found.file.match(/^feature-(\d+)-(.*)\.md$/);
        if (!match) return console.warn("⚠️  Could not parse filename for branch creation.");
        const [_, num, desc] = match;

        // Create log file (for both modes)
        const logsDir = path.join(PATHS.features.root, 'logs');
        if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

        if (agentIds.length > 0) {
            // Multi-agent mode: commit the spec move first so worktree has it
            if (movedFromBacklog) {
                try {
                    runGit(`git add docs/specs/features/`);
                    runGit(`git commit -m "chore: start feature ${num} - move spec to in-progress"`);
                    console.log(`📝 Committed spec move to in-progress`);
                } catch (e) {
                    console.warn(`⚠️  Could not commit spec move: ${e.message}`);
                }
            }

            // Create worktree for each agent
            const createdWorktrees = [];
            agentIds.forEach(agentId => {
                const branchName = `feature-${num}-${agentId}-${desc}`;
                const worktreePath = `../feature-${num}-${agentId}-${desc}`;

                if (fs.existsSync(worktreePath)) {
                    console.warn(`⚠️  Worktree path ${worktreePath} already exists. Skipping.`);
                } else {
                    try {
                        runGit(`git worktree add ${worktreePath} -b ${branchName}`);
                        console.log(`📂 Worktree: ${worktreePath}`);
                        createdWorktrees.push({ agentId, worktreePath });
                    } catch (e) {
                        console.error(`❌ Failed to create worktree for ${agentId}: ${e.message}`);
                    }
                }

                // Create log for this agent
                const logName = `feature-${num}-${agentId}-${desc}-log.md`;
                const logPath = path.join(logsDir, logName);
                if (!fs.existsSync(logPath)) {
                    const template = `# Implementation Log: Feature ${num} - ${desc}\nAgent: ${agentId}\n\n## Plan\n\n## Progress\n\n## Decisions\n`;
                    fs.writeFileSync(logPath, template);
                    console.log(`📝 Log: ./docs/specs/features/logs/${logName}`);
                }
            });

            // Add read permissions for all worktrees to Claude settings
            const allWorktreePaths = agentIds.map(agentId => `../feature-${num}-${agentId}-${desc}`);
            addWorktreePermissions(allWorktreePaths);

            if (agentIds.length > 1) {
                console.log(`\n🏁 Bakeoff started with ${agentIds.length} agents!`);
            } else {
                console.log(`\n🚀 Multi-agent mode started.`);
            }
            console.log(`\n📂 Worktrees created:`);
            agentIds.forEach(agentId => {
                const worktreePath = `../feature-${num}-${agentId}-${desc}`;
                console.log(`   ${agentId}: ${worktreePath}`);
            });
            console.log(`\n💡 Next: Open each worktree in a separate editor/terminal and implement`);
            console.log(`   When done: ff feature-eval ${num}`);
        } else {
            // Solo mode: branch only (default)
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
            // Create log for solo mode
            const logName = `feature-${num}-${desc}-log.md`;
            const logPath = path.join(logsDir, logName);
            if (!fs.existsSync(logPath)) {
                const template = `# Implementation Log: Feature ${num} - ${desc}\n\n## Plan\n\n## Progress\n\n## Decisions\n`;
                fs.writeFileSync(logPath, template);
                console.log(`📝 Log: ./docs/specs/features/logs/${logName}`);
            }
            console.log(`\n🚀 Solo mode. Ready to implement in current directory.`);
            console.log(`   When done: feature-done ${num}`);
        }
    },
    'feature-eval': (args) => {
        const name = args[0];
        if (!name) return console.error("Usage: ff feature-eval <ID>");

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

        // Find all worktrees for this feature
        let worktrees = [];
        try {
            const stdout = execSync('git worktree list', { encoding: 'utf8' });
            const lines = stdout.split('\n');
            lines.forEach(line => {
                const wtMatch = line.match(/^([^\s]+)\s+/);
                if (!wtMatch) return;
                const wtPath = wtMatch[1];
                // Match worktrees for this feature: ../feature-10-cc-desc, ../feature-10-gg-desc
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

        // Create evaluation template
        const evalsDir = path.join(PATHS.features.root, 'evaluations');
        if (!fs.existsSync(evalsDir)) fs.mkdirSync(evalsDir, { recursive: true });

        const evalFile = path.join(evalsDir, `feature-${num}-eval.md`);
        if (!fs.existsSync(evalFile)) {
            const agentList = worktrees.length > 0
                ? worktrees.map(w => `- [ ] **${w.agent}** (${w.name}): \`${w.path}\``).join('\n')
                : '- [ ] (no worktrees found - check git worktree list)';

            const evalTemplate = `# Evaluation: Feature ${num} - ${desc}

## Spec
See: \`./docs/specs/features/04-in-evaluation/${found.file}\`

## Implementations to Compare

${agentList}

## Evaluation Criteria

| Criteria | ${worktrees.map(w => w.agent).join(' | ') || 'agent1 | agent2 | agent3'} |
|----------|${worktrees.map(() => '---').join('|') || '---|---|---'}|
| Code Quality | | ${worktrees.length > 1 ? '|'.repeat(worktrees.length - 1) : '| |'} |
| Spec Compliance | | ${worktrees.length > 1 ? '|'.repeat(worktrees.length - 1) : '| |'} |
| Performance | | ${worktrees.length > 1 ? '|'.repeat(worktrees.length - 1) : '| |'} |
| Maintainability | | ${worktrees.length > 1 ? '|'.repeat(worktrees.length - 1) : '| |'} |

## Summary

### Strengths & Weaknesses

#### Agent 1
- Strengths:
- Weaknesses:

#### Agent 2
- Strengths:
- Weaknesses:

#### Agent 3
- Strengths:
- Weaknesses:

## Recommendation

**Winner:** (to be determined after review)

**Rationale:**

`;
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
        console.log(`\n🔍 Next steps:`);
        console.log(`   1. Review implementations in each worktree`);
        console.log(`   2. Fill in ./docs/specs/features/evaluations/feature-${num}-eval.md`);
        console.log(`   3. Pick a winner and run: ff feature-done ${num} <winning-agent>`);
        if (worktrees.length > 0) {
            console.log(`\n📂 Worktrees found:`);
            worktrees.forEach(w => console.log(`   - ${w.agent}: ${w.path}`));
        }
    },
    'feature-done': (args) => {
        const name = args[0];
        const agentId = args[1]; // Optional - if provided, multi-agent mode
        if (!name) return console.error("Usage: ff feature-done <ID> [agent]\n  Without agent: solo mode (merges feature-ID-desc)\n  With agent: multi-agent mode (merges feature-ID-agent-desc, cleans up worktree)");

        const found = findFile(PATHS.features, name, ['04-in-evaluation', '03-in-progress']);
        if (!found) return console.error(`❌ Could not find feature "${name}" in in-evaluation or in-progress.`);
        const match = found.file.match(/^feature-(\d+)-(.*)\.md$/);
        if (!match) return console.warn("⚠️  Bad filename. Cannot parse ID.");
        const [_, num, desc] = match;

        let branchName, worktreePath, mode;

        if (agentId) {
            // Multi-agent mode: feature-55-cc-dark-mode
            branchName = `feature-${num}-${agentId}-${desc}`;
            worktreePath = `../feature-${num}-${agentId}-${desc}`;
            mode = 'multi-agent';
        } else {
            // Solo mode: feature-55-dark-mode
            branchName = `feature-${num}-${desc}`;
            worktreePath = null;
            mode = 'solo';
        }

        // Check if branch exists before attempting merge
        try {
            execSync(`git rev-parse --verify ${branchName}`, { encoding: 'utf8', stdio: 'pipe' });
        } catch (e) {
            // Branch doesn't exist - maybe wrong mode?
            const altBranch = agentId ? `feature-${num}-${desc}` : `feature-${num}-cc-${desc}`;
            console.error(`❌ Branch not found: ${branchName}`);
            console.error(`   Did you mean: ff feature-done ${num}${agentId ? '' : ' <agent>'}?`);
            console.error(`   Looking for: ${altBranch}`);
            return;
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

        // Clean up worktree if it exists (multi-agent mode)
        if (worktreePath && fs.existsSync(worktreePath)) {
            try {
                execSync(`git worktree remove "${worktreePath}" --force`);
                console.log(`🧹 Removed worktree: ${worktreePath}`);
            } catch (e) {
                console.warn(`⚠️  Could not automatically remove worktree: ${worktreePath}`);
            }
        }

        // Delete the merged (winning) branch locally
        try {
            runGit(`git branch -d ${branchName}`);
            console.log(`🗑️  Deleted branch: ${branchName}`);
        } catch (e) {
            // Branch deletion is optional, don't fail if it doesn't work
        }

        // In multi-agent mode, handle losing branches
        if (agentId) {
            // Find all other branches for this feature
            const losingBranches = [];
            try {
                const branchOutput = execSync('git branch --list', { encoding: 'utf8' });
                const branches = branchOutput.split('\n').map(b => b.trim().replace('* ', ''));
                branches.forEach(branch => {
                    // Match feature-NUM-AGENT-desc but not the winning branch
                    const featurePattern = new RegExp(`^feature-${num}-\\w+-`);
                    if (featurePattern.test(branch) && branch !== branchName) {
                        losingBranches.push(branch);
                    }
                });
            } catch (e) {
                // Ignore errors listing branches
            }

            if (losingBranches.length > 0) {
                console.log(`\n📦 Found ${losingBranches.length} other implementation(s):`);
                losingBranches.forEach(b => console.log(`   - ${b}`));
                console.log(`\n🧹 Cleanup options:`);
                console.log(`   ff cleanup ${num}         # Delete worktrees and local branches`);
                console.log(`   ff cleanup ${num} --push  # Push branches to origin first, then delete`);
                console.log(`\n   Or use: /ff-bakeoff-cleanup ${num}`);
            }
        }

        console.log(`\n✅ Feature ${num} complete! (${mode} mode)`);
    },
    'cleanup': (args) => {
        const id = args[0];
        const pushFlag = args.includes('--push');
        if (!id) return console.error("Usage: ff cleanup <ID> [--push]\n  --push: Push branches to origin before deleting locally");

        const paddedId = String(id).padStart(2, '0');
        const unpaddedId = String(parseInt(id, 10));

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

        // Clean up worktree permissions from Claude settings
        if (removedWorktreePaths.length > 0) {
            removeWorktreePermissions(removedWorktreePaths);
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
            console.log(`💡 Tip: Use 'ff cleanup ${id} --push' to push branches to origin before deleting.`);
        }
    },
    'install-agent': (args) => {
        // Use new config-driven approach
        const availableAgents = getAvailableAgents();

        if (args.length === 0) {
            const agentList = availableAgents.join('|');
            return console.error(`Usage: ff install-agent <${agentList}> [${agentList}] ...\nExample: ff install-agent cc gg`);
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
            safeWrite(workflowPath, workflowContent);
            console.log(`✅ Created: docs/development_workflow.md`);

            // 2. Install each agent using its config
            uniqueAgents.forEach(agentKey => {
                const config = loadAgentConfig(agentKey);
                if (!config) {
                    console.warn(`⚠️  No config found for agent: ${agentKey}`);
                    return;
                }

                console.log(`\n📦 Installing ${config.name} (${config.id})...`);

                // Create/update docs/agents/<agent>.md from template (preserves user additions)
                const agentDocPath = path.join(process.cwd(), 'docs', 'agents', config.agentFile);
                const agentTemplateContent = readTemplate(config.templatePath);
                // Template already contains markers, extract content between them for upsert
                const markerContentMatch = agentTemplateContent.match(new RegExp(`${MARKER_START}\\n([\\s\\S]*?)\\n${MARKER_END}`));
                const agentContent = markerContentMatch ? markerContentMatch[1] : agentTemplateContent;
                const agentAction = upsertMarkedContent(agentDocPath, agentContent);
                console.log(`   ✅ ${agentAction.charAt(0).toUpperCase() + agentAction.slice(1)}: docs/agents/${config.agentFile}`);

                // Create/update root <AGENT>.md with markers (if agent uses one)
                if (config.rootFile) {
                    const rootFilePath = path.join(process.cwd(), config.rootFile);
                    // Use legacy config for getRootFileContent compatibility
                    const legacyConfig = AGENT_CONFIGS[agentKey] || config;
                    const rootContent = getRootFileContent(legacyConfig);
                    const action = upsertMarkedContent(rootFilePath, rootContent);
                    console.log(`   ✅ ${action.charAt(0).toUpperCase() + action.slice(1)}: ${config.rootFile}`);
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

                    config.commands.forEach(cmdName => {
                        // Read generic template and process placeholders
                        const genericContent = readGenericTemplate(`commands/${cmdName}.md`, config);
                        const description = extractDescription(genericContent);

                        // Format output based on agent's output format
                        const outputContent = formatCommandOutput(genericContent, description, cmdName, config);

                        // Write to agent's command directory
                        const fileName = `${config.output.commandFilePrefix}${cmdName}${config.output.commandFileExtension}`;
                        safeWrite(path.join(cmdDir, fileName), outputContent);
                    });

                    if (config.output.global) {
                        console.log(`   ✅ Installed global prompts: ${config.output.commandDir}`);
                        console.log(`   ⚠️  Note: Codex prompts are global (shared across all projects)`);
                    } else {
                        console.log(`   ✅ Created: ${config.output.commandDir}/*`);
                    }
                }

                // Process extras (skill, settings, prompt, config)
                const extras = config.extras || {};

                // Claude: SKILL.md
                if (extras.skill && extras.skill.enabled) {
                    // Add AGENT_FILE placeholder for skill template
                    const skillPlaceholders = { ...config.placeholders, AGENT_FILE: config.agentFile.replace('.md', '') };
                    const skillContent = processTemplate(readTemplate('generic/skill.md'), skillPlaceholders);
                    safeWrite(path.join(process.cwd(), extras.skill.path), skillContent);
                    console.log(`   ✅ Created: ${extras.skill.path}`);
                }

                // Settings files (Claude permissions, Gemini allowedTools)
                if (extras.settings && extras.settings.enabled) {
                    const settingsPath = path.join(process.cwd(), extras.settings.path);
                    let settings = {};
                    if (fs.existsSync(settingsPath)) {
                        try {
                            settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
                        } catch (e) {
                            console.warn(`   ⚠️  Could not parse existing ${extras.settings.path}, creating new one`);
                        }
                    }

                    // Add permissions (Claude)
                    if (extras.settings.permissions) {
                        if (!settings.permissions) settings.permissions = {};
                        if (!settings.permissions.allow) settings.permissions.allow = [];
                        extras.settings.permissions.forEach(perm => {
                            if (!settings.permissions.allow.includes(perm)) {
                                settings.permissions.allow.push(perm);
                            }
                        });
                        if (!settings._farlineFlow) {
                            settings._farlineFlow = {
                                note: 'Permissions added by Farline Flow',
                                permissions: extras.settings.permissions
                            };
                        }
                        console.log(`   ✅ Added permissions to ${extras.settings.path}`);
                    }

                    // Add allowedTools (Gemini)
                    if (extras.settings.allowedTools) {
                        if (!settings.allowedTools) settings.allowedTools = [];
                        extras.settings.allowedTools.forEach(tool => {
                            if (!settings.allowedTools.includes(tool)) {
                                settings.allowedTools.push(tool);
                            }
                        });
                        if (!settings._farlineFlow) {
                            settings._farlineFlow = {
                                note: 'Tools added by Farline Flow',
                                tools: extras.settings.allowedTools
                            };
                        }
                        console.log(`   ✅ Added allowedTools to ${extras.settings.path}`);
                    }

                    safeWrite(settingsPath, JSON.stringify(settings, null, 2));
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
                    console.log(`   ✅ ${action.charAt(0).toUpperCase() + action.slice(1)}: ${extras.prompt.path}`);
                }

                // Codex: config.toml (uses legacy template - not generic)
                if (extras.config && extras.config.enabled) {
                    const configPath = path.join(process.cwd(), extras.config.path);
                    let configContent = '';
                    if (fs.existsSync(configPath)) {
                        configContent = fs.readFileSync(configPath, 'utf8');
                    }
                    if (!configContent.includes('[_farlineFlow]')) {
                        const ffConfig = fs.readFileSync(path.join(TEMPLATES_ROOT, 'cx/config.toml'), 'utf8');
                        if (configContent.length > 0 && !configContent.endsWith('\n')) {
                            configContent += '\n';
                        }
                        configContent += '\n' + ffConfig;
                        safeWrite(configPath, configContent);
                        console.log(`   ✅ Created: ${extras.config.path}`);
                    } else {
                        console.log(`   ℹ️  ${extras.config.path} already has Farline Flow settings`);
                    }
                }
            });

            const agentNames = uniqueAgents.map(a => {
                const cfg = loadAgentConfig(a);
                return cfg ? cfg.name : a;
            }).join(', ');
            console.log(`\n🎉 Installed Farline Flow for: ${agentNames}`);
            console.log(`\n📝 Remember to commit these files to Git so they're available in worktrees.`);

        } catch (e) {
            console.error(`❌ Failed: ${e.message}`);
        }
    },
    'update': () => {
        console.log("🔄 Updating Farline Flow installation...\n");

        try {
            // 1. Detect installed agents by checking for root files
            const installedAgents = [];
            Object.entries(AGENT_CONFIGS).forEach(([key, config]) => {
                if (config.rootFile) {
                    // Claude and Gemini: check for project root file
                    const rootFilePath = path.join(process.cwd(), config.rootFile);
                    if (fs.existsSync(rootFilePath)) {
                        installedAgents.push(key);
                    }
                } else if (key === 'cx') {
                    // Codex: check for .codex/prompt.md with Farline Flow content
                    const promptPath = path.join(process.cwd(), '.codex', 'prompt.md');
                    if (fs.existsSync(promptPath)) {
                        const content = fs.readFileSync(promptPath, 'utf8');
                        if (content.includes('Farline Flow')) {
                            installedAgents.push(key);
                        }
                    }
                }
            });

            // 2. Ensure spec folder structure exists (same as init)
            const createDirs = (root, folders) => {
                folders.forEach(f => {
                    const p = path.join(root, f);
                    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
                });
            };
            createDirs(PATHS.research.root, PATHS.research.folders);
            createDirs(PATHS.features.root, PATHS.features.folders);
            const featLogs = path.join(PATHS.features.root, 'logs');
            if (!fs.existsSync(path.join(featLogs, 'selected'))) fs.mkdirSync(path.join(featLogs, 'selected'), { recursive: true });
            if (!fs.existsSync(path.join(featLogs, 'alternatives'))) fs.mkdirSync(path.join(featLogs, 'alternatives'), { recursive: true });
            if (!fs.existsSync(path.join(PATHS.features.root, 'evaluations'))) fs.mkdirSync(path.join(PATHS.features.root, 'evaluations'), { recursive: true });
            console.log(`✅ Verified: docs/specs directory structure`);

            // 3. Update shared workflow documentation
            const workflowPath = path.join(process.cwd(), 'docs', 'development_workflow.md');
            const workflowContent = readTemplate('docs/development_workflow.md');
            safeWrite(workflowPath, workflowContent);
            console.log(`✅ Updated: docs/development_workflow.md`);

            // 4. Install/update spec templates
            const specsTemplatesDir = path.join(process.cwd(), 'docs', 'specs', 'templates');
            if (!fs.existsSync(specsTemplatesDir)) {
                fs.mkdirSync(specsTemplatesDir, { recursive: true });
            }

            const featureTemplate = readTemplate('specs/feature-template.md');
            safeWrite(path.join(specsTemplatesDir, 'feature-template.md'), featureTemplate);
            console.log(`✅ Updated: docs/specs/templates/feature-template.md`);

            const researchTemplate = readTemplate('specs/research-template.md');
            safeWrite(path.join(specsTemplatesDir, 'research-template.md'), researchTemplate);
            console.log(`✅ Updated: docs/specs/templates/research-template.md`);

            // 5. Re-run install-agent for detected agents
            if (installedAgents.length > 0) {
                console.log(`\n📦 Re-installing agents: ${installedAgents.join(', ')}`);
                commands['install-agent'](installedAgents);
            } else {
                console.log(`\nℹ️  No agents detected. Run 'ff install-agent <cc|gg|cx>' to install.`);
            }

            console.log(`\n✅ Farline Flow updated successfully.`);

        } catch (e) {
            console.error(`❌ Update failed: ${e.message}`);
        }
    },

    'help': () => {
        console.log(`
Farline Flow - Spec-Driven Development for AI Agents

Usage: ff <command> [arguments]

Setup:
  init                              Initialize ./docs/specs directory structure
  install-agent <agents...>         Install agent configs (cc, gg, cx)
  update                            Update Farline Flow files to latest version

Solo Mode (single agent):
  feature-create <name>             Create feature spec in inbox
  feature-prioritise <name>         Move feature from inbox to backlog (assigns ID)
  feature-start <ID>                Start feature (branch, move spec to in-progress)
  feature-eval <ID>                 Move feature to evaluation (optional)
  feature-done <ID>                 Merge branch and complete

Bakeoff Mode (multi-agent):
  feature-start <ID> <agents...>    Setup bakeoff (worktree per agent)
  feature-eval <ID>                 Move feature to evaluation
  feature-done <ID> <agent>         Merge winning agent's branch
  cleanup <ID>                      Remove remaining worktrees

Research:
  research-create <name>            Create research topic in inbox
  research-prioritise <name>        Move research from inbox to backlog (assigns ID)
  research-start <ID>               Move research to in-progress
  research-done <ID>                Move research to done

Examples:
  ff init                           # Setup specs directory
  ff install-agent cc gg            # Install Claude and Gemini configs
  ff feature-create "dark-mode"     # Create new feature spec
  ff feature-prioritise dark-mode   # Assign ID, move to backlog
  ff feature-start 55               # Solo mode (branch only)
  ff feature-start 55 cc gg cx      # Bakeoff with 3 agents
  ff feature-done 55                # Complete solo feature
  ff feature-done 55 cc             # Merge Claude's bakeoff implementation

Agents:
  cc (claude)   - Claude Code
  gg (gemini)   - Gemini CLI
  cx (codex)    - GitHub Codex
`);
    },
};

// --- Main Execution ---
const args = process.argv.slice(2);
const commandName = args[0];
const commandArgs = args.slice(1);
const cleanCommand = commandName ? commandName.replace(/^ff-/, '') : null;

if (!cleanCommand || cleanCommand === 'help' || cleanCommand === '--help' || cleanCommand === '-h') {
    commands['help']();
} else if (commands[cleanCommand]) {
    commands[cleanCommand](commandArgs);
} else {
    console.error(`Unknown command: ${commandName}\n`);
    commands['help']();
}