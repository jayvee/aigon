'use strict';

// Git worktree lifecycle: creation, environment setup, permissions, attribution (F632).
// Tmux, launch composition, terminal dispatch, and session read-model live in their
// documented owners — this module re-exports them for backwards compatibility.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const git = require('./git');
const sessionNames = require('./agent-sessions/names');
const { shellQuote, tileITerm2Windows, closeWarpWindow } = require('./terminal-adapters');

// Lazy facade paths — variable require() avoids static module-graph edges (F632).
const _AGENT_LAUNCH_COMMAND = './agent-launch-command';
const _TERMINAL_LAUNCH = './terminal-launch';
const _TMUX_EXEC = './agent-sessions/hosts/tmux-exec';
const _ENRICHED_SESSIONS = './agent-sessions/enriched-sessions';
const _ENTITY_SESSIONS = './agent-sessions/entity-sessions';
const _TMUX_LIFECYCLE = './agent-sessions/hosts/tmux-lifecycle';
const _TMUX_SIDECAR = './agent-sessions/hosts/tmux-sidecar';
const _TMUX_CAPTURE = './agent-sessions/hosts/tmux-capture';

function _dep(mod, key) {
    return require(mod)[key];
}

const {
    VALID_TMUX_ROLES,
    toUnpaddedId,
    buildTmuxSessionName,
    buildResearchTmuxSessionName,
    parseTmuxSessionName,
    matchTmuxSessionByEntityId,
} = sessionNames;

const __agentRegistry = require('./agent-registry');

