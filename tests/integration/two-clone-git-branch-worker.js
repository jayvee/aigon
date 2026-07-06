'use strict';

process.on('message', async (msg) => {
  if (!msg || msg.cmd !== 'acquire') process.exit(2);
  try {
    const { createGitBranchBackend } = require('../../lib/spec-store/git-branch-backend');
    const { LeaseConflictError } = require('../../lib/spec-store/leases');
    const store = createGitBranchBackend(msg.repo, { remote: 'origin', branch: 'aigon-state', offline: false });
    const ref = { entityType: 'feature', entityId: String(msg.featureId) };
    try {
      const result = await store.acquireLease(ref, {
        role: 'impl',
        agentId: msg.agentId,
        holderId: msg.holderId,
      });
      process.stdout.write(JSON.stringify({ ok: true, holderId: msg.holderId, result }));
      process.exit(0);
    } catch (error) {
      if (error instanceof LeaseConflictError) {
        process.stdout.write(JSON.stringify({
          ok: false,
          error: error.name,
          holderId: error.activeLease && error.activeLease.holderId,
        }));
        process.exit(0);
      }
      throw error;
    }
  } catch (error) {
    console.error(error.stack || error.message);
    process.exit(1);
  }
});
