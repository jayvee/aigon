'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');
const git = require('./git');
const stateMachine = require('./state-queries');
const terminalAdapters = require('./terminal-adapters');

// Lazy require for session-sidecar to avoid circular deps
function _getSessionSidecar() {
    return require('./session-sidecar');
}

// Lazy requires to avoid circular dependency issues
function _getAgentCliConfig(agentId, repoPath) {
    return require('./config').getAgentCliConfig(agentId, repoPath);
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
function _getAttributionDomain(repoPath) {
    return require('./config').getAttributionDomain(repoPath);
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

/**
 * Persist an inline agent prompt body to a deterministic file.
 *
 * Non-slash-invocable agents (cx, op, …) inline the full prompt body
 * (KB-scale markdown with `$`, backticks, and quotes) at launch time
 * instead of relying on the CLI's skill / prompt discovery for
 * aigon-spawned sessions. We can't safely embed that body in a shell
 * command line — instead we write it to disk and reference it via the
 * bash `$(< file)` form.
 *
 * The file lives under the OS temp dir, namespaced by repo + entity, so
 * concurrent launches for different features don't collide. The same
 * launch overwrites its own file each invocation.
 */
function _writeInlinePromptFile(wt, verb, body) {
    const repoName = path.basename(path.resolve(wt.repoPath || wt.path || process.cwd()));
    const entityType = wt.entityType === 'research' ? 'research' : 'feature';
    const dir = path.join(os.tmpdir(), 'aigon-inline-prompts', repoName);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${entityType}-${wt.featureId}-${verb}.md`);
    fs.writeFileSync(filePath, body);
    return filePath;
}

// --- Worktree Helpers ---

/**
 * Return the canonical worktree base directory for the current repo.
 * New location: ~/.aigon/worktrees/{repoName}
 * @param {string} [repoPath] - Optional repo path (defaults to cwd)
 * @returns {string} Absolute path to worktree base
 */
function getWorktreeBase(repoPath) {
    const repoName = path.basename(repoPath || process.cwd());
    return path.join(os.homedir(), '.aigon', 'worktrees', repoName);
}

/**
 * Return the worktree base for a given repo path (for callers that have an explicit repo path).
 * @param {string} repoPath - Absolute repo path
 * @returns {string} Absolute path to worktree base
 */
function getWorktreeBaseForRepo(repoPath) {
    return getWorktreeBase(repoPath);
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
 * @param {string} [taskType='do'] - 'do', 'review', 'eval'
 * @returns {string} Raw agent CLI command string
 */
function buildRawAgentCommand(wt, taskType = 'do') {
    // Test mode: never spawn real agent binaries. Replace the agent command
    // with a portable block-forever primitive so the tmux session stays
    // alive but no real `claude`, `codex`, `gemini`, or `cursor-agent` is
    // ever invoked. MockAgent drives submission explicitly via
    // `aigon agent-status submitted`. Teardown kills the session.
    //
    // IMPORTANT: must be `tail -f /dev/null`, not `sleep infinity`. The
    // latter is a GNU coreutils extension; macOS BSD `sleep` errors out
    // with "usage: sleep number[unit]" and exits non-zero, which causes
    // the shell trap wrapper in `buildAgentCommand` to fire
    // `agent-status error` and mark the agent as failed — silently
    // breaking every lifecycle test. `tail -f /dev/null` blocks forever
    // on every Unix, exits cleanly when killed, and has no arguments to
    // misparse.
    //
    // REGRESSION: prevents the "e2e tests spawn real `claude` in background
    // tmux, which triggers macOS keychain prompts under the test's fake
    // HOME" bug AND the "macOS sleep infinity fails and trap fires error"
    // bug, both surfaced during the 2026-04-06 test-rot triage.
    //
    // MOCK_AGENT_BIN takes precedence over AIGON_TEST_MODE so MockAgent's
    // tmux mode (F385) can substitute a behaviour script for the resolved
    // agent binary while still exercising the full buildAgentCommand
    // wrapper — shell trap + heartbeat sidecar regressions then surface
    // in e2e tests instead of waiting for a real-agent run to catch them.
    if (process.env.MOCK_AGENT_BIN) {
        const absPath = wt.path ? path.resolve(wt.path) : null;
        const cdPrefix = absPath ? `cd ${shellQuote(absPath)} && ` : '';
        return `${cdPrefix}${shellQuote(process.env.MOCK_AGENT_BIN)}`;
    }
    if (process.env.AIGON_TEST_MODE === '1') {
        return 'tail -f /dev/null';
    }

    const agentRegistry = require('./agent-registry');

    // Optional escape hatch for callers that need the wrapped shell-trap path
    // but must run a specific internal CLI command (e.g. autopilot).
    if (wt && typeof wt.rawCommand === 'string' && wt.rawCommand.trim()) {
        const absPath = wt.path ? path.resolve(wt.path) : null;
        const envOverrides = absPath ? agentRegistry.getWorktreeEnvExports(wt.agent, absPath) : '';
        const cdPrefix = absPath ? `cd ${shellQuote(absPath)} && ${envOverrides}` : '';
        return `${cdPrefix}${wt.rawCommand.trim()}`;
    }

    const configRepoPath = wt.repoPath || process.cwd();
    const cliConfig = _getAgentCliConfig(wt.agent, configRepoPath);
    const isResearch = wt.entityType === 'research';
    const normalizedTaskType = taskType === 'implement' ? 'do'
        : taskType === 'evaluate' ? 'eval'
        : taskType;
    const researchCommands = {
        do: 'research-do',
        eval: 'research-eval',
        review: 'research-review',
        'spec-review': 'research-spec-review',
        'spec-check': 'research-spec-revise',
        'research-review': 'research-review'
    };
    let prompt;
    let modelKey;
    if (isResearch) {
        const agentConfig = _loadAgentConfig(wt.agent);
        const isHeadless = !agentConfig?.commands?.length;
        const command = researchCommands[normalizedTaskType];
        if (!command) {
            throw new Error(`Unsupported research task type: ${normalizedTaskType}`);
        }
        if (!agentRegistry.isSlashCommandInvocable(wt.agent)) {
            const { resolveAgentCommandPrompt } = require('./agent-prompt-resolver');
            const promptText = resolveAgentCommandPrompt({
                agentId: wt.agent,
                commandName: command,
                argsString: normalizedTaskType === 'do' ? String(wt.featureId) : `${wt.featureId} --no-launch`,
                cliConfig,
            });
            const promptFile = _writeInlinePromptFile(wt, command, promptText);
            prompt = `$(< ${shellQuote(promptFile)})`;
        } else if (isHeadless && (normalizedTaskType === 'spec-review' || normalizedTaskType === 'spec-check')) {
            // Slash-invocable but no command bundle (e.g. Gemini): cannot resolve /aigon:… in headless
            // mode. Inline the same canonical markdown as cx/op so the session sees "do not re-run
            // research-spec-review" instead of recursive shell guidance (worktree-state-reconcile).
            const { resolveCxCommandBody } = require('./agent-prompt-resolver');
            const promptText = resolveCxCommandBody(command, `${wt.featureId} --no-launch`, wt.agent);
            const promptFile = _writeInlinePromptFile(wt, command, promptText);
            prompt = `$(< ${shellQuote(promptFile)})`;
        } else if (isHeadless) {
            // Headless agents (no slash commands): use descriptive prompt with CLI commands
            prompt = `Read AGENTS.md for project context. Then run \`aigon ${command} ${wt.featureId}\` in the shell and follow its output.`;
        } else {
            // Agents with slash commands: use CMD_PREFIX + slash command
            const cmdPrefix = agentConfig?.placeholders?.CMD_PREFIX || '/aigon:';
            prompt = `${cmdPrefix}${command} ${wt.featureId}`;
            // Escape $ for the double-quoted shell context at line ~263.
            // cx CMD_PREFIX is `$aigon-` — without this the shell expands
            // `$aigon` as an empty variable.
            if (prompt.includes('$')) {
                prompt = prompt.replace(/\$/g, '\\$');
            }
        }
        modelKey = normalizedTaskType === 'do' ? 'research'
            : normalizedTaskType === 'eval' ? 'evaluate'
            : 'review';
    } else {
        const verbMap = { do: 'do', eval: 'eval', review: 'review' };
        const verb = verbMap[normalizedTaskType];
        if (!verb && !['spec-review', 'spec-check'].includes(normalizedTaskType)) {
            throw new Error(`Unsupported feature task type: ${normalizedTaskType}`);
        }
        // When launching eval/review from a non-CLI entry point (dashboard,
        // tmux), skip the CLI's outer launch mode so the agent's slash
        // command runs directly without re-spawning a nested session.
        const { resolveAgentCommandPrompt, resolveAgentPromptBody } = require('./agent-prompt-resolver');
        const promptCommandName = normalizedTaskType === 'spec-review'
            ? 'feature-spec-review'
            : normalizedTaskType === 'spec-check'
                ? 'feature-spec-revise'
                : verb;
        const promptText = wt.promptOverride
            ? String(wt.promptOverride)
            : (normalizedTaskType === 'spec-review' || normalizedTaskType === 'spec-check'
                ? resolveAgentCommandPrompt({
                    agentId: wt.agent,
                    commandName: promptCommandName,
                    argsString: `${wt.featureId} --no-launch`,
                    cliConfig,
                })
                : resolveAgentPromptBody({
                    agentId: wt.agent,
                    verb,
                    featureId: wt.featureId,
                    extraArgs: verb === 'eval' ? '--no-launch' : '',
                    cliConfig,
                }));
        if (!agentRegistry.isSlashCommandInvocable(wt.agent)) {
            // Inline path (cx, op, any non-slash-invocable agent): the
            // prompt body is full markdown (KB-scale) with $-tokens,
            // backticks, and quotes. Embedding it directly in a shell
            // command would require escaping every metacharacter.
            // Instead persist it to a temp file and reference it via the
            // bash `$(< file)` form, which substitutes the file contents
            // verbatim without any further interpretation.
            const promptFile = _writeInlinePromptFile(wt, promptCommandName, promptText);
            prompt = `$(< ${shellQuote(promptFile)})`;
        } else {
            prompt = promptText;
        }
        modelKey = normalizedTaskType === 'do' ? 'implement'
            : normalizedTaskType === 'eval' ? 'evaluate'
            : 'review';
    }

    // Unset CLAUDECODE to prevent "nested session" error when launched from a Claude Code terminal
    const prefix = cliConfig.command === 'claude' ? 'unset CLAUDECODE && ' : '';

    // AIGON_TEST_MODEL_CC env var overrides model for Claude only (used by e2e test suite)
    const testModelOverride = (cliConfig.command === 'claude' && process.env.AIGON_TEST_MODEL_CC) || null;
    // Resolve per-feature {model, effort} overrides captured on feature.started.
    // Precedence: event-log override > cliConfig.models[taskType] > no flag.
    // Every spawn path in this repo routes through buildAgentLaunchInvocation so
    // the overrides chosen at start time survive every respawn (autopilot
    // retry, manual restart, dashboard "restart agent", feature-open).
    const { buildAgentLaunchInvocation } = require('./agent-launch');
    const featureSnapshot = wt.snapshot || _loadFeatureSnapshotForWorktree(wt);
    const stageDefaultModel = testModelOverride || cliConfig.models?.[modelKey] || null;
    const launchFragments = buildAgentLaunchInvocation({
        agentId: wt.agent,
        slotAgentId: wt.slotAgentId || wt.agent,
        snapshot: featureSnapshot,
        stageDefaultModel,
        launcherModel: wt.launcherModel || null,
        launcherEffort: wt.launcherEffort || null,
    });

    // Name the CC session using the same format as tmux sessions
    const typeChar = isResearch ? 'r' : 'f';
    const sessionRole = normalizedTaskType === 'eval' ? 'eval'
        : normalizedTaskType === 'review' ? 'review'
        : 'do';
    const nameFlag = cliConfig.command === 'claude'
        ? `--name "${buildTmuxSessionName(wt.featureId, wt.agent, { desc: wt.desc, worktreePath: wt.path, entityType: typeChar, role: sessionRole })}"`
        : '';

    // Defensive cd: some agents (e.g. Codex) resolve project root from .git
    // rather than cwd. In worktrees .git is a file, not a dir, which can
    // confuse project detection. Explicit cd ensures the agent starts right.
    // Use absolute path — tmux sessions may set cwd to the worktree itself,
    // making relative paths resolve incorrectly.
    // Override agent-specific worktree env vars (e.g. GEMINI_CLI_IDE_WORKSPACE_PATH
    // for Gemini CLI which inherits the parent env, ignoring cwd entirely).
    const absPath = wt.path ? path.resolve(wt.path) : null;
    const envOverrides = absPath ? agentRegistry.getWorktreeEnvExports(wt.agent, absPath) : '';
    const cdPrefix = absPath ? `cd ${shellQuote(absPath)} && ${envOverrides}` : '';

    const flagTokens = _getAgentLaunchFlagTokens(cliConfig.command, cliConfig.implementFlag, {
        autonomous: false,
        cursorTmuxLaunch: cliConfig.command === 'agent',
    });
    const launchEnvExports = launchFragments.envExports.length > 0
        ? launchFragments.envExports.map(p => `export ${p}`).join(' && ') + ' && '
        : '';
    const flags = [...flagTokens, ...launchFragments.args, nameFlag].filter(Boolean).join(' ');
    // cx feature prompts use $(< file) which requires shell expansion (double quotes).
    // All other prompts (including cx research with $aigon- prefix) must use single
    // quotes to prevent shell variable expansion of the $ in CMD_PREFIX.
    const needsShellExpansion = prompt.startsWith('$(');
    const quotedPrompt = needsShellExpansion ? `"${prompt}"` : shellQuote(prompt);
    // Cursor CLI (`agent`): Composer often stays alive after a turn waiting for
    // follow-ups, so the EXIT trap never runs and `review-complete` / `submitted`
    // is never written. Closing stdin makes headless `--print` runs terminate
    // once the model finishes; see buildAgentCommand cu branch for the follow-on
    // `agent-status` + interactive shell (same pattern as OpenCode `op`).
    const agentAliasForStdin = agentRegistry.getAgentAliasMap();
    const canonicalForStdin = agentAliasForStdin[String(wt.agent || '').trim().toLowerCase()] || String(wt.agent || '').trim();
    const cursorStdinNull = cliConfig.command === 'agent' && canonicalForStdin === 'cu';
    const stdinRedirect = cursorStdinNull ? ' < /dev/null' : '';
    // Injection-via-tmux mode (op TUI, km): launch the bare CLI; the prompt
    // is pasted into the TUI post-launch by a backgrounded subshell in
    // buildAgentCommand. Stash the prompt file path on wt for the wrapper to
    // pick up; strip the prompt from the launch string.
    //
    // Model-flag handling: only strip --model when the agent declares
    // supportsModelFlag:false (km — kimi CLI rejects arbitrary model IDs and
    // falls back to "LLM not set"). For op, --model openrouter/<id> is a
    // real, supported opencode flag — stripping it silently dropped user
    // model overrides and forced opencode's config default.
    if (cliConfig.injectPromptViaTmux) {
        const m = String(prompt || '').match(/^\$\(<\s+(.+?)\s*\)$/);
        if (m) {
            wt._injectPromptFile = m[1].replace(/^'(.+)'$/, '$1').replace(/^"(.+)"$/, '$1');
        }
        const stripModelFlag = agentRegistry.supportsModelFlag(wt.agent) === false;
        const injectFlags = (flags && stripModelFlag)
            ? flags.replace(/--model\s+\S+\s*/g, '').trim()
            : (flags || '');
        if (injectFlags) {
            return `${cdPrefix}${launchEnvExports}${prefix}${cliConfig.command} ${injectFlags}`;
        }
        return `${cdPrefix}${launchEnvExports}${prefix}${cliConfig.command}`;
    }
    const promptFlagStr = agentRegistry.getPromptFlag(wt.agent) ? `${agentRegistry.getPromptFlag(wt.agent)} ` : '';
    if (flags) {
        return `${cdPrefix}${launchEnvExports}${prefix}${cliConfig.command} ${flags} ${promptFlagStr}${quotedPrompt}${stdinRedirect}`;
    }
    return `${cdPrefix}${launchEnvExports}${prefix}${cliConfig.command} ${promptFlagStr}${quotedPrompt}${stdinRedirect}`;
}