function devProxyUrl(appId, serverId) {
    if (serverId) return `http://${serverId}.${appId}.test`;
    return `http://${appId}.test`;
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

const findWorktrees = git.listWorktrees;
const filterByFeatureId = git.filterWorktreesByFeature;

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

// --- Worktree Permission Helpers ---

function addWorktreePermissions(worktreePaths) {
    const CLAUDE_SETTINGS_PATH = path.join(process.cwd(), '.claude', 'settings.json');
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
    const CLAUDE_SETTINGS_PATH = path.join(process.cwd(), '.claude', 'settings.json');
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

/** Pre-seed Claude Code workspace trust for worktree directories. */
function presetWorktreeTrust(worktreePaths) { __agentRegistry.ensureAgentTrust('cc', worktreePaths); }

/** Remove Claude Code workspace trust entries for worktree directories. */
function removeWorktreeTrust(worktreePaths) {
    __agentRegistry.removeAgentTrust('cc', worktreePaths);
    __agentRegistry.removeAgentTrust('cx', worktreePaths);
}

/** Pre-seed Codex project trust. */
function presetCodexTrust(extraPaths) { __agentRegistry.ensureAgentTrust('cx', extraPaths || []); }

function installAgentGitAttribution(worktreePath, agentId, agentName) {
    const normalizedAgentId = String(agentId || '').trim().toLowerCase();
    if (!normalizedAgentId) return;
    const normalizedAgentName = String(agentName || normalizedAgentId).trim();
    const attributionDomain = require('./config').getAttributionDomain(worktreePath);
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
    const AGENT_CONFIGS = __agentRegistry.getLegacyAgentConfigs();
    const agentMeta = AGENT_CONFIGS[agentId] || {};
    const paddedFeatureId = String(featureId).padStart(2, '0');

    installAgentGitAttribution(worktreePath, agentId, agentMeta.name || agentId);
    const attributionDomain = require('./config').getAttributionDomain(worktreePath);
    console.log(`   🏷️  Git attribution enabled (${agentId}@${attributionDomain}, metadata + trailers + notes)`);
    try {
        __agentRegistry.ensureAgentTrust('cx', [worktreePath]);
    } catch (_) { /* best-effort */ }
    // Cursor Agent CLI gates on ~/.cursor/projects/<slug>/.workspace-trusted per cwd — not on
    // security.workspace.trust.*. Seed markers for every fleet worktree path regardless of
    // which agent owns this worktree (cc/cx/gg/cu), so autonomous runs never hit the TUI prompt.
    try {
        __agentRegistry.ensureAgentTrust('cu', [worktreePath]);
    } catch (_) { /* best-effort */ }

    // Always write PORT to .env.local — agents must never fall back to port 3000
    {
        const port = profile.devServer.ports[agentId] || agentMeta.port;
        const appId = require('./proxy').getAppId();
        const serverId = `${agentId}-${featureId}`;
        const devUrl = devProxyUrl(appId, serverId);
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
        const dashboardPort = require('./proxy').hashBranchToPort(wtBranchName);
        envContent += `DASHBOARD_PORT=${dashboardPort}\n`;
        fs.writeFileSync(path.join(worktreePath, '.env.local'), envContent);
        console.log(`   \uD83D\uDCCB .env.local created${port ? ` with PORT=${port}` : ''}, DASHBOARD_PORT=${dashboardPort}, banner vars${devUrl ? ', dev URL' : ''}`);
    }

    // Optional operator-declared hook: runs in the worktree cwd after `.env.local` is written.
    // Configure with `worktreeSetup` in `.aigon/config.json` (single shell line). See AGENTS.md / development_workflow.
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

    // Agent commands are committed in git in target repos AND in aigon-on-aigon
    // (generated outputs are tracked here, kept in sync by a pre-commit drift
    // hook). The worktree inherits them from the branch — no install-agent run
    // is needed here, which previously caused merge conflicts on feature-close.

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
        execSync(`git commit -m "chore: worktree setup for ${agentId}" --trailer "Aigon-Internal: true"`, { cwd: worktreePath, stdio: 'pipe' });
    } catch (e) { /* nothing to commit */ }
}
module.exports = {
    getWorktreeBase,
    getWorktreeBaseForRepo,
    findWorktrees,
    filterByFeatureId,
    /** @deprecated Import from lib/agent-launch-command.js */
    get buildAgentCommand() { return _dep(_AGENT_LAUNCH_COMMAND, 'buildAgentCommand'); },
    /** @deprecated Import from lib/agent-launch-command.js */
    get buildRawAgentCommand() { return _dep(_AGENT_LAUNCH_COMMAND, 'buildRawAgentCommand'); },
    /** @deprecated Import from lib/agent-launch-command.js */
    get getAgentSignalCapabilities() { return _dep(_AGENT_LAUNCH_COMMAND, 'getAgentSignalCapabilities'); },
    /** @deprecated Import from lib/agent-launch-command.js */
    get buildAgentWrapperEnvironmentLines() { return _dep(_AGENT_LAUNCH_COMMAND, 'buildAgentWrapperEnvironmentLines'); },
    /** @deprecated Import from lib/agent-launch-command.js */
    get looksLikePoisonedHome() { return _dep(_AGENT_LAUNCH_COMMAND, 'looksLikePoisonedHome'); },
    /** @deprecated Import from lib/agent-launch-command.js */
    get resolveSafeHome() { return _dep(_AGENT_LAUNCH_COMMAND, 'resolveSafeHome'); },
    /** @deprecated Import from lib/agent-launch-command.js */
    get buildResearchAgentCommand() { return _dep(_AGENT_LAUNCH_COMMAND, 'buildResearchAgentCommand'); },
    toUnpaddedId,
    VALID_TMUX_ROLES,
    buildTmuxSessionName,
    buildResearchTmuxSessionName,
    parseTmuxSessionName,
    matchTmuxSessionByEntityId,
    /** @deprecated Import from lib/agent-sessions/hosts/tmux-exec.js */
    get assertTmuxAvailable() { return _dep(_TMUX_EXEC, 'assertTmuxAvailable'); },
    /** @deprecated Import from lib/agent-sessions/hosts/tmux-exec.js */
    get tmuxSessionExists() { return _dep(_TMUX_EXEC, 'tmuxSessionExists'); },
    /** @deprecated Import from lib/agent-sessions/hosts/tmux-exec.js */
    get resolveTmuxTarget() { return _dep(_TMUX_EXEC, 'resolveTmuxTarget'); },
    /** @deprecated Import from lib/agent-sessions/hosts/tmux-sidecar.js */
    get writeSessionSidecarRecord() { return _dep(_TMUX_SIDECAR, 'writeSessionSidecarRecord'); },
    /** @deprecated Import from lib/agent-sessions/enriched-sessions.js */
    get loadSessionSidecarIndex() { return _dep(_ENRICHED_SESSIONS, 'loadSessionSidecarIndex'); },
    /** @deprecated Import from lib/agent-sessions/hosts/tmux-lifecycle.js */
    get createDetachedTmuxSession() { return _dep(_TMUX_LIFECYCLE, 'createDetachedTmuxSession'); },
    /** @deprecated Import from lib/agent-sessions/hosts/tmux-capture.js */
    get attachSessionCapture() { return _dep(_TMUX_CAPTURE, 'attachSessionCapture'); },
    /** @deprecated Import from lib/agent-sessions/hosts/tmux-capture.js */
    get _shouldAttachTmuxPipePane() { return _dep(_TMUX_CAPTURE, 'shouldAttachTmuxPipePane'); },
    /** @deprecated Import from lib/agent-sessions/hosts/tmux-exec.js */
    get isTmuxSessionAttached() { return _dep(_TMUX_EXEC, 'isTmuxSessionAttached'); },
    shellQuote,
    /** @deprecated Import from lib/terminal-launch.js */
    get openTerminalAppWithCommand() { return _dep(_TERMINAL_LAUNCH, 'openTerminalAppWithCommand'); },
    /** @deprecated Import from lib/terminal-launch.js */
    get ensureTmuxSessionForWorktree() { return _dep(_TERMINAL_LAUNCH, 'ensureTmuxSessionForWorktree'); },
    /** @deprecated Import from lib/terminal-launch.js */
    get openInWarpSplitPanes() { return _dep(_TERMINAL_LAUNCH, 'openInWarpSplitPanes'); },
    closeWarpWindow,
    /** @deprecated Import from lib/terminal-launch.js */
    get openSingleWorktree() { return _dep(_TERMINAL_LAUNCH, 'openSingleWorktree'); },
    addWorktreePermissions,
    removeWorktreePermissions,
    presetWorktreeTrust,
    removeWorktreeTrust,
    presetCodexTrust,
    setupWorktreeEnvironment,
    reconcileWorktreeJson,
    /** @deprecated Import from lib/agent-launch-command.js */
    get resolveHeartbeatStateDir() { return _dep(_AGENT_LAUNCH_COMMAND, 'resolveHeartbeatStateDir'); },
    /** @deprecated Import from lib/agent-sessions/entity-sessions.js */
    get ensureAgentSessions() { return _dep(_ENTITY_SESSIONS, 'ensureAgentSessions'); },
    /** @deprecated Import from lib/agent-sessions/enriched-sessions.js */
    get getEnrichedSessions() { return _dep(_ENRICHED_SESSIONS, 'getEnrichedSessions'); },
    /** @deprecated Import from lib/agent-sessions/enriched-sessions.js */
    get parseEnrichedTmuxSessionsOutput() { return _dep(_ENRICHED_SESSIONS, 'parseEnrichedTmuxSessionsOutput'); },
    tileITerm2Windows,
    /** @deprecated Import from lib/agent-sessions/hosts/tmux-exec.js */
    get runTmux() { return _dep(_TMUX_EXEC, 'runTmux'); },
    /** @deprecated Import from lib/agent-sessions/entity-sessions.js */
    get gracefullyCloseEntitySessions() { return _dep(_ENTITY_SESSIONS, 'gracefullyCloseEntitySessions'); },
};
