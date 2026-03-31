'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync, spawn } = require('child_process');
const git = require('./git');
const stateMachine = require('./state-queries');

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
    const cdPrefix = wt.path ? `cd ${shellQuote(path.resolve(wt.path))} && ` : '';

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

function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

// ---------------------------------------------------------------------------
// cmux detection and helpers
// ---------------------------------------------------------------------------

/**
 * Check whether the cmux binary is available on PATH.
 */
function isCmuxAvailable() {
    try {
        execSync('which cmux', { stdio: 'pipe' });
        return true;
    } catch { return false; }
}

/**
 * Check whether the cmux socket is active (i.e. cmux is running).
 */
function isCmuxRunning() {
    const socketPath = process.env.CMUX_SOCKET_PATH || '/tmp/cmux.sock';
    try { return fs.existsSync(socketPath); } catch { return false; }
}

/**
 * Execute a cmux CLI command. Opportunistic — never throws.
 * cmux enhancements are best-effort; failures are silently ignored.
 */
function cmuxExec(args) {
    try {
        execSync(`cmux ${args}`, { stdio: 'pipe', timeout: 5000 });
    } catch {
        // Silent — cmux enhancements are best-effort
    }
}

/**
 * Create a new cmux workspace with the given name and command.
 */
function cmuxNewWorkspace(name, command) {
    cmuxExec(`new-workspace --name ${shellQuote(name)} --command ${shellQuote(command)}`);
}

/**
 * Update cmux sidebar metadata for the current workspace.
 * @param {string} key - Status key (e.g. 'stage', 'feature', 'agent')
 * @param {string} value - Status value
 * @param {object} [opts] - Optional icon and color
 */
function cmuxSetStatus(key, value, opts = {}) {
    let args = `set-status ${shellQuote(key)} ${shellQuote(value)}`;
    if (opts.icon) args += ` --icon ${shellQuote(opts.icon)}`;
    if (opts.color) args += ` --color ${shellQuote(opts.color)}`;
    cmuxExec(args);
}

/**
 * Fire a cmux desktop notification.
 */
function cmuxNotify(title, body) {
    cmuxExec(`notify --title ${shellQuote(title)} --body ${shellQuote(body)}`);
}

/**
 * Set cmux workspace progress bar (0.0 to 1.0).
 */
function cmuxSetProgress(fraction) {
    cmuxExec(`set-progress ${fraction}`);
}

// ---------------------------------------------------------------------------
// Linux terminal detection
// ---------------------------------------------------------------------------

/**
 * Detect an available Linux terminal emulator.
 * Checks in preference order: user-configured, kitty, gnome-terminal, xterm.
 * Returns the binary name or null if none found.
 */
function detectLinuxTerminal(preferredTerminal) {
    const candidates = preferredTerminal
        ? [preferredTerminal, 'kitty', 'gnome-terminal', 'xterm']
        : ['kitty', 'gnome-terminal', 'xterm'];
    for (const term of candidates) {
        try {
            execSync(`which ${term}`, { stdio: 'pipe' });
            return term;
        } catch { /* not found, try next */ }
    }
    return null;
}

/**
 * Build the spawn arguments to launch a Linux terminal emulator with a given command.
 * Returns [binary, ...args].
 */
function buildLinuxTerminalSpawnArgs(terminal, cmdToRun, title) {
    switch (terminal) {
        case 'kitty':
            return title
                ? ['kitty', '--title', title, 'bash', '-lc', cmdToRun]
                : ['kitty', 'bash', '-lc', cmdToRun];
        case 'gnome-terminal':
            return title
                ? ['gnome-terminal', '--title', title, '--', 'bash', '-lc', cmdToRun]
                : ['gnome-terminal', '--', 'bash', '-lc', cmdToRun];
        case 'xterm':
            return title
                ? ['xterm', '-T', title, '-e', 'bash', '-lc', cmdToRun]
                : ['xterm', '-e', 'bash', '-lc', cmdToRun];
        default:
            return [terminal, '-e', 'bash', '-lc', cmdToRun];
    }
}

