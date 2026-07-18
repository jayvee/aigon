'use strict';

/**
 * Agent budget scrape primitives (F322 / F616).
 *
 * On-demand poll helpers consumed by lib/agent-quota-poller.js:
 *   - Claude Code via a throwaway tmux session (`claude ...` → /status → Usage tab)
 *   - Codex via the local app-server JSON-RPC (`account/rateLimits/read`)
 *   - Kimi CLI via tmux (`kimi` → `/usage` → capture "API Usage" rows)
 *
 * Results are written to `.aigon/state/agent-quota.json` by the unified poller.
 */

const { spawn, spawnSync } = require('child_process');

const SESSION_CC_PREFIX = 'aigon-budget-cc';
const SESSION_KM_PREFIX = 'aigon-budget-km';

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

function budgetSessionName(prefix) {
    return `${prefix}-${process.pid}-${Date.now().toString(36)}`;
}

function listTmuxSessionNames() {
    const r = runTmux(['list-sessions', '-F', '#{session_name}'], { encoding: 'utf8', stdio: 'pipe' });
    if (r.error || r.status !== 0) return [];
    return String(r.stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

function killBudgetTmuxSessions(prefix) {
    for (const name of listTmuxSessionNames()) {
        if (name === prefix || name.startsWith(`${prefix}-`)) killSession(name);
    }
}

function parsePsRows(text) {
    return String(text || '').split(/\r?\n/).map(line => {
        const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/);
        if (!m) return null;
        return {
            pid: parseInt(m[1], 10),
            ppid: parseInt(m[2], 10),
            command: m[3],
        };
    }).filter(row => row && Number.isFinite(row.pid) && Number.isFinite(row.ppid));
}

function collectBudgetProcessTreePids(rows, prefix) {
    const childrenByParent = new Map();
    for (const row of rows || []) {
        if (!childrenByParent.has(row.ppid)) childrenByParent.set(row.ppid, []);
        childrenByParent.get(row.ppid).push(row);
    }
    const escaped = String(prefix || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rootRe = new RegExp(`\\btmux\\b.*\\bnew-session\\b.*(?:^|\\s)-s\\s+${escaped}(?:\\s|$|-)`);
    const roots = (rows || []).filter(row => rootRe.test(String(row.command || '')));
    const out = new Set();
    const visit = (row) => {
        if (!row || out.has(row.pid)) return;
        out.add(row.pid);
        for (const child of childrenByParent.get(row.pid) || []) visit(child);
    };
    for (const root of roots) visit(root);
    return [...out].filter(pid => pid && pid !== process.pid);
}

function reapBudgetProcessTrees(prefix, { log } = {}) {
    if (process.platform === 'win32') return 0;
    const r = spawnSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8', stdio: 'pipe' });
    if (r.error || r.status !== 0) return 0;
    const pids = collectBudgetProcessTreePids(parsePsRows(r.stdout), prefix);
    for (const pid of pids) {
        try { process.kill(pid, 'SIGTERM'); } catch (_) { /* already gone or not ours */ }
    }
    if (pids.length && log) log(`[budget-poller] reaped ${pids.length} stale ${prefix} process(es)`);
    return pids.length;
}

function cleanupBudgetSessions(prefix, { log } = {}) {
    killBudgetTmuxSessions(prefix);
    return reapBudgetProcessTrees(prefix, { log });
}

function newSession(name, dims) {
    const cols = dims && dims.cols ? dims.cols : 220;
    const rows = dims && dims.rows ? dims.rows : 50;
    const r = runTmux(['new-session', '-d', '-s', name, '-x', String(cols), '-y', String(rows)], { stdio: 'ignore' });
    return !r.error && r.status === 0;
}

function send(name, keys) {
    runTmux(['send-keys', '-t', name, ...keys], { stdio: 'ignore' });
}

function sendText(name, text) {
    send(name, [text, 'Enter']);
}

function capture(name, options = {}) {
    const args = ['capture-pane', '-p'];
    if (options && options.historyStart != null) {
        args.push('-S', String(options.historyStart));
    }
    args.push('-t', name);
    const r = runTmux(args, { encoding: 'utf8', stdio: 'pipe' });
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

// ---------------------------------------------------------------------------
// Parsers (exported for reuse / targeted testing)
// ---------------------------------------------------------------------------

function mergeBudgetWrappedLines(prev, next) {
    const p = prev.trimEnd();
    const n = String(next || '').trim();
    if (!n) return p;
    const a = p.slice(-1);
    const b = n[0];
    // tmux wraps mid-token: "Monday" → "M" / "onday …", "11:50am" → "11" / ":50am"
    if (/[a-zA-Z]/.test(a) && /[a-z]/.test(b)) return p + n;
    if (/[0-9]/.test(a) && /[0-9]/.test(b)) return p + n;
    return `${p} ${n}`;
}

function budgetParensBalanced(s) {
    let depth = 0;
    for (const c of String(s || '')) {
        if (c === '(') depth += 1;
        else if (c === ')') depth -= 1;
        if (depth < 0) return false;
    }
    return depth === 0;
}

/**
 * True when the captured reset phrase looks like a full Claude UI value (not tmux column-wrap garbage).
 */
function looksCompleteClaudeResetPhrase(fullReset) {
    const t = String(fullReset || '').trim();
    if (t.length < 2) return false;
    if (/^\d{1,2}$/.test(t)) return false;
    if (/^[A-Za-z]$/.test(t)) return false;
    if (/^(?:in|at)$/i.test(t)) return false;
    if (/\d{1,2}(?::\d{2})?\s*[ap]m/i.test(t)) return true;
    // 24h or locale times: "14:30", "09:05" (avoid matching lone "1" / "11")
    if (/\b\d{1,2}:\d{2}\b/.test(t)) return true;
    if (/\bin\s+\d/i.test(t)) return true;
    if (/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}\s+at\s+/i.test(t)) return true;
    if (/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]{2,}\b/i.test(t) && /\d/.test(t)) return true;
    if (/\d{1,2}\s+at\s+\S+/i.test(t)) return true;
    return false;
}

function stripTrailingBudgetPctUsedTail(s) {
    let t = String(s || '');
    const mu = t.match(/\d+\s*%\s*used\b/i);
    if (mu && mu.index != null) t = t.slice(0, mu.index);
    const closeIdx = t.lastIndexOf(')');
    if (closeIdx !== -1) t = t.slice(0, closeIdx + 1);
    return t.trim();
}

/**
 * Parse one logical "Resets …" line after tmux merge / ANSI strip.
 * Anchored so we never accept "Resets 1" as a prefix match inside "Resets 11:50am (tz)".
 */
function matchClaudeResetsMergedLine(rawLine) {
    let t = stripTrailingBudgetPctUsedTail(rawLine);
    const withTz = t.match(/^Resets\s+(.+)\s+\(([^)]+)\)\s*$/i);
    if (withTz) {
        return { fullReset: withTz[1].trim(), tz: withTz[2].trim() };
    }
    const plain = t.match(/^Resets\s+(.+)\s*$/i);
    if (plain) {
        return { fullReset: plain[1].trim(), tz: null };
    }
    return null;
}

