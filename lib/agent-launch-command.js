'use strict';

// Agent launch command composition: shell-trap wrapper, heartbeat, env exports (F632).

const fs = require('fs');
const path = require('path');
const os = require('os');
const { shellQuote } = require('./terminal-adapters');
const { buildTmuxSessionName } = require('./agent-sessions/names');
const { buildAgentLaunchInvocation } = require('./agent-launch');

function getAgentCliConfig(agentId, repoPath) {
    return require('./config').getAgentCliConfig(agentId, repoPath);
}
function getAgentLaunchFlagTokens(command, flagValue, options) {
    return require('./config').getAgentLaunchFlagTokens(command, flagValue, options);
}
function loadAgentConfig(agentId) {
    return require('./templates').loadAgentConfig(agentId);
}

const INLINE_PROMPT_FILE_THRESHOLD = 4000;

function looksLikePoisonedHome(home) {
    const value = String(home || '').trim();
    if (!value) return true;
    const tmpDir = path.resolve(os.tmpdir());
    let resolved;
    try {
        resolved = path.resolve(value);
    } catch (_) {
        return true;
    }
    return resolved === tmpDir || resolved.startsWith(`${tmpDir}${path.sep}`);
}

function resolveSafeHome() {
    const inherited = process.env.HOME || os.homedir();
    if (process.env.AIGON_TEST_MODE === '1') return inherited;
    if (!looksLikePoisonedHome(inherited)) return inherited;
    try {
        return os.userInfo().homedir || os.homedir();
    } catch (_) {
        return os.homedir();
    }
}

