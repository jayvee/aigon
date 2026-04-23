'use strict';

/**
 * Agent budget poller.
 *
 * Polls every 30 minutes:
 *   - Claude Code via a throwaway tmux session (`claude ...` → /status → Usage tab)
 *   - Codex via the local app-server JSON-RPC (`account/rateLimits/read`)
 *
 * Results cached to `.aigon/budget-cache.json`. Dashboard reads via GET /api/budget.
 */

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;
const SESSION_CC = 'aigon-budget-cc';

function runTmux(args, options = {}) {
    return spawnSync('tmux', args, options);
}

function tmuxAvailable() {
    const r = runTmux(['-V'], { stdio: 'ignore' });
    return !r.error && r.status === 0;
}

function binaryOnPath(bin) {
    const r = spawnSync('which', [bin], { stdio: 'pipe' });
    return !r.error && r.status === 0 && String(r.stdout || '').trim().length > 0;
}

function killSession(name) {
    runTmux(['kill-session', '-t', name], { stdio: 'ignore' });
}

function newSession(name) {
    const r = runTmux(['new-session', '-d', '-s', name, '-x', '220', '-y', '50'], { stdio: 'ignore' });
    return !r.error && r.status === 0;
}

function send(name, keys) {
    runTmux(['send-keys', '-t', name, ...keys], { stdio: 'ignore' });
}

function sendText(name, text) {
    send(name, [text, 'Enter']);
}

function capture(name) {
    const r = runTmux(['capture-pane', '-p', '-t', name], { encoding: 'utf8', stdio: 'pipe' });
    if (r.error || r.status !== 0) return '';
    return String(r.stdout || '');
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function formatClockTime(epochSeconds) {
    if (!epochSeconds) return null;
    try {
        return new Intl.DateTimeFormat(undefined, {
            hour: 'numeric',
            minute: '2-digit',
        }).format(new Date(epochSeconds * 1000));
    } catch (_) {
        return null;
    }
}

function formatMonthDay(epochSeconds) {
    if (!epochSeconds) return null;
    try {
        return new Intl.DateTimeFormat(undefined, {
            month: 'short',
            day: 'numeric',
        }).format(new Date(epochSeconds * 1000));
    } catch (_) {
        return null;
    }
}

function codexPollEnv() {
    const env = { ...process.env };
    delete env.CODEX_THREAD_ID;
    delete env.CODEX_CI;
    delete env.CLAUDE_CODE_SSE_PORT;
    return env;
}

function mapCodexRateWindow(window, label) {
    if (!window) return null;
    const pctRemaining = typeof window.usedPercent === 'number'
        ? Math.max(0, Math.min(100, 100 - window.usedPercent))
        : null;
    const resetsAtEpoch = typeof window.resetsAt === 'number' ? window.resetsAt : null;
    return {
        label,
        pct_remaining: pctRemaining,
        resets_at: formatClockTime(resetsAtEpoch),
        resets_date: label === 'weekly' ? formatMonthDay(resetsAtEpoch) : null,
        resets_at_epoch: resetsAtEpoch,
        window_minutes: typeof window.windowDurationMins === 'number' ? window.windowDurationMins : null,
    };
}

async function callCodexAppServerRateLimits({ timeoutMs, log } = {}) {
    const logger = log || console.log;
    const timeout = timeoutMs == null ? 15000 : timeoutMs;
    return await new Promise((resolve, reject) => {
        let finished = false;
        const child = spawn('codex', ['app-server'], {
            env: codexPollEnv(),
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stdoutBuf = '';
        let stderrBuf = '';

        function finish(err, result) {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            try { child.stdin.end(); } catch (_) {}
            try { child.kill('SIGTERM'); } catch (_) {}
            setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} }, 250).unref?.();
            if (err) reject(err);
            else resolve(result);
        }

        const timer = setTimeout(() => {
            finish(new Error(`timeout waiting for codex app-server response${stderrBuf ? ` (${stderrBuf.trim()})` : ''}`));
        }, timeout);

        child.on('error', finish);
        child.on('exit', (code) => {
            if (!finished && code !== 0) {
                finish(new Error(`codex app-server exited ${code}${stderrBuf ? `: ${stderrBuf.trim()}` : ''}`));
            }
        });
        child.stderr.on('data', chunk => {
            stderrBuf += String(chunk || '');
        });
        child.stdout.on('data', chunk => {
            stdoutBuf += String(chunk || '');
            const lines = stdoutBuf.split(/\r?\n/);
            stdoutBuf = lines.pop() || '';
            for (const line of lines) {
                if (!line.trim()) continue;
                let msg = null;
                try {
                    msg = JSON.parse(line);
                } catch (_) {
                    continue;
                }
                if (msg.id === 2 && msg.result) {
                    finish(null, msg.result);
                    return;
                }
                if (msg.id === 2 && msg.error) {
                    finish(new Error(msg.error.message || 'account/rateLimits/read failed'));
                    return;
                }
            }
        });

        child.stdin.write(`${JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { clientInfo: { name: 'aigon-budget-poller', version: '1.0.0' } },
        })}\n`);
        child.stdin.write(`${JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'account/rateLimits/read',
            params: null,
        })}\n`);
        logger('[budget-poller] cx: reading rate limits from codex app-server');
    });
}

