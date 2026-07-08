'use strict';

const fs = require('fs');
const path = require('path');
const wf = require('./workflow-core');
const workflowSnapshotAdapter = require('./workflow-snapshot-adapter');
const { getOptionValue, slugify, parseCliOptions } = require('./cli-parse');
const { STAGE_FOLDERS } = require('./workflow-core/paths');
const {
    readImplementationLogBody,
    parseEscalationMarkers,
    stableEscalationId,
    resolveEscalationByIndex,
    formatEscalationCloseBlockMessage,
    getOpenEscalations,
} = require('./review-escalation');

function nowIso() {
    return new Date().toISOString();
}

async function listKnownEscalationIds(repoPath, featureId) {
    const snapshot = await wf.showFeatureOrNull(repoPath, featureId);
    const openIds = new Set(getOpenEscalations(snapshot).map((entry) => entry.escalationId));
    try {
        const events = workflowSnapshotAdapter.readWorkflowEventsSync(repoPath, 'feature', featureId) || [];
        for (const event of events) {
            if (event && event.escalationId) openIds.add(event.escalationId);
        }
    } catch (_) { /* best-effort */ }
    return openIds;
}

async function syncReviewEscalationsFromLog(repoPath, featureId, { reviewerAgentId = null, source = null } = {}) {
    const { log, body } = readImplementationLogBody(repoPath, featureId);
    if (!log || !body) return { raised: 0, skipped: 0 };

    const known = await listKnownEscalationIds(repoPath, featureId);
    const markers = parseEscalationMarkers(body);
    const events = [];
    let skipped = 0;

    for (const marker of markers) {
        const escalationId = stableEscalationId(log.relPath, marker.lineNumber, marker.category);
        if (known.has(escalationId)) {
            skipped += 1;
            continue;
        }
        known.add(escalationId);
        events.push({
            type: 'review.escalation_raised',
            escalationId,
            category: marker.category,
            reason: marker.reason,
            reviewerAgentId: reviewerAgentId || null,
            logPath: log.relPath,
            lineNumber: marker.lineNumber,
            at: nowIso(),
            source: source || 'review-escalation/sync',
        });
    }

    if (events.length > 0) {
        await wf.persistFeatureEscalationEvents(repoPath, featureId, events);
    }
    return { raised: events.length, skipped };
}

async function recordEscalationAccepted(repoPath, featureId, payload) {
    return wf.persistFeatureEscalationEvents(repoPath, featureId, [{
        type: 'review.escalation_accepted',
        escalationId: payload.escalationId,
        reason: payload.reason,
        at: payload.at || nowIso(),
        source: payload.source || 'feature-escalation/accept',
    }]);
}

async function recordEscalationSpunOff(repoPath, featureId, payload) {
    return wf.persistFeatureEscalationEvents(repoPath, featureId, [{
        type: 'review.escalation_spun_off',
        escalationId: payload.escalationId,
        followUpFeatureId: payload.followUpFeatureId,
        followUpSlug: payload.followUpSlug || null,
        reason: payload.reason || null,
        at: payload.at || nowIso(),
        source: payload.source || 'feature-escalation/follow-up',
    }]);
}

async function recordEscalationReopened(repoPath, featureId, payload) {
    return wf.persistFeatureEscalationEvents(repoPath, featureId, [{
        type: 'review.escalation_reopened',
        escalationId: payload.escalationId,
        reason: payload.reason,
        at: payload.at || nowIso(),
        source: payload.source || 'feature-escalation/reopen',
    }]);
}

function buildFollowUpSpecContent(name, escalation, sourceFeatureId) {
    const reason = String(escalation.reason || '').trim();
    return `---
complexity: medium
depends_on: [${Number(sourceFeatureId)}]
---

# Feature: ${name}

## Summary

Follow-up from review escalation on feature ${String(sourceFeatureId).padStart(2, '0')} (${escalation.category}):

${reason}

## User Stories
- [ ] As an operator, the follow-up work from the escalated review finding is tracked as its own feature.

## Acceptance Criteria
- [ ] The escalation reason is addressed or explicitly superseded.

## Validation

\`\`\`bash
npm run test:iterate
\`\`\`

## Pre-authorised
`;
}

