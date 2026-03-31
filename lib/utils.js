'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');
const stateMachine = require('./state-queries');
const git = require('./git');

// Sub-modules — extracted from utils.js; re-exported below for backward compat
const config = require('./config');
const proxy = require('./proxy');
const templates = require('./templates');
const worktree = require('./worktree');
const dashboard = require('./dashboard-server');

// Destructure what the remaining utils.js code still references locally
const { HOOKS_FILE_PATH, ROOT_DIR, openInEditor, loadProjectConfig } = config;
const { detectDevServerContext, isProxyAvailable, getDevProxyUrl } = proxy;
const { readConductorReposFromGlobalConfig } = dashboard;
const { PATHS } = templates;

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
        const commandName = match[2]; // e.g., 'feature-start'
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
 * @param {string} hookName - Name of the hook (e.g., 'pre-feature-start')
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
        AIGON_MODE: context.mode || '',  // 'drive', 'fleet', 'autopilot', or 'swarm'
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
 * @param {string} commandName - Name of the command (e.g., 'feature-start')
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
 * @param {string} commandName - Name of the command (e.g., 'feature-start')
 * @param {Object} context - Context variables to pass to the hook
 */
function runPostHook(commandName, context = {}) {
    const hookName = `post-${commandName}`;
    const result = executeHook(hookName, { ...context, command: commandName });

    if (!result.skipped && !result.success) {
        console.warn(`\n⚠️  Post-hook '${hookName}' failed but command completed.`);
    }
}
const FEEDBACK_STATUS_TO_FOLDER = {
    'inbox': '01-inbox',
    'triaged': '02-triaged',
    'actionable': '03-actionable',
    'done': '04-done',
    'wont-fix': '05-wont-fix',
    'duplicate': '06-duplicate'
};
const FEEDBACK_FOLDER_TO_STATUS = Object.fromEntries(
    Object.entries(FEEDBACK_STATUS_TO_FOLDER).map(([status, folder]) => [folder, status])
);
const FEEDBACK_STATUS_FLAG_TO_FOLDER = {
    'inbox': FEEDBACK_STATUS_TO_FOLDER['inbox'],
    'triaged': FEEDBACK_STATUS_TO_FOLDER['triaged'],
    'actionable': FEEDBACK_STATUS_TO_FOLDER['actionable'],
    'done': FEEDBACK_STATUS_TO_FOLDER['done'],
    'wont-fix': FEEDBACK_STATUS_TO_FOLDER['wont-fix'],
    'duplicate': FEEDBACK_STATUS_TO_FOLDER['duplicate']
};
const FEEDBACK_ACTION_TO_STATUS = {
    'keep': 'triaged',
    'mark-duplicate': 'duplicate',
    'duplicate': 'duplicate',
    'promote-feature': 'actionable',
    'promote-research': 'actionable',
    'wont-fix': 'wont-fix'
};
const FEEDBACK_DEFAULT_LIST_FOLDERS = [
    FEEDBACK_STATUS_TO_FOLDER['inbox'],
    FEEDBACK_STATUS_TO_FOLDER['triaged'],
    FEEDBACK_STATUS_TO_FOLDER['actionable']
];

function slugify(value) {
    const text = String(value || '').trim().toLowerCase();
    const slug = text.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return slug || 'untitled';
}

function parseCliOptions(args) {
    const options = { _: [] };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (!arg.startsWith('--')) {
            options._.push(arg);
            continue;
        }

        const eqIndex = arg.indexOf('=');
        let key;
        let value;

        if (eqIndex !== -1) {
            key = arg.slice(2, eqIndex);
            value = arg.slice(eqIndex + 1);
        } else {
            key = arg.slice(2);
            const nextArg = args[i + 1];
            if (nextArg && !nextArg.startsWith('--')) {
                value = nextArg;
                i++;
            } else {
                value = true;
            }
        }

        if (options[key] === undefined) {
            options[key] = value;
        } else if (Array.isArray(options[key])) {
            options[key].push(value);
        } else {
            options[key] = [options[key], value];
        }
    }

    return options;
}

function getOptionValue(options, key) {
    const value = options[key];
    if (Array.isArray(value)) {
        return value[value.length - 1];
    }
    return value;
}

function getOptionValues(options, key) {
    const value = options[key];
    if (value === undefined) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}

function parseNumericArray(value) {
    if (value === undefined || value === null) return [];
    const values = Array.isArray(value) ? value : [value];
    const parsed = values
        .map(v => parseInt(v, 10))
        .filter(v => Number.isFinite(v) && v > 0);
    return [...new Set(parsed)];
}

function stripInlineYamlComment(value) {
    let inSingle = false;
    let inDouble = false;
    let escaped = false;

    for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            escaped = true;
            continue;
        }
        if (ch === '"' && !inSingle) {
            inDouble = !inDouble;
            continue;
        }
        if (ch === '\'' && !inDouble) {
            inSingle = !inSingle;
            continue;
        }
        if (ch === '#' && !inSingle && !inDouble && (i === 0 || /\s/.test(value[i - 1]))) {
            return value.slice(0, i).trimEnd();
        }
    }

    return value.trimEnd();
}

function splitInlineYamlArray(value) {
    const parts = [];
    let current = '';
    let inSingle = false;
    let inDouble = false;
    let escaped = false;

    for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (escaped) {
            current += ch;
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            current += ch;
            escaped = true;
            continue;
        }
        if (ch === '"' && !inSingle) {
            inDouble = !inDouble;
            current += ch;
            continue;
        }
        if (ch === '\'' && !inDouble) {
            inSingle = !inSingle;
            current += ch;
            continue;
        }
        if (ch === ',' && !inSingle && !inDouble) {
            parts.push(current.trim());
            current = '';
            continue;
        }
        current += ch;
    }

    if (current.trim()) {
        parts.push(current.trim());
    }
    return parts;
}

function parseYamlScalar(rawValue) {
    const value = stripInlineYamlComment(String(rawValue)).trim();
    if (value === '') return '';

    if (value.startsWith('"') && value.endsWith('"')) {
        try {
            return JSON.parse(value);
        } catch (e) {
            return value.slice(1, -1);
        }
    }
    if (value.startsWith('\'') && value.endsWith('\'')) {
        return value.slice(1, -1).replace(/\\'/g, '\'');
    }
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null' || value === '~') return null;
    if (/^-?\d+$/.test(value)) return parseInt(value, 10);
    if (value.startsWith('[') && value.endsWith(']')) {
        const inner = value.slice(1, -1).trim();
        if (!inner) return [];
        return splitInlineYamlArray(inner).map(parseYamlScalar);
    }
    return value;
}

function parseFrontMatter(content) {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!match) {
        return { data: {}, body: content, hasFrontMatter: false };
    }

    const data = {};
    let currentObjectKey = null;
    const rawFrontMatter = match[1];

    rawFrontMatter.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;

        const indent = (line.match(/^\s*/) || [''])[0].length;

        // Handle YAML list items (- value) under a parent key
        const listMatch = trimmed.match(/^-\s+(.+)$/);
        if (listMatch && indent > 0 && currentObjectKey) {
            // Convert object to array on first list item
            if (!Array.isArray(data[currentObjectKey])) {
                data[currentObjectKey] = [];
            }
            data[currentObjectKey].push(parseYamlScalar(listMatch[1]));
            return;
        }

        const kvMatch = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (!kvMatch) return;
        const [, key, rawValue] = kvMatch;

        if (indent === 0) {
            if (rawValue === '') {
                data[key] = {};
                currentObjectKey = key;
            } else {
                data[key] = parseYamlScalar(rawValue);
                currentObjectKey = null;
            }
            return;
        }

        if (currentObjectKey &&
            typeof data[currentObjectKey] === 'object' &&
            !Array.isArray(data[currentObjectKey])) {
            data[currentObjectKey][key] = parseYamlScalar(rawValue);
        }
    });

    const body = content.slice(match[0].length);
    return { data, body, hasFrontMatter: true };
}

