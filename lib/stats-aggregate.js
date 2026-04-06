'use strict';

/**
 * Stats aggregate collector (feature 230).
 *
 * Reads per-feature / per-research `stats.json` files (written by
 * feature-close / research-close) and produces a single aggregate payload
 * for the Reports tab. Results are cached at
 * `.aigon/cache/stats-aggregate.json` and rebuilt lazily when any
 * `stats.json` is newer than the cache.
 *
 * Exports:
 *   collectAggregateStats(repoPath, { force }) -> aggregate object
 *   rebuildAggregate(repoPath)                 -> aggregate object (forced)
 *   cachePath(repoPath)                        -> absolute path
 *   CACHE_VERSION                              -> integer
 */

const fs = require('fs');
const path = require('path');

const CACHE_VERSION = 1;

function cachePath(repoPath) {
    return path.join(repoPath, '.aigon', 'cache', 'stats-aggregate.json');
}

function workflowsRoot(repoPath) {
    return path.join(repoPath, '.aigon', 'workflows');
}

function safeStat(p) {
    try { return fs.statSync(p); } catch (_) { return null; }
}

function safeReadJson(p) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}

/**
 * Find every stats.json under .aigon/workflows/{features,research}/<id>/stats.json.
 * Returns an array of { entityType, entityId, filePath, mtimeMs }.
 */
function listStatsFiles(repoPath) {
    const root = workflowsRoot(repoPath);
    const results = [];
    if (!fs.existsSync(root)) return results;

    for (const entityType of ['features', 'research']) {
        const dir = path.join(root, entityType);
        if (!fs.existsSync(dir)) continue;
        let entries;
        try { entries = fs.readdirSync(dir); } catch (_) { continue; }
        for (const entityId of entries) {
            const file = path.join(dir, entityId, 'stats.json');
            const st = safeStat(file);
            if (!st || !st.isFile()) continue;
            results.push({
                entityType: entityType === 'features' ? 'feature' : 'research',
                entityId,
                filePath: file,
                mtimeMs: st.mtimeMs,
            });
        }
    }
    return results;
}

/**
 * Cache is fresh when:
 *  - it exists
 *  - it declares the current CACHE_VERSION
 *  - no stats.json has an mtime newer than the cache
 */
function isCacheFresh(repoPath, statsFiles) {
    const p = cachePath(repoPath);
    const st = safeStat(p);
    if (!st) return false;
    const cached = safeReadJson(p);
    if (!cached || cached.version !== CACHE_VERSION) return false;
    const cacheMtime = st.mtimeMs;
    for (const f of statsFiles) {
        if (f.mtimeMs > cacheMtime) return false;
    }
    return true;
}

