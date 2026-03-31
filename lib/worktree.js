'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');
const git = require('./git');
const stateMachine = require('./state-queries');
const terminalAdapters = require('./terminal-adapters');

// Lazy requires to avoid circular dependency issues
function _getAgentCliConfig(agentId) {
    return require('./config').getAgentCliConfig(agentId);
}
function _getAgentLaunchFlagTokens(command, flagValue, options) {
    return require('./config').getAgentLaunchFlagTokens(command, flagValue, options);
}
function _getEffectiveConfig() {
    return require('./config').getEffectiveConfig();
}
function _getActiveProfile() {
    return require('./config').getActiveProfile();
}
function _loadAgentConfig(agentId) {
    return require('./templates').loadAgentConfig(agentId);
}
function _readConductorReposFromGlobalConfig() {
    return require('./config').readConductorReposFromGlobalConfig();
}
function _getAgentConfigs() {
    return require('./utils').AGENT_CONFIGS;
}
function _getClaudeSettingsPath() {
    return require('./utils').CLAUDE_SETTINGS_PATH;
}
function _safeWrite(filePath, content) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content);
}
function _getAppId() {
    return require('./utils').getAppId();
}
function _hashBranchToPort(branchName) {
    return require('./proxy').hashBranchToPort(branchName);
}
function _getDevProxyUrl(appId, serverId) {
    if (serverId) {
        return `http://${serverId}.${appId}.test`;
    }
    return `http://${appId}.test`;
}

// --- Worktree Helpers ---

function getWorktreeBase() {
    const repoName = path.basename(process.cwd());
    return `../${repoName}-worktrees`;
}

// Delegated to lib/git.js — single source of truth for git operations
const findWorktrees = git.listWorktrees;
const filterByFeatureId = git.filterWorktreesByFeature;

/**
 * Build the raw agent CLI command string (without shell trap wrapper).
 * Use buildAgentCommand() for the wrapped version.
 *
 * @param {Object} wt - Worktree/session config
 * @param {string} wt.agent - Agent ID
 * @param {string} wt.featureId - Entity ID (feature or research)
 * @param {string} [wt.desc] - Entity description (kebab-case)
 * @param {string} [wt.path] - Worktree/working directory path
 * @param {string} [wt.entityType] - 'feature' (default) or 'research'
 * @param {string} [taskType='implement'] - 'implement', 'evaluate', 'review', 'do', 'eval'
 * @returns {string} Raw agent CLI command string
 */
function buildRawAgentCommand(wt, taskType = 'implement') {
    const cliConfig = _getAgentCliConfig(wt.agent);
    const isResearch = wt.entityType === 'research';

    let prompt;
    let modelKey;
    if (isResearch) {
        const agentConfig = _loadAgentConfig(wt.agent);
        const isHeadless = !agentConfig?.commands?.length;
        if (isHeadless) {
            // Headless agents (no slash commands): use descriptive prompt with CLI commands
            const command = taskType === 'eval' ? 'research-eval' : 'research-do';
            prompt = `Read AGENTS.md for project context. Then run \`aigon ${command} ${wt.featureId}\` in the shell and follow its output.`;
        } else {
            // Agents with slash commands: use CMD_PREFIX + slash command
            const cmdPrefix = agentConfig?.placeholders?.CMD_PREFIX || '/aigon:';
            const command = taskType === 'eval' ? 'research-eval' : 'research-do';
            prompt = `${cmdPrefix}${command} ${wt.featureId}`;
        }
        modelKey = 'research';
    } else {
        // Feature: use cliConfig prompt templates with {featureId} placeholder
        const promptTemplate = taskType === 'evaluate' ? (cliConfig.evalPrompt || cliConfig.implementPrompt)
            : taskType === 'review' ? (cliConfig.reviewPrompt || cliConfig.implementPrompt)
            : cliConfig.implementPrompt;
        prompt = promptTemplate.replaceAll('{featureId}', wt.featureId);
        // When launching eval/review from dashboard, skip the CLI's launch mode
        if (taskType === 'evaluate' || taskType === 'review') prompt += ' --no-launch';
        modelKey = taskType;
    }

    // Unset CLAUDECODE to prevent "nested session" error when launched from a Claude Code terminal
    const prefix = cliConfig.command === 'claude' ? 'unset CLAUDECODE && ' : '';

    // AIGON_TEST_MODEL_CC env var overrides model for Claude only (used by e2e test suite)
    const testModelOverride = (cliConfig.command === 'claude' && process.env.AIGON_TEST_MODEL_CC) || null;
    const model = testModelOverride || cliConfig.models?.[modelKey];
    const modelFlag = model ? `--model ${shellQuote(model)}` : '';

    // Name the CC session using the same format as tmux sessions
    const typeChar = isResearch ? 'r' : 'f';
    const nameFlag = cliConfig.command === 'claude'
        ? `--name "${buildTmuxSessionName(wt.featureId, wt.agent, { desc: wt.desc, worktreePath: wt.path, entityType: typeChar })}"`
        : '';

    // Defensive cd: some agents (e.g. Codex) resolve project root from .git
    // rather than cwd. In worktrees .git is a file, not a dir, which can
    // confuse project detection. Explicit cd ensures the agent starts right.
    // Use absolute path — tmux sessions may set cwd to the worktree itself,
    // making relative paths resolve incorrectly.
    // Also override GEMINI_CLI_IDE_WORKSPACE_PATH for Gemini CLI — it inherits
    // the parent env which points to the main repo, ignoring cwd entirely.
    const absPath = wt.path ? path.resolve(wt.path) : null;
    const envOverrides = absPath ? `export GEMINI_CLI_IDE_WORKSPACE_PATH=${shellQuote(absPath)} && ` : '';
    const cdPrefix = absPath ? `cd ${shellQuote(absPath)} && ${envOverrides}` : '';

    const flagTokens = _getAgentLaunchFlagTokens(cliConfig.command, cliConfig.implementFlag, { autonomous: false });
    const flags = [...flagTokens, modelFlag, nameFlag].filter(Boolean).join(' ');
    if (flags) {
        return `${cdPrefix}${prefix}${cliConfig.command} ${flags} "${prompt}"`;
    }
    return `${cdPrefix}${prefix}${cliConfig.command} "${prompt}"`;
}

/**
 * Get signal capabilities for an agent from its template config.
 * Returns defaults (shellTrap + heartbeatSidecar on, no cliHooks) for
 * agents without an explicit signals block — new agents automatically
 * participate in the signal architecture.
 *
 * @param {string} agentId - Agent ID (cc, gg, cx, cu, mv, etc.)
 * @returns {{ shellTrap: boolean, heartbeatSidecar: boolean, cliHooks: object|null }}
 */
function getAgentSignalCapabilities(agentId) {
    const agentConfig = _loadAgentConfig(agentId);
    if (agentConfig?.signals) {
        return {
            shellTrap: agentConfig.signals.shellTrap !== false,
            heartbeatSidecar: agentConfig.signals.heartbeatSidecar !== false,
            cliHooks: agentConfig.signals.cliHooks || null,
        };
    }
    // Default: universal baseline — shell trap + heartbeat, no CLI hooks
    return { shellTrap: true, heartbeatSidecar: true, cliHooks: null };
}

