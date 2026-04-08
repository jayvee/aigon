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
// feature-create must still support positional descriptions (post-refactor the
// parser splits known flags from positionals; assert on the downstream join).
assert.ok(/positional\.join\(' '\)/.test(featSrc), 'feature-create must join positional args into description');
assert.ok(/Ignored unrecognized args before --description/.test(featSrc), 'feature-create must warn on stranded args');
// REGRESSION (feature-reset): must clean workflow-core engine state, not just legacy .aigon/state/. See feature 242.
assert.ok(/wf\.resetFeature\s*\(/.test(featSrc), 'feature-reset must call wf.resetFeature');
assert.ok(/async function resetFeature\s*\(/.test(fs.readFileSync(require('path').join(__dirname, '../../lib/workflow-core/engine.js'), 'utf8')), 'engine must export resetFeature');
// REGRESSION (feature 243): dashboard Reset action must be declared in the central
// rules registry (not hardcoded in the frontend), and the dashboard /api/action
// allowlist must accept 'feature-reset' so clicking Reset can invoke the CLI.
const rulesSrc = fs.readFileSync(require('path').join(__dirname, '../../lib/feature-workflow-rules.js'), 'utf8');
assert.ok(/FEATURE_RESET/.test(rulesSrc), 'feature 243: FEATURE_RESET must be declared in feature-workflow-rules.js');
assert.ok(/confirmationMessage/.test(rulesSrc), 'feature 243: Reset must carry a confirmationMessage for the destructive modal');
const dashSrc = fs.readFileSync(require('path').join(__dirname, '../../lib/dashboard-server.js'), 'utf8');
assert.ok(/'feature-reset'/.test(dashSrc), 'feature 243: dashboard /api/action allowlist must include feature-reset');
console.log('  ✓ source-level regression checks (worktree config + feature-create + feature-reset + feature 243 dashboard reset)');
