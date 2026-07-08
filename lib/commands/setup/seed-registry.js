'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const SEED_REGISTRY = {
    brewboard: 'https://github.com/jayvee/brewboard-seed.git',
    trailhead: 'https://github.com/jayvee/trailhead-seed.git',
};

function loadSeedWorkingRepos() {
    try {
        const configPath = path.join(
            process.env.HOME || os.homedir(),
            '.aigon',
            'config.json'
        );
        if (!fs.existsSync(configPath)) return {};
        const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const repos = raw && raw.seedWorkingRepos;
        if (!repos || typeof repos !== 'object') return {};
        const out = {};
        for (const [name, url] of Object.entries(repos)) {
            if (typeof url === 'string' && url.trim()) out[name] = url.trim();
        }
        return out;
    } catch (_) {
        return {};
    }
}

const WORKING_REPO_REGISTRY = loadSeedWorkingRepos();

module.exports = {
    SEED_REGISTRY,
    WORKING_REPO_REGISTRY,
    loadSeedWorkingRepos,
};