/**
 * Get heartbeat interval from project config for use in shell trap wrapper.
 * Reads from .aigon/config.json heartbeat.intervalMs (preferred) or
 * workflow.heartbeatIntervalMs (legacy).
 *
 * @returns {number} Interval in seconds
 */
function _getHeartbeatIntervalSecs() {
    try {
        const config = require('./config').loadProjectConfig();
        const intervalMs = config?.heartbeat?.intervalMs
            || config?.workflow?.heartbeatIntervalMs
            || 30000;
        return Math.max(1, Math.round(intervalMs / 1000));
    } catch {
        return 30;
    }
}

/**
 * Resolve the shared state directory used for heartbeat files.
 * Worktrees write heartbeat files into the main repo's .aigon/state directory
 * so the orchestrator can observe a single canonical location.
 *
 * @param {Object} wt - Worktree/session config
 * @param {string} [wt.path] - Worktree/working directory path
 * @returns {string} Absolute path to the state directory
 */
function _getHeartbeatStateDir(wt) {
    const cwd = wt.path ? path.resolve(wt.path) : process.cwd();
    const worktreeJsonPath = path.join(cwd, '.aigon', 'worktree.json');
    if (fs.existsSync(worktreeJsonPath)) {
        try {
            const worktreeMeta = JSON.parse(fs.readFileSync(worktreeJsonPath, 'utf8'));
            if (worktreeMeta.mainRepo) {
                return path.join(path.resolve(worktreeMeta.mainRepo), '.aigon', 'state');
            }
        } catch {
            // Fall through to local state dir
        }
    }
    return path.join(cwd, '.aigon', 'state');
}

/**
 * Build the agent CLI command string for a worktree or entity session.
 * Wraps the raw agent command in a shell script with:
 *   - trap EXIT handler that fires agent-status on completion
 *   - agent-status implementing on session start
 *   - background heartbeat sidecar (file touch)
 *
 * The shell trap is the universal signal foundation — it works identically
 * across all agents with zero agent-specific code. The trap fires on normal
 * exit, SIGINT, and SIGTERM. It does NOT fire on SIGKILL or machine crash
 * (the orchestrator sweep handles those).
 *
 * Callers (createDetachedTmuxSession, openTerminalAppWithCommand, etc.)
 * wrap this string in `bash -lc`, so we return a plain script — no outer
 * bash -lc here.
 *
 * @param {Object} wt - Worktree/session config
 * @param {string} wt.agent - Agent ID
 * @param {string} wt.featureId - Entity ID (feature or research)
 * @param {string} [wt.desc] - Entity description (kebab-case)
 * @param {string} [wt.path] - Worktree/working directory path
 * @param {string} [wt.entityType] - 'feature' (default) or 'research'
 * @param {string} [taskType='implement'] - 'implement', 'evaluate', 'review', 'do', 'eval'
 * @returns {string} Shell script string with trap + heartbeat + agent command
 */
function buildAgentCommand(wt, taskType = 'implement') {
    const rawCmd = buildRawAgentCommand(wt, taskType);
    const signals = getAgentSignalCapabilities(wt.agent);

    // If shell trap is explicitly disabled, return the raw command unchanged
    if (!signals.shellTrap) {
        return rawCmd;
    }

    const featureId = wt.featureId;
    const agentId = wt.agent;
    const heartbeatIntervalSecs = _getHeartbeatIntervalSecs();
    const heartbeatStateDir = _getHeartbeatStateDir(wt);
    const heartbeatFile = path.join(heartbeatStateDir, `heartbeat-${featureId}-${agentId}`);

    // Build the heartbeat sidecar snippet (background loop tied to parent PID)
    const heartbeatLines = [];
    if (signals.heartbeatSidecar) {
        heartbeatLines.push(
            `mkdir -p ${shellQuote(heartbeatStateDir)}`,
            `(while kill -0 $$ 2>/dev/null; do touch ${shellQuote(heartbeatFile)}; sleep ${heartbeatIntervalSecs}; done) &`,
            '_aigon_hb_pid=$!',
        );
    }

    // Build the cleanup function with heartbeat sidecar kill
    const cleanupKillHb = signals.heartbeatSidecar
        ? 'kill $_aigon_hb_pid 2>/dev/null || true'
        : '';

    const lines = [
        // Define cleanup function
        '_aigon_cleanup() {',
        '  _aigon_exit_code=$?',
        cleanupKillHb ? `  ${cleanupKillHb}` : null,
        '  if [ $_aigon_exit_code -eq 0 ]; then',
        '    aigon agent-status submitted 2>/dev/null || true',
        '  else',
        '    aigon agent-status error 2>/dev/null || true',
        '  fi',
        '}',
        // Install trap
        'trap _aigon_cleanup EXIT',
        // Signal implementing on start
        'aigon agent-status implementing 2>/dev/null || true',
        // Heartbeat sidecar
        ...heartbeatLines,
        // The actual agent command
        rawCmd,
    ].filter(l => l !== null);

    return lines.join('\n');
}

/**
 * Build the agent CLI command string for research conduct or synthesis.
 * Thin wrapper around buildAgentCommand with entityType='research'.
 * @deprecated Use buildAgentCommand with wt.entityType='research' instead.
 * @param {string} agentId - Agent ID (cc, gg, cx, cu)
 * @param {string} researchId - Research ID (padded, e.g., "05")
 * @param {string} [taskType='do'] - 'do' or 'eval'
 * @returns {string} Command string to run the agent CLI
 */
function buildResearchAgentCommand(agentId, researchId, taskType = 'do') {
    return buildAgentCommand({
        agent: agentId,
        featureId: researchId,
        entityType: 'research',
    }, taskType);
}

function toUnpaddedId(id) {
    const parsed = parseInt(String(id), 10);
    return Number.isNaN(parsed) ? String(id) : String(parsed);
}

function resolveTmuxRepoName(options) {
    if (options && options.repo) {
        return path.basename(options.repo);
    }

    const worktreePath = options && (options.worktreePath || options.path || options.cwd);
    if (worktreePath) {
        const normalizedPath = path.resolve(worktreePath);
        const baseName = path.basename(normalizedPath);
        const parentBase = path.basename(path.dirname(normalizedPath));

        if (/^(feature|research)-\d+-[a-z]{2}(?:-|$)/.test(baseName) && parentBase.endsWith('-worktrees')) {
            return parentBase.slice(0, -'-worktrees'.length);
        }

        if (baseName.endsWith('-worktrees')) {
            return baseName.slice(0, -'-worktrees'.length);
        }
    }

    return path.basename(process.cwd());
}

/**
 * Build a tmux session name following the naming convention:
 *   {repo}-{typeChar}{num}-{agent}-{desc}
 * Falls back to shorter forms when repo/desc are unavailable.
 * @param {string} entityId - Feature or research ID
 * @param {string} [agentId]
 * @param {object} [options]
 * @param {string} [options.repo] - repository name (defaults to cwd basename)
 * @param {string} [options.desc] - entity description (kebab-case)
 * @param {string} [options.entityType] - 'f' for feature (default), 'r' for research
 */
