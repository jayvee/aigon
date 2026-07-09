'use strict';

const { execSync, execFileSync } = require('child_process');

function normalizeEntityId(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^\d+$/.test(raw)) return String(parseInt(raw, 10));
    return raw;
}

function sameEntityId(left, right) {
    return normalizeEntityId(left) === normalizeEntityId(right);
}

function parseSpecReviewSubject(subject) {
    const raw = String(subject || '').trim();
    const match = raw.match(/^spec-(review(?:-check)?|revise):\s*(feature|research)\s+(.+?)(?:\s+[:—-]\s+.+)?$/);
    if (!match) return null;
    const isAck = match[1] === 'review-check' || match[1] === 'revise';
    return {
        entityType: match[2],
        entityId: match[3],
        isAck,
        isReview: !isAck,
        summary: raw.replace(/^spec-(review(?:-check)?|revise):\s*(feature|research)\s+(.+?)(?:\s+[:—-]\s+)?/, '').trim(),
        subject: raw,
    };
}

function isValidReviewerId(reviewerId) {
    return /^[a-z]{2,10}$/.test(String(reviewerId || '')) && String(reviewerId) !== 'unknown';
}

function extractSpecReviewerId(body) {
    const reviewerLine = String(body || '').match(/^Reviewer:\s*([a-z]{2,10})$/mi);
    if (!reviewerLine) return null;
    const reviewerId = reviewerLine[1];
    return isValidReviewerId(reviewerId) ? reviewerId : null;
}

function extractReviewedAgentIds(body) {
    const reviewedLine = String(body || '').match(/^reviewed:\s*(.+)$/mi);
    if (!reviewedLine) return [];
    return reviewedLine[1]
        .split(',')
        .map(part => part.trim())
        .filter(Boolean)
        .filter(isValidReviewerId);
}

function clonePendingReview(review) {
    return {
        reviewId: review.reviewId,
        reviewerId: review.reviewerId,
        summary: review.summary || '',
        submittedAt: review.submittedAt || null,
        commitSha: review.commitSha || null,
    };
}

function cloneActiveSession(session) {
    return {
        agentId: session.agentId,
        startedAt: session.startedAt || null,
    };
}

function buildSpecReviewSummary(pendingReviews, options = {}) {
    const reviews = Array.isArray(pendingReviews) ? pendingReviews.map(clonePendingReview) : [];
    const pendingAgents = [...new Set(reviews.map(review => review.reviewerId).filter(Boolean))];
    const pendingCount = reviews.length;
    const isDone = options.stage === 'done' || options.lifecycle === 'done';
    const activeReviewers = Array.isArray(options.activeReviewers)
        ? options.activeReviewers.map(cloneActiveSession)
        : [];
    const activeCheckers = Array.isArray(options.activeCheckers)
        ? options.activeCheckers.map(cloneActiveSession)
        : [];
    return {
        pendingReviews: isDone ? [] : reviews,
        pendingCount: isDone ? 0 : pendingCount,
        pendingAgents: isDone ? [] : pendingAgents,
        pendingLabel: (!isDone && pendingCount > 0)
            ? `${pendingCount} pending — ${pendingAgents.join(', ')}`
            : '',
        activeReviewers: isDone ? [] : activeReviewers,
        activeCheckers: isDone ? [] : activeCheckers,
    };
}

function readGitText(repoPath, command) {
    return execSync(command, {
        cwd: repoPath,
        encoding: 'utf8',
        stdio: 'pipe',
    }).trim();
}

function readHeadSpecReviewCommit(repoPath, expected) {
    const sha = readGitText(repoPath, 'git rev-parse HEAD');
    const subject = readGitText(repoPath, 'git show -s --format=%s HEAD');
    const body = readGitText(repoPath, 'git show -s --format=%B HEAD');
    const parsed = parseSpecReviewSubject(subject);
    if (!parsed) {
        throw new Error('HEAD is not a spec-review commit.');
    }
    if (expected && expected.entityType && parsed.entityType !== expected.entityType) {
        throw new Error(`HEAD is for ${parsed.entityType}, expected ${expected.entityType}.`);
    }
    if (expected && expected.kind === 'review' && !parsed.isReview) {
        throw new Error('HEAD is not a spec-review submission commit.');
    }
    if (expected && expected.kind === 'ack' && !parsed.isAck) {
        throw new Error('HEAD is not a spec-review acknowledgement commit.');
    }
    if (expected && expected.entityId && !sameEntityId(parsed.entityId, expected.entityId)) {
        throw new Error(`HEAD is for ${parsed.entityId}, expected ${expected.entityId}.`);
    }

    const reviewerId = parsed.isReview ? extractSpecReviewerId(body) : null;
    if (parsed.isReview && !reviewerId) {
        throw new Error('Spec-review commit is missing a valid Reviewer: <agent> line.');
    }

    return {
        sha,
        subject,
        body,
        parsed,
        reviewerId,
        reviewedAgentIds: extractReviewedAgentIds(body),
    };
}

