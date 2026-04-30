'use strict';

/**
 * Pure computation of a single headline banner per kanban card.
 * No I/O. Walks precedence rules and returns the first match.
 *
 * Returns shape:
 *   { tone, glyph, verb, subject, owner, age, detail }
 * where age is seconds since the relevant timestamp, or null when unknown.
 */

const { getStateRenderMeta, STATE_RENDER_META } = require('./state-render-meta');

const GLYPH = Object.freeze({
    running: '▶',     // ▶
    waiting: '◐',     // ◐
    attention: '◐',
    blocked: '⚠',     // ⚠
    warn: '⚠',
    ready: '✓',       // ✓
    done: '✓',
    idle: '○',        // ○
});

const STAGE_VERBS = Object.freeze({
    implement: 'IMPLEMENT',
    review: 'REVIEW',
    revision: 'REVISION',
    eval: 'EVAL',
    close: 'CLOSE',
});

const DRIVE_STATUS_MAP = Object.freeze({
    'implementing':            { tone: 'running',   verb: 'RUNNING',          subject: 'Implement' },
    'reviewing':               { tone: 'running',   verb: 'RUNNING',          subject: 'Review' },
    'spec-reviewing':          { tone: 'running',   verb: 'RUNNING',          subject: 'Spec review' },
    'evaluating':              { tone: 'running',   verb: 'RUNNING',          subject: 'Eval' },
    'researching':             { tone: 'running',   verb: 'RUNNING',          subject: 'Research' },
    'submitted':               { tone: 'attention', verb: 'SUBMITTED',        subject: null,        detail: 'awaiting review' },
    'review-complete':         { tone: 'attention', verb: 'REVIEW DONE',      subject: null,        detail: 'apply or reject' },
    'spec-review-complete':    { tone: 'attention', verb: 'SPEC REVIEW DONE', subject: null,        detail: 'apply or reject' },
    'revision-complete':       { tone: 'attention', verb: 'REVISION DONE',    subject: null,        detail: null },
    'implementation-complete': { tone: 'attention', verb: 'COMPLETE',         subject: null,        detail: null },
    'research-complete':       { tone: 'attention', verb: 'RESEARCH DONE',    subject: null,        detail: null },
    'waiting':                 { tone: 'waiting',   verb: 'WAITING',          subject: null,        detail: null },
    'error':                   { tone: 'warn',      verb: 'ERROR',            subject: null,        detail: null },
    'quota-paused':            { tone: 'warn',      verb: 'QUOTA PAUSED',     subject: null,        detail: null },
});

function ageSecondsFrom(iso, now) {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return null;
    const ref = now != null ? now : Date.now();
    return Math.max(0, Math.floor((ref - t) / 1000));
}

function tone(t) { return { tone: t, glyph: GLYPH[t] || '○' }; }

function makeHeadline(t, verb, opts) {
    const o = opts || {};
    return {
        ...tone(t),
        verb,
        subject: o.subject || null,
        owner: o.owner || null,
        age: (o.age == null) ? null : o.age,
        detail: o.detail || null,
    };
}

/**
 * @param {object} entity   feature/research/feedback row from collector
 * @param {object} snapshot workflow snapshot (entity.workflowSnapshot or null)
 * @param {Array}  agents   entity.agents (already enriched)
 * @param {object} autonomousPlan entity.autonomousPlan or null
 * @param {string} lane     'inbox' | 'backlog' | 'in-progress' | 'in-evaluation' | 'done' | 'paused'
 *                          | feedback lane like 'triaged' | 'wont-fix' | 'actionable'
 * @param {object} [options] { entityType, now }
 */