function buildTmuxSessionName(entityId, agentId, options) {
    const repo = resolveTmuxRepoName(options);
    const agent = agentId || 'solo';
    const num = toUnpaddedId(entityId);
    const typeChar = (options && options.entityType) || 'f';
    const desc = options && options.desc;
    return desc
        ? `${repo}-${typeChar}${num}-${agent}-${desc}`
        : `${repo}-${typeChar}${num}-${agent}`;
}

/**
 * Build a tmux session name for research sessions.
 * Thin wrapper around buildTmuxSessionName with entityType='r'.
 * @deprecated Use buildTmuxSessionName with options.entityType='r' instead.
 */
function buildResearchTmuxSessionName(researchId, agentId, options) {
    return buildTmuxSessionName(researchId, agentId, Object.assign({}, options, { entityType: 'r' }));
}

/**
 * Parse a tmux session name to extract entity type, id, and agent.
 * Returns { type: 'f'|'r', id: string, agent: string } or null.
 */
function parseTmuxSessionName(name) {
    // Match eval/review sessions: {repo}-f{id}-eval, {repo}-r{id}-eval-{agent}, {repo}-f{id}-review-{agent}(-desc)
    const roleMatch = name.match(/^(.+)-(f|r)(\d+)-(eval(?:-[a-z]{2})?|review-[a-z]{2})(?:-|$)/);
    if (roleMatch) return { repoPrefix: roleMatch[1], type: roleMatch[2], id: roleMatch[3], agent: roleMatch[4] };
    // Standard agent sessions: {repo}-f{id}-{agent}(-desc)
    const match = name.match(/^(.+)-(f|r)(\d+)-([a-z]{2})(?:-|$)/);
    if (!match) return null;
    return { repoPrefix: match[1], type: match[2], id: match[3], agent: match[4] };
}

/**
 * Scan stage folders across all repos to find which stage an entity is in.
 * @param {string[]} repos - repo paths from dashboard config
 * @param {'f'|'r'} entityType - 'f' for feature, 'r' for research
 * @param {string} entityId - numeric id (unpadded)
 * @returns {{ stage: string, repo: string } | null}
 */
function findEntityStage(repos, entityType, entityId) {
    const unpadded = toUnpaddedId(entityId);
    for (const repoPath of repos) {
        const absRepo = path.resolve(repoPath);
        if (entityType === 'f') {
            const featureRoot = path.join(absRepo, 'docs', 'specs', 'features');
            const stages = [
                { dir: '01-inbox', stage: 'inbox' },
                { dir: '02-backlog', stage: 'backlog' },
                { dir: '03-in-progress', stage: 'in-progress' },
                { dir: '04-in-evaluation', stage: 'in-evaluation' },
                { dir: '05-done', stage: 'done' },
                { dir: '06-paused', stage: 'paused' }
            ];
            for (const { dir, stage } of stages) {
                const fullDir = path.join(featureRoot, dir);
                if (!fs.existsSync(fullDir)) continue;
                try {
                    const files = fs.readdirSync(fullDir);
                    const pattern = new RegExp('^feature-0*' + unpadded + '-.+\\.md$');
                    if (files.some(f => pattern.test(f))) {
                        return { stage, repo: absRepo };
                    }
                } catch (e) { /* ignore */ }
            }
        } else {
            const researchRoot = path.join(absRepo, 'docs', 'specs', 'research-topics');
            const stages = [
                { dir: '01-inbox', stage: 'inbox' },
                { dir: '02-backlog', stage: 'backlog' },
                { dir: '03-in-progress', stage: 'in-progress' },
                { dir: '04-in-evaluation', stage: 'in-evaluation' },
                { dir: '05-done', stage: 'done' },
                { dir: '06-paused', stage: 'paused' }
            ];
            for (const { dir, stage } of stages) {
                const fullDir = path.join(researchRoot, dir);
                if (!fs.existsSync(fullDir)) continue;
                try {
                    const files = fs.readdirSync(fullDir);
                    const pattern = new RegExp('^research-0*' + unpadded + '-.+\\.md$');
                    if (files.some(f => pattern.test(f))) {
                        return { stage, repo: absRepo };
                    }
                } catch (e) { /* ignore */ }
            }
        }
    }
    return null;
}

/**
 * Classify why a session is orphaned.
 * @returns {{ reason: string } | null}
 */
function classifyOrphanReason(parsed, stageResult) {
    if (!parsed) return null;
    if (!stageResult) return { reason: 'spec-missing' };
    const entityType = parsed.type === 'f' ? 'feature' : 'research';
    // For feature/research, use engine snapshot lifecycle (spec folder never reports `closing`)
    if (entityType === 'feature' || entityType === 'research') {
        const workflowSnapshotAdapter = require('./workflow-snapshot-adapter');
        const wfType = entityType === 'feature' ? 'feature' : 'research';
        const wfId = toUnpaddedId(parsed.id);
        const snap = workflowSnapshotAdapter.readWorkflowSnapshotSync(stageResult.repo, wfType, wfId);
        if (snap && (snap.lifecycle === 'done' || snap.lifecycle === 'closing')) {
            return { reason: snap.lifecycle };
        }
        if (!snap && stageResult.stage === 'done') {
            return { reason: 'done' };
        }
        return null;
    }
    // Feedback still uses state-queries
    const availableActions = stateMachine.getAvailableActions(
        entityType,
        stageResult.stage,
        { agents: [], agentStatuses: {}, tmuxSessionStates: {} }
    );
    if (availableActions.length === 0) return { reason: stageResult.stage };
    return null;
}

/**
 * List tmux sessions enriched with entity and orphan data.
 * @returns {{ sessions: Array, orphanCount: number }}
 */