function serializeYamlScalar(value) {
    if (value === null || value === undefined) return 'null';
    if (Array.isArray(value)) {
        return `[${value.map(v => serializeYamlScalar(v)).join(', ')}]`;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }
    return JSON.stringify(String(value));
}

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractMarkdownSection(body, heading) {
    const sectionRegex = new RegExp(
        `^##\\s+${escapeRegex(heading)}\\s*\\r?\\n([\\s\\S]*?)(?=^##\\s+|\\Z)`,
        'im'
    );
    const match = body.match(sectionRegex);
    if (!match) return '';
    return match[1]
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
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

function moveFile(fileObj, targetFolder, newFilename = null, options = {}) {
    const targetDir = path.join(path.dirname(path.dirname(fileObj.fullPath)), targetFolder);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    const destName = newFilename || fileObj.file;
    const destPath = path.join(targetDir, destName);
    fs.renameSync(fileObj.fullPath, destPath);
    console.log(`✅ Moved: ${fileObj.file} -> ${targetFolder}/${destName}`);

    // Record transition event in spec frontmatter (best-effort, never blocks the move)
    if (options.actor && destPath.endsWith('.md')) {
        try {
            const stripPrefix = (folder) => folder.replace(/^\d+-/, '');
            const transition = {
                from: stripPrefix(fileObj.folder),
                to: stripPrefix(targetFolder),
                at: new Date().toISOString(),
                actor: options.agentId ? `${options.actor} (${options.agentId})` : options.actor,
            };
            const raw = fs.readFileSync(destPath, 'utf8');
            const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
            if (fmMatch) {
                const yamlEntry = `  - { from: "${transition.from}", to: "${transition.to}", at: "${transition.at}", actor: "${transition.actor}" }`;
                const fmBody = fmMatch[1];
                let newFm;
                if (/^transitions:\s*$/m.test(fmBody)) {
                    // transitions key already exists — append new entry after it
                    newFm = fmBody.replace(/^(transitions:\s*)$/m, `$1\n${yamlEntry}`);
                } else {
                    // No transitions key yet — add it
                    newFm = fmBody + `\ntransitions:\n${yamlEntry}`;
                }
                const newContent = raw.replace(fmMatch[1], newFm);
                fs.writeFileSync(destPath, newContent);
            }
        } catch (e) {
            console.warn(`⚠️  Could not record transition: ${e.message}`);
        }
    }

    return { ...fileObj, folder: targetFolder, file: destName, fullPath: destPath };
}

function modifySpecFile(filePath, modifierFn) {
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = parseFrontMatter(content);
    const modified = modifierFn({
        content,
        data: parsed.data,
        body: parsed.body,
        hasFrontMatter: parsed.hasFrontMatter
    });

    const nextContent = typeof modified === 'string'
        ? modified
        : (modified && typeof modified.content === 'string' ? modified.content : content);

    if (nextContent !== content) {
        fs.writeFileSync(filePath, nextContent);
    }

    return {
        changed: nextContent !== content,
        content: nextContent,
        data: parsed.data,
        body: parsed.body,
        hasFrontMatter: parsed.hasFrontMatter
    };
}

function printNextSteps(items) {
    if (!Array.isArray(items) || items.length === 0) return;
    console.log('🚀 Next steps:');
    items.forEach(line => console.log(`   ${line}`));
}

function printSpecInfo({ type, id, name, specPath, logPath }) {
    const icon = type === 'research' ? '🔬' : type === 'feedback' ? '💬' : '📋';
    const idLabel = id !== undefined && id !== null ? String(id).padStart(2, '0') : null;
    const header = idLabel ? `${type} ${idLabel}` : type;
    const title = name ? ` - ${name}` : '';

    console.log(`\n${icon} ${header}${title}`);
    if (specPath) console.log(`   Spec: ${specPath}`);
    if (logPath) console.log(`   Log:  ${logPath}`);
}

function printError(type, id, details = '') {
    const idPart = id !== undefined && id !== null ? ` "${id}"` : '';
    const suffix = details ? `\n\n${details}` : '';
    console.error(`❌ Could not find ${type}${idPart}.${suffix}`);
}

function createSpecFile({
    input,
    usage,
    example,
    inboxDir,
    existsLabel,
    build
}) {
    if (!input) {
        const exampleText = example ? `\nExample: ${example}` : '';
        console.error(`Usage: ${usage}${exampleText}`);
        return null;
    }

    if (!fs.existsSync(inboxDir)) {
        fs.mkdirSync(inboxDir, { recursive: true });
    }

    const built = build(input);
    if (fs.existsSync(built.filePath)) {
        console.error(`❌ ${existsLabel} already exists: ${built.filename}`);
        return null;
    }

    fs.writeFileSync(built.filePath, built.content);
    console.log(`✅ Created: ./${path.relative(process.cwd(), built.filePath)}`);
    openInEditor(built.filePath);
    if (built.nextMessage) {
        console.log(built.nextMessage);
    }
    return built;
}
function resolveDevServerUrl(context = detectDevServerContext(), proxyAvailable = isProxyAvailable()) {
    if (proxyAvailable) {
        return getDevProxyUrl(context.appId, context.serverId);
    }

    const envLocalPath = path.join(process.cwd(), '.env.local');
    if (fs.existsSync(envLocalPath)) {
        const content = fs.readFileSync(envLocalPath, 'utf8');
        const match = content.match(/^PORT=(\d+)/m);
        if (match) {
            return `http://localhost:${match[1]}`;
        }
    }

    const projectConfig = loadProjectConfig();
    const devProxy = projectConfig.devProxy || {};
    const basePort = devProxy.basePort;
    const agentOffsets = { cc: 1, gg: 2, cx: 3, cu: 4, mv: 5 };
    const offset = context.agentId ? (agentOffsets[context.agentId] || 0) : 0;
    return `http://localhost:${basePort + offset}`;
}

/**
 * Parse log file frontmatter, including a YAML events array.
 * Returns { fields: {key: value}, events: [{ts, status}] }
 * NOTE: Read-only — kept for analytics migration (feature-backfill-timestamps).
 * New code should use lib/manifest.js for all state reads/writes.
 */
function parseLogFrontmatterFull(content) {
    const m = content.match(/^---\n([\s\S]*?)\n---\n/);
    if (!m) return { fields: {}, events: [] };
    const block = m[1];
    const fields = {};
    const events = [];
    let inEvents = false;
    for (const line of block.split('\n')) {
        if (/^events:/.test(line)) { inEvents = true; continue; }
        if (inEvents) {
            if (line.startsWith('  - ')) {
                const tsMatch = line.match(/ts:\s*"([^"]+)"/);
                const statusMatch = line.match(/status:\s*(\w+)/);
                if (tsMatch && statusMatch) events.push({ ts: tsMatch[1], status: statusMatch[1] });
            } else if (line && !/^\s/.test(line)) {
                inEvents = false;
                const idx = line.indexOf(':');
                if (idx !== -1) fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
            }
        } else {
            const idx = line.indexOf(':');
            if (idx === -1) continue;
            const key = line.slice(0, idx).trim();
            const value = line.slice(idx + 1).trim();
            if (key) fields[key] = value;
        }
    }
    return { fields, events };
}

