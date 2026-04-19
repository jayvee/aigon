'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const utils = require('./utils');
const git = require('./git');
const workflowReadModel = require('./workflow-read-model');

const STAGE_BY_FOLDER = Object.freeze({
    '01-inbox': 'inbox',
    '02-backlog': 'backlog',
    '03-in-progress': 'in-progress',
    '04-in-evaluation': 'in-evaluation',
    '05-done': 'done',
    '06-paused': 'paused',
});

const FOLDER_BY_STAGE = Object.freeze({
    inbox: '01-inbox',
    backlog: '02-backlog',
    'in-progress': '03-in-progress',
    'in-evaluation': '04-in-evaluation',
    done: '05-done',
    paused: '06-paused',
});

function getItemCompatibilityBadge(item) {
    if (item && item.missingWorkflowState) return ' [legacy]';
    return '';
}

function collectBoardItems(typeConfig, folderFilter, repoPath = process.cwd()) {
    const collected = [];
    typeConfig.folders.forEach(folder => {
        const dir = path.join(typeConfig.root, folder);
        if (!fs.existsSync(dir)) return;

        const files = fs.readdirSync(dir)
            .filter(f => f.startsWith(typeConfig.prefix + '-') && f.endsWith('.md'))
            .sort((a, b) => {
                const mtimeA = fs.statSync(path.join(dir, a)).mtimeMs;
                const mtimeB = fs.statSync(path.join(dir, b)).mtimeMs;
                return mtimeB - mtimeA;
            });

        files.forEach(file => {
            const idMatch = file.match(new RegExp(`^${typeConfig.prefix}-(\\d+)-(.*)\.md$`));
            const noIdMatch = !idMatch && file.match(new RegExp(`^${typeConfig.prefix}-(.*)\.md$`));
            if (!idMatch && !noIdMatch) return;

            collected.push({
                id: idMatch ? idMatch[1] : null,
                name: idMatch ? idMatch[2] : noIdMatch[1],
                file,
                sourceFolder: folder,
                visibleStage: STAGE_BY_FOLDER[folder],
                mtimeMs: fs.statSync(path.join(dir, file)).mtimeMs,
            });
        });
    });

    const deduped = new Map();
    collected
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .forEach(item => {
            const key = item.id ? `id:${item.id}` : `name:${item.name}`;
            if (!deduped.has(key)) deduped.set(key, item);
        });

    const items = {};
    [...deduped.values()].forEach(item => {
        const state = typeConfig.prefix === 'feature'
            ? workflowReadModel.getFeatureDashboardState(repoPath, item.id || item.name, item.visibleStage, [])
            : workflowReadModel.getResearchDashboardState(repoPath, item.id || item.name, item.visibleStage, []);
        const resolvedFolder = FOLDER_BY_STAGE[state.stage || item.visibleStage];
        if (!resolvedFolder || !folderFilter.has(resolvedFolder)) return;
        if (!items[resolvedFolder]) items[resolvedFolder] = [];
        items[resolvedFolder].push({
            ...item,
            stage: state.stage || item.visibleStage,
            readOnly: state.readOnly,
            legacy: state.legacy,
            missingWorkflowState: state.missingWorkflowState,
            readModelSource: state.readModelSource,
            boardAction: state.nextAction ? state.nextAction.command : null,
        });
    });

    Object.keys(items).forEach(folder => {
        items[folder].sort((a, b) => b.mtimeMs - a.mtimeMs);
    });
    return items;
}

function getWorktreeInfo() {
    const worktreeMap = {}; // featureNum -> [{ path, agent }]
    try {
        git.listWorktreePaths().forEach(wtPath => {
            // Match feature worktrees
            const featureMatch = wtPath.match(/feature-(\d+)-(\w+)-(.+)$/);
            if (featureMatch) {
                const fNum = featureMatch[1];
                const agent = featureMatch[2];
                if (!worktreeMap[fNum]) worktreeMap[fNum] = [];
                worktreeMap[fNum].push({ path: wtPath, agent, type: 'feature' });
            }

            // Match research worktrees
            const researchMatch = wtPath.match(/research-(\d+)-(\w+)-(.+)$/);
            if (researchMatch) {
                const rNum = researchMatch[1];
                const agent = researchMatch[2];
                if (!worktreeMap[rNum]) worktreeMap[rNum] = [];
                worktreeMap[rNum].push({ path: wtPath, agent, type: 'research' });
            }
        });
    } catch (e) {
        // Ignore worktree listing errors
    }
    return worktreeMap;
}

// Delegated to lib/git.js — single source of truth for git operations
const getCurrentBranch = git.getCurrentBranch;

