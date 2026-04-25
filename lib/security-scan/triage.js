'use strict';

// Per-CWE confidence priors to compensate for known LLM over-confidence.
// Each entry: { match: fn(finding) => bool, multiplier }
// multiplier 0.0 = drop the finding entirely
const CWE_PRIORS = [
    {
        // React/JSX XSS without dangerouslySetInnerHTML
        label: 'react-jsx-xss-no-dangerous',
        match: (f) => /xss/i.test(f.category) && /jsx|react/i.test(f.message || '') && !/dangerouslySetInnerHTML/i.test(f.message || ''),
        multiplier: 0.5,
    },
    {
        // Path-only SSRF (no network call evidence)
        label: 'path-only-ssrf',
        match: (f) => /ssrf/i.test(f.category) && !/fetch|axios|http|request|url/i.test(f.message || ''),
        multiplier: 0.0,
    },
    {
        // Prototype pollution without demonstrated gadget
        label: 'proto-pollution-no-gadget',
        match: (f) => /prototype.pollution/i.test(f.category) && !/gadget|exploit|chain/i.test(f.message || ''),
        multiplier: 0.3,
    },
    {
        // SQLi via parameterised ORM (false positive)
        label: 'sqli-parameterised-orm',
        match: (f) => /sql.inject/i.test(f.category) && /sequelize|knex|prisma|typeorm|\.query\s*\(/i.test(f.message || ''),
        multiplier: 0.2,
    },
    {
        // Authz missing on endpoint adjacent to authz-checked sibling (boost, not penalise)
        label: 'authz-missing-adjacent',
        match: (f) => /authz|authoriz|access.control/i.test(f.category) && /adjacent|sibling/i.test(f.message || ''),
        multiplier: 1.2,
    },
];

const SEVERITY_RANK = { HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };

function applySuppression(findings, suppressions) {
    const suppressed = new Set(
        (suppressions || [])
            .filter(s => s.status === 'fp' || s.status === 'accepted_risk')
            .map(s => s.fingerprint)
    );
    return findings.filter(f => !suppressed.has(f.fingerprint));
}

function applyPriors(findings) {
    return findings
        .map(f => {
            let confidence = typeof f.confidence === 'number' ? f.confidence : 1.0;
            for (const prior of CWE_PRIORS) {
                if (prior.match(f)) {
                    confidence *= prior.multiplier;
                    break;
                }
            }
            return { ...f, confidence };
        })
        .filter(f => f.confidence > 0);
}

function rankAndCap(findings, cap = 10) {
    const ranked = [...findings].sort((a, b) => {
        const severityDiff = (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0);
        if (severityDiff !== 0) return severityDiff;
        return (b.confidence || 0) - (a.confidence || 0);
    });
    const top = ranked.slice(0, cap);
    const overflow = ranked.length - cap;
    return { top, overflow: overflow > 0 ? overflow : 0, total: ranked.length };
}

function triage(findings, suppressions) {
    const active = applySuppression(findings, suppressions);
    const adjusted = applyPriors(active);
    return rankAndCap(adjusted);
}

module.exports = { triage, applySuppression, applyPriors, rankAndCap };
