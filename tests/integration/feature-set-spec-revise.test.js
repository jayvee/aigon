#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');
const { test, testAsync, withTempDir, withTempDirAsync, GIT_SAFE_ENV, report } = require('../_helpers');
const engine = require('../../lib/workflow-core/engine');
const featureSets = require('../../lib/feature-sets');
const { buildSetValidActions } = require('../../lib/feature-set-workflow-rules');
const {
    countPendingSpecReviseMembers,
    resolveSetSpecRevisePlan,
    buildSetSpecRevisePromptBody,
    filterPendingForRevisionAgent,
    assessMemberRevisionCandidate,
} = require('../../lib/feature-set-spec-revise');
const { collectPendingSpecReviewsFromGit } = require('../../lib/spec-review-state');

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

function initRepo(root) {
    const env = { ...process.env, ...GIT_SAFE_ENV };
    const g = (args) => execFileSync('git', args, { cwd: root, env, stdio: 'pipe' });
    g(['init']);
    g(['config', 'user.email', 'test@aigon.test']);
    g(['config', 'user.name', 'Aigon Test']);
    fs.writeFileSync(path.join(root, '.gitkeep'), '');
    g(['add', '.gitkeep']);
    g(['commit', '-m', 'chore: init test repo']);
}

function runCli(root, args, opts = {}) {
    const cli = path.join(__dirname, '..', '..', 'aigon-cli.js');
    return execFileSync('node', [cli, ...args], {
        cwd: root,
        env: { ...process.env, ...GIT_SAFE_ENV, ...(opts.env || {}) },
        encoding: 'utf8',
        ...opts,
    });
}

function commitSpecReview(root, specPath, entityId, reviewerId, summary = 'tighten spec') {
    const current = fs.readFileSync(specPath, 'utf8');
    fs.writeFileSync(specPath, `${current.trim()}\n\n<!-- review ${reviewerId} -->\n`);
    execSync(`git add "${specPath}" && git commit -m "spec-review: feature ${entityId} — ${summary}" -m "Reviewer: ${reviewerId}"`, {
        cwd: root,
        env: { ...process.env, ...GIT_SAFE_ENV },
        stdio: 'pipe',
    });
    return execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();
}

test('collectPendingSpecReviewsFromGit finds reviews newer than latest ack', () => withTempDir('aigon-set-spec-revise-git-', (root) => {
    initRepo(root);
    const p = mkFeaturePaths(root);
    const specPath = path.join(p.root, '02-backlog', 'feature-01-a.md');
    spec(path.join(p.root, '02-backlog'), 'feature-01-a.md', 'pair');
    execSync('git add . && git commit -qm "chore: add spec"', { cwd: root, env: { ...process.env, ...GIT_SAFE_ENV } });
    const sha1 = commitSpecReview(root, specPath, '01', 'gg');
    execSync(`git commit --allow-empty -qm "spec-revise: feature 01 — accepted" -m "reviewed: gg"`, {
        cwd: root,
        env: { ...process.env, ...GIT_SAFE_ENV },
    });
    const sha2 = commitSpecReview(root, specPath, '01', 'cc', 'second review');
    const pending = collectPendingSpecReviewsFromGit(root, specPath, 'feature', '01');
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].sha, sha2);
    assert.strictEqual(pending[0].reviewerId, 'cc');
    assert.ok(!pending.some(r => r.sha === sha1));
}));

test('filterPendingForRevisionAgent skips same-agent reviews', () => {
    const member = {
        revisionStatus: 'eligible',
        gitPending: [{ sha: 'abc', reviewerId: 'cu', subject: 'spec-review: feature 1' }],
    };
    const filtered = filterPendingForRevisionAgent(member, 'cu');
    assert.strictEqual(filtered.revisionStatus, 'skipped');
    assert.strictEqual(filtered.skipReason, 'same-agent review');
    const kept = filterPendingForRevisionAgent(member, 'cc');
    assert.strictEqual(kept.activePending.length, 1);
});

