#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { withTempDirAsync } = require('../_helpers');
const {
  toPortableSpecPath,
  resolvePortableSpecPath,
} = require('../../lib/workflow-core/portable-spec-paths');
const { runFeatureEffect } = require('../../lib/workflow-core/effects');

async function runCase(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.error(`  ✗ ${name}\n    ${error.stack || error.message}`);
    return false;
  }
}

async function main() {
  let failed = 0;

  if (!await runCase('toPortableSpecPath stores repo-relative docs/specs paths', async () => {
    await withTempDirAsync('portable-spec-', async (repo) => {
      const abs = path.join(repo, 'docs/specs/features/03-in-progress/feature-02-demo.md');
      assert.strictEqual(
        toPortableSpecPath(repo, abs),
        'docs/specs/features/03-in-progress/feature-02-demo.md',
      );
    });
  })) failed += 1;

  if (!await runCase('resolvePortableSpecPath rebuilds foreign absolute paths from docs/specs suffix', async () => {
    await withTempDirAsync('portable-foreign-', async (repo) => {
      const local = path.join(repo, 'docs/specs/features/05-done/feature-02-demo.md');
      fs.mkdirSync(path.dirname(local), { recursive: true });
      fs.writeFileSync(local, '# demo\n');
      const foreign = '/home/tester/src/other-repo/docs/specs/features/05-done/feature-02-demo.md';
      assert.strictEqual(resolvePortableSpecPath(repo, foreign), local);
    });
  })) failed += 1;

  if (!await runCase('runFeatureEffect move_spec follows foreign absolute fromPath on another clone layout', async () => {
    await withTempDirAsync('portable-move-', async (repo) => {
      const fromPath = path.join(repo, 'docs/specs/features/04-in-evaluation/feature-02-demo.md');
      const toPath = path.join(repo, 'docs/specs/features/05-done/feature-02-demo.md');
      fs.mkdirSync(path.dirname(fromPath), { recursive: true });
      fs.writeFileSync(fromPath, '# demo\n');

      const foreignFrom = '/var/lib/docker/rootfs/docs/specs/features/04-in-evaluation/feature-02-demo.md';
      await runFeatureEffect(repo, '02', {
        type: 'move_spec',
        payload: {
          entityType: 'feature',
          entityId: '02',
          fromPath: foreignFrom,
          toPath: 'docs/specs/features/05-done/feature-02-demo.md',
          toLifecycle: 'done',
        },
      });

      assert.ok(!fs.existsSync(fromPath), 'source spec should move');
      assert.ok(fs.existsSync(toPath), 'destination spec should exist');
    });
  })) failed += 1;

  if (failed > 0) process.exit(1);
  console.log('\nAll portable spec path tests passed.');
}

main();
