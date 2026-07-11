'use strict';

/**
 * OpenCode (`op`) model surface — one cache, two sources:
 *   1. OpenRouter /api/v1/models  → which ids advertise tool use (fast, ~1s)
 *   2. `opencode models openrouter` → which ids OpenCode actually accepts (slow, cached 24h)
 *
 * Picker + launch use the intersection so new models appear automatically when both
 * providers add them — no shipped snapshot and no per-model alias table.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

const OR_URL = 'https://openrouter.ai/api/v1/models';
const TTL_OR_MS = 6 * 60 * 60 * 1000;
const TTL_OPCODE_MS = 24 * 60 * 60 * 1000;
// OpenRouter slugs already owned by cc/cx/ag — not shown in the op picker.
const DEDICATED_VENDOR_PREFIXES = [
    'anthropic/', 'openai/', 'google/',
    '~anthropic/', '~openai/', '~google/',
];
const NON_CODING_MODALITY = /(-tts|tts-preview|speech|audio|voice|voxtral|robotics|computer-use|-vl-|vl-max|vl-plus|flash-image|pro-image|nano-banana|imagen|-image\b|-image-preview)/i;

let _mem = null;
let _refreshing = null;

function cachePath() {
    return path.join(process.env.AIGON_HOME || os.homedir(), '.aigon', 'cache', 'op-models.json');
}

function readCache() {
    try {
        return JSON.parse(fs.readFileSync(cachePath(), 'utf8'));
    } catch {
        return null;
    }
}

function writeCache(data) {
    fs.mkdirSync(path.dirname(cachePath()), { recursive: true });
    fs.writeFileSync(cachePath(), `${JSON.stringify(data, null, 2)}\n`);
}

function isFresh(iso, ttlMs) {
    if (!iso) return false;
    const age = Date.now() - Date.parse(iso);
    return Number.isFinite(age) && age >= 0 && age < ttlMs;
}

function opencodeBin() {
    const home = process.env.AIGON_HOME || os.homedir();
    for (const candidate of ['~/.opencode/bin/opencode', 'opencode']) {
        const expanded = candidate.startsWith('~') ? path.join(home, candidate.slice(1)) : candidate;
        if (candidate === 'opencode') {
            const which = spawnSync('which', ['opencode'], { encoding: 'utf8' });
            if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
        } else if (fs.existsSync(expanded)) {
            return expanded;
        }
    }
    return null;
}

function fetchOrTools() {
    const body = execSync(`curl -sf --max-time 8 '${OR_URL}'`, {
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
    });
    const tools = [];
    const labels = {};
    for (const row of JSON.parse(body).data || []) {
        if (!row || typeof row.id !== 'string') continue;
        const value = `openrouter/${row.id}`;
        labels[value] = row.name || row.id;
        if ((row.supported_parameters || []).includes('tools')) tools.push(value);
    }
    return { tools, labels };
}

function fetchOpencodeRoutable() {
    const bin = opencodeBin();
    if (!bin) return null;
    const result = spawnSync(bin, ['models', 'openrouter'], { encoding: 'utf8', timeout: 120000 });
    if (result.status !== 0) return null;
    return result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('openrouter/'));
}

function isOpPickerModel(value) {
    const raw = String(value || '').replace(/^openrouter\//, '');
    if (!raw || raw.includes(':free')) return false;
    if (NON_CODING_MODALITY.test(raw)) return false;
    return !DEDICATED_VENDOR_PREFIXES.some((prefix) => raw.startsWith(prefix));
}

function intersectRoutable(orTools, opencodeList) {
    if (!Array.isArray(orTools) || !orTools.length) return [];
    const candidates = !Array.isArray(opencodeList) || !opencodeList.length
        ? orTools
        : opencodeList.filter((id) => orTools.includes(id));
    return candidates.filter(isOpPickerModel);
}

function buildCache(prev, { orTools, labels, opencodeList }) {
    const next = { ...(prev || {}) };
    if (orTools) {
        next.orTools = orTools;
        next.labels = { ...(next.labels || {}), ...(labels || {}) };
        next.orFetchedAt = new Date().toISOString();
    }
    if (opencodeList) {
        next.opencodeRoutable = opencodeList;
        next.opencodeFetchedAt = new Date().toISOString();
    }
    next.routable = intersectRoutable(next.orTools || [], next.opencodeRoutable || null);
    next.fetchedAt = new Date().toISOString();
    return next;
}

async function refresh({ forceOpencode = false } = {}) {
    const prev = readCache() || {};
    const needOr = forceOpencode || !isFresh(prev.orFetchedAt, TTL_OR_MS);
    const needOp = forceOpencode || !isFresh(prev.opencodeFetchedAt, TTL_OPCODE_MS);

    if (!needOr && !needOp) {
        _mem = prev;
        return prev;
    }
    if (_refreshing) return _refreshing;

    _refreshing = (async () => {
        let next = { ...prev };
        if (needOr) {
            const { tools, labels } = fetchOrTools();
            next = buildCache(next, { orTools: tools, labels });
        }
        if (needOp) {
            const list = fetchOpencodeRoutable();
            if (list) next = buildCache(next, { opencodeList: list });
        }
        writeCache(next);
        _mem = next;
        return next;
    })().finally(() => {
        _refreshing = null;
    });

    return _refreshing;
}

function load() {
    if (_mem) return _mem;
    const disk = readCache();
    if (disk) {
        _mem = disk;
        if (!isFresh(disk.orFetchedAt, TTL_OR_MS) || !isFresh(disk.opencodeFetchedAt, TTL_OPCODE_MS)) {
            setImmediate(() => refresh().catch(() => {}));
        }
        return disk;
    }
    try {
        const { tools, labels } = fetchOrTools();
        const payload = buildCache(null, { orTools: tools, labels });
        writeCache(payload);
        _mem = payload;
        setImmediate(() => refresh({ forceOpencode: true }).catch(() => {}));
        return payload;
    } catch {
        return { routable: [], labels: {} };
    }
}

function refreshIfStale() {
    const disk = readCache();
    if (disk && isFresh(disk.orFetchedAt, TTL_OR_MS) && isFresh(disk.opencodeFetchedAt, TTL_OPCODE_MS)) {
        _mem = disk;
        return Promise.resolve(disk);
    }
    return refresh().catch(() => disk || null);
}

function idVariants(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed.startsWith('openrouter/')) return [trimmed];
    const raw = trimmed.slice('openrouter/'.length);
    const out = [trimmed];
    const mmDd = raw.match(/^(.*)-(\d{2})-(\d{2})$/);
    if (mmDd) out.push(`openrouter/${mmDd[1]}-${mmDd[3]}${mmDd[2]}`);
    return out;
}

/** Resolve to an id OpenCode can run today, or null. */
function resolveOpModel(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return null;
    if (!trimmed.startsWith('openrouter/')) return trimmed;
    const routable = new Set(load().routable || []);
    for (const candidate of idVariants(trimmed)) {
        if (routable.has(candidate)) return candidate;
    }
    return null;
}