/**
 * Get signal capabilities for an agent from its template config.
 * Returns defaults (shellTrap + heartbeatSidecar on, no cliHooks) for
 * agents without an explicit signals block — new agents automatically
 * participate in the signal architecture.
 *
 * @param {string} agentId - Agent ID (cc, gg, cx, cu, etc.)
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
/**
 * Synchronously load the engine snapshot for a worktree/session. Used by
 * every spawn path to read the per-feature {model, effort} overrides that
 * were captured on feature.started. Returns null when no snapshot exists
 * yet (e.g. drive-mode solo features that have never persisted state).
 *
 * Worktrees store their snapshot in the main repo, so this helper reads
 * .aigon/worktree.json to find the main repo path, then the snapshot from
 * .aigon/workflows/features/<id>/snapshot.json inside it.
 *
 * @param {Object} wt
 * @returns {object|null}
 */
function _loadFeatureSnapshotForWorktree(wt) {
    if (!wt || !wt.featureId) return null;
    const cwd = wt.path ? path.resolve(wt.path) : (wt.repoPath ? path.resolve(wt.repoPath) : process.cwd());
    let mainRepo = cwd;
    const worktreeJsonPath = path.join(cwd, '.aigon', 'worktree.json');
    if (fs.existsSync(worktreeJsonPath)) {
        try {
            const worktreeMeta = JSON.parse(fs.readFileSync(worktreeJsonPath, 'utf8'));
            if (worktreeMeta.mainRepo) {
                mainRepo = path.resolve(worktreeMeta.mainRepo);
            }
        } catch { /* fall through to cwd */ }
    } else if (wt.repoPath) {
        // No worktree.json — treat explicit wt.repoPath as authoritative.
        mainRepo = path.resolve(wt.repoPath);
    }
    const entityType = wt.entityType === 'research' ? 'research' : 'features';
    const snapshotPath = path.join(mainRepo, '.aigon', 'workflows', entityType, String(wt.featureId), 'snapshot.json');
    if (!fs.existsSync(snapshotPath)) return null;
    try {
        return JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    } catch {
        return null;
    }
}

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
 * Precedence matches `agent-status` main-repo resolution (misc.js): when
 * `.aigon/worktree.json` is missing, `AIGON_PROJECT_PATH` from the shell trap
 * points at the main repo — heartbeats must land there so
 * `readHeartbeatFileTimestamp(repoPath, …)` agrees with tmux session wiring.
 *
 * @param {Object} wt - Worktree/session config
 * @param {string} [wt.path] - Worktree/working directory path
 * @param {string} [wt.repoPath] - Main repo root when known (e.g. dashboard spawns)
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
            // Fall through
        }
    }
    if (process.env.AIGON_PROJECT_PATH) {
        return path.join(path.resolve(process.env.AIGON_PROJECT_PATH), '.aigon', 'state');
    }
    if (wt.repoPath) {
        return path.join(path.resolve(wt.repoPath), '.aigon', 'state');
    }
    return path.join(cwd, '.aigon', 'state');
}