function saveBoardMapping(mapping) {
    const mappingDir = path.join(process.cwd(), '.aigon');
    const mappingPath = path.join(mappingDir, '.board-map.json');
    if (!fs.existsSync(mappingDir)) fs.mkdirSync(mappingDir, { recursive: true });
    try {
        fs.writeFileSync(mappingPath, JSON.stringify(mapping, null, 2));
    } catch (e) {
        // Silently fail
    }
}

function loadBoardMapping() {
    const mappingPath = path.join(process.cwd(), '.aigon', '.board-map.json');
    if (!fs.existsSync(mappingPath)) return null;
    try {
        const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
        const age = Date.now() - (mapping.timestamp || 0);
        if (age > 24 * 60 * 60 * 1000) return null; // Expired
        return mapping;
    } catch (e) {
        return null;
    }
}

/**
 * Get the suggested next CLI action for a board item.
 * @param {string} typePrefix - 'feature' or 'research'
 * @param {string} folder - Stage folder (e.g. '01-inbox', '03-in-progress')
 * @param {Object} item - { id, name }
 * @param {Object} worktreeMap - Map of id -> [{path, agent}]
 * @returns {string|null} Slash command string, or null if no action applies
 */
function getBoardAction(typePrefix, folder, item, worktreeMap, currentBranch, repoPath = process.cwd()) {
    if (Object.prototype.hasOwnProperty.call(item || {}, 'boardAction')) {
        return item.boardAction || null;
    }

    const stage = STAGE_BY_FOLDER[folder];
    if (!stage) return null;

    const state = typePrefix === 'feature'
        ? workflowReadModel.getFeatureDashboardState(repoPath, item.id || item.name, stage, [])
        : workflowReadModel.getResearchDashboardState(repoPath, item.id || item.name, stage, []);
    return state.nextAction ? state.nextAction.command : null;
}

function displayBoardKanbanView(options) {
    const { includeFeatures, includeResearch } = options;

    const boardMapping = { features: {}, research: {}, timestamp: Date.now() };
    let letterIndex = 0;

    console.log('╔═══════════════════════ Aigon Board ════════════════════════╗\n');

    if (includeFeatures) {
        letterIndex = displayKanbanSection('FEATURES', utils.PATHS.features, options, boardMapping.features, letterIndex);
    }

    if (includeResearch) {
        if (includeFeatures) console.log('');
        letterIndex = displayKanbanSection('RESEARCH', utils.PATHS.research, options, boardMapping.research, letterIndex);
    }

    saveBoardMapping(boardMapping);
}

