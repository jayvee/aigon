'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const git = require('./git');

const ROOT_DIR = path.join(__dirname, '..');
const TEMPLATES_ROOT = path.join(ROOT_DIR, 'templates');
const SPECS_ROOT = path.join(process.cwd(), 'docs', 'specs');

// ---------------------------------------------------------------------------
// Path constants
// ---------------------------------------------------------------------------

const PATHS = {
    research: {
        root: path.join(SPECS_ROOT, 'research-topics'),
        folders: ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused'],
        prefix: 'research'
    },
    features: {
        root: path.join(SPECS_ROOT, 'features'),
        folders: ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused'],
        prefix: 'feature'
    },
    feedback: {
        root: path.join(SPECS_ROOT, 'feedback'),
        folders: ['01-inbox', '02-triaged', '03-actionable', '04-done', '05-wont-fix', '06-duplicate'],
        prefix: 'feedback'
    }
};

// ---------------------------------------------------------------------------
// Marker constants
// ---------------------------------------------------------------------------

const MARKER_START = '<!-- AIGON_START -->';
const MARKER_END = '<!-- AIGON_END -->';

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

function safeWrite(filePath, content) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content);
}

// ---------------------------------------------------------------------------
// Command management
// ---------------------------------------------------------------------------

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

// Clean up old flat commands when an agent migrates to subdirectory layout
// e.g., CC moved from .claude/commands/aigon-*.md to .claude/commands/aigon/*.md
function migrateOldFlatCommands(cmdDir, config) {
    const parentDir = path.dirname(cmdDir);
    // Only migrate if commands are in a subdirectory (not already at root level)
    if (parentDir === cmdDir || !fs.existsSync(parentDir)) return [];

    const ext = config.output.commandFileExtension;
    const subDirName = path.basename(cmdDir);
    const oldPrefix = `${subDirName}-`;

    const migrated = [];
    try {
        for (const file of fs.readdirSync(parentDir)) {
            if (!file.startsWith(oldPrefix) || !file.endsWith(ext)) continue;
            // Check the command name matches one we know about
            const cmdName = file.slice(oldPrefix.length, -ext.length);
            if (!config.commands.includes(cmdName)) continue;
            try {
                fs.unlinkSync(path.join(parentDir, file));
                migrated.push(file);
            } catch (e) {
                console.warn(`   ⚠️  Could not remove old command ${file}: ${e.message}`);
            }
        }
    } catch (e) {
        // Parent dir not readable, skip migration
    }
    return migrated;
}

// ---------------------------------------------------------------------------
// Marked content helpers
// ---------------------------------------------------------------------------

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
        if (updated === existing) {
            return 'unchanged';
        }
        fs.writeFileSync(filePath, updated);
        return 'updated';
    } else {
        // Append to end of file
        fs.writeFileSync(filePath, existing.trimEnd() + '\n\n' + markedContent + '\n');
        return 'appended';
    }
}

// Update only the AIGON_START…AIGON_END marker block in a root file.
// User content outside the markers is NEVER touched.
// preMarkerContent is used only when creating a new file (scaffold).
// markerContent: the generated agent instructions (between AIGON_START/END)
function upsertRootFile(filePath, preMarkerContent, markerContent) {
    const markedBlock = `${MARKER_START}\n${markerContent}\n${MARKER_END}`;

    if (!fs.existsSync(filePath)) {
        const fullContent = preMarkerContent + markedBlock + '\n';
        safeWrite(filePath, fullContent);
        return 'created';
    }

    const existing = fs.readFileSync(filePath, 'utf8');
    // Only match the marker block itself — never touch content outside it
    const markerRegex = new RegExp(`${MARKER_START}[\\s\\S]*?${MARKER_END}\\n?`);

    if (markerRegex.test(existing)) {
        const updated = existing.replace(markerRegex, () => markedBlock + '\n');
        if (updated === existing) {
            return 'unchanged';
        }
        fs.writeFileSync(filePath, updated);
        return 'updated';
    } else {
        // No markers found: append markers at end
        fs.writeFileSync(filePath, existing.trimEnd() + '\n\n' + markedBlock + '\n');
        return 'appended';
    }
}

// ---------------------------------------------------------------------------
// Template reading and processing
// ---------------------------------------------------------------------------

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
        result = result.replace(regex, () => value);
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

// ---------------------------------------------------------------------------
// Command registry
// ---------------------------------------------------------------------------

