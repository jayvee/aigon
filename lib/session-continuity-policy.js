'use strict';

const agentRegistry = require('./agent-registry');

function freshDecision(selectedAgent, reasons, originSession) {
    return {
        strategy: 'fresh-with-handoff',
        confidence: 'high',
        reasons: [...new Set(reasons)],
        selectedAgent: selectedAgent || null,
        parentOriginSessionId: originSession && originSession.aigonSessionId || null,
        fallback: null,
    };
}

function resolveContinuityPolicy(facts = {}) {
    const phase = facts.phase === 'spec-revise' ? 'spec-revise' : 'implementation';
    const selectedAgent = facts.selectedAgent || null;
    const authorAgentId = facts.authorAgentId || null;
    const origin = facts.originSession || null;
    const handoff = facts.authorHandoff || null;
    const reasons = [];
    if (!origin || !origin.authorAgentId) reasons.push('origin-unavailable');
    const handoffComplete = Boolean(handoff && handoff.status === 'valid'
        && Array.isArray(handoff.decisions) && handoff.decisions.length > 0
        && Array.isArray(handoff.specReferences) && handoff.specReferences.length > 0);
    if (!handoffComplete) reasons.push(handoff ? 'handoff-incomplete' : 'handoff-unavailable');
    else reasons.push('handoff-valid');
    if (!selectedAgent || !authorAgentId || selectedAgent !== authorAgentId) reasons.push('author-mismatch');

    const authorMatches = Boolean(selectedAgent && authorAgentId && selectedAgent === authorAgentId);
    const liveAddressable = Boolean(origin && origin.source === 'aigon-launched' && origin.addressable && facts.liveOriginSession);
    if (authorMatches && liveAddressable) {
        return {
            strategy: 'attach-live-origin',
            confidence: 'high',
            reasons: ['live-addressable-origin', phase === 'spec-revise' ? 'phase-prefers-author' : 'implementation-origin-healthy'],
            selectedAgent,
            parentOriginSessionId: origin.aigonSessionId,
            fallback: { strategy: 'fresh-with-handoff', reason: 'attach-failed' },
        };
    }
    if (origin && facts.liveOriginSession && origin.source === 'direct-agent-session') reasons.push('live-origin-unaddressable');

    const runtime = facts.adapter || (selectedAgent ? agentRegistry.getAgentRuntime(selectedAgent) : {});
    const capability = runtime && runtime.continuity || {};
    const nativeAvailable = Boolean(origin && origin.providerSessionId && origin.nativeProvenance === 'attributed');
    const captureTime = origin && Date.parse(origin.capturedAt || origin.createdAt || origin.captureStartedAt || '');
    const nowMs = facts.now instanceof Date ? facts.now.getTime() : Number(facts.now || Date.now());
    const maxCaptureAgeMs = Number(facts.maxCaptureAgeMs || 30 * 24 * 60 * 60 * 1000);
    const captureFresh = !Number.isFinite(captureTime) || (nowMs - captureTime) <= maxCaptureAgeMs;
    const healthy = captureFresh && !(facts.health && (facts.health.knownFailure || facts.health.compacted || facts.health.expired));
    const unresolvedImplementation = Boolean(handoff && Array.isArray(handoff.unresolvedQuestions) && handoff.unresolvedQuestions.length);
    const phaseEligible = phase === 'spec-revise' || unresolvedImplementation;
    if (!nativeAvailable) reasons.push('native-origin-unavailable');
    if (!capability.resumeById || capability.taskDelivery !== 'initial-argument') reasons.push('adapter-resume-unsupported');
    if (!healthy) reasons.push('origin-unhealthy');
    if (!captureFresh) reasons.push('origin-capture-stale');
    if (!phaseEligible) reasons.push('fresh-handoff-preferred-for-implementation');

    if (authorMatches && handoffComplete && nativeAvailable && capability.resumeById
        && capability.taskDelivery === 'initial-argument' && healthy && phaseEligible) {
        return {
            strategy: 'resume-origin',
            confidence: 'medium',
            reasons: [phase === 'spec-revise' ? 'phase-prefers-author' : 'implementation-decisions-unresolved', 'native-origin-attributed', 'adapter-resume-and-task-delivery-verified'],
            selectedAgent,
            parentOriginSessionId: origin.aigonSessionId || null,
            fallback: { strategy: 'fresh-with-handoff', reason: 'continuation-failed' },
        };
    }
    return freshDecision(selectedAgent, reasons, origin);
}

module.exports = { resolveContinuityPolicy };
