#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

// --- Editor Detection & Auto-Open ---

function detectEditor() {
    // 1. Explicit override (AIGON_EDITOR=code, or AIGON_EDITOR=none to disable)
    const override = process.env.AIGON_EDITOR;
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
const HOOKS_FILE_PATH = path.join(process.cwd(), 'docs', 'aigon-hooks.md');

// --- Global User Configuration ---
const GLOBAL_CONFIG_DIR = path.join(os.homedir(), '.aigon');
const GLOBAL_CONFIG_PATH = path.join(GLOBAL_CONFIG_DIR, 'config.json');

const DEFAULT_GLOBAL_CONFIG = {
    terminal: 'warp',
    agents: {
        cc: { cli: 'claude' },
        cu: { cli: 'agent' },
        gg: { cli: 'gemini' },
        cx: { cli: 'codex' }
    }
};

/**
 * Load global Aigon configuration from ~/.aigon/config.json
 * @returns {Object} Merged config (defaults + user overrides)
 */
function loadGlobalConfig() {
    let userConfig = {};
    if (fs.existsSync(GLOBAL_CONFIG_PATH)) {
        try {
            userConfig = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf8'));
        } catch (e) {
            console.warn(`⚠️  Could not parse ~/.aigon/config.json: ${e.message}`);
        }
    }

    // Deep merge: user config overrides defaults
    const merged = { ...DEFAULT_GLOBAL_CONFIG };
    if (userConfig.terminal) merged.terminal = userConfig.terminal;
    if (userConfig.agents) {
        merged.agents = { ...DEFAULT_GLOBAL_CONFIG.agents };
        Object.entries(userConfig.agents).forEach(([key, value]) => {
            merged.agents[key] = { ...merged.agents[key], ...value };
        });
    }

    // Environment variable override for terminal
    if (process.env.AIGON_TERMINAL) {
        merged.terminal = process.env.AIGON_TERMINAL;
    }

    return merged;
}

/**
 * Get the CLI command for an agent, with user override support
 * @param {string} agentId - Agent ID (cc, cu, gg, cx)
 * @returns {Object} CLI config with command, implementFlag, implementPrompt
 */
function getAgentCliConfig(agentId) {
    const agentConfig = loadAgentConfig(agentId);
    const globalConfig = loadGlobalConfig();

    // Start with defaults from agent config
    const cli = agentConfig?.cli || { command: agentId, implementFlag: '', implementPrompt: '' };

    // Override command from global config if set
    if (globalConfig.agents?.[agentId]?.cli) {
        cli.command = globalConfig.agents[agentId].cli;
    }

    return cli;
}

// --- Worktree Helpers ---

function getWorktreeBase() {
    const repoName = path.basename(process.cwd());
    return `../${repoName}-worktrees`;
}

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

// --- Hooks System ---

/**
 * Parse hooks file and extract all defined hooks
 * @returns {Object} Map of hook names to their shell scripts
 */
function parseHooksFile() {
    if (!fs.existsSync(HOOKS_FILE_PATH)) {
        return {};
    }

    const content = fs.readFileSync(HOOKS_FILE_PATH, 'utf8');
    const hooks = {};

    // Match ## hook-name sections followed by ```bash code blocks
    const hookPattern = /^##\s+(pre-|post-)([a-z-]+)\s*\n[\s\S]*?```bash\n([\s\S]*?)```/gm;
    let match;

    while ((match = hookPattern.exec(content)) !== null) {
        const hookType = match[1]; // 'pre-' or 'post-'
        const commandName = match[2]; // e.g., 'feature-setup'
        const script = match[3].trim();
        const hookName = `${hookType}${commandName}`;
        hooks[hookName] = script;
    }

    return hooks;
}

/**
 * Get all defined hooks from the hooks file
 * @returns {Array} Array of {name, type, command, script} objects
 */
function getDefinedHooks() {
    const hooks = parseHooksFile();
    return Object.entries(hooks).map(([name, script]) => {
        const match = name.match(/^(pre|post)-(.+)$/);
        return {
            name,
            type: match ? match[1] : 'unknown',
            command: match ? match[2] : name,
            script
        };
    });
}

/**
 * Execute a hook with the given context
 * @param {string} hookName - Name of the hook (e.g., 'pre-feature-setup')
 * @param {Object} context - Context variables to pass as environment variables
 * @returns {Object} {success: boolean, output?: string, error?: string}
 */
function executeHook(hookName, context = {}) {
    const hooks = parseHooksFile();
    const script = hooks[hookName];

    if (!script) {
        return { success: true, skipped: true };
    }

    console.log(`\n🪝 Running hook: ${hookName}`);

    // Build environment variables
    const env = {
        ...process.env,
        AIGON_PROJECT_ROOT: process.cwd(),
        AIGON_COMMAND: context.command || '',
        AIGON_FEATURE_ID: context.featureId || '',
        AIGON_FEATURE_NAME: context.featureName || '',
        AIGON_MODE: context.mode || '',  // 'solo' or 'arena'
        AIGON_AGENTS: context.agents ? context.agents.join(' ') : '',
        AIGON_AGENT: context.agent || '',
        AIGON_WORKTREE_PATH: context.worktreePath || ''
    };

    try {
        const output = execSync(script, {
            encoding: 'utf8',
            env,
            cwd: process.cwd(),
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: true
        });

        if (output.trim()) {
            console.log(output.trim().split('\n').map(line => `   ${line}`).join('\n'));
        }
        console.log(`   ✅ Hook completed: ${hookName}`);
        return { success: true, output };
    } catch (e) {
        const errorOutput = e.stderr || e.message;
        console.error(`   ❌ Hook failed: ${hookName}`);
        if (errorOutput) {
            console.error(errorOutput.trim().split('\n').map(line => `   ${line}`).join('\n'));
        }
        return { success: false, error: errorOutput };
    }
}

/**
 * Run pre-hook for a command. Aborts if hook fails.
 * @param {string} commandName - Name of the command (e.g., 'feature-setup')
 * @param {Object} context - Context variables to pass to the hook
 * @returns {boolean} true if should continue, false if should abort
 */
function runPreHook(commandName, context = {}) {
    const hookName = `pre-${commandName}`;
    const result = executeHook(hookName, { ...context, command: commandName });

    if (result.skipped) {
        return true; // No hook defined, continue
    }

    if (!result.success) {
        console.error(`\n❌ Pre-hook failed. Command '${commandName}' aborted.`);
        return false;
    }

    return true;
}

/**
 * Run post-hook for a command. Warns but doesn't fail on error.
 * @param {string} commandName - Name of the command (e.g., 'feature-setup')
 * @param {Object} context - Context variables to pass to the hook
 */
function runPostHook(commandName, context = {}) {
    const hookName = `post-${commandName}`;
    const result = executeHook(hookName, { ...context, command: commandName });

    if (!result.skipped && !result.success) {
        console.warn(`\n⚠️  Post-hook '${hookName}' failed but command completed.`);
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

// Returns 'created', 'updated', or 'unchanged'
function safeWriteWithStatus(filePath, content) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (fs.existsSync(filePath)) {
        const existing = fs.readFileSync(filePath, 'utf8');
        if (existing === content) {
            return 'unchanged';
        }
        fs.writeFileSync(filePath, content);
        return 'updated';
    }
    fs.writeFileSync(filePath, content);
    return 'created';
}

// Get the Aigon CLI version from package.json
function getAigonVersion() {
    const pkgPath = path.join(__dirname, 'package.json');
    if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        return pkg.version;
    }
    return null;
}

// Get/set the installed version for a project
const VERSION_FILE = '.aigon/version';

function getInstalledVersion() {
    const versionPath = path.join(process.cwd(), VERSION_FILE);
    if (fs.existsSync(versionPath)) {
        return fs.readFileSync(versionPath, 'utf8').trim();
    }
    return null;
}

function setInstalledVersion(version) {
    const versionPath = path.join(process.cwd(), VERSION_FILE);
    safeWrite(versionPath, version);
}

// Parse changelog and return entries between two versions
function getChangelogEntriesSince(fromVersion) {
    const changelogPath = path.join(__dirname, 'CHANGELOG.md');
    if (!fs.existsSync(changelogPath)) {
        return [];
    }

    const content = fs.readFileSync(changelogPath, 'utf8');
    const entries = [];

    // Split by version headers: ## [x.y.z]
    const versionPattern = /^## \[(\d+\.\d+\.\d+)\]/gm;
    const sections = content.split(versionPattern);

    // sections alternates: [preamble, version1, content1, version2, content2, ...]
    for (let i = 1; i < sections.length; i += 2) {
        const version = sections[i];
        let body = sections[i + 1] || '';

        // Remove the date suffix (e.g., " - 2026-02-02") from the start of body
        body = body.replace(/^\s*-\s*\d{4}-\d{2}-\d{2}\s*/, '').trim();

        // Stop if we've reached fromVersion or older
        if (fromVersion && compareVersions(version, fromVersion) <= 0) {
            break;
        }

        entries.push({ version, body });
    }

    return entries;
}

// Compare semver versions: returns >0 if a > b, <0 if a < b, 0 if equal
function compareVersions(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if (pa[i] > pb[i]) return 1;
        if (pa[i] < pb[i]) return -1;
    }
    return 0;
}

