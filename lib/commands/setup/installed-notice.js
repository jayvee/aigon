'use strict';

const fs = require('fs');
const path = require('path');
const { getAigonVersion } = require('../../version');
const { readConductorReposFromGlobalConfig } = require('../../config');
const { getInstalledVersionAt } = require('./gitignore-and-hooks');

module.exports = function installedNoticeCommand() {
    return (args = []) => {
        void args;
        try {
            const currentVersion = getAigonVersion();
            if (!currentVersion) return;

            const allRepos = readConductorReposFromGlobalConfig()
                .map(r => path.resolve(r))
                .filter(r => fs.existsSync(path.join(r, '.aigon')))
                .filter(r => !fs.existsSync(path.join(r, '.aigon', 'worktree.json')));

            if (allRepos.length === 0) return;

            const stale = allRepos
                .map(r => ({ repo: r, applied: getInstalledVersionAt(r) }))
                .filter(({ applied }) => applied && applied !== currentVersion);

            if (stale.length === 0) return;

            console.log(`\n✓ aigon upgraded to v${currentVersion}`);
            console.log(`  ${stale.length} of your ${allRepos.length} known repo${allRepos.length === 1 ? '' : 's'} ${stale.length === 1 ? 'was' : 'were'} applied with an older aigon:`);
            stale.slice(0, 10).forEach(({ repo, applied }) => {
                console.log(`    ${repo}  (applied v${applied})`);
            });
            if (stale.length > 10) {
                console.log(`    … and ${stale.length - 10} more`);
            }
            console.log(`  Re-apply all:  aigon apply --all`);
        } catch (_) { /* never fail an npm install */ }
    };
};
