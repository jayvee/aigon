#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path');
const { test, testAsync, withTempDirAsync, report } = require('../_helpers');
const { STATE_RENDER_META, getStateRenderMeta } = require('../../lib/state-render-meta');
const { LifecycleState } = require('../../lib/workflow-core/types');
const engine = require('../../lib/workflow-core/engine');
const wrm = require('../../lib/workflow-read-model');
const { collectRepoStatus, clearTierCache } = require('../../lib/dashboard-status-collector');

const initRepo = r => {
    ['01-inbox','02-backlog','03-in-progress'].forEach(d=>fs.mkdirSync(path.join(r,'docs/specs/features',d),{recursive:true}));
    require('child_process').execSync('git init -q && git config user.email t@t && git config user.name t',{cwd:r});
};

// Every LifecycleState must have a STATE_RENDER_META entry with icon+label+cls.
// Review states carry status-reviewing/status-review-done; badge only on review-in-progress.
test('STATE_RENDER_META: complete coverage, required fields, cls and badge invariants', () => {
    const missing = Object.values(LifecycleState).filter(s => !STATE_RENDER_META[s]);
    assert.deepStrictEqual(missing, [], 'missing entries: ' + missing);
    Object.entries(STATE_RENDER_META).forEach(([s, m]) => assert.ok(m.icon && m.label && m.cls, s));
    assert.strictEqual(STATE_RENDER_META.code_review_in_progress.cls, 'status-reviewing');
    assert.strictEqual(STATE_RENDER_META.code_review_complete.cls, 'status-review-done');
    assert.strictEqual(STATE_RENDER_META.spec_review_in_progress.cls, 'status-reviewing');
    assert.strictEqual(STATE_RENDER_META.spec_review_complete.cls, 'status-review-done');
    assert.strictEqual(STATE_RENDER_META.code_revision_in_progress.cls, 'status-running');
    assert.ok(STATE_RENDER_META.code_review_in_progress.badge, 'code review needs badge');
    assert.ok(STATE_RENDER_META.spec_review_in_progress.badge, 'spec review needs badge');
    assert.strictEqual(STATE_RENDER_META.implementing.badge, '🔨 Implementing');
    assert.strictEqual(getStateRenderMeta('unknown_state').cls, 'status-idle');
});

// API response carries stateRenderMeta + reviewCycles per feature row.
testAsync('collectRepoStatus: stateRenderMeta + reviewCycles present; code_review_in_progress → status-reviewing', () => withTempDirAsync('aigon-srm-', async r => {
    initRepo(r);
    const sp = path.join(r,'docs/specs/features/02-backlog/feature-77-srm.md');
    fs.writeFileSync(sp, '# Feature: srm\n');
    engine.ensureEntityBootstrappedSync(r,'feature','77','backlog',sp,{authorAgentId:'cc'});
    clearTierCache(r);
    const row = (collectRepoStatus(r,[]).features||[]).find(f=>String(f.id)==='77');
    assert.ok(row && row.stateRenderMeta && row.stateRenderMeta.cls, 'stateRenderMeta missing');
    assert.ok(Array.isArray(row.reviewCycles), 'reviewCycles must be array');
    // reviewSessions carry statusCls from STATE_RENDER_META
    await engine.startFeature(r,'77','solo_branch',['cc']);
    await engine.signalAgentReady(r,'77','cc');
    await engine.recordCodeReviewStarted(r,'feature','77',{reviewerId:'cx'});
    const snap = await engine.showFeatureOrNull(r,'77');
    assert.strictEqual(snap.currentSpecState, LifecycleState.CODE_REVIEW_IN_PROGRESS);
    assert.strictEqual(getStateRenderMeta(snap.currentSpecState).cls, 'status-reviewing');
    const state = wrm.getFeatureDashboardState(r,'77','in-progress',[]);
    assert.strictEqual(state.reviewSessions[0] && state.reviewSessions[0].statusCls, 'status-reviewing');
}));

report();
