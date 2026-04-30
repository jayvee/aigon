'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const { parseFrontMatter } = require('./cli-parse');

const FEATURE_STAGE_DIRS = Object.freeze([
    { dir: '01-inbox', stage: 'inbox' },
    { dir: '02-backlog', stage: 'backlog' },
    { dir: '03-in-progress', stage: 'in-progress' },
    { dir: '04-in-evaluation', stage: 'in-evaluation' },
    { dir: '05-done', stage: 'done' },
    { dir: '06-paused', stage: 'paused' },
]);

const _repoCache = new Map();

function safeStat(targetPath) {
    try {
        return fs.statSync(targetPath);
    } catch (_) {
        return null;
    }
}

function safeReadDir(targetPath) {
    try {
        return fs.readdirSync(targetPath);
    } catch (_) {
        return [];
    }
}

function parseFeatureFileName(file) {
    const withId = file.match(/^feature-(\d+)-(.+)\.md$/);
    if (withId) return { id: withId[1], slug: withId[2] };
    const slugOnly = file.match(/^feature-(.+)\.md$/);
    if (!slugOnly) return null;
    return { id: null, slug: slugOnly[1] };
}

function normalizeDependsOn(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(value => String(value).trim()).filter(Boolean);
}

function buildEntryFromFile(stageInfo, filePath, mtimeMs) {
    const file = path.basename(filePath);
    const parsedName = parseFeatureFileName(file);
    if (!parsedName) return null;
    let raw;
    try {
        raw = fs.readFileSync(filePath, 'utf8');
    } catch (_) {
        return null;
    }
    const { data } = parseFrontMatter(raw);
    return {
        stage: stageInfo.stage,
        id: parsedName.id,
        slug: parsedName.slug,
        file,
        fullPath: filePath,
        setSlug: data && data.set ? String(data.set).trim() : null,
        dependsOn: normalizeDependsOn(data && data.depends_on),
        frontmatterRaw: data || {},
        mtimeMs,
    };
}

function buildMaterializedIndex(repoPath, entries) {
    const byFeatureId = new Map();
    const bySlug = new Map();
    const byPath = new Map();
    const bySet = new Map();
    const byStage = new Map();

    entries.forEach(entry => {
        byPath.set(entry.fullPath, entry);
        if (!byStage.has(entry.stage)) byStage.set(entry.stage, []);
        byStage.get(entry.stage).push(entry);
        if (entry.id) {
            byFeatureId.set(entry.id, entry);
            byFeatureId.set(String(parseInt(entry.id, 10)), entry);
        }
        if (entry.slug) {
            bySlug.set(entry.slug, entry);
        }
        if (entry.setSlug) {
            if (!bySet.has(entry.setSlug)) bySet.set(entry.setSlug, []);
            bySet.get(entry.setSlug).push(entry);
        }
    });

    return {
        repoPath,
        generatedAt: new Date().toISOString(),
        entries,
        byFeatureId,
        bySlug,
        byPath,
        bySet,
        byStage,
    };
}

function createColdState(repoPath) {
    return {
        repoPath,
        dirMtimes: new Map(),
        knownFilesByStage: new Map(),
        fileCache: new Map(),
        materialized: buildMaterializedIndex(repoPath, []),
        calls: 0,
    };
}

function snapshotForWatchdog(index) {
    return index.entries.map(entry => ({
        stage: entry.stage,
        id: entry.id,
        slug: entry.slug,
        fullPath: entry.fullPath,
        setSlug: entry.setSlug,
        dependsOn: entry.dependsOn,
        frontmatterRaw: entry.frontmatterRaw,
    }));
}

function logWatchdogDiff(repoPath, warm, cold) {
    const warmSig = snapshotForWatchdog(warm);
    const coldSig = snapshotForWatchdog(cold);
    if (util.isDeepStrictEqual(warmSig, coldSig)) return;

    const warmJson = JSON.stringify(warmSig);
    const coldJson = JSON.stringify(coldSig);
    let mismatchAt = -1;
    const min = Math.min(warmJson.length, coldJson.length);
    for (let i = 0; i < min; i += 1) {
        if (warmJson[i] !== coldJson[i]) {
            mismatchAt = i;
            break;
        }
    }
    if (mismatchAt === -1 && warmJson.length !== coldJson.length) mismatchAt = min;

    console.warn('[dashboard-spec-index] WATCHDOG_DIVERGENCE', {
        repoPath,
        warmEntries: warm.entries.length,
        coldEntries: cold.entries.length,
        mismatchAt,
        warmPreview: warmJson.slice(Math.max(0, mismatchAt - 40), mismatchAt + 80),
        coldPreview: coldJson.slice(Math.max(0, mismatchAt - 40), mismatchAt + 80),
    });
}