function removeDeprecatedCommands(cmdDir, config) {
    if (!fs.existsSync(cmdDir)) return [];

    const prefix = config.output.commandFilePrefix;
    const ext = config.output.commandFileExtension;
    const expectedFiles = new Set(
        config.commands.map(cmd => `${prefix}${cmd}${ext}`)
    );

    const removed = [];
    for (const file of fs.readdirSync(cmdDir)) {
        if (!file.startsWith(prefix) || !file.endsWith(ext)) continue;
        if (expectedFiles.has(file)) continue;
        try {
            fs.unlinkSync(path.join(cmdDir, file));
            removed.push(file);
        } catch (e) {
            console.warn(`   ⚠️  Could not remove deprecated command ${file}: ${e.message}`);
        }
    }
    return removed;
}

// Append or replace content between markers in a file
const MARKER_START = '<!-- AIGON_START -->';
const MARKER_END = '<!-- AIGON_END -->';

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
    else if (output.format === 'plain') {
        // Plain markdown with no frontmatter (Cursor)
        return cleanContent;
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
        templatePath: 'docs/agents/claude.md',
        port: 3001
    },
    gg: {
        id: 'gg',
        name: 'Gemini',
        rootFile: 'GEMINI.md',
        agentFile: 'gemini.md',
        templatePath: 'docs/agents/gemini.md',
        port: 3002
    },
    cx: {
        id: 'cx',
        name: 'Codex',
        rootFile: null,  // Codex uses ~/.codex/prompt.md instead of a project root file
        agentFile: 'codex.md',
        templatePath: 'docs/agents/codex.md',
        port: 3003
    },
    cu: {
        id: 'cu',
        name: 'Cursor',
        rootFile: null,  // Cursor uses .cursorrules instead of a project root file
        agentFile: 'cursor.md',
        templatePath: 'docs/agents/cursor.md',
        port: 3004
    }
};

function getRootFileContent(agentConfig) {
    return `## Aigon

This project uses the Aigon development workflow.

- ${agentConfig.name}-specific notes: \`docs/agents/${agentConfig.agentFile}\`
- Development workflow: \`docs/development_workflow.md\`
`;
}