function getEnrichedSessions() {
    assertTmuxAvailable();
    const fmt = '#{session_name}\t#{session_created}\t#{session_attached}';
    const result = runTmux(['list-sessions', '-F', fmt], { encoding: 'utf8', stdio: 'pipe' });
    if (result.error || result.status !== 0) {
        return { sessions: [], orphanCount: 0 };
    }
    const repos = _readConductorReposFromGlobalConfig();
    const sessions = result.stdout.trim().split('\n').filter(Boolean).map(line => {
        const [name, createdEpoch, attached] = line.split('\t');
        const trimmedName = name.trim();
        const parsed = parseTmuxSessionName(trimmedName);
        // Prefer the repo whose basename matches the tmux session prefix to avoid cross-repo ID collisions
        const sortedRepos = parsed && parsed.repoPrefix
            ? [...repos].sort((a, b) => {
                const aMatch = path.basename(path.resolve(a)) === parsed.repoPrefix ? -1 : 0;
                const bMatch = path.basename(path.resolve(b)) === parsed.repoPrefix ? -1 : 0;
                return aMatch - bMatch;
            })
            : repos;
        const stageResult = parsed ? findEntityStage(sortedRepos, parsed.type, parsed.id) : null;
        const orphan = parsed ? classifyOrphanReason(parsed, stageResult) : null;
        const repoPath = stageResult ? stageResult.repo : (parsed && parsed.repoPrefix
            ? repos.find(r => path.basename(path.resolve(r)) === parsed.repoPrefix) || null
            : null);
        return {
            name: trimmedName,
            createdAt: new Date(parseInt(createdEpoch, 10) * 1000).toISOString(),
            attached: attached.trim() === '1',
            entityType: parsed ? parsed.type : null,
            entityId: parsed ? parsed.id : null,
            agent: parsed ? parsed.agent : null,
            repoPath: repoPath ? path.resolve(repoPath) : null,
            stage: stageResult ? stageResult.stage : null,
            orphan: orphan
        };
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const orphanCount = sessions.filter(s => s.orphan).length;
    return { sessions, orphanCount };
}

/**
 * Match a tmux session name against a feature or research ID.
 * Handles both old-style (aigon-f40-cc) and new-style (repo-f40-cc-desc) names.
 * Returns { type: 'f'|'r', id: string, agent: string } or null.
 */
function matchTmuxSessionByEntityId(sessionName, entityId) {
    const unpadded = toUnpaddedId(entityId);
    // Match eval/review sessions: {anything}-f{id}-eval or {anything}-f{id}-review-{agent}(-desc)
    const roleMatch = sessionName.match(/^.+-(f|r)(\d+)-(eval|review-[a-z]{2})(?:-|$)/);
    if (roleMatch && toUnpaddedId(roleMatch[2]) === unpadded) {
        return { type: roleMatch[1], id: roleMatch[2], agent: roleMatch[3] };
    }
    // Match standard: {anything}-f{id}-{agent} or {anything}-r{id}-{agent}
    const match = sessionName.match(/^.+-(f|r)(\d+)-([a-z]{2})(?:-|$)/);
    if (!match) return null;
    if (toUnpaddedId(match[2]) !== unpadded) return null;
    return { type: match[1], id: match[2], agent: match[3] };
}

function resolveTmuxBinary() {
    const candidates = [
        process.env.AIGON_TMUX_PATH,
        process.env.TMUX_BINARY,
        '/opt/homebrew/bin/tmux',
        '/usr/local/bin/tmux',
        '/usr/bin/tmux',
        'tmux'
    ].filter(Boolean);

    for (const candidate of candidates) {
        try {
            const result = spawnSync(candidate, ['-V'], { stdio: 'ignore' });
            if (!result.error && result.status === 0) return candidate;
        } catch (e) {
            // continue
        }
    }
    return null;
}

function runTmux(args, options = {}) {
    const tmuxBin = resolveTmuxBinary();
    if (!tmuxBin) {
        return { status: 1, error: new Error('tmux is not installed or not available in PATH') };
    }
    return spawnSync(tmuxBin, args, options);
}

function assertTmuxAvailable() {
    const result = runTmux(['-V'], { stdio: 'ignore' });
    if (result.error || result.status !== 0) {
        throw new Error('tmux is not installed or not available in PATH');
    }
}

function tmuxSessionExists(sessionName) {
    const result = runTmux(['has-session', '-t', sessionName], { stdio: 'ignore' });
    return !result.error && result.status === 0;
}

function createDetachedTmuxSession(sessionName, cwd, command) {
    const args = ['new-session', '-d', '-s', sessionName, '-c', cwd];
    // Wrap in bash -c so shell syntax (&&, unset, etc.) works correctly.
    // Without this, tmux passes the command directly to exec() which can't handle shell builtins.
    if (command) args.push(`bash -lc ${shellQuote(command)}`);
    const result = runTmux(args, { stdio: 'ignore' });
    if (result.error || result.status !== 0) {
        throw new Error(`Failed to create tmux session "${sessionName}"`);
    }
    // Set terminal window title to the session name so windows are identifiable
    runTmux(['set-option', '-t', sessionName, 'set-titles', 'on'], { stdio: 'ignore' });
    runTmux(['set-option', '-t', sessionName, 'set-titles-string', '#{session_name}'], { stdio: 'ignore' });
    // Name the default window so menubar and list-windows show meaningful names
    runTmux(['rename-window', '-t', `${sessionName}:0`, sessionName], { stdio: 'ignore' });
}

function isTmuxSessionAttached(sessionName) {
    if (!sessionName) return false;
    const result = runTmux(['list-clients', '-F', '#{session_name}'], { encoding: 'utf8', stdio: 'pipe' });
    if (result.error || result.status !== 0) return false;
    return result.stdout
        .split('\n')
        .map(line => line.trim())
        .some(name => name === sessionName);
}

const { shellQuote } = terminalAdapters;

function openTerminalAppWithCommand(cwd, command, title) {
    // If session is already attached, skip (Linux and macOS)
    if (title && isTmuxSessionAttached(title)) {
        console.log(`   ℹ️  Session "${title}" is already attached in another terminal.`);
        return;
    }

    const effectiveConfig = _getEffectiveConfig();
    const env = {
        platform: process.platform,
        tmuxApp: effectiveConfig.tmuxApp || 'terminal',
        linuxTerminal: effectiveConfig.linuxTerminal || null,
    };

    const adapter = terminalAdapters.findAdapter(env);
    if (!adapter) {
        console.log(`\n📋 No GUI terminal found. Run this command manually:`);
        console.log(`   cd ${cwd} && ${command}\n`);
        return;
    }

    adapter.launch(command, {
        cwd,
        title,
        isTmuxAttached: title ? isTmuxSessionAttached(title) : false,
        resolveTmuxBinary,
    });
}

// tileITerm2Windows delegated to terminal-adapters.js
const { tileITerm2Windows } = terminalAdapters;

function ensureTmuxSessionForWorktree(wt, agentCommand) {
    const sessionName = buildTmuxSessionName(wt.featureId, wt.agent, { desc: wt.desc, worktreePath: wt.path });
    if (tmuxSessionExists(sessionName)) {
        return { sessionName, created: false };
    }

    const listResult = spawnSync('tmux', ['list-sessions', '-F', '#S'], { encoding: 'utf8', stdio: 'pipe' });
    if (!listResult.error && listResult.status === 0) {
        const existing = listResult.stdout.split('\n').map(s => s.trim()).find(s =>
            matchTmuxSessionByEntityId(s, wt.featureId)?.agent === wt.agent
        );
        if (existing) {
            return { sessionName: existing, created: false };
        }
    }

    createDetachedTmuxSession(sessionName, wt.path, agentCommand);
    return { sessionName, created: true };
}

function openInWarpSplitPanes(worktreeConfigs, configName, title, tabColor) {
    if (process.platform === 'linux') {
        console.log('⚠️  Warp is not available on Linux. Use tmux to attach to agent sessions instead.');
        worktreeConfigs.forEach(wt => {
            const sessionName = buildTmuxSessionName(wt.featureId, wt.agent, { desc: wt.desc, worktreePath: wt.path });
            console.log(`   tmux attach -t ${sessionName}`);
        });
        return null;
    }
    const AGENT_CONFIGS = _getAgentConfigs();
    const configs = worktreeConfigs.map(wt => {
        let paneTitle = null;
        if (wt.agent) {
            const agentConfig = AGENT_CONFIGS[wt.agent] || {};
            const agentName = agentConfig.name || wt.agent;
            paneTitle = wt.researchId
                ? `Research #${wt.researchId} - ${agentName}`
                : wt.featureId
                    ? `Feature #${String(wt.featureId).padStart(2, '0')} - ${agentName}`
                    : agentName;
        }
        return { path: wt.path, agentCommand: wt.agentCommand, paneTitle, portLabel: wt.portLabel };
    });
    const warpAdapter = terminalAdapters.getAdapter('warp');
    return warpAdapter.split(configs, { configName, title, tabColor });
}

// closeWarpWindow delegated to terminal-adapters.js
const { closeWarpWindow } = terminalAdapters;

/**
 * Open a single worktree in the specified terminal.
 */
function openSingleWorktree(wt, agentCommand, terminal) {
    const AGENT_CONFIGS = _getAgentConfigs();

    // On Linux, redirect macOS-only terminals to tmux
    if (process.platform === 'linux') {
        if (terminal === 'warp' || terminal === 'terminal') {
            console.log(`⚠️  ${terminal === 'warp' ? 'Warp' : 'Terminal.app'} is not available on Linux. Falling back to tmux.`);
            terminal = 'tmux';
        }
    }

    if (terminal === 'warp') {
        const agentMeta = AGENT_CONFIGS[wt.agent] || {};
        const paddedId = String(wt.featureId).padStart(2, '0');
        const profile = _getActiveProfile();
        const port = profile.devServer.enabled
            ? (profile.devServer.ports[wt.agent] || agentMeta.port)
            : null;
        const portSuffix = port ? ` | Port ${port}` : '';
        const tabTitle = `Feature #${paddedId} - ${agentMeta.name || wt.agent}${portSuffix}`;
        try {
            const warpAdapter = terminalAdapters.getAdapter('warp');
            warpAdapter.launch(agentCommand, {
                cwd: wt.path,
                title: tabTitle,
                configName: path.basename(wt.path),
                tabColor: agentMeta.terminalColor || 'cyan',
            });
            console.log(`\n🚀 Opening worktree in Warp:`);
            console.log(`   Feature: ${wt.featureId} - ${wt.desc}`);
            console.log(`   Agent: ${wt.agent}`);
            console.log(`   Path: ${wt.path}`);
            console.log(`   Command: ${agentCommand}`);
        } catch (e) {
            console.error(`❌ Failed to open Warp: ${e.message}`);
        }
    } else if (terminal === 'terminal') {
        try {
            execSync(`open -a Terminal "${wt.path}"`);
            console.log(`\n🚀 Opening worktree in Terminal.app:`);
            console.log(`   Feature: ${wt.featureId} - ${wt.desc}`);
            console.log(`   Agent: ${wt.agent}`);
            console.log(`   Path: ${wt.path}`);
            console.log(`\n📋 Run this command in the terminal:`);
            console.log(`   ${agentCommand}`);
        } catch (e) {
            console.error(`❌ Failed to open Terminal.app: ${e.message}`);
        }
    } else if (terminal === 'tmux') {
        try {
            assertTmuxAvailable();
            const { sessionName, created } = ensureTmuxSessionForWorktree(wt, agentCommand);
            openTerminalAppWithCommand(wt.path, `tmux attach -t ${shellQuote(sessionName)}`, sessionName);
            const tmuxAppName = process.platform === 'linux' ? 'tmux'
                : (_getEffectiveConfig().tmuxApp || 'terminal') === 'iterm2' ? 'iTerm2' : 'Terminal.app';
            console.log(`\n🚀 Opening worktree in tmux via ${tmuxAppName}:`);
            console.log(`   Feature: ${wt.featureId} - ${wt.desc}`);
            console.log(`   Agent: ${wt.agent}`);
            console.log(`   Path: ${wt.path}`);
            console.log(`   Session: ${sessionName}${created ? ' (created)' : ' (attached)'}`);
        } catch (e) {
            console.error(`❌ Failed to open tmux session: ${e.message}`);
            const installHint = process.platform === 'linux' ? 'sudo apt install tmux  (or yum/pacman equivalent)' : 'brew install tmux';
            console.error(`   Install tmux: ${installHint}`);
        }
    } else {
        console.error(`❌ Terminal "${terminal}" not supported.`);
        console.error(`   Supported terminals: warp, terminal, tmux`);
        console.error(`\n   Override with: aigon feature-open <ID> --terminal=warp`);
        console.error(`   Or set default: Edit ~/.aigon/config.json`);
    }
}

// --- Worktree Permission Helpers ---

function addWorktreePermissions(worktreePaths) {
    // Add full file and bash permissions for worktrees to Claude settings
    const CLAUDE_SETTINGS_PATH = _getClaudeSettingsPath();
    if (!fs.existsSync(CLAUDE_SETTINGS_PATH)) return;

    try {
        const settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf8'));
        if (!settings.permissions) settings.permissions = {};
        if (!settings.permissions.allow) settings.permissions.allow = [];

        // Convert relative paths to absolute for permissions
        const cwd = process.cwd();
        worktreePaths.forEach(relativePath => {
            const absolutePath = path.resolve(cwd, relativePath);
            const permissions = [
                `Read(${absolutePath}/**)`,
                `Edit(${absolutePath}/**)`,
                `Write(${absolutePath}/**)`,
                `Bash(cd ${absolutePath}:*)`,
                `Bash(git -C ${absolutePath}:*)`,
                `Bash(aigon:*)`,
                `Bash(node:*)`,
                `Bash(npm:*)`,
            ];

            permissions.forEach(perm => {
                if (!settings.permissions.allow.includes(perm)) {
                    settings.permissions.allow.push(perm);
                }
            });
        });

        fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2));
        console.log(`\uD83D\uDD13 Added worktree permissions to .claude/settings.json`);
    } catch (e) {
        console.warn(`\u26A0\uFE0F  Could not update Claude settings: ${e.message}`);
    }
}