/**
 * Returns true iff the entity's lifecycle allows starting or continuing a
 * spec-review cycle (inbox or backlog only — not once implementation has begun).
 * Use engine truth (snapshot.lifecycle), not folder position.
 *
 * @param {string} lifecycle - engine lifecycle value from snapshot
 * @returns {boolean}
 */
function isSpecReviewCycleAllowed(lifecycle) {
    return lifecycle === 'inbox' || lifecycle === 'backlog';
}

/** True when a spec-review projector event may change lifecycle (not after close/done). */
function shouldMutateLifecycleForSpecReviewEvent(currentLifecycle) {
    return currentLifecycle === 'inbox'
        || currentLifecycle === 'backlog'
        || currentLifecycle === 'spec_review_in_progress'
        || currentLifecycle === 'spec_revision_in_progress';
}

/** Post-close code/spec review replay events must not downgrade terminal lifecycles. */
function shouldMutateLifecycleForCodeReviewEvent(currentLifecycle) {
    return currentLifecycle !== 'done' && currentLifecycle !== 'closing';
}

/** Resting lifecycle to return to after a spec-review/revision cycle completes or cancels. */
function captureSpecReviewReturnLifecycle(currentLifecycle) {
    return currentLifecycle === 'inbox' ? 'inbox' : 'backlog';
}

/**
 * Resolve lifecycle after spec-review/revision complete/cancel.
 * Inbox entities stay in inbox until prioritise — never promote to backlog via review alone.
 * @param {object|null} context - projector/engine context (may be mutated)
 * @param {string} currentLifecycle - lifecycle variable before the resting transition
 * @returns {'inbox'|'backlog'}
 */
function resolveSpecReviewRestingLifecycle(context, currentLifecycle) {
    const stored = context && context.specReviewReturnLifecycle;
    if (stored === 'inbox' || stored === 'backlog') {
        if (context) context.specReviewReturnLifecycle = null;
        return stored;
    }
    if (currentLifecycle === 'inbox') return 'inbox';
    return 'backlog';
}

const REVISION_SKIP_STAGES = new Set(['done', 'in-progress', 'in-evaluation', 'paused']);

function getRevisionSkipReason(member) {
    if (!member) return 'missing member';
    if (member.stage === 'done') return 'done';
    if (REVISION_SKIP_STAGES.has(String(member.stage || ''))) {
        return member.stage === 'in-progress' || member.stage === 'in-evaluation'
            ? 'in implementation or later'
            : String(member.stage);
    }
    return null;
}

// F637: the dashboard status poll calls collectPendingSpecReviewsFromGit for
// every feature-set member on every poll, and each call runs 2-3 `git log
// --follow` history scans. On a repo with a large backlog this dominated poll
// time (~10s of an ~11s poll → ~15s HTTP blackout every 20s cycle). The result
// is a pure function of the repo's committed history, so cache it per
// (repo,spec,entity) keyed on the repo HEAD sha; the expensive scans only rerun
// when HEAD actually moves. `--follow` (needed for the inbox→backlog spec
// rename) stays intact — we just stop re-running it when nothing changed.
const _pendingReviewCache = new Map();  // `${repo}\x1f${spec}\x1f${type}\x1f${id}` -> { head, result }

// Resolve HEAD fresh on every call — `git rev-parse HEAD` is cheap (~5-10ms) and
// this is the cache's invalidation key, so it must be exact. Caching HEAD itself
// (even briefly) would make a commit that lands between two polls invisible until
// the TTL lapsed; the expensive `git log --follow` scans are what we skip, not
// this. The pending-review cache below only rebuilds when this value changes.
function _resolveRepoHead(repoPath) {
    try {
        return execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: repoPath, encoding: 'utf8', stdio: 'pipe',
        }).trim() || null;
    } catch (_) { return null; }
}

/** Test/maintenance hook: drop the pending-review cache. */
function clearSpecReviewGitCache() {
    _pendingReviewCache.clear();
}