function computeCardHeadline(entity, snapshot, agents, autonomousPlan, lane, options) {
    const opts = options || {};
    const entityType = opts.entityType
        || (entity && entity.entityType)
        || 'feature';
    const now = opts.now;
    agents = Array.isArray(agents) ? agents : [];
    snapshot = snapshot || (entity && entity.workflowSnapshot) || null;
    autonomousPlan = autonomousPlan || (entity && entity.autonomousPlan) || null;
    const currentSpecState = snapshot ? (snapshot.currentSpecState || snapshot.lifecycle) : null;

    // ── 1. Warn-class — supersedes everything ──────────────────────────────
    if (entity && entity.lastCloseFailure) {
        const reason = entity.lastCloseFailure.reason || entity.lastCloseFailure.message || null;
        const at = entity.lastCloseFailure.at || entity.lastCloseFailure.failedAt || null;
        return makeHeadline('warn', 'CLOSE FAILED', { detail: reason, age: ageSecondsFrom(at, now) });
    }
    if (entity && entity.rebaseNeeded) {
        return makeHeadline('warn', 'REBASE NEEDED', { detail: 'rebase before close' });
    }
    if (entity && entity.specDrift) {
        return makeHeadline('warn', 'SPEC DRIFT', { detail: 'use Reconcile' });
    }
    if (currentSpecState === 'close_recovery_in_progress') {
        return makeHeadline('warn', 'RECOVERING CLOSE', {});
    }
    // missing engine snapshot past backlog
    const pastBacklog = lane && !['inbox', 'backlog', 'triaged', 'wont-fix', 'actionable'].includes(lane);
    if (!snapshot && pastBacklog && entityType !== 'feedback') {
        return makeHeadline('warn', 'NO ENGINE STATE', { detail: 'run aigon doctor --fix' });
    }

    // ── 2. Lane-terminal ───────────────────────────────────────────────────
    if (lane === 'done') {
        const closedAt = (snapshot && (snapshot.closedAt || snapshot.updatedAt))
            || (entity && entity.updatedAt) || null;
        return makeHeadline('done', 'DONE', { age: ageSecondsFrom(closedAt, now) });
    }
    if (lane === 'wont-fix') {
        return makeHeadline('done', "WON'T FIX", {});
    }

    // ── 3. Awaiting human input ────────────────────────────────────────────
    const awaitAgent = agents.find(a => a && a.awaitingInput && a.awaitingInput.message);
    if (awaitAgent) {
        return makeHeadline('attention', 'NEEDS YOU', {
            owner: awaitAgent.id,
            detail: awaitAgent.awaitingInput.message,
        });
    }

    // ── 4. Pending manual confirmation ─────────────────────────────────────
    const pendingAgent = agents.find(a => a && a.pendingCompletionSignal && !a.isWorking);
    if (pendingAgent) {
        const signal = pendingAgent.pendingCompletionSignal;
        const signalLabel = (typeof signal === 'string')
            ? signal
            : (signal && (signal.label || signal.signal || signal.kind)) || 'SIGNAL';
        return makeHeadline('attention', `CONFIRM ${String(signalLabel).toUpperCase()}`, {
            owner: pendingAgent.id,
            detail: typeof signal === 'object' && signal && signal.message ? signal.message : null,
        });
    }

    // ── 5. Eval pick-winner ────────────────────────────────────────────────
    if (entity && entity.evalStatus === 'pick winner') {
        const winner = entity.winnerAgent || null;
        return makeHeadline('attention', 'PICK WINNER', {
            detail: winner ? `recommended: ${winner}` : null,
        });
    }

    // ── 6. Lane = inbox ────────────────────────────────────────────────────
    if (lane === 'inbox') {
        if (entityType === 'feedback') {
            return makeHeadline('idle', 'NEEDS TRIAGE', {});
        }
        return null;
    }

    // ── 7. Lane = backlog ──────────────────────────────────────────────────
    if (lane === 'backlog') {
        const blocked = entity && Array.isArray(entity.blockedBy) && entity.blockedBy.length > 0;
        if (blocked) {
            const ids = entity.blockedBy.map(b => `#${b.id}`).join(', ');
            return makeHeadline('blocked', 'BLOCKED', { detail: `waiting on ${ids}` });
        }
        return null;
    }

    // ── 8/10. In-progress (or in-evaluation) with autonomous stage plan ────
    const stages = (autonomousPlan && Array.isArray(autonomousPlan.stages))
        ? autonomousPlan.stages
        : [];
    if (stages.length > 0 && (lane === 'in-progress' || lane === 'in-evaluation')) {
        const running = stages.find(s => s.status === 'running');
        if (running) {
            const verbLabel = STAGE_VERBS[running.type] || (running.label || running.type || 'RUN').toUpperCase();
            const ownerAgent = (running.agents && running.agents[0] && running.agents[0].id) || null;
            return makeHeadline('running', `RUNNING · ${verbLabel}`, {
                owner: ownerAgent,
                age: ageSecondsFrom(running.startedAt, now),
                subject: running.label || null,
            });
        }
        const failed = stages.find(s => s.status === 'failed');
        if (failed) {
            const verbLabel = STAGE_VERBS[failed.type] || (failed.label || failed.type || 'STAGE').toUpperCase();
            return makeHeadline('warn', `${verbLabel} FAILED`, {});
        }
        // gate: a "waiting" stage where the immediately-preceding stage is complete
        const waitingIdx = stages.findIndex(s => s.status === 'waiting');
        if (waitingIdx > 0 && stages[waitingIdx - 1].status === 'complete') {
            const w = stages[waitingIdx];
            const verbLabel = STAGE_VERBS[w.type] || (w.label || w.type || 'STAGE').toUpperCase();
            const ownerAgent = (w.agents && w.agents[0] && w.agents[0].id) || null;
            return makeHeadline('waiting', `${verbLabel} GATE`, { owner: ownerAgent });
        }
        if (stages.every(s => s.status === 'complete')) {
            return makeHeadline('ready', 'READY TO CLOSE', {});
        }
        // fall through to drive/lifecycle handling
    }

    // ── 9. Drive/solo in-progress (no autonomous plan, single agent) ───────
    if (lane === 'in-progress' && agents.length > 0) {
        // find primary agent — prefer one currently working
        const primary = agents.find(a => a && a.isWorking) || agents[0];
        const status = primary && primary.status;
        const mapped = status ? DRIVE_STATUS_MAP[status] : null;
        let head = mapped
            ? makeHeadline(mapped.tone, mapped.verb, {
                  subject: mapped.subject,
                  owner: primary.id,
                  detail: mapped.detail || null,
                  age: ageSecondsFrom(primary.statusChangedAt || primary.updatedAt, now),
              })
            : null;

        // sessionEnded while implementing → FINISHED (UNCONFIRMED)
        const flags = (primary && primary.flags) || {};
        if (flags.sessionEnded && status === 'implementing') {
            head = makeHeadline('attention', 'FINISHED (UNCONFIRMED)', {
                owner: primary.id,
                detail: 'confirm to proceed',
            });
        }

        // idle ladder layering
        const ladder = primary && primary.idleLadder;
        if (ladder && ladder.state === 'needs-attention' && head) {
            head = {
                ...head,
                tone: 'attention',
                glyph: GLYPH.attention,
                detail: head.detail ? `${head.detail} · agent silent` : 'agent silent',
            };
        } else if (ladder && ladder.state === 'idle' && (!status || !DRIVE_STATUS_MAP[status] || DRIVE_STATUS_MAP[status].tone !== 'running')) {
            head = makeHeadline('waiting', 'IDLE', {
                owner: primary.id,
                age: typeof ladder.idleSec === 'number' ? ladder.idleSec : null,
            });
        }

        if (head) return head;
    }

    // ── 11. Lifecycle fallback via STATE_RENDER_META ───────────────────────
    if (currentSpecState && STATE_RENDER_META[currentSpecState]) {
        const meta = STATE_RENDER_META[currentSpecState];
        const t = clsToTone(meta.cls);
        return makeHeadline(t, String(meta.label || currentSpecState).toUpperCase(), {});
    }

    return makeHeadline('idle', 'IDLE', {});
}

function clsToTone(cls) {
    switch (cls) {
        case 'status-running':     return 'running';
        case 'status-reviewing':   return 'waiting';
        case 'status-review-done': return 'ready';
        case 'status-submitted':   return 'ready';
        case 'status-blocked':     return 'blocked';
        case 'status-idle':
        default:                   return 'idle';
    }
}

module.exports = {
    computeCardHeadline,
    GLYPH,
    // exported for tests / fallback
    clsToTone,
};
