'use strict';

const https = require('https');
const { version: currentVersion, channel } = require('./release-channel');

// States the version check can return
const UPDATE_STATE = {
    LATEST: 'latest',                       // current === latest for channel
    UPDATE_AVAILABLE: 'update-available',   // newer stable version exists
    PRERELEASE_AVAILABLE: 'prerelease-available', // newer next version exists (channel=latest only)
    UNAVAILABLE: 'unavailable',             // registry unreachable or parse error
};

const REGISTRY_URL = 'https://registry.npmjs.org/@senlabs/aigon';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let _cache = null;
let _cacheExpiry = 0;

function semverGt(a, b) {
    const parse = v => {
        const [main, pre] = (v || '').split('-');
        const parts = main.split('.').map(Number);
        return { parts, pre: pre || null };
    };
    const pa = parse(a);
    const pb = parse(b);
    for (let i = 0; i < 3; i++) {
        const na = pa.parts[i] || 0;
        const nb = pb.parts[i] || 0;
        if (na > nb) return true;
        if (na < nb) return false;
    }
    // Equal numeric parts — stable beats prerelease
    if (pa.pre && !pb.pre) return false;
    if (!pa.pre && pb.pre) return true;
    return false;
}

function fetchRegistryData(timeout = 8000, unref = false) {
    return new Promise((resolve, reject) => {
        const req = https.get(REGISTRY_URL, { timeout }, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`registry HTTP ${res.statusCode}`));
                res.resume();
                return;
            }
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString()));
                } catch (e) {
                    reject(new Error('registry parse error'));
                }
            });
        });
        if (unref) req.once('socket', s => s.unref());
        req.on('timeout', () => { req.destroy(); reject(new Error('registry timeout')); });
        req.on('error', reject);
    });
}

async function checkForUpdate({ force = false, unref = false } = {}) {
    if (!force && _cache && Date.now() < _cacheExpiry) {
        return _cache;
    }

    let distTags;
    try {
        const data = await fetchRegistryData(8000, unref);
        distTags = data['dist-tags'] || {};
    } catch (e) {
        const result = {
            state: UPDATE_STATE.UNAVAILABLE,
            current: currentVersion,
            latestStable: null,
            latestNext: null,
            upgradeCommand: 'npm update -g @senlabs/aigon',
            checkedAt: new Date().toISOString(),
            error: e.message,
        };
        // Cache unavailable result briefly (30s) so repeated calls don't hammer network
        _cache = result;
        _cacheExpiry = Date.now() + 30000;
        return result;
    }

    const latestStable = distTags.latest || null;
    const latestNext = distTags.next || null;

    let state;
    let upgradeTag = 'latest';

    if (channel === 'next') {
        // On next channel: compare against latestNext
        const latestForChannel = latestNext || latestStable;
        if (!latestForChannel) {
            state = UPDATE_STATE.UNAVAILABLE;
        } else if (semverGt(latestForChannel, currentVersion)) {
            state = UPDATE_STATE.UPDATE_AVAILABLE;
            upgradeTag = latestNext ? 'next' : 'latest';
        } else {
            state = UPDATE_STATE.LATEST;
        }
    } else {
        // On latest channel: compare against latestStable
        if (!latestStable) {
            state = UPDATE_STATE.UNAVAILABLE;
        } else if (semverGt(latestStable, currentVersion)) {
            state = UPDATE_STATE.UPDATE_AVAILABLE;
            upgradeTag = 'latest';
        } else if (latestNext && semverGt(latestNext, currentVersion)) {
            // Stable is current but a prerelease is ahead — inform but don't push
            state = UPDATE_STATE.PRERELEASE_AVAILABLE;
            upgradeTag = 'next';
        } else {
            state = UPDATE_STATE.LATEST;
        }
    }

    const result = {
        state,
        current: currentVersion,
        latestStable,
        latestNext,
        upgradeCommand: `npm update -g @senlabs/aigon@${upgradeTag}`,
        checkedAt: new Date().toISOString(),
        error: null,
    };

    _cache = result;
    _cacheExpiry = Date.now() + CACHE_TTL_MS;
    return result;
}

// Synchronous check — returns cached result or null (no network hit)
function getCachedUpdateCheck() {
    if (_cache && Date.now() < _cacheExpiry) return _cache;
    return null;
}

// Format a CLI notice line from a check result (returns null if nothing to show)
function formatUpdateNotice(result) {
    if (!result || result.state === UPDATE_STATE.LATEST || result.state === UPDATE_STATE.UNAVAILABLE) {
        return null;
    }
    if (result.state === UPDATE_STATE.UPDATE_AVAILABLE) {
        return `⬆️  Aigon ${result.latestStable || result.latestNext} is available (current: ${result.current}). Run: ${result.upgradeCommand}`;
    }
    if (result.state === UPDATE_STATE.PRERELEASE_AVAILABLE) {
        return `🔔 Aigon prerelease ${result.latestNext} is available (current: ${result.current}). Run: ${result.upgradeCommand}`;
    }
    return null;
}

module.exports = {
    UPDATE_STATE,
    checkForUpdate,
    getCachedUpdateCheck,
    formatUpdateNotice,
};
