'use strict';

/**
 * Spec-review state — per-entity JSON store.
 *
 * Replaces the git-commit-subject-based model (`spec-review:` / `spec-review-check:`).
 * State for feature <id> lives at `.aigon/workflows/features/<id>/spec-review.json`
 * (and `.aigon/workflows/research/<id>/spec-review.json`).
 *
 * Writers: `aigon spec-review submit|ack` (invoked by templates) and
 * feature-close auto-ack. Readers: `lib/dashboard-status-collector.js`.
 * Commits may still be produced as an audit artefact but are not authoritative
 * for state — see docs/architecture.md § State Architecture.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MIGRATION_MARKER = 'spec-review-migrated.json';

function entityDir(repoPath, entityType, entityId) {
    const bucket = entityType === 'research' ? 'research' : 'features';
    return path.join(repoPath, '.aigon', 'workflows', bucket, String(entityId));
}

function statePath(repoPath, entityType, entityId) {
    return path.join(entityDir(repoPath, entityType, entityId), 'spec-review.json');
}

function migrationMarkerPath(repoPath) {
    return path.join(repoPath, '.aigon', 'workflows', MIGRATION_MARKER);
}

function readState(repoPath, entityType, entityId) {
    const p = statePath(repoPath, entityType, entityId);
    if (!fs.existsSync(p)) return { reviews: [] };
    try {
        const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (!parsed || !Array.isArray(parsed.reviews)) return { reviews: [] };
        return parsed;
    } catch (_) {
        return { reviews: [] };
    }
}

function writeState(repoPath, entityType, entityId, state) {
    const dir = entityDir(repoPath, entityType, entityId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(statePath(repoPath, entityType, entityId), JSON.stringify(state, null, 2) + '\n');
}

function derivePending(state) {
    const pending = (state.reviews || []).filter(r => !r.ackedAt);
    const reviewers = [];
    for (const r of pending) {
        if (r.reviewerId && !reviewers.includes(r.reviewerId)) reviewers.push(r.reviewerId);
    }
    return { pendingCount: pending.length, pendingAgents: reviewers, pending };
}

function isValidReviewerId(id) {
    if (typeof id !== 'string') return false;
    if (id === 'unknown') return false;
    return /^[a-z]{2,10}$/.test(id);
}

function recordSubmission(repoPath, entityType, entityId, { reviewerId, summary, commitSha = null, submittedAt = null }) {
    if (!isValidReviewerId(reviewerId)) {
        throw new Error(`spec-review submit: invalid reviewerId "${reviewerId}". Pass --reviewer=<agentId> (cc/gg/cx/cu).`);
    }
    const state = readState(repoPath, entityType, entityId);
    state.reviews.push({
        reviewerId,
        summary: summary || '',
        submittedAt: submittedAt || new Date().toISOString(),
        commitSha: commitSha || null,
        ackedAt: null,
        ackedBy: null,
        ackNotes: null,
    });
    writeState(repoPath, entityType, entityId, state);
    return state;
}

function recordAck(repoPath, entityType, entityId, { ackedBy, notes = null, commitSha = null, ackedAt = null }) {
    const state = readState(repoPath, entityType, entityId);
    const at = ackedAt || new Date().toISOString();
    let acked = 0;
    for (const review of state.reviews) {
        if (!review.ackedAt) {
            review.ackedAt = at;
            review.ackedBy = ackedBy || 'unknown';
            review.ackNotes = notes || null;
            review.ackCommitSha = commitSha || null;
            acked++;
        }
    }
    writeState(repoPath, entityType, entityId, state);
    return { state, ackedCount: acked };
}

function hasMigrationRun(repoPath) {
    return fs.existsSync(migrationMarkerPath(repoPath));
}

function safeGit(repoPath, cmd) {
    try { return execSync(cmd, { cwd: repoPath, encoding: 'utf8', stdio: 'pipe' }).trim(); }
    catch (_) { return ''; }
}

function parseSpecReviewSubject(subject) {
    const match = String(subject || '').match(/^spec-review(?:-check)?:\s*(feature|research)\s+(.+?)(?:\s+[—-]\s+(.+))?$/);
    if (!match) return null;
    const isAck = /^spec-review-check:/.test(subject);
    return {
        entityType: match[1],
        id: match[2],
        isAck,
        summary: (match[3] || '').trim(),
    };
}

function extractReviewerId(body) {
    const m = String(body || '').match(/^Reviewer:\s*([a-z]{2,10})$/mi);
    return m ? m[1] : null;
}

function extractAckedBy(body) {
    const m = String(body || '').match(/^reviewed:\s*([a-z][a-z0-9, ]*)$/mi);
    if (!m) return null;
    return m[1].split(/\s*,\s*/).filter(Boolean).join(',');
}

