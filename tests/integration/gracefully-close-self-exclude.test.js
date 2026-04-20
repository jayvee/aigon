#!/usr/bin/env node
// REGRESSION: f281 close left do-cx and review-cc tmux sessions alive because
// gracefullyCloseEntitySessions Ctrl+C'd its own host (autoconductor) session,
// SIGINT'ing its own process group mid-cleanup. Fix: skip the current session.
const a = require('assert'), path = require('path'), fs = require('fs');
const { spawnSync } = require('child_process');
const tmux = (...x) => spawnSync('tmux', x, { stdio: 'ignore' });
if (spawnSync('tmux', ['-V'], { stdio: 'ignore' }).status !== 0) { console.log('skip: no tmux'); process.exit(0); }
const N = ['aigon-f995-auto-t', 'aigon-f995-do-cx-t', 'aigon-f995-review-cc-t'];
const log = `/tmp/gcse-${process.pid}.log`, root = path.resolve(__dirname, '..', '..');
N.forEach(n => tmux('kill-session', '-t', n));
N.forEach(n => tmux('new-session', '-d', '-s', n, '-c', root));
try {
    fs.writeFileSync(log, '');
    const s = `const r=require("./lib/worktree").gracefullyCloseEntitySessions("995","f",{gracePeriodMs:800});console.log("R:"+JSON.stringify(r));`;
    tmux('send-keys', '-t', N[0], `node -e '${s}' > ${log} 2>&1; echo D >> ${log}`, 'Enter');
    const dl = Date.now() + 8000;
    while (Date.now() < dl) { if (fs.readFileSync(log, 'utf8').includes('D')) break; spawnSync('sleep', ['0.2']); }
    const out = fs.readFileSync(log, 'utf8');
    a.ok(out.includes('R:'), `cleanup aborted — host session was self-killed. log: ${out}`);
    const r = JSON.parse(out.split('R:')[1].split('\n')[0]);
    a.deepStrictEqual(r.sessions.sort(), [N[1], N[2]].sort(), 'current session must be excluded');
    const live = spawnSync('tmux', ['list-sessions', '-F', '#{session_name}'], { encoding: 'utf8' }).stdout || '';
    a.ok(live.split('\n').includes(N[0]), 'auto session must survive');
} finally { N.forEach(n => tmux('kill-session', '-t', n)); try { fs.unlinkSync(log); } catch (_) {} }
console.log('ok');
