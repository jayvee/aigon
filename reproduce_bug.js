'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const WORKTREE_DIR = '/Users/jviner/src/aigon-worktrees/feature-148-cc-feature-dependency-system';
const LIB_ENTITY = path.join(WORKTREE_DIR, 'lib', 'entity.js');

// Helper to run commands in the worktree
function run(cmd) {
    return execSync(cmd, { cwd: WORKTREE_DIR, encoding: 'utf8' });
}

console.log('--- Reproduction Script: Inconsistent State on Dependency Error ---');

// 1. Create a dummy feature in inbox with an invalid dependency
const inboxDir = path.join(WORKTREE_DIR, 'docs', 'specs', 'features', '01-inbox');
if (!fs.existsSync(inboxDir)) fs.mkdirSync(inboxDir, { recursive: true });

const specFile = 'feature-invalid-dep.md';
const specPath = path.join(inboxDir, specFile);
fs.writeFileSync(specPath, '---\ndepends_on: [999]\n---\n# Invalid Dep\n');
console.log(`Created spec with invalid dependency: ${specPath}`);

// 2. Try to prioritise it
console.log('Running aigon feature-prioritise invalid-dep...');
try {
    // We use the local aigon-cli.js in the worktree
    run('node aigon-cli.js feature-prioritise invalid-dep');
} catch (e) {
    console.log('Command failed as expected (dependency not found).');
}

// 3. Check state
const backlogDir = path.join(WORKTREE_DIR, 'docs', 'specs', 'features', '02-backlog');
const filesInBacklog = fs.readdirSync(backlogDir).filter(f => f.includes('invalid-dep'));

if (filesInBacklog.length > 0) {
    console.log(`❌ BUG: File was moved to backlog: ${filesInBacklog[0]}`);
} else {
    console.log('✅ File was NOT moved to backlog.');
}

const gitStatus = run('git status --short');
if (gitStatus.includes('docs/specs/features/02-backlog/')) {
    console.log('❌ BUG: Git status shows moved file in backlog (unstaged or staged).');
}

// Cleanup
if (filesInBacklog.length > 0) {
    fs.renameSync(path.join(backlogDir, filesInBacklog[0]), specPath);
}
if (fs.existsSync(specPath)) fs.unlinkSync(specPath);

console.log('--- End of Reproduction ---');