const COMMAND_REGISTRY = {
    'feature-create': { aliases: ['afc'], argHints: '<feature-name>' },
    'feature-now': { aliases: ['afn'], argHints: '<existing-feature-name> OR <feature-description>' },
    'feature-prioritise': { aliases: ['afp'], argHints: '<feature-name or letter>' },
    'feature-start': { aliases: ['afs'], argHints: '<ID> [agents...]' },
    'feature-do': { aliases: ['afd'], argHints: '<ID> [--agent=<cc|gg|cx|cu>] [--autonomous] [--max-iterations=N] [--auto-submit] [--no-auto-submit] [--dry-run]' },
    'feature-spec': { argHints: '<ID> [--json]', disableModelInvocation: true },
    'feature-status': { argHints: '<ID> [--json]', disableModelInvocation: true },
    'feature-list': { argHints: '[--active] [--all] [--json]', disableModelInvocation: true },
    'feature-submit': { aliases: ['afsb'] },
    'feature-validate': { argHints: '<ID> [--dry-run] [--no-update]', disableModelInvocation: true },
    'feature-eval': { aliases: ['afe'], argHints: '<ID> [--allow-same-model-judge] [--force]' },
    'feature-review': { aliases: ['afr'], argHints: '<ID>' },
    'feature-close': { aliases: ['afcl'], argHints: '<ID> [agent] [--adopt <agents...|all>]', disableModelInvocation: true },
    'feature-cleanup': { argHints: '<ID> [--push]', disableModelInvocation: true },
    'feature-reset': { argHints: '<ID>', disableModelInvocation: true },
    'feature-autonomous-start': { argHints: '<feature-id> <agents...> [--eval-agent=<agent>] [--stop-after=implement|eval|close] | status <feature-id>' },
    'board': { aliases: ['ab'], argHints: '[--list] [--features] [--research] [--active] [--all] [--inbox] [--backlog] [--done] [--no-actions]' },
    'commits': { argHints: '[--feature <id>] [--agent <id>] [--period <Nd|Nw|Nm>] [--limit <N>] [--refresh]' },
    'feature-open': { aliases: ['afo'], argHints: '<ID> [agent] [--all] [--terminal=<type>]' },
    'sessions-close': { argHints: '<ID>' },
    'research-create': { aliases: ['arc'], argHints: '<topic-name>' },
    'research-prioritise': { aliases: ['arp'], argHints: '<topic-name or letter>' },
    'research-start': { aliases: ['ars'], argHints: '<ID> [agents...]' },
    'research-open': { aliases: ['aro'] },
    'research-do': { aliases: ['ard'], argHints: '<ID>' },
    'research-submit': { aliases: ['arsb'], argHints: '' },
    'research-eval': { aliases: ['are'], argHints: '<ID> [--force]' },
    'research-close': { aliases: ['arcl'], argHints: '<ID>' },
    'research-autopilot': { aliases: ['arap'], argHints: '<research-id> [agents...] | status [research-id] | stop [research-id]' },
    'feedback-create': { aliases: ['afbc'], argHints: '<title>' },
    'feedback-list': { aliases: ['afbl'], argHints: '[--inbox|--triaged|--actionable|--done|--wont-fix|--duplicate|--all] [--type <type>] [--severity <severity>] [--tag <tag>]' },
    'feedback-triage': { aliases: ['afbt'], argHints: '<ID> [--type <type>] [--severity <severity|none>] [--tags <csv|none>] [--status <status>] [--duplicate-of <ID|none>] [--action <keep|mark-duplicate|promote-feature|promote-research|wont-fix>] [--apply] [--yes]' },
    'dev-server': { aliases: ['ads'] },
    'dashboard': { argHints: '[list | open [name] | add [path] | remove [path]]', disableModelInvocation: true },
    'agent-status': { argHints: '<implementing|waiting|submitted>', disableModelInvocation: true },
    'status': { argHints: '[ID]', disableModelInvocation: true },
    'deploy': { aliases: ['ad'], argHints: '[--preview]', disableModelInvocation: true },
    'insights': { aliases: ['ai'], argHints: '[--coach] [--refresh]', disableModelInvocation: true },
    'help': { aliases: ['ah'], argHints: '' },
    'next': { aliases: ['an'], argHints: '' },
    'rollout': { argHints: '[--dry-run]', disableModelInvocation: true },
};

const COMMAND_ALIASES = {};
const COMMAND_ALIAS_REVERSE = {};
const COMMAND_ARG_HINTS = {};
const COMMANDS_DISABLE_MODEL_INVOCATION = new Set();

