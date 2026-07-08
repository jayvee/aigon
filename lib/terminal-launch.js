'use strict';

// Terminal app dispatch for tmux attach / Warp split panes (F632).

const { spawnSync } = require('child_process');
const path = require('path');
const terminalAdapters = require('./terminal-adapters');
const { shellQuote } = require('./terminal-adapters');
const {
    buildTmuxSessionName,
    matchTmuxSessionByEntityId,
} = require('./agent-sessions/names');
const {
    assertTmuxAvailable,
    tmuxSessionExists,
    runTmux,
    isTmuxSessionAttached,
    resolveTmuxBinary,
} = require('./agent-sessions/hosts/tmux-exec');
const { createDetachedTmuxSession } = require('./agent-sessions/hosts/tmux-lifecycle');

const _UTILS = './utils';
const _CONFIG = './config';

function getEffectiveConfig() {
    return require(_CONFIG).getEffectiveConfig();
}
function getAgentConfigs() {
    return require(_UTILS).AGENT_CONFIGS;
}
function resolveMainRepoFromWorktreeWt(wt) {
    const path = require('path');
    const fs = require('fs');
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

    const effectiveConfig = getEffectiveConfig();
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

    const focusOnLaunch = (effectiveConfig.terminal && effectiveConfig.terminal.focusOnLaunch) || 'background';
    adapter.launch(command, {
        cwd,
        title,
        isTmuxAttached: title ? isTmuxSessionAttached(title) : false,
        resolveTmuxBinary,
        background: focusOnLaunch !== 'foreground',
    });
}

function ensureTmuxSessionForWorktree(wt, agentCommand, options = {}) {
    const restartExisting = options.restartExisting === true;
    const sessionName = buildTmuxSessionName(wt.featureId, wt.agent, { desc: wt.desc, worktreePath: wt.path, role: 'do' });
    const repoPath = path.resolve(wt.repoPath || resolveMainRepoFromWorktreeWt(wt));
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

    const listResult = runTmux(['list-sessions', '-F', '#S'], { encoding: 'utf8', stdio: 'pipe' });
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
    const AGENT_CONFIGS = getAgentConfigs();
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
        const terminalApp = terminalAppOverride || getEffectiveConfig().terminalApp || 'apple-terminal';
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
module.exports = {
    openTerminalAppWithCommand,
    ensureTmuxSessionForWorktree,
    openInWarpSplitPanes,
    openSingleWorktree,
};