// --- Commands ---

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
        console.log("✅ ./docs/specs directory structure created.");
    },
    'feature-create': (args) => {
        const name = args[0];
        if (!name) return console.error("Usage: aigon feature-create <name>\nExample: aigon feature-create dark-mode");

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
        if (!name) return console.error("Usage: aigon research-create <name>\nExample: aigon research-create api-design");

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
        if (!name) return console.error("Usage: aigon research-prioritise <name>");
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
    'research-setup': (args) => {
        const id = args[0];
        const agentIds = args.slice(1);
        const mode = agentIds.length > 0 ? 'arena' : 'solo';

        if (!id) {
            return console.error("Usage: aigon research-setup <ID> [agents...]\n\nExamples:\n  aigon research-setup 05              # Solo mode\n  aigon research-setup 05 cc gg        # Arena mode");
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

        if (mode === 'arena') {
            // Arena mode: Create findings files for each agent
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

            console.log(`\n🏟️  Arena mode started with ${agentIds.length} agents!`);
            console.log(`\n📋 Research topic: ./docs/specs/research-topics/03-in-progress/${found.file}`);
            console.log(`\n📂 Agent findings files:`);
            agentIds.forEach(agentId => {
                const agentConfig = loadAgentConfig(agentId);
                const agentName = agentConfig ? agentConfig.name : agentId;
                console.log(`   ${agentId} (${agentName}): logs/research-${researchNum}-${agentId}-findings.md`);
            });
            console.log(`\n💡 Next: Run each agent with /aigon-research-conduct ${researchNum}`);
            console.log(`   When done: aigon research-done ${researchNum}`);
        } else {
            // Solo mode: Just move to in-progress
            console.log(`\n🚀 Solo mode. Research moved to in-progress.`);
            console.log(`📋 Topic: ./docs/specs/research-topics/03-in-progress/${found.file}`);
            console.log(`\n💡 Next: Run agent with /aigon-research-conduct ${researchNum}`);
            console.log(`   When done: aigon research-done ${researchNum}`);
        }
    },
    'research-conduct': (args) => {
        const id = args[0];
        if (!id) return console.error("Usage: aigon research-conduct <ID>\n\nRun this after 'aigon research-setup <ID>'\n\nExamples:\n  aigon research-conduct 05     # In solo mode\n  aigon research-conduct 05     # In arena mode (writes to your findings file)");

        // Find the research topic
        let found = findFile(PATHS.research, id, ['03-in-progress']);
        if (!found) return console.error(`❌ Could not find research "${id}" in in-progress.\n\nRun 'aigon research-setup ${id}' first.`);

        const match = found.file.match(/^research-(\d+)-(.*)\.md$/);
        if (!match) return console.warn("⚠️  Could not parse filename.");
        const [_, num, desc] = match;

        // Check for arena mode by looking for findings files
        const logsDir = path.join(PATHS.research.root, 'logs');
        let findingsFiles = [];
        if (fs.existsSync(logsDir)) {
            const files = fs.readdirSync(logsDir);
            findingsFiles = files.filter(f =>
                f.startsWith(`research-${num}-`) && f.endsWith('-findings.md')
            );
        }

        const isArenaMode = findingsFiles.length > 0;

        console.log(`\n📋 Research ${num}: ${desc.replace(/-/g, ' ')}`);
        console.log(`   Mode: ${isArenaMode ? '🏟️  Arena' : '🚀 Solo'}`);
        console.log(`\n📄 Topic: ./docs/specs/research-topics/03-in-progress/${found.file}`);

        if (isArenaMode) {
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
            console.log(`   - Do NOT run 'aigon research-done' from an agent session`);
            console.log(`   - The user will run 'aigon research-done ${num}' to synthesize`);
        } else {
            console.log(`\n📝 Next Steps:`);
            console.log(`   1. Read the research topic`);
            console.log(`   2. Conduct research based on questions and scope`);
            console.log(`   3. Write findings to the ## Findings section of the topic file`);
            console.log(`   4. Include sources and recommendation`);
            console.log(`\n   When done: aigon research-done ${num}`);
        }
    },
    'research-done': (args) => {
        const id = args[0];
        const forceComplete = args.includes('--complete');

        if (!id) return console.error("Usage: aigon research-done <ID> [--complete]\n\nOptions:\n  --complete  Move directly to done without showing summary");

        const found = findFile(PATHS.research, id, ['03-in-progress']);
        if (!found) return console.error(`❌ Could not find research "${id}" in in-progress.`);

        // Extract research ID from filename
        const match = found.file.match(/^research-(\d+)-(.*)\.md$/);
        const researchNum = match ? match[1] : id;
        const researchName = match ? match[2] : 'research';

        // Check for arena mode by looking for findings files
        const logsDir = path.join(PATHS.research.root, 'logs');
        let findingsFiles = [];
        if (fs.existsSync(logsDir)) {
            const files = fs.readdirSync(logsDir);
            findingsFiles = files.filter(f =>
                f.startsWith(`research-${researchNum}-`) && f.endsWith('-findings.md')
            );
        }

        const isArenaMode = findingsFiles.length > 0;

        if (isArenaMode && !forceComplete) {
            // Arena mode: Show summary and suggest using research-synthesize
            console.log(`\n📋 Research ${researchNum}: ${researchName.replace(/-/g, ' ')} - Arena Mode`);
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
            console.log(`   aigon research-done ${researchNum} --complete`);
            return;
        }

        // Move to done (both modes, or arena with --complete)
        moveFile(found, '04-done');

        if (isArenaMode) {
            console.log(`\n✅ Research ${researchNum} complete! (arena mode)`);
            console.log(`📂 Findings files preserved in: ./docs/specs/research-topics/logs/`);
        } else {
            console.log(`\n✅ Research ${researchNum} complete! (solo mode)`);
        }
    },
    'feature-prioritise': (args) => {
        const name = args[0];
        if (!name) return console.error("Usage: aigon feature-prioritise <name>");
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
        console.log(`🚀 Next steps:`);
        console.log(`   Solo (branch):    aigon feature-setup ${paddedId}`);
        console.log(`   Solo (worktree):  aigon feature-setup ${paddedId} <agent>`);
        console.log(`   Arena:            aigon feature-setup ${paddedId} <agent1> <agent2> [agent3]`);
    },
    'feature-now': (args) => {
        const name = args[0];
        if (!name) return console.error("Usage: aigon feature-now <name>\nFast-track: create + prioritise + setup in one step (solo branch)\nExample: aigon feature-now dark-mode");

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
            mode: 'solo',
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

        console.log(`\n🚀 Feature ${paddedId} ready for implementation!`);
        console.log(`   Spec: ./docs/specs/features/03-in-progress/${filename}`);
        console.log(`   Log:  ./docs/specs/features/logs/${logName}`);
        console.log(`   Branch: ${branchName}`);
        console.log(`\n📝 Next: Write the spec, then implement.`);
        console.log(`   When done: aigon feature-done ${paddedId}`);
    },
    'feature-setup': (args) => {
        const name = args[0];
        const agentIds = args.slice(1);
        const mode = agentIds.length > 0 ? 'arena' : 'solo';

        if (!name) {
            return console.error("Usage: aigon feature-setup <ID> [agents...]\n\nExamples:\n  aigon feature-setup 55              # Solo mode (branch)\n  aigon feature-setup 55 cc           # Solo mode (worktree, for parallel development)\n  aigon feature-setup 55 cc gg cx cu  # Arena mode (multiple agents compete)");
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
                if (mode !== 'solo') {
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

        if (mode === 'solo') {
            // Solo mode: Create branch
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
                const template = `# Implementation Log: Feature ${num} - ${desc}\n\n## Plan\n\n## Progress\n\n## Decisions\n`;
                fs.writeFileSync(logPath, template);
                console.log(`📝 Log: ./docs/specs/features/logs/${logName}`);
            }

            console.log(`\n🚀 Solo mode. Ready to implement in current directory.`);
            console.log(`   When done: aigon feature-done ${num}`);
        } else {
            // Arena/worktree mode: Create worktrees
            const wtBase = getWorktreeBase();
            if (!fs.existsSync(wtBase)) {
                fs.mkdirSync(wtBase, { recursive: true });
            }

            const createdWorktrees = [];
            agentIds.forEach(agentId => {
                const branchName = `feature-${num}-${agentId}-${desc}`;
                const worktreePath = `${wtBase}/feature-${num}-${agentId}-${desc}`;

                if (fs.existsSync(worktreePath)) {
                    console.warn(`⚠️  Worktree path ${worktreePath} already exists. Skipping.`);
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

                        // Create .env.local with agent-specific PORT (copy base if exists)
                        const envLocalPath = path.join(process.cwd(), '.env.local');
                        const agentConfig = AGENT_CONFIGS[agentId];
                        const port = agentConfig ? agentConfig.port : 3000;
                        let envContent = '';
                        if (fs.existsSync(envLocalPath)) {
                            envContent = fs.readFileSync(envLocalPath, 'utf8').trimEnd() + '\n\n';
                        }
                        envContent += `# Arena port for agent ${agentId}\nPORT=${port}\n`;
                        fs.writeFileSync(path.join(worktreePath, '.env.local'), envContent);
                        console.log(`   📋 .env.local created with PORT=${port}`);

                        // Create log for this agent in the worktree
                        const worktreeLogsDir = path.join(worktreePath, 'docs/specs/features/logs');
                        if (!fs.existsSync(worktreeLogsDir)) {
                            fs.mkdirSync(worktreeLogsDir, { recursive: true });
                        }
                        const logName = `feature-${num}-${agentId}-${desc}-log.md`;
                        const logPath = path.join(worktreeLogsDir, logName);
                        const template = `# Implementation Log: Feature ${num} - ${desc}\nAgent: ${agentId}\n\n## Plan\n\n## Progress\n\n## Decisions\n`;
                        fs.writeFileSync(logPath, template);
                        console.log(`   📝 Log: docs/specs/features/logs/${logName}`);
                    } catch (e) {
                        console.error(`❌ Failed to create worktree for ${agentId}: ${e.message}`);
                    }
                }
            });

            // Add read permissions for all worktrees to Claude settings
            const allWorktreePaths = agentIds.map(agentId => `${wtBase}/feature-${num}-${agentId}-${desc}`);
            addWorktreePermissions(allWorktreePaths);

            if (agentIds.length === 1) {
                const agentConfig = AGENT_CONFIGS[agentIds[0]];
                const port = agentConfig ? agentConfig.port : 3000;
                console.log(`\n🚀 Solo worktree created for parallel development!`);
                console.log(`\n📂 Worktree: ${wtBase}/feature-${num}-${agentIds[0]}-${desc} (PORT=${port})`);
                console.log(`\n💡 Next: Open the worktree with the agent CLI:`);
                console.log(`   aigon worktree-open ${num}                    # Opens in configured terminal (default: Warp)`);
                console.log(`   aigon worktree-open ${num} --terminal=code    # Opens in VS Code`);
                console.log(`\n   Or manually: Open the worktree and run /aigon-feature-implement ${num}`);
                console.log(`   When done: aigon feature-done ${num}`);
            } else {
                console.log(`\n🏁 Arena started with ${agentIds.length} agents!`);
                console.log(`\n📂 Worktrees created:`);
                agentIds.forEach(agentId => {
                    const agentConfig = AGENT_CONFIGS[agentId];
                    const port = agentConfig ? agentConfig.port : 3000;
                    console.log(`   ${agentId}: ${wtBase}/feature-${num}-${agentId}-${desc} (PORT=${port})`);
                });
                console.log(`\n💡 Next: Open each worktree with the agent CLI:`);
                agentIds.forEach(agentId => {
                    console.log(`   aigon worktree-open ${num} ${agentId}`);
                });
                console.log(`\n   Or manually: Open each worktree and run /aigon-feature-implement ${num}`);
                console.log(`   When done: aigon feature-eval ${num}`);
            }
        }

        // Run post-hook (won't fail the command)
        runPostHook('feature-setup', hookContext);
    },
    'feature-implement': (args) => {
        const id = args[0];
        if (!id) return console.error("Usage: aigon feature-implement <ID>\n\nRun this after 'aigon feature-setup <ID>'\n\nExamples:\n  aigon feature-implement 55     # In solo mode branch\n  aigon feature-implement 55     # In arena mode worktree");

        // Find the feature spec
        let found = findFile(PATHS.features, id, ['03-in-progress']);
        if (!found) return console.error(`❌ Could not find feature "${id}" in in-progress.\n\nRun 'aigon feature-setup ${id}' first.`);

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
            const [_, wtNum, wtAgent, wtDesc] = worktreeMatch;
            if (wtNum !== num && wtNum !== String(num).padStart(2, '0')) {
                console.warn(`⚠️  Warning: Directory feature ID (${wtNum}) doesn't match argument (${num})`);
            }

            // Count worktrees for this feature to distinguish solo-wt from arena
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
                // Default to arena if we can't count
                featureWorktreeCount = 2;
            }

            mode = featureWorktreeCount > 1 ? 'arena' : 'solo-wt';

            if (mode === 'arena') {
                console.log(`\n🏟️  Arena Mode - Agent: ${agentId}`);
            } else {
                console.log(`\n🚀 Solo Mode (worktree) - Agent: ${agentId}`);
            }
            console.log(`   Feature: ${num} - ${desc}`);
            console.log(`   Worktree: ${dirName}`);
        } else {
            // Solo mode: check if we're on the right branch
            mode = 'solo';
            try {
                const currentBranch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
                const expectedBranch = `feature-${num}-${desc}`;

                if (currentBranch !== expectedBranch) {
                    console.warn(`⚠️  Warning: Current branch (${currentBranch}) doesn't match expected (${expectedBranch})`);
                    console.warn(`    Run 'aigon feature-setup ${num}' first.`);
                }

                console.log(`\n🚀 Solo Mode`);
                console.log(`   Feature: ${num} - ${desc}`);
                console.log(`   Branch: ${currentBranch}`);
            } catch (e) {
                console.error(`❌ Could not determine git branch: ${e.message}`);
                return;
            }
        }

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
        const logPattern = (mode === 'arena' || mode === 'solo-wt') ? `feature-${num}-${agentId}-*-log.md` : `feature-${num}-*-log.md`;
        console.log(`📝 Log: ${logDir}${logPattern}`);

        console.log(`\n📝 Next Steps:`);
        console.log(`   1. Read the spec in ./docs/specs/features/03-in-progress/`);
        console.log(`   2. Implement the feature according to the spec`);
        console.log(`   3. Test your changes`);
        console.log(`   4. Commit your code with conventional commits (feat:, fix:, chore:)`);
        console.log(`   5. Update the implementation log`);
        console.log(`   6. Commit the log file`);

        if (mode === 'arena') {
            console.log(`\n⚠️  IMPORTANT:`);
            console.log(`   - Do NOT run 'aigon feature-done' from a worktree`);
            console.log(`   - Return to main repo when done`);
            console.log(`   - Run 'aigon feature-eval ${num}' to compare implementations`);
        } else if (mode === 'solo-wt') {
            console.log(`\n⚠️  IMPORTANT:`);
            console.log(`   - Do NOT run 'aigon feature-done' from a worktree`);
            console.log(`   - Return to main repo when done`);
            console.log(`   - Run 'aigon feature-done ${num}' from the main repo`);
        } else {
            console.log(`\n   When done: aigon feature-done ${num}`);
        }
    },
    'feature-eval': (args) => {
        const name = args[0];
        if (!name) return console.error("Usage: aigon feature-eval <ID>\n\nExamples:\n  aigon feature-eval 55     # Solo mode: code review\n  aigon feature-eval 55     # Arena mode: compare implementations");

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

        const mode = worktrees.length > 1 ? 'arena' : 'solo';

        // Create evaluation template
        const evalsDir = path.join(PATHS.features.root, 'evaluations');
        if (!fs.existsSync(evalsDir)) fs.mkdirSync(evalsDir, { recursive: true });

        const evalFile = path.join(evalsDir, `feature-${num}-eval.md`);
        if (!fs.existsSync(evalFile)) {
            let evalTemplate;

            if (mode === 'arena') {
                // Arena mode: comparison template
                const agentList = worktrees.map(w => `- [ ] **${w.agent}** (${w.name}): \`${w.path}\``).join('\n');

                evalTemplate = `# Evaluation: Feature ${num} - ${desc}

**Mode:** Arena (Multi-agent comparison)

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
                // Solo mode: code review template
                // Determine branch name: if there's a solo worktree, use its branch name
                const soloBranch = worktrees.length === 1
                    ? `feature-${num}-${worktrees[0].agent}-${desc}`
                    : `feature-${num}-${desc}`;
                evalTemplate = `# Evaluation: Feature ${num} - ${desc}

**Mode:** Solo (Code review)

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
        console.log(`   Mode: ${mode === 'arena' ? '🏟️  Arena (comparison)' : '🚀 Solo (code review)'}`);

        if (mode === 'arena') {
            console.log(`\n📂 Worktrees to compare:`);
            worktrees.forEach(w => console.log(`   ${w.agent}: ${w.path}`));
            console.log(`\n🔍 Review each implementation, then pick a winner.`);
            console.log(`\n⚠️  TO MERGE THE WINNER INTO MAIN, run:`);
            worktrees.forEach(w => {
                console.log(`   aigon feature-done ${num} ${w.agent}    # merge ${w.name}'s implementation`);
            });
        } else {
            console.log(`\n🔍 Review the implementation and complete the evaluation checklist.`);
            console.log(`\n⚠️  TO MERGE INTO MAIN, run:`);
            console.log(`   aigon feature-done ${num}`);
        }
    },
    'feature-done': (args) => {
        const keepBranch = args.includes('--keep-branch');
        const filteredArgs = args.filter(a => a !== '--keep-branch');
        const name = filteredArgs[0];
        const agentId = filteredArgs[1]; // Optional - if provided, multi-agent mode
        if (!name) return console.error("Usage: aigon feature-done <ID> [agent] [--keep-branch]\n  Without agent: solo mode (merges feature-ID-desc)\n  With agent: multi-agent mode (merges feature-ID-agent-desc, cleans up worktree)\n  --keep-branch: Don't delete the local branch after merge");

        const found = findFile(PATHS.features, name, ['04-in-evaluation', '03-in-progress']);
        if (!found) return console.error(`❌ Could not find feature "${name}" in in-evaluation or in-progress.`);
        const match = found.file.match(/^feature-(\d+)-(.*)\.md$/);
        if (!match) return console.warn("⚠️  Bad filename. Cannot parse ID.");
        const [_, num, desc] = match;

        // Build hook context
        const hookContext = {
            featureId: num,
            featureName: desc,
            agent: agentId || ''
        };

        // Run pre-hook (can abort the command)
        if (!runPreHook('feature-done', hookContext)) {
            return;
        }

        let branchName, worktreePath, mode;

        if (agentId) {
            // Multi-agent mode: feature-55-cc-dark-mode
            branchName = `feature-${num}-${agentId}-${desc}`;
            worktreePath = `${getWorktreeBase()}/feature-${num}-${agentId}-${desc}`;
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
            if (agentId) {
                // Explicit agent specified but branch not found
                const altBranch = `feature-${num}-${desc}`;
                console.error(`❌ Branch not found: ${branchName}`);
                console.error(`   Did you mean: aigon feature-done ${num}?`);
                console.error(`   Looking for: ${altBranch}`);
                return;
            }

            // Solo branch not found — check for solo worktree (auto-detect)
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
                // Auto-detect: single worktree = solo worktree mode
                const detectedAgent = featureWorktrees[0].agent;
                branchName = `feature-${num}-${detectedAgent}-${desc}`;
                worktreePath = featureWorktrees[0].path;
                mode = 'multi-agent';
                console.log(`🔍 Auto-detected solo worktree (agent: ${detectedAgent})`);

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
                    console.error(`   aigon feature-done ${num} ${wt.agent}`);
                });
                return;
            } else {
                console.error(`❌ Branch not found: ${branchName}`);
                console.error(`   Run 'aigon feature-setup ${num}' first.`);
                return;
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

        // Clean up worktree if it exists (multi-agent mode or solo-wt)
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
                console.log(`   aigon feature-cleanup ${num}         # Delete worktrees and local branches`);
                console.log(`   aigon feature-cleanup ${num} --push  # Push branches to origin first, then delete`);
            }
        }

        console.log(`\n✅ Feature ${num} complete! (${mode} mode)`);

        // Run post-hook (won't fail the command)
        runPostHook('feature-done', hookContext);
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
            console.log(`💡 Tip: Use 'aigon feature-cleanup ${id} --push' to push branches to origin before deleting.`);
        }

        // Run post-hook (won't fail the command)
        runPostHook('feature-cleanup', hookContext);
    },
    'feature-list': (args) => {
        const flags = new Set(args.filter(a => a.startsWith('--')));
        const showAll = flags.has('--all');
        const showActive = flags.has('--active');
        const showInbox = flags.has('--inbox');
        const showBacklog = flags.has('--backlog');
        const showDone = flags.has('--done');
        const hasFilter = showAll || showActive || showInbox || showBacklog || showDone;

        // Determine which folders to show
        const folderFilter = new Set();
        if (showAll) {
            PATHS.features.folders.forEach(f => folderFilter.add(f));
        } else if (hasFilter) {
            if (showInbox) folderFilter.add('01-inbox');
            if (showBacklog) folderFilter.add('02-backlog');
            if (showActive) { folderFilter.add('03-in-progress'); folderFilter.add('04-in-evaluation'); }
            if (showDone) folderFilter.add('05-done');
        } else {
            // Default: everything except done
            PATHS.features.folders.forEach(f => { if (f !== '05-done') folderFilter.add(f); });
        }

        // Get worktree info for enriching in-progress features
        const worktreeMap = {}; // featureNum -> [{ path, agent, branch }]
        try {
            const wtOutput = execSync('git worktree list', { encoding: 'utf8' });
            wtOutput.split('\n').forEach(line => {
                const wtMatch = line.match(/^([^\s]+)\s+/);
                if (!wtMatch) return;
                const wtPath = wtMatch[1];
                const featureMatch = wtPath.match(/feature-(\d+)-(\w+)-(.+)$/);
                if (featureMatch) {
                    const fNum = featureMatch[1];
                    const agent = featureMatch[2];
                    if (!worktreeMap[fNum]) worktreeMap[fNum] = [];
                    worktreeMap[fNum].push({ path: wtPath, agent });
                }
            });
        } catch (e) {
            // Ignore worktree listing errors
        }

        // Get current branch for solo branch detection
        let currentBranch = '';
        try {
            currentBranch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
        } catch (e) {
            // Ignore
        }

        // Scan folders and collect features
        const folderLabels = {
            '01-inbox': 'Inbox',
            '02-backlog': 'Backlog',
            '03-in-progress': 'In Progress',
            '04-in-evaluation': 'In Evaluation',
            '05-done': 'Done',
            '06-paused': 'Paused'
        };

        let totalCount = 0;

        PATHS.features.folders.forEach(folder => {
            if (!folderFilter.has(folder)) return;
            const dir = path.join(PATHS.features.root, folder);
            if (!fs.existsSync(dir)) return;

            const files = fs.readdirSync(dir)
                .filter(f => f.startsWith('feature-') && f.endsWith('.md'))
                .sort();

            if (files.length === 0) return;

            const label = folderLabels[folder] || folder;
            console.log(`\n${label} (${files.length}):`);

            files.forEach(file => {
                // Match both "feature-55-desc.md" (has ID) and "feature-desc.md" (no ID, inbox)
                const idMatch = file.match(/^feature-(\d+)-(.*)\.md$/);
                const noIdMatch = !idMatch && file.match(/^feature-(.*)\.md$/);
                if (!idMatch && !noIdMatch) return;

                const fNum = idMatch ? idMatch[1] : null;
                const fDesc = idMatch ? idMatch[2] : noIdMatch[1];
                totalCount++;

                let detail = '';

                if (folder === '03-in-progress' && fNum) {
                    const wts = worktreeMap[fNum] || worktreeMap[String(parseInt(fNum, 10))] || [];
                    if (wts.length === 0) {
                        // Solo branch mode — check if branch exists
                        const branchName = `feature-${fNum}-${fDesc}`;
                        let branchExists = false;
                        try {
                            execSync(`git rev-parse --verify ${branchName}`, { stdio: 'pipe' });
                            branchExists = true;
                        } catch (e) {
                            // Branch doesn't exist
                        }
                        const active = currentBranch === branchName ? ' *' : '';
                        detail = branchExists ? `  solo (branch)${active}` : '';
                    } else if (wts.length === 1) {
                        detail = `  solo-wt (${wts[0].agent})  ${wts[0].path}`;
                    } else {
                        const agents = wts.map(w => w.agent).join(', ');
                        detail = `  arena (${agents})`;
                    }
                }

                const prefix = fNum ? `#${fNum}` : '   ';
                console.log(`   ${prefix}  ${fDesc}${detail}`);
            });
        });

        if (totalCount === 0) {
            console.log('\nNo features found.');
        }

        if (!showAll && !showDone) {
            console.log(`\nUse --all to include done features, --active for in-progress only.`);
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
                const agentTemplateRaw = readTemplate(config.templatePath);
                // Process template with agent-specific placeholders
                const agentTemplateContent = processTemplate(agentTemplateRaw, config.placeholders);
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

                    const removed = removeDeprecatedCommands(cmdDir, config);

                    if (config.output.global) {
                        console.log(`   ✅ Installed global prompts: ${config.output.commandDir}`);
                        console.log(`   ⚠️  Note: Codex prompts are global (shared across all projects)`);
                    } else {
                        console.log(`   ✅ Created: ${config.output.commandDir}/*`);
                    }
                    if (removed.length > 0) {
                        console.log(`   🧹 Removed ${removed.length} deprecated command(s): ${removed.join(', ')}`);
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

                    // Add permissions (Claude, Cursor)
                    if (extras.settings.permissions) {
                        if (!settings.permissions) settings.permissions = {};
                        if (!settings.permissions.allow) settings.permissions.allow = [];
                        if (!settings.permissions.deny) settings.permissions.deny = [];
                        extras.settings.permissions.forEach(perm => {
                            if (!settings.permissions.allow.includes(perm)) {
                                settings.permissions.allow.push(perm);
                            }
                        });
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

            // Update installed version
            const currentVersion = getAigonVersion();
            if (currentVersion) {
                setInstalledVersion(currentVersion);
            }

            // Git commit suggestion - only if there are actual changes
            try {
                const gitStatus = execSync('git status --porcelain docs/ CLAUDE.md GEMINI.md .claude/ .cursor/ .codex/ .gemini/ 2>/dev/null', { encoding: 'utf8' });
                if (gitStatus.trim()) {
                    console.log(`\n📝 To commit these changes:`);
                    console.log(`   git add docs/ CLAUDE.md GEMINI.md .claude/ .cursor/ .codex/ .gemini/ 2>/dev/null; git commit -m "chore: install Aigon v${currentVersion || 'latest'}"`);
                }
            } catch (e) {
                // Not a git repo or git not available - skip suggestion
            }

        } catch (e) {
            console.error(`❌ Failed: ${e.message}`);
        }
    },
    'update': () => {
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
                    // Codex: check for .codex/prompt.md with Aigon content
                    const promptPath = path.join(process.cwd(), '.codex', 'prompt.md');
                    if (fs.existsSync(promptPath)) {
                        const content = fs.readFileSync(promptPath, 'utf8');
                        if (content.includes('Aigon')) {
                            installedAgents.push(key);
                        }
                    }
                } else if (key === 'cu') {
                    // Cursor: check for .cursor/commands/ with aigon commands
                    const cursorCmdsDir = path.join(process.cwd(), '.cursor', 'commands');
                    if (fs.existsSync(cursorCmdsDir)) {
                        const files = fs.readdirSync(cursorCmdsDir);
                        if (files.some(f => f.startsWith('aigon-'))) {
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

            // 5. Re-run install-agent for detected agents
            if (installedAgents.length > 0) {
                console.log(`\n📦 Re-installing agents: ${installedAgents.join(', ')}`);
                commands['install-agent'](installedAgents);
            } else {
                console.log(`\nℹ️  No agents detected. Run 'aigon install-agent <cc|gg|cx|cu>' to install.`);
            }

            // 6. Update installed version
            if (currentVersion) {
                setInstalledVersion(currentVersion);
            }

            // Summary - check git status for actual changes
            let hasChanges = false;
            try {
                const gitStatus = execSync('git status --porcelain docs/ CLAUDE.md GEMINI.md .claude/ .cursor/ .codex/ .gemini/ 2>/dev/null', { encoding: 'utf8' });
                hasChanges = gitStatus.trim().length > 0;
            } catch (e) {
                // Not a git repo - assume changes were made
                hasChanges = true;
            }

            if (hasChanges) {
                console.log(`\n✅ Aigon updated to v${currentVersion || 'unknown'}.`);
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
            // Create default config file
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
            console.log(`\n   You can customize:`);
            console.log(`   - terminal: Terminal to use (currently only "warp" supported)`);
            console.log(`   - agents.{id}.cli: Override CLI command for each agent`);
        } else if (subcommand === 'show') {
            const config = loadGlobalConfig();
            console.log(`\n📋 Aigon Configuration:\n`);
            console.log(JSON.stringify(config, null, 2));
            console.log(`\n   Config file: ${GLOBAL_CONFIG_PATH}`);
            console.log(`   Exists: ${fs.existsSync(GLOBAL_CONFIG_PATH) ? 'yes' : 'no (using defaults)'}`);
        } else {
            console.error(`Usage: aigon config <init|show>`);
            console.error(`\n  init  - Create default config at ~/.aigon/config.json`);
            console.error(`  show  - Show current configuration`);
        }
    },

    'worktree-open': (args) => {
        // Parse arguments: [feature-id] [agent-code] [--terminal=<type>]
        let featureId = null;
        let agentCode = null;
        let terminalOverride = null;

        args.forEach(arg => {
            if (arg.startsWith('--terminal=')) {
                terminalOverride = arg.split('=')[1];
            } else if (arg.startsWith('-t=')) {
                terminalOverride = arg.split('=')[1];
            } else if (!featureId && /^\d+$/.test(arg)) {
                featureId = arg;
            } else if (!agentCode && !arg.startsWith('-')) {
                agentCode = arg;
            }
        });

        // Find worktrees
        let worktrees = [];
        try {
            const wtOutput = execSync('git worktree list', { encoding: 'utf8' });
            wtOutput.split('\n').forEach(line => {
                const wtMatch = line.match(/^([^\s]+)\s+/);
                if (!wtMatch) return;
                const wtPath = wtMatch[1];
                if (wtPath === process.cwd()) return; // Skip main worktree

                // Parse worktree path: feature-{id}-{agent}-{desc}
                const featureMatch = path.basename(wtPath).match(/^feature-(\d+)-(\w+)-(.+)$/);
                if (featureMatch) {
                    worktrees.push({
                        path: wtPath,
                        featureId: featureMatch[1],
                        agent: featureMatch[2],
                        desc: featureMatch[3],
                        mtime: fs.existsSync(wtPath) ? fs.statSync(wtPath).mtime : new Date(0)
                    });
                }
            });
        } catch (e) {
            return console.error(`❌ Could not list worktrees: ${e.message}`);
        }

        if (worktrees.length === 0) {
            return console.error(`❌ No worktrees found.\n\n   Create one with: aigon feature-setup <ID> <agent>`);
        }

        // Filter by feature ID if provided
        if (featureId) {
            const paddedId = String(featureId).padStart(2, '0');
            const unpaddedId = String(parseInt(featureId, 10));
            worktrees = worktrees.filter(wt =>
                wt.featureId === paddedId || wt.featureId === unpaddedId
            );

            if (worktrees.length === 0) {
                return console.error(`❌ No worktrees found for feature ${featureId}`);
            }
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
            // Sort by mtime descending (most recent first)
            worktrees.sort((a, b) => b.mtime - a.mtime);
            selectedWt = worktrees[0];
            console.log(`ℹ️  Multiple worktrees found, opening most recent:`);
            worktrees.forEach((wt, i) => {
                const marker = i === 0 ? '→' : ' ';
                console.log(`   ${marker} ${wt.featureId}-${wt.agent}: ${wt.path}`);
            });
        }

        // Get agent CLI config and determine terminal
        const cliConfig = getAgentCliConfig(selectedWt.agent);
        const globalConfig = loadGlobalConfig();
        const terminal = terminalOverride || globalConfig.terminal;

        // Build the agent command
        const prompt = cliConfig.implementPrompt.replace('{featureId}', selectedWt.featureId);
        let agentCommand;
        if (cliConfig.implementFlag) {
            agentCommand = `${cliConfig.command} ${cliConfig.implementFlag} "${prompt}"`;
        } else {
            agentCommand = `${cliConfig.command} "${prompt}"`;
        }

        // Open based on terminal type
        if (terminal === 'warp') {
            // Create Warp launch configuration
            const wtBasename = path.basename(selectedWt.path);
            const configName = `worktree-${wtBasename}`;
            const warpConfigDir = path.join(os.homedir(), '.warp', 'launch_configurations');
            const configFile = path.join(warpConfigDir, `${configName}.yaml`);

            const yamlContent = `---
name: ${configName}
windows:
  - tabs:
      - layout:
          cwd: "${selectedWt.path}"
          commands:
            - exec: ${agentCommand}
`;

            try {
                if (!fs.existsSync(warpConfigDir)) {
                    fs.mkdirSync(warpConfigDir, { recursive: true });
                }
                fs.writeFileSync(configFile, yamlContent);
                execSync(`open "warp://launch/${configName}"`);

                console.log(`\n🚀 Opening worktree in Warp:`);
                console.log(`   Feature: ${selectedWt.featureId} - ${selectedWt.desc}`);
                console.log(`   Agent: ${selectedWt.agent}`);
                console.log(`   Path: ${selectedWt.path}`);
                console.log(`   Command: ${agentCommand}`);
            } catch (e) {
                console.error(`❌ Failed to open Warp: ${e.message}`);
            }
        } else if (terminal === 'code' || terminal === 'vscode') {
            // Open in VS Code
            try {
                execSync(`code "${selectedWt.path}"`);

                console.log(`\n🚀 Opening worktree in VS Code:`);
                console.log(`   Feature: ${selectedWt.featureId} - ${selectedWt.desc}`);
                console.log(`   Agent: ${selectedWt.agent}`);
                console.log(`   Path: ${selectedWt.path}`);
                console.log(`\n📋 Run this command in the VS Code terminal:`);
                console.log(`   ${agentCommand}`);
            } catch (e) {
                console.error(`❌ Failed to open VS Code: ${e.message}`);
                console.error(`   Make sure the 'code' CLI is installed (VS Code: Cmd+Shift+P > "Install 'code' command")`);
            }
        } else if (terminal === 'cursor') {
            // Open in Cursor
            try {
                execSync(`cursor "${selectedWt.path}"`);

                console.log(`\n🚀 Opening worktree in Cursor:`);
                console.log(`   Feature: ${selectedWt.featureId} - ${selectedWt.desc}`);
                console.log(`   Agent: ${selectedWt.agent}`);
                console.log(`   Path: ${selectedWt.path}`);
                console.log(`\n📋 Run this command in the Cursor terminal:`);
                console.log(`   ${agentCommand}`);
            } catch (e) {
                console.error(`❌ Failed to open Cursor: ${e.message}`);
                console.error(`   Make sure the 'cursor' CLI is installed`);
            }
        } else {
            console.error(`❌ Terminal "${terminal}" not supported.`);
            console.error(`   Supported terminals: warp, code (VS Code), cursor`);
            console.error(`\n   Override with: aigon worktree-open <ID> --terminal=warp`);
            console.error(`   Or set default: Edit ~/.aigon/config.json`);
        }
    },

    'help': () => {
        console.log(`
Aigon - Spec-Driven Development for AI Agents

Usage: aigon <command> [arguments]

Setup:
  init                              Initialize ./docs/specs directory structure
  install-agent <agents...>         Install agent configs (cc, gg, cx, cu)
  update                            Update Aigon files to latest version
  hooks [list]                      List defined hooks (from docs/aigon-hooks.md)
  config <init|show>                Manage global config (~/.aigon/config.json)

Worktree:
  worktree-open [ID] [agent] [--terminal=<type>]
                                    Open worktree in terminal with agent CLI
                                    Terminals: warp (auto-runs), code, cursor

Feature Commands (unified for solo and arena modes):
  feature-create <name>             Create feature spec in inbox
  feature-now <name>                Create + prioritise + setup in one step (solo branch)
  feature-prioritise <name>         Move feature from inbox to backlog (assigns ID)
  feature-setup <ID> [agents...]    Setup for solo (branch) or arena (worktrees)
  feature-implement <ID>            Implement feature in current branch/worktree
  feature-eval <ID>                 Create evaluation (code review or comparison)
  feature-done <ID> [agent]         Merge and complete feature
  feature-cleanup <ID>              Clean up arena worktrees and branches

Research (unified for solo and arena modes):
  research-create <name>            Create research topic in inbox
  research-prioritise <name>        Move research from inbox to backlog (assigns ID)
  research-setup <ID> [agents...]   Setup solo (no agents) or arena (with agents) research
  research-conduct <ID>             Conduct research (agent writes findings)
  research-done <ID> [--complete]   Complete research (shows summary in arena mode)

Examples:
  aigon init                           # Setup specs directory
  aigon install-agent cc gg            # Install Claude and Gemini configs

  # Feature workflow
  aigon feature-create "dark-mode"     # Create new feature spec
  aigon feature-now dark-mode          # Fast-track: create + setup + start immediately
  aigon feature-prioritise dark-mode   # Assign ID, move to backlog
  aigon feature-setup 55               # Solo mode (creates branch)
  aigon feature-setup 55 cc gg cx cu      # Arena mode (creates worktrees)
  aigon worktree-open 55 cc            # Open worktree in Warp with Claude CLI
  aigon feature-implement 55           # Implement in current branch/worktree
  aigon feature-eval 55                # Evaluate implementations
  aigon feature-done 55 cc             # Merge Claude's arena implementation
  aigon feature-cleanup 55 --push      # Clean up losing arena branches

  # Research workflow
  aigon research-create "api-design"   # Create new research topic
  aigon research-prioritise api-design # Assign ID, move to backlog
  aigon research-setup 05              # Solo mode (one agent)
  aigon research-setup 05 cc gg        # Arena mode (multiple agents)
  aigon research-conduct 05            # Agent conducts research
  aigon research-done 05               # Shows findings summary (arena)
  aigon research-done 05 --complete    # Complete research

Agents:
  cc (claude)   - Claude Code
  cu (cursor)   - Cursor
  gg (gemini)   - Gemini CLI
  cx (codex)    - OpenAI Codex
`);
    },
};

// --- Main Execution ---
const args = process.argv.slice(2);
const commandName = args[0];
const commandArgs = args.slice(1);
const cleanCommand = commandName ? commandName.replace(/^aigon-/, '') : null;

if (!cleanCommand || cleanCommand === 'help' || cleanCommand === '--help' || cleanCommand === '-h') {
    commands['help']();
} else if (commands[cleanCommand]) {
    commands[cleanCommand](commandArgs);
} else {
    console.error(`Unknown command: ${commandName}\n`);
    commands['help']();
}