Object.entries(COMMAND_REGISTRY).forEach(([commandName, definition]) => {
    const aliases = Array.isArray(definition.aliases) ? definition.aliases : [];
    aliases.forEach(alias => {
        COMMAND_ALIASES[alias] = commandName;
    });
    if (definition.argHints !== undefined) {
        COMMAND_ARG_HINTS[commandName] = definition.argHints;
    }
    if (definition.disableModelInvocation) {
        COMMANDS_DISABLE_MODEL_INVOCATION.add(commandName);
    }
});

Object.entries(COMMAND_ALIASES).forEach(([alias, commandName]) => {
    if (!COMMAND_ALIAS_REVERSE[commandName]) COMMAND_ALIAS_REVERSE[commandName] = [];
    COMMAND_ALIAS_REVERSE[commandName].push(alias);
});

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
        if (frontmatterFields.includes('argument-hint')) {
            const hint = COMMAND_ARG_HINTS[commandName];
            if (hint) {
                frontmatterLines.push(`argument-hint: "${hint}"`);
            }
        }
        if (frontmatterFields.includes('disable-model-invocation')) {
            if (COMMANDS_DISABLE_MODEL_INVOCATION.has(commandName)) {
                frontmatterLines.push('disable-model-invocation: true');
            }
        }
        if (frontmatterFields.includes('args')) {
            const hint = COMMAND_ARG_HINTS[commandName] || '';
            frontmatterLines.push(`args: ${hint || 'none'}`);
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

// ---------------------------------------------------------------------------
// Agent configuration (legacy - for backwards compatibility)
// ---------------------------------------------------------------------------

const AGENT_CONFIGS = {
    cc: {
        id: 'cc',
        name: 'Claude',
        rootFile: 'CLAUDE.md',
        supportsAgentsMd: false,
        agentFile: 'claude.md',
        templatePath: 'docs/agents/claude.md',
        port: 3001,
        terminalColor: 'blue',     // Warp tab color
        bannerColor: '#3B82F6'     // Browser banner hex color
    },
    gg: {
        id: 'gg',
        name: 'Gemini',
        rootFile: null,  // Gemini reads AGENTS.md
        supportsAgentsMd: true,
        agentFile: 'gemini.md',
        templatePath: 'docs/agents/gemini.md',
        port: 3002,
        terminalColor: 'green',
        bannerColor: '#22C55E'
    },
    cx: {
        id: 'cx',
        name: 'Codex',
        rootFile: null,  // Codex reads AGENTS.md
        supportsAgentsMd: true,
        agentFile: 'codex.md',
        templatePath: 'docs/agents/codex.md',
        port: 3003,
        terminalColor: 'magenta',
        bannerColor: '#A855F7'
    },
    cu: {
        id: 'cu',
        name: 'Cursor',
        rootFile: null,  // Cursor reads AGENTS.md
        supportsAgentsMd: true,
        agentFile: 'cursor.md',
        templatePath: 'docs/agents/cursor.md',
        port: 3004,
        terminalColor: 'yellow',
        bannerColor: '#F97316'
    },
    mv: {
        id: 'mv',
        name: 'Mistral Vibe',
        rootFile: null,
        supportsAgentsMd: true,
        agentFile: 'mistral-vibe.md',
        templatePath: 'docs/agents/mistral-vibe.md',
        port: 3005,
        terminalColor: 'orange',
        bannerColor: '#FF7000'
    }
};

// Generate scaffold content for new root instruction files (e.g. AGENTS.md, CLAUDE.md)
// Only used on first creation — users fill in the sections, which are preserved on update
function getScaffoldContent() {
    return readTemplate('scaffold.md');
}

// Read docs/aigon-project.md if present; otherwise fall back to scaffold content.
function getProjectInstructions() {
    const projectFilePath = path.join(process.cwd(), 'docs', 'aigon-project.md');
    if (fs.existsSync(projectFilePath)) {
        return fs.readFileSync(projectFilePath, 'utf8');
    }
    return getScaffoldContent();
}

function getRootFileContent(agentConfig) {
    const template = readTemplate('root-file.md');
    return processTemplate(template, {
        AGENT_NAME: agentConfig.name,
        AGENT_FILE: agentConfig.agentFile
    });
}

function syncAgentsMdFile() {
    const agentsFilePath = path.join(process.cwd(), 'AGENTS.md');
    const agentsTemplate = readTemplate('generic/agents-md.md');
    const markerContentMatch = agentsTemplate.match(new RegExp(`${MARKER_START}\\n([\\s\\S]*?)\\n${MARKER_END}`));
    const agentsContent = markerContentMatch ? markerContentMatch[1] : agentsTemplate;
    return upsertRootFile(agentsFilePath, getProjectInstructions(), agentsContent);
}

// Delegated to lib/git.js — single source of truth for git operations
// getStatus(cwd) handles both current-dir and worktree-path status with .env filtering
const getWorktreeStatus = (worktreePath) => git.getStatus(worktreePath);

/**
 * Safely remove a git worktree by detaching it from git, then moving the
 * directory to macOS Trash (or falling back to rm -rf on other platforms).
 *
 * This ensures accidentally-uncommitted work can be recovered from the Trash.
 *
 * @param {string} worktreePath - Absolute path to the worktree directory
 * @param {object} [options] - Options
 * @param {boolean} [options.force] - Force removal even if dirty (still moves to Trash)
 * @returns {boolean} - True if removed successfully
 */
function safeRemoveWorktree(worktreePath) {
    if (!worktreePath || !fs.existsSync(worktreePath)) return false;

    // Step 1: Detach worktree from git (without --force which deletes files)
    try {
        // Use 'git worktree remove' with --force to detach, but we want to keep the files.
        // Instead, manually prune by removing the worktree link from .git/worktrees/
        // and then move the directory to Trash.
        const worktreeName = path.basename(worktreePath);
        const mainGitDir = execSync(`git -C "${worktreePath}" rev-parse --git-common-dir`, { encoding: 'utf8' }).trim();
        const wtGitLink = path.join(mainGitDir, 'worktrees', worktreeName);
        if (fs.existsSync(wtGitLink)) {
            fs.rmSync(wtGitLink, { recursive: true, force: true });
        }
        // Remove the .git file in the worktree (it's a link back to the main repo)
        const dotGitFile = path.join(worktreePath, '.git');
        if (fs.existsSync(dotGitFile)) {
            fs.unlinkSync(dotGitFile);
        }
    } catch (e) {
        // If git detach fails, fall back to force remove
        try {
            execSync(`git worktree remove "${worktreePath}" --force`, { stdio: 'pipe' });
            return true;
        } catch (e2) {
            return false;
        }
    }

    // Step 2: Move directory to Trash (macOS) or delete (other platforms)
    if (process.platform === 'darwin') {
        try {
            // Use macOS `trash` command via osascript — moves to Finder Trash
            const escapedPath = worktreePath.replace(/'/g, "'\\''");
            execSync(`osascript -e 'tell application "Finder" to delete POSIX file "${escapedPath}"'`, { stdio: 'pipe' });
            return true;
        } catch (e) {
            // Fallback: try the `trash` CLI if installed
            try {
                execSync(`trash "${worktreePath}"`, { stdio: 'pipe' });
                return true;
            } catch (e2) {
                // Last resort: manual delete
                try {
                    fs.rmSync(worktreePath, { recursive: true, force: true });
                    return true;
                } catch (e3) {
                    return false;
                }
            }
        }
    } else if (process.platform === 'linux') {
        // Try gio trash first (GNOME/FreeDesktop), then trash-cli, then rm
        try {
            execSync(`gio trash "${worktreePath}"`, { stdio: 'pipe' });
            return true;
        } catch (e) {
            try {
                execSync(`trash-put "${worktreePath}"`, { stdio: 'pipe' });
                return true;
            } catch (e2) {
                try {
                    fs.rmSync(worktreePath, { recursive: true, force: true });
                    return true;
                } catch (e3) {
                    return false;
                }
            }
        }
    } else {
        try {
            fs.rmSync(worktreePath, { recursive: true, force: true });
            return true;
        } catch (e) {
            return false;
        }
    }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
    // Constants
    PATHS,
    MARKER_START,
    MARKER_END,
    COMMAND_REGISTRY,
    COMMAND_ALIASES,
    COMMAND_ALIAS_REVERSE,
    COMMAND_ARG_HINTS,
    COMMANDS_DISABLE_MODEL_INVOCATION,
    AGENT_CONFIGS,
    // Template functions
    readTemplate,
    loadAgentConfig,
    getAvailableAgents,
    buildAgentAliasMap,
    processTemplate,
    readGenericTemplate,
    extractDescription,
    formatCommandOutput,
    getScaffoldContent,
    getProjectInstructions,
    getRootFileContent,
    syncAgentsMdFile,
    // File helpers
    upsertMarkedContent,
    upsertRootFile,
    // Command management
    removeDeprecatedCommands,
    migrateOldFlatCommands,
    // Worktree helpers
    getWorktreeStatus,
    safeRemoveWorktree,
};
