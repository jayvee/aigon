'use strict';

/**
 * git-branch CAS identity reservation (F667).
 *
 * Monotonic feature/research numbers live in `identity/sequences.json` on the
 * state branch. Each reservation is a compare-and-swap commit + FF-only push;
 * the loser refetches and retries with the updated high-water mark.
 */

const {
  SEQUENCES_BRANCH_PATH,
  IdentityUnavailableError,
  parseSequences,
  serializeSequences,
  mergeSeededHighWater,
  reserveNextInDoc,
  markMaterializedInDoc,
  listPendingReservations,
} = require('./identity-sequences');

const MAX_IDENTITY_CAS_RETRIES = 5;

/** Permanent internal test seam for deterministic two-clone interleavings. */
let identityCasTestHooks = null;

function setIdentityCasTestHooks(hooks) {
  identityCasTestHooks = hooks || null;
}

function clearIdentityCasTestHooks() {
  identityCasTestHooks = null;
}

function invokeIdentityCasTestHook(phase, payload) {
  if (!identityCasTestHooks || typeof identityCasTestHooks[phase] !== 'function') return;
  identityCasTestHooks[phase](payload);
}

function isNonFastForward(error) {
  return /non-fast-forward|fetch first|\[rejected\]|cannot lock ref|stale info/i
    .test((error && error.message) || '');
}

function sleepJitterSync(attempt) {
  const base = 20 * attempt;
  const jitter = Math.floor(Math.random() * 30);
  const start = Date.now();
  while (Date.now() - start < base + jitter) { /* spin */ }
}

function readSequencesFromTip(tip, readFileFromCommit, repoPath) {
  const raw = tip ? readFileFromCommit(tip, SEQUENCES_BRANCH_PATH) : null;
  const doc = parseSequences(raw);
  mergeSeededHighWater(doc, repoPath);
  return doc;
}

/**
 * Align local branch tip to the fetched remote tracking ref before CAS.
 *
 * @param {object} ctx
 */
function alignToRemoteTip(ctx) {
  const { branchRef, trackingRef, commitSha, resetBranchTo } = ctx;
  const remoteTip = commitSha(trackingRef);
  const localTip = commitSha(branchRef);
  if (remoteTip && remoteTip !== localTip) {
    resetBranchTo(remoteTip);
  }
}

/**
 * Sync CAS reservation loop — used by CLI create paths.
 *
 * @param {object} ctx
 * @param {'feature'|'research'} kind
 */
function reserveIdentityCasSync(ctx, kind) {
  const {
    repoPath,
    remote,
    offline,
    branchRef,
    trackingRef,
    commitSha,
    readFileFromCommit,
    commitUpdates,
    fetchStateBranch,
    pushStateBranch,
    resetBranchTo,
    advanceTrackingRefToTip,
    writeSyncState,
  } = ctx;

  if (offline) {
    throw new IdentityUnavailableError(
      'Cannot allocate an official numeric ID while storage.git.offline is true.',
      remote,
    );
  }

  for (let attempt = 1; attempt <= MAX_IDENTITY_CAS_RETRIES; attempt += 1) {
    try {
      fetchStateBranch();
    } catch (error) {
      throw new IdentityUnavailableError(
        `Cannot reach remote (${remote}) to reserve a ${kind} ID: ${error.message}.`,
        remote,
      );
    }

    alignToRemoteTip(ctx);
    invokeIdentityCasTestHook('afterFetch', { repoPath, kind, attempt });

    const baseTip = commitSha(branchRef);
    const doc = readSequencesFromTip(baseTip, readFileFromCommit, repoPath);
    const reserved = reserveNextInDoc(doc, kind);
    const updates = { [SEQUENCES_BRANCH_PATH]: serializeSequences(doc) };
    commitUpdates(updates, [], `aigon-specstore: reserve ${reserved.key}`);
    invokeIdentityCasTestHook('beforePush', { repoPath, kind, attempt, reserved });

    try {
      pushStateBranch();
      advanceTrackingRefToTip();
      writeSyncState({ lastSyncAt: new Date().toISOString(), lastError: null });
      invokeIdentityCasTestHook('afterPush', { repoPath, kind, attempt, reserved });
      return reserved;
    } catch (pushError) {
      if (!isNonFastForward(pushError)) {
        throw new IdentityUnavailableError(
          `Failed to publish identity reservation to remote (${remote}): ${pushError.message}.`,
          remote,
        );
      }
      try {
        fetchStateBranch();
      } catch (fetchError) {
        throw new IdentityUnavailableError(
          `Lost remote (${remote}) during identity reservation retry: ${fetchError.message}.`,
          remote,
        );
      }
      const newRemoteTip = commitSha(trackingRef);
      if (newRemoteTip) resetBranchTo(newRemoteTip);
      if (attempt < MAX_IDENTITY_CAS_RETRIES) sleepJitterSync(attempt);
    }
  }

  const error = new IdentityUnavailableError(
    `Identity reservation for ${kind} exhausted ${MAX_IDENTITY_CAS_RETRIES} CAS attempts. Retry the command.`,
    remote,
  );
  error.retryable = true;
  throw error;
}

function markIdentityMaterializedCasSync(ctx, kind, number) {
  const {
    remote,
    offline,
    branchRef,
    commitSha,
    readFileFromCommit,
    commitUpdates,
    fetchStateBranch,
    pushStateBranch,
    resetBranchTo,
    advanceTrackingRefToTip,
    writeSyncState,
    repoPath,
    trackingRef,
  } = ctx;

  if (offline) return { ok: true, skipped: true };

  for (let attempt = 1; attempt <= MAX_IDENTITY_CAS_RETRIES; attempt += 1) {
    try {
      fetchStateBranch();
    } catch (_) {
      return { ok: false, skipped: true };
    }
    alignToRemoteTip(ctx);

    const baseTip = commitSha(branchRef);
    const doc = readSequencesFromTip(baseTip, readFileFromCommit, repoPath);
    markMaterializedInDoc(doc, kind, number);
    commitUpdates(
      { [SEQUENCES_BRANCH_PATH]: serializeSequences(doc) },
      [],
      `aigon-specstore: materialize ${kind} ${number}`,
    );

    try {
      pushStateBranch();
      advanceTrackingRefToTip();
      writeSyncState({ lastSyncAt: new Date().toISOString(), lastError: null });
      return { ok: true };
    } catch (pushError) {
      if (!isNonFastForward(pushError)) return { ok: false, error: pushError.message };
      try { fetchStateBranch(); } catch (_) { return { ok: false }; }
      const newRemoteTip = commitSha(trackingRef);
      if (newRemoteTip) resetBranchTo(newRemoteTip);
    }
  }
  return { ok: false, retryable: true };
}

module.exports = {
  reserveIdentityCasSync,
  markIdentityMaterializedCasSync,
  setIdentityCasTestHooks,
  clearIdentityCasTestHooks,
  MAX_IDENTITY_CAS_RETRIES,
  readSequencesFromTip,
  listPendingReservations,
};
