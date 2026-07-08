'use strict';

const { getOpenEscalations } = require('./review-escalation');

function buildEscalationDispositionCommand(subcommand, featureId, index) {
    const id = String(featureId || '').trim().padStart(2, '0');
    return `aigon feature-escalation ${subcommand} ${id} ${index}`;
}

function appendEscalationDashboardActions(featureId, snapshot, validActions) {
    const base = Array.isArray(validActions) ? validActions.slice() : [];
    const open = getOpenEscalations(snapshot);
    if (open.length === 0) return base;

    open.forEach((entry, index) => {
        const n = index + 1;
        const preview = String(entry.reason || '').trim();
        const short = preview.length > 48 ? `${preview.slice(0, 45)}…` : preview;
        const labelSuffix = short ? `: ${short}` : '';
        base.push({
            command: buildEscalationDispositionCommand('accept', featureId, n),
            label: `Accept escalation ${n}${labelSuffix}`,
            reason: `Record operator acceptance for [${entry.category}] escalation`,
            action: 'feature-escalation-accept',
            kind: 'feature-escalation-accept',
            mode: 'client',
            category: 'lifecycle',
            type: 'action',
            to: null,
            priority: 'high',
            requiresInput: 'escalationReason',
            metadata: {
                escalationIndex: n,
                escalationId: entry.escalationId,
                category: entry.category,
                subcommand: 'accept',
            },
            clientOnly: true,
        });
        base.push({
            command: buildEscalationDispositionCommand('follow-up', featureId, n),
            label: `Follow-up from escalation ${n}`,
            reason: 'Spin off a standalone inbox feature from this escalation',
            action: 'feature-escalation-follow-up',
            kind: 'feature-escalation-follow-up',
            mode: 'client',
            category: 'lifecycle',
            type: 'action',
            to: null,
            priority: 'high',
            requiresInput: 'escalationFollowUpName',
            metadata: {
                escalationIndex: n,
                escalationId: entry.escalationId,
                category: entry.category,
                subcommand: 'follow-up',
            },
            clientOnly: true,
        });
        base.push({
            command: buildEscalationDispositionCommand('reopen', featureId, n),
            label: `Reopen for revision (${n})`,
            reason: 'Send feature back through code revision for this escalation',
            action: 'feature-escalation-reopen',
            kind: 'feature-escalation-reopen',
            mode: 'client',
            category: 'lifecycle',
            type: 'action',
            to: null,
            priority: 'high',
            requiresInput: 'escalationReason',
            metadata: {
                escalationIndex: n,
                escalationId: entry.escalationId,
                category: entry.category,
                subcommand: 'reopen',
            },
            clientOnly: true,
        });
    });

    return base;
}

module.exports = {
    appendEscalationDashboardActions,
    buildEscalationDispositionCommand,
};