function removeWorktreePermissions(worktreePaths) {
    // Remove all worktree permissions from Claude settings
    const CLAUDE_SETTINGS_PATH = _getClaudeSettingsPath();
    if (!fs.existsSync(CLAUDE_SETTINGS_PATH)) return;

    try {
        const settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf8'));
        if (!settings.permissions || !settings.permissions.allow) return;

        const cwd = process.cwd();
        worktreePaths.forEach(relativePath => {
            const absolutePath = path.resolve(cwd, relativePath);
            // Remove any permission that references this worktree path
            settings.permissions.allow = settings.permissions.allow.filter(
                perm => !perm.includes(absolutePath)
            );
        });

        fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2));
    } catch (e) {
        // Silent fail on cleanup
    }
}

/**
 * Pre-seed Claude Code workspace trust for worktree directories.
 * Claude Code stores trust state in ~/.claude.json under projects.<path>.hasTrustDialogAccepted.
 * Without this, each new worktree triggers an interactive trust dialog that blocks automated launches.
 * @param {string[]} worktreePaths - Array of worktree paths (relative or absolute)
 */
function presetWorktreeTrust(worktreePaths) {
    const claudeJsonPath = path.join(os.homedir(), '.claude.json');
    try {
        let config = {};
        if (fs.existsSync(claudeJsonPath)) {
            config = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf8'));
        }
        if (!config.projects) config.projects = {};

        const cwd = process.cwd();
        let changed = false;
        worktreePaths.forEach(relativePath => {
            const absolutePath = path.resolve(cwd, relativePath);
            if (!config.projects[absolutePath]) {
                config.projects[absolutePath] = {};
            }
            if (!config.projects[absolutePath].hasTrustDialogAccepted) {
                config.projects[absolutePath].hasTrustDialogAccepted = true;
                changed = true;
            }
        });

        if (changed) {
            fs.writeFileSync(claudeJsonPath, JSON.stringify(config, null, 2));
            console.log(`\uD83D\uDD13 Pre-seeded Claude Code workspace trust for worktree(s)`);
        }
    } catch (e) {
        console.warn(`\u26A0\uFE0F  Could not pre-seed Claude Code trust: ${e.message}`);
    }
}

