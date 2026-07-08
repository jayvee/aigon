'use strict';

// Low-level tmux binary invocation (F632). The only module that spawns `tmux`.
// SessionHost and enriched-session read paths import from here — never worktree.js.

const fs = require('fs');
const { spawnSync } = require('child_process');

const DEFAULT_TMUX_TIMEOUT_MS = 5000;

function resolveTmuxBinary() {
    const candidates = [
        process.env.AIGON_TMUX_PATH,
        process.env.TMUX_BINARY,
        '/opt/homebrew/bin/tmux',
        '/usr/local/bin/tmux',
        '/usr/bin/tmux',
        'tmux',
    ].filter(Boolean);

    let sawForkStarvation = false;
    let homebrewTmuxBinMissing = false;
    const homebrewTmuxBins = new Set(['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux']);

    for (const candidate of candidates) {
        const result = spawnSync(candidate, ['-V'], { stdio: 'ignore' });
        if (!result.error && result.status === 0) return candidate;
        if (result.error) {
            const code = result.error.code;
            if (code === 'EAGAIN' || code === 'EMFILE') {
                sawForkStarvation = true;
            }
            if (code === 'ENOENT' && homebrewTmuxBins.has(candidate)) {
                homebrewTmuxBinMissing = true;
            }
        }
    }

    if (sawForkStarvation) {
        throw new Error(
            'Cannot fork: system is at the process or file-descriptor limit (EAGAIN/EMFILE).\n' +
            'This is NOT a missing tmux binary — run `aigon doctor --reap-orphans` to clean up\n' +
            'orphaned agent processes, then retry.'
        );
    }

    if (homebrewTmuxBinMissing) {
        const cellarBases = ['/opt/homebrew/Cellar/tmux', '/usr/local/Cellar/tmux'];
        for (const base of cellarBases) {
            let versions;
            try { versions = fs.readdirSync(base); } catch (_) { continue; }
            if (versions.length > 0) {
                throw new Error(
                    'tmux is installed via Homebrew but the bin symlink is missing.\n' +
                    'Fix: brew link --overwrite tmux'
                );
            }
        }
    }

    return null;
}

function runTmux(args, options = {}) {
    let tmuxBin;
    try {
        tmuxBin = resolveTmuxBinary();
    } catch (e) {
        return { status: 1, error: e };
    }
    if (!tmuxBin) {
        return { status: 1, error: new Error('tmux is not installed or not available in PATH') };
    }
    const execOptions = (options.timeout == null)
        ? { ...options, timeout: DEFAULT_TMUX_TIMEOUT_MS, killSignal: 'SIGKILL' }
        : options;
    return spawnSync(tmuxBin, args, execOptions);
}

function assertTmuxAvailable() {
    const result = runTmux(['-V'], { stdio: 'ignore' });
    if (result.error || result.status !== 0) {
        throw result.error || new Error('tmux exited with non-zero status');
    }
}

function tmuxSessionExists(sessionName) {
    const result = runTmux(['has-session', '-t', sessionName], { stdio: 'ignore' });
    return !result.error && result.status === 0;
}

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

module.exports = {
    DEFAULT_TMUX_TIMEOUT_MS,
    resolveTmuxBinary,
    runTmux,
    assertTmuxAvailable,
    tmuxSessionExists,
    resolveTmuxTarget,
    isTmuxSessionAttached,
};
