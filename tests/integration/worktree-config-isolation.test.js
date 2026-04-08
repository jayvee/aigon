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
assert.ok(/flags\.description \|\| positional\.join\(' '\)/.test(featSrc), 'feature-create must support positional description');
assert.ok(/Ignored unrecognized args before --description/.test(featSrc), 'feature-create must warn on stranded args');
// REGRESSION (feature-reset): must clean workflow-core engine state, not just legacy .aigon/state/. See feature 242.
assert.ok(/wf\.resetFeature\s*\(/.test(featSrc), 'feature-reset must call wf.resetFeature');
assert.ok(/async function resetFeature\s*\(/.test(fs.readFileSync(require('path').join(__dirname, '../../lib/workflow-core/engine.js'), 'utf8')), 'engine must export resetFeature');
// REGRESSION (feature 240): re-running `feature-start <id>` on a running
// solo_worktree/fleet feature used to create a stale `feature-<id>-<slug>`
// drive branch that feature-close then silently merged instead of the real
// worktree branch. Guard across feature-start, feature-close, and doctor.
const rd = (p) => fs.readFileSync(require('path').join(__dirname, '../../', p), 'utf8');
assert.ok(/engineIsWorktreeBased/.test(featSrc) && /skipping drive branch creation to avoid leaving a stale/.test(featSrc), 'feature-start must guard against stale drive branches');
assert.ok(/Stale drive-style branch detected/.test(rd('lib/feature-close.js')), 'feature-close must warn when a stale drive branch coexists with a worktree branch');
assert.ok(/candidate\.tail\.endsWith/.test(rd('lib/commands/setup.js')) && /stale-drive-branch/.test(rd('lib/commands/setup.js')), 'doctor must detect stale drive branches without assuming two-letter slug prefixes are agent ids');
console.log('  ✓ source-level regression checks (worktree config + feature-create + feature-reset + feature 240 stale drive branch)');