/**
 * Remove Claude Code workspace trust entries for worktree directories.
 * @param {string[]} worktreePaths - Array of worktree paths (relative or absolute)
 */
function removeWorktreeTrust(worktreePaths) {
    const claudeJsonPath = path.join(os.homedir(), '.claude.json');
    try {
        if (!fs.existsSync(claudeJsonPath)) return;
        const config = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf8'));
        if (!config.projects) return;

        const cwd = process.cwd();
        worktreePaths.forEach(relativePath => {
            const absolutePath = path.resolve(cwd, relativePath);
            delete config.projects[absolutePath];
        });

        fs.writeFileSync(claudeJsonPath, JSON.stringify(config, null, 2));
    } catch (e) {
        // Silent fail on cleanup
    }
}

/**
 * Pre-seed Codex project trust so worktrees can load project-level config.
 * Adds paths as trusted in ~/.codex/config.toml.
 * @param {string[]} [extraPaths] - Additional paths to trust (e.g. worktree directories)
 */
function presetCodexTrust(extraPaths) {
    const codexConfigPath = path.join(os.homedir(), '.codex', 'config.toml');
    try {
        let config = '';
        if (fs.existsSync(codexConfigPath)) {
            config = fs.readFileSync(codexConfigPath, 'utf8');
        }

        const pathsToTrust = [process.cwd(), ...(extraPaths || [])].map(p => path.resolve(p));
        let added = false;

        for (const trustPath of pathsToTrust) {
            const entry = `[projects."${trustPath}"]`;
            if (config.includes(entry)) continue;
            if (config.length > 0 && !config.endsWith('\n')) config += '\n';
            config += `\n${entry}\ntrust_level = "trusted"\n`;
            added = true;
        }

        if (added) {
            _safeWrite(codexConfigPath, config);
            console.log(`\uD83D\uDD13 Pre-seeded Codex project trust for ${pathsToTrust.length} path(s)`);
        }
    } catch (e) {
        console.warn(`\u26A0\uFE0F  Could not pre-seed Codex trust: ${e.message}`);
    }
}

/**
 * Pre-seed Gemini CLI workspace trust for worktree directories.
 * Gemini stores trust in ~/.gemini/trustedFolders.json as { path: "TRUST_FOLDER" }.
 * Without this, each new worktree triggers an interactive trust dialog.
 * @param {string[]} worktreePaths - Array of worktree paths
 */
function presetGeminiTrust(worktreePaths) {
    const trustFilePath = path.join(os.homedir(), '.gemini', 'trustedFolders.json');
    try {
        let trusted = {};
        if (fs.existsSync(trustFilePath)) {
            trusted = JSON.parse(fs.readFileSync(trustFilePath, 'utf8'));
        }

        let changed = false;
        worktreePaths.forEach(relativePath => {
            const absolutePath = path.resolve(process.cwd(), relativePath);
            if (!trusted[absolutePath]) {
                trusted[absolutePath] = 'TRUST_FOLDER';
                changed = true;
            }
        });

        // Also trust the parent worktrees directory
        if (worktreePaths.length > 0) {
            const parentDir = path.dirname(path.resolve(process.cwd(), worktreePaths[0]));
            if (!trusted[parentDir]) {
                trusted[parentDir] = 'TRUST_PARENT';
                changed = true;
            }
        }

        if (changed) {
            const geminiDir = path.join(os.homedir(), '.gemini');
            if (!fs.existsSync(geminiDir)) fs.mkdirSync(geminiDir, { recursive: true });
            fs.writeFileSync(trustFilePath, JSON.stringify(trusted, null, 2));
            console.log(`\uD83D\uDD13 Pre-seeded Gemini CLI workspace trust for worktree(s)`);
        }
    } catch (e) {
        console.warn(`\u26A0\uFE0F  Could not pre-seed Gemini trust: ${e.message}`);
    }
}