/**
 * Join tmux-soft-wrapped continuation lines until we have a parseable Resets value (and balanced parens).
 */
function extractClaudeResetsBlock(lines, startIdx) {
    let merged = lines[startIdx];
    let j = startIdx;
    for (let merges = 0; merges < 8; merges += 1) {
        const parsed = matchClaudeResetsMergedLine(merged);
        if (!parsed) return { endIdx: j, fullReset: null, tz: null };
        const balanced = budgetParensBalanced(merged);
        if (looksCompleteClaudeResetPhrase(parsed.fullReset) && balanced) {
            return { endIdx: j, fullReset: parsed.fullReset, tz: parsed.tz };
        }
        let nextIdx = j + 1;
        while (nextIdx < lines.length && !lines[nextIdx].trim()) nextIdx += 1;
        if (nextIdx >= lines.length) {
            return looksCompleteClaudeResetPhrase(parsed.fullReset) && balanced
                ? { endIdx: j, fullReset: parsed.fullReset, tz: parsed.tz }
                : { endIdx: j, fullReset: null, tz: null };
        }
        const nt = lines[nextIdx].trim();
        if (/current\s+session/i.test(nt)) break;
        if (/current\s+week/i.test(nt)) break;
        if (/^\d+\s*%\s*used/i.test(nt)) break;
        merged = mergeBudgetWrappedLines(merged, lines[nextIdx]);
        j = nextIdx;
    }
    const finalParsed = matchClaudeResetsMergedLine(merged);
    if (!finalParsed) return { endIdx: j, fullReset: null, tz: null };
    const balanced = budgetParensBalanced(merged);
    return looksCompleteClaudeResetPhrase(finalParsed.fullReset) && balanced
        ? { endIdx: j, fullReset: finalParsed.fullReset, tz: finalParsed.tz }
        : { endIdx: j, fullReset: null, tz: null };
}