/**
 * Write or repair `.aigon/worktree.json` so worktree paths resolve to the main repo.
 * Idempotent when the file already points at the same `mainRepoPath`.
 * Used when `feature-start` skips full `setupWorktreeEnvironment` for an existing worktree.
 *
 * @param {string} worktreePath
 * @param {string} mainRepoPath
 */
function reconcileWorktreeJson(worktreePath, mainRepoPath) {
    const mainRepo = path.resolve(mainRepoPath);
    const aigonDir = path.join(worktreePath, '.aigon');
    if (!fs.existsSync(aigonDir)) fs.mkdirSync(aigonDir, { recursive: true });
    const target = path.join(aigonDir, 'worktree.json');
    if (fs.existsSync(target)) {
        try {
            const cur = JSON.parse(fs.readFileSync(target, 'utf8'));
            if (cur && cur.mainRepo && path.resolve(cur.mainRepo) === mainRepo) return;
        } catch {
            /* malformed — overwrite */
        }
    }
    fs.writeFileSync(target, JSON.stringify({ mainRepo }, null, 2));
}

/** Main repo root for a Fleet worktree (via .aigon/worktree.json), else cwd / wt.repoPath. */
function _resolveMainRepoFromWorktreeWt(wt) {
    const cwd = wt.path ? path.resolve(wt.path) : (wt.repoPath ? path.resolve(wt.repoPath) : process.cwd());
    const worktreeJsonPath = path.join(cwd, '.aigon', 'worktree.json');
    if (fs.existsSync(worktreeJsonPath)) {
        try {
            const worktreeMeta = JSON.parse(fs.readFileSync(worktreeJsonPath, 'utf8'));
            if (worktreeMeta.mainRepo) return path.resolve(worktreeMeta.mainRepo);
        } catch (_) { /* fall through */ }
    }
    return wt.repoPath ? path.resolve(wt.repoPath) : cwd;
}

/**
 * Build the agent CLI command string for a worktree or entity session.
 * Wraps the raw agent command in a shell script with:
 *   - trap EXIT handler that fires agent-status on completion
 *   - agent-status implementing on session start
 *   - background heartbeat sidecar (file touch)
 *
 * The shell trap is the universal signal foundation for lifecycle signals.
 * The trap fires on normal exit, SIGINT, and SIGTERM. It does NOT fire on
 * SIGKILL or machine crash (the orchestrator sweep handles those).
 *
 * Exception — OpenCode (`op`): after a successful `opencode run`, we call
 * `agent-status` inline (same statuses as the trap would) and `exec bash -l`
 * so the tmux pane stays open for follow-up CLI work; the EXIT trap on the
 * wrapper shell is replaced by `exec` and no longer runs on that success path.
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
 * @param {string} [taskType='do'] - 'do', 'review', 'eval'
 * @returns {string} Shell script string with trap + heartbeat + agent command
 */