function isoWeek(date) {
    // ISO week format YYYY-Www
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function isoMonth(date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function round(n, dp) {
    const mul = Math.pow(10, dp);
    return Math.round(n * mul) / mul;
}

/**
 * Build the aggregate payload from the list of loaded stats records.
 */
function buildAggregate(records) {
    const aggregate = {
        version: CACHE_VERSION,
        generatedAt: new Date().toISOString(),
        totals: {
            features: 0,
            research: 0,
            cost: 0,
            commits: 0,
            linesAdded: 0,
            linesRemoved: 0,
            filesChanged: 0,
            durationMs: 0,
        },
        perAgent: {},
        perWeek: [],
        perMonth: [],
        avgDurationMs: 0,
        fastestFeature: null,
        mostExpensive: null,
        recordCount: 0,
        entityCount: records.length,
    };

    const weekBuckets = {};
    const monthBuckets = {};
    let durationSum = 0;
    let durationCount = 0;

    for (const rec of records) {
        const { entityType, entityId, stats } = rec;
        if (!stats || typeof stats !== 'object') continue;
        aggregate.recordCount += 1;

        if (entityType === 'feature') aggregate.totals.features += 1;
        else if (entityType === 'research') aggregate.totals.research += 1;

        const cost = Number((stats.cost && stats.cost.estimatedUsd) || 0);
        const commits = Number(stats.commitCount || 0);
        const linesAdded = Number(stats.linesAdded || 0);
        const linesRemoved = Number(stats.linesRemoved || 0);
        const filesChanged = Number(stats.filesChanged || 0);
        const durationMs = Number(stats.durationMs || 0);

        aggregate.totals.cost += cost;
        aggregate.totals.commits += commits;
        aggregate.totals.linesAdded += linesAdded;
        aggregate.totals.linesRemoved += linesRemoved;
        aggregate.totals.filesChanged += filesChanged;
        aggregate.totals.durationMs += durationMs;

        if (durationMs > 0) {
            durationSum += durationMs;
            durationCount += 1;
            if (entityType === 'feature') {
                if (!aggregate.fastestFeature || durationMs < aggregate.fastestFeature.durationMs) {
                    aggregate.fastestFeature = { entityId, durationMs };
                }
            }
        }

        if (entityType === 'feature' && cost > 0) {
            if (!aggregate.mostExpensive || cost > aggregate.mostExpensive.cost) {
                aggregate.mostExpensive = { entityId, cost: round(cost, 4) };
            }
        }

        // Per-agent rollup. Prefer cost.byAgent when present (real per-agent
        // split); otherwise attribute the whole record to stats.agents[].
        const byAgent = stats.cost && stats.cost.byAgent;
        if (byAgent && typeof byAgent === 'object') {
            const agentEntries = Object.entries(byAgent);
            const totalAgentCost = agentEntries.reduce((sum, [, row]) => sum + Number(row.costUsd || 0), 0);
            for (const [agentId, row] of agentEntries) {
                const bucket = aggregate.perAgent[agentId] || (aggregate.perAgent[agentId] = {
                    features: 0, research: 0, cost: 0, commits: 0,
                    linesAdded: 0, linesRemoved: 0, filesChanged: 0, durationMs: 0, sessions: 0,
                });
                const ratio = totalAgentCost > 0
                    ? Number(row.costUsd || 0) / totalAgentCost
                    : 1 / agentEntries.length;
                if (entityType === 'feature') bucket.features += 1;
                else bucket.research += 1;
                bucket.cost += Number(row.costUsd || 0);
                bucket.commits += commits * ratio;
                bucket.linesAdded += linesAdded * ratio;
                bucket.linesRemoved += linesRemoved * ratio;
                bucket.durationMs += durationMs * ratio;
                bucket.filesChanged += filesChanged * ratio;
                bucket.sessions += Number(row.sessions || 0);
            }
        } else if (Array.isArray(stats.agents) && stats.agents.length > 0) {
            for (const agentId of stats.agents) {
                const bucket = aggregate.perAgent[agentId] || (aggregate.perAgent[agentId] = {
                    features: 0, research: 0, cost: 0, commits: 0,
                    linesAdded: 0, linesRemoved: 0, filesChanged: 0, durationMs: 0, sessions: 0,
                });
                if (entityType === 'feature') bucket.features += 1;
                else bucket.research += 1;
                // Split even when multiple agents share a single cost line
                bucket.cost += cost / stats.agents.length;
                bucket.commits += commits / stats.agents.length;
                bucket.linesAdded += linesAdded / stats.agents.length;
                bucket.linesRemoved += linesRemoved / stats.agents.length;
                bucket.filesChanged += filesChanged / stats.agents.length;
                bucket.durationMs += durationMs / stats.agents.length;
            }
        }

        // Weekly / monthly rollups keyed on completedAt (fall back to startedAt).
        const whenStr = stats.completedAt || stats.startedAt;
        if (whenStr) {
            const when = new Date(whenStr);
            if (!Number.isNaN(when.getTime())) {
                const w = isoWeek(when);
                const m = isoMonth(when);
                const wb = weekBuckets[w] || (weekBuckets[w] = { week: w, features: 0, research: 0, cost: 0, commits: 0 });
                const mb = monthBuckets[m] || (monthBuckets[m] = { month: m, features: 0, research: 0, cost: 0, commits: 0 });
                if (entityType === 'feature') { wb.features += 1; mb.features += 1; }
                else { wb.research += 1; mb.research += 1; }
                wb.cost += cost; mb.cost += cost;
                wb.commits += commits; mb.commits += commits;
            }
        }
    }

    aggregate.perWeek = Object.values(weekBuckets).sort((a, b) => a.week.localeCompare(b.week));
    aggregate.perMonth = Object.values(monthBuckets).sort((a, b) => a.month.localeCompare(b.month));
    aggregate.avgDurationMs = durationCount > 0 ? Math.round(durationSum / durationCount) : 0;

    // Round cost fields for display stability.
    aggregate.totals.cost = round(aggregate.totals.cost, 4);
    for (const bucket of Object.values(aggregate.perAgent)) {
        bucket.cost = round(bucket.cost, 4);
        bucket.commits = round(bucket.commits, 2);
        bucket.linesAdded = Math.round(bucket.linesAdded);
        bucket.linesRemoved = Math.round(bucket.linesRemoved);
        bucket.filesChanged = Math.round(bucket.filesChanged);
        bucket.durationMs = Math.round(bucket.durationMs);
    }
    for (const w of aggregate.perWeek) w.cost = round(w.cost, 4);
    for (const m of aggregate.perMonth) m.cost = round(m.cost, 4);

    return aggregate;
}

function writeCache(repoPath, aggregate) {
    const p = cachePath(repoPath);
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${p}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(aggregate, null, 2));
    fs.renameSync(tmp, p);
    return p;
}

function loadRecords(statsFiles) {
    const records = [];
    for (const f of statsFiles) {
        const stats = safeReadJson(f.filePath);
        if (!stats) continue;
        records.push({ entityType: f.entityType, entityId: f.entityId, stats });
    }
    return records;
}

/**
 * Main entry point. Returns the aggregate payload, rebuilding the cache
 * when stale. Pass { force: true } to rebuild unconditionally.
 */
function collectAggregateStats(repoPath, options = {}) {
    const files = listStatsFiles(repoPath);
    if (!options.force && isCacheFresh(repoPath, files)) {
        const cached = safeReadJson(cachePath(repoPath));
        if (cached) return cached;
    }
    const records = loadRecords(files);
    const aggregate = buildAggregate(records);
    try { writeCache(repoPath, aggregate); } catch (_) { /* cache write failures are non-fatal */ }
    return aggregate;
}

function rebuildAggregate(repoPath) {
    return collectAggregateStats(repoPath, { force: true });
}

module.exports = {
    CACHE_VERSION,
    cachePath,
    listStatsFiles,
    buildAggregate,
    collectAggregateStats,
    rebuildAggregate,
};
