'use strict';

const { execSync } = require('child_process');

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
};