function writeInlinePromptFile(wt, verb, body) {
    const repoName = path.basename(path.resolve(wt.repoPath || wt.path || process.cwd()));
    const entityType = wt.entityType === 'research' ? 'research' : 'feature';
    const dir = path.join(os.tmpdir(), 'aigon-inline-prompts', repoName);
    fs.mkdirSync(dir, { recursive: true });
    // Agent ID MUST be in the filename. Fleet mode fans out multiple agents
    // concurrently; each call to this helper renders the template with the
    // agent's own placeholders (including {{AGENT_ID}}). Without the agent
    // segment all slots share one path and the bash `$(< file)` substitution
    // — which runs asynchronously inside each tmux session — reads whichever
    // write happened last. Symptom: every Fleet research agent thinks it is
    // the last-writer (e.g. gg believing it is cu, writing to cu-findings.md,
    // signalling research-complete for cu). Introduced 2026-04-29 bfd5047b
    // when cc/cu/gg research-do/eval/review joined the inline-prompt path.
    const agent = wt.slotAgentId || wt.agent || 'unknown';
    const filePath = path.join(dir, `${entityType}-${wt.featureId}-${agent}-${verb}.md`);
    fs.writeFileSync(filePath, body);
    return filePath;
}

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

    const deactivatedMsg = agentRegistry.formatDeactivatedAgentMessage(wt.agent);
    if (deactivatedMsg) {
        throw new Error(`Cannot launch: ${deactivatedMsg}`);
    }

    // Optional escape hatch for callers that need the wrapped shell-trap path
    // but must run a specific internal CLI command (e.g. autopilot).
    if (wt && typeof wt.rawCommand === 'string' && wt.rawCommand.trim()) {
        const absPath = wt.path ? path.resolve(wt.path) : null;
        const envOverrides = absPath ? agentRegistry.getWorktreeEnvExports(wt.agent, absPath) : '';
        const cdPrefix = absPath ? `cd ${shellQuote(absPath)} && ${envOverrides}` : '';
        return `${cdPrefix}${wt.rawCommand.trim()}`;
    }

    const configRepoPath = wt.repoPath || process.cwd();
    const cliConfig = getAgentCliConfig(wt.agent, configRepoPath);
    const isResearch = wt.entityType === 'research';
    const normalizedTaskType = taskType === 'implement' ? 'do'
        : taskType === 'evaluate' ? 'eval'
        : taskType;
    const researchCommands = {
        do: 'research-do',
        eval: 'research-eval',
        review: 'research-review',
        'spec-review': 'research-spec-review',
        'spec-revise': 'research-spec-revise',
        'spec-check': 'research-spec-revise',
        'research-review': 'research-review'
    };
    let prompt;
    let modelKey;
    if (isResearch) {
        const agentConfig = loadAgentConfig(wt.agent);
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
            const promptFile = writeInlinePromptFile(wt, command, promptText);
            prompt = `$(< ${shellQuote(promptFile)})`;
        } else if (isHeadless) {
            // Slash-invocable but no command bundle (e.g. Gemini, and cc/cu which don't
            // ship a top-level `commands` array): cannot resolve /aigon:… in headless mode.
            // Inline the canonical markdown body of the command (same path the feature side
            // uses) so the agent sees the full template — including the "When You're Done"
            // hard rules ("aigon agent-status …-complete must exit 0 before you say done").
            //
            // Previous behaviour for `do` was a thin descriptive prompt
            //   `Read AGENTS.md … run \`aigon ${command} ${id}\` … follow its output`
            // which silently dropped the completion-signal contract because the bash
            // command's stdout doesn't reproduce the template's hard rules. Result: cc/cu/gg
            // research sessions wrote findings then idled at the prompt without ever calling
            // aigon agent-status research-complete (verified against r45/r46 tmux history).
            const isDoTaskType = normalizedTaskType === 'do';
            const argsString = isDoTaskType ? String(wt.featureId) : `${wt.featureId} --no-launch`;
            const { resolveCxCommandBody } = require('./agent-prompt-resolver');
            const promptText = resolveCxCommandBody(command, argsString, wt.agent);
            const promptFile = writeInlinePromptFile(wt, command, promptText);
            prompt = `$(< ${shellQuote(promptFile)})`;
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
        if (!verb && !['spec-review', 'spec-revise', 'spec-check'].includes(normalizedTaskType)) {
            throw new Error(`Unsupported feature task type: ${normalizedTaskType}`);
        }
        // When launching eval/review from a non-CLI entry point (dashboard,
        // tmux), skip the CLI's outer launch mode so the agent's slash
        // command runs directly without re-spawning a nested session.
        const { resolveAgentCommandPrompt, resolveAgentPromptBody } = require('./agent-prompt-resolver');
        const promptCommandName = normalizedTaskType === 'spec-review'
            ? 'feature-spec-review'
            : (normalizedTaskType === 'spec-revise' || normalizedTaskType === 'spec-check')
                ? 'feature-spec-revise'
                : verb;
        const promptText = wt.promptOverride
            ? String(wt.promptOverride)
            : (normalizedTaskType === 'spec-review' || normalizedTaskType === 'spec-revise' || normalizedTaskType === 'spec-check'
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
        if (!agentRegistry.isSlashCommandInvocable(wt.agent) || promptText.length > INLINE_PROMPT_FILE_THRESHOLD) {
            // Inline path (cx, op, any non-slash-invocable agent): the
            // prompt body is full markdown (KB-scale) with $-tokens,
            // backticks, and quotes. Embedding it directly in a shell
            // command would require escaping every metacharacter.
            // Slash-invocable agents (cc, cu) normally take a short slash
            // command, but set-wide spec revise/review overrides can embed
            // every member spec — far past tmux/bash ARG_MAX. Spill those
            // to the same temp-file path so dashboard tmux launch works.
            // Instead persist it to a temp file and reference it via the
            // bash `$(< file)` form, which substitutes the file contents
            // verbatim without any further interpretation.
            const promptFile = writeInlinePromptFile(wt, promptCommandName, promptText);
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
    const featureSnapshot = wt.snapshot || loadFeatureSnapshotForWorktree(wt);
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
    // Override agent-specific worktree env vars when declared on the agent config.
    const absPath = wt.path ? path.resolve(wt.path) : null;
    const envOverrides = absPath ? agentRegistry.getWorktreeEnvExports(wt.agent, absPath) : '';
    const cdPrefix = absPath ? `cd ${shellQuote(absPath)} && ${envOverrides}` : '';

    const flagTokens = getAgentLaunchFlagTokens(cliConfig.command, cliConfig.implementFlag, {
        autonomous: false,
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
    const stdinRedirect = '';
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
        if (cliConfig.injectViaTmuxSkillCommand) {
            const agentCfg = loadAgentConfig(wt.agent);
            const cmdPrefix = agentCfg?.placeholders?.CMD_PREFIX || 'aigon-';
            const skillCommandName = isResearch
                ? (researchCommands[normalizedTaskType] || normalizedTaskType)
                : (normalizedTaskType === 'do' ? 'feature-do'
                    : normalizedTaskType === 'eval' ? 'feature-eval'
                    : normalizedTaskType === 'review' ? 'feature-code-review'
                    : normalizedTaskType === 'spec-review' ? 'feature-spec-review'
                    : 'feature-spec-revise');
            wt._injectSkillCommand = `/skill:${cmdPrefix}${skillCommandName} ${wt.featureId}`;
            // Store the expected skill file path so the injection subshell can auto-install
            // if the commandDir is gitignored (e.g. km's .agents/skills/).
            const commandDir = agentCfg?.output?.commandDir || '';
            const commandFilePrefix = agentCfg?.output?.commandFilePrefix || '';
            const isGlobal = agentCfg?.output?.global === true;
            if (!isGlobal && commandDir) {
                wt._injectSkillFile = `${commandDir}/${commandFilePrefix}${skillCommandName}`;
            }
        } else {
            const m = String(prompt || '').match(/^\$\(<\s+(.+?)\s*\)$/);
            if (m) {
                wt._injectPromptFile = m[1].replace(/^'(.+)'$/, '$1').replace(/^"(.+)"$/, '$1');
            }
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
    const agentConfig = loadAgentConfig(agentId);
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
function loadFeatureSnapshotForWorktree(wt) {
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

function getHeartbeatIntervalSecs() {
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
function getHeartbeatStateDir(wt) {
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
function resolveMainRepoFromWorktreeWt(wt) {
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

function buildAgentWrapperEnvironmentLines() {
    const home = resolveSafeHome();
    const lines = [];
    if (home) {
        lines.push(`export HOME=${shellQuote(home)}`);
    }
    if (process.env.USERPROFILE) {
        lines.push(`export USERPROFILE=${shellQuote(process.env.USERPROFILE)}`);
    } else {
        lines.push('unset USERPROFILE');
    }

    for (const key of [
        'AIGON_TEST_MODE',
        'PLAYWRIGHT_TEST',
        'MOCK_DELAY',
        'AIGON_FORCE_PRO',
        'GIT_CONFIG_GLOBAL',
        'GIT_CONFIG_SYSTEM',
        'PORT',
    ]) {
        if (Object.prototype.hasOwnProperty.call(process.env, key)) {
            lines.push(`export ${key}=${shellQuote(process.env[key])}`);
        } else {
            lines.push(`unset ${key}`);
        }
    }
    return lines;
}

/**
 * Build the agent CLI command string for a worktree or entity session.
 * Wraps the raw agent command in a shell script with:
 *   - trap EXIT handler that reports completion through agent-status compatibility
 *   - agent-status implementing on session start, recorded as a session signal
 *   - background heartbeat sidecar (file touch)
 *
 * The shell trap is the universal signal foundation for lifecycle signals.
 * The trap fires on normal exit, SIGINT, and SIGTERM. It does NOT fire on
 * SIGKILL or machine crash (the orchestrator sweep handles those).
 *
 * Exception — OpenCode (`op`) and Kimi (`km`): launched in bare TUI mode
 * (`opencode` / `kimi term`). A background subshell polls the pane for an
 * authenticated-ready marker, then pastes the prompt file via tmux
 * paste-buffer and sends Enter. The EXIT trap on the wrapper shell fires
 * agent-status on TUI exit just like any other agent.
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
    // Slot identity vs runtime identity. After a failover, `wt.agent` is the
    // replacement runtime (e.g. cu) but `wt.slotAgentId` is the original slot
    // (e.g. cx). Engine state — agent-status files, heartbeat files,
    // workflow-snapshot keys — is all keyed on the slot. So AIGON_AGENT_ID
    // and the heartbeat path must use the slot, not the runtime, or the
    // post-failover agent's `aigon agent-status …` calls write to the wrong
    // file and the engine never sees them.
    const agentId = wt.slotAgentId || wt.agent;
    const heartbeatIntervalSecs = getHeartbeatIntervalSecs();
    const heartbeatStateDir = getHeartbeatStateDir(wt);
    const heartbeatFile = path.join(heartbeatStateDir, `heartbeat-${featureId}-${agentId}`);
    // Map session task → legacy compatibility status names. Lifecycle policy
    // lives in AgentSessionService/WorkflowSignalBridge; the wrapper only
    // reports role, task type, exit code, and the historical status string.
    // 'do' for research entities resolves to 'research-complete' so the trap
    // matches the entity-aware semantic introduced by F404.
    const isResearchEntity = wt.entityType === 'research';
    const successStatus = ({
        review: 'review-complete',
        'spec-review': 'spec-review-complete',
        'spec-revise': 'spec-review-complete',
        'spec-check': 'spec-review-complete',
        revise: 'revision-complete',
        do: isResearchEntity ? 'research-complete' : 'implementation-complete',
        eval: isResearchEntity ? 'research-complete' : 'implementation-complete',
    })[taskType] || (isResearchEntity ? 'research-complete' : 'implementation-complete');
    const startStatus = ({
        review: 'reviewing',
        'spec-review': 'spec-reviewing',
        'spec-revise': 'addressing-spec-review',
        'spec-check': 'addressing-spec-review',
        revise: 'addressing-code-review',
        do: 'implementing',
        eval: 'implementing',
    })[taskType] || 'implementing';
    // Persist the taskType into the agent-status file (read by the mismatch
    // checker on completion). Mapping eval → do keeps the semantic narrow:
    // implementation-complete is the right completion for an eval session.
    const recordedTaskType = ({
        review: 'review',
        'spec-review': 'spec-review',
        'spec-revise': 'spec-revise',
        'spec-check': 'spec-check',
        revise: 'revise',
        do: 'do',
        eval: 'do',
    })[taskType] || 'do';

    // Build the heartbeat sidecar snippet (background loop tied to parent PID).
    // Three independent stop guards: parent-alive AND tmux-session-exists AND elapsed-under-ceiling.
    // Guards are belt-and-braces: if the parent hangs in the EXIT trap (e.g. agent-status call
    // blocked), the time ceiling and tmux-gone check still terminate the sidecar.
    const heartbeatLines = [];
    if (signals.heartbeatSidecar) {
        const leaseRole = isResearchEntity ? 'research' : 'impl';
        const renewLeaseInSidecar = taskType === 'do' || taskType === 'eval';
        heartbeatLines.push(
            `mkdir -p ${shellQuote(heartbeatStateDir)}`,
            `(`,
            `  _aigon_hb_start=$(date +%s 2>/dev/null || echo 0)`,
            `  _aigon_lease_tick=0`,
            `  _aigon_hb_max=\${AIGON_HEARTBEAT_MAX_SECS:-21600}`,
            `  while kill -0 $$ 2>/dev/null; do`,
            `    _aigon_hb_now=$(date +%s 2>/dev/null || echo 0)`,
            `    [ $(( _aigon_hb_now - _aigon_hb_start )) -ge "$_aigon_hb_max" ] && break`,
            `    if [ -n "\${TMUX_PANE:-}" ] && command -v tmux >/dev/null 2>&1; then`,
            `      _aigon_hb_sess=$(tmux display-message -p "#{session_name}" 2>/dev/null)`,
            `      if [ -n "$_aigon_hb_sess" ] && ! tmux has-session -t "$_aigon_hb_sess" 2>/dev/null; then`,
            `        break`,
            `      fi`,
            `    fi`,
            `    touch ${shellQuote(heartbeatFile)}`,
            ...(renewLeaseInSidecar ? [
                `    _aigon_lease_tick=$(( _aigon_lease_tick + 1 ))`,
                `    if [ $(( _aigon_lease_tick % 4 )) -eq 0 ]; then`,
                `      aigon storage lease-renew ${isResearchEntity ? 'research' : 'feature'} ${featureId} --role=${leaseRole} >/dev/null 2>&1 || true`,
                `    fi`,
            ] : []),
            `    sleep ${heartbeatIntervalSecs}`,
            `  done`,
            `) &`,
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
            : (taskType === 'spec-review' || taskType === 'spec-revise' || taskType === 'spec-check') ? 'spec_review'
            : 'implement';
        telemetryEnvLines.push(`export AIGON_ACTIVITY=${activity}`);
        try {
            const { readStats } = require('./feature-status');
            const mainRepo = resolveMainRepoFromWorktreeWt(wt);
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
    // prompt until `feature-close` / `sessions-close` kills it.
    //
    // OpenCode (`op`) and Kimi (`km`): launched in TUI mode with no initial
    // prompt argument; the prompt is pasted into the TUI post-launch by a
    // backgrounded subshell (see injection block below).
    const agentAliasMap = require('./agent-registry').getAgentAliasMap();
    const canonicalAgentId = agentAliasMap[String(wt.agent || '').trim().toLowerCase()] || String(wt.agent || '').trim();
    const agentInvocationLines = [rawCmd];

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
    //   amp: "Welcome to Amp" — the welcome screen greeting; only appears
    //     after the TUI is fully loaded and ready for input.
    const injectionLines = (wt._injectPromptFile || wt._injectSkillCommand) ? [
        '(',
        '  _aigon_inject_session=$(tmux display-message -p "#{session_name}" 2>/dev/null)',
        '  _aigon_inject_log="${TMPDIR:-/tmp}/aigon-inject-${AIGON_ENTITY_ID:-?}-${AIGON_AGENT_ID:-?}.log"',
        '  echo "[inject] session=$_aigon_inject_session pid=$$ $(date)" >> "$_aigon_inject_log" 2>/dev/null',
        '  for _ in $(seq 1 150); do',
        '    sleep 0.2',
        '    if tmux capture-pane -p -t "$_aigon_inject_session" 2>/dev/null \\',
        '        | grep -qE "Ask anything|Kimi-k2|Welcome to Amp"; then',
        '      break',
        '    fi',
        '  done',
        '  echo "[inject] polling done, sleeping before inject" >> "$_aigon_inject_log" 2>/dev/null',
        '  sleep 1.5',
        '  if [ -n "$_aigon_inject_session" ] && tmux has-session -t "$_aigon_inject_session" 2>/dev/null; then',
        // Defensive: exit copy/view mode so send-keys -l / paste-buffer don't hang on a
        // scrolled-up pane. tmux silently no-ops -X cancel when no mode is active.
        '    tmux send-keys -t "$_aigon_inject_session" -X cancel 2>/dev/null',
        ...(wt._injectSkillCommand ? [
            // .agents/skills/ is gitignored — install if missing so the skill command resolves.
            ...(wt._injectSkillFile ? [
                `    if [ ! -f ${shellQuote(wt._injectSkillFile)} ]; then`,
                `      echo "[inject] installing agent ${shellQuote(wt.agent)} (skill missing)" >> "$_aigon_inject_log"`,
                `      aigon install-agent ${shellQuote(wt.agent)} >>"$_aigon_inject_log" 2>&1 || true`,
                `    fi`,
            ] : []),
            `    tmux send-keys -t "$_aigon_inject_session" -l ${shellQuote(wt._injectSkillCommand)} 2>/dev/null`,
            '    echo "[inject] skill command sent" >> "$_aigon_inject_log" 2>/dev/null',
        ] : [
            '    _aigon_inject_buf="aigon-inject-$$"',
            `    tmux load-buffer -b "$_aigon_inject_buf" ${shellQuote(wt._injectPromptFile)} 2>/dev/null`,
            '    echo "[inject] pasting buffer (bracketed paste)" >> "$_aigon_inject_log" 2>/dev/null',
            '    tmux paste-buffer -p -b "$_aigon_inject_buf" -t "$_aigon_inject_session" -d 2>/dev/null',
            '    sleep 0.8',
        ]),
        '    tmux send-keys -t "$_aigon_inject_session" Enter 2>/dev/null',
        '    echo "[inject] Enter sent" >> "$_aigon_inject_log" 2>/dev/null',
        '  else',
        '    echo "[inject] SKIP: session empty or gone" >> "$_aigon_inject_log" 2>/dev/null',
        '  fi',
        ') &',
    ] : [];

    const lines = [
        // tmux servers are long-lived and keep the environment from the process
        // that first started them. Reassert the launching Aigon process env so
        // stale test-mode HOME/flags cannot leak into real agent panes.
        ...buildAgentWrapperEnvironmentLines(),
        // Entity context — agent-status reads these instead of parsing tmux session names
        `export AIGON_ENTITY_TYPE=${entityType}`,
        `export AIGON_ENTITY_ID=${featureId}`,
        `export AIGON_AGENT_ID=${agentId}`,
        `export AIGON_RUNTIME_AGENT_ID=${shellQuote(wt.agent)}`,
        `export AIGON_PROJECT_PATH=${shellQuote(path.resolve(wt.repoPath || process.cwd()))}`,
        ...telemetryEnvLines,
        // Start liveness before any advisory/bootstrap work. This makes the
        // dashboard's post-start "booting" window reflect a real tmux process
        // as soon as the wrapper is alive, not after trust/version checks.
        ...heartbeatLines,
        // Signal runtime status on start (also records taskType for mismatch checks)
        `AIGON_SKIP_FIRST_RUN=1 AIGON_TASK_TYPE=${recordedTaskType} aigon agent-status ${startStatus} 2>/dev/null || true`,
        // Self-healing trust: explicit worktree path (tmux -c cwd is usually correct, but this
        // is deterministic for Cursor Agent markers + other agents' trust registries).
        wt.path
            ? `AIGON_SKIP_FIRST_RUN=1 aigon trust-worktree ${shellQuote(path.resolve(wt.path))} 2>/dev/null || true`
            : 'AIGON_SKIP_FIRST_RUN=1 aigon trust-worktree "$(pwd)" 2>/dev/null || true',
        // Define cleanup function.
        // agent-status calls are time-bounded: a hanging dashboard server or stale command
        // shape must not block the trap forever (which would keep every downstream child alive).
        // _aigon_run_timed runs its arguments in the background with a watcher that sends
        // SIGTERM after AIGON_STATUS_TIMEOUT_SECS (default 5s), then waits for completion.
        '_aigon_run_timed() {',
        '  "$@" &',
        '  local _aigon_rt_pid=$!',
        '  ( sleep "${AIGON_STATUS_TIMEOUT_SECS:-5}"; kill "$_aigon_rt_pid" 2>/dev/null ) &',
        '  local _aigon_rt_tpid=$!',
        '  wait "$_aigon_rt_pid" 2>/dev/null || true',
        '  kill "$_aigon_rt_tpid" 2>/dev/null; wait "$_aigon_rt_tpid" 2>/dev/null || true',
        '}',
        '_aigon_cleanup() {',
        '  _aigon_exit_code=$?',
        '  _aigon_pane_tail=""',
        '  if [ -n "${TMUX_PANE:-}" ] && command -v tmux >/dev/null 2>&1 && command -v base64 >/dev/null 2>&1; then',
        '    _aigon_pane_tail=$(tmux capture-pane -p -S -120 -t "$TMUX_PANE" 2>/dev/null | tail -120 | base64 | tr -d "\\n" || true)',
        '  fi',
        cleanupKillHb ? `  ${cleanupKillHb}` : null,
        '  if [ $_aigon_exit_code -eq 0 ]; then',
        `    _aigon_run_timed env AIGON_SKIP_FIRST_RUN=1 aigon agent-status ${successStatus} 2>/dev/null || true`,
        '  else',
        '    _aigon_run_timed env AIGON_SKIP_FIRST_RUN=1 AIGON_EXIT_CODE="$_aigon_exit_code" AIGON_PANE_TAIL_B64="$_aigon_pane_tail" aigon agent-status error 2>/dev/null || true',
        '  fi',
        '}',
        // Install trap
        'trap _aigon_cleanup EXIT',
        // Drift notice for agents without a hook framework (km, op, cx).
        // Hook-capable agents (cc, gg, cu) receive this via their SessionStart hook instead.
        ...(signals.cliHooks ? [] : [
            'aigon check-version --notice-only || true',
        ]),
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
module.exports = {
    INLINE_PROMPT_FILE_THRESHOLD,
    buildRawAgentCommand,
    buildAgentCommand,
    buildResearchAgentCommand,
    getAgentSignalCapabilities,
    looksLikePoisonedHome,
    resolveSafeHome,
    buildAgentWrapperEnvironmentLines,
    resolveHeartbeatStateDir: getHeartbeatStateDir,
    loadFeatureSnapshotForWorktree,
};