// serializeLogFrontmatter and updateLogFrontmatterInPlace removed —
// agent status now lives in .aigon/state/ JSON manifests via lib/manifest.js.

/**
 * Build series buckets for volume metrics.
 * Returns { daily: [{date, count}], weekly: [...], monthly: [...], quarterly: [...] }
 */
function buildCompletionSeries(allFeatures) {
    const now = new Date();
    function isoWeek(d) {
        const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        const day = t.getUTCDay() || 7;
        t.setUTCDate(t.getUTCDate() + 4 - day);
        const y = t.getUTCFullYear();
        const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
        return `${y}-W${String(w).padStart(2, '0')}`;
    }
    function toDateKey(ts) {
        const d = new Date(ts);
        return d.toISOString().slice(0, 10);
    }
    function toMonthKey(ts) {
        const d = new Date(ts);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    function toQuarterKey(ts) {
        const d = new Date(ts);
        const q = Math.floor(d.getMonth() / 3) + 1;
        return `${d.getFullYear()}-Q${q}`;
    }

    const daily = {}, weekly = {}, monthly = {}, quarterly = {};
    // Pre-populate last 30 days
    for (let i = 29; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 86400000);
        daily[d.toISOString().slice(0, 10)] = 0;
    }
    // Pre-populate last 12 weeks
    for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 7 * 86400000);
        weekly[isoWeek(d)] = 0;
    }
    // Pre-populate last 12 months
    for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        monthly[toMonthKey(d)] = 0;
    }
    // Pre-populate last 8 quarters
    for (let i = 7; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i * 3, 1);
        quarterly[toQuarterKey(d)] = 0;
    }

    allFeatures.forEach(f => {
        if (!f.completedTime) return;
        const ts = f.completedTime;
        const dk = toDateKey(ts);
        const wk = isoWeek(new Date(ts));
        const mk = toMonthKey(ts);
        const qk = toQuarterKey(ts);
        if (dk in daily) daily[dk]++;
        if (wk in weekly) weekly[wk]++;
        if (mk in monthly) monthly[mk]++;
        if (qk in quarterly) quarterly[qk]++;
    });

    return {
        daily: Object.entries(daily).map(([date, count]) => ({ date, count })),
        weekly: Object.entries(weekly).map(([week, count]) => ({ week, count })),
        monthly: Object.entries(monthly).map(([month, count]) => ({ month, count })),
        quarterly: Object.entries(quarterly).map(([quarter, count]) => ({ quarter, count }))
    };
}

/**
 * Build weekly autonomy trend from features.
 */
function buildWeeklyAutonomyTrend(allFeatures) {
    const byWeek = {};
    function isoWeek(d) {
        const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        const day = t.getUTCDay() || 7;
        t.setUTCDate(t.getUTCDate() + 4 - day);
        const y = t.getUTCFullYear();
        const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
        return `${y}-W${String(w).padStart(2, '0')}`;
    }
    allFeatures.forEach(f => {
        if (!f.completedTime || f.autonomyRatio === null) return;
        const wk = isoWeek(new Date(f.completedTime));
        if (!byWeek[wk]) byWeek[wk] = { sum: 0, count: 0 };
        byWeek[wk].sum += f.autonomyRatio;
        byWeek[wk].count++;
    });
    return Object.entries(byWeek)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-12)
        .map(([week, { sum, count }]) => ({
            week,
            score: Math.round(sum / count * 100) / 100
        }));
}

/**
 * Collect analytics data across all registered repos.
 * Returns the analytics payload object.
 */
