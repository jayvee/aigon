const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const GLOBAL_CONFIG_PATH = path.join(os.homedir(), '.aigon', 'config.json');
const RADAR_META_PATH = path.join(os.homedir(), '.aigon', 'radar.json');

function readRepos() {
    try {
        if (!fs.existsSync(GLOBAL_CONFIG_PATH)) return [];
        const cfg = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf8'));
        return Array.isArray(cfg.repos) ? cfg.repos : [];
    } catch (e) {
        return [];
    }
}

function getRadarPort() {
    try {
        if (!fs.existsSync(RADAR_META_PATH)) return 4321;
        const meta = JSON.parse(fs.readFileSync(RADAR_META_PATH, 'utf8'));
        return Number.isInteger(meta.port) ? meta.port : 4321;
    } catch (e) {
        return 4321;
    }
}

function fetchRadarStatus() {
    const port = getRadarPort();
    return new Promise((resolve, reject) => {
        const req = http.request({
            host: '127.0.0.1',
            port,
            path: '/api/status',
            method: 'GET',
            timeout: 2500
        }, (res) => {
            let raw = '';
            res.on('data', (chunk) => { raw += chunk.toString('utf8'); });
            res.on('end', () => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }
                try {
                    resolve(JSON.parse(raw));
                } catch (e) {
                    reject(new Error('Invalid JSON response'));
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('request timeout')));
        req.end();
    });
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
        this._statusData = { repos: [], summary: {} };
        this._statusFetchedAt = 0;
        this._offline = false;
        this._pollTimer = null;
        this._setupWatchers();
        this._pollTimer = setInterval(() => this.refresh(), 10000);
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

    async getChildren(element) {
        await this._loadStatus();
        if (!element) return this._getRootItems();
        if (element.contextValue === 'attention-section') return element.children || [];
        if (element.contextValue === 'repo') return this._getFeatureItems(element.repoPath);
        if (element.contextValue === 'feature' || element.contextValue === 'feature-in-progress') return element.agentItems || [];
        return [];
    }

    // --- Shared data loading ---
    async _loadStatus() {
        const now = Date.now();
        if (now - this._statusFetchedAt < 2000 && this._statusData) return;

        try {
            this._statusData = await fetchRadarStatus();
            this._statusFetchedAt = now;
            this._offline = false;
        } catch (e) {
            this._offline = true;
            this._statusFetchedAt = now;
        }
    }

    _loadRepoFeatures(repoPath) {
        const repo = (this._statusData.repos || []).find(r => r.path === repoPath);
        const features = {};
        if (!repo) return features;

        (repo.features || []).forEach((feature) => {
            features[feature.id] = {
                name: feature.name,
                stage: feature.stage,
                evalStatus: feature.evalStatus,
                agents: (feature.agents || []).map(agent => ({
                    agent: agent.id,
                    status: agent.status,
                    updated: agent.updatedAt || '',
                    featureId: feature.id,
                    featureName: feature.name
                }))
            };
        });
        return features;
    }

    // --- Root items: attention section + repos ---

    _getRootItems() {
        const repos = this._statusData.repos || [];
        if (repos.length === 0) {
            const item = new vscode.TreeItem(this._offline ? 'Radar offline' : 'No repos registered');
            item.description = this._offline ? 'Run: aigon radar start' : 'Run: aigon radar add';
            item.iconPath = new vscode.ThemeIcon('info');
            return [item];
        }

        const items = [];

        // Build attention items across all repos
        const attentionItems = [];
        repos.forEach(repoPath => {
            const features = this._loadRepoFeatures(repoPath.path);
            const repoName = path.basename(repoPath.path);

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
                path.basename(repoPath.path),
                vscode.TreeItemCollapsibleState.Collapsed
            );
            item.contextValue = 'repo';
            item.repoPath = repoPath.path;
            item.tooltip = repoPath.path;
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
                featureItem.contextValue = (data.stage === 'in-progress' || data.stage === 'in-evaluation') ? 'feature-in-progress' : 'feature';
                featureItem.featureId = featureId;
                featureItem.repoPath = repoPath;

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
        if (this._pollTimer) clearInterval(this._pollTimer);
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

    const shipFeatureCmd = vscode.commands.registerCommand('aigon.shipFeature', (item) => {
        const terminal = vscode.window.createTerminal({ name: 'Aigon: Ship', cwd: item.repoPath });
        terminal.show();
        terminal.sendText(`aigon feature-ship ${item.featureId}`);
    });

    const featureDoneCmd = vscode.commands.registerCommand('aigon.featureDone', (item) => {
        const terminal = vscode.window.createTerminal({ name: 'Aigon: Feature Done', cwd: item.repoPath });
        terminal.show();
        terminal.sendText(`aigon feature-close ${item.featureId}`);
    });

    const implementRalphCmd = vscode.commands.registerCommand('aigon.implementRalph', (item) => {
        const terminal = vscode.window.createTerminal({ name: 'Aigon: Implement', cwd: item.repoPath });
        terminal.show();
        terminal.sendText(`aigon feature-do ${item.featureId} --ralph --auto-submit`);
    });

    context.subscriptions.push(treeView, copyCmd, refreshCmd, toggleCmd, shipFeatureCmd, featureDoneCmd, implementRalphCmd, provider);
}

function deactivate() {}

module.exports = { activate, deactivate };
