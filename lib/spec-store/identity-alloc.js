'use strict';

const { createLocalIdentityAlloc } = require('./identity-alloc-local');
const {
  reserveIdentityCasSync,
  markIdentityMaterializedCasSync,
} = require('./identity-alloc-git-branch');
const { listPendingReservations, parseSequences, SEQUENCES_BRANCH_PATH } = require('./identity-sequences');

/**
 * Attach identity reservation methods to a SpecStore instance.
 *
 * @param {object} store
 * @param {{ repoPath: string, backend: string, gitBranchCtx?: object }} options
 */
function attachIdentityAlloc(store, options) {
  const { repoPath, backend, gitBranchCtx } = options;

  if (backend === 'git-branch' && gitBranchCtx) {
    store.reserveIdentitySync = (kind) => reserveIdentityCasSync(gitBranchCtx, kind);
    store.markIdentityMaterializedSync = (kind, number) => markIdentityMaterializedCasSync(gitBranchCtx, kind, number);
    store.readIdentityPending = () => {
      const tip = gitBranchCtx.commitSha(gitBranchCtx.branchRef);
      const raw = tip ? gitBranchCtx.readFileFromCommit(tip, SEQUENCES_BRANCH_PATH) : null;
      return listPendingReservations(parseSequences(raw));
    };
    return store;
  }

  const local = createLocalIdentityAlloc(repoPath);
  store.reserveIdentitySync = local.reserveIdentitySync;
  store.markIdentityMaterializedSync = local.markIdentityMaterializedSync;
  store.readIdentityPending = local.readIdentityPending;
  return store;
}

module.exports = {
  attachIdentityAlloc,
};