function buildAgentCommand(wt, taskType = 'do') {
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
    // Map session task → completion + start signal names.
    // 'do' for research entities resolves to 'research-complete' so the trap
    // matches the entity-aware semantic introduced by F404.
    const isResearchEntity = wt.entityType === 'research';
    const successStatus = ({
        review: 'review-complete',
        'spec-review': 'spec-review-complete',
        'spec-check': 'spec-review-complete',
        revise: 'revision-complete',
        do: isResearchEntity ? 'research-complete' : 'implementation-complete',
        eval: isResearchEntity ? 'research-complete' : 'implementation-complete',
    })[taskType] || (isResearchEntity ? 'research-complete' : 'implementation-complete');
    const startStatus = ({
        review: 'reviewing',
        'spec-review': 'spec-reviewing',
        'spec-check': 'spec-reviewing',
        revise: 'revising',
        do: 'implementing',
        eval: 'implementing',
    })[taskType] || 'implementing';
    // Persist the taskType into the agent-status file (read by the mismatch
    // checker on completion). Mapping eval → do keeps the semantic narrow:
    // implementation-complete is the right completion for an eval session.
    const recordedTaskType = ({
        review: 'review',
        'spec-review': 'spec-review',
        'spec-check': 'spec-check',
        revise: 'revise',
        do: 'do',
        eval: 'do',
    })[taskType] || 'do';

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

    // Set entity context so agent-status knows the entity type without guessing
    const entityType = wt.entityType === 'research' ? 'research' : 'feature';

    const telemetryEnvLines = [];
    if (entityType === 'feature' && featureId != null && String(featureId) !== '') {
        const activity = taskType === 'eval' ? 'evaluate'
            : taskType === 'review' ? 'review'
            : (taskType === 'spec-review' || taskType === 'spec-check') ? 'spec_review'
            : 'implement';
        telemetryEnvLines.push(`export AIGON_ACTIVITY=${activity}`);
        try {
            const { readStats } = require('./feature-status');
            const mainRepo = _resolveMainRepoFromWorktreeWt(wt);
            const stats = readStats(mainRepo, 'feature', String(featureId));
            if (stats && stats.startedAt) {
                const wfId = `${String(featureId)}-${new Date(stats.startedAt).getTime()}`;
                telemetryEnvLines.push(`export AIGON_WORKFLOW_RUN_ID=${shellQuote(wfId)}`);
            }
        } catch (_) { /* best-effort */ }
    }

    // Lifecycle contract: every agent launches in interactive mode, performs
    // work via its slash command (which posts `agent-status` from inside the
    // agent), and returns to its OWN prompt. The tmux session stays at that
    // prompt until `feature-close` / `sessions-close` kills it. No `exec bash
    // -l` post-hook — that would replace the agent's prompt with bash and
    // hide the agent's output.
    //
    // Cursor (`cu`): `agent` Composer stays interactive after a turn; the
    // existing `cu` branch keeps `exec bash -l` as a safety net for cases
    // where the CLI does exit. Untouched per user feedback (cu was working).
    //
    // OpenCode (`op`) and Kimi (`km`): launched in TUI mode (`opencode`,
    // `kimi term`). The slash-command prompt is pasted into the TUI by a
    // backgrounded subshell after a delay (see injection block below).
    const agentAliasMap = require('./agent-registry').getAgentAliasMap();
    const canonicalAgentId = agentAliasMap[String(wt.agent || '').trim().toLowerCase()] || String(wt.agent || '').trim();
    const agentInvocationLines = canonicalAgentId === 'cu'
        ? [
            rawCmd,
            '_aigon_agent_rc=$?',
            'if [ $_aigon_agent_rc -ne 0 ]; then exit $_aigon_agent_rc; fi',
            `aigon agent-status ${successStatus} 2>/dev/null || true`,
            'trap - EXIT 2>/dev/null || true',
            'echo ""',
            'echo "Cursor agent finished (exit 0). Session kept open — continue here or type exit when done."',
            'exec bash -l',
        ]
        : [rawCmd];

    // Background prompt-injection subshell: when the agent's CLI has no
    // initial-prompt argument (op, km), buildRawAgentCommand stashes the
    // slash-command prompt file on wt._injectPromptFile. Poll the pane (up
    // to ~30s) for authenticated-ready markers, then paste via bracketed
    // tmux paste-buffer and press Enter.
    //
    // Marker rationale:
    //   opencode: "Ask anything" — the input placeholder (only post-auth)
    //   kimi: "Kimi-k2" — model name in the status bar; only appears after
    //     credentials are loaded. "── input ──" and "ctrl-v: paste" appear
    //     in BOTH authenticated and unauthenticated states, so they are not
    //     reliable. kimi can take 8-10s to auth (network round-trip for
    //     managed credentials), hence the 30s / 150-iteration budget.
    const injectionLines = wt._injectPromptFile ? [
        '(',
        '  _aigon_inject_session=$(tmux display-message -p "#{session_name}" 2>/dev/null)',
        '  for _ in $(seq 1 150); do',
        '    sleep 0.2',
        '    if tmux capture-pane -p -t "$_aigon_inject_session" 2>/dev/null \\',
        '        | grep -qE "Ask anything|Kimi-k2"; then',
        '      break',
        '    fi',
        '  done',
        '  sleep 0.5',
        '  if [ -n "$_aigon_inject_session" ] && tmux has-session -t "$_aigon_inject_session" 2>/dev/null; then',
        '    _aigon_inject_buf="aigon-inject-$$"',
        `    tmux load-buffer -b "$_aigon_inject_buf" ${shellQuote(wt._injectPromptFile)} 2>/dev/null`,
        '    tmux paste-buffer -b "$_aigon_inject_buf" -t "$_aigon_inject_session" -p -d 2>/dev/null',
        '    sleep 0.5',
        '    tmux send-keys -t "$_aigon_inject_session" Enter 2>/dev/null',
        '  fi',
        ') &',
    ] : [];

    const lines = [
        // Entity context — agent-status reads these instead of parsing tmux session names
        `export AIGON_ENTITY_TYPE=${entityType}`,
        `export AIGON_ENTITY_ID=${featureId}`,
        `export AIGON_AGENT_ID=${agentId}`,
        `export AIGON_RUNTIME_AGENT_ID=${shellQuote(wt.agent)}`,
        `export AIGON_PROJECT_PATH=${shellQuote(path.resolve(wt.repoPath || process.cwd()))}`,
        ...telemetryEnvLines,
        // Self-healing trust: ensure worktree directory is trusted before agent launch
        'aigon trust-worktree "$(pwd)" 2>/dev/null || true',
        // Define cleanup function
        '_aigon_cleanup() {',
        '  _aigon_exit_code=$?',
        '  _aigon_pane_tail=""',
        '  if [ -n "${TMUX_PANE:-}" ] && command -v tmux >/dev/null 2>&1 && command -v base64 >/dev/null 2>&1; then',
        '    _aigon_pane_tail=$(tmux capture-pane -p -S -120 -t "$TMUX_PANE" 2>/dev/null | tail -120 | base64 | tr -d "\\n" || true)',
        '  fi',
        cleanupKillHb ? `  ${cleanupKillHb}` : null,
        '  if [ $_aigon_exit_code -eq 0 ]; then',
        `    aigon agent-status ${successStatus} 2>/dev/null || true`,
        '  else',
        '    AIGON_EXIT_CODE="$_aigon_exit_code" AIGON_PANE_TAIL_B64="$_aigon_pane_tail" aigon agent-status error 2>/dev/null || true',
        '  fi',
        '}',
        // Install trap
        'trap _aigon_cleanup EXIT',
        // Signal runtime status on start (also records taskType for mismatch checks)
        `AIGON_TASK_TYPE=${recordedTaskType} aigon agent-status ${startStatus} 2>/dev/null || true`,
        // Heartbeat sidecar
        ...heartbeatLines,
        // Background prompt injection for op/km TUI launches (no-op for others)
        ...injectionLines,
        // Agent CLI
        ...agentInvocationLines,
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
 * @param {string} [repoPath] - Canonical repo root for config resolution
 * @param {object} [launchExtras] - optional `{ launcherModel, launcherEffort }` for one-shot dashboard spawns
 * @returns {string} Command string to run the agent CLI
 */
function buildResearchAgentCommand(agentId, researchId, taskType = 'do', repoPath, launchExtras) {
    const extra = launchExtras && typeof launchExtras === 'object' ? launchExtras : {};
    return buildAgentCommand(Object.assign({
        agent: agentId,
        featureId: researchId,
        entityType: 'research',
        repoPath,
    }, extra), taskType);
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
        const grandparentPath = path.dirname(path.dirname(normalizedPath));

        // New location: ~/.aigon/worktrees/{repoName}/feature-NNN-agent-desc
        if (/^(feature|research)-\d+-[a-z]{2}(?:-|$)/.test(baseName) &&
            path.basename(grandparentPath) === 'worktrees' &&
            path.basename(path.dirname(grandparentPath)) === '.aigon') {
            return parentBase; // parentBase IS the repoName
        }

        // Legacy location: ../{repoName}-worktrees/feature-NNN-agent-desc
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
 * Valid tmux session roles.
 * - do: implementation sessions
 * - eval: evaluation sessions
 * - review: code review sessions
 * - auto: autonomous orchestrator sessions (reserved, not yet used)
 */
const VALID_TMUX_ROLES = ['do', 'eval', 'review', 'revise', 'spec-review', 'spec-check', 'auto'];

/**
 * Build a tmux session name following the naming convention:
 *   {repo}-{typeChar}{num}-{role}-{agent}(-{desc})
 * The 'auto' role omits the agent suffix.
 * Falls back to shorter forms when repo/desc are unavailable.
 * @param {string} entityId - Feature or research ID
 * @param {string} [agentId]
 * @param {object} [options]
 * @param {string} [options.repo] - repository name (defaults to cwd basename)
 * @param {string} [options.desc] - entity description (kebab-case)
 * @param {string} [options.entityType] - 'f' for feature (default), 'r' for research
 * @param {string} [options.role] - 'do' (default), 'eval', 'review', or 'auto'
 */
function buildTmuxSessionName(entityId, agentId, options) {
    const repo = resolveTmuxRepoName(options);
    const num = toUnpaddedId(entityId);
    const typeChar = (options && options.entityType) || 'f';
    const role = (options && options.role) || 'do';
    const desc = options && options.desc;
    const noAgent = role === 'auto';
    const agent = noAgent ? null : (agentId || 'solo');
    const middle = noAgent ? role : `${role}-${agent}`;
    return desc
        ? `${repo}-${typeChar}${num}-${middle}-${desc}`
        : `${repo}-${typeChar}${num}-${middle}`;
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
 * Parse a tmux session name to extract entity type, id, role, and agent.
 * Returns { repoPrefix, type: 'f'|'r'|'S', id: string, role: string, agent: string|null } or null.
 * 'S' = set autonomous conductor: {repo}-s{setSlug}-auto
 * Handles new-style ({repo}-f{id}-{role}-{agent}(-desc)),
 * legacy feature eval ({repo}-f{id}-eval(-desc)),
 * and legacy ({repo}-f{id}-{agent}(-desc)) names.
 */
function parseTmuxSessionName(name) {
    // 0. Set autonomous orchestrator: {repo}-s{setSlug}-auto
    const setAutoMatch = name.match(/^(.+)-s([a-z0-9][a-z0-9-]*)-auto$/);
    if (setAutoMatch) return { repoPrefix: setAutoMatch[1], type: 'S', id: setAutoMatch[2], role: 'auto', agent: null };
    // 1. Auto sessions (no agent): {repo}-{type}{id}-auto(-desc)
    const autoMatch = name.match(/^(.+)-(f|r)(\d+)-auto(?:-|$)/);
    if (autoMatch) return { repoPrefix: autoMatch[1], type: autoMatch[2], id: autoMatch[3], role: 'auto', agent: null };
    // 2. Role+agent sessions: {repo}-{type}{id}-{role}-{agent}(-desc)
    const roleMatch = name.match(/^(.+)-(f|r)(\d+)-(do|eval|review|spec-review|spec-check)-([a-z]{2})(?:-|$)/);
    if (roleMatch) return { repoPrefix: roleMatch[1], type: roleMatch[2], id: roleMatch[3], role: roleMatch[4], agent: roleMatch[5] };
    // 3. Legacy feature eval sessions omitted the agent segment: {repo}-f{id}-eval(-desc)
    const legacyFeatureEvalMatch = name.match(/^(.+)-f(\d+)-eval(?:-|$)/);
    if (legacyFeatureEvalMatch) return { repoPrefix: legacyFeatureEvalMatch[1], type: 'f', id: legacyFeatureEvalMatch[2], role: 'eval', agent: null };
    // 4. Legacy fallback (no role prefix): {repo}-{type}{id}-{agent}(-desc) → role 'do'
    const legacyMatch = name.match(/^(.+)-(f|r)(\d+)-([a-z]{2})(?:-|$)/);
    if (!legacyMatch) return null;
    return { repoPrefix: legacyMatch[1], type: legacyMatch[2], id: legacyMatch[3], role: 'do', agent: legacyMatch[4] };
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
 * Classify why a session is orphaned (entity comes from tmux name parsing or session sidecar).
 * @param {'f'|'r'} entityTypeChar
 * @param {string} entityId - unpadded numeric id string
 * @returns {{ reason: string } | null}
 */
function classifyOrphanReason(entityTypeChar, entityId, stageResult) {
    if (!entityTypeChar || entityId == null || String(entityId).trim() === '') return null;
    if (!stageResult) return { reason: 'spec-missing' };
    const entityType = entityTypeChar === 'f' ? 'feature' : 'research';
    // For feature/research, use engine snapshot lifecycle (spec folder never reports `closing`)
    if (entityType === 'feature' || entityType === 'research') {
        const workflowSnapshotAdapter = require('./workflow-snapshot-adapter');
        const wfType = entityType === 'feature' ? 'feature' : 'research';
        const wfId = toUnpaddedId(entityId);
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

const TMUX_SESSION_ROW_SEPARATOR = '__AIGON_SEP__';

/**
 * Delete `.aigon/sessions/{name}.json` when no matching tmux session is alive.
 *
 * Sidecars carrying a `tmuxId` are pruned by ID — the durable foreign key
 * survives renames and name truncation. Older sidecars without `tmuxId` fall
 * back to filename-stem matching against live session names.
 *
 * @param {string[]} repos - conductor repo paths
 * @param {Set<string>} liveSessionNames
 * @param {Set<string>} [liveTmuxIds]
 */
function pruneStaleSessionSidecars(repos, liveSessionNames, liveTmuxIds) {
    for (const repo of repos) {
        const dir = path.join(path.resolve(repo), '.aigon', 'sessions');
        if (!fs.existsSync(dir)) continue;
        let entries;
        try {
            entries = fs.readdirSync(dir);
        } catch (_) {
            continue;
        }
        for (const f of entries) {
            if (!f.endsWith('.json')) continue;
            const stem = f.slice(0, -'.json'.length);
            let tmuxId = null;
            if (liveTmuxIds) {
                try {
                    const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
                    if (raw && typeof raw === 'object' && raw.tmuxId) {
                        tmuxId = String(raw.tmuxId);
                    }
                } catch (_) { /* unreadable → fall back to name */ }
            }
            const alive = tmuxId
                ? liveTmuxIds.has(tmuxId)
                : liveSessionNames.has(stem);
            if (alive) continue;
            try {
                fs.unlinkSync(path.join(dir, f));
            } catch (_) { /* non-fatal */ }
        }
    }
}

/**
 * Load sidecar records for live sessions, keyed by session name.
 *
 * `tmuxId` is the durable join key when present. A sidecar is considered live
 * if its `tmuxId` is in `liveTmuxIds`; older sidecars without `tmuxId` fall
 * back to filename-stem matching the session name.
 *
 * Records with `category: "repo"` are accepted without `entityType`/`entityId`.
 *
 * @param {string[]} repos
 * @param {Set<string>} liveSessionNames
 * @param {Set<string>} [liveTmuxIds]
 * @returns {Map<string, object>}
 */
function loadSessionSidecarIndex(repos, liveSessionNames, liveTmuxIds) {
    const map = new Map();
    for (const repo of repos) {
        const dir = path.join(path.resolve(repo), '.aigon', 'sessions');
        if (!fs.existsSync(dir)) continue;
        let entries;
        try {
            entries = fs.readdirSync(dir);
        } catch (_) {
            continue;
        }
        for (const f of entries) {
            if (!f.endsWith('.json')) continue;
            const stem = f.slice(0, -'.json'.length);
            try {
                const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
                if (!raw || typeof raw !== 'object') continue;
                const tmuxId = raw.tmuxId ? String(raw.tmuxId) : null;
                const alive = tmuxId && liveTmuxIds
                    ? liveTmuxIds.has(tmuxId)
                    : liveSessionNames.has(stem);
                if (!alive) continue;
                const category = raw.category === 'repo' ? 'repo' : 'entity';
                if (category === 'entity') {
                    if (raw.entityType !== 'f' && raw.entityType !== 'r' && raw.entityType !== 'S') continue;
                    if (raw.entityId == null || String(raw.entityId).trim() === '') continue;
                }
                if (!raw.repoPath || !String(raw.repoPath).trim()) continue;
                const name = raw.sessionName != null ? String(raw.sessionName).trim() : stem;
                // Allow filename/sessionName mismatch only when joined via tmuxId
                if (name !== stem && !(tmuxId && liveTmuxIds && liveTmuxIds.has(tmuxId))) continue;
                map.set(name, raw);
            } catch (_) { /* corrupt or race */ }
        }
    }
    return map;
}

function parseEnrichedTmuxSessionRow(line) {
    const text = String(line || '');
    if (text.includes(TMUX_SESSION_ROW_SEPARATOR)) {
        const parts = text.split(TMUX_SESSION_ROW_SEPARATOR);
        const [name, createdEpoch, attached, tmuxId, panePid] = parts;
        return { name, createdEpoch, attached, tmuxId, panePid };
    }
    if (text.includes('\t')) {
        const parts = text.split('\t');
        const [name, createdEpoch, attached, tmuxId, panePid] = parts;
        return { name, createdEpoch, attached, tmuxId, panePid };
    }
    const fallbackMatch = text.match(/^(.*)_(\d+)_(0|1)$/);
    if (fallbackMatch) {
        return { name: fallbackMatch[1], createdEpoch: fallbackMatch[2], attached: fallbackMatch[3] };
    }
    return { name: null, createdEpoch: null, attached: null };
}

function parseEnrichedTmuxSessionsOutput(output, repos) {
    const lines = String(output || '')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);

    const preliminary = lines.map(line => {
        const { name, createdEpoch, attached, tmuxId, panePid } = parseEnrichedTmuxSessionRow(line);
        const trimmedName = String(name || '').trim();
        const createdMs = Number.parseInt(createdEpoch, 10) * 1000;
        if (!trimmedName || !Number.isFinite(createdMs)) return null;
        const trimmedId = tmuxId != null ? String(tmuxId).trim() : '';
        const pid = Number.parseInt(panePid, 10);
        return {
            name: trimmedName,
            createdAt: new Date(createdMs).toISOString(),
            attached: String(attached || '').trim() === '1',
            tmuxId: trimmedId || null,
            shellPid: Number.isFinite(pid) ? pid : null,
        };
    }).filter(Boolean);

    const liveNames = new Set(preliminary.map(p => p.name));
    const liveTmuxIds = new Set(preliminary.map(p => p.tmuxId).filter(Boolean));
    pruneStaleSessionSidecars(repos, liveNames, liveTmuxIds);
    const sidecarBySession = loadSessionSidecarIndex(repos, liveNames, liveTmuxIds);

    return preliminary.map(row => {
        const trimmedName = row.name;
        const side = sidecarBySession.get(trimmedName);
        const category = side && side.category === 'repo' ? 'repo' : 'entity';
        let parsed = null;
        if (side && category === 'entity') {
            const rp = side.repoPath ? path.resolve(side.repoPath) : '';
            parsed = {
                repoPrefix: rp ? path.basename(rp) : '',
                type: side.entityType,
                id: String(side.entityId),
                role: side.role != null ? String(side.role) : 'do',
                agent: side.agent != null ? String(side.agent) : null,
            };
        } else if (!side) {
            parsed = parseTmuxSessionName(trimmedName);
        }
        const sortedRepos = parsed && parsed.repoPrefix
            ? [...repos].sort((a, b) => {
                const aMatch = path.basename(path.resolve(a)) === parsed.repoPrefix ? -1 : 0;
                const bMatch = path.basename(path.resolve(b)) === parsed.repoPrefix ? -1 : 0;
                return aMatch - bMatch;
            })
            : repos;
        const isFeatureOrResearch = parsed && (parsed.type === 'f' || parsed.type === 'r');
        const stageResult = isFeatureOrResearch ? findEntityStage(sortedRepos, parsed.type, parsed.id) : null;
        const orphan = isFeatureOrResearch ? classifyOrphanReason(parsed.type, parsed.id, stageResult) : null;
        let repoPathResult = stageResult ? stageResult.repo : (parsed && parsed.repoPrefix
            ? repos.find(r => path.basename(path.resolve(r)) === parsed.repoPrefix) || null
            : null);
        if (side && side.repoPath) {
            repoPathResult = path.resolve(side.repoPath);
        }

        const sidecarTmuxId = side && side.tmuxId ? String(side.tmuxId) : null;
        const sidecarShellPid = side && Number.isFinite(side.shellPid) ? side.shellPid : null;

        return {
            name: trimmedName,
            createdAt: row.createdAt,
            attached: row.attached,
            category,
            tmuxId: row.tmuxId || sidecarTmuxId,
            shellPid: row.shellPid != null ? row.shellPid : sidecarShellPid,
            entityType: parsed ? parsed.type : null,
            entityId: parsed ? parsed.id : null,
            role: parsed ? parsed.role : (side && side.role ? String(side.role) : null),
            agent: parsed ? parsed.agent : (side && side.agent ? String(side.agent) : null),
            repoPath: repoPathResult ? path.resolve(repoPathResult) : null,
            stage: stageResult ? stageResult.stage : null,
            orphan,
        };
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * List tmux sessions enriched with entity and orphan data.
 * @returns {{ sessions: Array, orphanCount: number }}
 */
function getEnrichedSessions() {
    assertTmuxAvailable();
    const SEP = TMUX_SESSION_ROW_SEPARATOR;
    const fmt = `#{session_name}${SEP}#{session_created}${SEP}#{session_attached}${SEP}#{session_id}${SEP}#{pane_pid}`;
    const result = runTmux(['list-sessions', '-F', fmt], { encoding: 'utf8', stdio: 'pipe' });
    if (result.error || result.status !== 0) {
        return { sessions: [], orphanCount: 0 };
    }
    const repos = _readConductorReposFromGlobalConfig();
    const sessions = parseEnrichedTmuxSessionsOutput(result.stdout, repos);
    const orphanCount = sessions.filter(s => s.orphan).length;
    return { sessions, orphanCount };
}

/**
 * Match a tmux session name against a feature or research ID.
 * Handles new-style ({repo}-f{id}-{role}-{agent}), auto ({repo}-f{id}-auto),
 * and legacy ({repo}-f{id}-{agent}) names.
 * Returns { type: 'f'|'r', id: string, role: string, agent: string|null } or null.
 */
function matchTmuxSessionByEntityId(sessionName, entityId) {
    const parsed = parseTmuxSessionName(sessionName);
    if (!parsed) return null;
    if (toUnpaddedId(parsed.id) !== toUnpaddedId(entityId)) return null;
    return { type: parsed.type, id: parsed.id, role: parsed.role, agent: parsed.agent };
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

/**
 * Persist tmux session sidecar under `.aigon/sessions/{sessionName}.json`.
 *
 * Two categories are supported:
 *   - `entity` (default): bound to a feature/research/set; requires entityType + entityId.
 *   - `repo`: scoped to a repo + agent only (e.g. the dashboard "Ask agent" flow).
 *
 * `tmuxId` and `shellPid` are optional but should be supplied by callers — `tmuxId`
 * is the durable foreign key used by routing and liveness checks.
 *
 * @param {object} meta
 * @param {string} meta.sessionName
 * @param {string} meta.repoPath
 * @param {'entity'|'repo'} [meta.category]
 * @param {string} [meta.tmuxId]   e.g. "$12"
 * @param {number} [meta.shellPid]
 * @param {'f'|'r'|'S'} [meta.entityType] required for entity category
 * @param {string} [meta.entityId]        required for entity category
 * @param {string} [meta.agent]
 * @param {string} [meta.role]
 * @param {string} [meta.worktreePath]
 * @param {string} [meta.createdAt]
 */
function writeSessionSidecarRecord(meta) {
    const sessionName = meta.sessionName;
    if (!sessionName || !meta.repoPath) return;
    const category = meta.category === 'repo' ? 'repo' : 'entity';
    const record = {
        category,
        sessionName,
        repoPath: path.resolve(meta.repoPath),
        worktreePath: path.resolve(meta.worktreePath || process.cwd()),
        createdAt: meta.createdAt || new Date().toISOString(),
        agent: meta.agent != null ? String(meta.agent) : null,
    };
    if (meta.tmuxId) record.tmuxId = String(meta.tmuxId);
    if (Number.isFinite(meta.shellPid)) record.shellPid = meta.shellPid;
    if (category === 'entity') {
        const et = meta.entityType;
        if (et !== 'f' && et !== 'r' && et !== 'S') return;
        if (meta.entityId == null || String(meta.entityId).trim() === '') return;
        record.entityType = et;
        record.entityId = toUnpaddedId(String(meta.entityId));
        record.role = String(meta.role || 'do');
    }
    const dir = path.join(path.resolve(meta.repoPath), '.aigon', 'sessions');
    _safeWrite(path.join(dir, `${sessionName}.json`), JSON.stringify(record, null, 2));
}

/**
 * @param {string} sessionName
 * @param {string} cwd - tmux session working directory
 * @param {string} [command]
 * @param {object} [meta] - optional entity context for `.aigon/sessions/{sessionName}.json`
 */
function createDetachedTmuxSession(sessionName, cwd, command, meta) {
    const args = ['new-session', '-d', '-s', sessionName, '-c', cwd];
    // Wrap in bash -c so shell syntax (&&, unset, etc.) works correctly.
    // Without this, tmux passes the command directly to exec() which can't handle shell builtins.
    if (command) args.push(`bash -lc ${shellQuote(command)}`);
    const result = runTmux(args, { stdio: 'ignore' });
    if (result.error || result.status !== 0) {
        throw new Error(`Failed to create tmux session "${sessionName}"`);
    }
    // Capture the durable session ID and pane PID immediately so the sidecar
    // can carry them as a foreign key for routing and liveness.
    let tmuxId = null;
    let shellPid = null;
    try {
        const SEP = TMUX_SESSION_ROW_SEPARATOR;
        const idResult = runTmux(
            ['display-message', '-t', sessionName, '-p', `#{session_id}${SEP}#{pane_pid}`],
            { encoding: 'utf8', stdio: 'pipe' }
        );
        if (!idResult.error && idResult.status === 0) {
            const [idPart, pidPart] = String(idResult.stdout || '').trim().split(SEP);
            if (idPart) tmuxId = idPart.trim();
            const pid = Number.parseInt(pidPart, 10);
            if (Number.isFinite(pid)) shellPid = pid;
        }
    } catch (_) { /* tmuxId is best-effort */ }
    // Set terminal window title to the session name so windows are identifiable
    runTmux(['set-option', '-t', sessionName, 'set-titles', 'on'], { stdio: 'ignore' });
    runTmux(['set-option', '-t', sessionName, 'set-titles-string', '#{session_name}'], { stdio: 'ignore' });
    // Name the default window so menubar and list-windows show meaningful names
    runTmux(['rename-window', '-t', `${sessionName}:0`, sessionName], { stdio: 'ignore' });
    if (meta && meta.repoPath) {
        const resolvedWorktreePath = meta.worktreePath != null ? meta.worktreePath : cwd;
        const createdAt = meta.createdAt || new Date().toISOString();
        try {
            writeSessionSidecarRecord(Object.assign({}, meta, {
                sessionName,
                worktreePath: resolvedWorktreePath,
                tmuxId: meta.tmuxId || tmuxId,
                shellPid: Number.isFinite(meta.shellPid) ? meta.shellPid : shellPid,
                createdAt,
            }));
        } catch (_) { /* sidecar is best-effort */ }
        // Post-launch: background process binds agent session file to the sidecar
        if (meta.agent) {
            try {
                _getSessionSidecar().spawnCaptureProcess(
                    sessionName,
                    path.resolve(meta.repoPath),
                    path.resolve(resolvedWorktreePath),
                    meta.agent,
                    createdAt
                );
            } catch (_) { /* capture is best-effort */ }
        }
    }
    return { tmuxId, shellPid };
}

/**
 * Build a tmux `-t` target that prefers the durable session ID over the name.
 * Returns the ID when it's still in the live-session set, otherwise the name.
 *
 * Use the two-arg form `[target, ...]` directly with runTmux/spawn:
 *   const { target, isId } = resolveTmuxTarget(sidecar.tmuxId, name);
 *   runTmux(['send-keys', '-t', target, ...]);
 *
 * @param {string|null} tmuxId
 * @param {string} fallbackName
 * @returns {{ target: string, isId: boolean }}
 */
function resolveTmuxTarget(tmuxId, fallbackName) {
    const id = tmuxId ? String(tmuxId).trim() : '';
    if (!id) return { target: fallbackName, isId: false };
    const list = runTmux(['list-sessions', '-F', '#{session_id}'], { encoding: 'utf8', stdio: 'pipe' });
    if (list.error || list.status !== 0) {
        return { target: fallbackName, isId: false };
    }
    const live = new Set(
        String(list.stdout || '')
            .split('\n')
            .map(s => s.trim())
            .filter(Boolean)
    );
    if (live.has(id)) return { target: id, isId: true };
    if (process.env.AIGON_NO_SIDECAR_FALLBACK_WARN !== '1') {
        console.warn(`⚠️  tmux session ID ${id} not in live set — falling back to name "${fallbackName}"`);
    }
    return { target: fallbackName, isId: false };
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

function openTerminalAppWithCommand(cwd, command, title, terminalAppOverride = null) {
    // Test mode: never open a GUI terminal. Every caller across the
    // codebase (openSingleWorktree, ensureTmuxSession in dashboard-server,
    // handleLaunchImplementation, handleLaunchReview, handleLaunchEval)
    // routes through this function, so gating here covers all of them.
    // Without this, fleet tests left stray Terminal.app windows behind
    // showing `[exited]` after teardown nuked the tmpDir.
    if (process.env.AIGON_TEST_MODE === '1') {
        return;
    }

    const effectiveConfig = _getEffectiveConfig();
    const env = {
        platform: process.platform,
        terminalApp: terminalAppOverride || effectiveConfig.terminalApp || 'apple-terminal',
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

function ensureTmuxSessionForWorktree(wt, agentCommand, options = {}) {
    const restartExisting = options.restartExisting === true;
    const sessionName = buildTmuxSessionName(wt.featureId, wt.agent, { desc: wt.desc, worktreePath: wt.path, role: 'do' });
    const repoPath = path.resolve(wt.repoPath || _resolveMainRepoFromWorktreeWt(wt));
    const sessionMeta = {
        repoPath,
        entityType: wt.entityType === 'research' ? 'r' : 'f',
        entityId: wt.featureId,
        agent: wt.agent,
        role: 'do',
        worktreePath: wt.path ? path.resolve(wt.path) : repoPath,
    };
    if (tmuxSessionExists(sessionName)) {
        if (restartExisting) {
            try { runTmux(['kill-session', '-t', sessionName], { stdio: 'ignore' }); } catch (_) { /* ignore */ }
            createDetachedTmuxSession(sessionName, wt.path, agentCommand, sessionMeta);
            return { sessionName, created: true, restarted: true };
        }
        return { sessionName, created: false };
    }

    const listResult = spawnSync('tmux', ['list-sessions', '-F', '#S'], { encoding: 'utf8', stdio: 'pipe' });
    if (!listResult.error && listResult.status === 0) {
        const existing = listResult.stdout.split('\n').map(s => s.trim()).find(s => {
            const m = matchTmuxSessionByEntityId(s, wt.featureId);
            return m && m.agent === wt.agent && m.role === 'do';
        });
        if (existing) {
            if (restartExisting) {
                try { runTmux(['kill-session', '-t', existing], { stdio: 'ignore' }); } catch (_) { /* ignore */ }
                createDetachedTmuxSession(sessionName, wt.path, agentCommand, sessionMeta);
                return { sessionName, created: true, restarted: true };
            }
            return { sessionName: existing, created: false };
        }
    }

    createDetachedTmuxSession(sessionName, wt.path, agentCommand, sessionMeta);
    return { sessionName, created: true };
}

function openInWarpSplitPanes(worktreeConfigs, configName, title, tabColor) {
    if (process.platform === 'linux') {
        console.log('⚠️  Warp is not available on Linux. Use tmux to attach to agent sessions instead.');
        worktreeConfigs.forEach(wt => {
            const sessionName = buildTmuxSessionName(wt.featureId, wt.agent, { desc: wt.desc, worktreePath: wt.path, role: 'do' });
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
function openSingleWorktree(wt, agentCommand, terminalAppOverride = null) {
    try {
        assertTmuxAvailable();
        const { sessionName, created } = ensureTmuxSessionForWorktree(wt, agentCommand);
        if (process.env.AIGON_TEST_MODE === '1') {
            console.log(`\n🧪 [test-mode] Created background tmux session: ${sessionName}${created ? ' (created)' : ' (attached)'}`);
            return;
        }
        openTerminalAppWithCommand(wt.path, `tmux attach -t ${shellQuote(sessionName)}`, sessionName, terminalAppOverride);
        const terminalApp = terminalAppOverride || _getEffectiveConfig().terminalApp || 'apple-terminal';
        const terminalAppName = process.platform === 'linux'
            ? 'tmux'
            : (terminalAdapters.getDisplayName(terminalApp) || 'Terminal.app');
        console.log(`\n🚀 Opening worktree in tmux via ${terminalAppName}:`);
        console.log(`   Feature: ${wt.featureId} - ${wt.desc}`);
        console.log(`   Agent: ${wt.agent}`);
        console.log(`   Path: ${wt.path}`);
        console.log(`   Session: ${sessionName}${created ? ' (created)' : ' (attached)'}`);
    } catch (e) {
        console.error(`❌ Failed to open tmux session: ${e.message}`);
        const installHint = process.platform === 'linux' ? 'sudo apt install tmux  (or yum/pacman equivalent)' : 'brew install tmux';
        console.error(`   Install tmux: ${installHint}`);
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

// --- Trust functions (delegated to agent-registry) ---
// These are thin wrappers kept for backward compatibility with callers.
const __agentRegistry = require('./agent-registry');

/** Pre-seed Claude Code workspace trust for worktree directories. */
function presetWorktreeTrust(worktreePaths) { __agentRegistry.ensureAgentTrust('cc', worktreePaths); }

/** Remove Claude Code workspace trust entries for worktree directories. */
function removeWorktreeTrust(worktreePaths) {
    __agentRegistry.removeAgentTrust('cc', worktreePaths);
    __agentRegistry.removeAgentTrust('cx', worktreePaths);
}

/** Pre-seed Codex project trust. */
function presetCodexTrust(extraPaths) { __agentRegistry.ensureAgentTrust('cx', extraPaths || []); }

/** Pre-seed Gemini CLI workspace trust for worktree directories. */
function presetGeminiTrust(worktreePaths) { __agentRegistry.ensureAgentTrust('gg', worktreePaths); }

function installAgentGitAttribution(worktreePath, agentId, agentName) {
    const normalizedAgentId = String(agentId || '').trim().toLowerCase();
    if (!normalizedAgentId) return;
    const normalizedAgentName = String(agentName || normalizedAgentId).trim();
    const attributionDomain = _getAttributionDomain(worktreePath);
    const agentEmail = `${normalizedAgentId}@${attributionDomain}`;
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
ATTRIBUTION_DOMAIN="$(git config --get aigon.attributionDomain || true)"

[ -n "$AGENT_ID" ] || exit 0
[ -n "$AGENT_NAME" ] || AGENT_NAME="$AGENT_ID"
[ -n "$ATTRIBUTION_DOMAIN" ] || ATTRIBUTION_DOMAIN="${attributionDomain}"
[ -n "$AGENT_EMAIL" ] || AGENT_EMAIL="$AGENT_ID@$ATTRIBUTION_DOMAIN"
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
ATTRIBUTION_DOMAIN="$(git config --get aigon.attributionDomain || true)"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"

[ -n "$AGENT_ID" ] || exit 0
[ -n "$AGENT_NAME" ] || AGENT_NAME="$AGENT_ID"
[ -n "$ATTRIBUTION_DOMAIN" ] || ATTRIBUTION_DOMAIN="${attributionDomain}"
[ -n "$AGENT_EMAIL" ] || AGENT_EMAIL="$AGENT_ID@$ATTRIBUTION_DOMAIN"

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
        // CRITICAL: enable worktree-scoped config BEFORE writing per-agent settings.
        //
        // Without extensions.worktreeConfig=true, `git config --local` in a linked
        // worktree writes to the SHARED .git/config file (the main repo's config).
        // That would let any worktree bootstrap leak into the human user's git
        // identity and future commits.
        //
        // With extensions.worktreeConfig=true, `git config --worktree` writes to
        // a per-worktree config file (.git/worktrees/<name>/config.worktree) that
        // only affects that worktree. The main repo's .git/config is never touched.
        //
        // This line is idempotent — writing it twice is a no-op.
        execSync(`git -C ${wt} config --local extensions.worktreeConfig true`, { stdio: 'pipe' });
        execSync(`git -C ${wt} config --worktree aigon.agentId ${shellQuote(normalizedAgentId)}`, { stdio: 'pipe' });
        execSync(`git -C ${wt} config --worktree aigon.agentName ${shellQuote(normalizedAgentName)}`, { stdio: 'pipe' });
        execSync(`git -C ${wt} config --worktree aigon.agentEmail ${shellQuote(agentEmail)}`, { stdio: 'pipe' });
        execSync(`git -C ${wt} config --worktree aigon.attributionDomain ${shellQuote(attributionDomain)}`, { stdio: 'pipe' });
        execSync(`git -C ${wt} config --worktree core.hooksPath ${shellQuote('.aigon/git-hooks')}`, { stdio: 'pipe' });
        execSync(`git -C ${wt} config --worktree notes.rewriteRef ${shellQuote('refs/notes/aigon-attribution')}`, { stdio: 'pipe' });
        execSync(`git -C ${wt} config --worktree notes.rewriteMode ${shellQuote('concatenate')}`, { stdio: 'pipe' });
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
        logsDirPath,
        createImplementationLog = true
    } = options;

    const envLocalPath = path.join(process.cwd(), '.env.local');
    const AGENT_CONFIGS = _getAgentConfigs();
    const agentMeta = AGENT_CONFIGS[agentId] || {};
    const paddedFeatureId = String(featureId).padStart(2, '0');

    installAgentGitAttribution(worktreePath, agentId, agentMeta.name || agentId);
    const attributionDomain = _getAttributionDomain(worktreePath);
    console.log(`   🏷️  Git attribution enabled (${agentId}@${attributionDomain}, metadata + trailers + notes)`);
    try {
        __agentRegistry.ensureAgentTrust('cx', [worktreePath]);
    } catch (_) { /* best-effort */ }

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

    // Pre-register worktree as trusted for agents that require it (e.g. Gemini CLI)
    const _agentRegistry = require('./agent-registry');
    _agentRegistry.ensureSinglePathTrust(agentId, worktreePath);

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
    if (createImplementationLog) {
        const logName = `feature-${featureId}-${agentId}-${desc}-log.md`;
        const logPath = path.join(logsDirPath, logName);
        const template = `# Implementation Log: Feature ${featureId} - ${desc}\nAgent: ${agentId}\n\n## Status\n\n## New API Surface\n\n## Key Decisions\n\n## Gotchas / Known Issues\n\n## Explicitly Deferred\n\n## For the Next Feature in This Set\n\n## Test Coverage\n`;
        fs.writeFileSync(logPath, template);
        console.log(`   \uD83D\uDCDD Log: docs/specs/features/logs/${logName}`);
    }

    // Commit ALL worktree setup files so agents start with a clean working tree
    try {
        const stageFiles = ['.gitignore'];
        if (createImplementationLog) {
            stageFiles.push(path.join('docs', 'specs', 'features', 'logs', `feature-${featureId}-${agentId}-${desc}-log.md`));
        }
        execSync(`git add -- ${stageFiles.map(file => JSON.stringify(file)).join(' ')}`, { cwd: worktreePath, stdio: 'pipe' });
        execSync(`git commit -m "chore: worktree setup for ${agentId}"`, { cwd: worktreePath, stdio: 'pipe' });
    } catch (e) { /* nothing to commit */ }
}

function ensureAgentSessions(entityId, agents, options) {
    const {
        sessionNameBuilder,
        cwdBuilder,
        commandBuilder,
        restartExisting = false,
        sessionMetaBuilder,
    } = options;

    return agents.map(agent => {
        const sessionName = sessionNameBuilder(entityId, agent);
        // Launch via `bash -lc 'COMMAND'` (atomic) rather than
        // create-empty-then-send-keys. The split approach raced against any
        // other caller that also issued send-keys to the same pane, producing
        // byte-interleaved launch commands with unclosed quotes — see
        // 2026-04-21 F292/F293 corruption.
        const command = commandBuilder ? commandBuilder(entityId, agent) : null;
        const cwd = cwdBuilder(entityId, agent);
        const meta = sessionMetaBuilder ? sessionMetaBuilder(sessionName, entityId, agent, cwd) : null;
        if (tmuxSessionExists(sessionName)) {
            if (restartExisting) {
                try { runTmux(['kill-session', '-t', sessionName], { stdio: 'ignore' }); } catch (_) { /* ignore */ }
                try {
                    createDetachedTmuxSession(sessionName, cwd, command, meta);
                    return { agent, sessionName, created: true, restarted: true, error: null };
                } catch (error) {
                    return { agent, sessionName, created: false, restarted: true, error };
                }
            }
            return { agent, sessionName, created: false, error: null };
        }
        try {
            createDetachedTmuxSession(sessionName, cwd, command, meta);
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
    // Detect the tmux session this process is running inside, if any.
    // We must never kill our own host — sending Ctrl+C to it delivers SIGINT
    // to our own process group and aborts the cleanup mid-run (f281 symptom).
    const currentSession = (() => {
        if (!process.env.TMUX) return null;
        const paneId = process.env.TMUX_PANE;
        const args = paneId
            ? ['display-message', '-t', paneId, '-p', '#{session_name}']
            : ['display-message', '-p', '#{session_name}'];
        const r = runTmux(args, { encoding: 'utf8', stdio: 'pipe' });
        if (r.error || r.status !== 0) return null;
        return String(r.stdout || '').trim() || null;
    })();

    function findMatchingSessions() {
        const list = runTmux(['list-sessions', '-F', '#{session_name}'], { encoding: 'utf8', stdio: 'pipe' });
        if (list.error || list.status !== 0) return [];
        return list.stdout
            .split('\n')
            .map(s => s.trim())
            .filter(Boolean)
            .filter(s => {
                if (currentSession && s === currentSession) return false;
                const parsed = parseTmuxSessionName(s);
                return parsed && parsed.type === entityType && toUnpaddedId(parsed.id) === toUnpaddedId(entityId);
            });
    }

    // Find all matching tmux sessions
    const matching = findMatchingSessions();

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
        runTmux(['send-keys', '-t', sessionName, 'C-c'], { stdio: 'ignore' });
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

    // Final verification: if anything still survives, retry against the live session list.
    const survivors = findMatchingSessions();
    survivors.forEach(sessionName => {
        const kill = runTmux(['kill-session', '-t', sessionName], { stdio: 'ignore' });
        if (!kill.error && kill.status === 0) closed++;
    });

    const remaining = findMatchingSessions();

    return { closed, sessions: matching, remaining };
}

module.exports = {
    getWorktreeBase,
    getWorktreeBaseForRepo,
    findWorktrees,
    filterByFeatureId,
    buildAgentCommand,
    buildRawAgentCommand,
    getAgentSignalCapabilities,
    buildResearchAgentCommand,
    toUnpaddedId,
    VALID_TMUX_ROLES,
    buildTmuxSessionName,
    buildResearchTmuxSessionName,
    parseTmuxSessionName,
    matchTmuxSessionByEntityId,
    assertTmuxAvailable,
    tmuxSessionExists,
    resolveTmuxTarget,
    writeSessionSidecarRecord,
    loadSessionSidecarIndex,
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
    reconcileWorktreeJson,
    resolveHeartbeatStateDir: _getHeartbeatStateDir,
    ensureAgentSessions,
    getEnrichedSessions,
    parseEnrichedTmuxSessionsOutput,
    tileITerm2Windows,
    runTmux,
    gracefullyCloseEntitySessions,
};
