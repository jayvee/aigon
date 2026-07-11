#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  test, withTempDir, report, seedEntityDirs, initGitRepo, runAigonCli, GIT_SAFE_ENV,
} = require('../_helpers');

function freshLayout() {
  delete require.cache[require.resolve('../../lib/spec-layout')];
  return require('../../lib/spec-layout');
}

function git(repo, args) {
  return execFileSync('git', args, { cwd: repo, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'pipe' }).toString();
}

function writeSpec(repo, kind, stage, file, body) {
  const dir = path.join(repo, 'docs', 'specs', kind, stage);
  fs.mkdirSync(dir, { recursive: true });
  const full = path.join(dir, file);
  fs.writeFileSync(full, body || `---\naigon_id: X\n---\n\n# ${file}\n\nreal content\n`);
  return full;
}

function commitAll(repo, message) {
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', message]);
}

function setStorageBackend(repo, backend) {
  const p = path.join(repo, '.aigon', 'config.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const cfg = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
  cfg.storage = { backend };
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
}

function makeAllocator(start) {
  let n = start;
  return () => {
    const number = n++;
    return { number, paddedId: String(number).padStart(2, '0'), key: `F${number}` };
  };
}

// --- Feature + research migration moves content to 00-specs, keeps IDs, commits ---
test('migrate moves feature + research specs to 00-specs, preserves IDs and history, commits', () => withTempDir('aigon-f668-basic-', (repo) => {
  initGitRepo(repo);
  seedEntityDirs(repo, 'features');
  seedEntityDirs(repo, 'research-topics');
  writeSpec(repo, 'features', '02-backlog', 'feature-42-alpha.md');
  writeSpec(repo, 'research-topics', '01-inbox', 'research-7-beta.md');
  commitAll(repo, 'seed specs');

  const layout = freshLayout();
  const plan = layout.buildMigrationPlan(repo, { acknowledgeActive: true });
  assert.strictEqual(plan.blockers.length, 0, `unexpected blockers: ${plan.blockers}`);
  assert.strictEqual(plan.moves.length, 2);

  const result = layout.applyMigrationPlan(repo, plan, { commit: true });
  assert.strictEqual(result.applied.length, 2);
  assert.ok(result.committed);

  assert.ok(fs.existsSync(path.join(repo, 'docs/specs/features/00-specs/feature-42-alpha.md')));
  assert.ok(fs.existsSync(path.join(repo, 'docs/specs/research-topics/00-specs/research-7-beta.md')));
  assert.ok(!fs.existsSync(path.join(repo, 'docs/specs/features/02-backlog/feature-42-alpha.md')));

  // numbered specs retain IDs
  assert.strictEqual(layout.findCanonicalSpecFile(repo, 'feature', 42),
    path.join(repo, 'docs/specs/features/00-specs/feature-42-alpha.md'));

  // layout version recorded + committed
  assert.strictEqual(layout.getLayoutVersion(repo), 'stable');
  const status = git(repo, ['status', '--porcelain']);
  assert.strictEqual(status.trim(), '', `worktree not clean after commit: ${status}`);

  // git rename history preserved (git sees it as a rename)
  const show = git(repo, ['log', '--follow', '--name-status', '--format=%H', '--', 'docs/specs/features/00-specs/feature-42-alpha.md']);
  assert.ok(/R\d*\s+docs\/specs\/features\/02-backlog\/feature-42-alpha\.md/.test(show), `expected rename in log:\n${show}`);
}));

// --- Idempotency: rerun after success is a no-op ---
test('rerunning migrate after success is a no-op', () => withTempDir('aigon-f668-idem-', (repo) => {
  initGitRepo(repo);
  seedEntityDirs(repo, 'features');
  writeSpec(repo, 'features', '02-backlog', 'feature-42-alpha.md');
  commitAll(repo, 'seed');
  const layout = freshLayout();
  layout.applyMigrationPlan(repo, layout.buildMigrationPlan(repo, { acknowledgeActive: true }), { commit: true });

  const plan2 = layout.buildMigrationPlan(repo, { acknowledgeActive: true });
  assert.strictEqual(plan2.moves.length, 0, 'second plan should be empty');
  const result2 = layout.applyMigrationPlan(repo, plan2, { commit: true });
  assert.strictEqual(result2.applied.length, 0);
  assert.strictEqual(result2.committed, false);
}));

// --- Partial migration recovery: interrupted run resumes ---
test('interrupted migration is resumed (source + dest both present)', () => withTempDir('aigon-f668-resume-', (repo) => {
  initGitRepo(repo);
  seedEntityDirs(repo, 'features');
  writeSpec(repo, 'features', '02-backlog', 'feature-42-alpha.md');
  // Simulate a crash mid-move: canonical copy exists AND stage copy still there.
  const canonicalDir = path.join(repo, 'docs/specs/features/00-specs');
  fs.mkdirSync(canonicalDir, { recursive: true });
  fs.copyFileSync(
    path.join(repo, 'docs/specs/features/02-backlog/feature-42-alpha.md'),
    path.join(canonicalDir, 'feature-42-alpha.md'),
  );
  commitAll(repo, 'seed with partial state');

  const layout = freshLayout();
  const plan = layout.buildMigrationPlan(repo, { acknowledgeActive: true });
  const result = layout.applyMigrationPlan(repo, plan, { commit: false });
  assert.strictEqual(result.applied.length, 1);
  // stale stage source removed; canonical remains
  assert.ok(!fs.existsSync(path.join(repo, 'docs/specs/features/02-backlog/feature-42-alpha.md')));
  assert.ok(fs.existsSync(path.join(canonicalDir, 'feature-42-alpha.md')));
}));

// --- Dirty relevant files block migration ---
test('uncommitted spec changes block migration', () => withTempDir('aigon-f668-dirty-', (repo) => {
  initGitRepo(repo);
  seedEntityDirs(repo, 'features');
  writeSpec(repo, 'features', '02-backlog', 'feature-42-alpha.md');
  commitAll(repo, 'seed');
  // make it dirty
  fs.appendFileSync(path.join(repo, 'docs/specs/features/02-backlog/feature-42-alpha.md'), '\nedit\n');

  const layout = freshLayout();
  const plan = layout.buildMigrationPlan(repo, { acknowledgeActive: true });
  assert.ok(plan.blockers.some(b => /uncommitted changes/.test(b)), `expected dirty blocker: ${plan.blockers}`);
}));

// --- Duplicate IDs block migration ---
test('duplicate numeric ids across stages block migration', () => withTempDir('aigon-f668-dup-', (repo) => {
  initGitRepo(repo);
  seedEntityDirs(repo, 'features');
  writeSpec(repo, 'features', '02-backlog', 'feature-42-alpha.md');
  writeSpec(repo, 'features', '05-done', 'feature-42-alpha-again.md');
  commitAll(repo, 'seed');

  const layout = freshLayout();
  const plan = layout.buildMigrationPlan(repo, { acknowledgeActive: true });
  assert.ok(plan.blockers.some(b => /duplicate feature #42/.test(b)), `expected duplicate blocker: ${plan.blockers}`);
}));

// --- Destination collision blocks migration ---
test('pre-existing differing canonical file is a destination collision', () => withTempDir('aigon-f668-coll-', (repo) => {
  initGitRepo(repo);
  seedEntityDirs(repo, 'features');
  writeSpec(repo, 'features', '02-backlog', 'feature-42-alpha.md', '---\n---\nversion A\n');
  writeSpec(repo, 'features', '00-specs', 'feature-42-alpha.md', '---\n---\nversion B DIFFERENT\n');
  commitAll(repo, 'seed');

  const layout = freshLayout();
  const plan = layout.buildMigrationPlan(repo, { acknowledgeActive: true });
  assert.ok(plan.blockers.some(b => /already exists with different content/.test(b)), `expected collision: ${plan.blockers}`);
}));

// --- Unnumbered inbox specs get IDs via allocator; numbered ones keep theirs ---
test('unnumbered inbox spec receives an allocated ID', () => withTempDir('aigon-f668-alloc-', (repo) => {
  initGitRepo(repo);
  seedEntityDirs(repo, 'features');
  writeSpec(repo, 'features', '01-inbox', 'feature-legacy-slug.md');
  writeSpec(repo, 'features', '02-backlog', 'feature-42-alpha.md');
  commitAll(repo, 'seed');

  const layout = freshLayout();
  // without allocator: unnumbered surfaces in needsId, not a move
  const dryPlan = layout.buildMigrationPlan(repo, { acknowledgeActive: true });
  assert.strictEqual(dryPlan.needsId.length, 1);
  assert.ok(dryPlan.needsId[0].includes('feature-legacy-slug.md'));

  const plan = layout.buildMigrationPlan(repo, { acknowledgeActive: true, allocateId: makeAllocator(100) });
  const allocated = plan.moves.find(m => m.allocated);
  assert.ok(allocated, 'expected an allocated move');
  assert.strictEqual(allocated.number, 100);
  assert.strictEqual(allocated.toRel, 'docs/specs/features/00-specs/feature-100-legacy-slug.md');
  // numbered spec keeps its id
  assert.ok(plan.moves.some(m => m.number === 42 && !m.allocated));
}));

// --- Active worktree/branch requires acknowledgement ---
test('active in-progress entity blocks migration until acknowledged', () => withTempDir('aigon-f668-active-', (repo) => {
  initGitRepo(repo);
  seedEntityDirs(repo, 'features');
  writeSpec(repo, 'features', '03-in-progress', 'feature-42-alpha.md');
  commitAll(repo, 'seed');

  const layout = freshLayout();
  const blocked = layout.buildMigrationPlan(repo, {});
  assert.ok(blocked.blockers.some(b => /active entity/.test(b)), `expected active blocker: ${blocked.blockers}`);
  assert.ok(blocked.warnings.some(w => /still references/.test(w)));

  const acked = layout.buildMigrationPlan(repo, { acknowledgeActive: true });
  assert.strictEqual(acked.blockers.length, 0);
  assert.strictEqual(acked.moves.length, 1);
}));

// --- Symlinks are never canonical content ---
test('symlinks in 00-specs are excluded from canonical discovery', () => withTempDir('aigon-f668-symlink-', (repo) => {
  initGitRepo(repo);
  seedEntityDirs(repo, 'features');
  const canonicalDir = path.join(repo, 'docs/specs/features/00-specs');
  fs.mkdirSync(canonicalDir, { recursive: true });
  const real = writeSpec(repo, 'features', '02-backlog', 'feature-42-alpha.md');
  fs.symlinkSync(real, path.join(canonicalDir, 'feature-99-symlinked.md'));

  const layout = freshLayout();
  assert.strictEqual(layout.findCanonicalSpecFile(repo, 'feature', 99), null, 'symlink must not resolve as canonical');
  assert.strictEqual(layout.listCanonicalSpecs(repo, 'feature').length, 0);
}));

// --- Storage backend does not alter the layout plan ---
test('git-branch storage backend does not change the migration plan', () => withTempDir('aigon-f668-backend-', (repo) => {
  initGitRepo(repo);
  seedEntityDirs(repo, 'features');
  writeSpec(repo, 'features', '02-backlog', 'feature-42-alpha.md');
  setStorageBackend(repo, 'git-branch');
  commitAll(repo, 'seed');

  const layout = freshLayout();
  const plan = layout.buildMigrationPlan(repo, { acknowledgeActive: true });
  assert.strictEqual(plan.moves.length, 1);
  assert.strictEqual(plan.moves[0].toRel, 'docs/specs/features/00-specs/feature-42-alpha.md');
  // layout stays legacy until an explicit migrate; backend selection alone changes nothing
  assert.strictEqual(layout.getLayoutVersion(repo), 'legacy');
}));

// --- Resolver prefers canonical over a legacy stage copy ---
test('resolver returns the canonical 00-specs file when present', () => withTempDir('aigon-f668-resolve-', (repo) => {
  initGitRepo(repo);
  seedEntityDirs(repo, 'features');
  writeSpec(repo, 'features', '00-specs', 'feature-42-alpha.md');
  delete require.cache[require.resolve('../../lib/feature-spec-resolver')];
  const resolver = require('../../lib/feature-spec-resolver');
  const resolved = resolver.resolveFeatureSpec(repo, 42);
  assert.strictEqual(resolved.source, 'canonical');
  assert.strictEqual(resolved.path, path.join(repo, 'docs/specs/features/00-specs/feature-42-alpha.md'));
}));

// --- CLI status smoke ---
test('spec-layout status runs and reports legacy on a fresh repo', () => withTempDir('aigon-f668-cli-', (repo) => {
  initGitRepo(repo);
  seedEntityDirs(repo, 'features');
  writeSpec(repo, 'features', '02-backlog', 'feature-42-alpha.md');
  commitAll(repo, 'seed');
  const { output } = runAigonCli(repo, ['spec-layout', 'status'], { extraEnv: { AIGON_SKIP_FIRST_RUN: '1' } });
  assert.ok(/Spec layout:/.test(output), output);
  assert.ok(/canonical \(00-specs\): 0/.test(output), output);
}));

report();
