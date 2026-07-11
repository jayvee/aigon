'use strict';

/**
 * `aigon spec-view` — inspect and rebuild the generated lifecycle symlink view
 * (F669). Subcommands:
 *
 *   aigon spec-view status    (dry run — report desired vs current, no writes)
 *   aigon spec-view refresh   (reconcile; non-zero exit on unsafe collisions)
 *
 * The view is disposable: it only exists under `specLayout: stable`, and
 * rebuilding it from scratch always reproduces the same links.
 */

const specView = require('../spec-view');
const { parseCliOptions } = require('../cli-parse');

function printResult(result, { refreshed }) {
  if (result.skipped) {
    console.log(`ℹ️  Spec-view skipped (${result.reason}). Nothing to project until layout is stable.`);
    return;
  }
  const verb = refreshed ? '' : ' (dry run — no changes written)';
  console.log(`Spec-view: ${result.desiredCount} desired link(s)${verb}`);
  const line = (label, arr) => {
    if (arr.length > 0) console.log(`  ${label} (${arr.length}):`);
    for (const p of arr) console.log(`    ${p}`);
  };
  line('created', result.created);
  line('replaced', result.replaced);
  line('removed', result.removed);
  if (!refreshed) line('unchanged', result.kept);
  if (result.blocked.length > 0) {
    console.log(`  ⚠️  blocked (${result.blocked.length}) — left untouched:`);
    for (const b of result.blocked) console.log(`    ❌ [${b.code}] ${b.message}`);
  }
}

module.exports = function specViewCommands(_ctx) {
  return {
    'spec-view': async (args) => {
      const options = parseCliOptions(args);
      const sub = options._[0] || 'status';
      const repoPath = process.cwd();

      if (sub === 'status') {
        const result = specView.refreshView(repoPath, { dryRun: true });
        printResult(result, { refreshed: false });
        return;
      }
      if (sub === 'refresh') {
        const result = specView.refreshView(repoPath, { dryRun: false });
        printResult(result, { refreshed: true });
        if (!result.skipped && result.blocked.length > 0) {
          console.error(
            `\n❌ ${result.blocked.length} unsafe collision(s) blocked. Resolve them and re-run: aigon spec-view refresh`,
          );
          process.exitCode = 1;
          return;
        }
        console.log('\n✅ Lifecycle view refreshed.');
        return;
      }
      console.error(`❌ Unknown spec-view subcommand: ${sub}`);
      console.error('   Usage: aigon spec-view status | aigon spec-view refresh');
      process.exitCode = 1;
    },
  };
};
