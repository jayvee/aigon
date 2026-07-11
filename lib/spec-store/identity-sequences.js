'use strict';

/**
 * Identity sequence registry — monotonic feature/research number allocation.
 *
 * Stored at `identity/sequences.json` on the git-branch state branch, or
 * `.aigon/state/identity-sequences.json` for the local backend. Reservations
 * are never reused; abandoned pending entries are exposed to doctor.
 */

const path = require('path');
const { getNextId } = require('../spec-crud');
const { formatDisplayKey, entityTypeFromKind } = require('../spec-identity');

const SEQUENCES_BRANCH_PATH = 'identity/sequences.json';
const SEQUENCES_LOCAL_REL = path.join('.aigon', 'state', 'identity-sequences.json');
const SCHEMA_VERSION = 1;

class IdentityAllocationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IdentityAllocationError';
  }
}

class IdentityUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IdentityUnavailableError';
  }
}

function emptySequences() {
  return {
    schemaVersion: SCHEMA_VERSION,
    feature: { next: 1, pending: {} },
    research: { next: 1, pending: {} },
  };
}

/**
 * @param {string|null|undefined} raw
 * @returns {object}
 */
function parseSequences(raw) {
  if (!raw || !String(raw).trim()) return emptySequences();
  let doc;
  try {
    doc = JSON.parse(String(raw));
  } catch (error) {
    throw new IdentityAllocationError(`Invalid identity sequences JSON: ${error.message}`);
  }
  if (!doc || typeof doc !== 'object') return emptySequences();
  const out = emptySequences();
  for (const kind of ['feature', 'research']) {
    const seq = doc[kind];
    if (!seq || typeof seq !== 'object') continue;
    const next = parseInt(seq.next, 10);
    if (Number.isInteger(next) && next >= 1) out[kind].next = next;
    if (seq.pending && typeof seq.pending === 'object') {
      out[kind].pending = { ...seq.pending };
    }
  }
  return out;
}

/**
 * @param {object} doc
 * @returns {string}
 */
function serializeSequences(doc) {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/**
 * Seed allocator high-water from existing numbered specs and engine dirs.
 *
 * @param {string} repoPath
 * @param {'feature'|'research'} kind
 * @returns {number} max existing numeric id (0 when none)
 */
function seedMaxExistingId(repoPath, kind) {
  const docsSubdir = kind === 'research' ? 'research-topics' : 'features';
  const prefix = kind === 'research' ? 'research' : 'feature';
  const { CANONICAL_STAGE_DIRS } = require('../workflow-core/paths');
  const rooted = {
    root: path.join(repoPath, 'docs', 'specs', docsSubdir),
    folders: [...CANONICAL_STAGE_DIRS],
    prefix,
  };
  try {
    return getNextId(rooted) - 1;
  } catch (_) {
    return 0;
  }
}

/**
 * Raise `next` to at least max(existing)+1 without shrinking.
 *
 * @param {object} doc
 * @param {string} repoPath
 */
function mergeSeededHighWater(doc, repoPath) {
  for (const kind of ['feature', 'research']) {
    const maxExisting = seedMaxExistingId(repoPath, kind);
    if (maxExisting >= doc[kind].next) {
      doc[kind].next = maxExisting + 1;
    }
  }
}

/**
 * Reserve the next number for `kind`. Mutates `doc`.
 *
 * @param {object} doc
 * @param {'feature'|'research'} kind
 * @returns {{ kind: 'feature'|'research', number: number, numericId: string, key: string, paddedId: string }}
 */
function reserveNextInDoc(doc, kind) {
  const normalized = entityTypeFromKind(kind);
  const seq = doc[normalized];
  if (!seq || !Number.isInteger(seq.next) || seq.next < 1) {
    throw new IdentityAllocationError(`Invalid sequence state for ${normalized}`);
  }
  const number = seq.next;
  seq.next = number + 1;
  seq.pending[String(number)] = new Date().toISOString();
  const numericId = String(number);
  const paddedId = numericId.padStart(2, '0');
  return {
    kind: normalized,
    number,
    numericId,
    paddedId,
    key: formatDisplayKey({ kind: normalized, number }),
  };
}

/**
 * @param {object} doc
 * @param {'feature'|'research'} kind
 * @param {number|string} number
 */
function markMaterializedInDoc(doc, kind, number) {
  const normalized = entityTypeFromKind(kind);
  delete doc[normalized].pending[String(number)];
}

/**
 * @param {object} doc
 * @returns {Array<{ kind: string, number: string, reservedAt: string }>}
 */
function listPendingReservations(doc) {
  const rows = [];
  for (const kind of ['feature', 'research']) {
    for (const [number, reservedAt] of Object.entries(doc[kind].pending || {})) {
      rows.push({ kind, number, reservedAt });
    }
  }
  return rows;
}

module.exports = {
  IdentityAllocationError,
  IdentityUnavailableError,
  SEQUENCES_BRANCH_PATH,
  SEQUENCES_LOCAL_REL,
  SCHEMA_VERSION,
  emptySequences,
  parseSequences,
  serializeSequences,
  seedMaxExistingId,
  mergeSeededHighWater,
  reserveNextInDoc,
  markMaterializedInDoc,
  listPendingReservations,
};