function isValidOpModel(value) {
    return Boolean(resolveOpModel(value));
}

/** Dynamic picker: live routable ids + optional curated overlay from op.json. */
function listOpModelOptions(overlay = []) {
    const cache = load();
    const retired = new Set(
        (overlay || [])
            .filter((opt) => opt && (opt.quarantined || opt.archived) && opt.value)
            .map((opt) => String(opt.value)),
    );
    const metaByValue = new Map(
        (overlay || [])
            .filter((opt) => opt && opt.value != null && String(opt.value).trim())
            .map((opt) => [String(opt.value), opt]),
    );

    return (cache.routable || [])
        .filter((value) => !retired.has(value))
        .map((value) => {
            const meta = metaByValue.get(value) || {};
            const parts = value.replace(/^openrouter\//, '').split('/');
            const fallbackLabel = parts.slice(-2).join(' / ');
            return {
                ...meta,
                value,
                label: meta.label || cache.labels?.[value] || fallbackLabel,
                _curated: Boolean(meta.score || meta.notes || meta.summary),
            };
        })
        .sort((a, b) => {
            if (a._curated !== b._curated) return a._curated ? -1 : 1;
            return String(a.label).localeCompare(String(b.label));
        })
        .map(({ _curated, ...opt }) => opt);
}

module.exports = {
    cachePath,
    load,
    refresh,
    refreshIfStale,
    resolveOpModel,
    isValidOpModel,
    listOpModelOptions,
};
