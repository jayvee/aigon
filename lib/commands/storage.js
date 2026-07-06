'use strict';

const path = require('path');
const { createSpecStore, resolveStorageConfig } = require('../spec-store');
const { runStorageDoctor } = require('../spec-store/doctor');
const { runStorageReport } = require('../spec-store/report');
const { runStorageConvert } = require('../spec-store/convert');
const { parseCliOptions, getOptionValue } = require('../cli-parse');

function printConvertDryRun(result) {
  console.log('Dry run — no changes written');
  console.log(`Source backend: ${result.sourceBackend}`);
  console.log('Planned storage config:');
  console.log(JSON.stringify(result.planned, null, 2));
  console.log(`Remote:  ${result.remote}${result.remoteUrl ? ` (${result.remoteUrl})` : ''}`);
  console.log(`Branch:  ${result.branch}`);
  console.log(`Specs (${result.importKeys.length}):`);
  for (const entry of result.importKeys) {
    const count = result.eventCounts && result.eventCounts[entry.key];
    const suffix = count != null ? ` — ${count} event(s)` : '';
    const entity = entry.entityType ? ` (${entry.entityType} ${entry.entityId})` : '';
    console.log(`  ${entry.key}${entity}${suffix}`);
  }
  if (result.refsToImport && result.refsToImport.length > 0) {
    console.log(`Legacy refs to import (${result.refsToImport.length}):`);
    for (const ref of result.refsToImport) console.log(`  ${ref}`);
  }
  if (result.refsToDelete && result.refsToDelete.length > 0) {
    console.log(`Legacy refs to delete after convert (${result.refsToDelete.length})`);
  } else if (result.keepRefs && result.refsToImport && result.refsToImport.length > 0) {
    console.log('Legacy refs will be kept (--keep-refs)');
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

      if (sub === 'sync') {
        let storage;
        try {
          storage = resolveStorageConfig(repoPath);
        } catch (error) {
          console.error(`❌ ${error.message}`);
          process.exitCode = 1;
          return;
        }
        if (storage.backend !== 'git-branch') {
          console.error('❌ storage sync requires storage.backend: git-branch in .aigon/config.json');
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
        let storage;
        try {
          storage = resolveStorageConfig(repoPath);
        } catch (error) {
          console.error(`❌ ${error.message}`);
          process.exitCode = 1;
          return;
        }
        const store = createSpecStore({ repoPath, storage });
        const status = await store.health();
        console.log(`Backend:   ${status.backend}`);
        if (status.backend === 'git-branch') {
          console.log(`Remote:    ${status.remote}`);
          console.log(`Branch:    ${status.branch}`);
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
        const backend = getOptionValue(options, 'backend') || 'git-branch';
        const remote = getOptionValue(options, 'remote') || 'origin';
        const branch = getOptionValue(options, 'branch');
        const keepRefs = getOptionValue(options, 'keep-refs') !== undefined;
        const dryRun = getOptionValue(options, 'dry-run') !== undefined;
        const result = await runStorageConvert(repoPath, {
          backend,
          remote,
          branch,
          keepRefs,
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
          console.log(`ℹ️  Repo already configured for git-branch storage (remote=${result.remote}, branch=${result.branch})`);
          if (result.mergedKeys > 0) {
            console.log(`✓ Synced git-branch specstore (${result.mergedKeys} keys)`);
          }
          console.log(`ℹ️  ${result.rollbackHint}`);
          return;
        }
        console.log(`✓ Converted from ${result.sourceBackend} to git-branch storage (remote=${result.remote}, branch=${result.branch})`);
        console.log(`✓ Imported ${result.importCount} spec key(s); synced ${result.mergedKeys} branch key(s)`);
        if (result.eventCounts) {
          for (const [key, count] of Object.entries(result.eventCounts)) {
            console.log(`  ${key}: ${count} source event(s) verified on branch`);
          }
        }
        if (result.refCleanup) {
          if (result.refCleanup.deletedLocal.length > 0) {
            console.log(`✓ Deleted ${result.refCleanup.deletedLocal.length} local legacy ref(s)`);
          }
          if (result.refCleanup.deletedRemote.length > 0) {
            console.log(`✓ Deleted ${result.refCleanup.deletedRemote.length} remote legacy ref(s)`);
          }
          if (result.refCleanup.cleanupCommand) {
            console.log(`ℹ️  To delete legacy refs later: ${result.refCleanup.cleanupCommand}`);
          }
        }
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

      console.error('Usage: aigon storage <sync|status|doctor|report|convert> [--fix] [--json] [--backend=git-branch] [--remote=origin] [--branch=aigon-state] [--keep-refs] [--dry-run]');
      process.exitCode = 1;
    },
  };
};

module.exports.createStorageCommands = function createStorageCommands(overrides = {}) {
  return module.exports({ ...overrides }).storage;
};