function atomicWriteJSON(filePath, data) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
}

// ---------------------------------------------------------------------------
// Parsers (exported for reuse / targeted testing)
// ---------------------------------------------------------------------------

/**
 * Parse Claude Code /status Usage tab output.
 * Returns { session, week_all, week_sonnet } — each sub-object has pct_used, resets_at, tz (or null).
 */
function parseClaudeStatus(text) {
    const out = { session: null, week_all: null, week_sonnet: null };
    if (!text || typeof text !== 'string') return out;

    // The Usage tab spans multiple lines per section:
    //   Current session
    //   Resets 5pm (Australia/Melbourne)    8% used
    //
    //   Current week (all models)
    //   Resets 9am (Australia/Melbourne)████ 100% used
    //
    // Track the last seen section header and apply it when we find a % used line.
    const lines = text.split(/\r?\n/);
    let currentSection = null;
    for (const line of lines) {
        if (/current\s+session/i.test(line)) { currentSection = 'session'; continue; }
        if (/current\s+week\s*\(?\s*all/i.test(line)) { currentSection = 'week_all'; continue; }
        if (/current\s+week\s*\(?\s*sonnet/i.test(line)) { currentSection = 'week_sonnet'; continue; }

        const resets = line.match(/Resets\s+(\S+)\s*(?:\(([^)]+)\))?/i);
        if (!resets || !currentSection) continue;
        const pct = line.match(/(\d+)\s*%\s*used/i);
        // When pct is absent the budget is at 0% used (full — Claude omits the bar)
        const pctUsed = pct ? parseInt(pct[1], 10) : 0;
        const resetsAt = resets[1];
        const tz = resets[2] || null;
        out[currentSection] = { pct_used: pctUsed, resets_at: resetsAt, tz };
        currentSection = null;
    }
    return out;
}

/**
 * Parse Codex startup banner.
 * Returns { five_hour, weekly } — each has pct_remaining, resets_at, and weekly has resets_date.
 */
function parseCodexBanner(text) {
    const out = { five_hour: null, weekly: null };
    if (!text || typeof text !== 'string') return out;

    const lines = text.split(/\r?\n/);
    for (const line of lines) {
        const pct = line.match(/(\d+)\s*%\s*left/i);
        if (!pct) continue;
        const pctRem = parseInt(pct[1], 10);
        const resets = line.match(/resets\s+([^)]+?)\s*\)/i) || line.match(/resets\s+(\S+)/i);
        const resetVal = resets ? resets[1].trim() : null;

        if (/5h\s*limit/i.test(line)) {
            out.five_hour = { pct_remaining: pctRem, resets_at: resetVal };
        } else if (/weekly\s*limit/i.test(line)) {
            // Weekly often has a date like "07:23 on 29 Apr". Split time + date.
            let resetsAt = resetVal;
            let resetsDate = null;
            if (resetVal) {
                const m = resetVal.match(/^(\S+)\s+(?:on\s+)?(.+)$/);
                if (m) { resetsAt = m[1]; resetsDate = m[2].trim(); }
            }
            out.weekly = { pct_remaining: pctRem, resets_at: resetsAt, resets_date: resetsDate };
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Poll sequences
// ---------------------------------------------------------------------------

async function pollClaudeBudget({ log } = {}) {
    if (!binaryOnPath('claude')) {
        (log || console.log)('[budget-poller] claude binary not on PATH — skipping cc');
        return null;
    }
    killSession(SESSION_CC);
    if (!newSession(SESSION_CC)) {
        (log || console.log)('[budget-poller] failed to create cc tmux session');
        return null;
    }
    try {
        sendText(SESSION_CC, 'claude --dangerously-skip-permissions');
        await sleep(8000);
        sendText(SESSION_CC, '/status');
        await sleep(2000);
        send(SESSION_CC, ['Right']); // Config tab
        await sleep(300);
        send(SESSION_CC, ['Right']); // Usage tab
        await sleep(800);
        const raw = capture(SESSION_CC);
        if (!/%\s*used/i.test(raw)) {
            (log || console.log)('[budget-poller] cc: no "% used" markers — skipping cache write');
            return null;
        }
        const parsed = parseClaudeStatus(raw);
        return {
            polled_at: new Date().toISOString(),
            session: parsed.session,
            week_all: parsed.week_all,
            week_sonnet: parsed.week_sonnet,
        };
    } finally {
        killSession(SESSION_CC);
    }
}

async function pollCodexBudget({ log } = {}) {
    if (!binaryOnPath('codex')) {
        (log || console.log)('[budget-poller] codex binary not on PATH — skipping cx');
        return null;
    }
    const payload = await callCodexAppServerRateLimits({ timeoutMs: 15000, log });
    const rate = payload && (payload.rateLimitsByLimitId && payload.rateLimitsByLimitId.codex
        ? payload.rateLimitsByLimitId.codex
        : payload.rateLimits);
    if (!rate) {
        (log || console.log)('[budget-poller] cx: app-server returned no codex rate limit snapshot');
        return null;
    }
    return {
        polled_at: new Date().toISOString(),
        source: 'app-server',
        plan_type: rate.planType || null,
        credits: rate.credits || null,
        five_hour: mapCodexRateWindow(rate.primary, '5h'),
        weekly: mapCodexRateWindow(rate.secondary, 'weekly'),
    };
}

// ---------------------------------------------------------------------------
// Cache read/write
// ---------------------------------------------------------------------------

function getCachePath(repoPath) {
    return path.join(repoPath || process.cwd(), '.aigon', 'budget-cache.json');
}

function readCache(repoPath) {
    const p = getCachePath(repoPath);
    if (!fs.existsSync(p)) return { cc: null, cx: null };
    try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (_) {
        return { cc: null, cx: null };
    }
}

function writeCache(repoPath, data) {
    atomicWriteJSON(getCachePath(repoPath), data);
}

async function pollOnce({ repoPath, log } = {}) {
    const logger = log || console.log;
    const existing = readCache(repoPath);
    const merged = { cc: existing.cc || null, cx: existing.cx || null };
    if (tmuxAvailable()) {
        try {
            const cc = await pollClaudeBudget({ log: logger });
            if (cc) merged.cc = cc;
        } catch (e) {
            logger(`[budget-poller] cc error: ${e && e.message}`);
        }
    } else {
        logger('[budget-poller] tmux not available — skipping cc');
    }
    try {
        const cx = await pollCodexBudget({ log: logger });
        if (cx) merged.cx = cx;
    } catch (e) {
        logger(`[budget-poller] cx error: ${e && e.message}`);
    }
    writeCache(repoPath, merged);
    return merged;
}

// ---------------------------------------------------------------------------
// Long-running poller (started by dashboard-server)
// ---------------------------------------------------------------------------

let _activeTimer = null;
let _inflight = null;

function startBudgetPoller({ repoPath, intervalMs, log } = {}) {
    const interval = intervalMs || DEFAULT_INTERVAL_MS;
    const logger = log || console.log;

    async function tick() {
        if (_inflight) return _inflight;
        _inflight = pollOnce({ repoPath, log: logger })
            .catch(e => { logger(`[budget-poller] tick error: ${e && e.message}`); return null; })
            .finally(() => { _inflight = null; });
        return _inflight;
    }

    // Immediate first poll (async, non-blocking)
    tick();
    _activeTimer = setInterval(tick, interval);
    if (typeof _activeTimer.unref === 'function') _activeTimer.unref();

    return {
        stop() {
            if (_activeTimer) { clearInterval(_activeTimer); _activeTimer = null; }
        },
        refresh: tick,
    };
}

function triggerRefresh({ repoPath, log } = {}) {
    if (_inflight) return _inflight;
    _inflight = pollOnce({ repoPath, log: log || console.log })
        .catch(() => null)
        .finally(() => { _inflight = null; });
    return _inflight;
}

module.exports = {
    startBudgetPoller,
    triggerRefresh,
    pollOnce,
    pollClaudeBudget,
    pollCodexBudget,
    parseClaudeStatus,
    parseCodexBanner,
    readCache,
    writeCache,
    getCachePath,
};
