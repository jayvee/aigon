'use strict';

const fs = require('fs');
const crypto = require('crypto');
const { parseAcceptanceCriteria } = require('./validation');
const {
    findFeatureImplementationLog,
    readImplementationLogBody,
} = require('./review-escalation');

const ATTESTATION_LINE_RE = /^\s*(\d+)\.\s*(met|deferred|dropped)\s*[—–-]\s*(.+)$/i;
const EVIDENCE_CAP = 240;

function extractCriteriaAttestationSection(body) {
    const text = String(body || '');
    const sections = text.split(/^## /m);
    const match = sections.find((section, index) => index > 0 && /^Criteria Attestation\b/.test(section));
    if (!match) return '';
    return match.split(/^## /m)[0];
}

/**
 * Parse `## Criteria Attestation` lines: `1. met — evidence`.
 * @returns {Map<number, { index: number, status: string, evidence: string }>}
 */
function parseCriteriaAttestationLines(logBody) {
    const section = extractCriteriaAttestationSection(logBody);
    const map = new Map();
    if (!section) return map;
    const lines = section.split('\n');
    for (const line of lines) {
        const hit = line.match(ATTESTATION_LINE_RE);
        if (!hit) continue;
        const index = Number(hit[1]);
        if (!Number.isInteger(index) || index < 1) continue;
        const status = String(hit[2] || '').trim().toLowerCase();
        const evidence = String(hit[3] || '').trim();
        if (!evidence) continue;
        map.set(index, { index, status, evidence });
    }
    return map;
}

/**
 * Enumerate acceptance criteria with stable 1-based indices.
 * @param {string} specContent
 * @returns {{ index: number, text: string, checked: boolean, type: string }[]}
 */
function enumerateAcceptanceCriteria(specContent) {
    return parseAcceptanceCriteria(specContent).map((entry, i) => ({
        index: i + 1,
        text: entry.text,
        checked: entry.checked,
        type: entry.type,
    }));
}

function readSpecContent(specPath) {
    try {
        return fs.readFileSync(specPath, 'utf8');
    } catch (_) {
        return '';
    }
}

function capEvidence(value) {
    const text = String(value || '').trim();
    if (text.length <= EVIDENCE_CAP) return text;
    return `${text.slice(0, EVIDENCE_CAP - 1)}…`;
}

/**
 * Validate spec criteria against implementation-log attestations.
 * @returns {{
 *   ok: boolean,
 *   skipped: boolean,
 *   criteria: object[],
 *   attestations: Map<number, object>,
 *   unattested: number[],
 *   invalid: number[],
 *   counts: { total: number, met: number, deferred: number, dropped: number },
 *   log: object|null,
 * }}
 */
function validateCriteriaAttestation(specPath, repoPath, featureId, options = {}) {
    const specContent = readSpecContent(specPath);
    const criteria = enumerateAcceptanceCriteria(specContent);
    if (criteria.length === 0) {
        return {
            ok: true,
            skipped: true,
            criteria,
            attestations: new Map(),
            unattested: [],
            invalid: [],
            counts: { total: 0, met: 0, deferred: 0, dropped: 0 },
            log: null,
        };
    }

    const { log, body } = readImplementationLogBody(repoPath, featureId, options);
    if (!log) {
        return {
            ok: false,
            skipped: false,
            criteria,
            attestations: new Map(),
            unattested: criteria.map((c) => c.index),
            invalid: [],
            counts: { total: criteria.length, met: 0, deferred: 0, dropped: 0 },
            log: null,
            error: 'missing-log',
        };
    }

    const attestations = parseCriteriaAttestationLines(body);
    const unattested = [];
    const invalid = [];
    const counts = { total: criteria.length, met: 0, deferred: 0, dropped: 0 };

    for (const criterion of criteria) {
        const att = attestations.get(criterion.index);
        if (!att) {
            unattested.push(criterion.index);
            continue;
        }
        if (!['met', 'deferred', 'dropped'].includes(att.status)) {
            invalid.push(criterion.index);
            continue;
        }
        counts[att.status] += 1;
    }

    return {
        ok: unattested.length === 0 && invalid.length === 0,
        skipped: false,
        criteria,
        attestations,
        unattested,
        invalid,
        counts,
        log,
    };
}

function formatCriteriaAttestationFailureMessage(criteria, unattested, invalid) {
    const lines = [
        'Criteria attestation incomplete — every acceptance criterion needs a line in the implementation log:',
        '',
        '  ## Criteria Attestation',
        '  1. met — <test name, command, or commit sha>',
        '  2. deferred — <reason>',
        '  3. dropped — <spec revision reference>',
        '',
    ];
    if (unattested.length > 0) {
        lines.push(`Missing attestation for criterion index(es): ${unattested.join(', ')}`);
        for (const index of unattested) {
            const c = criteria.find((entry) => entry.index === index);
            const preview = c && c.text
                ? (c.text.length > 80 ? `${c.text.slice(0, 77)}…` : c.text)
                : '';
            if (preview) lines.push(`  ${index}. ${preview}`);
        }
        lines.push('');
    }
    if (invalid.length > 0) {
        lines.push(`Invalid attestation status for index(es): ${invalid.join(', ')} (use met, deferred, or dropped)`);
        lines.push('');
    }
    lines.push('Update the log as you complete criteria — do not wait until close.');
    lines.push('Emergency bypass: aigon feature-close <ID> --no-verify-criteria');
    return lines.join('\n');
}

function formatCriteriaAttestationWarning(unattested) {
    return `Unattested acceptance criteria (${unattested.join(', ')}) — will block feature-close until the log ## Criteria Attestation section is complete.`;
}

function stableCriteriaEscalationId(featureId, index) {
    const raw = `criteria-attestation:${String(featureId).padStart(2, '0')}:${index}`;
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

async function syncCriteriaDeferredEscalations(repoPath, featureId, validation, wf) {
    const deferred = [];
    for (const criterion of validation.criteria) {
        const att = validation.attestations.get(criterion.index);
        if (att && att.status === 'deferred') {
            deferred.push({ criterion, att });
        }
    }
    if (deferred.length === 0) {
        return { raised: 0, skipped: 0 };
    }

    const snapshot = await wf.showFeatureOrNull(repoPath, featureId);
    const known = new Set();
    const { getOpenEscalations } = require('./review-escalation');
    getOpenEscalations(snapshot).forEach((entry) => known.add(entry.escalationId));
    try {
        const events = await wf.listEvents(repoPath, featureId);
        for (const event of events) {
            if (event && event.escalationId) known.add(event.escalationId);
        }
    } catch (_) { /* best-effort */ }

    const logRel = validation.log ? validation.log.relPath : null;
    const events = [];
    let skipped = 0;
    const at = new Date().toISOString();

    for (const { criterion, att } of deferred) {
        const escalationId = stableCriteriaEscalationId(featureId, criterion.index);
        if (known.has(escalationId)) {
            skipped += 1;
            continue;
        }
        known.add(escalationId);
        events.push({
            type: 'review.escalation_raised',
            escalationId,
            category: 'spec-shortfall',
            reason: `Criterion ${criterion.index} deferred — ${att.evidence}`,
            reviewerAgentId: null,
            logPath: logRel,
            lineNumber: criterion.index,
            at,
            source: 'criteria-attestation',
        });
    }

    if (events.length > 0) {
        await wf.persistFeatureEscalationEvents(repoPath, featureId, events);
    }
    return { raised: events.length, skipped };
}

function buildCriteriaAttestationView(specPath, snapshot) {
    const specContent = readSpecContent(specPath);
    const criteria = enumerateAcceptanceCriteria(specContent);
    if (criteria.length === 0) return [];

    const attMap = new Map();
    const last = snapshot && snapshot.lastCriteriaAttestation;
    if (last && Array.isArray(last.criteria)) {
        for (const entry of last.criteria) {
            if (entry && entry.index != null) {
                attMap.set(Number(entry.index), entry);
            }
        }
    }

    return criteria.map((criterion) => {
        const att = attMap.get(criterion.index);
        return {
            index: criterion.index,
            text: criterion.text,
            status: att ? att.status : null,
            evidence: att ? att.evidence : null,
        };
    });
}

function buildCriteriaAttestedPayload(validation) {
    const criteria = [];
    for (const criterion of validation.criteria) {
        const att = validation.attestations.get(criterion.index);
        if (!att) continue;
        criteria.push({
            index: criterion.index,
            status: att.status,
            evidence: capEvidence(att.evidence),
        });
    }
    return {
        counts: { ...validation.counts },
        criteria,
    };
}

module.exports = {
    ATTESTATION_LINE_RE,
    EVIDENCE_CAP,
    extractCriteriaAttestationSection,
    parseCriteriaAttestationLines,
    enumerateAcceptanceCriteria,
    validateCriteriaAttestation,
    formatCriteriaAttestationFailureMessage,
    formatCriteriaAttestationWarning,
    stableCriteriaEscalationId,
    buildCriteriaAttestedPayload,
    buildCriteriaAttestationView,
    syncCriteriaDeferredEscalations,
    findFeatureImplementationLog,
};
