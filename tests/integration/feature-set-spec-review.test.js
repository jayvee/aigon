#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir } = require('../_helpers');
const { buildSetValidActions } = require('../../lib/feature-set-workflow-rules');
const {
    resolveSetSpecReviewPlan,
    buildSetSpecReviewPromptBody,
} = require('../../lib/feature-set-spec-review');

const FOLDERS = ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused'];

function mkFeaturePaths(root) {
    const base = path.join(root, 'docs', 'specs', 'features');
    FOLDERS.forEach(f => fs.mkdirSync(path.join(base, f), { recursive: true }));
    return { root: base, folders: FOLDERS, prefix: 'feature' };
}

function spec(dir, file, set, dependsOn, bodyLines = []) {
    const lines = ['---'];
    if (set) lines.push(`set: ${set}`);
    if (dependsOn) lines.push(`depends_on: [${dependsOn.join(', ')}]`);
    lines.push('---', '', `# ${file}`, ...bodyLines, '');
    fs.writeFileSync(path.join(dir, file), lines.join('\n'));
}

test('resolveSetSpecReviewPlan topo-orders reviewable members and builds prompt payload', () => withTempDir('aigon-set-spec-review-plan-', (root) => {
    const p = mkFeaturePaths(root);
    spec(path.join(p.root, '02-backlog'), 'feature-01-root.md', 'auth', null, ['## Summary', 'Root spec']);
    spec(path.join(p.root, '02-backlog'), 'feature-02-leaf.md', 'auth', ['01'], ['## Summary', 'Leaf spec']);
    spec(path.join(p.root, '05-done'), 'feature-03-done.md', 'auth', null, ['## Summary', 'Done spec']);
    spec(path.join(p.root, '03-in-progress'), 'feature-04-active.md', 'auth', null, ['## Summary', 'Active spec']);

    const plan = resolveSetSpecReviewPlan(root, 'auth', p);
    assert.ifError(plan.error);
    assert.strictEqual(plan.reviewable.length, 2);
    assert.deepStrictEqual(plan.reviewable.map(m => m.paddedId), ['01', '02']);
    assert.strictEqual(plan.anchor.paddedId, '01');

    const prompt = buildSetSpecReviewPromptBody(plan, 'cx');
    assert.match(prompt, /set slug.*auth/i);
    assert.match(prompt, /#01[\s\S]*#02/);
    assert.match(prompt, /#02 → #01/);
    assert.match(prompt, /Root spec/);
    assert.match(prompt, /Leaf spec/);
    assert.doesNotMatch(prompt, /Done spec/);
    assert.doesNotMatch(prompt, /Active spec/);
    assert.match(prompt, /spec-review: feature/);
    assert.match(prompt, /feature-spec-review-record/);
}));

test('buildSetValidActions exposes feature-set-spec-review when reviewableMemberCount > 0', () => {
    // REGRESSION: dashboard must not branch on member state client-side — server owns enablement.
    const actions = buildSetValidActions({
        slug: 'auth',
        status: 'idle',
        isComplete: false,
        inboxMemberCount: 0,
        reviewableMemberCount: 2,
        launchableSpecReviewMemberCount: 2,
    });
    const review = actions.find(a => a.action === 'feature-set-spec-review');
    assert.ok(review);
    assert.strictEqual(review.requiresInput, 'agentPicker');
    const hidden = buildSetValidActions({
        slug: 'auth',
        status: 'idle',
        isComplete: false,
        reviewableMemberCount: 0,
        launchableSpecReviewMemberCount: 0,
    });
    assert.ok(!hidden.some(a => a.action === 'feature-set-spec-review'));
    const inboxOnly = buildSetValidActions({
        slug: 'auth',
        status: 'idle',
        isComplete: false,
        reviewableMemberCount: 2,
        launchableSpecReviewMemberCount: 0,
    });
    assert.ok(!inboxOnly.some(a => a.action === 'feature-set-spec-review'));
});
