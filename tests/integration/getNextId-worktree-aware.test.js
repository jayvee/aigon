// REGRESSION F366: getNextId must see IDs on main even from a diverged worktree branch.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { test, withTempDir, report, GIT_SAFE_ENV } = require('../_helpers');
const { getNextId } = require('../../lib/spec-crud');

const ALL_STAGES = ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused'];

function git(cwd, args) {
    execSync(`git ${args}`, { cwd, stdio: 'pipe', env: { ...process.env, ...GIT_SAFE_ENV } });
}

function seedFeatureFile(repo, stage, file) {
    fs.writeFileSync(path.join(repo, 'docs', 'specs', 'features', stage, file), `# ${file}\n`);
}

test('getNextId returns ID above main-branch max from a diverged branch', () => withTempDir('aigon-f366-', (repo) => {
    ALL_STAGES.forEach(s => fs.mkdirSync(path.join(repo, 'docs', 'specs', 'features', s), { recursive: true }));
    git(repo, 'init -b main');
    git(repo, 'config user.name "t"');
    git(repo, 'config user.email t@t');

    // Seed main with feature-01 and feature-02, then commit
    seedFeatureFile(repo, '02-backlog', 'feature-01-alpha.md');
    seedFeatureFile(repo, '02-backlog', 'feature-02-beta.md');
    git(repo, 'add .');
    git(repo, 'commit -qm "chore: seed"');

    // Branch off (simulating the worktree branch divergence point)
    git(repo, 'checkout -b feature-99-worktree');

    // On main: assign feature-03 after the branch diverged
    git(repo, 'checkout main');
    seedFeatureFile(repo, '02-backlog', 'feature-03-gamma.md');
    git(repo, 'add .');
    git(repo, 'commit -qm "chore: f03"');

    // Back on the worktree branch — filesystem only has feature-01 and feature-02
    git(repo, 'checkout feature-99-worktree');

    const typeConfig = { root: path.join(repo, 'docs', 'specs', 'features'), folders: ALL_STAGES, prefix: 'feature' };
    const id = getNextId(typeConfig);
    assert.strictEqual(id, 4, `Expected 4 (above main's max of 3) but got ${id}`);
}));

test('getNextId falls back to filesystem when no main/master branch exists', () => withTempDir('aigon-f366-nomatch-', (repo) => {
    ALL_STAGES.forEach(s => fs.mkdirSync(path.join(repo, 'docs', 'specs', 'features', s), { recursive: true }));
    git(repo, 'init -b orphan-branch');
    git(repo, 'config user.name "t"');
    git(repo, 'config user.email t@t');
    seedFeatureFile(repo, '02-backlog', 'feature-05-test.md');
    git(repo, 'add .');
    git(repo, 'commit -qm "chore: seed"');

    const typeConfig = { root: path.join(repo, 'docs', 'specs', 'features'), folders: ALL_STAGES, prefix: 'feature' };
    const id = getNextId(typeConfig);
    assert.strictEqual(id, 6); // filesystem-only: max is 5, next is 6
}));

report();
