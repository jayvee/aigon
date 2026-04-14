#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const cliPath = path.join(repoRoot, 'aigon-cli.js');
const libDir = path.join(repoRoot, 'lib');
const commandsDir = path.join(libDir, 'commands');

let source = fs.readFileSync(cliPath, 'utf8');
if (!source.includes('// --- Commands ---')) {
    source = execSync('git show HEAD:aigon-cli.js', {
        cwd: repoRoot,
        encoding: 'utf8'
    });
}

const COMMAND_GROUPS = {
    feature: [
        'feature-create',
        'feature-prioritise',
        'feature-now',
        'feature-start',
        'feature-do',
        'feature-validate',
        'feature-eval',
        'feature-review',
        'feature-close',
        'feature-cleanup',
        'feature-autopilot',
        'feature-implement',
        'feature-done',
        'conduct'
    ],
    research: [
        'research-create',
        'research-prioritise',
        'research-start',
        'research-open',
        'research-do',
        'research-submit',
        'research-eval',
        'research-close',
        'research-autopilot',
        'research-conduct',
        'research-done'
    ],
    feedback: [
        'feedback-create',
        'feedback-list',
        'feedback-triage'
    ],
    setup: [
        'init',
        'install-agent',
        'check-version',
        'update',
        'hooks',
        'config',
        'profile',
        'doctor',
        'proxy-setup',
        'dev-server'
    ],
    misc: [
        'agent-status',
        'status',
        'deploy',
        'radar',
        'conductor',
        'dashboard',
        'terminal-focus',
        'board',
        'sessions-close',
        'next',
        'help'
    ]
};

const WRAPPER_EXPORTS = {
    constants: [
        'PROVIDER_FAMILIES',
        'PATHS',
        'FEEDBACK_STATUS_TO_FOLDER',
        'FEEDBACK_FOLDER_TO_STATUS',
        'FEEDBACK_STATUS_FLAG_TO_FOLDER',
        'FEEDBACK_ACTION_TO_STATUS',
        'FEEDBACK_DEFAULT_LIST_FOLDERS',
        'AGENT_CONFIGS',
        'COMMAND_REGISTRY',
        'COMMAND_ALIASES',
        'COMMAND_ALIAS_REVERSE',
        'COMMAND_ARG_HINTS',
        'COMMANDS_DISABLE_MODEL_INVOCATION',
        'MARKER_START',
        'MARKER_END',
        'VERSION_FILE'
    ],
    config: [
        'loadGlobalConfig',
        'loadProjectConfig',
        'saveProjectConfig',
        'saveGlobalConfig',
        'resolveConfigKeyAlias',
        'getNestedValue',
        'setNestedValue',
        'parseConfigScope',
        'getConfigValueWithProvenance',
        'getEffectiveConfig',
        'readBasePort',
        'showPortSummary',
        'detectProjectProfile',
        'getActiveProfile',
        'getProfilePlaceholders',
        'getAgentCliConfig',
        'parseCliFlagTokens',
        'getAgentLaunchFlagTokens',
        'getModelProvenance'
    ],
    devserver: [
        'sanitizeForDns',
        'getAppId',
        'isPortAvailable',
        'allocatePort',
        'isProxyAvailable',
        'loadProxyRegistry',
        'saveProxyRegistry',
        'loadPortRegistry',
        'savePortRegistry',
        'registerPort',
        'deregisterPort',
        'scanPortsFromFilesystem',
        'generateCaddyfile',
        'reloadCaddy',
        'registerDevServer',
        'deregisterDevServer',
        'gcDevServers',
        'detectDevServerContext',
        'getDevProxyUrl',
        'getDevServerLogPath',
        'spawnDevServer',
        'waitForHealthy',
        'openInBrowser',
        'resolveDevServerUrl'
    ],
    dashboard: [
        'readConductorReposFromGlobalConfig',
        'normalizeDashboardStatus',
        'parseFeatureSpecFileName',
        'inferDashboardNextCommand',
        'safeTmuxSessionExists',
        'collectDashboardStatusData',
        'escapeForHtmlScript',
        'buildDashboardHtml',
        'escapeAppleScriptString',
        'captureDashboardScreenshot',
        'writeRepoRegistry',
        'readRadarMeta',
        'writeRadarMeta',
        'removeRadarMeta',
        'isRadarAlive',
        'sendMacNotification',
        'requestRadarJson',
        'renderRadarMenubarFromStatus',
        'writeRadarLaunchdPlist',
        'runRadarServiceDaemon'
    ],
    worktree: [
        'getWorktreeBase',
        'findWorktrees',
        'filterByFeatureId',
        'buildAgentCommand',
        'buildResearchAgentCommand',
        'toUnpaddedId',
        'buildTmuxSessionName',
        'buildResearchTmuxSessionName',
        'matchTmuxSessionByEntityId',
        'assertTmuxAvailable',
        'tmuxSessionExists',
        'createDetachedTmuxSession',
        'shellQuote',
        'openTerminalAppWithCommand',
        'ensureTmuxSessionForWorktree',
        'openInWarpSplitPanes',
        'closeWarpWindow',
        'openSingleWorktree',
        'addWorktreePermissions',
        'removeWorktreePermissions',
        'presetWorktreeTrust',
        'removeWorktreeTrust',
        'presetCodexTrust',
        'setupWorktreeEnvironment',
        'ensureAgentSessions'
    ],
    hooks: [
        'parseHooksFile',
        'getDefinedHooks',
        'executeHook',
        'runPreHook',
        'runPostHook'
    ],
    templates: [
        'readTemplate',
        'loadAgentConfig',
        'getAvailableAgents',
        'buildAgentAliasMap',
        'processTemplate',
        'readGenericTemplate',
        'extractDescription',
        'formatCommandOutput',
        'getScaffoldContent',
        'getRootFileContent',
        'syncAgentsMdFile',
        'removeDeprecatedCommands',
        'migrateOldFlatCommands',
        'upsertMarkedContent'
    ],
    board: [
        'collectBoardItems',
        'getWorktreeInfo',
        'getCurrentBranch',
        'saveBoardMapping',
        'loadBoardMapping',
        'getBoardAction',
        'displayBoardKanbanView',
        'displayKanbanSection',
        'displayBoardListView',
        'displayListSection',
        'ensureBoardMapInGitignore'
    ],
    validation: [
        'formatTimestamp',
        'parseRalphProgress',
        'parseFeatureValidation',
        'detectNodePackageManager',
        'detectNodeTestCommand',
        'detectValidationCommand',
        'buildRalphPrompt',
        'getCurrentHead',
        'parseAcceptanceCriteria',
        'parseMarkdownChecklist',
        'normalizeCriterionText',
        'evaluateAcceptanceCriteriaFromSpec',
        'buildCriteriaFailureBlock',
        'runValidationCommand',
        'runValidationSuite',
        'updateRalphProgressFile'
    ],
    feedback: [
        'normalizeFeedbackStatus',
        'getFeedbackFolderFromStatus',
        'normalizeFeedbackSeverity',
        'normalizeTag',
        'parseTagListValue',
        'normalizeTagList',
        'serializeFeedbackFrontMatter',
        'extractFeedbackSummary',
        'normalizeFeedbackMetadata',
        'buildFeedbackDocumentContent',
        'readFeedbackDocument',
        'collectFeedbackItems',
        'findDuplicateFeedbackCandidates',
        'buildFeedbackTriageRecommendation',
        'formatFeedbackFieldValue'
    ]
};