function collectPendingSpecReviewsFromGit(repoPath, specPath, entityType = 'feature', entityId = null) {
    if (!repoPath || !specPath) return [];

    const head = _resolveRepoHead(repoPath);
    const cacheKey = `${repoPath}\x1f${specPath}\x1f${entityType}\x1f${entityId}`;
    if (head) {
        const hit = _pendingReviewCache.get(cacheKey);
        if (hit && hit.head === head) return hit.result.map(r => ({ ...r }));
    }

    let lastAck = null;
    try {
        lastAck = execFileSync('git', [
            'log', '--follow', '-n', '1', '--format=%H',
            '--extended-regexp',
            '--grep=^spec-review-check:',
            '--grep=^spec-revise:',
            '--', specPath,
        ], { cwd: repoPath, encoding: 'utf8', stdio: 'pipe' }).trim() || null;
    } catch (_) { /* no path-scoped ack */ }

    if (!lastAck && entityId) {
        const idPattern = String(entityId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        try {
            lastAck = execFileSync('git', [
                'log', '-n', '1', '--format=%H',
                '--extended-regexp',
                `--grep=^spec-revise: ${entityType} ${idPattern}`,
                `--grep=^spec-review-check: ${entityType} ${idPattern}`,
            ], { cwd: repoPath, encoding: 'utf8', stdio: 'pipe' }).trim() || null;
        } catch (_) { /* no entity-scoped ack */ }
    }

    const logArgs = ['log', '--follow', '--format=%H%x1f%s'];
    if (lastAck) logArgs.push(`${lastAck}..HEAD`);
    logArgs.push('--', specPath);

    let output = '';
    try {
        output = execFileSync('git', logArgs, {
            cwd: repoPath,
            encoding: 'utf8',
            stdio: 'pipe',
        });
    } catch (_) {
        return [];
    }

    const pending = [];
    for (const line of String(output || '').trim().split('\n').filter(Boolean)) {
        const sep = line.indexOf('\x1f');
        if (sep === -1) continue;
        const sha = line.slice(0, sep);
        const subject = line.slice(sep + 1);
        const parsed = parseSpecReviewSubject(subject);
        if (!parsed || parsed.entityType !== entityType) continue;
        if (parsed.isAck) continue;
        if (!parsed.isReview) continue;
        let reviewerId = null;
        try {
            const body = execFileSync('git', ['show', '-s', '--format=%B', sha], {
                cwd: repoPath,
                encoding: 'utf8',
                stdio: 'pipe',
            });
            reviewerId = extractSpecReviewerId(body);
        } catch (_) { /* best-effort */ }
        pending.push({
            sha,
            subject,
            reviewerId,
            summary: parsed.summary,
        });
    }
    const result = pending.reverse();
    // Cache the computed history-derived result against the current HEAD so the
    // next poll (HEAD unchanged) skips the `git log --follow` scans entirely.
    if (head) _pendingReviewCache.set(cacheKey, { head, result });
    return result.map(r => ({ ...r }));
}

function workflowHasLoggedPendingReviews(snapshot, pendingReviews = null) {
    const specReview = snapshot && snapshot.specReview;
    if (!specReview) return false;
    const logged = Array.isArray(specReview.pendingReviews) ? specReview.pendingReviews : [];
    if (!Array.isArray(pendingReviews)) {
        if (Number(specReview.pendingCount) > 0) return true;
        return logged.length > 0;
    }
    if (pendingReviews.length === 0) return true;
    const loggedIds = new Set(logged.map(review => review && (review.reviewId || review.commitSha)).filter(Boolean));
    return pendingReviews.every(review => loggedIds.has(review.sha));
}

module.exports = {
    normalizeEntityId,
    sameEntityId,
    parseSpecReviewSubject,
    isValidReviewerId,
    extractSpecReviewerId,
    extractReviewedAgentIds,
    buildSpecReviewSummary,
    readHeadSpecReviewCommit,
    isSpecReviewCycleAllowed,
    shouldMutateLifecycleForSpecReviewEvent,
    shouldMutateLifecycleForCodeReviewEvent,
    captureSpecReviewReturnLifecycle,
    resolveSpecReviewRestingLifecycle,
    REVISION_SKIP_STAGES,
    getRevisionSkipReason,
    collectPendingSpecReviewsFromGit,
    clearSpecReviewGitCache,
    workflowHasLoggedPendingReviews,
};