function displayKanbanSection(title, typeConfig, options, mapping = {}, startLetterIndex = 0) {
    const { showAll, showActive, showInbox, showBacklog, showDone, showActions } = options;
    const hasFilter = showAll || showActive || showInbox || showBacklog || showDone;
    let letterIndex = startLetterIndex;

    // Determine which folders to show
    const folderFilter = new Set();
    if (showAll) {
        typeConfig.folders.forEach(f => folderFilter.add(f));
    } else if (hasFilter) {
        if (showInbox) folderFilter.add('01-inbox');
        if (showBacklog) folderFilter.add('02-backlog');
        if (showActive) {
            folderFilter.add('03-in-progress');
            if (typeConfig.prefix === 'feature') folderFilter.add('04-in-evaluation');
            if (typeConfig.prefix === 'research') folderFilter.add('04-in-evaluation');
        }
        if (showDone) {
            if (typeConfig.prefix === 'feature') folderFilter.add('05-done');
            if (typeConfig.prefix === 'research') folderFilter.add('05-done');
        }
    } else {
        // Default: everything except done
        typeConfig.folders.forEach(f => {
            if (typeConfig.prefix === 'feature' && f !== '05-done') folderFilter.add(f);
            if (typeConfig.prefix === 'research' && f !== '05-done') folderFilter.add(f);
        });
    }

    const items = collectBoardItems(typeConfig, folderFilter);
    const worktreeMap = getWorktreeInfo();
    const currentBranch = getCurrentBranch();

    // Folder labels for display
    const columnMap = {
        'feature': {
            '01-inbox': 'Inbox',
            '02-backlog': 'Backlog',
            '03-in-progress': 'In Progress',
            '04-in-evaluation': 'Evaluation',
            '05-done': 'Done',
            '06-paused': 'Paused'
        },
        'research': {
            '01-inbox': 'Inbox',
            '02-backlog': 'Backlog',
            '03-in-progress': 'In Progress',
            '04-in-evaluation': 'Evaluation',
            '05-done': 'Done',
            '06-paused': 'Paused'
        }
    };

    const columns = columnMap[typeConfig.prefix];
    const candidateFolders = typeConfig.folders.filter(f => folderFilter.has(f));

    // Auto-collapse: only show columns with items
    const displayFolders = candidateFolders.filter(f => {
        const folderItems = items[f] || [];
        return folderItems.length > 0;
    });

    // Skip section entirely if no items
    if (displayFolders.length === 0) {
        return;
    }

    console.log(`${title}`);

    // Dynamic column width based on terminal size
    const terminalWidth = process.stdout.columns || 120;
    const numCols = displayFolders.length;
    const bordersAndPadding = (numCols * 3) + 4; // │ separators + margins
    const availableWidth = terminalWidth - bordersAndPadding;
    const calculatedWidth = Math.floor(availableWidth / numCols);
    const colWidth = Math.max(12, Math.min(30, calculatedWidth)); // Min 12, max 30

    const header = displayFolders.map(f => (columns[f] || f).padEnd(colWidth).substring(0, colWidth)).join(' │ ');
    const separator = displayFolders.map(() => '─'.repeat(colWidth)).join('─┼─');

    console.log('┌─' + separator + '─┐');
    console.log('│ ' + header + ' │');
    console.log('├─' + separator + '─┤');

    // Find max rows
    const maxRows = Math.max(...displayFolders.map(f => (items[f] || []).length), 0);

    // Display rows
    for (let i = 0; i < maxRows; i++) {
        const row = displayFolders.map(folder => {
            const folderItems = items[folder] || [];
            if (i >= folderItems.length) return ''.padEnd(colWidth);

            const item = folderItems[i];
            let display = item.id ? `#${item.id} ${item.name}` : item.name;
            display += getItemCompatibilityBadge(item);

            // Add letter label for unprioritized inbox items
            if (folder === '01-inbox' && !item.id) {
                const letter = String.fromCharCode(97 + letterIndex);
                display = `${letter}) ${display}`;
                mapping[letter] = item.name;
                letterIndex++;
            }

            // Add worktree/mode indicator for in-progress items
            if (folder === '03-in-progress' && item.id) {
                const wts = worktreeMap[item.id] || [];
                if (wts.length > 1) {
                    // Fleet mode - show [F] with agent count
                    display += ` [F:${wts.length}]`;
                } else if (wts.length === 1) {
                    // Single worktree — check if autopilot (ralph-progress file exists)
                    const progressFile = path.join(utils.PATHS.features.root, 'logs', `feature-${item.id}-ralph-progress.md`);
                    if (fs.existsSync(progressFile)) {
                        display += ' [AP]';
                    } else {
                        display += ' [wt]';
                    }
                } else {
                    // Drive branch - check if it's current
                    const branchName = `${typeConfig.prefix}-${item.id}-${item.name}`;
                    if (currentBranch === branchName) {
                        display += ' *';
                    }
                }
            }

            // Truncate to fit column
            return display.padEnd(colWidth).substring(0, colWidth);
        }).join(' │ ');

        console.log('│ ' + row + ' │');
    }

    // Display counts
    const counts = displayFolders.map(f => {
        const count = (items[f] || []).length;
        return `(${count})`.padEnd(colWidth).substring(0, colWidth);
    }).join(' │ ');

    console.log('├─' + separator + '─┤');
    console.log('│ ' + counts + ' │');
    console.log('└─' + separator + '─┘');

    // Next actions block
    if (showActions) {
        const actionLines = [];
        displayFolders.forEach(folder => {
            (items[folder] || []).forEach(item => {
                const action = getBoardAction(typeConfig.prefix, folder, item, worktreeMap, currentBranch);
                if (!action) return;
                const label = item.id ? `#${item.id} ${item.name}` : item.name;
                actionLines.push(`  ${label.padEnd(26)} → ${action}`);
            });
        });
        if (actionLines.length > 0) {
            console.log('\nNext actions:');
            actionLines.forEach(l => console.log(l));
        }
    }

    return letterIndex;
}

function displayBoardListView(options) {
    const { includeFeatures, includeResearch } = options;

    if (includeFeatures) {
        displayListSection('FEATURES', utils.PATHS.features, options);
    }

    if (includeResearch) {
        if (includeFeatures) console.log(''); // Spacing
        displayListSection('RESEARCH', utils.PATHS.research, options);
    }
}

