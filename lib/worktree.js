'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync, spawn } = require('child_process');
const git = require('./git');
const stateMachine = require('./state-machine');

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
 * Build the agent CLI command string for a worktree.
 */
function buildAgentCommand(wt, taskType = 'implement') {
    const cliConfig = _getAgentCliConfig(wt.agent);
    const prompt = cliConfig.implementPrompt.replaceAll('{featureId}', wt.featureId);
    // Unset CLAUDECODE to prevent "nested session" error when launched from a Claude Code terminal
    const prefix = cliConfig.command === 'claude' ? 'unset CLAUDECODE && ' : '';

    const model = cliConfig.models?.[taskType];
    const modelFlag = model ? `--model ${model}` : '';

    // Name the CC session using the same format as tmux sessions (e.g. aigon-f55-cc-dark-mode)
    const nameFlag = cliConfig.command === 'claude'
        ? `--name "${buildTmuxSessionName(wt.featureId, wt.agent, { desc: wt.desc, worktreePath: wt.path })}"`
        : '';

    const flagTokens = _getAgentLaunchFlagTokens(cliConfig.command, cliConfig.implementFlag, { autonomous: false });
    const flags = [...flagTokens, modelFlag, nameFlag].filter(Boolean).join(' ');
    if (flags) {
        return `${prefix}${cliConfig.command} ${flags} "${prompt}"`;
    }
    return `${prefix}${cliConfig.command} "${prompt}"`;
}

/**
 * Build the agent CLI command string for research conduct.
 * @param {string} agentId - Agent ID (cc, gg, cx, cu)
 * @param {string} researchId - Research ID (padded, e.g., "05")
 * @returns {string} Command string to run the agent CLI with research-do
 */