function installAgentGitAttribution(worktreePath, agentId, agentName) {
    const normalizedAgentId = String(agentId || '').trim().toLowerCase();
    if (!normalizedAgentId) return;
    const normalizedAgentName = String(agentName || normalizedAgentId).trim();
    const agentEmail = `${normalizedAgentId}@aigon.dev`;
    const hooksDir = path.join(worktreePath, '.aigon', 'git-hooks');
    if (!fs.existsSync(hooksDir)) fs.mkdirSync(hooksDir, { recursive: true });

    // Preserve existing hooks (e.g. .githooks/pre-commit security hook) so
    // overriding core.hooksPath doesn't silently disable them.
    const existingHooksDirs = ['.githooks', '.git/hooks'].map(d => path.join(worktreePath, d));
    for (const srcDir of existingHooksDirs) {
        if (!fs.existsSync(srcDir)) continue;
        try {
            const entries = fs.readdirSync(srcDir).filter(f => !f.endsWith('.sample'));
            for (const entry of entries) {
                const srcPath = path.join(srcDir, entry);
                const destPath = path.join(hooksDir, entry);
                // Don't overwrite hooks we're about to create
                if (entry === 'prepare-commit-msg' || entry === 'post-commit') continue;
                if (!fs.existsSync(destPath) && fs.statSync(srcPath).isFile()) {
                    fs.copyFileSync(srcPath, destPath);
                    fs.chmodSync(destPath, 0o755);
                }
            }
        } catch (_) {}
        break; // Use the first existing hooks dir found
    }

    const prepareCommitMsgHookPath = path.join(hooksDir, 'prepare-commit-msg');
    const postCommitHookPath = path.join(hooksDir, 'post-commit');

    const prepareCommitMsgHook = `#!/bin/sh
set -eu

MESSAGE_FILE="$1"
AGENT_ID="$(git config --get aigon.agentId || true)"
AGENT_NAME="$(git config --get aigon.agentName || true)"
AGENT_EMAIL="$(git config --get aigon.agentEmail || true)"

[ -n "$AGENT_ID" ] || exit 0
[ -n "$AGENT_NAME" ] || AGENT_NAME="$AGENT_ID"
[ -n "$AGENT_EMAIL" ] || AGENT_EMAIL="$AGENT_ID@aigon.dev"
[ -f "$MESSAGE_FILE" ] || exit 0

git interpret-trailers --in-place \\
  --if-exists addIfDifferent \\
  --if-missing add \\
  --trailer "Aigon-Agent-ID: $AGENT_ID" \\
  --trailer "Co-authored-by: $AGENT_NAME <$AGENT_EMAIL>" \\
  "$MESSAGE_FILE" >/dev/null 2>&1 || true
`;

    const postCommitHook = `#!/bin/sh
set -eu

AGENT_ID="$(git config --get aigon.agentId || true)"
AGENT_NAME="$(git config --get aigon.agentName || true)"
AGENT_EMAIL="$(git config --get aigon.agentEmail || true)"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"

[ -n "$AGENT_ID" ] || exit 0
[ -n "$AGENT_NAME" ] || AGENT_NAME="$AGENT_ID"
[ -n "$AGENT_EMAIL" ] || AGENT_EMAIL="$AGENT_ID@aigon.dev"

SHA="$(git rev-parse HEAD 2>/dev/null || true)"
[ -n "$SHA" ] || exit 0

git notes --ref=refs/notes/aigon-attribution add -f -m "aigon.agent_id=$AGENT_ID
aigon.agent_name=$AGENT_NAME
aigon.agent_email=$AGENT_EMAIL
aigon.branch=$BRANCH
aigon.authorship=ai-authored" "$SHA" >/dev/null 2>&1 || true
`;

    fs.writeFileSync(prepareCommitMsgHookPath, prepareCommitMsgHook);
    fs.writeFileSync(postCommitHookPath, postCommitHook);
    fs.chmodSync(prepareCommitMsgHookPath, 0o755);
    fs.chmodSync(postCommitHookPath, 0o755);

    try {
        const wt = shellQuote(worktreePath);
        execSync(`git -C ${wt} config --local user.name ${shellQuote(normalizedAgentName)}`, { stdio: 'pipe' });
        execSync(`git -C ${wt} config --local user.email ${shellQuote(agentEmail)}`, { stdio: 'pipe' });
        execSync(`git -C ${wt} config --local aigon.agentId ${shellQuote(normalizedAgentId)}`, { stdio: 'pipe' });
        execSync(`git -C ${wt} config --local aigon.agentName ${shellQuote(normalizedAgentName)}`, { stdio: 'pipe' });
        execSync(`git -C ${wt} config --local aigon.agentEmail ${shellQuote(agentEmail)}`, { stdio: 'pipe' });
        execSync(`git -C ${wt} config --local core.hooksPath ${shellQuote('.aigon/git-hooks')}`, { stdio: 'pipe' });
        execSync(`git -C ${wt} config --local notes.rewriteRef ${shellQuote('refs/notes/aigon-attribution')}`, { stdio: 'pipe' });
        execSync(`git -C ${wt} config --local notes.rewriteMode ${shellQuote('concatenate')}`, { stdio: 'pipe' });
    } catch (e) {
        console.warn(`   ⚠️  Could not fully configure git attribution in worktree: ${e.message}`);
    }
}

function setupWorktreeEnvironment(worktreePath, options) {
    const {
        featureId,
        agentId,
        desc,
        profile,
        logsDirPath
    } = options;

    const envLocalPath = path.join(process.cwd(), '.env.local');
    const AGENT_CONFIGS = _getAgentConfigs();
    const agentMeta = AGENT_CONFIGS[agentId] || {};
    const paddedFeatureId = String(featureId).padStart(2, '0');

    installAgentGitAttribution(worktreePath, agentId, agentMeta.name || agentId);
    console.log(`   🏷️  Git attribution enabled (${agentId}@aigon.dev, trailers + notes)`);

    // Always write PORT to .env.local — agents must never fall back to port 3000
    {
        const port = profile.devServer.ports[agentId] || agentMeta.port;
        const appId = _getAppId();
        const serverId = `${agentId}-${featureId}`;
        const devUrl = _getDevProxyUrl(appId, serverId);
        let envContent = '';
        if (fs.existsSync(envLocalPath)) {
            envContent = fs.readFileSync(envLocalPath, 'utf8').trimEnd() + '\n\n';
        }
        envContent += `# Fleet config for agent ${agentId}\n`;
        if (port) envContent += `PORT=${port}\n`;
        envContent += `AIGON_AGENT_NAME=${agentMeta.name || agentId}\n`;
        envContent += `AIGON_BANNER_COLOR=${agentMeta.bannerColor || '#888888'}\n`;
        envContent += `AIGON_FEATURE_ID=${paddedFeatureId}\n`;
        if (devUrl) envContent += `AIGON_DEV_URL=${devUrl}\n`;
        envContent += `NEXT_PUBLIC_AIGON_AGENT_NAME=${agentMeta.name || agentId}\n`;
        envContent += `NEXT_PUBLIC_AIGON_BANNER_COLOR=${agentMeta.bannerColor || '#888888'}\n`;
        envContent += `NEXT_PUBLIC_AIGON_FEATURE_ID=${paddedFeatureId}\n`;
        if (devUrl) envContent += `NEXT_PUBLIC_AIGON_DEV_URL=${devUrl}\n`;
        // Worktree-isolated dashboard port — prevents conflicts with main dashboard on 4100
        const wtBranchName = path.basename(worktreePath);
        const dashboardPort = _hashBranchToPort(wtBranchName);
        envContent += `DASHBOARD_PORT=${dashboardPort}\n`;
        fs.writeFileSync(path.join(worktreePath, '.env.local'), envContent);
        console.log(`   \uD83D\uDCCB .env.local created${port ? ` with PORT=${port}` : ''}, DASHBOARD_PORT=${dashboardPort}, banner vars${devUrl ? ', dev URL' : ''}`);
    }

    // Run worktree setup command if configured — installs deps so agents don't burn tokens.
    // Set via .aigon/config.json: { "worktreeSetup": "npm install" }
    // or per-profile defaults. Skips silently if not configured.
    {
        const setupCmd = profile.worktreeSetup || null;
        if (setupCmd) {
            try {
                console.log(`   📦 Running worktree setup...`);
                execSync(setupCmd, { cwd: worktreePath, stdio: ['ignore', 'ignore', 'pipe'], timeout: 120000 });
                console.log(`   ✅ Worktree setup complete`);
            } catch (e) {
                console.warn(`   ⚠️  Worktree setup failed (agent will retry): ${e.message.split('\n')[0]}`);
            }
        }
    }

    // Agent commands are already committed in git — the worktree inherits them
    // from the branch. Do NOT run install-agent here — it overwrites files with
    // potentially different versions, causing merge conflicts on feature-close.

    // Write worktree.json so agent-status can resolve the main repo path
    const aigonDir = path.join(worktreePath, '.aigon');
    if (!fs.existsSync(aigonDir)) fs.mkdirSync(aigonDir, { recursive: true });
    fs.writeFileSync(path.join(aigonDir, 'worktree.json'), JSON.stringify({ mainRepo: process.cwd() }, null, 2));

    // Pre-register worktree as trusted for Gemini CLI to avoid interactive trust prompts
    if (agentId === 'gg') {
        const trustedFoldersPath = path.join(os.homedir(), '.gemini', 'trustedFolders.json');
        try {
            let trusted = {};
            if (fs.existsSync(trustedFoldersPath)) {
                trusted = JSON.parse(fs.readFileSync(trustedFoldersPath, 'utf8'));
            }
            if (!trusted[worktreePath]) {
                trusted[worktreePath] = 'TRUST_FOLDER';
                fs.writeFileSync(trustedFoldersPath, JSON.stringify(trusted, null, 4));
                console.log(`   🔓 Pre-registered Gemini trusted folder`);
            }
        } catch (e) { /* non-fatal */ }
    }

    // Ensure runtime/generated files are gitignored in the worktree
    const gitignorePath = path.join(worktreePath, '.gitignore');
    const ignoreEntries = ['.aigon/worktree.json', '.aigon/state/', '.aigon/locks/', 'next-env.d.ts'];
    let gitignoreContent = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
    let added = false;
    for (const entry of ignoreEntries) {
        if (!gitignoreContent.split('\n').some(l => l.trim() === entry)) {
            if (!gitignoreContent.endsWith('\n') && gitignoreContent.length > 0) gitignoreContent += '\n';
            gitignoreContent += `${entry}\n`;
            added = true;
        }
    }
    if (added) fs.writeFileSync(gitignorePath, gitignoreContent);

    if (!fs.existsSync(logsDirPath)) {
        fs.mkdirSync(logsDirPath, { recursive: true });
    }
    const logName = `feature-${featureId}-${agentId}-${desc}-log.md`;
    const logPath = path.join(logsDirPath, logName);
    const template = `# Implementation Log: Feature ${featureId} - ${desc}\nAgent: ${agentId}\n\n## Plan\n\n## Progress\n\n## Decisions\n`;
    fs.writeFileSync(logPath, template);
    console.log(`   \uD83D\uDCDD Log: docs/specs/features/logs/${logName}`);

    // Commit ALL worktree setup files so agents start with a clean working tree
    try {
        execSync(`git add -A && git commit -m "chore: worktree setup for ${agentId}"`, { cwd: worktreePath, stdio: 'pipe' });
    } catch (e) { /* nothing to commit */ }
}

