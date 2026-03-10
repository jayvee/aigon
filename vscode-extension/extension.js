const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');

const GLOBAL_CONFIG_PATH = path.join(os.homedir(), '.aigon', 'config.json');

function readRepos() {
    try {
        if (!fs.existsSync(GLOBAL_CONFIG_PATH)) return [];
        const cfg = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf8'));
        return Array.isArray(cfg.repos) ? cfg.repos : [];
    } catch (e) {
        return [];
    }
}

function parseFrontMatter(content) {
    const m = content.match(/^---\n([\s\S]*?)\n---\n/);
    if (!m) return {};
    const result = {};
    m[1].split('\n').forEach(line => {
        const idx = line.indexOf(':');
        if (idx > -1) {
            result[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        }
    });
    return result;
}

const STATUS_ICONS = {
    implementing: '○',
    waiting: '●',
    submitted: '✓',
    complete: '✓',
    unknown: '–'
};

const AGENT_NAMES = { cc: 'Claude', gg: 'Gemini', cx: 'Codex', cu: 'Cursor' };

class AigonTreeDataProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this._showAll = false;
        this._watchers = [];
        this._setupWatchers();
    }

    _setupWatchers() {
        this._watchers.forEach(w => w.dispose());
        this._watchers = [];

        // Watch global config for repo list changes
        const configDir = path.dirname(GLOBAL_CONFIG_PATH);
        if (fs.existsSync(configDir)) {
            const configWatcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(configDir, 'config.json')
            );
            configWatcher.onDidChange(() => { this._setupWatchers(); this.refresh(); });
            this._watchers.push(configWatcher);
        }

        // Watch log files and in-progress specs in each registered repo
        readRepos().forEach(repoPath => {
            if (!fs.existsSync(repoPath)) return;
            const logWatcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(repoPath, 'docs/specs/features/logs/**/*-log.md')
            );
            logWatcher.onDidChange(() => this.refresh());
            logWatcher.onDidCreate(() => this.refresh());
            logWatcher.onDidDelete(() => this.refresh());
            this._watchers.push(logWatcher);

            const specWatcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(repoPath, 'docs/specs/features/0{3,4}-**/feature-*.md')
            );
            specWatcher.onDidCreate(() => this.refresh());
            specWatcher.onDidDelete(() => this.refresh());
            this._watchers.push(specWatcher);
        });
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    toggleShowAll() {
        this._showAll = !this._showAll;
        this.refresh();
    }

    getTreeItem(element) {
        return element;
    }

    getChildren(element) {
        if (!element) return this._getRootItems();
        if (element.contextValue === 'attention-section') return element.children || [];
        if (element.contextValue === 'repo') return this._getFeatureItems(element.repoPath);
        if (element.contextValue === 'feature') return element.agentItems || [];
        return [];
    }

    // --- Shared data loading ---

    _loadRepoFeatures(repoPath) {
        const inProgressDir = path.join(repoPath, 'docs', 'specs', 'features', '03-in-progress');
        const inEvalDir = path.join(repoPath, 'docs', 'specs', 'features', '04-in-evaluation');
        const logsDir = path.join(repoPath, 'docs', 'specs', 'features', 'logs');
        const evalsDir = path.join(repoPath, 'docs', 'specs', 'features', 'evaluations');

        // Source of truth: specs in 03-in-progress/ and 04-in-evaluation/
        const specStages = {}; // featureId -> stage
        const specNames = {}; // featureId -> name
        [inProgressDir, inEvalDir].forEach(dir => {
            if (!fs.existsSync(dir)) return;
            const stage = dir.includes('04-in-evaluation') ? 'in-evaluation' : 'in-progress';
            try {
                fs.readdirSync(dir)
                    .filter(f => /^feature-\d+-.+\.md$/.test(f))
                    .forEach(f => {
                        const m = f.match(/^feature-(\d+)-(.+)\.md$/);
                        if (m) {
                            specStages[m[1]] = stage;
                            specNames[m[1]] = m[2];
                        }
                    });
            } catch (e) { /* skip */ }
        });

        // Build log status map
        const logStatuses = {}; // "featureId" or "featureId-agent" -> { status, updated }
        if (fs.existsSync(logsDir)) {
            try {
                fs.readdirSync(logsDir)
                    .filter(f => /^feature-\d+-.+-log\.md$/.test(f))
                    .forEach(logFile => {
                        const logPath = path.join(logsDir, logFile);
                        let fm = {};
                        try { fm = parseFrontMatter(fs.readFileSync(logPath, 'utf8')); } catch (e) { return; }

                        const arenaM = logFile.match(/^feature-(\d+)-([a-z]{2})-(.+)-log\.md$/);
                        const soloM = logFile.match(/^feature-(\d+)-(.+)-log\.md$/);
                        const featureId = arenaM ? arenaM[1] : (soloM ? soloM[1] : null);
                        const agent = arenaM ? arenaM[2] : null;
                        if (!featureId) return;

                        const key = agent ? `${featureId}-${agent}` : featureId;
                        logStatuses[key] = { status: fm.status || 'implementing', updated: fm.updated || '' };
                    });
            } catch (e) { /* skip */ }
        }

        // Scan worktrees for fleet agents + their log statuses
        const worktreeAgents = {}; // featureId -> [agent, ...]
        const worktreeBaseDir = repoPath + '-worktrees';
        if (fs.existsSync(worktreeBaseDir)) {
            try {
                fs.readdirSync(worktreeBaseDir).forEach(dirName => {
                    const wtM = dirName.match(/^feature-(\d+)-([a-z]{2})-.+$/);
                    if (!wtM) return;
                    const fid = wtM[1];
                    if (!worktreeAgents[fid]) worktreeAgents[fid] = [];
                    worktreeAgents[fid].push(wtM[2]);

                    // Check worktree logs (agent-status writes here, takes precedence)
                    const wtLogsDir = path.join(worktreeBaseDir, dirName, 'docs', 'specs', 'features', 'logs');
                    if (!fs.existsSync(wtLogsDir)) return;
                    try {
                        fs.readdirSync(wtLogsDir)
                            .filter(f => f.startsWith(`feature-${fid}-${wtM[2]}-`) && f.endsWith('-log.md'))
                            .forEach(logFile => {
                                let fm = {};
                                try { fm = parseFrontMatter(fs.readFileSync(path.join(wtLogsDir, logFile), 'utf8')); } catch (e) { return; }
                                if (fm.status) {
                                    logStatuses[`${fid}-${wtM[2]}`] = { status: fm.status, updated: fm.updated || '' };
                                }
                            });
                    } catch (e) { /* skip */ }
                });
            } catch (e) { /* skip */ }
        }

        // Build features from specs + log/worktree enrichment
        const features = {};
        Object.entries(specStages).forEach(([featureId, stage]) => {
            const featureName = specNames[featureId] || featureId;
            features[featureId] = { name: featureName, stage, agents: [] };

            // Collect agents from logs and worktrees
            const agentSet = new Set();
            Object.keys(logStatuses)
                .filter(k => k.startsWith(`${featureId}-`) && k.includes('-'))
                .forEach(k => agentSet.add(k.split('-').slice(1).join('-')));
            if (worktreeAgents[featureId]) {
                worktreeAgents[featureId].forEach(a => agentSet.add(a));
            }

            if (agentSet.size > 0) {
                agentSet.forEach(agent => {
                    const info = logStatuses[`${featureId}-${agent}`] || { status: 'implementing', updated: '' };
                    features[featureId].agents.push({
                        agent, status: info.status, updated: info.updated,
                        featureId, featureName
                    });
                });
            } else {
                const info = logStatuses[featureId] || { status: 'implementing', updated: '' };
                features[featureId].agents.push({
                    agent: 'solo', status: info.status, updated: info.updated,
                    featureId, featureName
                });
            }

            // Compute eval status
            const allDone = features[featureId].agents.length > 0 &&
                features[featureId].agents.every(a => a.status === 'submitted' || a.status === 'complete');

            if (stage === 'in-evaluation') {
                const evalFile = path.join(evalsDir, `feature-${featureId}-eval.md`);
                let evalStatus = 'evaluating';
                if (fs.existsSync(evalFile)) {
                    try {
                        const content = fs.readFileSync(evalFile, 'utf8');
                        const winnerMatch = content.match(/\*\*Winner[:\s]*\*?\*?\s*(.+)/i);
                        if (winnerMatch) {
                            const val = winnerMatch[1].replace(/\*+/g, '').trim();
                            if (val && !val.includes('to be determined') && !val.includes('TBD') && val !== '()') {
                                evalStatus = 'pick winner';
                            }
                        }
                    } catch (e) { /* skip */ }
                }
                features[featureId].evalStatus = evalStatus;
            } else if (allDone) {
                features[featureId].evalStatus = 'eval needed';
            }
        });

        return features;
    }

    // --- Root items: attention section + repos ---

    _getRootItems() {
        const repos = readRepos();
        if (repos.length === 0) {
            const item = new vscode.TreeItem('No repos registered');
            item.description = 'Run: aigon conductor add';
            item.iconPath = new vscode.ThemeIcon('info');
            return [item];
        }

        const items = [];

        // Build attention items across all repos
        const attentionItems = [];
        repos.forEach(repoPath => {
            const features = this._loadRepoFeatures(repoPath);
            const repoName = path.basename(repoPath);

            Object.entries(features)
                .sort(([a], [b]) => parseInt(a) - parseInt(b))
                .forEach(([featureId, data]) => {
                    // Feature-level attention: eval needed or pick winner
                    if (data.evalStatus === 'eval needed' || data.evalStatus === 'pick winner') {
                        const label = data.evalStatus === 'eval needed' ? 'Ready for eval' : 'Pick winner';
                        const icon = data.evalStatus === 'eval needed'
                            ? new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'))
                            : new vscode.ThemeIcon('trophy', new vscode.ThemeColor('list.warningForeground'));

                        const item = new vscode.TreeItem(
                            `#${featureId} ${data.name}`,
                            vscode.TreeItemCollapsibleState.None
                        );
                        item.description = `${repoName} · ${label}`;
                        item.iconPath = icon;
                        item.tooltip = `${repoName} · ${label}\nClick to copy: /afe ${featureId}`;
                        item.command = {
                            command: 'aigon.copySlashCommand',
                            title: 'Copy slash command',
                            arguments: [featureId]
                        };
                        attentionItems.push(item);
                    }

                    // Agent-level attention: waiting
                    data.agents.filter(a => a.status === 'waiting').forEach(a => {
                        const agentName = AGENT_NAMES[a.agent] || a.agent;
                        const item = new vscode.TreeItem(
                            `#${featureId} ${data.name}`,
                            vscode.TreeItemCollapsibleState.None
                        );
                        item.description = `${repoName} · ${agentName} needs input`;
                        item.iconPath = new vscode.ThemeIcon('bell-dot', new vscode.ThemeColor('list.warningForeground'));
                        item.tooltip = `${agentName} is waiting for input\nClick to copy: /afd ${featureId}`;
                        item.command = {
                            command: 'aigon.copySlashCommand',
                            title: 'Copy slash command',
                            arguments: [featureId]
                        };
                        attentionItems.push(item);
                    });
                });
        });

        // Add attention section if there are items
        if (attentionItems.length > 0) {
            const section = new vscode.TreeItem(
                `Needs Attention (${attentionItems.length})`,
                vscode.TreeItemCollapsibleState.Expanded
            );
            section.contextValue = 'attention-section';
            section.iconPath = new vscode.ThemeIcon('bell-dot', new vscode.ThemeColor('list.warningForeground'));
            section.children = attentionItems;
            items.push(section);
        }

        // Add repo items
        repos.forEach(repoPath => {
            const item = new vscode.TreeItem(
                path.basename(repoPath),
                vscode.TreeItemCollapsibleState.Collapsed
            );
            item.contextValue = 'repo';
            item.repoPath = repoPath;
            item.tooltip = repoPath;
            item.iconPath = new vscode.ThemeIcon('folder');
            items.push(item);
        });

        return items;
    }

    _getFeatureItems(repoPath) {
        const features = this._loadRepoFeatures(repoPath);

        if (Object.keys(features).length === 0) {
            const empty = new vscode.TreeItem('No active features');
            empty.description = this._showAll ? '' : '(only showing in-progress)';
            empty.iconPath = new vscode.ThemeIcon('circle-outline');
            return [empty];
        }

        const items = [];
        Object.entries(features)
            .sort(([a], [b]) => parseInt(a) - parseInt(b))
            .forEach(([featureId, data]) => {
                if (!this._showAll && data.stage !== 'in-progress' && data.stage !== 'in-evaluation') return;

                const hasWaiting = data.agents.some(a => a.status === 'waiting');

                const featureItem = new vscode.TreeItem(
                    `#${featureId}  ${data.name}`,
                    vscode.TreeItemCollapsibleState.Expanded
                );
                featureItem.contextValue = 'feature';

                if (data.evalStatus === 'pick winner') {
                    featureItem.description = 'pick winner';
                    featureItem.iconPath = new vscode.ThemeIcon('trophy', new vscode.ThemeColor('list.warningForeground'));
                } else if (data.evalStatus === 'evaluating') {
                    featureItem.description = 'evaluating';
                    featureItem.iconPath = new vscode.ThemeIcon('search', new vscode.ThemeColor('list.highlightForeground'));
                } else if (data.evalStatus === 'eval needed') {
                    featureItem.description = 'eval needed';
                    featureItem.iconPath = new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'));
                } else if (hasWaiting) {
                    featureItem.iconPath = new vscode.ThemeIcon('bell-dot', new vscode.ThemeColor('list.warningForeground'));
                } else {
                    featureItem.iconPath = new vscode.ThemeIcon('loading~spin');
                }

                // Build per-agent tree items
                featureItem.agentItems = data.agents.map(a => {
                    let timeStr = '';
                    if (a.updated) {
                        try {
                            timeStr = new Date(a.updated).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                        } catch (e) { /* skip */ }
                    }

                    const agentItem = new vscode.TreeItem(a.agent, vscode.TreeItemCollapsibleState.None);
                    agentItem.description = `${STATUS_ICONS[a.status] || '–'} ${a.status}${timeStr ? '  ' + timeStr : ''}`;
                    agentItem.contextValue = a.status === 'waiting' ? 'agent-waiting' : 'agent';

                    if (a.status === 'waiting') {
                        agentItem.iconPath = new vscode.ThemeIcon('bell-dot', new vscode.ThemeColor('list.warningForeground'));
                        agentItem.tooltip = `Click to copy: /afd ${a.featureId}`;
                        agentItem.command = {
                            command: 'aigon.copySlashCommand',
                            title: 'Copy slash command',
                            arguments: [a.featureId]
                        };
                    } else if (a.status === 'submitted' || a.status === 'complete') {
                        agentItem.iconPath = new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
                        agentItem.tooltip = a.status === 'complete' ? `Completed at ${a.updated}` : `Submitted at ${a.updated}`;
                    } else if (a.status === 'implementing') {
                        agentItem.iconPath = new vscode.ThemeIcon('loading~spin');
                        agentItem.tooltip = `Implementing since ${a.updated}`;
                    } else {
                        agentItem.iconPath = new vscode.ThemeIcon('circle-outline');
                        agentItem.tooltip = 'Status unknown — log may have no front matter';
                    }

                    return agentItem;
                });

                items.push(featureItem);
            });

        if (items.length === 0) {
            const empty = new vscode.TreeItem('No active features');
            empty.description = this._showAll ? '' : '(only showing in-progress)';
            empty.iconPath = new vscode.ThemeIcon('circle-outline');
            return [empty];
        }

        return items;
    }

    dispose() {
        this._watchers.forEach(w => w.dispose());
        this._onDidChangeTreeData.dispose();
    }
}

function activate(context) {
    const provider = new AigonTreeDataProvider();

    const treeView = vscode.window.createTreeView('aigonConductor', {
        treeDataProvider: provider,
        showCollapseAll: true
    });

    const copyCmd = vscode.commands.registerCommand('aigon.copySlashCommand', async (featureId) => {
        const cmd = `/afd ${featureId}`;
        await vscode.env.clipboard.writeText(cmd);
        vscode.window.setStatusBarMessage(`Aigon: Copied ${cmd}`, 3000);
    });

    const refreshCmd = vscode.commands.registerCommand('aigon.refresh', () => {
        provider.refresh();
    });

    const toggleCmd = vscode.commands.registerCommand('aigon.toggleShowAll', () => {
        provider.toggleShowAll();
    });

    context.subscriptions.push(treeView, copyCmd, refreshCmd, toggleCmd, provider);
}

function deactivate() {}

module.exports = { activate, deactivate };
