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
const { ROOT_DIR, openInEditor, loadProjectConfig } = config;
const { detectDevServerContext, isProxyAvailable, getDevProxyUrl } = proxy;
const { PATHS } = templates;

function getStateDir() {
    return path.join(process.cwd(), '.aigon', 'state');
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

/**
 * Parse an `agentId=value,agentId=value` string into a plain object. Accepts
 * either a single string or a multi-value array (e.g. `--models cc=x
 * --models cx=y`). An entry whose value is "none" or empty is treated as an
 * explicit null (clears any workflow-stage default). Unknown/garbled pairs
 * are silently dropped.
 */
function parseAgentOverrideMap(raw) {
    if (raw === undefined || raw === null) return {};
    const values = Array.isArray(raw) ? raw : [raw];
    const out = {};
    for (const entry of values) {
        if (typeof entry !== 'string') continue;
        for (const pair of entry.split(',')) {
            const [rawKey, ...rest] = pair.split('=');
            if (!rawKey || rest.length === 0) continue;
            const key = rawKey.trim();
            const value = rest.join('=').trim();
            if (!key) continue;
            if (!value || value.toLowerCase() === 'none' || value.toLowerCase() === 'null') {
                out[key] = null;
                continue;
            }
            out[key] = value;
        }
    }
    return out;
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
/**
 * Read a named `## Heading` section from a spec file and return its bullet lines.
 * Returns an empty array if the section is absent or the file can't be read.
 * Used by agents to discover the `## Pre-authorised` standing orders in a spec.
 *
 * @param {string} specPath - Absolute path to the spec markdown file
 * @param {string} heading - Section heading text, e.g. 'Pre-authorised'
 * @returns {string[]} Bullet item strings (leading `- ` stripped, trimmed)
 */
function readSpecSection(specPath, heading) {
    try {
        const content = fs.readFileSync(specPath, 'utf8');
        const { body } = parseFrontMatter(content);
        const sectionRegex = new RegExp(
            `^##\\s+${escapeRegex(heading)}\\s*\\r?\\n([\\s\\S]*?)(?=^##\\s+|\\Z)`,
            'im'
        );
        const match = body.match(sectionRegex);
        if (!match) return [];
        return match[1]
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line.startsWith('- '))
            .map(line => line.slice(2).trim())
            .filter(Boolean);
    } catch (_) {
        return [];
    }
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
    build,
    afterWrite
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
    if (typeof afterWrite === 'function') {
        try {
            afterWrite(built);
        } catch (error) {
            try {
                if (fs.existsSync(built.filePath)) fs.unlinkSync(built.filePath);
            } catch (_) { /* best-effort rollback */ }
            throw error;
        }
    }
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
    const agentOffsets = require('./agent-registry').getPortOffsets();
    const offset = context.agentId ? (agentOffsets[context.agentId] || 0) : 0;
    return `http://localhost:${basePort + offset}`;
}

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
// NOTE: Use Object.assign, not `module.exports = { ... }`. utils.js sits in a
// circular require chain (utils → dashboard-server → dashboard-status-collector
// → feedback → utils). Replacing module.exports with a new object means
// modules that required utils during the cycle (e.g. feedback.js) end up with
// a reference to the *original* empty exports object and never see any of the
// properties below. Mutating the existing object keeps those references live.
// Re-introducing `module.exports = { ... }` here crashed the server on startup
// on 2026-04-19 once F273 added a runtime reader for FEEDBACK_STATUS_TO_FOLDER.
Object.assign(module.exports, {
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
    getStateDir,

    // ── feedback constants (unique to utils.js) ──
    FEEDBACK_STATUS_TO_FOLDER,
    FEEDBACK_FOLDER_TO_STATUS,
    FEEDBACK_STATUS_FLAG_TO_FOLDER,
    FEEDBACK_ACTION_TO_STATUS,
    FEEDBACK_DEFAULT_LIST_FOLDERS,

    // ── CLI / YAML helpers ──
    slugify,
    parseCliOptions,
    getOptionValue,
    getOptionValues,
    parseNumericArray,
    parseAgentOverrideMap,
    stripInlineYamlComment,
    splitInlineYamlArray,
    parseYamlScalar,
    parseFrontMatter,
    serializeYamlScalar,
    escapeRegex,
    extractMarkdownSection,

    // ── spec I/O ──
    readSpecSection,

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

    // ── git delegated ──
    runGit,

    // ── terminal / file utils ──
    setTerminalTitle,
    safeWrite,
    safeWriteWithStatus,

    // ── deploy ──
    resolveDeployCommand,
    runDeployCommand,

    // ── eval file helpers ──
    parseEvalFileStatus,
});