/**
 * Parse Claude Code /status Usage tab output.
 * Returns { session, week_all, week_sonnet } — each sub-object has pct_used, resets_at, tz (or null).
 */
function parseClaudeStatus(text) {
    const out = { session: null, week_all: null, week_sonnet: null };
    if (!text || typeof text !== 'string') return out;

    // The Usage tab layout (two known formats):
    //
    //   Old (single-line): Resets 5pm (Australia/Melbourne)  8% used
    //
    //   New (multi-line):  Current session
    //                      ████████  38% used
    //                      Resets 11:50am (Australia/Melbourne)
    //
    // pendingPctUsed accumulates any "% used" seen since the section header;
    // the Resets line triggers the write. Default 0 = fully available (Claude
    // omits the bar entirely when nothing has been consumed).
    //
    // Narrow tmux columns soft-wrap long Resets lines ("Monday …", "11:50am …"),
    // producing bogus captures like "M" or "1" unless we merge continuations.
    const lines = stripAnsi(text).replace(/\r\n/g, '\n').split('\n');
    let currentSection = null;
    let pendingPctUsed = 0;
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (/current\s+session/i.test(line)) { currentSection = 'session'; pendingPctUsed = 0; continue; }
        if (/current\s+week\s*\(?\s*all/i.test(line)) { currentSection = 'week_all'; pendingPctUsed = 0; continue; }
        if (/current\s+week\s*\(?\s*sonnet/i.test(line)) { currentSection = 'week_sonnet'; pendingPctUsed = 0; continue; }

        if (!currentSection) continue;

        const pct = line.match(/(\d+)\s*%\s*used/i);
        if (pct) pendingPctUsed = parseInt(pct[1], 10);

        if (!/Resets\s/i.test(line)) continue;

        const block = extractClaudeResetsBlock(lines, i);
        if (!block) continue;
        i = block.endIdx;
        const fullReset = block.fullReset;
        const tz = block.tz;
        if (!fullReset || !looksCompleteClaudeResetPhrase(fullReset)) {
            out[currentSection] = { pct_used: pendingPctUsed, resets_at: null, resets_date: null, tz: null };
            currentSection = null;
            pendingPctUsed = 0;
            continue;
        }
        // "May 11 at 9am" → split into resets_date + resets_at; plain "11:50am" stays as-is
        const dtMatch = fullReset.match(/^(.+?)\s+at\s+(\S+)$/i);
        if (dtMatch) {
            out[currentSection] = { pct_used: pendingPctUsed, resets_at: dtMatch[2], resets_date: dtMatch[1].trim(), tz };
        } else {
            out[currentSection] = { pct_used: pendingPctUsed, resets_at: fullReset, tz };
        }
        currentSection = null;
        pendingPctUsed = 0;
    }
    return out;
}

/**
 * Parse Codex startup banner.
 * Returns { five_hour, weekly } — each has pct_remaining, resets_at, and weekly has resets_date.
 */
function stripAnsi(text) {
    if (!text || typeof text !== 'string') return '';
    return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
}

function stripGeminiLineNoise(rawLine) {
    return String(rawLine || '')
        .replace(/^[\s│║╔╗╚╝═╠╣╦╩╬╭╮╯╰▀▄▝▘▖▗]+/g, '')
        .trim();
}

/**
 * Parse Gemini CLI /model screen — "Model usage" rows (Flash Lite, Flash, Pro).
 * Ink may indent/pad names; match tier tokens in-line (not only at column 0).
 */
function parseGeminiModelUsage(text) {
    const clean = stripAnsi(text).replace(/\r\n/g, '\n');
    const seen = new Map();

    for (const rawLine of clean.split('\n')) {
        const L = stripGeminiLineNoise(rawLine);
        if (!L) continue;

        let m;
        let key;
        let label;
        if (/Flash\s+Lite/i.test(L)) {
            m = L.match(/\bFlash\s+Lite\b[^\d\n]*(\d+)\s*%/i);
            key = 'flash_lite';
            label = 'Flash Lite';
        } else if (/\bFlash\b/i.test(L)) {
            m = L.match(/\bFlash\b[^\d\n]*(\d+)\s*%/i);
            key = 'flash';
            label = 'Flash';
        } else if (/\bPro\b/i.test(L)) {
            m = L.match(/\bPro\b[^\d\n]*(\d+)\s*%/i);
            key = 'pro';
            label = 'Pro';
        } else {
            continue;
        }
        if (!m) continue;
        if (seen.has(key)) continue;
        const pctUsed = Math.max(0, Math.min(100, parseInt(m[1], 10)));
        const rm = L.match(/Resets:\s*([^\n│]+)/i);
        const resetsAt = rm ? rm[1].trim() : null;
        seen.set(key, { tier: key, label, pct_used: pctUsed, resets_at: resetsAt });
    }

    const order = ['flash_lite', 'flash', 'pro'];
    return order.filter(k => seen.has(k)).map(k => seen.get(k));
}

/**
 * Fallback when the Model usage block is off-screen: footer shows
 * "Auto (Gemini …) … 15% used" (and optional "Limit resets in …").
 */
function parseGeminiFooterPlanQuota(text) {
    const clean = stripAnsi(text).replace(/\r\n/g, '\n');
    let last = null;
    for (const rawLine of clean.split('\n')) {
        const L = stripGeminiLineNoise(rawLine);
        if (!L || !/\b(?:Auto|Manual)\b/i.test(L)) continue;
        const m = L.match(/(\d+)\s*%\s*used/i);
        if (!m) continue;
        const pctUsed = Math.max(0, Math.min(100, parseInt(m[1], 10)));
        const resetM = L.match(/Limit\s+resets\s+in\s+([^\s)]+(?:\s+[^\s)]+)*)/i);
        last = {
            pct_used: pctUsed,
            resets_at: resetM ? resetM[1].trim() : null,
        };
    }
    return last;
}