function openTerminalAppWithCommand(cwd, command, title) {
    // --- Linux path ---
    if (process.platform === 'linux') {
        const effectiveConfig = _getEffectiveConfig();
        const preferredTerminal = effectiveConfig.linuxTerminal || null;

        // If session is already attached, skip
        if (title && isTmuxSessionAttached(title)) {
            console.log(`   ℹ️  Session "${title}" is already attached in another terminal.`);
            return;
        }

        const terminal = detectLinuxTerminal(preferredTerminal);
        if (terminal) {
            const fullCommand = `cd ${shellQuote(cwd)} && ${command}`;
            const spawnArgs = buildLinuxTerminalSpawnArgs(terminal, fullCommand, title);
            const bin = spawnArgs.shift();
            const child = spawn(bin, spawnArgs, { stdio: 'ignore', detached: true });
            child.unref();
            return;
        }

        // Fallback: print the command for the user to run manually
        console.log(`\n📋 No GUI terminal found. Run this command manually:`);
        console.log(`   cd ${cwd} && ${command}\n`);
        return;
    }

    // --- macOS path (existing behavior) ---
    const effectiveConfig = _getEffectiveConfig();
    const tmuxApp = effectiveConfig.tmuxApp || 'terminal';

    if (tmuxApp === 'iterm2') {
        // iTerm2: regular tmux attach (no -CC control mode — it causes raw protocol garbage)
        // Note: skip cd — the tmux session already has its working directory set

        // If the target tmux session is already attached anywhere, try to focus its
        // specific iTerm2 window/tab rather than just activating the app.
        if (title && isTmuxSessionAttached(title)) {
            const escapedTitle = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            const focusScript = [
                'tell application "iTerm2"',
                `  repeat with w in windows`,
                `    repeat with t in tabs of w`,
                `      repeat with s in sessions of t`,
                `        if name of s is "${escapedTitle}" then`,
                `          select t`,
                `          set index of w to 1`,
                `          activate`,
                `          return "found"`,
                `        end if`,
                `      end repeat`,
                `    end repeat`,
                `  end repeat`,
                'end tell',
                'return "not found"'
            ].join('\n');
            const focusResult = spawnSync('osascript', ['-e', focusScript], { stdio: 'pipe', encoding: 'utf8' });
            if (focusResult.stdout && focusResult.stdout.trim() === 'found') {
                return; // Existing window brought to front
            }
            // Fallback: just activate iTerm2 if we couldn't find the specific window
            spawnSync('osascript', ['-e', 'tell application "iTerm2" to activate'], { stdio: 'ignore' });
            return;
        }

        // If the session is already attached in an iTerm2 window, raise that window instead
        // of creating a duplicate. We detect this by checking tmux clients and matching the
        // title against iTerm2 windows.
        if (title) {
            const escapedTitle = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            const focusScript = [
                'tell application "iTerm2"',
                `  repeat with w in windows`,
                `    repeat with t in tabs of w`,
                `      repeat with s in sessions of t`,
                `        if name of s is "${escapedTitle}" then`,
                `          select t`,
                `          set index of w to 1`,
                `          activate`,
                `          return "found"`,
                `        end if`,
                `      end repeat`,
                `    end repeat`,
                `  end repeat`,
                'end tell',
                'return "not found"'
            ].join('\n');
            const focusResult = spawnSync('osascript', ['-e', focusScript], { stdio: 'pipe', encoding: 'utf8' });
            if (focusResult.stdout && focusResult.stdout.trim() === 'found') {
                return; // Existing window brought to front — no new window needed
            }
        }

        // iTerm2's "create window with default profile command" uses execvp which does NOT
        // search $PATH, so we must resolve the absolute path to any binary in the command.
        // For tmux specifically, use resolveTmuxBinary() which has hardcoded paths as fallback
        // (the daemon's PATH may not include /opt/homebrew/bin).
        const resolvedCommand = command.replace(/^(\S+)/, (bin) => {
            if (bin === 'tmux') {
                const resolved = resolveTmuxBinary();
                if (resolved) return resolved;
            }
            try { return execSync(`which ${bin}`, { encoding: 'utf8' }).trim(); } catch { return bin; }
        });
        const escapedCommand = resolvedCommand.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const titleLines = title
            ? [`set name of current session of current window to "${title.replace(/"/g, '\\"')}"`, '']
            : [];
        const appleScript = [
            'tell application "iTerm2"',
            'activate',
            `create window with default profile command "${escapedCommand}"`,
            ...titleLines,
            'end tell'
        ].join('\n');
        const result = spawnSync('osascript', ['-e', appleScript], { stdio: 'pipe' });
        if (result.error || result.status !== 0) {
            const errMsg = result.stderr ? result.stderr.toString().trim() : 'unknown error';
            throw new Error(`Failed to open iTerm2: ${errMsg}. Is iTerm2 installed?`);
        }
    } else {
        // Default: Terminal.app

        // If a window with this title already exists, bring it to front instead of creating a duplicate
        if (title) {
            const focusScript = [
                'tell application "Terminal"',
                `  repeat with w in windows`,
                `    if custom title of selected tab of w is ${JSON.stringify(title)} then`,
                `      set index of w to 1`,
                `      set frontmost to true`,
                `      activate`,
                `      return "found"`,
                `    end if`,
                `  end repeat`,
                'end tell',
                'return "not found"'
            ].join('\n');
            const focusResult = spawnSync('osascript', ['-e', focusScript], { stdio: 'pipe', encoding: 'utf8' });
            if (focusResult.stdout && focusResult.stdout.trim() === 'found') {
                return; // Existing window brought to front — no new window needed
            }
        }

        const fullCommand = `cd ${shellQuote(cwd)} && ${command}`;
        const titleLines = title
            ? [
                `set custom title of selected tab of front window to ${JSON.stringify(title)}`,
                'set title displays custom title of selected tab of front window to true'
            ]
            : [];
        const appleScript = [
            'tell application "Terminal"',
            'activate',
            `do script ${JSON.stringify(fullCommand)}`,
            ...titleLines,
            'end tell'
        ].join('\n');
        const result = spawnSync('osascript', ['-e', appleScript], { stdio: 'ignore' });
        if (result.error || result.status !== 0) {
            throw new Error('Failed to open Terminal.app and run command');
        }
    }
}

