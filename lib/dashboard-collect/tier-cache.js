'use strict';

const path = require('path');
const probeTtlCache = require('../probe-ttl-cache');

const _tierCache = new Map();

function getTierCache(repoPath) {
    const cacheKey = path.resolve(repoPath);
    let cache = _tierCache.get(cacheKey);
    if (cache) return cache;

    cache = {
        cold: {
            featuresDirMtime: null,
            features: { total: 0, all: [], recent: [] },
            doneTotal: 0,
            researchDirMtime: null,
            research: { total: 0, all: [], recent: [] },
            feedbackDirMtime: null,
            githubRemote: null,
            feedback: { total: 0, all: [], recent: [] },
        },
        warm: {
            backlogMtime: null,
            backlog: [],
            inboxMtime: null,
            inbox: [],
            pausedMtime: null,
            paused: [],
        }
    };
    _tierCache.set(cacheKey, cache);
    return cache;
}

function clearTierCache(repoPath = null) {
    if (!repoPath) {
        _tierCache.clear();
        probeTtlCache.clear();
        return;
    }
    const resolved = path.resolve(repoPath);
    _tierCache.delete(resolved);
    probeTtlCache.invalidateKeysIncluding(resolved);
}

module.exports = {
    getTierCache,
    clearTierCache,
};