function coldRebuild(repoPath) {
    const featureRoot = path.join(repoPath, 'docs', 'specs', 'features');
    const entries = [];
    const state = createColdState(repoPath);

    FEATURE_STAGE_DIRS.forEach(stageInfo => {
        const stageDir = path.join(featureRoot, stageInfo.dir);
        const dirStat = safeStat(stageDir);
        state.dirMtimes.set(stageInfo.dir, dirStat ? dirStat.mtimeMs : 0);

        const files = safeReadDir(stageDir)
            .filter(file => file.endsWith('.md') && file.startsWith('feature-'))
            .sort((a, b) => a.localeCompare(b));
        const fileSet = new Set();

        files.forEach(file => {
            const fullPath = path.join(stageDir, file);
            const fileStat = safeStat(fullPath);
            if (!fileStat) return;
            fileSet.add(fullPath);
            const entry = buildEntryFromFile(stageInfo, fullPath, fileStat.mtimeMs);
            if (!entry) return;
            state.fileCache.set(fullPath, { mtimeMs: fileStat.mtimeMs, entry });
            entries.push(entry);
        });

        state.knownFilesByStage.set(stageInfo.dir, fileSet);
    });

    entries.sort((a, b) => a.fullPath.localeCompare(b.fullPath));
    state.materialized = buildMaterializedIndex(repoPath, entries);
    return state;
}

function applyWarmRefresh(state) {
    const repoPath = state.repoPath;
    const featureRoot = path.join(repoPath, 'docs', 'specs', 'features');

    FEATURE_STAGE_DIRS.forEach(stageInfo => {
        const stageDir = path.join(featureRoot, stageInfo.dir);
        const dirStat = safeStat(stageDir);
        const currentDirMtime = dirStat ? dirStat.mtimeMs : 0;
        const previousDirMtime = state.dirMtimes.get(stageInfo.dir) || 0;

        let knownFiles = state.knownFilesByStage.get(stageInfo.dir) || new Set();
        if (currentDirMtime !== previousDirMtime) {
            const files = safeReadDir(stageDir)
                .filter(file => file.endsWith('.md') && file.startsWith('feature-'));
            knownFiles = new Set(files.map(file => path.join(stageDir, file)));
            state.knownFilesByStage.set(stageInfo.dir, knownFiles);
            state.dirMtimes.set(stageInfo.dir, currentDirMtime);
        }

        for (const fullPath of [...knownFiles]) {
            const fileStat = safeStat(fullPath);
            if (!fileStat) {
                knownFiles.delete(fullPath);
                state.fileCache.delete(fullPath);
                continue;
            }
            const cached = state.fileCache.get(fullPath);
            if (cached && cached.mtimeMs === fileStat.mtimeMs) {
                continue;
            }
            const entry = buildEntryFromFile(stageInfo, fullPath, fileStat.mtimeMs);
            if (!entry) {
                state.fileCache.delete(fullPath);
                continue;
            }
            state.fileCache.set(fullPath, { mtimeMs: fileStat.mtimeMs, entry });
        }
    });

    const entries = [...state.fileCache.values()]
        .map(item => item.entry)
        .sort((a, b) => a.fullPath.localeCompare(b.fullPath));
    state.materialized = buildMaterializedIndex(repoPath, entries);
}

function getRepoSpecIndex(repoPath, opts = {}) {
    const watchdogEvery = Number.isFinite(opts.watchdogEvery)
        ? Math.max(1, opts.watchdogEvery)
        : Math.max(1, parseInt(process.env.AIGON_STATUS_CACHE_WATCHDOG_EVERY || '10', 10) || 10);
    const disableCache = process.env.AIGON_DISABLE_STATUS_CACHE === '1';

    if (disableCache) {
        return coldRebuild(repoPath).materialized;
    }

    let state = _repoCache.get(repoPath);
    if (!state) {
        state = coldRebuild(repoPath);
        _repoCache.set(repoPath, state);
    } else {
        applyWarmRefresh(state);
    }

    state.calls += 1;
    if (state.calls % watchdogEvery === 0) {
        const cold = coldRebuild(repoPath).materialized;
        logWatchdogDiff(repoPath, state.materialized, cold);
    }

    return state.materialized;
}

function clearRepoSpecIndexCache(repoPath) {
    if (repoPath) {
        _repoCache.delete(repoPath);
        return;
    }
    _repoCache.clear();
}

module.exports = {
    FEATURE_STAGE_DIRS,
    getRepoSpecIndex,
    clearRepoSpecIndexCache,
};
