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

        // Watch log files in each registered repo
        readRepos().forEach(repoPath => {
            if (!fs.existsSync(repoPath)) return;
            const watcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(repoPath, 'docs/specs/features/logs/**/*-log.md')
            );
            watcher.onDidChange(() => this.refresh());
            watcher.onDidCreate(() => this.refresh());
            watcher.onDidDelete(() => this.refresh());
            this._watchers.push(watcher);
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
        if (!element) return this._getRepoItems();
        if (element.contextValue === 'repo') return this._getFeatureItems(element.repoPath);
        if (element.contextValue === 'feature') return element.agentItems || [];
        return [];
    }

    _getRepoItems() {
        const repos = readRepos();
        if (repos.length === 0) {
            const item = new vscode.TreeItem('No repos registered');
            item.description = 'Run: aigon conductor add';
            item.iconPath = new vscode.ThemeIcon('info');
            return [item];
        }
        return repos.map(repoPath => {
            const item = new vscode.TreeItem(
                path.basename(repoPath),
                vscode.TreeItemCollapsibleState.Expanded
            );
            item.contextValue = 'repo';
            item.repoPath = repoPath;
            item.tooltip = repoPath;
            item.iconPath = new vscode.ThemeIcon('folder');
            return item;
        });
    }

    _getFeatureItems(repoPath) {
        const logsDir = path.join(repoPath, 'docs', 'specs', 'features', 'logs');
        const inProgressDir = path.join(repoPath, 'docs', 'specs', 'features', '03-in-progress');
        const inEvalDir = path.join(repoPath, 'docs', 'specs', 'features', '04-in-evaluation');

        if (!fs.existsSync(logsDir)) {
            const item = new vscode.TreeItem('No logs directory found');
            item.iconPath = new vscode.ThemeIcon('circle-outline');
            return [item];
        }

        let logFiles = [];
        try {
            logFiles = fs.readdirSync(logsDir)
                .filter(f => /^feature-\d+-.+-log\.md$/.test(f));
        } catch (e) {
            return [];
        }

        // Also read log files from worktree directories (agent-status writes to worktree, not main repo)
        const worktreeLogPaths = {};
        const worktreeBaseDir = repoPath + '-worktrees';
        if (fs.existsSync(worktreeBaseDir)) {
            try {
                fs.readdirSync(worktreeBaseDir).forEach(dirName => {
                    const wtLogsDir = path.join(worktreeBaseDir, dirName, 'docs', 'specs', 'features', 'logs');
                    if (!fs.existsSync(wtLogsDir)) return;
                    try {
                        fs.readdirSync(wtLogsDir)
                            .filter(f => /^feature-\d+-.+-log\.md$/.test(f))
                            .forEach(f => {
                                if (!logFiles.includes(f)) logFiles.push(f);
                                // Worktree log takes precedence (agent-status writes here)
                                worktreeLogPaths[f] = path.join(wtLogsDir, f);
                            });
                    } catch (e) { /* skip */ }
                });
            } catch (e) { /* skip */ }
        }

        // Group agents by feature ID
        const features = {};
        logFiles.forEach(logFile => {
            const arenaM = logFile.match(/^feature-(\d+)-([a-z]{2})-(.+)-log\.md$/);
            const soloM = logFile.match(/^feature-(\d+)-(.+)-log\.md$/);
            const featureId = arenaM ? arenaM[1] : soloM?.[1];
            if (!featureId) return;

            const agent = arenaM ? arenaM[2] : 'solo';
            const featureName = arenaM ? arenaM[3] : soloM?.[2];

            if (!features[featureId]) {
                features[featureId] = { name: featureName, agents: [] };
            }

            let fm = {};
            try {
                // Prefer worktree log (agent-status writes there), fall back to main repo
                const logPath = worktreeLogPaths[logFile] || path.join(logsDir, logFile);
                const content = fs.readFileSync(logPath, 'utf8');
                fm = parseFrontMatter(content);
            } catch (e) { /* skip */ }

            features[featureId].agents.push({
                agent,
                status: fm.status || 'unknown',
                updated: fm.updated || '',
                featureId,
                featureName: featureName || features[featureId].name
            });
        });

        const items = [];
        Object.entries(features)
            .sort(([a], [b]) => parseInt(a) - parseInt(b))
            .forEach(([featureId, data]) => {
                // Determine stage from filesystem
                let stage = 'other';
                if (fs.existsSync(inEvalDir) && fs.readdirSync(inEvalDir).some(f => f.startsWith(`feature-${featureId}-`))) {
                    stage = 'in-evaluation';
                } else if (fs.existsSync(inProgressDir) && fs.readdirSync(inProgressDir).some(f => f.startsWith(`feature-${featureId}-`))) {
                    stage = 'in-progress';
                }

                if (!this._showAll && stage !== 'in-progress' && stage !== 'in-evaluation') return;

                const hasWaiting = data.agents.some(a => a.status === 'waiting');
                const allSubmitted = data.agents.length > 0 && data.agents.every(a => a.status === 'submitted' || a.status === 'complete');

                const featureItem = new vscode.TreeItem(
                    `#${featureId}  ${data.name}`,
                    vscode.TreeItemCollapsibleState.Expanded
                );
                featureItem.contextValue = 'feature';
                featureItem.description = stage === 'in-evaluation' ? 'eval' : '';
                featureItem.iconPath = hasWaiting
                    ? new vscode.ThemeIcon('bell-dot', new vscode.ThemeColor('list.warningForeground'))
                    : allSubmitted
                        ? new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'))
                        : new vscode.ThemeIcon('loading~spin');

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