function migrateFromGitHistory(repoPath) {
    if (hasMigrationRun(repoPath)) return { migrated: false, reason: 'already-migrated' };
    const out = safeGit(repoPath, "git log --all --format=%x1e%H%x1f%ct%x1f%s --extended-regexp --grep='^spec-review(-check)?:'");
    if (!out) {
        fs.mkdirSync(path.dirname(migrationMarkerPath(repoPath)), { recursive: true });
        fs.writeFileSync(migrationMarkerPath(repoPath), JSON.stringify({ migratedAt: new Date().toISOString(), backfilled: 0 }, null, 2) + '\n');
        return { migrated: true, backfilled: 0 };
    }

    const byEntity = new Map();
    out.split('\x1e').forEach(block => {
        const trimmed = block.trim();
        if (!trimmed) return;
        const [sha, ctStr, subject] = trimmed.split('\x1f');
        if (!sha || !subject) return;
        const info = parseSpecReviewSubject(subject);
        if (!info) return;
        const key = `${info.entityType}:${info.id}`;
        if (!byEntity.has(key)) byEntity.set(key, []);
        const at = new Date(Number(ctStr) * 1000).toISOString();
        const body = safeGit(repoPath, `git show -s --format=%B ${JSON.stringify(sha)}`);
        byEntity.get(key).push({ ...info, sha, at, body });
    });

    let backfilled = 0;
    for (const [key, entries] of byEntity.entries()) {
        const [entityType, entityId] = key.split(':');
        entries.sort((a, b) => a.at.localeCompare(b.at));
        const state = { reviews: [] };
        for (const entry of entries) {
            if (entry.isAck) {
                const ackedBy = extractAckedBy(entry.body) || 'unknown';
                for (const review of state.reviews) {
                    if (!review.ackedAt) {
                        review.ackedAt = entry.at;
                        review.ackedBy = ackedBy;
                        review.ackCommitSha = entry.sha;
                    }
                }
            } else {
                state.reviews.push({
                    reviewerId: extractReviewerId(entry.body) || 'unknown',
                    summary: entry.summary,
                    submittedAt: entry.at,
                    commitSha: entry.sha,
                    ackedAt: null,
                    ackedBy: null,
                    ackNotes: null,
                });
            }
        }
        writeState(repoPath, entityType, entityId, state);
        backfilled++;
    }

    fs.mkdirSync(path.dirname(migrationMarkerPath(repoPath)), { recursive: true });
    fs.writeFileSync(migrationMarkerPath(repoPath), JSON.stringify({ migratedAt: new Date().toISOString(), backfilled }, null, 2) + '\n');
    return { migrated: true, backfilled };
}

module.exports = {
    readState,
    writeState,
    derivePending,
    recordSubmission,
    recordAck,
    isValidReviewerId,
    migrateFromGitHistory,
    hasMigrationRun,
    _internals: {
        entityDir,
        statePath,
        migrationMarkerPath,
        parseSpecReviewSubject,
        extractReviewerId,
        extractAckedBy,
    },
};
