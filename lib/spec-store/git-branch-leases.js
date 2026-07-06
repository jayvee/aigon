'use strict';

/**
 * git-branch CAS lease strategy (F610).
 *
 * On the git-branch backend a lease is *authoritative mutual exclusion*, not an
 * advisory event. The current lease per spec key lives in `leases/<KEY>.json`
 * (a roles map) on the state branch and is written only via fast-forward-only
 * push — a compare-and-swap. The remote accepts exactly one writer per race; the
 * loser's rejected push is the conflict signal, delivered before any worktree is
 * created. Lease *history* is still appended to `specs/<KEY>/events.jsonl` in the
 * same commit as an audit trail, but the file — not the derived events — is the
 * authority on this backend.
 *
 * This factory supplies the same five-method surface as `createLeaseApi`
 * (`readLeases`, `acquireLease`, `renewLease`, `releaseLease`,
 * `assertLeaseAllowed`) so the backend swap is transparent to callers.
 */

const {
  DEFAULT_LEASE_TTL_MS,
  DEFAULT_RENEW_INTERVAL_MS,
  LeaseConflictError,
  LeaseUnavailableError,
  refToLeaseKey,
  resolveHolderId,
  resolveLeaseUser,
  buildLeaseEvent,
  computeExpiresAt,
  shouldRenewCheckpoint,
  leasesPathForKey,
  parseLeaseFile,
  serializeLeaseFile,
  isLeaseRecordExpired,
} = require('./leases');
const { getEventId } = require('./event-merge');

/** Bounded retries when a rejected push was caused by an *unrelated* change. */
const MAX_LEASE_CAS_RETRIES = 3;

function sleepJitter(attempt) {
  const base = 40 * attempt;
  const jitter = Math.floor(Math.random() * 60);
  return new Promise((resolve) => setTimeout(resolve, base + jitter));
}

/** A rejected FF-only push (someone else advanced the branch) vs a network fault. */
function isNonFastForward(error) {
  return /non-fast-forward|fetch first|\[rejected\]|failed to push|cannot lock ref|stale info|would clobber/i
    .test((error && error.message) || '');
}

/**
 * @param {object} ctx primitives supplied by the git-branch backend
 * @returns {{ readLeases, acquireLease, renewLease, releaseLease, assertLeaseAllowed, readLeaseEvents }}
 */