function mustSlice(startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker);
    if (start === -1 || end === -1 || end <= start) {
        throw new Error(`Could not slice source between "${startMarker}" and "${endMarker}"`);
    }
    return source.slice(start, end);
}

function getTopLevelFunctionNames(chunk) {
    const matches = chunk.match(/^(?:async\s+)?function\s+([A-Za-z0-9_]+)/gm) || [];
    return matches.map(line => line.replace(/^(?:async\s+)?function\s+/, ''));
}

function writeFile(relativePath, content) {
    const targetPath = path.join(repoRoot, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content);
}

const preCommandChunk = mustSlice('const fs = require(\'fs\');', '// --- Commands ---')
    .replace("const TEMPLATES_ROOT = path.join(__dirname, 'templates');", "const ROOT_DIR = path.join(__dirname, '..');\nconst CLI_ENTRY_PATH = path.join(ROOT_DIR, 'aigon-cli.js');\nconst TEMPLATES_ROOT = path.join(ROOT_DIR, 'templates');")
    .replace(/path\.join\(__dirname, 'package\.json'\)/g, "path.join(ROOT_DIR, 'package.json')")
    .replace(/path\.join\(__dirname, 'CHANGELOG\.md'\)/g, "path.join(ROOT_DIR, 'CHANGELOG.md')")
    .replace(/\b__filename\b/g, 'CLI_ENTRY_PATH');

const utilsExports = [
    ...new Set([
        ...getTopLevelFunctionNames(preCommandChunk),
        'PROVIDER_FAMILIES',
        'SPECS_ROOT',
        'TEMPLATES_ROOT',
        'CLAUDE_SETTINGS_PATH',
        'HOOKS_FILE_PATH',
        'PROJECT_CONFIG_PATH',
        'GLOBAL_CONFIG_DIR',
        'GLOBAL_CONFIG_PATH',
        'RADAR_DEFAULT_PORT',
        'RADAR_PID_FILE',
        'RADAR_LOG_FILE',
        'RADAR_META_FILE',
        'DEFAULT_GLOBAL_CONFIG',
        'PROFILE_PRESET_STRING_FILES',
        'PROFILE_PRESETS',
        'DEV_PROXY_DIR',
        'DEV_PROXY_REGISTRY',
        'DEV_PROXY_CADDYFILE',
        'DEV_PROXY_LOGS_DIR',
        'PORT_REGISTRY_PATH',
        'PATHS',
        'FEEDBACK_STATUS_TO_FOLDER',
        'FEEDBACK_FOLDER_TO_STATUS',
        'FEEDBACK_STATUS_FLAG_TO_FOLDER',
        'FEEDBACK_ACTION_TO_STATUS',
        'FEEDBACK_DEFAULT_LIST_FOLDERS',
        'VERSION_FILE',
        'MARKER_START',
        'MARKER_END',
        'COMMAND_REGISTRY',
        'COMMAND_ALIASES',
        'COMMAND_ALIAS_REVERSE',
        'COMMAND_ARG_HINTS',
        'COMMANDS_DISABLE_MODEL_INVOCATION',
        'AGENT_CONFIGS'
    ])
];

