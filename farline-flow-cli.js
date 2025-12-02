#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// --- Configuration ---
const SPECS_ROOT = path.join(process.cwd(), 'docs', 'specs');
const TEMPLATES_ROOT = path.join(__dirname, 'templates');

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
                // Match files with ID: feature-55-description.md
                if (file.startsWith(`${typeConfig.prefix}-${nameOrId}-`)) {
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

function runGit(command) {
    try {
        console.log(`Running git: ${command}`);
        execSync(command, { stdio: 'inherit' });
    } catch (e) {
        console.error("❌ Git command failed.");
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

// --- Agent Configuration ---

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
            });
        };
        createDirs(PATHS.research.root, PATHS.research.folders);
        createDirs(PATHS.features.root, PATHS.features.folders);
        const featLogs = path.join(PATHS.features.root, 'logs');
        if (!fs.existsSync(path.join(featLogs, 'selected'))) fs.mkdirSync(path.join(featLogs, 'selected'), { recursive: true });
        if (!fs.existsSync(path.join(featLogs, 'alternatives'))) fs.mkdirSync(path.join(featLogs, 'alternatives'), { recursive: true });
        if (!fs.existsSync(path.join(PATHS.features.root, 'evaluations'))) fs.mkdirSync(path.join(PATHS.features.root, 'evaluations'), { recursive: true });
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
        console.log(`📋 Assigned ID: ${paddedId}`);
        console.log(`🚀 Next: feature-start ${paddedId}`);
        console.log(`   Solo mode: feature-start ${paddedId}`);
        console.log(`   Multi-agent: feature-start ${paddedId} <agent>`);
    },
    'feature-start': (args) => {
        const name = args[0];
        const agentId = args[1]; // Optional - if provided, multi-agent mode with worktree
        if (!name) return console.error("Usage: ff feature-start <ID> [agent]\n  Without agent: solo mode (branch only)\n  With agent: multi-agent mode (worktree)");

        // Find and move spec to in-progress
        let found = findFile(PATHS.features, name, ['02-backlog']);
        if (found) {
            moveFile(found, '03-in-progress');
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

        if (agentId) {
            // Multi-agent mode: worktree isolation (for bake-offs)
            const branchName = `feature-${num}-${agentId}-${desc}`;
            const worktreePath = `../feature-${num}-${agentId}-${desc}`;
            if (fs.existsSync(worktreePath)) {
                console.warn(`⚠️  Worktree path ${worktreePath} already exists. Skipping.`);
            } else {
                runGit(`git worktree add ${worktreePath} -b ${branchName}`);
                console.log(`📂 Worktree: ${worktreePath}`);
            }
            // Create log for this agent
            const logName = `feature-${num}-${agentId}-${desc}-log.md`;
            const logPath = path.join(logsDir, logName);
            if (!fs.existsSync(logPath)) {
                const template = `# Implementation Log: Feature ${num} - ${desc}\nAgent: ${agentId}\n\n## Plan\n\n## Progress\n\n## Decisions\n`;
                fs.writeFileSync(logPath, template);
                console.log(`📝 Log: ./docs/specs/features/logs/${logName}`);
            }
            console.log(`\n🚀 Multi-agent mode. Next: Open the worktree and implement`);
            console.log(`   Worktree path: ${worktreePath}`);
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
        if (!name) return console.error("Usage: ff feature-eval <name|ID>");
        const found = findFile(PATHS.features, name, ['03-in-progress']);
        if (!found) return console.error(`❌ Could not find feature "${name}" in in-progress.`);
        moveFile(found, '04-in-evaluation');
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

        // Delete the merged branch
        try {
            runGit(`git branch -d ${branchName}`);
            console.log(`🗑️  Deleted branch: ${branchName}`);
        } catch (e) {
            // Branch deletion is optional, don't fail if it doesn't work
        }

        console.log(`\n✅ Feature ${num} complete! (${mode} mode)`);
    },
    'cleanup': (args) => {
        const id = args[0];
        if (!id) return console.error("Usage: ff cleanup <ID>");
        try {
            const stdout = execSync('git worktree list', { encoding: 'utf8' });
            const lines = stdout.split('\n');
            let count = 0;
            lines.forEach(line => {
                const match = line.match(/^([^\s]+)\s+/);
                if (!match) return;
                const wtPath = match[1];
                if (wtPath === process.cwd()) return;
                if (wtPath.includes(`feature-${id}-`)) {
                    console.log(`   Removing: ${wtPath}`);
                    try { execSync(`git worktree remove "${wtPath}" --force`); count++; } 
                    catch (err) { console.error(`   ❌ Failed to remove ${wtPath}`); }
                }
            });
            console.log(`✅ Removed ${count} worktrees.`);
        } catch (e) { console.error("❌ Error reading git worktrees."); }
    },
    'install-agent': (args) => {
        if (args.length === 0) {
            return console.error("Usage: ff install-agent <cc|gg|cx> [cc|gg|cx] ...\nExample: ff install-agent cc gg");
        }

        // Normalize agent aliases
        const agentMap = {
            'cc': 'cc', 'claude': 'cc',
            'gg': 'gg', 'gemini': 'gg',
            'cx': 'cx', 'codex': 'cx'
        };

        const agents = args.map(a => agentMap[a.toLowerCase()]).filter(Boolean);
        if (agents.length === 0) {
            return console.error("❌ No valid agents specified. Use: cc, gg, or cx");
        }

        const uniqueAgents = [...new Set(agents)];

        try {
            // 1. Create shared workflow documentation (always)
            const workflowPath = path.join(process.cwd(), 'docs', 'development_workflow.md');
            const workflowContent = readTemplate('docs/development_workflow.md');
            safeWrite(workflowPath, workflowContent);
            console.log(`✅ Created: docs/development_workflow.md`);

            // 2. Install each agent
            uniqueAgents.forEach(agentKey => {
                const config = AGENT_CONFIGS[agentKey];
                if (!config) return;

                // Create/update docs/agents/<agent>.md from template (preserves user additions)
                const agentDocPath = path.join(process.cwd(), 'docs', 'agents', config.agentFile);
                const agentTemplateContent = readTemplate(config.templatePath);
                // Template already contains markers, extract content between them for upsert
                const markerContentMatch = agentTemplateContent.match(new RegExp(`${MARKER_START}\\n([\\s\\S]*?)\\n${MARKER_END}`));
                const agentContent = markerContentMatch ? markerContentMatch[1] : agentTemplateContent;
                const agentAction = upsertMarkedContent(agentDocPath, agentContent);
                console.log(`✅ ${agentAction.charAt(0).toUpperCase() + agentAction.slice(1)}: docs/agents/${config.agentFile}`);

                // Create/update root <AGENT>.md with markers (if agent uses one)
                if (config.rootFile) {
                    const rootFilePath = path.join(process.cwd(), config.rootFile);
                    const rootContent = getRootFileContent(config);
                    const action = upsertMarkedContent(rootFilePath, rootContent);
                    console.log(`✅ ${action.charAt(0).toUpperCase() + action.slice(1)}: ${config.rootFile}`);
                }

                // Agent-specific extras
                if (agentKey === 'cc') {
                    // Claude: Create skill and slash commands
                    const skillContent = `name: farline-flow
description: Farline Flow workflow.
tools:
  - name: ff_prioritise
    description: Prioritise a feature draft from inbox to backlog
    command: ff feature-prioritise {{id}}
  - name: ff_research_start
    description: Start a research topic
    command: ff research-start {{id}}
  - name: ff_research_done
    description: Complete a research topic
    command: ff research-done {{id}}
  - name: ff_feature_start
    description: Start a feature and create worktree
    command: ff feature-start {{id}} cc
  - name: ff_feature_eval
    description: Move a feature to evaluation
    command: ff feature-eval {{id}}
  - name: ff_feature_done
    description: Complete a feature and merge
    command: ff feature-done {{id}} cc
system_prompt: |
  You are the Farline Flow Manager (ID: cc).
  Read docs/development_workflow.md for the full workflow.
  Read docs/agents/claude.md for Claude-specific configuration.
`;
                    safeWrite(path.join(process.cwd(), '.claude/skills/farline-flow/SKILL.md'), skillContent);
                    console.log(`   ✅ Created: .claude/skills/farline-flow/SKILL.md`);

                    // Claude: Copy command files from templates
                    const cmdBase = path.join(process.cwd(), '.claude/commands');
                    const cmdTemplateDir = path.join(TEMPLATES_ROOT, 'cc/commands');
                    const cmdTemplateFiles = fs.readdirSync(cmdTemplateDir).filter(f => f.endsWith('.md'));
                    cmdTemplateFiles.forEach(file => {
                        const content = fs.readFileSync(path.join(cmdTemplateDir, file), 'utf8');
                        safeWrite(path.join(cmdBase, file), content);
                    });
                    console.log(`   ✅ Created: .claude/commands/ff-*.md`);

                    // Claude: Add 'Bash(ff:*)' to permissions.allow in settings.json
                    const settingsPath = path.join(process.cwd(), '.claude', 'settings.json');
                    let settings = {};
                    if (fs.existsSync(settingsPath)) {
                        try {
                            settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
                        } catch (e) {
                            console.warn(`   ⚠️  Could not parse existing .claude/settings.json, creating new one`);
                        }
                    }
                    // Ensure permissions object and allow array exist
                    if (!settings.permissions) {
                        settings.permissions = {};
                    }
                    if (!settings.permissions.allow) {
                        settings.permissions.allow = [];
                    }
                    // Add 'Bash(ff:*)' if not already present
                    const ffPermission = 'Bash(ff:*)';
                    if (!settings.permissions.allow.includes(ffPermission)) {
                        settings.permissions.allow.push(ffPermission);
                    }
                    // Add a comment field to indicate Farline Flow permissions
                    if (!settings._farlineFlow) {
                        settings._farlineFlow = {
                            note: 'Permissions added by Farline Flow',
                            permissions: [ffPermission]
                        };
                    }
                    safeWrite(settingsPath, JSON.stringify(settings, null, 2));
                    console.log(`   ✅ Added 'Bash(ff:*)' to .claude/settings.json permissions.allow`);

                } else if (agentKey === 'gg') {
                    // Gemini: Copy command files from templates
                    // Folder name becomes the prefix, so 'ff' gives /ff:feature-start
                    const cmdBase = path.join(process.cwd(), '.gemini/commands/ff');
                    const templateDir = path.join(TEMPLATES_ROOT, 'gg');
                    const templateFiles = fs.readdirSync(templateDir).filter(f => f.endsWith('.toml'));
                    templateFiles.forEach(file => {
                        const content = fs.readFileSync(path.join(templateDir, file), 'utf8');
                        safeWrite(path.join(cmdBase, file), content);
                    });
                    console.log(`   ✅ Created: .gemini/commands/ff/*.toml`);

                    // Gemini: Add 'ff' to allowedTools in settings.json
                    const settingsPath = path.join(process.cwd(), '.gemini', 'settings.json');
                    let settings = {};
                    if (fs.existsSync(settingsPath)) {
                        try {
                            settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
                        } catch (e) {
                            console.warn(`   ⚠️  Could not parse existing .gemini/settings.json, creating new one`);
                        }
                    }
                    // Ensure allowedTools array exists and contains 'ff'
                    if (!settings.allowedTools) {
                        settings.allowedTools = [];
                    }
                    if (!settings.allowedTools.includes('ff')) {
                        settings.allowedTools.push('ff');
                    }
                    // Add a comment field to indicate Farline Flow tools
                    if (!settings._farlineFlow) {
                        settings._farlineFlow = {
                            note: 'Tools added by Farline Flow',
                            tools: ['ff']
                        };
                    }
                    safeWrite(settingsPath, JSON.stringify(settings, null, 2));
                    console.log(`   ✅ Added 'ff' to .gemini/settings.json allowedTools`);

                } else if (agentKey === 'cx') {
                    // Codex: Copy prompt.md to .codex/prompt.md
                    const promptPath = path.join(process.cwd(), '.codex', 'prompt.md');
                    const promptContent = fs.readFileSync(path.join(TEMPLATES_ROOT, 'cx/prompt.md'), 'utf8');
                    safeWrite(promptPath, promptContent);
                    console.log(`   ✅ Created: .codex/prompt.md`);

                    // Codex: Copy prompts to .codex/prompts/
                    const promptsDir = path.join(process.cwd(), '.codex', 'prompts');
                    if (!fs.existsSync(promptsDir)) {
                        fs.mkdirSync(promptsDir, { recursive: true });
                    }
                    const promptsTemplateDir = path.join(TEMPLATES_ROOT, 'cx/prompts');
                    const promptFiles = fs.readdirSync(promptsTemplateDir).filter(f => f.endsWith('.md'));
                    promptFiles.forEach(file => {
                        const content = fs.readFileSync(path.join(promptsTemplateDir, file), 'utf8');
                        safeWrite(path.join(promptsDir, file), content);
                    });
                    console.log(`   ✅ Created: .codex/prompts/ff-*.md`);

                    // Codex: Create/update .codex/config.toml with Farline Flow settings
                    const configPath = path.join(process.cwd(), '.codex', 'config.toml');
                    let configContent = '';
                    if (fs.existsSync(configPath)) {
                        configContent = fs.readFileSync(configPath, 'utf8');
                    }
                    // Check if Farline Flow config already exists
                    if (!configContent.includes('[_farlineFlow]')) {
                        // Append Farline Flow configuration
                        const ffConfig = fs.readFileSync(path.join(TEMPLATES_ROOT, 'cx/config.toml'), 'utf8');
                        if (configContent.length > 0 && !configContent.endsWith('\n')) {
                            configContent += '\n';
                        }
                        configContent += '\n' + ffConfig;
                        safeWrite(configPath, configContent);
                        console.log(`   ✅ Created: .codex/config.toml`);
                    } else {
                        console.log(`   ℹ️  .codex/config.toml already has Farline Flow settings`);
                    }
                }
            });

            console.log(`\n🎉 Installed Farline Flow for: ${uniqueAgents.map(a => AGENT_CONFIGS[a].name).join(', ')}`);
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

Commands:
  init                              Initialize ./docs/specs directory structure
  install-agent <agents...>         Install agent configs (cc, gg, cx)
  update                            Update Farline Flow files to latest version

  feature-create <name>             Create feature spec in inbox
  feature-prioritise <name>         Move feature from inbox to backlog (assigns ID)
  feature-start <ID>                Start feature in solo mode (branch only)
  feature-start <ID> <agent>        Start feature in multi-agent mode (worktree)
  feature-eval <ID>                 Move feature to evaluation (optional)
  feature-done <ID>                 Merge solo branch and complete
  feature-done <ID> <agent>         Merge agent's worktree branch and complete

  research-create <name>            Create research topic in inbox
  research-prioritise <name>        Move research from inbox to backlog (assigns ID)
  research-start <ID>               Move research to in-progress
  research-done <ID>                Move research to done

  cleanup <ID>                      Remove remaining worktrees for a feature

Examples:
  ff init                           # Setup specs directory
  ff install-agent cc gg            # Install Claude and Gemini configs
  ff feature-create "dark-mode"     # Create new feature spec
  ff feature-prioritise dark-mode   # Assign ID, move to backlog
  ff feature-start 55 cc            # Start feature 55 with Claude
  ff feature-done 55 cc             # Merge Claude's implementation

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