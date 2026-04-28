'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { openInEditor } = require('./config');

const { parseFrontMatter: _parseFrontMatter, escapeRegex: _escapeRegex } = require('./cli-parse');

/**
 * Read a named markdown section from a spec file's body.
 * Returns an array of bullet item strings (leading `- ` stripped, trimmed).
 */
function readSpecSection(specPath, heading) {
    try {
        const content = fs.readFileSync(specPath, 'utf8');
        const { body } = _parseFrontMatter(content);
        const sectionRegex = new RegExp(
            `^##\\s+${_escapeRegex(heading)}\\s*\\r?\\n([\\s\\S]*?)(?=^##\\s+|\\Z)`,
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
    const regex = new RegExp(`^${typeConfig.prefix}-(\\d+)-`);

    // Layer 1: scan spec folders (user-visible stage projection)
    typeConfig.folders.forEach(folder => {
        const dir = path.join(typeConfig.root, folder);
        if (!fs.existsSync(dir)) return;
        fs.readdirSync(dir).forEach(file => {
            const match = file.match(regex);
            if (match) {
                const num = parseInt(match[1], 10);
                if (num > maxId) maxId = num;
            }
        });
    });

    // Layer 2: scan workflow engine dirs — the actual source of truth.
    // These directories exist for every entity that has ever been started,
    // including done/closed ones whose spec files may have moved or been deleted.
    // Folder names are the numeric IDs (e.g. .aigon/workflows/features/380).
    // Use the git root derived from typeConfig.root (not process.cwd()) so tests
    // with isolated temp-dir repos don't bleed IDs from the host repo's engine dir.
    let resolvedGitRoot = null;
    try {
        resolvedGitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
            cwd: typeConfig.root, stdio: 'pipe',
        }).toString().trim();
    } catch (_) {
        // not a git repo — fall back to process.cwd()
        resolvedGitRoot = process.cwd();
    }

    try {
        const entityDirName = typeConfig.prefix === 'feature' ? 'features' : typeConfig.prefix + 's';
        const engineDir = path.join(resolvedGitRoot, '.aigon', 'workflows', entityDirName);
        if (fs.existsSync(engineDir)) {
            fs.readdirSync(engineDir).forEach(name => {
                const num = parseInt(name, 10);
                if (!isNaN(num) && num > maxId) maxId = num;
            });
        }
    } catch (_) {
        // engine dir unreadable — continue with folder-scan result
    }

    // Layer 3: scan main branch via git so worktrees don't re-use IDs assigned on main
    try {
        const gitRoot = resolvedGitRoot;
        const relPath = path.relative(gitRoot, fs.realpathSync(typeConfig.root));
        for (const branch of ['main', 'master']) {
            try {
                const output = execFileSync(
                    'git', ['ls-tree', '-r', '--name-only', branch, '--', relPath + '/'],
                    { cwd: gitRoot, stdio: 'pipe' }
                ).toString();
                for (const line of output.split('\n')) {
                    const match = path.basename(line.trim()).match(regex);
                    if (match) {
                        const num = parseInt(match[1], 10);
                        if (num > maxId) maxId = num;
                    }
                }
                break;
            } catch (_) { /* branch not found, try next */ }
        }
    } catch (_) {
        // git unavailable or not a git repo — filesystem-only result is fine
    }

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

// Find unprioritized file (no ID) in inbox or paused: feature-description.md
function findUnprioritizedFile(typeConfig, name) {
    const foldersToSearch = ['01-inbox', '06-paused'];
    for (const folder of foldersToSearch) {
        const dir = path.join(typeConfig.root, folder);
        if (!fs.existsSync(dir)) continue;
        const files = fs.readdirSync(dir);
        for (const file of files) {
            if (!file.endsWith('.md')) continue;
            // Match files WITHOUT an ID: feature-description.md (not feature-55-description.md)
            const hasId = new RegExp(`^${typeConfig.prefix}-\\d+-`).test(file);
            if (!hasId && file.includes(name)) {
                return { file, folder, fullPath: path.join(dir, file) };
            }
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
    const parsed = _parseFrontMatter(content);
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

module.exports = {
    readSpecSection,
    getNextId,
    findFile,
    findUnprioritizedFile,
    moveFile,
    modifySpecFile,
    printNextSteps,
    printSpecInfo,
    printError,
    createSpecFile,
};