testAsync('resolveSetSpecRevisePlan topo-orders eligible members and flags inconsistent workflow', () => withTempDirAsync('aigon-set-spec-revise-plan-', async (root) => {
    initRepo(root);
    const p = mkFeaturePaths(root);
    spec(path.join(p.root, '02-backlog'), 'feature-01-root.md', 'auth', null, ['## Summary', 'Root']);
    spec(path.join(p.root, '02-backlog'), 'feature-02-leaf.md', 'auth', ['01'], ['## Summary', 'Leaf']);
    spec(path.join(p.root, '03-in-progress'), 'feature-03-active.md', 'auth', null, ['## Summary', 'Active']);
    execSync('git add . && git commit -qm "chore: specs"', { cwd: root, env: { ...process.env, ...GIT_SAFE_ENV } });

    const rootPath = path.join(p.root, '02-backlog', 'feature-01-root.md');
    const leafPath = path.join(p.root, '02-backlog', 'feature-02-leaf.md');
    const rootSha = commitSpecReview(root, rootPath, '01', 'gg');
    const _leafSha = commitSpecReview(root, leafPath, '02', 'cc');

    engine.ensureEntityBootstrappedSync(root, 'feature', '01', 'backlog', rootPath);
    engine.ensureEntityBootstrappedSync(root, 'feature', '02', 'backlog', leafPath);
    await engine.recordSpecReviewSubmitted(root, 'feature', '01', {
        reviewId: rootSha,
        reviewerId: 'gg',
        summary: 'root review',
        commitSha: rootSha,
    });
    await engine.recordSpecReviewSubmitted(root, 'feature', '02', {
        reviewId: 'unrelated-review',
        reviewerId: 'cc',
        summary: 'stale unrelated review',
        commitSha: 'unrelated-review',
    });
    // leaf has a git review commit, but not a matching workflow signal — inconsistent

    const plan = resolveSetSpecRevisePlan(root, 'auth', p);
    assert.ifError(plan.error);
    assert.strictEqual(plan.eligible.length, 1);
    assert.strictEqual(plan.eligible[0].paddedId, '01');
    const inconsistent = plan.contextRows.find(r => r.member.paddedId === '02');
    assert.strictEqual(inconsistent.assessment.revisionStatus, 'inconsistent');

    const prompt = buildSetSpecRevisePromptBody(plan, 'cx');
    assert.match(prompt, /set slug.*auth/i);
    assert.match(prompt, /Root/);
    assert.match(prompt, /spec-revise:/);
    assert.match(prompt, /feature-spec-revise-record/);
}));

test('feature-set-spec-revise CLI rejects invalid slug and empty pending set', () => withTempDir('aigon-set-spec-revise-cli-', (root) => {
    initRepo(root);
    const p = mkFeaturePaths(root);
    spec(path.join(p.root, '02-backlog'), 'feature-01-only.md', 'solo');

    assert.throws(
        () => runCli(root, ['feature-set-spec-revise', 'bad slug'], { stdio: 'pipe' }),
        e => e.status === 1 && /Invalid set slug/.test(String(e.stderr))
    );
    assert.throws(
        () => runCli(root, ['feature-set-spec-revise', 'solo'], { stdio: 'pipe' }),
        e => e.status === 1 && /no members with pending spec reviews/i.test(String(e.stderr))
    );
}));

testAsync('feature-set-spec-revise degrades when selected agent authored all pending reviews', () => withTempDirAsync('aigon-set-spec-revise-same-agent-', async (root) => {
    initRepo(root);
    const p = mkFeaturePaths(root);
    const specPath = path.join(p.root, '02-backlog', 'feature-01-a.md');
    spec(path.join(p.root, '02-backlog'), 'feature-01-a.md', 'solo');
    execSync('git add . && git commit -qm "chore: spec"', { cwd: root, env: { ...process.env, ...GIT_SAFE_ENV } });
    const sha = commitSpecReview(root, specPath, '01', 'cx');
    engine.ensureEntityBootstrappedSync(root, 'feature', '01', 'backlog', specPath);
    await engine.recordSpecReviewSubmitted(root, 'feature', '01', {
        reviewId: sha,
        reviewerId: 'cx',
        summary: 'solo review',
        commitSha: sha,
    });

    const out = runCli(root, ['feature-set-spec-revise', 'solo', '--no-launch', '--agent=cx']);
    assert.match(out, /none are eligible/i);
    assert.match(out, /same-agent/i);

    const plan = resolveSetSpecRevisePlan(root, 'solo', p, { revisionAgentId: 'cx' });
    assert.strictEqual(plan.contextRows[0].assessment.revisionStatus, 'skipped');
    assert.strictEqual(plan.contextRows[0].assessment.skipReason, 'same-agent review');
}));

