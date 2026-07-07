#!/usr/bin/env node
'use strict';

// REGRESSION: feature-close auto-stashes dirty working-tree changes before the
// merge, then `git stash pop`s them after. When the pop conflicts (the merge
// touched the same lines), the OLD behaviour left `<<<<<<<` markers in source
// files — which break the aigon CLI on next load — while feature-close still
// reported success. This bit us closing F638 (markers left in lib/quota-probe.js).
// restoreAutoStash must now RECOVER the tree to the clean merged state and keep
// the WIP safe in the stash instead of leaving markers.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');
const { test, withTempDir, GIT_SAFE_ENV, withRepoCwd, report } = require('../_helpers');
const { restoreAutoStash } = require('../../lib/feature-close');

function git(root, cmd) {
    return execSync(cmd, { cwd: root, env: { ...process.env, ...GIT_SAFE_ENV }, encoding: 'utf8', stdio: 'pipe' });
}

// Build a repo whose auto-stash pop will conflict, mirroring the F638 incident:
// dirty WIP on a line, stashed; then a "merge" commit rewrites the same line.
function seedConflictingStash(root) {
    const env = { ...process.env, ...GIT_SAFE_ENV };
    const g = (args) => execFileSync('git', args, { cwd: root, env, stdio: 'pipe' });
    g(['init']);
    g(['config', 'user.email', 't@a.test']);
    g(['config', 'user.name', 'T']);
    const file = path.join(root, 'lib', 'x.js');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "const VERDICTS = ['a'];\nmodule.exports = { VERDICTS };\n");
    g(['add', '.']);
    g(['commit', '-m', 'base']);
    // Dirty WIP on line 1 (unrelated in-progress work), then auto-stash it.
    fs.writeFileSync(file, "const VERDICTS = ['a', 'wip'];\nmodule.exports = { VERDICTS };\n");
    git(root, 'git stash push -m "aigon-feature-close-auto-stash"');
    // "Merge" rewrites the same line differently → pop will conflict.
    fs.writeFileSync(file, "const VERDICTS = ['a', 'merged'];\nmodule.exports = { VERDICTS };\n");
    g(['commit', '-am', 'Merge feature']);
    return file;
}

test('restoreAutoStash recovers a conflicting pop to the clean merged state (no markers)', () => withTempDir('aigon-autostash-recover-', (root) => {
    const file = seedConflictingStash(root);
    const result = withRepoCwd(root, () => restoreAutoStash('merge'));

    // 1. It reports the conflict (ok:false) but recovered:true.
    assert.strictEqual(result.ok, false, 'a conflict must report ok:false');
    assert.strictEqual(result.recovered, true, 'tree must be recovered');
    assert.ok(result.conflicted.some(f => f.endsWith('lib/x.js')), 'conflicted file reported');

    // 2. No conflict markers survive — this is the whole point (CLI stays loadable).
    const content = fs.readFileSync(file, 'utf8');
    assert.ok(!content.includes('<<<<<<<'), 'no <<<<<<< markers left in the tree');
    assert.ok(content.includes("'merged'"), 'file restored to the merged (HEAD) version');
    assert.ok(!content.includes("'wip'"), 'the un-applied stashed WIP is not in the working tree');

    // 3. No unmerged index entries remain.
    const unmerged = git(root, 'git diff --name-only --diff-filter=U').trim();
    assert.strictEqual(unmerged, '', 'no unmerged paths remain in the index');

    // 4. The WIP is SAFE — the stash is still on the stack, recoverable.
    const stashList = git(root, 'git stash list').trim();
    assert.ok(/aigon-feature-close-auto-stash/.test(stashList), 'stash preserved for manual recovery');
    const stashDiff = git(root, "git stash show -p 'stash@{0}'");
    assert.ok(stashDiff.includes("'wip'"), 'stashed WIP still contains the operator changes');
}));

test('restoreAutoStash is a no-op success when the pop applies cleanly', () => withTempDir('aigon-autostash-clean-', (root) => {
    const env = { ...process.env, ...GIT_SAFE_ENV };
    const g = (args) => execFileSync('git', args, { cwd: root, env, stdio: 'pipe' });
    g(['init']); g(['config', 'user.email', 't@a.test']); g(['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(root, 'a.txt'), 'base\n');
    g(['add', '.']); g(['commit', '-m', 'base']);
    fs.writeFileSync(path.join(root, 'b.txt'), 'new\n');   // dirty on a DIFFERENT file
    git(root, 'git stash push -m "aigon-feature-close-auto-stash"');
    fs.writeFileSync(path.join(root, 'a.txt'), 'base\nmerged\n');
    g(['commit', '-am', 'Merge']);

    const result = withRepoCwd(root, () => restoreAutoStash('merge'));
    assert.strictEqual(result.ok, true, 'clean pop reports success');
    assert.ok(fs.existsSync(path.join(root, 'b.txt')), 'non-conflicting WIP applied');
    assert.strictEqual(git(root, 'git stash list').trim(), '', 'stash dropped after a clean pop');
}));

report();
