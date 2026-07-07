'use strict';

const fs = require('fs');
const path = require('path');

const PROVIDERS_DIR = path.join(__dirname, '..', 'templates', 'providers');

let _providers = null;

function _loadAll() {
    if (_providers) return _providers;
    _providers = {};
    if (!fs.existsSync(PROVIDERS_DIR)) return _providers;
    for (const file of fs.readdirSync(PROVIDERS_DIR)) {
        if (!file.endsWith('.json')) continue;
        const config = JSON.parse(fs.readFileSync(path.join(PROVIDERS_DIR, file), 'utf8'));
        if (config && config.id) _providers[config.id] = config;
    }
    return _providers;
}

function getProvider(id) {
    return _loadAll()[id] || null;
}

function getAllProviderIds() {
    return Object.keys(_loadAll());
}

function getAllProviders() {
    return Object.values(_loadAll());
}

module.exports = {
    getProvider,
    getAllProviderIds,
    getAllProviders,
    _resetCache: () => { _providers = null; },
};