function ensureAgentSessions(entityId, agents, options) {
    const {
        sessionNameBuilder,
        cwdBuilder,
        commandBuilder
    } = options;

    return agents.map(agent => {
        const sessionName = sessionNameBuilder(entityId, agent);
        if (tmuxSessionExists(sessionName)) {
            return { agent, sessionName, created: false, error: null };
        }
        try {
            createDetachedTmuxSession(sessionName, cwdBuilder(entityId, agent));
            const command = commandBuilder ? commandBuilder(entityId, agent) : null;
            if (command) {
                spawnSync('tmux', ['send-keys', '-t', sessionName, command, 'Enter'], { stdio: 'pipe' });
            }
            return { agent, sessionName, created: true, error: null };
        } catch (error) {
            return { agent, sessionName, created: false, error };
        }
    });
}

/**
 * Gracefully shut down all tmux sessions for a feature or research ID.
 *
 * 1. Capture CC telemetry from transcripts (CC-specific, before shutdown)
 * 2. Send Ctrl+C to each session (graceful exit for any agent)
 * 3. Wait for sessions to exit
 * 4. Force-kill any survivors
 *
 * @param {string} entityId - Feature or research ID (e.g. "01", "5")
 * @param {string} entityType - 'f' for feature, 'r' for research
 * @param {Object} [options]
 * @param {string} [options.repoPath] - Repo path for telemetry resolution
 * @param {string} [options.featureDesc] - Feature description slug
 * @param {number} [options.gracePeriodMs=4000] - Time to wait for graceful exit
 */
function gracefullyCloseEntitySessions(entityId, entityType, options = {}) {
    const gracePeriodMs = options.gracePeriodMs || 4000;

    // Find all matching tmux sessions
    const tmuxList = runTmux(['list-sessions', '-F', '#{session_name}'], { encoding: 'utf8' });
    if (tmuxList.error || tmuxList.status !== 0) return { closed: 0 };

    const allSessions = tmuxList.stdout.split('\n').map(s => s.trim()).filter(Boolean);
    const matching = allSessions.filter(s => {
        const parsed = parseTmuxSessionName(s);
        return parsed && parsed.type === entityType && toUnpaddedId(parsed.id) === toUnpaddedId(entityId);
    });

    if (matching.length === 0) return { closed: 0 };

    // Step 1: Capture CC telemetry before shutdown (best-effort)
    if (options.repoPath) {
        try {
            const telemetry = require('./telemetry');
            matching.forEach(sessionName => {
                const parsed = parseTmuxSessionName(sessionName);
                if (!parsed || parsed.agent !== 'cc') return;
                const transcripts = telemetry.findTranscriptFiles(entityId, options.featureDesc || '', {
                    agentId: 'cc',
                    repoPath: options.repoPath,
                });
                // captureSessionTelemetry is per-file; feature-close handles batch capture
                // We just ensure transcripts are findable — the close command captures them.
            });
        } catch (e) { /* telemetry is best-effort */ }
    }

    // Step 2: Send Ctrl+C to each session for graceful agent shutdown
    matching.forEach(sessionName => {
        runTmux(['send-keys', '-t', sessionName, 'C-c', ''], { stdio: 'ignore' });
    });

    // Step 3: Wait for graceful shutdown
    const deadline = Date.now() + gracePeriodMs;
    while (Date.now() < deadline) {
        const stillAlive = matching.filter(s => tmuxSessionExists(s));
        if (stillAlive.length === 0) break;
        spawnSync('sleep', ['0.5'], { stdio: 'ignore' });
    }

    // Step 4: Force-kill any survivors
    let closed = 0;
    matching.forEach(sessionName => {
        if (!tmuxSessionExists(sessionName)) {
            closed++;
            return;
        }
        const kill = runTmux(['kill-session', '-t', sessionName], { stdio: 'ignore' });
        if (!kill.error && kill.status === 0) closed++;
    });

    return { closed, sessions: matching };
}

module.exports = {
    getWorktreeBase,
    findWorktrees,
    filterByFeatureId,
    buildAgentCommand,
    buildRawAgentCommand,
    getAgentSignalCapabilities,
    buildResearchAgentCommand,
    toUnpaddedId,
    buildTmuxSessionName,
    buildResearchTmuxSessionName,
    parseTmuxSessionName,
    matchTmuxSessionByEntityId,
    assertTmuxAvailable,
    tmuxSessionExists,
    createDetachedTmuxSession,
    isTmuxSessionAttached,
    shellQuote,
    openTerminalAppWithCommand,
    ensureTmuxSessionForWorktree,
    openInWarpSplitPanes,
    closeWarpWindow,
    openSingleWorktree,
    addWorktreePermissions,
    removeWorktreePermissions,
    presetWorktreeTrust,
    removeWorktreeTrust,
    presetCodexTrust,
    presetGeminiTrust,
    setupWorktreeEnvironment,
    ensureAgentSessions,
    getEnrichedSessions,
    tileITerm2Windows,
    runTmux,
    gracefullyCloseEntitySessions,
};