/**
 * Detect Gemini's "Usage limit reached for all Pro models" exhaustion screen.
 * Gemini shows this menu instead of the normal usage table, so the other parsers
 * return nothing. Treat it as 100% used and extract the reset time if present.
 */
function parseGeminiQuotaExhausted(text) {
    const clean = stripAnsi(text).replace(/\r\n/g, '\n');
    if (!/usage\s+limit\s+reached/i.test(clean)) return null;
    const resetM = clean.match(/access\s+resets\s+at\s+([^\n.]+)/i);
    const resetsAt = resetM ? resetM[1].trim() : null;
    return [
        { tier: 'pro', label: 'Pro', pct_used: 100, resets_at: resetsAt },
    ];
}

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

/**
 * Parse Antigravity CLI /usage output ("Models & Quota" screen).
 * Returns array of { tier, label, pct_used, resets_at } — pct_used is derived from
 * the on-screen "weekly limit" percentage (remaining headroom, not consumed).
 */
function parseAntigravityUsage(text) {
    const clean = stripAnsi(text).replace(/\r\n/g, '\n');
    if (!/models\s*&\s*quota/i.test(clean)) return [];

    function parseGroup(block, tier, label) {
        if (!block) return null;
        const pctMatch = block.match(/Weekly\s+Limit[\s\S]*?(\d+(?:\.\d+)?)\s*%/i);
        if (!pctMatch) return null;
        const pctRemaining = Math.max(0, Math.min(100, parseFloat(pctMatch[1])));
        const refreshMatch = block.match(/Refreshes\s+in\s+([^\n]+)/i);
        const resetsAt = refreshMatch
            ? refreshMatch[1].trim()
            : (/quota available/i.test(block) ? 'Quota available' : null);
        return {
            tier,
            label,
            pct_used: 100 - pctRemaining,
            resets_at: resetsAt,
        };
    }

    const geminiBlock = clean.match(/GEMINI MODELS([\s\S]*?)(?=CLAUDE AND GPT MODELS|Within each group|$)/i);
    const claudeBlock = clean.match(/CLAUDE AND GPT MODELS([\s\S]*?)(?=Within each group|$)/i);
    const tiers = [];
    const gemini = parseGroup(geminiBlock && geminiBlock[1], 'gemini_models', 'Gemini models');
    const claude = parseGroup(claudeBlock && claudeBlock[1], 'claude_gpt_models', 'Claude & GPT models');
    if (gemini) tiers.push(gemini);
    if (claude) tiers.push(claude);
    return tiers;
}

/**
 * Parse Kimi CLI /usage output.
 * Returns array of { tier, label, pct_used, resets_at }.
 */