/**
 * Tile all iTerm2 windows into an optimal grid, grouped by session name prefix.
 * Windows with related titles (same repo + feature/research) are placed adjacent.
 * Layout: 3 columns, rows split evenly. Adjusts if fewer windows.
 */
function tileITerm2Windows() {
    if (process.platform === 'linux') {
        console.log('ℹ️  Window tiling is not available on Linux. Use tmux pane layout instead:');
        console.log('   tmux select-layout tiled');
        return;
    }
    // Step 1: Get all iTerm2 window IDs and session names via AppleScript
    const getWindowsScript = `
tell application "iTerm2"
    set output to ""
    repeat with w in windows
        set wId to id of w
        set wName to ""
        try
            set wName to name of current session of current tab of w
        end try
        set output to output & wId & "|||" & wName & "\\n"
    end repeat
    return output
end tell
`;
    const result = spawnSync('osascript', ['-e', getWindowsScript], { encoding: 'utf8', stdio: 'pipe' });
    if (result.error || result.status !== 0) {
        throw new Error('Failed to query iTerm2 windows. Is iTerm2 running?');
    }

    const windows = result.stdout.trim().split('\n')
        .map(line => {
            const [id, name] = line.split('|||');
            return { id: id ? id.trim() : '', name: name ? name.trim() : '' };
        })
        .filter(w => w.id);

    if (windows.length === 0) {
        console.log('No iTerm2 windows found.');
        return;
    }

    // Step 2: Parse session name into sortable parts
    // Patterns: "repo-f45-cc-desc" or "repo-r9-cc"
    const AGENT_ORDER = { cc: 0, cx: 1, gg: 2 };
    function parseName(name) {
        const m = name.match(/^(.+)-([fr])(\d+)-([a-z]{2})/);
        if (m) return { repo: m[1], type: m[2], id: Number(m[3]), agent: m[4] };
        return { repo: name || '~ungrouped', type: 'z', id: 0, agent: '' };
    }

    // Sort: repo → feature/research type+id → agent (cc, cx, gg)
    windows.sort((a, b) => {
        const pa = parseName(a.name);
        const pb = parseName(b.name);
        if (pa.repo !== pb.repo) return pa.repo.localeCompare(pb.repo);
        if (pa.type !== pb.type) return pa.type.localeCompare(pb.type);
        if (pa.id !== pb.id) return pa.id - pb.id;
        const ao = AGENT_ORDER[pa.agent] ?? 99;
        const bo = AGENT_ORDER[pb.agent] ?? 99;
        return ao - bo;
    });

    // Step 3: Calculate grid layout
    const count = windows.length;
    const cols = Math.min(count, 3);
    const rows = Math.ceil(count / cols);

    // Step 4: Get screen dimensions for the screen containing the front iTerm2 window.
    // Uses JXA to read the front window's position, then finds the matching NSScreen
    // visible frame (excludes menu bar and dock).
    const screenScript = `
ObjC.import('AppKit');
ObjC.import('CoreGraphics');

// Get front iTerm2 window bounds
var app = Application('iTerm2');
var frontBounds = app.windows[0].bounds();
var winMidX = frontBounds.x + frontBounds.width / 2;
var winMidY = frontBounds.y + frontBounds.height / 2;

// Find which screen contains the window center
var screens = $.NSScreen.screens;
var count = screens.count;
var primaryHeight = $.NSScreen.screens.objectAtIndex(0).frame.size.height;

var bestX = 0, bestY = 0, bestW = 2560, bestH = 1400;
for (var i = 0; i < count; i++) {
    var scr = screens.objectAtIndex(i);
    var frame = scr.frame;
    // NSScreen uses bottom-left origin; convert to top-left for comparison with window bounds
    var tlX = frame.origin.x;
    var tlY = primaryHeight - frame.origin.y - frame.size.height;
    var tlX2 = tlX + frame.size.width;
    var tlY2 = tlY + frame.size.height;
    if (winMidX >= tlX && winMidX < tlX2 && winMidY >= tlY && winMidY < tlY2) {
        // Use visibleFrame to exclude menu bar and dock
        var vis = scr.visibleFrame;
        bestX = vis.origin.x;
        // Convert visibleFrame (bottom-left origin) to top-left origin
        bestY = primaryHeight - vis.origin.y - vis.size.height;
        bestW = vis.size.width;
        bestH = vis.size.height;
        break;
    }
}
bestX + ',' + bestY + ',' + bestW + ',' + bestH;
`;
    const screenResult = spawnSync('osascript', ['-l', 'JavaScript', '-e', screenScript], { encoding: 'utf8', stdio: 'pipe' });
    let screenX = 0, screenY = 25, screenW = 2560, screenH = 1415;
    if (screenResult.stdout) {
        const parts = screenResult.stdout.trim().split(',').map(Number);
        if (parts.length === 4 && parts.every(n => !isNaN(n))) {
            screenX = parts[0];
            screenY = parts[1];
            screenW = parts[2];
            screenH = parts[3];
        }
    }

    // Step 5: Position each window
    const cellW = Math.floor(screenW / cols);
    const cellH = Math.floor(screenH / rows);

    const positionLines = windows.map((w, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x1 = screenX + col * cellW;
        const y1 = screenY + row * cellH;
        const x2 = x1 + cellW;
        const y2 = y1 + cellH;
        return `
            repeat with w in windows
                if id of w is ${w.id} then
                    set bounds of w to {${x1}, ${y1}, ${x2}, ${y2}}
                end if
            end repeat`;
    }).join('\n');

    const tileScript = `
tell application "iTerm2"
${positionLines}
end tell
`;
    const tileResult = spawnSync('osascript', ['-e', tileScript], { encoding: 'utf8', stdio: 'pipe' });
    if (tileResult.error || tileResult.status !== 0) {
        const errMsg = tileResult.stderr ? tileResult.stderr.trim() : 'unknown error';
        throw new Error(`Failed to tile iTerm2 windows: ${errMsg}`);
    }

    console.log(`\u2705 Tiled ${count} iTerm2 window${count === 1 ? '' : 's'} into ${cols}\xd7${rows} grid`);
}

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

