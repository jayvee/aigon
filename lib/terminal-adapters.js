'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync, spawn } = require('child_process');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function commandExists(bin) {
    try { execSync(`which ${bin}`, { stdio: 'pipe' }); return true; } catch { return false; }
}
function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}
function resolveBinary(bin) {
    try { return execSync(`which ${bin}`, { encoding: 'utf8' }).trim(); } catch { return bin; }
}

function runOsaScript(script, options = {}) {
    return spawnSync('osascript', ['-e', script], {
        stdio: 'pipe',
        encoding: 'utf8',
        ...options,
    });
}

function describeOsaScriptFailure(result, fallback = 'unknown AppleScript error') {
    if (!result) return fallback;
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
    const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : '';
    return stderr || stdout || fallback;
}

// Launch a Linux terminal by spawning [bin, ...args] detached
function launchLinuxTerminal(bin, argsFn, cmd, opts) {
    const fullCommand = `cd ${shellQuote(opts.cwd)} && ${cmd}`;
    const args = argsFn(fullCommand, opts.title);
    const child = spawn(bin, args, { stdio: 'ignore', detached: true });
    child.unref();
}

// Linux terminal arg builders: (fullCommand, title) => args[]
const LINUX_TERMINALS = {
    kitty:            (cmd, t) => t ? ['--title', t, 'bash', '-lc', cmd] : ['bash', '-lc', cmd],
    'gnome-terminal': (cmd, t) => t ? ['--title', t, '--', 'bash', '-lc', cmd] : ['--', 'bash', '-lc', cmd],
    xterm:            (cmd, t) => t ? ['-T', t, '-e', 'bash', '-lc', cmd] : ['-e', 'bash', '-lc', cmd],
};

// Build an iTerm2 focus script for a given session title
function iterm2FocusScript(title) {
    const t = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return ['tell application "iTerm"',
        '  repeat with w in windows', '    repeat with t in tabs of w',
        '      repeat with s in sessions of t',
        `        if name of s is "${t}" then`,
        '          select t', '          set index of w to 1', '          activate', '          return "found"',
        '        end if', '      end repeat', '    end repeat', '  end repeat',
        'end tell', 'return "not found"'].join('\n');
}

