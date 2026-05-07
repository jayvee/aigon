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
    implement: 'Implement',
    review: 'Review',
    revision: 'Revision',
    eval: 'Eval',
    close: 'Close',
});

const DRIVE_STATUS_MAP = Object.freeze({
    'implementing':            { tone: 'running',   verb: 'Implementing',           subject: null },
    'reviewing':               { tone: 'running',   verb: 'Reviewing',              subject: null },
    // Two explicit "addressing review" statuses. They are NOT the same:
    //   - addressing-code-review: the implementer is acting on a code reviewer's
    //     feedback (accept/revert/modify). Written by:
    //       * lib/worktree.js:618 (revise task type — fresh session start)
    //       * lib/commands/feature.js:1041 (dashboard "Code Revise" button —
    //         injects prompt into existing implementer session)
    //   - addressing-spec-review: a spec checker is revising / verifying the
    //     spec based on spec review. Written by:
    //       * lib/worktree.js:615-616 (spec-revise / spec-check task types)
    //       * lib/workflow-read-model.js:822 (active-checker dashboard display)
    'addressing-code-review':  { tone: 'running',   verb: 'Addressing code review', subject: null },
    'addressing-spec-review':  { tone: 'running',   verb: 'Addressing spec review', subject: null },
    'spec-reviewing':          { tone: 'running',   verb: 'Spec reviewing',         subject: null },
    'evaluating':              { tone: 'running',   verb: 'Evaluating',             subject: null },
    'researching':             { tone: 'running',   verb: 'Researching',            subject: null },
    'submitted':               { tone: 'ready', verb: 'Implemented',     subject: null, detail: 'needs code review' },
    'review-complete':         { tone: 'ready', verb: 'Code reviewed',   subject: null, detail: 'apply or reject findings' },
    'spec-review-complete':    { tone: 'ready', verb: 'Spec reviewed',   subject: null, detail: 'apply or reject findings' },
    'revision-complete':       { tone: 'ready', verb: 'Revised',         subject: null, detail: 'needs code review' },
    'implementation-complete': { tone: 'ready', verb: 'Implemented',     subject: null, detail: null },
    'research-complete':       { tone: 'ready', verb: 'Research ready',  subject: null, detail: 'evaluate findings' },
    'waiting':                 { tone: 'waiting',   verb: 'Waiting',          subject: null,        detail: null },
    'error':                   { tone: 'warn',      verb: 'Error',            subject: null,        detail: null },
    'quota-paused':            { tone: 'warn',      verb: 'Quota paused',     subject: null,        detail: null },
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
        return makeHeadline('warn', 'Close failed', { detail: reason, age: ageSecondsFrom(at, now) });
    }
    if (entity && entity.specDrift) {
        return makeHeadline('warn', 'Spec drift', { detail: 'use Reconcile' });
    }
    if (currentSpecState === 'close_recovery_in_progress') {
        return makeHeadline('warn', 'Recovering close', {});
    }
    // missing engine snapshot past backlog
    const pastBacklog = lane && !['inbox', 'backlog', 'triaged', 'wont-fix', 'actionable'].includes(lane);
    if (!snapshot && pastBacklog && entityType !== 'feedback') {
        return makeHeadline('warn', 'No engine state', { detail: 'run aigon doctor --fix' });
    }

    // ── 2. Lane-terminal ───────────────────────────────────────────────────
    if (lane === 'done') {
        const closedAt = (snapshot && (snapshot.closedAt || snapshot.updatedAt))
            || (entity && entity.updatedAt) || null;
        return makeHeadline('done', 'Closed', { age: ageSecondsFrom(closedAt, now) });
    }
    if (lane === 'wont-fix') {
        return makeHeadline('done', "Won't fix", {});
    }

    // ── 3. Awaiting human input ────────────────────────────────────────────
    const awaitAgent = agents.find(a => a && a.awaitingInput && a.awaitingInput.message);
    if (awaitAgent) {
        return makeHeadline('attention', 'Needs you', {
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
            : (signal && (signal.label || signal.signal || signal.kind)) || 'signal';
        return makeHeadline('attention', `Confirm ${String(signalLabel).toLowerCase()}`, {
            owner: pendingAgent.id,
            detail: typeof signal === 'object' && signal && signal.message ? signal.message : null,
        });
    }

    // ── 5. Eval pick-winner ────────────────────────────────────────────────
    if (entity && entity.evalStatus === 'pick winner') {
        const winner = entity.winnerAgent || null;
        // 'Eval complete' (not 'Pick winner') — by this point the eval has
        // produced a recommendation. The user's job is to review and close
        // (which opens a Pick & Close modal where they can override the
        // winner and optionally cherry-pick changes from the loser).
        // Tone 'ready' (teal): positive next-step state, like 'Implemented'
        // or 'Closed'. 'attention' (orange) was wrong — implied something
        // is broken or warns the user; 'ready' correctly says "done, your
        // turn".
        return makeHeadline('ready', 'Eval complete', {
            detail: winner ? `recommended: ${winner}` : null,
        });
    }

    // ── 6. Lane = inbox ────────────────────────────────────────────────────
    if (lane === 'inbox') {
        if (entityType === 'feedback') {
            return makeHeadline('idle', 'Needs triage', {});
        }
        return null;
    }

    // ── 7. Lane = backlog ──────────────────────────────────────────────────
    if (lane === 'backlog') {
        const blocked = entity && Array.isArray(entity.blockedBy) && entity.blockedBy.length > 0;
        if (blocked) {
            return null;
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
            const rawLabel = STAGE_VERBS[running.type] || running.label || running.type || 'Run';
            const verbLabel = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1).toLowerCase();
            const ownerAgent = (running.agents && running.agents[0] && running.agents[0].id) || null;
            return makeHeadline('running', `Running · ${verbLabel.toLowerCase()}`, {
                owner: ownerAgent,
                age: ageSecondsFrom(running.startedAt, now),
                subject: running.label || null,
            });
        }
        const failed = stages.find(s => s.status === 'failed');
        if (failed) {
            const rawLabel = STAGE_VERBS[failed.type] || failed.label || failed.type || 'Stage';
            const verbLabel = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1).toLowerCase();
            return makeHeadline('warn', `${verbLabel} failed`, {});
        }
        // gate: a "waiting" stage where the immediately-preceding stage is complete
        const waitingIdx = stages.findIndex(s => s.status === 'waiting');
        if (waitingIdx > 0 && stages[waitingIdx - 1].status === 'complete') {
            const w = stages[waitingIdx];
            const rawLabel = STAGE_VERBS[w.type] || w.label || w.type || 'Stage';
            const verbLabel = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1).toLowerCase();
            const ownerAgent = (w.agents && w.agents[0] && w.agents[0].id) || null;
            return makeHeadline('waiting', `${verbLabel} gate`, { owner: ownerAgent });
        }
        if (stages.every(s => s.status === 'complete')) {
            return makeHeadline('ready', 'Ready to close', {});
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
            head = makeHeadline('attention', 'Finished (unconfirmed)', {
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
            head = makeHeadline('waiting', 'Idle', {
                owner: primary.id,
                age: typeof ladder.idleSec === 'number' ? ladder.idleSec : null,
            });
        }

        // fleet mode: "submitted" means awaiting eval, not code review
        if (head && head.detail === 'needs code review' && agents.filter(a => a).length > 1) {
            head = { ...head, detail: 'needs evaluation' };
        }

        if (head) return head;
    }

    // ── 11. Lifecycle fallback via STATE_RENDER_META ───────────────────────
    if (currentSpecState && STATE_RENDER_META[currentSpecState]) {
        const meta = STATE_RENDER_META[currentSpecState];
        const t = clsToTone(meta.cls);
        const raw = String(meta.label || currentSpecState);
        // Sentence case: first letter upper, rest lower (no all-caps verbs).
        const sentenceCased = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
        return makeHeadline(t, sentenceCased, {});
    }

    return makeHeadline('idle', 'Idle', {});
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