testAsync('feature-set-spec-revise --no-launch prints ordered eligible context', () => withTempDirAsync('aigon-set-spec-revise-nolaunch-', async (root) => {
    initRepo(root);
    const p = mkFeaturePaths(root);
    const rootPath = path.join(p.root, '02-backlog', 'feature-01-a.md');
    const leafPath = path.join(p.root, '02-backlog', 'feature-02-b.md');
    spec(path.join(p.root, '02-backlog'), 'feature-01-a.md', 'pair');
    spec(path.join(p.root, '02-backlog'), 'feature-02-b.md', 'pair', ['01']);
    execSync('git add . && git commit -qm "chore: specs"', { cwd: root, env: { ...process.env, ...GIT_SAFE_ENV } });
    const sha1 = commitSpecReview(root, rootPath, '01', 'gg');
    const sha2 = commitSpecReview(root, leafPath, '02', 'gg');
    engine.ensureEntityBootstrappedSync(root, 'feature', '01', 'backlog', rootPath);
    engine.ensureEntityBootstrappedSync(root, 'feature', '02', 'backlog', leafPath);
    await engine.recordSpecReviewSubmitted(root, 'feature', '01', { reviewId: sha1, reviewerId: 'gg', commitSha: sha1 });
    await engine.recordSpecReviewSubmitted(root, 'feature', '02', { reviewId: sha2, reviewerId: 'gg', commitSha: sha2 });

    const out = runCli(root, ['feature-set-spec-revise', 'pair', '--no-launch', '--agent=cu']);
    assert.match(out, /2 eligible member/i);
    assert.match(out, /SET SPEC REVISION PROMPT/);
    assert.match(out, /#01[\s\S]*#02/);
}));

test('buildSetValidActions exposes feature-set-spec-revise when pendingSpecReviseMemberCount > 0', () => {
    // REGRESSION: dashboard must not branch on member state client-side — server owns enablement.
    const actions = buildSetValidActions({
        slug: 'auth',
        status: 'idle',
        isComplete: false,
        pendingSpecReviseMemberCount: 2,
    });
    const revise = actions.find(a => a.action === 'feature-set-spec-revise');
    assert.ok(revise);
    assert.strictEqual(revise.label, 'Revise Set Specs');
    assert.strictEqual(revise.requiresInput, 'agentPicker');
    const hidden = buildSetValidActions({
        slug: 'auth',
        status: 'idle',
        isComplete: false,
        pendingSpecReviseMemberCount: 0,
    });
    assert.ok(!hidden.some(a => a.action === 'feature-set-spec-revise'));
});

testAsync('countPendingSpecReviseMembers is agent-agnostic', () => withTempDirAsync('aigon-set-spec-revise-count-', async (root) => {
    initRepo(root);
    const p = mkFeaturePaths(root);
    spec(path.join(p.root, '02-backlog'), 'feature-01-a.md', 'pair');
    const members = featureSets.getSetMembersSorted('pair', p);
    assert.strictEqual(countPendingSpecReviseMembers(members, root), 0);

    const specPath = path.join(p.root, '02-backlog', 'feature-01-a.md');
    execSync('git add . && git commit -qm "chore: spec"', { cwd: root, env: { ...process.env, ...GIT_SAFE_ENV } });
    const sha = commitSpecReview(root, specPath, '01', 'gg');
    engine.ensureEntityBootstrappedSync(root, 'feature', '01', 'backlog', specPath);
    await engine.recordSpecReviewSubmitted(root, 'feature', '01', { reviewId: sha, reviewerId: 'gg', commitSha: sha });
    assert.strictEqual(countPendingSpecReviseMembers(members, root), 1);
}));

test('assessMemberRevisionCandidate skips in-progress members', () => {
    const assessment = assessMemberRevisionCandidate({
        stage: 'in-progress',
        paddedId: '03',
        slug: 'active',
        specPath: '/tmp/x.md',
        snapshot: null,
        repoPath: '/tmp',
    });
    assert.strictEqual(assessment.revisionStatus, 'skipped');
    assert.match(assessment.skipReason, /implementation/i);
});

report();