const utilsContent = [
    "'use strict';",
    '',
    preCommandChunk.trim(),
    '',
    'module.exports = {',
    ...utilsExports.map(name => `    ${name},`),
    '};',
    ''
].join('\n');

writeFile('lib/utils.js', utilsContent);

Object.entries(WRAPPER_EXPORTS).forEach(([moduleName, names]) => {
    const lines = [
        "'use strict';",
        '',
        "const utils = require('./utils');",
        '',
        'module.exports = {',
        ...names.map(name => `    ${name}: utils.${name},`),
        '};',
        ''
    ];
    writeFile(`lib/${moduleName}.js`, lines.join('\n'));
});

const commandsChunk = mustSlice('const commands = {', '// --- Main Execution ---');
const commandFactoryContent = [
    "'use strict';",
    '',
    "const fs = require('fs');",
    "const path = require('path');",
    "const os = require('os');",
    "const { execSync, spawnSync } = require('child_process');",
    '',
    "const utils = require('../utils');",
    '',
    'function createAllCommands(overrides = {}) {',
    '    const scope = { ...utils, ...overrides };',
    `    const { ${utilsExports.join(', ')} } = scope;`,
    '',
    commandsChunk.trim(),
    '',
    '    return commands;',
    '}',
    '',
    'module.exports = { createAllCommands };',
    ''
].join('\n');

writeFile('lib/commands/shared.js', commandFactoryContent);

Object.entries(COMMAND_GROUPS).forEach(([groupName, names]) => {
    const factoryName = `create${groupName[0].toUpperCase()}${groupName.slice(1)}Commands`;
    const fileContent = [
        "'use strict';",
        '',
        "const { createAllCommands } = require('./shared');",
        '',
        `const COMMAND_NAMES = ${JSON.stringify(names, null, 4)};`,
        '',
        `function ${factoryName}(overrides = {}) {`,
        '    const allCommands = createAllCommands(overrides);',
        '    return Object.fromEntries(COMMAND_NAMES.map(name => [name, allCommands[name]]).filter(([, handler]) => typeof handler === \'function\'));',
        '}',
        '',
        `module.exports = { ${factoryName} };`,
        ''
    ].join('\n');
    writeFile(`lib/commands/${groupName}.js`, fileContent);
});

const entrypoint = [
    '#!/usr/bin/env node',
    '',
    "'use strict';",
    '',
    "const { COMMAND_ALIASES } = require('./lib/constants');",
    "const { createFeatureCommands } = require('./lib/commands/feature');",
    "const { createResearchCommands } = require('./lib/commands/research');",
    "const { createFeedbackCommands } = require('./lib/commands/feedback');",
    "const { createSetupCommands } = require('./lib/commands/setup');",
    "const { createMiscCommands } = require('./lib/commands/misc');",
    '',
    'const commands = {',
    '    ...createFeatureCommands(),',
    '    ...createResearchCommands(),',
    '    ...createFeedbackCommands(),',
    '    ...createSetupCommands(),',
    '    ...createMiscCommands(),',
    '};',
    '',
    'const args = process.argv.slice(2);',
    'const commandName = args[0];',
    'const commandArgs = args.slice(1);',
    'const cleanCommand = commandName ? commandName.replace(/^aigon-/, \'\') : null;',
    'const resolvedCommand = cleanCommand ? (COMMAND_ALIASES[cleanCommand] || cleanCommand) : cleanCommand;',
    '',
    'if (!resolvedCommand || resolvedCommand === \'help\' || resolvedCommand === \'--help\' || resolvedCommand === \'-h\') {',
    '    commands.help();',
    '} else if (commands[resolvedCommand]) {',
    '    const result = commands[resolvedCommand](commandArgs);',
    '    if (result && typeof result.catch === \'function\') {',
    '        result.catch(error => {',
    '            console.error(`❌ ${error.message}`);',
    '            process.exit(1);',
    '        });',
    '    }',
    '} else {',
    '    console.error(`Unknown command: ${commandName}\\n`);',
    '    commands.help();',
    '}',
    ''
].join('\n');

writeFile('aigon-cli.js', entrypoint);

fs.mkdirSync(libDir, { recursive: true });
fs.mkdirSync(commandsDir, { recursive: true });