/**
 * Open multiple worktrees side-by-side in Warp using split panes.
 * @param {Array<{path: string, agent: string, desc: string, featureId: string, agentCommand: string}>} worktreeConfigs
 * @param {string} configName - Warp launch config name
 * @param {string} title - Tab title for the Warp window
 * @param {string} [tabColor] - Optional Warp tab ANSI color (Red, Green, Yellow, Blue, Magenta, Cyan)
 */
function openInWarpSplitPanes(worktreeConfigs, configName, title, tabColor) {
    if (process.platform === 'linux') {
        console.log('⚠️  Warp is not available on Linux. Use tmux to attach to agent sessions instead.');
        worktreeConfigs.forEach(wt => {
            const sessionName = buildTmuxSessionName(wt.featureId, wt.agent, { desc: wt.desc, worktreePath: wt.path });
            console.log(`   tmux attach -t ${sessionName}`);
        });
        return null;
    }
    const warpConfigDir = path.join(os.homedir(), '.warp', 'launch_configurations');
    const configFile = path.join(warpConfigDir, `${configName}.yaml`);

    const AGENT_CONFIGS = _getAgentConfigs();
    const panes = worktreeConfigs.map(wt => {
        const commands = [];

        // Set pane title using ANSI escape sequence (for individual pane identification)
        if (wt.agent) {
            const agentConfig = AGENT_CONFIGS[wt.agent] || {};
            const agentName = agentConfig.name || wt.agent;
            const paneTitle = wt.researchId
                ? `Research #${wt.researchId} - ${agentName}`
                : wt.featureId
                    ? `Feature #${String(wt.featureId).padStart(2, '0')} - ${agentName}`
                    : agentName;
            commands.push(`                  - exec: 'echo -ne "\\033]0;${paneTitle}\\007"'`);
        }

        if (wt.portLabel) {
            commands.push(`                  - exec: 'echo "\\n${wt.portLabel}\\n"'`);
        }
        commands.push(`                  - exec: '${wt.agentCommand}'`);
        return `              - cwd: "${wt.path}"\n                commands:\n${commands.join('\n')}`;
    }).join('\n');

    const colorLine = tabColor ? `\n        color: ${tabColor}` : '';
    const yamlContent = `---
name: ${configName}
windows:
  - tabs:
      - title: "${title}"${colorLine}
        layout:
          split_direction: horizontal
          panes:
${panes}
`;

    if (!fs.existsSync(warpConfigDir)) {
        fs.mkdirSync(warpConfigDir, { recursive: true });
    }
    fs.writeFileSync(configFile, yamlContent);
    execSync(`open "warp://launch/${configName}"`);

    return configFile;
}

