#!/usr/bin/env node
'use strict';
// REGRESSION: prevents lib/worktree.js:installAgentGitAttribution from using
// `git config --local` for per-agent identity. `--local` in a linked worktree
// writes to SHARED .git/config and silently rewrites the main repo's
// user.email to the AI agent's email. Fix uses `--worktree` after enabling
// extensions.worktreeConfig. See 2026-04-08 launch-prep bleed investigation.
const assert = require('assert');
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '../../lib/worktree.js'), 'utf8');
assert.ok(/config --local extensions\.worktreeConfig true/.test(src), 'must enable extensions.worktreeConfig');
assert.ok(/config --worktree user\.email/.test(src), 'user.email must use --worktree');
assert.ok(/config --worktree user\.name/.test(src), 'user.name must use --worktree');
assert.ok(!/config --local user\.(name|email)/.test(src), 'must NEVER set user.name/email via --local (pollutes main)');
assert.ok(/config --worktree core\.hooksPath/.test(src), 'core.hooksPath must be worktree-scoped');
console.log('  ✓ worktree config isolation regression checks');