function displayListSection(title, typeConfig, options) {
    const { showAll, showActive, showInbox, showBacklog, showDone, showActions } = options;
    const hasFilter = showAll || showActive || showInbox || showBacklog || showDone;

    // Determine which folders to show
    const folderFilter = new Set();
    if (showAll) {
        typeConfig.folders.forEach(f => folderFilter.add(f));
    } else if (hasFilter) {
        if (showInbox) folderFilter.add('01-inbox');
        if (showBacklog) folderFilter.add('02-backlog');
        if (showActive) {
            folderFilter.add('03-in-progress');
            if (typeConfig.prefix === 'feature') folderFilter.add('04-in-evaluation');
            if (typeConfig.prefix === 'research') folderFilter.add('04-in-evaluation');
        }
        if (showDone) {
            if (typeConfig.prefix === 'feature') folderFilter.add('05-done');
            if (typeConfig.prefix === 'research') folderFilter.add('05-done');
        }
    } else {
        // Default: everything except done
        typeConfig.folders.forEach(f => {
            if (typeConfig.prefix === 'feature' && f !== '05-done') folderFilter.add(f);
            if (typeConfig.prefix === 'research' && f !== '05-done') folderFilter.add(f);
        });
    }

    const folderLabels = {
        '01-inbox': 'Inbox',
        '02-backlog': 'Backlog',
        '03-in-progress': 'In Progress',
        '04-in-evaluation': 'In Evaluation',
        '05-done': 'Done',
        '06-paused': 'Paused',
    };

    const worktreeMap = getWorktreeInfo();
    const currentBranch = getCurrentBranch();

    const divider = '─'.repeat(56);
    console.log(`${title}\n${divider}`);

    let totalCount = 0;

    typeConfig.folders.forEach(folder => {
        if (!folderFilter.has(folder)) return;
        const folderItems = items[folder] || [];
        if (folderItems.length === 0) return;

        const label = folderLabels[folder] || folder;
        console.log(`\n${label} (${folderItems.length})`);

        folderItems.forEach(item => {
            const itemId = item.id;
            const itemName = item.name;
            totalCount++;

            let detail = '';

            if (folder === '03-in-progress' && itemId) {
                const wts = worktreeMap[itemId] || [];
                if (wts.length === 0) {
                    // Drive branch mode
                    const branchName = `${typeConfig.prefix}-${itemId}-${itemName}`;
                    let branchExists = false;
                    try {
                        execSync(`git rev-parse --verify ${branchName}`, { stdio: 'pipe' });
                        branchExists = true;
                    } catch (e) {
                        // Branch doesn't exist
                    }
                    const active = currentBranch === branchName ? ' *' : '';
                    detail = branchExists ? `  Drive${active}` : '';
                } else if (wts.length === 1) {
                    // Single worktree — check if autopilot
                    const progressFile = path.join(utils.PATHS.features.root, 'logs', `feature-${itemId}-ralph-progress.md`);
                    const apLabel = fs.existsSync(progressFile) ? 'Autopilot' : 'Drive-wt';
                    detail = `  ${apLabel} (${wts[0].agent})`;
                } else {
                    const agents = wts.map(w => w.agent).join(', ');
                    detail = `  Fleet (${agents})`;
                }
            }

            const prefix = itemId ? `#${String(itemId).padStart(2, '0')}` : '   ';
            const itemLine = `  ${prefix}  ${itemName}${getItemCompatibilityBadge(item)}${detail}`;

            if (showActions) {
                const action = getBoardAction(typeConfig.prefix, folder, item, worktreeMap, currentBranch);
                if (action) {
                    const pad = Math.max(2, 58 - itemLine.length);
                    console.log(itemLine + ' '.repeat(pad) + action);
                } else {
                    console.log(itemLine);
                }
            } else {
                console.log(itemLine);
            }
        });
    });

    if (totalCount === 0) {
        console.log(`\nNo ${title.toLowerCase()} found.`);
    }
    console.log('');
}

/**
 * Ensure .aigon/.board-map.json is in .gitignore
 * This file is regenerated by the board command and shouldn't be committed
 */
function ensureBoardMapInGitignore() {
    const gitignorePath = path.join(process.cwd(), '.gitignore');
    // All aigon runtime/generated files that must never be committed
    const entries = [
        '.aigon/.board-map.json',
        '.aigon/worktree.json',
        '.aigon/state/',
        '.aigon/locks/',
        'next-env.d.ts',
    ];

    // If .gitignore doesn't exist, create it
    if (!fs.existsSync(gitignorePath)) {
        fs.writeFileSync(gitignorePath, entries.join('\n') + '\n');
        return;
    }

    let content = fs.readFileSync(gitignorePath, 'utf8');
    const lines = content.split('\n');

    // If .aigon/ is already a blanket ignore, skip aigon-specific entries
    const hasAigonBlanket = lines.some(line => line.trim() === '.aigon/');

    let added = false;
    for (const entry of entries) {
        if (hasAigonBlanket && entry.startsWith('.aigon/')) continue;
        if (lines.some(line => line.trim() === entry)) continue;
        if (!content.endsWith('\n') && content.length > 0) content += '\n';
        content += `${entry}\n`;
        added = true;
    }
    if (added) fs.writeFileSync(gitignorePath, content);
}

module.exports = {
    collectBoardItems,
    getWorktreeInfo,
    getCurrentBranch,
    saveBoardMapping,
    loadBoardMapping,
    getBoardAction,
    displayBoardKanbanView,
    displayKanbanSection,
    displayBoardListView,
    displayListSection,
    ensureBoardMapInGitignore,
};