async function createFollowUpFeature(repoPath, sourceFeatureId, escalation, slugInput) {
    const slug = slugify(slugInput || `escalation-${escalation.category}-from-${sourceFeatureId}`);
    const inboxDir = path.join(repoPath, 'docs', 'specs', 'features', STAGE_FOLDERS.INBOX);
    const filename = `feature-${slug}.md`;
    const filePath = path.join(inboxDir, filename);
    if (fs.existsSync(filePath)) {
        throw new Error(`Follow-up feature already exists: ${filename}`);
    }
    fs.mkdirSync(inboxDir, { recursive: true });
    const displayName = slug.replace(/-/g, ' ');
    fs.writeFileSync(filePath, buildFollowUpSpecContent(displayName, escalation, sourceFeatureId));
    wf.ensureEntityBootstrappedSync(repoPath, 'feature', slug, 'inbox', filePath);
    const nextId = slug;
    return { slug, filePath, featureId: nextId };
}

async function runEscalationCommand(args, deps = {}) {
    const parsed = parseCliOptions(args);
    const positional = parsed._;
    const sub = String(positional[0] || '').trim().toLowerCase();
    const featureId = positional[1];
    const index = positional[2];
    if (!sub || !featureId || !index) {
        console.error('Usage: aigon feature-escalation <accept|follow-up|reopen> <ID> <n> [--reason "..."] [--name <slug>]');
        process.exitCode = 1;
        return;
    }

    const repoPath = deps.repoPath || process.cwd();
    const padded = String(featureId).trim().padStart(2, '0');
    const snapshot = await wf.showFeatureOrNull(repoPath, padded);
    if (!snapshot) {
        console.error(`❌ Feature ${padded} has no workflow snapshot. Run aigon doctor --fix.`);
        process.exitCode = 1;
        return;
    }

    const escalation = resolveEscalationByIndex(snapshot, index);
    if (!escalation) {
        console.error(`❌ No open escalation #${index} on feature ${padded}.`);
        const open = getOpenEscalations(snapshot);
        if (open.length > 0) {
            console.error(formatEscalationCloseBlockMessage(padded, open));
        }
        process.exitCode = 1;
        return;
    }

    const reason = getOptionValue(parsed, 'reason') || getOptionValue(parsed, 'r');
    const name = getOptionValue(parsed, 'name');

    if (sub === 'accept') {
        if (!reason || !String(reason).trim()) {
            console.error('❌ --reason is required for accept (audit trail).');
            process.exitCode = 1;
            return;
        }
        await recordEscalationAccepted(repoPath, padded, {
            escalationId: escalation.escalationId,
            reason: String(reason).trim(),
        });
        console.log(`✅ Escalation accepted for feature ${padded} (#${index}). Close may proceed when no escalations remain open.`);
        return;
    }

    if (sub === 'follow-up') {
        if (!name || !String(name).trim()) {
            console.error('❌ --name <slug> is required for follow-up.');
            process.exitCode = 1;
            return;
        }
        const created = await createFollowUpFeature(repoPath, padded, escalation, name);
        await recordEscalationSpunOff(repoPath, padded, {
            escalationId: escalation.escalationId,
            followUpFeatureId: created.slug,
            followUpSlug: created.slug,
            reason: escalation.reason,
        });
        console.log(`✅ Follow-up feature created: ${created.slug}`);
        console.log(`   Spec: ./${path.relative(repoPath, created.filePath)}`);
        return;
    }

    if (sub === 'reopen') {
        if (!reason || !String(reason).trim()) {
            console.error('❌ --reason is required for reopen (audit trail).');
            process.exitCode = 1;
            return;
        }
        await recordEscalationReopened(repoPath, padded, {
            escalationId: escalation.escalationId,
            reason: String(reason).trim(),
        });
        const agentIds = Object.keys(snapshot.agents || {});
        const revisionAgentId = snapshot.mode === 'fleet'
            ? (snapshot.winnerAgentId || snapshot.authorAgentId || agentIds[0])
            : (agentIds[0] || snapshot.authorAgentId);
        if (revisionAgentId) {
            await wf.recordCodeRevisionStarted(repoPath, 'feature', padded, {
                revisionAgentId,
                source: 'feature-escalation/reopen',
            });
        }
        console.log(`✅ Escalation reopened for feature ${padded} (#${index}) — code revision cycle started.`);
        return;
    }

    console.error(`❌ Unknown subcommand: ${sub}`);
    process.exitCode = 1;
}

async function runEscalationCloseGuard(repoPath, featureId) {
    const snapshot = await wf.showFeatureOrNull(repoPath, featureId);
    const open = getOpenEscalations(snapshot);
    if (open.length === 0) return { ok: true };
    const message = formatEscalationCloseBlockMessage(featureId, open);
    console.error(`❌ ${message}`);
    return { ok: false, open };
}

module.exports = {
    syncReviewEscalationsFromLog,
    recordEscalationAccepted,
    recordEscalationSpunOff,
    recordEscalationReopened,
    runEscalationCommand,
    runEscalationCloseGuard,
    buildFollowUpSpecContent,
};