function parseKimiUsage(text) {
    const clean = stripAnsi(text).replace(/\r\n/g, '\n');
    const tiers = [];
    for (const rawLine of clean.split('\n')) {
        const line = rawLine.trim();
        if (!/%\s*left/i.test(line)) continue;
        // Allow optional leading/trailing box-drawing chars (Kimi renders a bordered panel)
        const m = line.match(/^[│║╔╗╚╝═╠╣╦╩╬╭╮╯╰▀▄▝▘▖▗\s]*([A-Za-z0-9][A-Za-z0-9\s]*?)\s{2,}[^\d%]*?(\d+)%\s*left(?:\s*\(([^)]+)\))?[│║╔╗╚╝═╠╣╦╩╬╭╮╯╰▀▄▝▘▖▗\s]*$/);
        if (!m) continue;
        const label = m[1].trim();
        const pctRemaining = Math.max(0, Math.min(100, parseInt(m[2], 10)));
        const resetHint = m[3] ? m[3].trim() : null;
        const tierKey = label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        tiers.push({ tier: tierKey || 'limit', label, pct_used: 100 - pctRemaining, resets_at: resetHint });
    }
    return tiers;
}

// ---------------------------------------------------------------------------
// Poll sequences
// ---------------------------------------------------------------------------

async function pollClaudeBudget({ log } = {}) {
    cleanupBudgetSessions(SESSION_CC_PREFIX, { log });
    if (!binaryOnPath('claude')) {
        (log || console.log)('[budget-poller] claude binary not on PATH — skipping cc');
        return null;
    }
    const sessionName = budgetSessionName(SESSION_CC_PREFIX);
    if (!newSession(sessionName, { cols: 420, rows: 56 })) {
        (log || console.log)('[budget-poller] failed to create cc tmux session');
        return null;
    }
    try {
        sendText(sessionName, 'claude --dangerously-skip-permissions');
        await sleep(8000);
        sendText(sessionName, '/status');
        await sleep(2000);
        send(sessionName, ['Right']); // Settings tab
        await sleep(300);
        send(sessionName, ['Right']); // Usage tab
        await sleep(800);
        const raw = capture(sessionName, { historyStart: '-500' });
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
        killSession(sessionName);
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

async function pollKimiBudget({ log } = {}) {
    cleanupBudgetSessions(SESSION_KM_PREFIX, { log });
    if (!binaryOnPath('kimi')) {
        (log || console.log)('[budget-poller] kimi binary not on PATH — skipping km');
        return null;
    }
    const sessionName = budgetSessionName(SESSION_KM_PREFIX);
    if (!newSession(sessionName, { cols: 220, rows: 50 })) {
        (log || console.log)('[budget-poller] failed to create km tmux session');
        return null;
    }
    try {
        sendText(sessionName, 'kimi');
        await sleep(15000);
        const earlyRaw = capture(sessionName, { historyStart: '-200' });
        if (/please run \/login first/i.test(earlyRaw) || /llm not set/i.test(earlyRaw)) {
            (log || console.log)('[budget-poller] km: not authenticated — skipping cache write');
            return null;
        }
        sendText(sessionName, '/usage');
        await sleep(8000);
        const raw = capture(sessionName, { historyStart: '-200' });
        if (!/%\s*left/i.test(raw)) {
            (log || console.log)('[budget-poller] km: no "% left" markers — skipping cache write');
            return null;
        }
        const tiers = parseKimiUsage(raw);
        if (!tiers.length) {
            (log || console.log)('[budget-poller] km: no usage tiers parsed — skipping cache write');
            return null;
        }
        return {
            polled_at: new Date().toISOString(),
            tiers,
        };
    } finally {
        killSession(sessionName);
    }
}

function shouldPollBudgetAgent(agentId, repoPath) {
    try {
        return require('./agent-availability').isAgentQuotaPanelVisible(agentId, repoPath);
    } catch (_) {
        return true;
    }
}

module.exports = {
    pollClaudeBudget,
    pollCodexBudget,
    pollKimiBudget,
    parseClaudeStatus,
    parseCodexBanner,
    parseGeminiModelUsage,
    parseGeminiFooterPlanQuota,
    parseGeminiQuotaExhausted,
    parseAntigravityUsage,
    parseKimiUsage,
    parsePsRows,
    collectBudgetProcessTreePids,
    budgetSessionName,
    stripAnsi,
    stripGeminiLineNoise,
    shouldPollBudgetAgent,
};
