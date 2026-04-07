#!/usr/bin/env node
'use strict';
// REGRESSION (worktree): installAgentGitAttribution must use --worktree not
// --local. See 2026-04-08 launch-prep bleed investigation in lib/worktree.js.
const assert = require('assert');
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '../../lib/worktree.js'), 'utf8');
assert.ok(/config --local extensions\.worktreeConfig true/.test(src), 'must enable extensions.worktreeConfig');
assert.ok(/config --worktree user\.email/.test(src), 'user.email must use --worktree');
assert.ok(/config --worktree user\.name/.test(src), 'user.name must use --worktree');
assert.ok(!/config --local user\.(name|email)/.test(src), 'must NEVER set user.name/email via --local (pollutes main)');
assert.ok(/config --worktree core\.hooksPath/.test(src), 'core.hooksPath must be worktree-scoped');
// REGRESSION (feature-create): positional description must work, not just --description.
const featSrc = fs.readFileSync(require('path').join(__dirname, '../../lib/commands/feature.js'), 'utf8');
assert.ok(/args\.slice\(1\)\.join\(' '\)\.trim\(\)/.test(featSrc), 'feature-create must support positional description');
assert.ok(/Ignored unrecognized args before --description/.test(featSrc), 'feature-create must warn on stranded args');
console.log('  ✓ source-level regression checks (worktree config + feature-create)');
