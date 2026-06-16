'use strict';

const agentRegistry = require('./agent-registry');
const terminalAdapters = require('./terminal-adapters');
const {
    loadGlobalConfig,
    loadProjectConfig,
    getActiveProfile,
    getNestedValue,
    getConfigModelValue,
} = require('./config');

const DASHBOARD_SETTINGS_SCHEMA = [
    {
        key: 'backgroundAgents',
        label: 'Background agents',
        type: 'boolean',
        scope: 'user',
        description: 'Starts agents without opening a terminal window by default. You can still override this per command with CLI flags.'
    },
    {
        key: 'defaultAgent',
        label: 'Default agent',
        type: 'select',
        scope: 'shared',
        options: agentRegistry.getAllAgentIds(),
        description: 'Agent used when none is explicitly selected (close-with-agent, feature-eval, code-review, and similar commands).'
    },
    {
        key: 'terminalApp',
        label: 'Terminal app',
        type: 'enum',
        scope: 'user',
        options: terminalAdapters.getDashboardOptions(),
        description: 'Which GUI terminal app hosts `tmux attach` when Aigon opens a session. Agent sessions always run in tmux.'
    },
    {
        key: 'terminal.focusOnLaunch',
        label: 'Bring terminal to foreground when starting a session',
        type: 'enum',
        scope: 'user',
        options: ['background', 'foreground'],
        description: 'Background (default) opens new terminal tabs without stealing focus from the dashboard. Foreground activates the terminal app on every launch (the legacy behaviour). Linux focus behaviour is decided by the window manager and is unaffected by this setting.'
    },
    {
        key: 'profile',
        label: 'Profile',
        type: 'enum',
        scope: 'repo',
        // F523: changes are baked into installed agent command files at
        // install-agent time; mutating this setting must re-run install-agent --all.
        affectsInstalledCommands: true,
        options: ['web', 'api', 'ios', 'android', 'library', 'generic'],
        description: 'Defines the project type used for defaults like test instructions and dev-server behavior. Intrinsic to the repo — not a shared default.'
    },
    {
        key: 'security.enabled',
        label: 'Security enabled',
        type: 'boolean',
        scope: 'shared',
        description: 'Master switch for local security scanning in Aigon workflows such as close and submit.'
    },
    {
        key: 'security.mode',
        label: 'Security mode',
        type: 'enum',
        scope: 'shared',
        options: ['enforce', 'warn', 'off'],
        description: 'enforce blocks on findings, warn reports findings but continues, off disables scanning.'
    },
    {
        key: 'devServer.enabled',
        label: 'Dev server enabled',
        type: 'boolean',
        scope: 'repo',
        // F523: baked into installed agent command files at install-agent time.
        affectsInstalledCommands: true,
        description: 'Enables per-agent dev-server handling for repos that expose local web or API apps. Intrinsic to the repo — not a shared default.'
    },
    {
        key: 'github.prCheck',
        label: 'GitHub PR status badge',
        type: 'boolean',
        scope: 'repo',
        description: 'Show a GitHub PR status section on feature cards for this repo. Requires a GitHub remote. Disable if you don\'t use GitHub PRs.'
    },
    {
        key: 'autoNudge.enabled',
        label: 'Auto-nudge enabled',
        type: 'boolean',
        scope: 'user',
        description: 'Allows one automatic nudge per idle agent session after the configured threshold. Visible idle chips remain on even when this is disabled.'
    },
    {
        key: 'autoNudge.idleVisibleSec',
        label: 'Idle visible seconds',
        type: 'number',
        scope: 'user',
        description: 'Seconds before an idle-at-prompt agent shows an amber idle chip.'
    },
    {
        key: 'autoNudge.idleAutoNudgeSec',
        label: 'Idle auto-nudge seconds',
        type: 'number',
        scope: 'user',
        description: 'Seconds before Aigon sends one automatic nudge when auto-nudge is enabled.'
    },
    {
        key: 'autoNudge.idleEscalateSec',
        label: 'Idle escalate seconds',
        type: 'number',
        scope: 'user',
        description: 'Seconds before an idle agent escalates to needs attention.'
    },
];

const AGENT_DISPLAY_NAMES = agentRegistry.getDisplayNames();
agentRegistry.getAllAgentIds().forEach(agentId => {
    ['research', 'implement', 'evaluate', 'review'].forEach(task => {
        DASHBOARD_SETTINGS_SCHEMA.push({
            key: `agents.${agentId}.${task}.model`,
            label: task.charAt(0).toUpperCase() + task.slice(1),
            group: `agent:${agentId}`,
            groupLabel: `${agentId.toUpperCase()} — ${AGENT_DISPLAY_NAMES[agentId] || agentId}`,
            type: 'string',
            scope: 'shared',
            description: `Model used by ${agentId.toUpperCase()} for ${task} tasks. Leave unset to use the built-in default.`
        });
    });
    
    // F521: add CLI and flag settings to schema for Preferences UI
    DASHBOARD_SETTINGS_SCHEMA.push({
        key: `agents.${agentId}.cli`,
        label: `${agentId.toUpperCase()} CLI command`,
        type: 'string',
        scope: 'user',
        description: `Command used to invoke the ${agentId.toUpperCase()} agent.`
    });
    DASHBOARD_SETTINGS_SCHEMA.push({
        key: `agents.${agentId}.implementFlag`,
        label: `${agentId.toUpperCase()} implement flag`,
        type: 'string',
        scope: 'user',
        description: `Flag to trigger implement mode for ${agentId.toUpperCase()}.`
    });
});

function readRawGlobalConfig() {
    try {
        if (!fs.existsSync(GLOBAL_CONFIG_PATH)) return {};
        const parsed = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
        return {};
    }
}