function createGitBranchLeaseApi(ctx) {
  const {
    repoPath,
    remote,
    offline,
    branchRef,
    trackingRef,
    commitSha,
    readFileFromCommit,
    treeBlobSha,
    readEventsFromCommit,
    serializeEventsJsonl,
    commitUpdates,
    mergeRemote,
    fetchStateBranch,
    pushStateBranch,
    resetBranchTo,
    rebuildProjectionForKey,
    advanceTrackingRefToTip,
    writeSyncState,
    eventsPathForKey,
    readCanonicalEvents,
  } = ctx;

  function conflictMessage(record, role, key) {
    return `Active ${role} lease on ${key} held by ${record.holderId} `
      + `(user ${record.user || 'unknown'}, agent ${record.agentId || 'unknown'}) until ${record.expiresAt}. `
      + 'Use --takeover to record an auditable takeover.';
  }

  /** Normalize a file record to the derived-lease shape callers expect. */
  function toActive(record, key, role) {
    return {
      key,
      role,
      holderId: record.holderId,
      user: record.user || null,
      agentId: record.agentId || null,
      acquiredAt: record.acquiredAt,
      expiresAt: record.expiresAt,
      renewCount: record.renewCount || 0,
      lastEventType: record.lastEventType || 'lease.acquired',
      priorHolderId: record.priorHolderId || null,
      expired: isLeaseRecordExpired(record),
    };
  }

  function resolveOpts(ref, options) {
    return {
      key: refToLeaseKey(ref),
      role: options.role || 'impl',
      holderId: options.holderId || resolveHolderId(),
      agentId: options.agentId || process.env.AIGON_AGENT_ID || null,
      user: options.user || resolveLeaseUser(repoPath),
      ttlMs: options.ttlMs || DEFAULT_LEASE_TTL_MS,
      renewIntervalMs: options.renewIntervalMs || DEFAULT_RENEW_INTERVAL_MS,
      takeover: Boolean(options.takeover),
      force: Boolean(options.force),
    };
  }

  /**
   * Run one compare-and-swap transition against the branch. `decide(map)` reads
   * the current roles map from the freshly fetched tip and returns either
   * `{ noop: true, result }` (nothing to write) or
   * `{ holderId, nextMap, event, result }` (write lease file + audit event in
   * one commit, then FF-only push). A blocking decision throws LeaseConflictError.
   */
  async function casTransition({ key, role, decide }) {
    for (let attempt = 1; attempt <= MAX_LEASE_CAS_RETRIES; attempt += 1) {
      // Claiming is online-mandatory: the fetch is the first CAS half.
      try {
        fetchStateBranch();
      } catch (error) {
        throw new LeaseUnavailableError(
          `Cannot reach remote (${remote}) to coordinate the ${role} lease on ${key}: ${error.message}. `
          + 'Claiming a lease requires reaching the remote — a lock you can take offline is not a lock.',
          remote,
        );
      }
      await mergeRemote({ key });

      const baseTip = commitSha(branchRef);
      const leasesPath = leasesPathForKey(key);
      const map = parseLeaseFile(readFileFromCommit(baseTip, leasesPath));

      const decision = decide(map, baseTip);
      if (decision.noop) return decision.result;

      const events = readEventsFromCommit(baseTip, key);
      const eventId = getEventId(decision.event);
      const nextEvents = events.some((e) => getEventId(e) === eventId)
        ? events
        : [...events, decision.event];
      const updates = {
        [leasesPath]: serializeLeaseFile(decision.nextMap),
        [eventsPathForKey(key)]: serializeEventsJsonl(nextEvents),
      };
      commitUpdates(updates, [], `aigon-specstore: ${key} lease ${role} ${decision.result.action}`);

      try {
        pushStateBranch();
        advanceTrackingRefToTip();
        await rebuildProjectionForKey(key, nextEvents);
        writeSyncState({ lastSyncAt: new Date().toISOString(), lastError: null });
        return decision.result;
      } catch (pushError) {
        if (!isNonFastForward(pushError)) {
          throw new LeaseUnavailableError(
            `Failed to publish the ${role} lease on ${key} to remote (${remote}): ${pushError.message}.`,
            remote,
          );
        }
        // Rejected FF-only push: re-fetch and classify against the new tip.
        try {
          fetchStateBranch();
        } catch (fetchError) {
          throw new LeaseUnavailableError(
            `Lost remote (${remote}) while claiming the ${role} lease on ${key}: ${fetchError.message}.`,
            remote,
          );
        }
        const newRemoteTip = commitSha(trackingRef);
        const oldBlob = treeBlobSha(baseTip, leasesPath);
        const newBlob = treeBlobSha(newRemoteTip, leasesPath);
        if (newRemoteTip) resetBranchTo(newRemoteTip);

        if (newBlob !== oldBlob) {
          // The lease file itself moved — did we lose the race for this role?
          const winner = parseLeaseFile(readFileFromCommit(newRemoteTip, leasesPath))[role];
          if (winner && !isLeaseRecordExpired(winner) && winner.holderId !== decision.holderId) {
            throw new LeaseConflictError(conflictMessage(winner, role, key), toActive(winner, key, role));
          }
          // Lease file changed but not blocking (released/expired) — retry fresh.
        }
        // else: only unrelated paths moved (e.g. an events push) — retry rebuild.
        if (attempt < MAX_LEASE_CAS_RETRIES) await sleepJitter(attempt);
      }
    }
    const error = new Error(
      `Lease CAS on ${key}/${role} exhausted ${MAX_LEASE_CAS_RETRIES} attempts against remote (${remote}) `
      + 'due to concurrent pushes. Retry the command.',
    );
    error.name = 'LeaseRetryExhaustedError';
    error.retryable = true;
    throw error;
  }

  function buildAcquireDecision(map, opts, takingOver) {
    const acquiredAt = new Date().toISOString();
    const prior = takingOver ? map[opts.role] : null;
    const record = {
      holderId: opts.holderId,
      user: opts.user,
      agentId: opts.agentId,
      acquiredAt,
      expiresAt: computeExpiresAt(opts.ttlMs),
      renewCount: 0,
      lastEventType: takingOver ? 'lease.taken_over' : 'lease.acquired',
    };
    if (takingOver && prior) {
      record.priorHolderId = prior.holderId;
      record.priorAgentId = prior.agentId || null;
    }
    const event = buildLeaseEvent(record.lastEventType, {
      key: opts.key,
      role: opts.role,
      holderId: opts.holderId,
      user: opts.user,
      agentId: opts.agentId,
      acquiredAt,
      expiresAt: record.expiresAt,
      renewCount: 0,
      priorHolderId: record.priorHolderId,
      priorAgentId: record.priorAgentId,
    });
    return {
      holderId: opts.holderId,
      nextMap: { ...map, [opts.role]: record },
      event,
      result: { ok: true, action: takingOver ? 'taken_over' : 'acquired', expiresAt: record.expiresAt },
    };
  }

  function buildRenewDecision(map, opts, existing) {
    if (!shouldRenewCheckpoint(toActive(existing, opts.key, opts.role), opts.renewIntervalMs)) {
      return { noop: true, result: { ok: true, action: 'skipped', expiresAt: existing.expiresAt } };
    }
    const renewCount = (existing.renewCount || 0) + 1;
    const record = {
      ...existing,
      user: opts.user || existing.user || null,
      agentId: opts.agentId || existing.agentId || null,
      expiresAt: computeExpiresAt(opts.ttlMs),
      renewCount,
      lastEventType: 'lease.renewed',
    };
    const event = buildLeaseEvent('lease.renewed', {
      key: opts.key,
      role: opts.role,
      holderId: opts.holderId,
      user: record.user,
      agentId: record.agentId,
      acquiredAt: existing.acquiredAt,
      expiresAt: record.expiresAt,
      renewCount,
    });
    return {
      holderId: opts.holderId,
      nextMap: { ...map, [opts.role]: record },
      event,
      result: { ok: true, action: 'renewed', expiresAt: record.expiresAt, renewCount },
    };
  }

  async function readLeases(ref) {
    const key = refToLeaseKey(ref);
    const map = parseLeaseFile(readFileFromCommit(commitSha(branchRef), leasesPathForKey(key)));
    const out = {};
    for (const [role, record] of Object.entries(map)) {
      out[role] = toActive(record, key, role);
    }
    return out;
  }

  async function acquireLease(ref, options = {}) {
    const opts = resolveOpts(ref, options);
    if (offline) {
      throw new LeaseUnavailableError(
        `Refusing to claim the ${opts.role} lease on ${opts.key} while offline — claiming requires reaching remote (${remote}).`,
        remote,
      );
    }
    return casTransition({
      key: opts.key,
      role: opts.role,
      decide: (map) => {
        const existing = map[opts.role];
        const held = existing && !isLeaseRecordExpired(existing);
        if (held && existing.holderId !== opts.holderId) {
          if (!opts.takeover) {
            throw new LeaseConflictError(conflictMessage(existing, opts.role, opts.key), toActive(existing, opts.key, opts.role));
          }
          return buildAcquireDecision(map, opts, true);
        }
        if (held && existing.holderId === opts.holderId) {
          return buildRenewDecision(map, opts, existing);
        }
        return buildAcquireDecision(map, opts, false);
      },
    });
  }

  async function renewLease(ref, options = {}) {
    const opts = resolveOpts(ref, options);
    if (offline) {
      return { ok: true, action: 'skipped', warning: `Offline: ${opts.role} lease on ${opts.key} not renewed remotely (still valid within TTL).` };
    }
    try {
      return await casTransition({
        key: opts.key,
        role: opts.role,
        decide: (map) => {
          const existing = map[opts.role];
          if (!existing || isLeaseRecordExpired(existing)) {
            return buildAcquireDecision(map, opts, false);
          }
          if (existing.holderId !== opts.holderId && !opts.takeover) {
            throw new LeaseConflictError(conflictMessage(existing, opts.role, opts.key), toActive(existing, opts.key, opts.role));
          }
          if (existing.holderId !== opts.holderId && opts.takeover) {
            return buildAcquireDecision(map, opts, true);
          }
          return buildRenewDecision(map, opts, existing);
        },
      });
    } catch (error) {
      if (error instanceof LeaseConflictError) throw error;
      if (error instanceof LeaseUnavailableError || error.name === 'LeaseRetryExhaustedError') {
        // Network hiccup during renew is a warning, not a stop: TTL still covers us.
        return { ok: true, action: 'skipped', warning: `Could not reach remote (${remote}) to renew ${opts.role} lease on ${opts.key}; lease still valid within TTL. (${error.message})` };
      }
      throw error;
    }
  }

  async function releaseLease(ref, options = {}) {
    const opts = resolveOpts(ref, options);
    if (offline) {
      return { ok: true, action: 'offline', warning: `Offline: ${opts.role} lease on ${opts.key} not released remotely; TTL will expire it.` };
    }
    try {
      return await casTransition({
        key: opts.key,
        role: opts.role,
        decide: (map) => {
          const existing = map[opts.role];
          if (!existing || isLeaseRecordExpired(existing)) {
            return { noop: true, result: { ok: true, action: 'none' } };
          }
          if (existing.holderId !== opts.holderId && !opts.force) {
            return { noop: true, result: { ok: false, action: 'not_holder' } };
          }
          const nextMap = { ...map };
          delete nextMap[opts.role];
          const event = buildLeaseEvent('lease.released', {
            key: opts.key,
            role: opts.role,
            holderId: existing.holderId,
            user: opts.user || existing.user,
            agentId: opts.agentId || existing.agentId,
            acquiredAt: existing.acquiredAt,
            expiresAt: existing.expiresAt,
            renewCount: existing.renewCount || 0,
          });
          return { holderId: existing.holderId, nextMap, event, result: { ok: true, action: 'released' } };
        },
      });
    } catch (error) {
      // Release is NOT online-mandatory: a dead remote must not block feature-close.
      if (error instanceof LeaseUnavailableError || error.name === 'LeaseRetryExhaustedError') {
        return { ok: true, action: 'released_local', warning: `Could not reach remote (${remote}) to release ${opts.role} lease on ${opts.key}; TTL still covers safety. (${error.message})` };
      }
      if (error instanceof LeaseConflictError) {
        return { ok: true, action: 'released_local', warning: error.message };
      }
      throw error;
    }
  }

  async function assertLeaseAllowed(ref, options = {}) {
    const opts = resolveOpts(ref, options);
    const map = parseLeaseFile(readFileFromCommit(commitSha(branchRef), leasesPathForKey(opts.key)));
    const existing = map[opts.role];
    if (!existing || isLeaseRecordExpired(existing)) return { ok: true };
    if (existing.holderId === opts.holderId || opts.takeover) {
      return { ok: true, active: toActive(existing, opts.key, opts.role) };
    }
    throw new LeaseConflictError(conflictMessage(existing, opts.role, opts.key), toActive(existing, opts.key, opts.role));
  }

  async function readLeaseEvents(ref) {
    const key = refToLeaseKey(ref);
    return readCanonicalEvents(key).filter((e) => e.leaseKey === key || (e.type && e.type.startsWith('lease.')));
  }

  return {
    readLeases,
    acquireLease,
    renewLease,
    releaseLease,
    assertLeaseAllowed,
    readLeaseEvents,
  };
}

module.exports = { createGitBranchLeaseApi, MAX_LEASE_CAS_RETRIES };
