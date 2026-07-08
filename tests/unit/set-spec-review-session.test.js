#!/usr/bin/env node
// REGRESSION F648: set-wide spec review session visibility on set cards.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');
const {
    safeSetSpecReviewSessionExists,
    _resetTmuxListCache,
    _setTmuxListCacheForTest,
} = require('../../lib/dashboard-status-helpers');
const { computeStatusFingerprint } = require('../../lib/dashboard-status-version');

function writeSidecar(repoPath, sessionName, record) {
    const dir = path.join(repoPath, '.aigon', 'sessions');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${sessionName}.json`), JSON.stringify({
        sessionName,
        repoPath,
        worktreePath: repoPath,
        createdAt: '2026-07-08T00:00:00.000Z',
        agent: 'cx',
        entityType: 'f',
        entityId: '644',
        role: 'spec-review',
        ...record,
    }, null, 2));
}

test('safeSetSpecReviewSessionExists matches live session via sidecar metadata.setSpecReview.setSlug', () => withTempDir('aigon-set-spec-review-sidecar-', (root) => {
    const repoPath = path.join(root, 'aigon');
    fs.mkdirSync(repoPath, { recursive: true });
    const sessionName = 'aigon-f644-spec-review-cx-set-close-integrity';
    writeSidecar(repoPath, sessionName, {
        metadata: { setSpecReview: { setSlug: 'close-integrity' } },
    });
    _resetTmuxListCache();
    _setTmuxListCacheForTest([sessionName]);

    const result = safeSetSpecReviewSessionExists('close-integrity', repoPath);
    assert.strictEqual(result.running, true);
    assert.strictEqual(result.sessionName, sessionName);
    assert.strictEqual(result.agent, 'cx');
    assert.strictEqual(result.anchorFeatureId, '644');
    assert.strictEqual(result.label, 'Spec review: running');
    assert.ok(result.updatedAt);
}));

test('safeSetSpecReviewSessionExists falls back to tmux name shape when sidecar absent', () => withTempDir('aigon-set-spec-review-name-', (root) => {
    const repoPath = path.join(root, 'aigon');
    fs.mkdirSync(repoPath, { recursive: true });
    const sessionName = 'aigon-f644-spec-review-cx-set-close-integrity';
    _resetTmuxListCache();
    _setTmuxListCacheForTest([sessionName]);

    const result = safeSetSpecReviewSessionExists('close-integrity', repoPath);
    assert.strictEqual(result.running, true);
    assert.strictEqual(result.sessionName, sessionName);
    assert.strictEqual(result.agent, 'cx');
    assert.strictEqual(result.anchorFeatureId, '644');
}));

test('safeSetSpecReviewSessionExists ignores ordinary feature spec-review sessions', () => withTempDir('aigon-set-spec-review-plain-', (root) => {
    const repoPath = path.join(root, 'aigon');
    fs.mkdirSync(repoPath, { recursive: true });
    const sessionName = 'aigon-f644-spec-review-cx';
    writeSidecar(repoPath, sessionName, { role: 'spec-review' });
    _resetTmuxListCache();
    _setTmuxListCacheForTest([sessionName]);

    const result = safeSetSpecReviewSessionExists('close-integrity', repoPath);
    assert.deepStrictEqual(result, { running: false });
}));

test('safeSetSpecReviewSessionExists picks longest session name deterministically', () => withTempDir('aigon-set-spec-review-tie-', (root) => {
    const repoPath = path.join(root, 'aigon');
    fs.mkdirSync(repoPath, { recursive: true });
    const shortName = 'aigon-f644-spec-review-cx-set-pair';
    const longName = 'aigon-f644-spec-review-cx-set-pair-extra';
    writeSidecar(repoPath, shortName, { metadata: { setSpecReview: { setSlug: 'pair' } } });
    writeSidecar(repoPath, longName, { metadata: { setSpecReview: { setSlug: 'pair' } } });
    _resetTmuxListCache();
    _setTmuxListCacheForTest([shortName, longName]);

    const result = safeSetSpecReviewSessionExists('pair', repoPath);
    assert.strictEqual(result.sessionName, longName);
}));

test('computeStatusFingerprint bumps when set specReview changes', () => {
    const base = {
        summary: { waiting: 0, inProgress: 0, inEval: 0 },
        repos: [{
            path: '/tmp/repo',
            features: [],
            research: [],
            feedback: [],
            sets: [{
                slug: 'close-integrity',
                specReview: { running: false, agent: '', sessionName: '' },
            }],
        }],
    };
    const running = JSON.parse(JSON.stringify(base));
    running.repos[0].sets[0].specReview = {
        running: true,
        agent: 'cx',
        sessionName: 'aigon-f644-spec-review-cx-set-close-integrity',
    };
    assert.notStrictEqual(computeStatusFingerprint(base), computeStatusFingerprint(running));
});

test('set card HTML includes spec review activity label', () => {
    const { AIGON_SET_CARDS } = require('../../templates/dashboard/js/set-cards.js');
    const html = AIGON_SET_CARDS.buildSetCardBodyHtml({
        slug: 'close-integrity',
        status: 'idle',
        progress: { merged: 0, total: 2, percent: 0 },
        specReview: {
            running: true,
            agent: 'cx',
            sessionName: 'aigon-f644-spec-review-cx-set-close-integrity',
            label: 'Spec review: running',
        },
        autonomous: { running: false, status: 'stopped' },
        depGraph: { nodes: [], edges: [] },
    });
    assert.match(html, /Spec review: running/);
    assert.match(html, /Conductor: inactive/);
    assert.match(html, /set-session-pill is-active/);
});

report();