function coerceDashboardSettingValue(type, value) {
    if (type === 'boolean') {
        if (typeof value === 'boolean') return value;
        if (value === 'true') return true;
        if (value === 'false') return false;
        throw new Error('Expected boolean value');
    }
    if (type === 'enum' || type === 'select') return String(value);
    if (type === 'string') return String(value || '').trim();
    if (type === 'number') {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) throw new Error('Expected numeric value');
        return parsed;
    }
    return value;
}

function buildDashboardSettingsPayload(repoPath, options = {}) {
    const globalOnly = !!options.globalOnly;
    const cwd = repoPath ? path.resolve(repoPath) : process.cwd();
    const globalConfigRaw = readRawGlobalConfig();
    const projectConfigPath = globalOnly ? null : path.join(cwd, '.aigon', 'config.json');
    let projectConfig = {};
    try {
        if (projectConfigPath && fs.existsSync(projectConfigPath)) {
            projectConfig = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'));
        }
    } catch (_) { /* ignore parse errors */ }
    const globalDisplayConfig = JSON.parse(JSON.stringify(DEFAULT_GLOBAL_CONFIG || {}));
    Object.keys(globalConfigRaw).forEach(key => {
        if (key === 'agents' && globalConfigRaw.agents) {
            globalDisplayConfig.agents = { ...(globalDisplayConfig.agents || {}) };
            Object.entries(globalConfigRaw.agents).forEach(([agent, agentCfg]) => {
                globalDisplayConfig.agents[agent] = { ...(globalDisplayConfig.agents[agent] || {}), ...(agentCfg || {}) };
                if (globalDisplayConfig.agents[agent]?.models && agentCfg?.models) {
                    globalDisplayConfig.agents[agent].models = {
                        ...(DEFAULT_GLOBAL_CONFIG.agents?.[agent]?.models || {}),
                        ...agentCfg.models
                    };
                }
            });
        } else if (key === 'security' && globalConfigRaw.security) {
            globalDisplayConfig.security = { ...(globalDisplayConfig.security || {}), ...globalConfigRaw.security };
        } else {
            globalDisplayConfig[key] = globalConfigRaw[key];
        }
    });
    const effectiveConfig = JSON.parse(JSON.stringify(globalDisplayConfig));
    if (!globalOnly) {
        Object.keys(projectConfig).forEach(key => {
            if (key === 'agents' && projectConfig.agents) {
                effectiveConfig.agents = { ...(effectiveConfig.agents || {}) };
                Object.entries(projectConfig.agents).forEach(([agent, agentCfg]) => {
                    effectiveConfig.agents[agent] = { ...(effectiveConfig.agents[agent] || {}), ...(agentCfg || {}) };
                    if (effectiveConfig.agents[agent]?.models && agentCfg?.models) {
                        effectiveConfig.agents[agent].models = {
                            ...(globalDisplayConfig.agents?.[agent]?.models || {}),
                            ...agentCfg.models
                        };
                    }
                });
            } else if (key === 'security' && projectConfig.security) {
                effectiveConfig.security = { ...(effectiveConfig.security || {}), ...projectConfig.security };
            } else {
                effectiveConfig[key] = projectConfig[key];
            }
        });
    }
    const settings = DASHBOARD_SETTINGS_SCHEMA.map(def => {
        const modelKeyMatch = def.key.match(/^agents\.(\w+)\.(research|implement|evaluate|review)\.model$/);
        const builtInValue = modelKeyMatch
            ? (DEFAULT_GLOBAL_CONFIG.agents?.[modelKeyMatch[1]]?.models?.[modelKeyMatch[2]] ?? undefined)
            : getNestedValue(DEFAULT_GLOBAL_CONFIG, def.key);
        const globalValue = modelKeyMatch
            ? (getConfigModelValue(globalDisplayConfig, modelKeyMatch[1], modelKeyMatch[2]) ?? undefined)
            : getNestedValue(globalDisplayConfig, def.key);
        const globalOverrideValue = modelKeyMatch
            ? (getConfigModelValue(globalConfigRaw, modelKeyMatch[1], modelKeyMatch[2]) ?? undefined)
            : getNestedValue(globalConfigRaw, def.key);
        let projectValue = globalOnly
            ? undefined
            : (modelKeyMatch
                ? (getConfigModelValue(projectConfig, modelKeyMatch[1], modelKeyMatch[2]) ?? undefined)
                : getNestedValue(projectConfig, def.key));
        if (def.scope === 'user') projectValue = undefined;
        const effectiveValue = modelKeyMatch
            ? (projectValue ?? globalValue ?? builtInValue)
            : (def.scope === 'user' ? (globalValue ?? builtInValue) : getNestedValue(effectiveConfig, def.key));
        const source = projectValue !== undefined
            ? 'project'
            : (globalOverrideValue !== undefined ? 'global' : (builtInValue !== undefined ? 'default' : 'default'));
        return {
            ...def,
            builtInValue: builtInValue === undefined ? null : builtInValue,
            globalValue: globalValue === undefined ? null : globalValue,
            globalOverrideValue: globalOverrideValue === undefined ? null : globalOverrideValue,
            projectValue: projectValue === undefined ? null : projectValue,
            effectiveValue: effectiveValue === undefined ? null : effectiveValue,
            source
        };
    });
    return {
        repoPath: cwd,
        projectName: globalOnly ? null : path.basename(cwd),
        globalConfigPath: GLOBAL_CONFIG_PATH,
        projectConfigPath,
        globalOnly,
        global: globalConfigRaw,
        project: projectConfig,
        effective: effectiveConfig,
        settings
    };
}


module.exports = {
    DASHBOARD_SETTINGS_SCHEMA,
    readRawGlobalConfig,
    coerceDashboardSettingValue,
    buildDashboardSettingsPayload,
};
