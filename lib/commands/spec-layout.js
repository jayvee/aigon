'use strict';

/**
 * `aigon spec-layout` — inspect and migrate the durable spec storage layout
 * (F668). Two subcommands:
 *
 *   aigon spec-layout status
 *   aigon spec-layout migrate --stable [--dry-run] [--yes]
 *
 * Migration is ONLY reachable here. It never runs from `aigon apply`, dashboard
 * startup, storage polling, or any read path.
 */

const specLayout = require('../spec-layout');
const { parseCliOptions } = require('../cli-parse');

/**
 * Allocate a numeric identity for an unnumbered legacy inbox spec through the
 * create-time reservation contract (feature 667), so migrated specs get IDs the
 * same way `feature-create` does.
 */
function makeAllocator(repoPath) {
  const { createSpecStore } = require('../spec-store');
  const store = createSpecStore({ repoPath });
  return (entityType) => {
    const kind = entityType === 'research' ? 'research' : 'feature';
    const reserved = store.reserveIdentitySync(kind);
    // Mark materialized immediately — the spec file is about to be written.
    try { store.markIdentityMaterializedSync(kind, reserved.number); } catch (_) { /* surfaces in doctor */ }
    return reserved;
  };
}

function printStatus(status) {
  const canonicalCount = status.canonical.feature.length + status.canonical.research.length;
  const legacyCount = status.legacy.feature.length + status.legacy.research.length;
  console.log(`Spec layout: ${status.state}`);
  console.log(`  version (config.specLayout): ${status.version}`);
  console.log(`  canonical (00-specs): ${canonicalCount} spec(s)`);
  console.log(`  legacy (stage folders): ${legacyCount} spec(s)`);
  if (status.warnings.length > 0) {
    console.log(`  warnings:`);
    for (const w of status.warnings) console.log(`    ⚠️  ${w}`);
  }
  if (status.blockers.length > 0) {
    console.log(`  blockers (${status.blockers.length}):`);
    for (const b of status.blockers) console.log(`    ❌ ${b}`);
  }
  switch (status.state) {
    case 'stable':
      console.log('\n✅ Layout is stable — every spec lives under 00-specs.');
      break;
    case 'legacy':
      console.log('\nℹ️  Legacy layout. Run: aigon spec-layout migrate --stable --dry-run');
      break;
    case 'mixed':
      console.log('\nℹ️  Mixed layout. Run: aigon spec-layout migrate --stable --dry-run');
      break;
    case 'migration-blocked':
      console.log('\n⚠️  Migration is blocked — resolve the blockers above first.');
      break;
    default:
      break;
  }
}

function printPlan(plan, { dryRun }) {
  console.log(`${dryRun ? 'Dry run — no changes written' : 'Migration plan'}`);
  console.log(`Moves (${plan.moves.length}):`);
  for (const m of plan.moves) {
    const tag = m.allocated ? ' [ID allocated]' : '';
    console.log(`  ${m.fromRel}  ->  ${m.toRel}${tag}`);
  }
  if (plan.needsId && plan.needsId.length > 0) {
    console.log(`Unnumbered specs to receive IDs (${plan.needsId.length}):`);
    for (const rel of plan.needsId) console.log(`  ${rel}`);
  }
  if (plan.warnings.length > 0) {
    console.log(`Warnings (${plan.warnings.length}):`);
    for (const w of plan.warnings) console.log(`  ⚠️  ${w}`);
  }
  if (plan.blockers.length > 0) {
    console.log(`Blockers (${plan.blockers.length}):`);
    for (const b of plan.blockers) console.log(`  ❌ ${b}`);
  }
}

function migrate(repoPath, options) {
  const dryRun = options.has('dry-run') || options.has('dryRun');
  const acknowledgeActive = options.has('yes');

  if (!options.has('stable')) {
    console.error('❌ spec-layout migrate requires --stable (the only supported target layout).');
    process.exitCode = 1;
    return;
  }

  // Plan phase (pure). Dry-run must never allocate real IDs — it reports the
  // count of specs that will receive IDs instead of inventing placeholder
  // numbers. The real migrate run supplies a reservation-backed allocator.
  const buildOpts = { acknowledgeActive };
  if (!dryRun) buildOpts.allocateId = makeAllocator(repoPath);

  const plan = specLayout.buildMigrationPlan(repoPath, buildOpts);

  printPlan(plan, { dryRun });

  if (dryRun) return;

  if (plan.blockers.length > 0) {
    console.error(`\n❌ Migration blocked (${plan.blockers.length} blocker(s)). Nothing was moved.`);
    process.exitCode = 1;
    return;
  }

  if (plan.moves.length === 0) {
    // Idempotent: nothing to move — still ensure the version is recorded.
    specLayout.setLayoutVersion(repoPath, specLayout.LAYOUT_STABLE);
    console.log('\n✅ Already stable — no specs to migrate. Layout version confirmed.');
    return;
  }

  const result = specLayout.applyMigrationPlan(repoPath, plan, { commit: true });
  console.log(`\n✅ Migrated ${result.applied.length} spec(s) to 00-specs (${result.skipped.length} already migrated).`);
  console.log(`   Layout version set to stable in ${result.configPath}.`);
  console.log(result.committed ? '   Committed migration on the current branch.' : '   Nothing new to commit.');
}

module.exports = function specLayoutCommands(_ctx) {
  return {
    'spec-layout': async (args) => {
      const options = parseCliOptions(args);
      const sub = options._[0];
      const repoPath = process.cwd();

      // parseCliOptions exposes flags on the returned object; build a `has`
      // helper that works regardless of exact shape.
      const flagSet = new Set(
        (args || []).filter(a => typeof a === 'string' && a.startsWith('--')).map(a => a.slice(2)),
      );
      const flags = { has: (name) => flagSet.has(name) };

      if (!sub || sub === 'status') {
        printStatus(specLayout.detectStatus(repoPath));
        return;
      }
      if (sub === 'migrate') {
        migrate(repoPath, flags);
        return;
      }
      console.error(`❌ Unknown spec-layout subcommand: ${sub}`);
      console.error('   Usage: aigon spec-layout status | aigon spec-layout migrate --stable [--dry-run] [--yes]');
      process.exitCode = 1;
    },
  };
};
