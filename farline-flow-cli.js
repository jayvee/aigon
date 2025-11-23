#!/usr/bin/env node

console.log("DEBUG: Farline Flow CLI loaded.");

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// --- Configuration ---
const SPECS_ROOT = path.join(process.cwd(), 'specs'); 

const PATHS = {
    research: {
        root: path.join(SPECS_ROOT, 'research-topics'),
        folders: ['inbox', 'backlog', 'in-progress', 'in-evaluation', 'paused', 'done'],
        prefix: 'research'
    },
    features: {
        root: path.join(SPECS_ROOT, 'features'),
        folders: ['inbox', 'backlog', 'in-progress', 'in-evaluation', 'paused', 'done'],
        prefix: 'feature'
    }
};

// --- Helpers ---

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
                if (file.startsWith(`${typeConfig.prefix}-${nameOrId}-`)) {
                    return { file, folder, fullPath: path.join(dir, file) };
                }
            } else {
                if (file.includes(nameOrId)) {
                    return { file, folder, fullPath: path.join(dir, file) };
                }
            }
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

function organizeAnalysisFiles(featureNum, winnerAgentId) {
    const analysisRoot = path.join(PATHS.features.root, 'analysis');
    const selectedDir = path.join(analysisRoot, 'selected');
    const alternativesDir = path.join(analysisRoot, 'alternatives');

    if (!fs.existsSync(analysisRoot)) return;
    if (!fs.existsSync(selectedDir)) fs.mkdirSync(selectedDir, { recursive: true });
    if (!fs.existsSync(alternativesDir)) fs.mkdirSync(alternativesDir, { recursive: true });

    const files = fs.readdirSync(analysisRoot);
    console.log("\n📁 Organizing Analysis Files...");
    
    files.forEach(file => {
        if (fs.lstatSync(path.join(analysisRoot, file)).isDirectory()) return;
        if (!file.startsWith(`feature-${featureNum}-`)) return;

        const srcPath = path.join(analysisRoot, file);
        const isWinner = file.includes(`-${winnerAgentId}-`) || file.includes(`-${winnerAgentId}.`);

        if (isWinner) {
            const destPath = path.join(selectedDir, file);
            fs.renameSync(srcPath, destPath);
            console.log(`   ⭐ Selected: ${file} -> analysis/selected/`);
        } else {
            const destPath = path.join(alternativesDir, file);
            fs.renameSync(srcPath, destPath);
            console.log(`   📉 Alternative: ${file} -> analysis/alternatives/`);
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

// --- Commands ---

const commands = {
    'init': (args) => {
        console.log("ACTION: Initializing Farline Flow in ./specs ...");
        
        const createDirs = (root, folders) => {
            folders.forEach(f => {
                const p = path.join(root, f);
                if (!fs.existsSync(p)) {
                    fs.mkdirSync(p, { recursive: true });
                    console.log(`   Created: ${p}`);
                }
            });
        };

        createDirs(PATHS.research.root, PATHS.research.folders);
        createDirs(PATHS.features.root, PATHS.features.folders);
        
        const featAnalysis = path.join(PATHS.features.root, 'analysis');
        if (!fs.existsSync(path.join(featAnalysis, 'selected'))) fs.mkdirSync(path.join(featAnalysis, 'selected'), { recursive: true });
        if (!fs.existsSync(path.join(featAnalysis, 'alternatives'))) fs.mkdirSync(path.join(featAnalysis, 'alternatives'), { recursive: true });
        if (!fs.existsSync(path.join(PATHS.features.root, 'evaluations'))) fs.mkdirSync(path.join(PATHS.features.root, 'evaluations'), { recursive: true });

        // Generate Context Anchor
        const readmePath = path.join(SPECS_ROOT, 'README.md');
        if (!fs.existsSync(readmePath)) {
            const readmeContent = `# Farline Flow Specs\n\n**This folder is the Single Source of Truth.**\n\n## Rules\n1. READ ONLY: backlog, inbox, done.\n2. WRITE: Only edit code if feature spec is in features/in-progress.\n`;
            fs.writeFileSync(readmePath, readmeContent);
            console.log("   ✅ Generated Context Anchor: specs/README.md");
        }

        console.log("✅ ./specs directory structure created.");
    },

    'research-prioritise': (args) => {
        const name = args[0];
        if (!name) return console.error("Usage: ff research-prioritise <name|XX>");
        const found = findFile(PATHS.research, name, ['inbox']);
        if (!found) return console.error(`❌ Could not find research "${name}" in inbox.`);
        const nextId = getNextId(PATHS.research);
        const newName = found.file.replace(/-XX-|-xx-/, `-${String(nextId).padStart(2, '0')}-`);
        if (newName === found.file) return console.error("❌ Filename does not contain 'XX' to replace.");
        moveFile(found, 'backlog', newName);
    },

    'research-start': (args) => {
        const name = args[0];
        if (!name) return console.error("Usage: ff research-start <name|ID>");
        const found = findFile(PATHS.research, name, ['backlog']);
        if (!found) return console.error(`❌ Could not find research "${name}" in backlog.`);
        moveFile(found, 'in-progress');
    },

    'research-done': (args) => {
        const name = args[0];
        if (!name) return console.error("Usage: ff research-done <name|ID>");
        const found = findFile(PATHS.research, name, ['in-progress']);
        if (!found) return console.error(`❌ Could not find research "${name}" in in-progress.`);
        moveFile(found, 'done');
    },

    'feature-prioritise': (args) => {
        const name = args[0];
        if (!name) return console.error("Usage: ff feature-prioritise <name|XX>");
        const found = findFile(PATHS.features, name, ['inbox']);
        if (!found) return console.error(`❌ Could not find feature "${name}" in inbox.`);
        const nextId = getNextId(PATHS.features);
        const newName = found.file.replace(/-XX-|-xx-/, `-${String(nextId).padStart(2, '0')}-`);
        if (newName === found.file) return console.error("❌ Filename does not contain 'XX' to replace.");
        moveFile(found, 'backlog', newName);
    },

    'feature-start': (args) => {
        const name = args[0];
        const agentId = args[1]; // <--- This line was likely missing!
        
        if (!name) return console.error("Usage: ff feature-start <name|ID> [agent-id]");

        // 1. Locate the file
        let found = findFile(PATHS.features, name, ['backlog']);
        if (found) {
            moveFile(found, 'in-progress');
            console.log("Moved feature spec to in-progress.");
        } else {
            found = findFile(PATHS.features, name, ['in-progress']);
            if (found) {
                console.log("Feature spec is already in-progress. Adding new agent worktree...");
            } else {
                return console.error(`❌ Could not find feature "${name}" in backlog or in-progress.`);
            }
        }

// 2. Create Worktree & Analysis Log (if Agent ID provided)
        if (agentId) {
            const match = found.file.match(/^feature-(\d+)-(.*)\.md$/);
            if (!match) return console.warn("⚠️  Could not parse filename for branch creation.");
            const [_, num, desc] = match; // Extracted description is stored in 'desc'

            // --- A. GIT WORKTREE SETUP (Uses desc) ---
            const branchName = `feature-${num}-${agentId}-${desc}`;
            const worktreePath = `../feature-${num}-${agentId}-${desc}`;
            
            console.log(`\n🤖 Setup for Agent ${agentId}...`);
            if (fs.existsSync(worktreePath)) {
                console.warn(`⚠️  Worktree path ${worktreePath} already exists. Skipping.`);
            } else {
                runGit(`git worktree add ${worktreePath} -b ${branchName}`);
                console.log(`✅ Worktree created at: ${worktreePath}`);
            }

            // --- B. AUTO-CREATE LOG FILE (FIXED) ---
            const analysisDir = path.join(PATHS.features.root, 'analysis');
            if (!fs.existsSync(analysisDir)) fs.mkdirSync(analysisDir, { recursive: true });
            
            // FIX: Inject the description into the log name
            const logName = `feature-${num}-${agentId}-${desc}-analysis.md`; 
            const logPath = path.join(analysisDir, logName);
            
            if (!fs.existsSync(logPath)) {
                const template = `# Analysis Log: Feature ${num} - ${desc}\nAgent: ${agentId}\n\n## Implementation Plan\n\n## Execution Log\n`;
                fs.writeFileSync(logPath, template);
                console.log(`✅ Created analysis log template: specs/features/analysis/${logName}`);
            }
    },

    'feature-eval': (args) => {
        const name = args[0];
        if (!name) return console.error("Usage: ff feature-eval <name|ID>");
        const found = findFile(PATHS.features, name, ['in-progress']);
        if (!found) return console.error(`❌ Could not find feature "${name}" in in-progress.`);
        moveFile(found, 'in-evaluation');
    },

 'feature-done-won': (args) => {
        const name = args[0];
        const winnerAgentId = args[1];
        if (!name || !winnerAgentId) return console.error("Usage: ff feature-done-won <name|ID> <winning-agent-id>");
        
        const found = findFile(PATHS.features, name, ['in-evaluation', 'in-progress']);
        if (!found) return console.error(`❌ Could not find feature "${name}" in in-evaluation or in-progress.`);
        
        // 1. Extract the Description
        const match = found.file.match(/^feature-(\d+)-(.*)\.md$/);
        if (!match) { console.warn("⚠️  Bad filename. Cannot parse ID."); return; }
        
        // This is the line you found: grabbing the description ('desc')
        const [_, num, desc] = match; 

        moveFile(found, 'done');
        organizeAnalysisFiles(num, winnerAgentId);

        // 2. Use 'desc' in the Branch and Path
        const branchName = `feature-${num}-${winnerAgentId}-${desc}`;
        
        // --- CRITICAL UPDATE HERE ---
        // We add "-${desc}" to match the folder we created in feature-start
        const worktreePath = `../feature-${num}-${winnerAgentId}-${desc}`;

        console.log(`\n🏆 Winner is Agent ${winnerAgentId} (Branch: ${branchName})`);
        
        // Git Operations
        runGit(`git merge --no-ff ${branchName} -m "Merge feature ${num} from agent ${winnerAgentId}"`);
        
        console.log("🧹 Cleaning up worktree...");
        try {
            if (fs.existsSync(worktreePath)) {
                execSync(`git worktree remove "${worktreePath}" --force`); // Added quotes for safety
                console.log(`✅ Removed worktree: ${worktreePath}`);
            } else {
                console.log(`ℹ️  Worktree not found at ${worktreePath}`);
            }
        } catch (e) {
            console.warn(`⚠️  Could not automatically remove worktree.`);
        }
    },

    'cleanup': (args) => {
        const id = args[0];
        if (!id) return console.error("Usage: ff cleanup <ID>");
        console.log(`🧹 Scanning for worktrees associated with Feature ${id}...`);
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
        const agent = args[0];
        if (!agent) return console.error("Usage: ff install-agent <cc|gg|cx>");

        console.log(`🔧 Installing comprehensive configuration for agent: ${agent}...`);

        const safeWrite = (filePath, content) => {
            if (!content) return; 
            if (fs.existsSync(filePath)) {
                // We force overwrite here to fix the bug you found
                console.log(`   ♻️  Overwriting config at: ${path.basename(filePath)}`); 
            } else {
                const dir = path.dirname(filePath);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(filePath, content);
            console.log(`   ✅ Wrote: ${filePath}`);
        };

        try {
if (agent === 'cc' || agent === 'claude') {
                // 1. SKILL.md
                // (No changes needed to SKILL.md content, so reusing previous logic)
                const skillPath = path.join(process.cwd(), '.claude/skills/farline-manager/SKILL.md');
 const skillContent = `name: farline-manager
description: Manage the Farline Flow workflow.
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
    command: ff feature-done-won {{id}} cc
system_prompt: |
  You are the Farline Flow Manager (ID: cc).
  
  ## CRITICAL RULES
  1. **Context:** The \`specs/\` folder is the Single Source of Truth.
  2. **Worktrees:** When implementing code (running \`ff_feature_start\`), you MUST switch to the created directory (e.g., \`../feature-NN-cc-*\`).
  3. **Logging Target:** A blank log file has been auto-created for you. Your log file is ALWAYS named \`specs/features/analysis/feature-NN-cc-analysis.md\`. Use this exact path.
  
  4. **DEFINITION OF DONE (GUARDRAIL):**
     You MUST NOT run \`ff_feature_done\` until you have updated the analysis file.
     The CLI will fail if the log file is empty.
     The log must include:
     - Implementation steps and key decisions.
     - A log of user feedback/changes (the "back and forth").`;

                safeWrite(path.join(process.cwd(), '.claude/skills/farline-manager/SKILL.md'), skillContent);

                // 2. COMMANDS
                const cmdBase = path.join(process.cwd(), '.claude/commands');
                
                // We capture the current folder name (e.g., 'test-ff') so the agent knows how to look back
                const repoName = path.basename(process.cwd());

                const cmds = [
                    { name: 'ff-prioritise', action: 'feature-prioritise', args: '', desc: 'Prioritize feature' },
                    { name: 'ff-research-start', action: 'research-start', args: '', desc: 'Start research' },
                    { name: 'ff-start', action: 'feature-start', args: ' cc', desc: 'Start feature' },
                    { name: 'ff-eval', action: 'feature-eval', args: '', desc: 'Eval feature' },
                    { name: 'ff-done', action: 'feature-done-won', args: ' cc', desc: 'Finish feature' },
                    
                    // --- NEW: The Prompt Macro ---
                    { name: 'ff-implement', isPrompt: true } 
                ];
                
                cmds.forEach(c => {
                    let content;
                    
                    if (c.isPrompt) {
                        // Logic for Prompt Macros (Instructions, not CLI calls)
                        content = `---
description: Switch context to worktree and implement spec
---
# ${c.name}
Run this command followed by the Feature ID.

Example: \`/${c.name} 01\`

1. Find the directory named \`../feature-{{args}}-cc-*\` (ignore the suffix).
2. Switch your working directory to that folder using \`cd\`.
3. Read the spec in \`../${repoName}/specs/features/in-progress/\`.
4. Implement the feature according to the spec and commit your changes.
`;
                    } else {
                        // Logic for Standard CLI Commands
                        content = `---
description: ${c.desc}
---
# ${c.name}
Run this command followed by ID.
\`ff ${c.action} {{args}}${c.args}\``;
                    }

                    safeWrite(path.join(cmdBase, `${c.name}.md`), content);
                });

            } else if (agent === 'gg' || agent === 'gemini') {
                const cmdBase = path.join(process.cwd(), '.gemini/commands/farline');
                const tomls = [
                    { file: 'feature-start.toml', action: "feature-start {{args}} gg" },
                    { file: 'feature-eval.toml', action: "feature-eval {{args}}" },
                    { file: 'feature-done.toml', action: "feature-done-won {{args}} gg" },
                    { file: 'research-start.toml', action: "research-start {{args}}" },
                    { file: 'research-done.toml', action: "research-done {{args}}" }
                ];
                tomls.forEach(t => {
                    safeWrite(path.join(cmdBase, t.file), `name = "${t.file.replace('.toml','')}"\ndescription = "Farline action"\nprompt = "Command: !{ff ${t.action}}"`);
                });

            } else if (agent === 'cx' || agent === 'codex') {
                safeWrite(path.join(process.cwd(), 'FARLINE_FLOW.md'), `# Agent Identity: Codex (ID: cx)\n\n1. Only edit code if feature file is in specs/features/in-progress.\n2. If worktree exists, edit there.\n`);
            }
        } catch (e) { console.error(`❌ Failed: ${e.message}`); }
    },
};

// --- Main Execution ---

const args = process.argv.slice(2);
console.log("DEBUG: Arguments detected:", args);

const commandName = args[0];
const commandArgs = args.slice(1);
const cleanCommand = commandName ? commandName.replace(/^ff-/, '') : null;
console.log("DEBUG: Parsed command:", cleanCommand);

if (cleanCommand && commands[cleanCommand]) {
    console.log("DEBUG: Executing...");
    commands[cleanCommand](commandArgs);
} else {
    console.log("DEBUG: Command not found. Available: init, research-prioritise, research-start, research-done, feature-prioritise, feature-start, feature-eval, feature-done-won, cleanup, install-agent");
}