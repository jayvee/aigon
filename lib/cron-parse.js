'use strict';

/**
 * Minimal 5-field cron parser used by the scheduler for agent_prompt re-arming.
 *
 * Fields (in order): minute hour day-of-month month day-of-week
 * Per field: `*`, `N`, `N-M`, `*\/S`, `N-M/S`, comma-separated lists.
 * day-of-week: 0-7 (both 0 and 7 = Sunday).
 *
 * DOM/DOW semantics: Vixie-cron OR rule — when both DOM and DOW are restricted
 * (neither is `*`), a date matches if EITHER matches. Otherwise both must match
 * (with `*` matching everything).
 */

const RANGES = [
    { name: 'minute', min: 0, max: 59 },
    { name: 'hour', min: 0, max: 23 },
    { name: 'dom', min: 1, max: 31 },
    { name: 'month', min: 1, max: 12 },
    { name: 'dow', min: 0, max: 7 },
];

function _parseField(raw, range) {
    const out = new Set();
    const parts = String(raw).split(',');
    for (const part of parts) {
        const [rangePart, stepPart] = part.split('/');
        const step = stepPart != null ? parseInt(stepPart, 10) : 1;
        if (!Number.isFinite(step) || step < 1) {
            throw new Error(`invalid step in field "${range.name}": ${part}`);
        }
        let lo, hi;
        if (rangePart === '*') {
            lo = range.min; hi = range.max;
        } else if (rangePart.includes('-')) {
            const [a, b] = rangePart.split('-').map(s => parseInt(s, 10));
            if (!Number.isFinite(a) || !Number.isFinite(b)) {
                throw new Error(`invalid range in field "${range.name}": ${part}`);
            }
            lo = a; hi = b;
        } else {
            const n = parseInt(rangePart, 10);
            if (!Number.isFinite(n)) {
                throw new Error(`invalid value in field "${range.name}": ${part}`);
            }
            lo = n; hi = n;
        }
        if (lo < range.min || hi > range.max || lo > hi) {
            throw new Error(`out-of-range value in field "${range.name}": ${part} (allowed ${range.min}-${range.max})`);
        }
        for (let v = lo; v <= hi; v += step) out.add(v);
    }
    if (out.size === 0) throw new Error(`empty field "${range.name}"`);
    return out;
}

function parseCron(expr) {
    const s = String(expr || '').trim();
    if (!s) throw new Error('cron expression is empty');
    const fields = s.split(/\s+/);
    if (fields.length !== 5) {
        throw new Error(`cron must have 5 fields (got ${fields.length}): "${s}"`);
    }
    const parsed = {};
    for (let i = 0; i < 5; i++) {
        parsed[RANGES[i].name] = _parseField(fields[i], RANGES[i]);
    }
    // Normalise DOW: collapse 7 → 0 (both = Sunday)
    if (parsed.dow.has(7)) {
        parsed.dow.delete(7);
        parsed.dow.add(0);
    }
    parsed._raw = s;
    parsed._domRestricted = fields[2] !== '*';
    parsed._dowRestricted = fields[4] !== '*';
    return parsed;
}

/** Compute the next firing time strictly greater than `fromMs`. */
function nextTime(parsed, fromMs) {
    // Step by 1 minute starting at the next minute boundary after fromMs.
    let d = new Date(fromMs);
    d.setUTCSeconds(0, 0);
    d = new Date(d.getTime() + 60_000);

    const maxIterations = 366 * 24 * 60 * 4; // 4 years
    for (let i = 0; i < maxIterations; i++) {
        const minute = d.getUTCMinutes();
        const hour = d.getUTCHours();
        const dom = d.getUTCDate();
        const month = d.getUTCMonth() + 1;
        const dow = d.getUTCDay();

        if (parsed.minute.has(minute)
            && parsed.hour.has(hour)
            && parsed.month.has(month)) {
            const domOk = parsed.dom.has(dom);
            const dowOk = parsed.dow.has(dow);
            // Vixie OR semantics when both restricted; otherwise both must match.
            const dateOk = (parsed._domRestricted && parsed._dowRestricted)
                ? (domOk || dowOk)
                : (domOk && dowOk);
            if (dateOk) return d.getTime();
        }
        d = new Date(d.getTime() + 60_000);
    }
    throw new Error(`cron "${parsed._raw}" produced no firing time within 4 years`);
}

module.exports = { parseCron, nextTime };
