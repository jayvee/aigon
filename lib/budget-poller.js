'use strict';

/**
 * Agent budget poller.
 *
 * Spawns throwaway tmux sessions every 30 minutes to poll:
 *   - Claude Code (`claude --dangerously-skip-permissions` → /status → Usage tab)
 *   - Codex      (`codex` → banner contains 5h + weekly limits)
 *
 * Results cached to `.aigon/budget-cache.json`. Dashboard reads via GET /api/budget.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;
const SESSION_CC = 'aigon-budget-cc';
const SESSION_CX = 'aigon-budget-cx';

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

        const pct = line.match(/(\d+)\s*%\s*used/i);
        if (!pct || !currentSection) continue;
        const resets = line.match(/Resets\s+(\S+)\s*(?:\(([^)]+)\))?/i);
        const pctUsed = parseInt(pct[1], 10);
        const resetsAt = resets ? resets[1] : null;
        const tz = resets && resets[2] ? resets[2] : null;
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
    killSession(SESSION_CX);
    if (!newSession(SESSION_CX)) {
        (log || console.log)('[budget-poller] failed to create cx tmux session');
        return null;
    }
    try {
        sendText(SESSION_CX, 'codex');
        await sleep(6000);
        const raw = capture(SESSION_CX);
        if (!/%\s*left/i.test(raw)) {
            (log || console.log)('[budget-poller] cx: no "% left" markers — skipping cache write');
            return null;
        }
        const parsed = parseCodexBanner(raw);
        return {
            polled_at: new Date().toISOString(),
            five_hour: parsed.five_hour,
            weekly: parsed.weekly,
        };
    } finally {
        killSession(SESSION_CX);
    }
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
    if (!tmuxAvailable()) {
        logger('[budget-poller] tmux not available — cannot poll');
        return null;
    }
    const existing = readCache(repoPath);
    const merged = { cc: existing.cc || null, cx: existing.cx || null };
    try {
        const cc = await pollClaudeBudget({ log: logger });
        if (cc) merged.cc = cc;
    } catch (e) {
        logger(`[budget-poller] cc error: ${e && e.message}`);
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
