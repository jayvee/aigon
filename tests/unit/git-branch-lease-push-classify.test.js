'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isNonFastForward } = require('../../lib/spec-store/git-branch-leases');

// REGRESSION: hook/auth push failures must not enter the CAS retry loop as NFF races.
const CASES = [
  { msg: '! [rejected]        aigon-state -> aigon-state (non-fast-forward)\nerror: failed to push some refs to \'origin\'', race: true },
  { msg: '! [rejected]        aigon-state -> aigon-state (non-fast-forward)', race: true },
  { msg: '! [rejected]        refs/heads/aigon-state -> refs/heads/aigon-state (fetch first)', race: true },
  { msg: 'error: cannot lock ref refs/heads/aigon-state: is at abc but expected def', race: true },
  { msg: 'error: stale info for refs/heads/aigon-state', race: true },
  { msg: 'remote: error: GH006: Protected branch update failed for refs/heads/main.\nremote: error: pre-receive hook declined', race: false },
  { msg: 'fatal: unable to access \'https://github.com/org/repo.git/\': The requested URL returned error: 403', race: false },
  { msg: 'error: failed to push some refs to origin', race: false },
  { msg: 'error: failed to push some refs to \'origin\' (would clobber existing tag)', race: false },
];

describe('isNonFastForward', () => {
  for (const { msg, race } of CASES) {
    it(`${race ? 'classifies as race' : 'does not classify as race'}: ${msg.split('\n')[0]}`, () => {
      assert.strictEqual(isNonFastForward(new Error(msg)), race);
    });
  }
});
