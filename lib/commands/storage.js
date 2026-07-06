'use strict';

const path = require('path');
const { createSpecStore, resolveStorageConfig } = require('../spec-store');
const { runStorageDoctor } = require('../spec-store/doctor');
const { runStorageReport } = require('../spec-store/report');
const { runStorageConvert } = require('../spec-store/convert');
const { parseCliOptions, getOptionValue } = require('../cli-parse');

function printConvertDryRun(result) {
  console.log('Dry run — no changes written');
  console.log('Planned storage config:');
  console.log(JSON.stringify(result.planned, null, 2));
  console.log(`Remote:    ${result.remote}${result.remoteUrl ? ` (${result.remoteUrl})` : ''}`);
  console.log(`Ref prefix: ${result.refPrefix}`);
  console.log(`Local projections to import (${result.importKeys.length}):`);
  for (const entry of result.importKeys) {
    console.log(`  ${entry.key} (${entry.entityType} ${entry.entityId})`);
  }
  if (result.remoteWarning) {
    console.log(`⚠️  ${result.remoteWarning}`);
  }
}

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
        if (storage.backend !== 'git-ref' && storage.backend !== 'git-branch') {
          console.error('❌ storage sync requires storage.backend: git-ref or git-branch in .aigon/config.json');
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
        console.log(`✓ Synced ${result.backend} specstore (${result.mergedKeys || 0} keys)`);
        return;
      }

      if (sub === 'status') {
        const store = createSpecStore({ repoPath, storage });
        const status = await store.health();
        console.log(`Backend:   ${status.backend}`);
        if (status.backend === 'git-ref' || status.backend === 'git-branch') {
          console.log(`Remote:    ${status.remote}`);
          if (status.backend === 'git-ref') {
            console.log(`Ref prefix: ${status.refPrefix}`);
          } else {
            console.log(`Branch:    ${status.branch}`);
          }
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

      if (sub === 'convert') {
        const backend = getOptionValue(options, 'backend') || 'git-ref';
        const remote = getOptionValue(options, 'remote') || 'origin';
        const refPrefix = getOptionValue(options, 'ref-prefix');
        const dryRun = getOptionValue(options, 'dry-run') !== undefined;
        const result = await runStorageConvert(repoPath, {
          backend,
          remote,
          refPrefix,
          dryRun,
        });
        if (!result.ok) {
          console.error(`❌ ${result.error || 'storage convert failed'}`);
          process.exitCode = 1;
          return;
        }
        if (result.dryRun) {
          printConvertDryRun(result);
          return;
        }
        if (result.alreadyConfigured) {
          console.log(`ℹ️  Repo already configured for git-ref storage (remote=${result.remote}, refPrefix=${result.refPrefix})`);
          if (result.mergedKeys > 0) {
            console.log(`✓ Synced git-ref specstore (${result.mergedKeys} keys)`);
          }
          console.log(`ℹ️  ${result.rollbackHint}`);
          return;
        }
        console.log(`✓ Converted to git-ref storage (remote=${result.remote}, refPrefix=${result.refPrefix})`);
        console.log(`✓ Imported ${result.importCount} local projection key(s); synced ${result.mergedKeys} ref key(s)`);
        console.log(`ℹ️  ${result.rollbackHint}`);
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
            .map(([role, lease]) => {
              const user = lease.user ? `${lease.user}@` : '';
              return `${role}:${user}${lease.holderId}`;
            })
            .join(', ');
          console.log(`  ${spec.key.padEnd(8)} ${path.basename(spec.repo).padEnd(20)} events=${spec.eventCount ?? '-'} ${leaseSummary ? `leases=${leaseSummary}` : ''}`);
        }
        return;
      }

      console.error('Usage: aigon storage <sync|status|doctor|report|convert> [--fix] [--json] [--backend=git-ref] [--remote=origin] [--ref-prefix=refs/aigon/specs] [--dry-run]');
      process.exitCode = 1;
    },
  };
};

module.exports.createStorageCommands = function createStorageCommands(overrides = {}) {
  return module.exports({ ...overrides }).storage;
};
