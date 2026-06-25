'use strict';

const { createSpecStore, resolveStorageConfig } = require('../spec-store');

/**
 * @param {object} _ctx
 */
module.exports = function storageCommands(_ctx) {
  return {
    storage: async (args) => {
      const sub = args[0];
      const repoPath = process.cwd();
      const storage = resolveStorageConfig(repoPath);

      if (sub === 'sync') {
        if (storage.backend !== 'git-ref') {
          console.error('❌ storage sync requires storage.backend: git-ref in .aigon/config.json');
          process.exitCode = 1;
          return;
        }
        const store = createSpecStore({ repoPath, storage });
        const result = await store.sync();
        if (!result.ok) {
          console.error(`❌ ${result.error || 'storage sync failed'}`);
          process.exitCode = 1;
          return;
        }
        console.log(`✓ Synced git-ref specstore (${result.mergedKeys || 0} keys)`);
        return;
      }

      if (sub === 'status') {
        const store = createSpecStore({ repoPath, storage });
        const status = await store.health();
        console.log(`Backend:   ${status.backend}`);
        if (status.backend === 'git-ref') {
          console.log(`Remote:    ${status.remote}`);
          console.log(`Ref prefix: ${status.refPrefix}`);
          console.log(`Last sync: ${status.lastSyncAt || '(never)'}`);
          console.log(`Ahead:     ${status.ahead}`);
          console.log(`Behind:    ${status.behind}`);
          console.log(`Health:    ${status.health}`);
          if (status.lastError) console.log(`Last error: ${status.lastError}`);
        } else {
          console.log('Health:    ok (local backend)');
        }
        if (!status.ok) process.exitCode = 1;
        return;
      }

      console.error('Usage: aigon storage <sync|status>');
      process.exitCode = 1;
    },
  };
};

module.exports.createStorageCommands = function createStorageCommands(overrides = {}) {
  return module.exports({ ...overrides }).storage;
};
