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

function collectPendingSpecReviewsFromGit(repoPath, specPath, entityType = 'feature', entityId = null) {
    if (!repoPath || !specPath) return [];

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
    return pending.reverse();
}

function workflowHasLoggedPendingReviews(snapshot) {
    const specReview = snapshot && snapshot.specReview;
    if (!specReview) return false;
    if (Number(specReview.pendingCount) > 0) return true;
    return Array.isArray(specReview.pendingReviews) && specReview.pendingReviews.length > 0;
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
    REVISION_SKIP_STAGES,
    getRevisionSkipReason,
    collectPendingSpecReviewsFromGit,
    workflowHasLoggedPendingReviews,
};
