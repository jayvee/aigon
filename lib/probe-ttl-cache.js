'use strict';

const cache = new Map();

function getOrCompute(key, ttlMs, computeFn) {
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now) return hit.value;

    const value = computeFn();
    cache.set(key, {
        value,
        expiresAt: now + Math.max(0, Number(ttlMs) || 0),
    });
    return value;
}

function clear(key) {
    if (typeof key === 'string' && key.length > 0) {
        cache.delete(key);
        return;
    }
    cache.clear();
}

module.exports = {
    getOrCompute,
    clear,
};