function collectAnalyticsData(globalConfig) {
    const repos = (globalConfig && Array.isArray(globalConfig.repos))
        ? globalConfig.repos
        : readConductorReposFromGlobalConfig();
    const now = new Date();
    const nowTs = now.getTime();
    const today = new Date(now.toDateString()).getTime();
    const d7 = nowTs - 7 * 24 * 60 * 60 * 1000;
    const d30 = nowTs - 30 * 24 * 60 * 60 * 1000;
    const d90 = nowTs - 90 * 24 * 60 * 60 * 1000;

    const analyticsConfig = (globalConfig && globalConfig.analytics) || {};
    const activeHours = analyticsConfig.activeHours || { start: 8, end: 23 };
    let timezone = analyticsConfig.timezone;
    if (!timezone) {
        try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { timezone = 'UTC'; }
    }

    const allFeatures = [];
    const allTelemetrySessions = [];
    const evalWins = {}; // agent -> { wins, evals }
    const evalWinsByRepo = []; // { repoPath, agent, wins, evals } — for per-repo filtering
    const parseNumberMaybe = (value) => {
        if (value === null || value === undefined || value === '') return null;
        const num = typeof value === 'number' ? value : parseFloat(String(value).trim());
        return Number.isFinite(num) ? num : null;
    };
    const parseBooleanMaybe = (value) => {
        if (value === true || value === false) return value;
        if (value === null || value === undefined) return null;
        const normalized = String(value).trim().toLowerCase();
        if (normalized === 'true') return true;
        if (normalized === 'false') return false;
        return null;
    };
    const parseAutonomyLabel = (value) => {
        if (value === null || value === undefined) return null;
        const label = String(value).trim();
        return label ? label : null;
    };
    const buildDailyMetricTrend = (features, metricKey, sinceTs) => {
        const buckets = {};
        features.forEach(f => {
            if (!inPeriod(f.completedTime, sinceTs)) return;
            const metric = f[metricKey];
            if (metric === null || metric === undefined) return;
            const day = new Date(f.completedTime).toISOString().slice(0, 10);
            if (!buckets[day]) buckets[day] = { sum: 0, count: 0 };
            buckets[day].sum += metric;
            buckets[day].count++;
        });
        return Object.keys(buckets).sort().map(day => ({
            day,
            score: Math.round((buckets[day].sum / buckets[day].count) * 1000) / 1000
        }));
    };
    const buildAutonomyBreakdown = (features) => {
        const labelCounts = {};
        features.forEach(f => {
            if (!f.autonomyLabel) return;
            labelCounts[f.autonomyLabel] = (labelCounts[f.autonomyLabel] || 0) + 1;
        });
        return Object.entries(labelCounts)
            .map(([label, count]) => ({ label, count }))
            .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    };
    const normalizeFeatureId = (value) => {
        if (value === null || value === undefined) return null;
        const raw = String(value).trim();
        if (!raw) return null;
        if (/^\d+$/.test(raw)) return String(parseInt(raw, 10));
        return raw;
    };
    const readTelemetryRecords = (repoRoot) => {
        const telemetryDir = path.join(repoRoot, '.aigon', 'telemetry');
        const records = [];
        const byFeature = {};
        if (!fs.existsSync(telemetryDir)) return { records, byFeature };
        try {
            fs.readdirSync(telemetryDir)
                .filter(f => f.endsWith('.json'))
                .forEach(file => {
                    try {
                        const parsed = JSON.parse(fs.readFileSync(path.join(telemetryDir, file), 'utf8'));
                        const featureId = normalizeFeatureId(parsed.featureId);
                        if (!featureId) return;
                        const tokenUsage = parsed.tokenUsage || {};
                        const input = Number(tokenUsage.input || 0);
                        const output = Number(tokenUsage.output || 0);
                        const thinking = Number(tokenUsage.thinking || 0);
                        const billable = Number(tokenUsage.billable || (input + output + thinking));
                        const record = {
                            featureId,
                            agent: parsed.agent || 'unknown',
                            model: parsed.model || null,
                            startAt: parsed.startAt || null,
                            endAt: parsed.endAt || null,
                            endTime: parsed.endAt ? new Date(parsed.endAt).getTime() : null,
                            costUsd: Number(parsed.costUsd || 0),
                            tokenUsage: {
                                input,
                                output,
                                thinking,
                                billable,
                            },
                        };
                        records.push(record);
                        if (!byFeature[featureId]) byFeature[featureId] = [];
                        byFeature[featureId].push(record);
                    } catch (e) { /* ignore bad telemetry file */ }
                });
        } catch (e) { /* ignore unreadable telemetry dir */ }
        return { records, byFeature };
    };
    const summarizeTelemetryForFeature = (records) => {
        if (!Array.isArray(records) || records.length === 0) return null;
        const costUsd = records.reduce((sum, r) => sum + (Number(r.costUsd) || 0), 0);
        const billableTokens = records.reduce((sum, r) => sum + (Number(r.tokenUsage && r.tokenUsage.billable) || 0), 0);
        return {
            sessions: records.length,
            costUsd: Math.round(costUsd * 10000) / 10000,
            billableTokens: Math.round(billableTokens),
        };
    };
    const aggregateTelemetryByAgent = (records) => {
        if (!Array.isArray(records) || records.length === 0) return null;
        const byAgent = {};
        records.forEach(r => {
            const agent = r.agent || 'unknown';
            if (!byAgent[agent]) byAgent[agent] = { billableTokens: 0, sessions: 0, costUsd: 0 };
            byAgent[agent].billableTokens += Number(r.tokenUsage && r.tokenUsage.billable || 0);
            byAgent[agent].sessions += 1;
            byAgent[agent].costUsd += Number(r.costUsd || 0);
        });
        // Round values
        Object.keys(byAgent).forEach(agent => {
            byAgent[agent].billableTokens = Math.round(byAgent[agent].billableTokens);
            byAgent[agent].costUsd = Math.round(byAgent[agent].costUsd * 10000) / 10000;
        });
        return byAgent;
    };

    repos.forEach(repoPath => {
        const absRepo = path.resolve(repoPath);
        const doneDir = path.join(absRepo, 'docs', 'specs', 'features', '05-done');
        const logsDir = path.join(absRepo, 'docs', 'specs', 'features', 'logs');
        const evalsDir = path.join(absRepo, 'docs', 'specs', 'features', 'evaluations');
        const telemetry = readTelemetryRecords(absRepo);
        telemetry.records.forEach(r => allTelemetrySessions.push({ ...r, repoPath: absRepo }));

        // Parse eval files for win rates
        if (fs.existsSync(evalsDir)) {
            try {
                const repoEvalMap = {}; // agent -> { wins, evals } for this repo
                fs.readdirSync(evalsDir)
                    .filter(f => f.endsWith('.md'))
                    .forEach(evalFile => {
                        try {
                            const content = fs.readFileSync(path.join(evalsDir, evalFile), 'utf8');
                            const participantMatches = content.match(/^- \[.?\] \*\*([a-z]{2})\*\*/gm) || [];
                            const participants = [...new Set(
                                participantMatches
                                    .map(m => { const mm = m.match(/\*\*([a-z]{2})\*\*/); return mm ? mm[1] : null; })
                                    .filter(Boolean)
                            )];
                            participants.forEach(a => {
                                if (!evalWins[a]) evalWins[a] = { wins: 0, evals: 0 };
                                evalWins[a].evals++;
                                if (!repoEvalMap[a]) repoEvalMap[a] = { wins: 0, evals: 0 };
                                repoEvalMap[a].evals++;
                            });
                            const winnerMatch = content.match(/\*\*Winner:\*\*\s*\*\*([a-z]{2})\b/mi);
                            if (winnerMatch) {
                                const winner = winnerMatch[1].toLowerCase();
                                if (!evalWins[winner]) evalWins[winner] = { wins: 0, evals: 0 };
                                evalWins[winner].wins++;
                                if (!repoEvalMap[winner]) repoEvalMap[winner] = { wins: 0, evals: 0 };
                                repoEvalMap[winner].wins++;
                            }
                        } catch (e) { /* ignore */ }
                    });
                Object.entries(repoEvalMap).forEach(([agent, data]) => {
                    evalWinsByRepo.push({ repoPath: absRepo, agent, wins: data.wins, evals: data.evals });
                });
            } catch (e) { /* ignore */ }
        }

        // Scan completed features
        if (!fs.existsSync(doneDir)) return;
        let doneFiles;
        try {
            doneFiles = fs.readdirSync(doneDir).filter(f => /^feature-\d+-.+\.md$/.test(f));
        } catch (e) { return; }

        doneFiles.forEach(specFile => {
            const specMatch = specFile.match(/^feature-(\d+)-(.+)\.md$/);
            if (!specMatch) return;
            const featureNum = specMatch[1];
            const desc = specMatch[2];
            const telemetryRecordsForFeature = telemetry.byFeature[normalizeFeatureId(featureNum)] || [];
            const telemetrySummary = summarizeTelemetryForFeature(telemetryRecordsForFeature);
            const tokensByAgent = aggregateTelemetryByAgent(telemetryRecordsForFeature);

            // Find winner log from flat logs/ dir
            // Winner is determined by: manifest winner field > agent ID in filename > 'solo'
            let selectedLogPath = null;
            let legacyLogDate = null; // date extracted from legacy filename
            let winnerAgent = 'solo';
            let selectedLogContent = null;
            let selectedLogFrontmatter = { fields: {}, events: [] };

            // Try to read winner from manifest
            let manifestWinner = null;
            try {
                const manifestPath = path.join(absRepo, '.aigon', 'state', `feature-${featureNum}.json`);
                if (fs.existsSync(manifestPath)) {
                    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                    if (m.winner) manifestWinner = m.winner;
                }
            } catch (e) { /* ignore */ }

            if (fs.existsSync(logsDir)) {
                try {
                    const allLogs = fs.readdirSync(logsDir)
                        .filter(f => f.startsWith(`feature-${featureNum}-`) && !fs.lstatSync(path.join(logsDir, f)).isDirectory());
                    const standardLogs = allLogs.filter(f => f.endsWith('-log.md'));
                    const legacyLogs = allLogs.filter(f => /\d{4}-\d{2}-\d{2}\.md$/.test(f));

                    // If manifest has a winner, prefer that agent's log
                    let chosen = null;
                    if (manifestWinner && manifestWinner !== 'solo') {
                        chosen = standardLogs.find(f => f.includes(`-${manifestWinner}-`))
                              || legacyLogs.find(f => f.includes(`-${manifestWinner}-`));
                    }
                    if (!chosen) {
                        chosen = standardLogs.length > 0 ? standardLogs[0]
                            : legacyLogs.length > 0 ? legacyLogs[0] : null;
                    }

                    if (chosen) {
                        selectedLogPath = path.join(logsDir, chosen);
                        winnerAgent = manifestWinner || (() => {
                            const agentMatch = chosen.match(/^feature-\d+-([a-z]{2})-.+-log\.md$/);
                            return agentMatch ? agentMatch[1] : 'solo';
                        })();
                        // For legacy filenames, extract date as completedAt fallback
                        const dateMatch = chosen.match(/(\d{4}-\d{2}-\d{2})\.md$/);
                        if (dateMatch) legacyLogDate = dateMatch[1] + 'T12:00:00.000Z';
                        try {
                            selectedLogContent = fs.readFileSync(selectedLogPath, 'utf8');
                            selectedLogFrontmatter = parseLogFrontmatterFull(selectedLogContent);
                        } catch (e) {
                            selectedLogContent = null;
                            selectedLogFrontmatter = { fields: {}, events: [] };
                        }
                    }
                } catch (e) { /* ignore */ }
            }

            // Read timestamps: manifest events > log frontmatter > file mtime
            let startedAt = null;
            let completedAt = null;
            // 1. Manifest events (preferred)
            try {
                const manifestPath = path.join(absRepo, '.aigon', 'state', `feature-${featureNum}.json`);
                if (fs.existsSync(manifestPath)) {
                    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                    const events = m.events || [];
                    const started = events.find(e => e.type === 'stage-changed' && e.to === 'in-progress');
                    const completed = events.find(e => e.type === 'stage-changed' && e.to === 'done');
                    if (started) startedAt = started.at;
                    if (completed) completedAt = completed.at;
                }
            } catch (e) { /* ignore */ }
            // 2. Legacy log frontmatter (for pre-manifest features)
            if ((!startedAt || !completedAt) && selectedLogPath) {
                try {
                    const fmFields = selectedLogFrontmatter.fields;
                    if (!startedAt && fmFields.startedAt) startedAt = fmFields.startedAt;
                    if (!completedAt && fmFields.completedAt) completedAt = fmFields.completedAt;
                } catch (e) { /* ignore */ }
            }
            // 3. Legacy log filename date
            if (!completedAt && legacyLogDate) completedAt = legacyLogDate;
            // 4. File mtime (last resort)
            if (!completedAt) {
                try { completedAt = new Date(fs.statSync(path.join(doneDir, specFile)).mtime).toISOString(); } catch (e) { /* ignore */ }
            }
            if (!startedAt && selectedLogPath) {
                try { startedAt = new Date(fs.statSync(selectedLogPath).mtime).toISOString(); } catch (e) { /* ignore */ }
            }

            const completedTime = completedAt ? new Date(completedAt).getTime() : null;
            const startedTime = startedAt ? new Date(startedAt).getTime() : null;
            const durationMs = (startedTime && completedTime && completedTime > startedTime)
                ? completedTime - startedTime : null;

            // Check autonomous flag in log content
            let autonomousMode = false;
            if (selectedLogContent) {
                try {
                    autonomousMode = /--autonomous/.test(selectedLogContent);
                } catch (e) { /* ignore */ }
            }

            // Calculate autonomy from events (manifest events or legacy frontmatter)
            let fmEvents = [];
            try {
                const manifestPath = path.join(absRepo, '.aigon', 'state', `feature-${featureNum}.json`);
                if (fs.existsSync(manifestPath)) {
                    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                    fmEvents = (m.events || []).filter(e => e.type === 'status-changed').map(e => ({ ts: e.at, status: e.status }));
                }
            } catch (e) { /* ignore */ }
            if (fmEvents.length === 0 && selectedLogPath) {
                try {
                    fmEvents = selectedLogFrontmatter.events;
                } catch (e) { /* ignore */ }
            }

            let waitCount = 0;
            let totalWaitMs = 0;
            let wallTimeMs = null;
            let firstPassSuccess = null;

            if (fmEvents.length >= 2) {
                const firstImpl = fmEvents.find(e => e.status === 'implementing');
                const lastSubmit = [...fmEvents].reverse().find(e => e.status === 'submitted');
                if (firstImpl && lastSubmit) {
                    wallTimeMs = new Date(lastSubmit.ts).getTime() - new Date(firstImpl.ts).getTime();
                }
                for (let i = 0; i < fmEvents.length - 1; i++) {
                    if (fmEvents[i].status === 'waiting') {
                        waitCount++;
                        const nextImpl = fmEvents.slice(i + 1).find(e => e.status === 'implementing');
                        if (nextImpl) {
                            totalWaitMs += new Date(nextImpl.ts).getTime() - new Date(fmEvents[i].ts).getTime();
                        }
                    }
                }
                firstPassSuccess = !fmEvents.some(e => e.status === 'waiting');
            }

            const autonomyRatio = (wallTimeMs && wallTimeMs > 0)
                ? Math.max(0, Math.min(1, 1 - totalWaitMs / wallTimeMs))
                : null;

            // Check cycleTimeExclude from legacy frontmatter (old features) or manifest
            let cycleTimeExclude = false;
            if (selectedLogPath) {
                try {
                    const logFm = selectedLogFrontmatter.fields;
                    cycleTimeExclude = logFm.cycleTimeExclude === 'true' || logFm.cycleTimeExclude === true;
                } catch (e) { /* ignore */ }
            }
            const logFm = selectedLogFrontmatter.fields || {};
            const costUsd = parseNumberMaybe(logFm.cost_usd);
            const tokensPerLineChanged = parseNumberMaybe(logFm.tokens_per_line_changed);
            const inputTokens = parseNumberMaybe(logFm.input_tokens);
            const outputTokens = parseNumberMaybe(logFm.output_tokens);
            const thinkingTokens = parseNumberMaybe(logFm.thinking_tokens);
            const billableTokensFromLog = (inputTokens !== null || outputTokens !== null)
                ? (inputTokens || 0) + (outputTokens || 0) + (thinkingTokens || 0)
                : null;
            const costUsdEffective = costUsd !== null ? costUsd : (telemetrySummary ? telemetrySummary.costUsd : null);
            const billableTokens = billableTokensFromLog !== null
                ? billableTokensFromLog
                : (telemetrySummary ? telemetrySummary.billableTokens : null);
            const autonomyLabel = parseAutonomyLabel(logFm.autonomy_label);
            const reworkThrashing = parseBooleanMaybe(logFm.rework_thrashing);
            const reworkFixCascade = parseBooleanMaybe(logFm.rework_fix_cascade);
            const reworkScopeCreep = parseBooleanMaybe(logFm.rework_scope_creep);
            const hasReworkSignals = [reworkThrashing, reworkFixCascade, reworkScopeCreep].some(v => v !== null);
            const hasReworkFlags = [reworkThrashing, reworkFixCascade, reworkScopeCreep].some(v => v === true);
            const firstPassNoRework = hasReworkSignals ? !hasReworkFlags : null;
            const hasAadeData = [costUsdEffective, tokensPerLineChanged, autonomyLabel].some(v => v !== null) || hasReworkSignals;

            allFeatures.push({
                repoPath: absRepo,
                featureNum,
                desc,
                winnerAgent,
                completedAt,
                startedAt,
                completedTime,
                startedTime,
                durationMs,
                wallTimeMs,
                totalWaitMs,
                waitCount,
                firstPassSuccess,
                autonomousMode,
                autonomyRatio,
                cycleTimeExclude,
                costUsd: costUsdEffective,
                tokensPerLineChanged,
                billableTokens,
                autonomyLabel,
                reworkThrashing,
                reworkFixCascade,
                reworkScopeCreep,
                hasReworkFlags,
                firstPassNoRework,
                hasAadeData,
                tokensByAgent
            });
        });
    });

    const inPeriod = (ts, since) => ts !== null && ts !== undefined && ts >= since;
    const f7d = allFeatures.filter(f => inPeriod(f.completedTime, d7));
    const f30d = allFeatures.filter(f => inPeriod(f.completedTime, d30));
    const f90d = allFeatures.filter(f => inPeriod(f.completedTime, d90));
    const fToday = allFeatures.filter(f => inPeriod(f.completedTime, today));

    // Volume
    const series = buildCompletionSeries(allFeatures);
    const volume = {
        completedToday: fToday.length,
        completed7d: f7d.length,
        completed30d: f30d.length,
        completed90d: f90d.length,
        series
    };

    // Compute trend indicators (30d vs prior 30d)
    const d60 = nowTs - 60 * 24 * 60 * 60 * 1000;
    const prior30d = allFeatures.filter(f => inPeriod(f.completedTime, d60) && !inPeriod(f.completedTime, d30));
    volume.trend30d = prior30d.length > 0
        ? Math.round(((f30d.length - prior30d.length) / prior30d.length) * 100)
        : null;

    // Autonomy
    const featWithAutonomy = f30d.filter(f => f.autonomyRatio !== null);
    const autonomyScore = featWithAutonomy.length > 0
        ? featWithAutonomy.reduce((s, f) => s + f.autonomyRatio, 0) / featWithAutonomy.length
        : null;
    const featWithWaits = f30d.filter(f => f.wallTimeMs !== null);
    const avgWaitEvents = featWithWaits.length > 0
        ? featWithWaits.reduce((s, f) => s + f.waitCount, 0) / featWithWaits.length
        : null;
    const featWithFirstPass = f30d.filter(f => f.firstPassSuccess !== null);
    const firstPassSuccessRate = featWithFirstPass.length > 0
        ? featWithFirstPass.filter(f => f.firstPassSuccess).length / featWithFirstPass.length
        : null;
    const autonomousModeAdoption = f30d.length > 0
        ? f30d.filter(f => f.autonomousMode).length / f30d.length
        : null;
    const featWithTouchTime = f30d.filter(f => f.wallTimeMs && f.wallTimeMs > 0);
    const avgTouchTimeRatio = featWithTouchTime.length > 0
        ? featWithTouchTime.reduce((s, f) => s + (f.totalWaitMs / f.wallTimeMs), 0) / featWithTouchTime.length
        : null;
    const weeklyTrend = buildWeeklyAutonomyTrend(allFeatures);

    const autonomy = {
        score: autonomyScore !== null ? Math.round(autonomyScore * 100) / 100 : null,
        avgWaitEventsPerFeature: avgWaitEvents !== null ? Math.round(avgWaitEvents * 10) / 10 : null,
        autonomousModeAdoption: autonomousModeAdoption !== null ? Math.round(autonomousModeAdoption * 100) / 100 : null,
        firstPassSuccessRate: firstPassSuccessRate !== null ? Math.round(firstPassSuccessRate * 100) / 100 : null,
        avgTouchTimeRatio: avgTouchTimeRatio !== null ? Math.round(avgTouchTimeRatio * 100) / 100 : null,
        overnightCommitPct: null,
        trend: weeklyTrend
    };

    // Amplification (AADE) metrics
    const featWithAade = allFeatures.filter(f => f.hasAadeData);
    const featWithCost30d = f30d.filter(f => f.costUsd !== null);
    const tplFeatures30d = f30d.filter(f => f.tokensPerLineChanged !== null);
    const featWithRework30d = f30d.filter(f => f.firstPassNoRework !== null);
    const firstPassRateNoRework = featWithRework30d.length > 0
        ? featWithRework30d.filter(f => f.firstPassNoRework).length / featWithRework30d.length
        : null;
    const reworkRate30d = featWithRework30d.length > 0
        ? featWithRework30d.filter(f => f.hasReworkFlags).length / featWithRework30d.length
        : null;
    const avgCost30d = featWithCost30d.length > 0
        ? featWithCost30d.reduce((sum, f) => sum + f.costUsd, 0) / featWithCost30d.length
        : null;
    const avgTokensPerLine30d = tplFeatures30d.length > 0
        ? tplFeatures30d.reduce((sum, f) => sum + f.tokensPerLineChanged, 0) / tplFeatures30d.length
        : null;
    const costTrend7d = buildDailyMetricTrend(allFeatures, 'costUsd', d7);
    const costTrend30d = buildDailyMetricTrend(allFeatures, 'costUsd', d30);
    const tplTrend7d = buildDailyMetricTrend(allFeatures, 'tokensPerLineChanged', d7);
    const tplTrend30d = buildDailyMetricTrend(allFeatures, 'tokensPerLineChanged', d30);
    const recentCostCards = allFeatures
        .filter(f => f.costUsd !== null)
        .sort((a, b) => (b.completedTime || 0) - (a.completedTime || 0))
        .slice(0, 8)
        .map(f => ({
            featureNum: f.featureNum,
            desc: f.desc,
            repoPath: f.repoPath,
            costUsd: Math.round(f.costUsd * 10000) / 10000,
            autonomyLabel: f.autonomyLabel,
            hasReworkFlags: f.hasReworkFlags
        }));
    const autonomyBreakdown30d = buildAutonomyBreakdown(f30d);
    const autonomyBreakdownAll = buildAutonomyBreakdown(allFeatures);
    const amplification = {
        featuresWithAadeData: featWithAade.length,
        firstPassRateNoRework: firstPassRateNoRework !== null ? Math.round(firstPassRateNoRework * 100) / 100 : null,
        reworkRate30d: reworkRate30d !== null ? Math.round(reworkRate30d * 100) / 100 : null,
        avgCostUsd30d: avgCost30d !== null ? Math.round(avgCost30d * 10000) / 10000 : null,
        avgTokensPerLineChanged30d: avgTokensPerLine30d !== null ? Math.round(avgTokensPerLine30d * 1000) / 1000 : null,
        trends: {
            costPerFeature: {
                d7: costTrend7d,
                d30: costTrend30d
            },
            tokensPerLineChanged: {
                d7: tplTrend7d,
                d30: tplTrend30d
            }
        },
        autonomyLabels: {
            d30: autonomyBreakdown30d,
            allTime: autonomyBreakdownAll
        },
        recentCostCards
    };
    const telemetryAgent30d = {};
    allTelemetrySessions.forEach(s => {
        if (!inPeriod(s.endTime, d30)) return;
        const agent = s.agent || 'unknown';
        if (!telemetryAgent30d[agent]) telemetryAgent30d[agent] = { sessions: 0, costUsd: 0, billableTokens: 0 };
        telemetryAgent30d[agent].sessions += 1;
        telemetryAgent30d[agent].costUsd += Number(s.costUsd || 0);
        telemetryAgent30d[agent].billableTokens += Number(s.tokenUsage && s.tokenUsage.billable || 0);
    });
    amplification.crossAgentCost30d = Object.entries(telemetryAgent30d)
        .map(([agent, data]) => ({
            agent,
            sessions: data.sessions,
            costUsd: Math.round(data.costUsd * 10000) / 10000,
            billableTokens: Math.round(data.billableTokens),
        }))
        .sort((a, b) => b.costUsd - a.costUsd);

    // Token usage by agent over time (for stacked bar chart)
    // Bucket telemetry sessions by day and agent
    const tokensByAgentTimeSeries = (() => {
        const buckets = {}; // { day: { agent: billableTokens } }
        allTelemetrySessions.forEach(s => {
            if (!s.endTime) return;
            const day = new Date(s.endTime).toISOString().slice(0, 10);
            const agent = s.agent || 'unknown';
            if (!buckets[day]) buckets[day] = {};
            if (!buckets[day][agent]) buckets[day][agent] = 0;
            buckets[day][agent] += Number(s.tokenUsage && s.tokenUsage.billable || 0);
        });
        return Object.keys(buckets).sort().map(day => ({
            day,
            agents: buckets[day]
        }));
    })();
    amplification.tokensByAgentTimeSeries = tokensByAgentTimeSeries;

    // Agent efficiency summary (median tokens, median cost per agent across all features)
    const agentEfficiency = (() => {
        const agentFeatureMap = {}; // agent -> [{ billableTokens, costUsd }]
        allFeatures.forEach(f => {
            if (!f.tokensByAgent) return;
            Object.entries(f.tokensByAgent).forEach(([agent, data]) => {
                if (!agentFeatureMap[agent]) agentFeatureMap[agent] = [];
                agentFeatureMap[agent].push({
                    billableTokens: data.billableTokens || 0,
                    costUsd: data.costUsd || 0,
                    tokensPerLineChanged: f.tokensPerLineChanged,
                });
            });
        });
        const median = (arr) => {
            if (arr.length === 0) return null;
            const sorted = arr.slice().sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        };
        return Object.entries(agentFeatureMap).map(([agent, features]) => ({
            agent,
            features: features.length,
            medianTokens: Math.round(median(features.map(f => f.billableTokens)) || 0),
            medianCost: Math.round((median(features.map(f => f.costUsd)) || 0) * 10000) / 10000,
            medianTokensPerLine: (() => {
                const tplVals = features.map(f => f.tokensPerLineChanged).filter(v => v !== null && v !== undefined);
                const m = median(tplVals);
                return m !== null ? Math.round(m * 100) / 100 : null;
            })(),
        })).sort((a, b) => b.features - a.features);
    })();
    amplification.agentEfficiency = agentEfficiency;

    // Quality
    const featWithDuration = f30d.filter(f => f.durationMs !== null && f.durationMs > 0 && !f.cycleTimeExclude);
    const durHours = featWithDuration.map(f => f.durationMs / (1000 * 3600)).sort((a, b) => a - b);
    const round1 = v => Math.round(v * 10) / 10;
    const durMid = Math.floor(durHours.length / 2);
    const quality = {
        durationHours: {
            average: durHours.length > 0 ? round1(durHours.reduce((s, v) => s + v, 0) / durHours.length) : null,
            median: durHours.length > 0 ? round1(durHours.length % 2 ? durHours[durMid] : (durHours[durMid - 1] + durHours[durMid]) / 2) : null,
            max: durHours.length > 0 ? round1(durHours[durHours.length - 1]) : null
        },
        avgIterationsPerFeature: avgWaitEvents !== null ? round1(1 + avgWaitEvents / 2) : null,
        cycleTrend: []
    };

    // Agent performance
    const agentMap = {};
    allFeatures.forEach(f => {
        const agent = f.winnerAgent || 'solo';
        if (!agentMap[agent]) agentMap[agent] = [];
        agentMap[agent].push(f);
    });
    const agents = Object.entries(agentMap).map(([agent, feats]) => {
        const recent = feats.filter(f => inPeriod(f.completedTime, d30));
        const withAutonomy = feats.filter(f => f.autonomyRatio !== null);
        const agentAutonomy = withAutonomy.length > 0
            ? withAutonomy.reduce((s, f) => s + f.autonomyRatio, 0) / withAutonomy.length : null;
        const withFP = feats.filter(f => f.firstPassSuccess !== null);
        const agentFP = withFP.length > 0
            ? withFP.filter(f => f.firstPassSuccess).length / withFP.length : null;
        const withDur = feats.filter(f => f.durationMs !== null && f.durationMs > 0 && !f.cycleTimeExclude);
        const agentDurSorted = withDur.map(f => f.durationMs / (1000 * 3600)).sort((a, b) => a - b);
        const agentMid = Math.floor(agentDurSorted.length / 2);
        const agentCycle = agentDurSorted.length > 0
            ? (agentDurSorted.length % 2 ? agentDurSorted[agentMid] : (agentDurSorted[agentMid - 1] + agentDurSorted[agentMid]) / 2) : null;
        return {
            agent,
            completed: feats.length,
            completed30d: recent.length,
            autonomyScore: agentAutonomy !== null ? Math.round(agentAutonomy * 100) / 100 : null,
            firstPassRate: agentFP !== null ? Math.round(agentFP * 100) / 100 : null,
            avgCycleHours: agentCycle !== null ? round1(agentCycle) : null
        };
    }).sort((a, b) => b.completed - a.completed);

    // Eval wins
    const evalWinsArray = Object.entries(evalWins)
        .map(([agent, data]) => ({
            agent,
            wins: data.wins,
            evals: data.evals,
            winRate: data.evals > 0 ? Math.round(data.wins / data.evals * 100) / 100 : 0
        }))
        .sort((a, b) => b.wins - a.wins);

    return {
        generatedAt: new Date().toISOString(),
        config: { activeHours, timezone },
        volume,
        autonomy,
        quality,
        amplification,
        agents,
        evalWins: evalWinsArray,
        evalWinsByRepo,
        features: allFeatures.map(f => ({
            featureNum: f.featureNum,
            desc: f.desc,
            repoPath: f.repoPath,
            winnerAgent: f.winnerAgent,
            completedAt: f.completedAt,
            startedAt: f.startedAt,
            durationMs: f.durationMs,
            waitCount: f.waitCount,
            firstPassSuccess: f.firstPassSuccess,
            autonomousMode: f.autonomousMode,
            autonomyRatio: f.autonomyRatio,
            cycleTimeExclude: f.cycleTimeExclude || false,
            costUsd: f.costUsd,
            tokensPerLineChanged: f.tokensPerLineChanged,
            billableTokens: f.billableTokens,
            autonomyLabel: f.autonomyLabel,
            reworkThrashing: f.reworkThrashing,
            reworkFixCascade: f.reworkFixCascade,
            reworkScopeCreep: f.reworkScopeCreep,
            hasReworkFlags: f.hasReworkFlags,
            firstPassNoRework: f.firstPassNoRework,
            hasAadeData: f.hasAadeData,
            tokensByAgent: f.tokensByAgent || null
        }))
    };
}