function buildResearchAgentCommand(agentId, researchId) {
    const cliConfig = _getAgentCliConfig(agentId);
    const agentConfig = _loadAgentConfig(agentId);

    // Research commands use the agent's CMD_PREFIX placeholder
    // e.g., "/aigon:research-do" for Claude/Gemini, "/aigon-research-do" for Cursor
    const cmdPrefix = agentConfig?.placeholders?.CMD_PREFIX || '/aigon:';
    const prompt = `${cmdPrefix}research-do ${researchId}`;

    // Unset CLAUDECODE to prevent "nested session" error when launched from a Claude Code terminal
    const prefix = cliConfig.command === 'claude' ? 'unset CLAUDECODE && ' : '';

    const model = cliConfig.models?.['research'];
    const modelFlag = model ? `--model ${model}` : '';

    // Name the CC session using the same format as tmux sessions (e.g. aigon-r5-cc)
    const nameFlag = cliConfig.command === 'claude'
        ? `--name "${buildResearchTmuxSessionName(researchId, agentId)}"`
        : '';

    const flagTokens = _getAgentLaunchFlagTokens(cliConfig.command, cliConfig.implementFlag, { autonomous: false });
    const flags = [...flagTokens, modelFlag, nameFlag].filter(Boolean).join(' ');
    if (flags) {
        return `${prefix}${cliConfig.command} ${flags} "${prompt}"`;
    }
    return `${prefix}${cliConfig.command} "${prompt}"`;
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
 *   {repo}-f{num}-{agent}-{desc}
 * Falls back to shorter forms when repo/desc are unavailable.
 * @param {string} featureId
 * @param {string} [agentId]
 * @param {object} [options]
 * @param {string} [options.repo] - repository name (defaults to cwd basename)
 * @param {string} [options.desc] - feature description (kebab-case)
 */
function buildTmuxSessionName(featureId, agentId, options) {
    const repo = resolveTmuxRepoName(options);
    const agent = agentId || 'solo';
    const num = toUnpaddedId(featureId);
    const desc = options && options.desc;
    return desc
        ? `${repo}-f${num}-${agent}-${desc}`
        : `${repo}-f${num}-${agent}`;
}

/**
 * Build a tmux session name for research sessions:
 *   {repo}-r{num}-{agent}
 */
function buildResearchTmuxSessionName(researchId, agentId, options) {
    const repo = resolveTmuxRepoName(options);
    return `${repo}-r${toUnpaddedId(researchId)}-${agentId}`;
}

/**
 * Parse a tmux session name to extract entity type, id, and agent.
 * Returns { type: 'f'|'r', id: string, agent: string } or null.
 */
function parseTmuxSessionName(name) {
    const match = name.match(/^.+-(f|r)(\d+)-([a-z]{2})(?:-|$)/);
    if (!match) return null;
    return { type: match[1], id: match[2], agent: match[3] };
}

/**
 * Scan stage folders across all repos to find which stage an entity is in.
 * @param {string[]} repos - repo paths from conductor config
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
                { dir: '04-done', stage: 'done' },
                { dir: '05-paused', stage: 'paused' }
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
    // Ask the state machine whether any actions are available — no actions means terminal/orphaned state
    const entityType = parsed.type === 'f' ? 'feature' : 'research';
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
        const stageResult = parsed ? findEntityStage(repos, parsed.type, parsed.id) : null;
        const orphan = parsed ? classifyOrphanReason(parsed, stageResult) : null;
        return {
            name: trimmedName,
            createdAt: new Date(parseInt(createdEpoch, 10) * 1000).toISOString(),
            attached: attached.trim() === '1',
            entityType: parsed ? parsed.type : null,
            entityId: parsed ? parsed.id : null,
            agent: parsed ? parsed.agent : null,
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
    // Match: {anything}-f{id}-{agent} or {anything}-r{id}-{agent}
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

function openTerminalAppWithCommand(cwd, command, title) {
    const effectiveConfig = _getEffectiveConfig();
    const tmuxApp = effectiveConfig.tmuxApp || 'terminal';

    if (tmuxApp === 'iterm2') {
        // iTerm2: regular tmux attach (no -CC control mode — it causes raw protocol garbage)
        // Note: skip cd — the tmux session already has its working directory set

        // If the target tmux session is already attached anywhere, avoid spawning
        // another iTerm2 window; just bring iTerm2 forward.
        if (title && isTmuxSessionAttached(title)) {
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
 * Open a single worktree in the specified terminal.
 */
function openSingleWorktree(wt, agentCommand, terminal) {
    const AGENT_CONFIGS = _getAgentConfigs();
    if (terminal === 'warp') {
        const wtBasename = path.basename(wt.path);
        const configName = `worktree-${wtBasename}`;
        const warpConfigDir = path.join(os.homedir(), '.warp', 'launch_configurations');
        const configFile = path.join(warpConfigDir, `${configName}.yaml`);

        const agentMeta = AGENT_CONFIGS[wt.agent] || {};
        const paddedId = String(wt.featureId).padStart(2, '0');
        const profile = _getActiveProfile();
        const port = profile.devServer.enabled
            ? (profile.devServer.ports[wt.agent] || agentMeta.port || 3000)
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
    } else if (terminal === 'code' || terminal === 'vscode') {
        try {
            execSync(`code "${wt.path}"`);

            console.log(`\n\uD83D\uDE80 Opening worktree in VS Code:`);
            console.log(`   Feature: ${wt.featureId} - ${wt.desc}`);
            console.log(`   Agent: ${wt.agent}`);
            console.log(`   Path: ${wt.path}`);
            console.log(`\n\uD83D\uDCCB Run this command in the VS Code terminal:`);
            console.log(`   ${agentCommand}`);
        } catch (e) {
            console.error(`\u274C Failed to open VS Code: ${e.message}`);
            console.error(`   Make sure the 'code' CLI is installed (VS Code: Cmd+Shift+P > "Install 'code' command")`);
        }
    } else if (terminal === 'cursor') {
        try {
            execSync(`cursor --trust-workspace "${wt.path}"`);

            console.log(`\n\uD83D\uDE80 Opening worktree in Cursor:`);
            console.log(`   Feature: ${wt.featureId} - ${wt.desc}`);
            console.log(`   Agent: ${wt.agent}`);
            console.log(`   Path: ${wt.path}`);
            console.log(`\n\uD83D\uDCCB Run this command in the Cursor terminal:`);
            console.log(`   ${agentCommand}`);
        } catch (e) {
            console.error(`\u274C Failed to open Cursor: ${e.message}`);
            console.error(`   Make sure the 'cursor' CLI is installed`);
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

            const tmuxAppName = (_getEffectiveConfig().tmuxApp || 'terminal') === 'iterm2' ? 'iTerm2' : 'Terminal.app';
            console.log(`\n\uD83D\uDE80 Opening worktree in tmux via ${tmuxAppName}:`);
            console.log(`   Feature: ${wt.featureId} - ${wt.desc}`);
            console.log(`   Agent: ${wt.agent}`);
            console.log(`   Path: ${wt.path}`);
            console.log(`   Session: ${sessionName}${created ? ' (created)' : ' (attached)'}`);
        } catch (e) {
            console.error(`\u274C Failed to open tmux session: ${e.message}`);
            console.error(`   Install tmux: brew install tmux`);
        }
    } else {
        console.error(`\u274C Terminal "${terminal}" not supported.`);
        console.error(`   Supported terminals: warp, code (VS Code), cursor, terminal, tmux`);
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
 * Adds the current project root as trusted in ~/.codex/config.toml.
 */
function presetCodexTrust() {
    const codexConfigPath = path.join(os.homedir(), '.codex', 'config.toml');
    try {
        let config = '';
        if (fs.existsSync(codexConfigPath)) {
            config = fs.readFileSync(codexConfigPath, 'utf8');
        }

        const projectRoot = process.cwd();
        const entry = `[projects."${projectRoot}"]`;

        if (config.includes(entry)) return; // already trusted

        if (config.length > 0 && !config.endsWith('\n')) config += '\n';
        config += `\n${entry}\ntrust_level = "trusted"\n`;

        _safeWrite(codexConfigPath, config);
        console.log(`\uD83D\uDD13 Pre-seeded Codex project trust for ${projectRoot}`);
    } catch (e) {
        console.warn(`\u26A0\uFE0F  Could not pre-seed Codex trust: ${e.message}`);
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

    if (profile.devServer.enabled) {
        const port = profile.devServer.ports[agentId] || agentMeta.port || 3000;
        const appId = _getAppId();
        const serverId = `${agentId}-${featureId}`;
        const devUrl = _getDevProxyUrl(appId, serverId);
        let envContent = '';
        if (fs.existsSync(envLocalPath)) {
            envContent = fs.readFileSync(envLocalPath, 'utf8').trimEnd() + '\n\n';
        }
        envContent += `# Fleet config for agent ${agentId}\n`;
        envContent += `PORT=${port}\n`;
        envContent += `AIGON_AGENT_NAME=${agentMeta.name || agentId}\n`;
        envContent += `AIGON_BANNER_COLOR=${agentMeta.bannerColor || '#888888'}\n`;
        envContent += `AIGON_FEATURE_ID=${paddedFeatureId}\n`;
        envContent += `AIGON_DEV_URL=${devUrl}\n`;
        envContent += `NEXT_PUBLIC_AIGON_AGENT_NAME=${agentMeta.name || agentId}\n`;
        envContent += `NEXT_PUBLIC_AIGON_BANNER_COLOR=${agentMeta.bannerColor || '#888888'}\n`;
        envContent += `NEXT_PUBLIC_AIGON_FEATURE_ID=${paddedFeatureId}\n`;
        envContent += `NEXT_PUBLIC_AIGON_DEV_URL=${devUrl}\n`;
        fs.writeFileSync(path.join(worktreePath, '.env.local'), envContent);
        console.log(`   \uD83D\uDCCB .env.local created with PORT=${port}, banner vars, dev URL`);
    } else if (fs.existsSync(envLocalPath)) {
        let envContent = fs.readFileSync(envLocalPath, 'utf8').trimEnd() + '\n\n';
        envContent += `# Fleet config for agent ${agentId}\n`;
        envContent += `AIGON_AGENT_NAME=${agentMeta.name || agentId}\n`;
        envContent += `AIGON_BANNER_COLOR=${agentMeta.bannerColor || '#888888'}\n`;
        envContent += `AIGON_FEATURE_ID=${paddedFeatureId}\n`;
        envContent += `NEXT_PUBLIC_AIGON_AGENT_NAME=${agentMeta.name || agentId}\n`;
        envContent += `NEXT_PUBLIC_AIGON_BANNER_COLOR=${agentMeta.bannerColor || '#888888'}\n`;
        envContent += `NEXT_PUBLIC_AIGON_FEATURE_ID=${paddedFeatureId}\n`;
        fs.writeFileSync(path.join(worktreePath, '.env.local'), envContent);
        console.log(`   \uD83D\uDCCB .env.local created with banner vars (no PORT \u2014 dev server not used)`);
    }

    try {
        execSync(`aigon install-agent ${agentId}`, { cwd: worktreePath, stdio: 'pipe' });
        console.log(`   \uD83D\uDD27 Installed ${agentId} commands in worktree`);
    } catch (installErr) {
        console.warn(`   \u26A0\uFE0F  Failed to install ${agentId} commands in worktree: ${installErr.message}`);
    }

    if (!fs.existsSync(logsDirPath)) {
        fs.mkdirSync(logsDirPath, { recursive: true });
    }
    const logName = `feature-${featureId}-${agentId}-${desc}-log.md`;
    const logPath = path.join(logsDirPath, logName);
    if (!fs.existsSync(logPath)) {
        const nowIso = new Date().toISOString();
        const template = `---\nstatus: implementing\nupdated: ${nowIso}\nstartedAt: ${nowIso}\nevents:\n  - { ts: "${nowIso}", status: implementing }\n---\n\n# Implementation Log: Feature ${featureId} - ${desc}\nAgent: ${agentId}\n\n## Plan\n\n## Progress\n\n## Decisions\n`;
        fs.writeFileSync(logPath, template);
        console.log(`   \uD83D\uDCDD Log: docs/specs/features/logs/${logName}`);
    }
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

module.exports = {
    getWorktreeBase,
    findWorktrees,
    filterByFeatureId,
    buildAgentCommand,
    buildResearchAgentCommand,
    toUnpaddedId,
    buildTmuxSessionName,
    buildResearchTmuxSessionName,
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
    setupWorktreeEnvironment,
    ensureAgentSessions,
    getEnrichedSessions,
    tileITerm2Windows,
    runTmux,
};
