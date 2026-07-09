'use strict';

/**
 * F656: Pause semantics contract — operator park vs quota wait vs automation stop.
 * Read paths (dashboard labels, card headlines, CLI hints) use these helpers;
 * engine states are unchanged.
 */

const { getStateRenderMeta } = require('./state-render-meta');

/** @type {Readonly<Record<string, { kind: string, recovery: string, notes?: string }>>} */
const PAUSE_SIGNALS = Object.freeze({
    'currentSpecState:paused': {
        kind: 'operator-park',
        recovery: 'feature-resume / research-resume',
        notes: 'Pre-start (pauseReason prestart:inbox|backlog) or mid-run operator interrupt.',
    },
    'pauseReason:prestart:inbox': { kind: 'operator-park', recovery: 'feature-resume / research-resume' },
    'pauseReason:prestart:backlog': { kind: 'operator-park', recovery: 'feature-resume / research-resume' },
    'pauseReason:startup_failed': {
        kind: 'operator-park',
        recovery: 'feature-resume',
        notes: 'Start aborted; engine parked until operator resumes.',
    },
    'agent.status:quota-paused': {
        kind: 'quota-wait',
        recovery: 'agent-resume when quota probe allows',
        notes: 'Not operator pause — use agent-resume, not feature-pause.',
    },
    'feature-auto.status:quota-paused': {
        kind: 'quota-wait',
        recovery: 'wait for quota or feature-autonomous-resume',
    },
    'feature-auto.reason:review-quota-paused': {
        kind: 'quota-wait',
        recovery: 'rerun review / feature-autonomous-resume',
    },
    'feature-auto.status:stopped': {
        kind: 'automation-stopped',
        recovery: 'feature-autonomous-resume (reason-specific)',
    },
    'set-auto.status:paused-on-failure': {
        kind: 'automation-stopped',
        recovery: 'set-autonomous-resume',
    },
    'set-auto.status:paused-on-quota': {
        kind: 'quota-wait',
        recovery: 'set-autonomous-resume (choose agents)',
    },
});

/**
 * @returns {string}
 */
function resolveOperatorPauseLabel(pauseReason) {
    const reason = String(pauseReason || '').trim();
    const prestart = reason.match(/^prestart:(inbox|backlog)$/);
    if (prestart) return `Parked (${prestart[1]})`;
    if (reason.includes('startup_failed')) return 'Parked (start failed)';
    return 'Parked';
}

/**
 * @param {string} state
 * @param {{ pauseReason?: string|null }|null|undefined} snapshot
 */
function resolveStateRenderMeta(state, snapshot) {
    const base = getStateRenderMeta(state);
    if (state !== 'paused') return base;
    const label = resolveOperatorPauseLabel(snapshot && snapshot.pauseReason);
    return { ...base, label, badge: `○ ${label}` };
}

/**
 * @param {{ status?: string|null, running?: boolean, reasonCategory?: string|null, reasonLabel?: string|null }|null|undefined} autonomousController
 * @returns {{ tone: string, verb: string, detail: string|null }|null}
 */
function resolveAutonomousHeadline(autonomousController) {
    if (!autonomousController) return null;
    const status = String(autonomousController.status || '');
    if (autonomousController.running) return null;
    if (status === 'failed') return null;

    if (status === 'quota-paused' || autonomousController.reasonCategory === 'quota') {
        return {
            tone: 'warn',
            verb: 'Quota waiting',
            detail: autonomousController.reasonLabel || null,
        };
    }
    if (status === 'stopped') {
        return {
            tone: 'warn',
            verb: 'Automation stopped',
            detail: autonomousController.reasonLabel || null,
        };
    }
    return null;
}

/**
 * @param {'feature'|'research'} [entityType]
 */
function operatorPauseScopeHint(entityType) {
    const prefix = entityType === 'research' ? 'research' : 'feature';
    return (
        `Operator park only — not for quota waits (use agent-resume) or stopped automation ` +
        `(use ${prefix}-autonomous-resume or set-autonomous-resume).`
    );
}

function operatorPauseUsageLine(command) {
    return `Usage: aigon ${command} <id or name>\n   ${operatorPauseScopeHint(command.split('-')[0] === 'research' ? 'research' : 'feature')}`;
}

module.exports = {
    PAUSE_SIGNALS,
    resolveOperatorPauseLabel,
    resolveStateRenderMeta,
    resolveAutonomousHeadline,
    operatorPauseScopeHint,
    operatorPauseUsageLine,
};
