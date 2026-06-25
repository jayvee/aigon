'use strict';

const path = require('path');
const { createSpecStore, resolveStorageConfig } = require('../spec-store');
const { runStorageDoctor } = require('../spec-store/doctor');
const { runStorageReport } = require('../spec-store/report');
const { parseCliOptions, getOptionValue } = require('../cli-parse');

/**
 * @param {object} _ctx
 */
module.exports = function storageCommands(_ctx) {
  return {
    storage: async (args) => {
      const options = parseCliOptions(args);
      const sub = options._[0];
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
        if (result.skipped) {
          console.log('ℹ️  Offline mode — sync skipped');
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
          console.log(`Offline:   ${storage.git.offline ? 'yes' : 'no'}`);
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

      if (sub === 'doctor') {
        const fix = getOptionValue(options, 'fix') !== undefined;
        const result = await runStorageDoctor(repoPath, { fix });
        console.log(`Backend: ${result.backend}`);
        if (result.fixes.length > 0) {
          console.log(`Fixes applied: ${result.fixes.length}`);
          for (const fixLine of result.fixes) console.log(`  ✓ ${fixLine}`);
        }
        if (result.issues.length === 0) {
          console.log('✓ No storage issues detected');
        } else {
          for (const issue of result.issues) {
            const icon = issue.severity === 'error' ? '❌' : '⚠️ ';
            console.log(`${icon} [${issue.code}] ${issue.message}`);
          }
        }
        if (!result.ok) process.exitCode = 1;
        return;
      }

      if (sub === 'report') {
        const asJson = getOptionValue(options, 'json') !== undefined;
        const report = await runStorageReport({ json: asJson });
        if (asJson) {
          console.log(JSON.stringify(report, null, 2));
          return;
        }
        console.log(`Cross-repo storage report (${report.specs.length} specs)`);
        for (const spec of report.specs) {
          const leaseSummary = Object.entries(spec.leases || {})
            .filter(([, lease]) => lease && !lease.expired)
            .map(([role, lease]) => `${role}:${lease.holderId}`)
            .join(', ');
          console.log(`  ${spec.key.padEnd(8)} ${path.basename(spec.repo).padEnd(20)} events=${spec.eventCount ?? '-'} ${leaseSummary ? `leases=${leaseSummary}` : ''}`);
        }
        return;
      }

      console.error('Usage: aigon storage <sync|status|doctor|report> [--fix] [--json]');
      process.exitCode = 1;
    },
  };
};

module.exports.createStorageCommands = function createStorageCommands(overrides = {}) {
  return module.exports({ ...overrides }).storage;
};