/**
 * Close a Warp window whose tab title contains the given hint.
 * Returns true if AppleScript executed without error (window found + closed).
 */
function closeWarpWindow(titleHint) {
    if (process.platform === 'linux') return false;
    try {
        execSync(
            `osascript -e 'try' -e 'tell application "Warp" to close (first window whose name contains "${titleHint}")' -e 'end try'`,
            { stdio: 'ignore' }
        );
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Open multiple worktrees side-by-side in cmux using split panes.
 * Parallel to openInWarpSplitPanes() but using the cmux workspace/split API.
 * @param {Array<{path: string, agent: string, desc: string, featureId: string, agentCommand: string}>} worktreeConfigs
 * @param {string} workspaceName - cmux workspace name
 * @param {string} title - Human-readable title
 */
function openInCmuxSplitPanes(worktreeConfigs, workspaceName, title) {
    if (process.platform === 'linux') {
        console.log('\u26A0\uFE0F  cmux is not available on Linux. Use tmux to attach to agent sessions instead.');
        worktreeConfigs.forEach(wt => {
            const sessionName = buildTmuxSessionName(wt.featureId, wt.agent, { desc: wt.desc, worktreePath: wt.path });
            console.log(`   tmux attach -t ${sessionName}`);
        });
        return;
    }
    if (!isCmuxAvailable()) {
        console.log('\u26A0\uFE0F  cmux not found. Falling back to individual tmux sessions.');
        worktreeConfigs.forEach(wt => openSingleWorktree(wt, wt.agentCommand, 'tmux'));
        return;
    }

    // Ensure tmux sessions exist for all agents
    assertTmuxAvailable();
    worktreeConfigs.forEach(wt => {
        ensureTmuxSessionForWorktree(wt, wt.agentCommand);
    });

    // Create workspace with first agent, then split for subsequent agents
    const firstWt = worktreeConfigs[0];
    const firstSession = buildTmuxSessionName(firstWt.featureId, firstWt.agent, { desc: firstWt.desc, worktreePath: firstWt.path });
    cmuxNewWorkspace(workspaceName, `tmux attach -t ${shellQuote(firstSession)}`);

    for (let i = 1; i < worktreeConfigs.length; i++) {
        const wt = worktreeConfigs[i];
        const sessionName = buildTmuxSessionName(wt.featureId, wt.agent, { desc: wt.desc, worktreePath: wt.path });
        cmuxExec(`new-split right --command ${shellQuote(`tmux attach -t ${shellQuote(sessionName)}`)}`);
    }

    // Push metadata to cmux sidebar (opportunistic)
    if (isCmuxRunning()) {
        const paddedId = String(firstWt.featureId).padStart(2, '0');
        cmuxSetStatus('feature', paddedId, { icon: 'tag' });
        cmuxSetStatus('stage', 'fleet', { icon: 'rocket', color: 'cyan' });
    }
}

/**
 * Open a single worktree in the specified terminal.
 */
function openSingleWorktree(wt, agentCommand, terminal) {
    const AGENT_CONFIGS = _getAgentConfigs();

    // On Linux, redirect warp/terminal to tmux, and skip macOS-only Terminal.app
    if (process.platform === 'linux') {
        if (terminal === 'warp') {
            console.log('⚠️  Warp is not available on Linux. Falling back to tmux.');
            terminal = 'tmux';
        } else if (terminal === 'terminal') {
            // Terminal.app is macOS only; fall back to tmux on Linux
            terminal = 'tmux';
        }
    }

    if (terminal === 'warp') {
        const wtBasename = path.basename(wt.path);
        const configName = `worktree-${wtBasename}`;
        const warpConfigDir = path.join(os.homedir(), '.warp', 'launch_configurations');
        const configFile = path.join(warpConfigDir, `${configName}.yaml`);

        const agentMeta = AGENT_CONFIGS[wt.agent] || {};
        const paddedId = String(wt.featureId).padStart(2, '0');
        const profile = _getActiveProfile();
        const port = profile.devServer.enabled
            ? (profile.devServer.ports[wt.agent] || agentMeta.port)
            : null;
        const portSuffix = port ? ` | Port ${port}` : '';
        const tabTitle = `Feature #${paddedId} - ${agentMeta.name || wt.agent}${portSuffix}`;
        const tabColor = agentMeta.terminalColor || 'cyan';

        const yamlContent = `---
name: ${configName}
windows:
  - tabs:
      - title: "${tabTitle}"
        color: ${tabColor}
        layout:
          cwd: "${wt.path}"
          commands:
            - exec: '${agentCommand}'
`;

        try {
            if (!fs.existsSync(warpConfigDir)) {
                fs.mkdirSync(warpConfigDir, { recursive: true });
            }
            fs.writeFileSync(configFile, yamlContent);
            execSync(`open "warp://launch/${configName}"`);

            console.log(`\n\uD83D\uDE80 Opening worktree in Warp:`);
            console.log(`   Feature: ${wt.featureId} - ${wt.desc}`);
            console.log(`   Agent: ${wt.agent}`);
            console.log(`   Path: ${wt.path}`);
            console.log(`   Command: ${agentCommand}`);
        } catch (e) {
            console.error(`\u274C Failed to open Warp: ${e.message}`);
        }
    } else if (terminal === 'terminal') {
        try {
            execSync(`open -a Terminal "${wt.path}"`);

            console.log(`\n\uD83D\uDE80 Opening worktree in Terminal.app:`);
            console.log(`   Feature: ${wt.featureId} - ${wt.desc}`);
            console.log(`   Agent: ${wt.agent}`);
            console.log(`   Path: ${wt.path}`);
            console.log(`\n\uD83D\uDCCB Run this command in the terminal:`);
            console.log(`   ${agentCommand}`);
        } catch (e) {
            console.error(`\u274C Failed to open Terminal.app: ${e.message}`);
        }
    } else if (terminal === 'tmux') {
        try {
            assertTmuxAvailable();
            const { sessionName, created } = ensureTmuxSessionForWorktree(wt, agentCommand);
            openTerminalAppWithCommand(wt.path, `tmux attach -t ${shellQuote(sessionName)}`, sessionName);

            const tmuxAppName = process.platform === 'linux' ? 'tmux'
                : (_getEffectiveConfig().tmuxApp || 'terminal') === 'iterm2' ? 'iTerm2' : 'Terminal.app';
            console.log(`\n\uD83D\uDE80 Opening worktree in tmux via ${tmuxAppName}:`);
            console.log(`   Feature: ${wt.featureId} - ${wt.desc}`);
            console.log(`   Agent: ${wt.agent}`);
            console.log(`   Path: ${wt.path}`);
            console.log(`   Session: ${sessionName}${created ? ' (created)' : ' (attached)'}`);
        } catch (e) {
            console.error(`\u274C Failed to open tmux session: ${e.message}`);
            const installHint = process.platform === 'linux' ? 'sudo apt install tmux  (or yum/pacman equivalent)' : 'brew install tmux';
            console.error(`   Install tmux: ${installHint}`);
        }
    } else if (terminal === 'cmux') {
        try {
            assertTmuxAvailable();
            if (!isCmuxAvailable()) {
                console.log('\u26A0\uFE0F  cmux not found. Falling back to tmux via default terminal.');
                return openSingleWorktree(wt, agentCommand, 'tmux');
            }
            const { sessionName, created } = ensureTmuxSessionForWorktree(wt, agentCommand);
            const attachCmd = `tmux attach -t ${shellQuote(sessionName)}`;
            cmuxNewWorkspace(sessionName, attachCmd);

            // Push metadata to cmux sidebar (opportunistic)
            if (isCmuxRunning()) {
                const paddedId = String(wt.featureId).padStart(2, '0');
                cmuxSetStatus('feature', paddedId, { icon: 'tag' });
                cmuxSetStatus('agent', wt.agent, { icon: 'cpu' });
            }

            console.log(`\n\uD83D\uDE80 Opening worktree in cmux:`);
            console.log(`   Feature: ${wt.featureId} - ${wt.desc}`);
            console.log(`   Agent: ${wt.agent}`);
            console.log(`   Path: ${wt.path}`);
            console.log(`   Session: ${sessionName}${created ? ' (created)' : ' (attached)'}`);
        } catch (e) {
            console.error(`\u274C Failed to open cmux: ${e.message}`);
            console.error(`   Install: brew tap manaflow-ai/cmux && brew install --cask cmux`);
        }
    } else {
        console.error(`\u274C Terminal "${terminal}" not supported.`);
        console.error(`   Supported terminals: warp, cmux, terminal, tmux`);
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
    detectLinuxTerminal,
    isCmuxAvailable,
    isCmuxRunning,
    cmuxSetStatus,
    cmuxNotify,
    cmuxSetProgress,
    openTerminalAppWithCommand,
    ensureTmuxSessionForWorktree,
    openInWarpSplitPanes,
    openInCmuxSplitPanes,
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