// Delegated to lib/git.js — single source of truth for git operations
const runGit = git.run;

/**
 * Set terminal tab/window title using ANSI escape sequences.
 * Works in most terminals including Warp, iTerm2, Terminal.app, etc.
 * @param {string} title - The title to set
 */
function setTerminalTitle(title) {
    // Only set title if we're in an interactive terminal (not piped)
    if (process.stdout.isTTY) {
        // OSC 0 = set icon name and window title
        // ESC ] 0 ; <title> BEL
        process.stdout.write(`\x1b]0;${title}\x07`);
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
    const pkgPath = path.join(ROOT_DIR, 'package.json');
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
    // Skip in worktrees — only the main repo tracks installed version.
    // Writing it in worktrees causes merge conflicts when feature-close merges back.
    const worktreeMarker = path.join(process.cwd(), '.aigon', 'worktree.json');
    if (fs.existsSync(worktreeMarker)) return;
    const versionPath = path.join(process.cwd(), VERSION_FILE);
    safeWrite(versionPath, version);
}

// Parse changelog and return entries between two versions
function getChangelogEntriesSince(fromVersion) {
    const changelogPath = path.join(ROOT_DIR, 'CHANGELOG.md');
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

let aigonCliOriginCheckCache = null;

// Check if aigon CLI source is behind its GitHub origin
// Returns { behind: number, error: string | null }
function checkAigonCliOrigin() {
    if (aigonCliOriginCheckCache) {
        return aigonCliOriginCheckCache;
    }

    try {
        // Check if ROOT_DIR is a git repo with an origin remote
        try {
            execSync('git remote get-url origin', { cwd: ROOT_DIR, stdio: 'pipe' });
        } catch {
            aigonCliOriginCheckCache = { behind: 0, error: null };
            return aigonCliOriginCheckCache; // No remote — skip silently
        }

        // Fetch latest from origin (quiet, non-fatal)
        try {
            execSync('git fetch origin --quiet', { cwd: ROOT_DIR, stdio: 'pipe', timeout: 15000 });
        } catch (e) {
            aigonCliOriginCheckCache = { behind: 0, error: `Could not reach origin: ${e.message}` };
            return aigonCliOriginCheckCache;
        }

        // Detect default branch on remote
        let remoteBranch = 'origin/main';
        try {
            execSync('git rev-parse --verify origin/main', { cwd: ROOT_DIR, stdio: 'pipe' });
        } catch {
            try {
                execSync('git rev-parse --verify origin/master', { cwd: ROOT_DIR, stdio: 'pipe' });
                remoteBranch = 'origin/master';
            } catch {
                aigonCliOriginCheckCache = { behind: 0, error: null };
                return aigonCliOriginCheckCache;
            }
        }

        // Count commits behind
        const count = execSync(`git rev-list HEAD..${remoteBranch} --count`, {
            cwd: ROOT_DIR, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
        }).trim();

        aigonCliOriginCheckCache = { behind: parseInt(count, 10) || 0, error: null };
        return aigonCliOriginCheckCache;
    } catch (e) {
        aigonCliOriginCheckCache = { behind: 0, error: e.message };
        return aigonCliOriginCheckCache;
    }
}

// Pull latest aigon source from origin and run npm install
function upgradeAigonCli() {
    console.log('🔄 CLI upgrade: pulling latest aigon from origin...');
    try {
        execSync('git pull origin main', { cwd: ROOT_DIR, stdio: 'inherit' });
    } catch {
        // Try master if main fails
        execSync('git pull origin master', { cwd: ROOT_DIR, stdio: 'inherit' });
    }
    console.log('📦 CLI upgrade: installing dependencies...');
    execSync('npm ci', { cwd: ROOT_DIR, stdio: 'inherit' });
    aigonCliOriginCheckCache = null;
    console.log('✅ CLI upgrade complete.\n');
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

/**
 * Resolve the deploy command from config or package.json.
 * @param {boolean} isPreview - true for --preview, false for production
 * @returns {string|null} resolved shell command, or null if not configured
 */
function resolveDeployCommand(isPreview) {
    const key = isPreview ? 'preview' : 'deploy';

    // 1. Check .aigon/config.json → commands.deploy / commands.preview
    const projectConfig = loadProjectConfig();
    if (projectConfig?.commands?.[key]) {
        return projectConfig.commands[key];
    }

    // 2. Fall back to package.json scripts.deploy / scripts.preview
    const pkgPath = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            if (pkg?.scripts?.[key]) {
                return `npm run ${key}`;
            }
        } catch (e) { /* ignore parse errors */ }
    }

    return null;
}

/**
 * Run the resolved deploy command, streaming output to the terminal.
 * @param {boolean} isPreview
 * @returns {number} exit code
 */
function runDeployCommand(isPreview) {
    const cmd = resolveDeployCommand(isPreview);
    const label = isPreview ? 'preview' : 'deploy';

    if (!cmd) {
        console.error(`❌ No ${label} command configured.`);
        console.error(`\nTo configure, add to .aigon/config.json:`);
        console.error(`  {`);
        console.error(`    "commands": {`);
        if (isPreview) {
            console.error(`      "preview": "vercel"`);
        } else {
            console.error(`      "deploy": "vercel --prod"`);
        }
        console.error(`    }`);
        console.error(`  }`);
        console.error(`\nOr add a "${label}" script to package.json.`);
        return 1;
    }

    console.log(`🚀 Running ${label}: ${cmd}`);
    const result = spawnSync(cmd, { stdio: 'inherit', shell: true });

    if (result.error) {
        console.error(`❌ Failed to run deploy command: ${result.error.message}`);
        return 1;
    }
    return result.status ?? 0;
}


// ---------------------------------------------------------------------------
// Eval file helpers
// ---------------------------------------------------------------------------

/**
 * Parse a feature eval file and return its status string.
 * Returns 'pick winner' if a winner has been selected, 'evaluating' otherwise.
 *
 * @param {string} evalsDir - path to the evaluations directory
 * @param {string} featureId - feature ID (numeric string)
 * @returns {'evaluating'|'pick winner'}
 */
function parseEvalFileStatus(evalsDir, featureId) {
    const evalFile = path.join(evalsDir, `feature-${featureId}-eval.md`);
    if (!fs.existsSync(evalFile)) return 'evaluating';
    try {
        const content = fs.readFileSync(evalFile, 'utf8');
        const winnerMatch = content.match(/\*\*Winner[:\s]*\*?\*?\s*(.+)/i);
        if (winnerMatch) {
            const val = winnerMatch[1].replace(/\*+/g, '').trim();
            if (val && !val.includes('to be determined') && !val.includes('TBD') && val !== '()') {
                return 'pick winner';
            }
        }
    } catch (e) { /* ignore */ }
    return 'evaluating';
}

// ---------------------------------------------------------------------------
// Module exports — backward-compatible re-exports from sub-modules + own APIs
// ---------------------------------------------------------------------------
module.exports = {
    // ── config ──
    ...config,

    // ── proxy ──
    ...proxy,

    // ── dashboard-server ──
    ...dashboard,

    // ── worktree ──
    ...worktree,

    // ── templates ──
    ...templates,

    // ── state-machine (feature/research action derivation moved to workflow-core engine) ──
    getSessionAction: stateMachine.getSessionAction,

    // ── git re-exports (shared.js scope picks these up) ──
    getCurrentBranch: git.getCurrentBranch,
    getCurrentHead: git.getCurrentHead,
    getDefaultBranch: git.getDefaultBranch,
    branchExists: git.branchExists,
    listBranches: git.listBranches,
    getCommonDir: git.getCommonDir,
    getStatusRaw: git.getStatusRaw,
    ensureCommit: git.ensureCommit,

    // ── feedback constants (unique to utils.js) ──
    FEEDBACK_STATUS_TO_FOLDER,
    FEEDBACK_FOLDER_TO_STATUS,
    FEEDBACK_STATUS_FLAG_TO_FOLDER,
    FEEDBACK_ACTION_TO_STATUS,
    FEEDBACK_DEFAULT_LIST_FOLDERS,

    // ── hooks ──
    parseHooksFile,
    getDefinedHooks,
    executeHook,
    runPreHook,
    runPostHook,

    // ── CLI / YAML helpers ──
    slugify,
    parseCliOptions,
    getOptionValue,
    getOptionValues,
    parseNumericArray,
    stripInlineYamlComment,
    splitInlineYamlArray,
    parseYamlScalar,
    parseFrontMatter,
    serializeYamlScalar,
    escapeRegex,
    extractMarkdownSection,

    // ── spec CRUD ──
    getNextId,
    findFile,
    findUnprioritizedFile,
    moveFile,
    modifySpecFile,
    printNextSteps,
    printSpecInfo,
    printError,
    createSpecFile,

    // ── dev server ──
    resolveDevServerUrl,

    // ── log frontmatter ──

    // ── analytics ──
    buildCompletionSeries,
    buildWeeklyAutonomyTrend,
    collectAnalyticsData,

    // ── git delegated ──
    runGit,

    // ── terminal / file utils ──
    setTerminalTitle,
    safeWrite,
    safeWriteWithStatus,

    // ── version ──
    VERSION_FILE,
    getAigonVersion,
    getInstalledVersion,
    setInstalledVersion,
    getChangelogEntriesSince,
    compareVersions,
    checkAigonCliOrigin,
    upgradeAigonCli,

    // ── deploy ──
    resolveDeployCommand,
    runDeployCommand,

    // ── eval file helpers ──
    parseEvalFileStatus,
};