// Warp YAML config helper
function writeWarpConfig(configName, yamlContent) {
    const dir = path.join(os.homedir(), '.warp', 'launch_configurations');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${configName}.yaml`);
    fs.writeFileSync(file, yamlContent);
    execSync(`open "warp://launch/${configName}"`);
    return file;
}

// ---------------------------------------------------------------------------
// Adapter table — ordered by specificity (most specific first)
// { name, detect(env), launch(cmd, opts), split(configs, opts) }
// ---------------------------------------------------------------------------

const adapters = [
    // --- Warp (macOS) ---
    {
        name: 'warp',
        detect: (env) => env.platform === 'darwin' && env.terminalApp === 'warp',
        launch(cmd, opts) {
            const name = `worktree-${opts.configName || 'default'}`;
            const color = opts.tabColor ? `\n        color: ${opts.tabColor}` : '';
            return writeWarpConfig(name, `---\nname: ${name}\nwindows:\n  - tabs:\n      - title: "${opts.title || ''}"${color}\n        layout:\n          cwd: "${opts.cwd}"\n          commands:\n            - exec: '${cmd}'\n`);
        },
        split(configs, opts) {
            const panes = configs.map(wt => {
                const cmds = [];
                if (wt.paneTitle) cmds.push(`                  - exec: 'echo -ne "\\033]0;${wt.paneTitle}\\007"'`);
                if (wt.portLabel) cmds.push(`                  - exec: 'echo "\\n${wt.portLabel}\\n"'`);
                cmds.push(`                  - exec: '${wt.agentCommand}'`);
                return `              - cwd: "${wt.path}"\n                commands:\n${cmds.join('\n')}`;
            }).join('\n');
            const color = opts.tabColor ? `\n        color: ${opts.tabColor}` : '';
            return writeWarpConfig(opts.configName, `---\nname: ${opts.configName}\nwindows:\n  - tabs:\n      - title: "${opts.title}"${color}\n        layout:\n          split_direction: horizontal\n          panes:\n${panes}\n`);
        },
    },
    // --- iTerm2 (macOS, configured via terminalApp) ---
    {
        name: 'iterm2',
        detect: (env) => env.platform === 'darwin' && env.terminalApp === 'iterm2',
        launch(cmd, opts) {
            if (opts.title && opts.isTmuxAttached && this._focus(opts.title)) return;
            if (opts.title && this._focus(opts.title)) return;
            const resolved = cmd.replace(/^(\S+)/, (bin) => {
                if (bin === 'tmux' && opts.resolveTmuxBinary) { const r = opts.resolveTmuxBinary(); if (r) return r; }
                return resolveBinary(bin);
            });
            const esc = resolved.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            const escapedTitle = opts.title ? opts.title.replace(/\\/g, '\\\\').replace(/"/g, '\\"') : null;
            const setTitleForTab = escapedTitle ? [
                '      try',
                `        set name of current session of newTab to "${escapedTitle}"`,
                '      end try',
            ] : [];
            const setTitleForWindow = escapedTitle ? [
                '    try',
                `      set name of current session of current tab of newWindow to "${escapedTitle}"`,
                '    end try',
            ] : [];

            // Prefer opening a tab in the first existing window. If that AppleScript path
            // fails, fall back to creating a new window instead of surfacing a hard error.
            const script = [
                'tell application "iTerm"',
                '  activate',
                '  if (count of windows) > 0 then',
                '    tell first window',
                `      set newTab to (create tab with default profile command "${esc}")`,
                ...setTitleForTab,
                '    end tell',
                '  else',
                `    set newWindow to (create window with default profile command "${esc}")`,
                ...setTitleForWindow,
                '  end if',
                'end tell',
            ].join('\n');
            let r = runOsaScript(script);
            if (r.error || r.status !== 0) {
                const fallbackScript = [
                    'tell application "iTerm"',
                    '  activate',
                    `  set newWindow to (create window with default profile command "${esc}")`,
                    ...setTitleForWindow,
                    'end tell',
                ].join('\n');
                r = runOsaScript(fallbackScript);
            }
            if (r.error || r.status !== 0) {
                throw new Error(`Failed to open iTerm2: ${describeOsaScriptFailure(r)}. Is iTerm2 installed and Automation allowed?`);
            }
        },
        split: null,
        _focus(title) {
            const r = runOsaScript(iterm2FocusScript(title));
            if (r.stdout && r.stdout.trim() === 'found') return true;
            runOsaScript('tell application "iTerm" to activate', { stdio: 'ignore' });
            return false;
        },
    },
    // --- Linux terminals (detected in preference order) ---
    ...Object.keys(LINUX_TERMINALS).map(name => ({
        name,
        detect: (env) => env.platform === 'linux' && commandExists(name),
        launch(cmd, opts) { launchLinuxTerminal(name, LINUX_TERMINALS[name], cmd, opts); },
        split: null,
    })),
    // --- Terminal.app (macOS default fallback) ---
    {
        name: 'apple-terminal',
        detect: (env) => env.platform === 'darwin' && env.terminalApp === 'apple-terminal',
        launch(cmd, opts) {
            if (opts.title) {
                const script = ['tell application "Terminal"', '  repeat with w in windows',
                    `    if custom title of selected tab of w is ${JSON.stringify(opts.title)} then`,
                    '      set index of w to 1', '      set frontmost to true', '      activate', '      return "found"',
                    '    end if', '  end repeat', 'end tell', 'return "not found"'].join('\n');
                const r = spawnSync('osascript', ['-e', script], { stdio: 'pipe', encoding: 'utf8' });
                if (r.stdout && r.stdout.trim() === 'found') return;
            }
            const full = `cd ${shellQuote(opts.cwd)} && ${cmd}`;
            const titleLines = opts.title ? [`set custom title of selected tab of front window to ${JSON.stringify(opts.title)}`,
                'set title displays custom title of selected tab of front window to true'] : [];
            const script = ['tell application "Terminal"', 'activate', `do script ${JSON.stringify(full)}`, ...titleLines, 'end tell'].join('\n');
            const r = spawnSync('osascript', ['-e', script], { stdio: 'ignore' });
            if (r.error || r.status !== 0) throw new Error('Failed to open Terminal.app and run command');
        },
        split: null,
    },
];

// ---------------------------------------------------------------------------
// Adapter lookup
// ---------------------------------------------------------------------------

function findAdapter(env) {
    if (env.platform === 'linux' && env.linuxTerminal && commandExists(env.linuxTerminal)) {
        const argsFn = LINUX_TERMINALS[env.linuxTerminal] || ((cmd) => ['-e', 'bash', '-lc', cmd]);
        return { name: env.linuxTerminal, detect: () => true, split: null,
            launch(cmd, opts) { launchLinuxTerminal(env.linuxTerminal, argsFn, cmd, opts); } };
    }
    return adapters.find(a => a.detect(env));
}

function getAdapter(name) {
    return adapters.find(a => a.name === name) || null;
}

// ---------------------------------------------------------------------------
// Standalone terminal utilities
// ---------------------------------------------------------------------------

function closeWarpWindow(titleHint) {
    if (process.platform === 'linux') return false;
    try {
        execSync(`osascript -e 'try' -e 'tell application "Warp" to close (first window whose name contains "${titleHint}")' -e 'end try'`, { stdio: 'ignore' });
        return true;
    } catch { return false; }
}

function tileITerm2Windows() {
    if (process.platform === 'linux') {
        console.log('ℹ️  Window tiling is not available on Linux. Use tmux pane layout instead:');
        console.log('   tmux select-layout tiled');
        return;
    }
    const getScript = 'tell application "iTerm"\n    set output to ""\n    repeat with w in windows\n        set wId to id of w\n        set wName to ""\n        try\n            set wName to name of current session of current tab of w\n        end try\n        set output to output & wId & "|||" & wName & "\\n"\n    end repeat\n    return output\nend tell';
    const result = spawnSync('osascript', ['-e', getScript], { encoding: 'utf8', stdio: 'pipe' });
    if (result.error || result.status !== 0) throw new Error('Failed to query iTerm2 windows. Is iTerm2 running?');

    const windows = result.stdout.trim().split('\n')
        .map(line => { const [id, name] = line.split('|||'); return { id: (id || '').trim(), name: (name || '').trim() }; })
        .filter(w => w.id);
    if (!windows.length) { console.log('No iTerm2 windows found.'); return; }

    // Sort windows by agent portOffset order
    const _portOffsets = require('./agent-registry').getPortOffsets();
    const ORDER = Object.fromEntries(Object.entries(_portOffsets).map(([id, off]) => [id, off - 1]));
    const parse = (n) => { const m = n.match(/^(.+)-([fr])(\d+)-([a-z]{2})/); return m ? { r: m[1], t: m[2], i: +m[3], a: m[4] } : { r: n || '~', t: 'z', i: 0, a: '' }; };
    windows.sort((a, b) => { const pa = parse(a.name), pb = parse(b.name); return pa.r.localeCompare(pb.r) || pa.t.localeCompare(pb.t) || (pa.i - pb.i) || ((ORDER[pa.a] ?? 99) - (ORDER[pb.a] ?? 99)); });

    const count = windows.length, cols = Math.min(count, 3), rows = Math.ceil(count / cols);
    // Get screen dimensions via JXA
    const screenScript = `ObjC.import('AppKit');ObjC.import('CoreGraphics');var app=Application('iTerm2');var b=app.windows[0].bounds();var mx=b.x+b.width/2,my=b.y+b.height/2;var ss=$.NSScreen.screens;var n=ss.count;var ph=$.NSScreen.screens.objectAtIndex(0).frame.size.height;var bx=0,by=0,bw=2560,bh=1400;for(var i=0;i<n;i++){var s=ss.objectAtIndex(i);var f=s.frame;var tx=f.origin.x,ty=ph-f.origin.y-f.size.height;if(mx>=tx&&mx<tx+f.size.width&&my>=ty&&my<ty+f.size.height){var v=s.visibleFrame;bx=v.origin.x;by=ph-v.origin.y-v.size.height;bw=v.size.width;bh=v.size.height;break}}bx+','+by+','+bw+','+bh;`;
    const sr = spawnSync('osascript', ['-l', 'JavaScript', '-e', screenScript], { encoding: 'utf8', stdio: 'pipe' });
    let sx = 0, sy = 25, sw = 2560, sh = 1415;
    if (sr.stdout) { const p = sr.stdout.trim().split(',').map(Number); if (p.length === 4 && p.every(n => !isNaN(n))) [sx, sy, sw, sh] = p; }

    const cw = Math.floor(sw / cols), ch = Math.floor(sh / rows);
    const positions = windows.map((w, i) => {
        const c = i % cols, r = Math.floor(i / cols), x = sx + c * cw, y = sy + r * ch;
        return `repeat with w in windows\nif id of w is ${w.id} then\nset bounds of w to {${x}, ${y}, ${x + cw}, ${y + ch}}\nend if\nend repeat`;
    }).join('\n');
    const tr = spawnSync('osascript', ['-e', `tell application "iTerm"\n${positions}\nend tell`], { encoding: 'utf8', stdio: 'pipe' });
    if (tr.error || tr.status !== 0) throw new Error(`Failed to tile iTerm2 windows: ${(tr.stderr || '').trim() || 'unknown'}`);
    console.log(`\u2705 Tiled ${count} iTerm2 window${count === 1 ? '' : 's'} into ${cols}\xd7${rows} grid`);
}

module.exports = { adapters, findAdapter, getAdapter, shellQuote, closeWarpWindow, tileITerm2Windows };
