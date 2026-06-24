'use strict';

/**
 * Repo-wide spec identity — display keys (`F42`, `R43`) over per-kind numeric IDs.
 *
 * Workflow/engine state keeps numeric IDs unchanged; this module is the single
 * parse/format/resolver boundary for user-facing keys and CLI input.
 *
 * Migration: existing `feature-<n>-…` / `research-<n>-…` filenames and numeric
 * workflow dirs are unchanged. `F<n>` / `R<n>` are presentation aliases only.
 */

const KIND_TO_LETTER = Object.freeze({ feature: 'F', research: 'R' });
const LETTER_TO_KIND = Object.freeze({ F: 'feature', R: 'research' });

const DISPLAY_KEY_RE = /^([FR])([1-9]\d*)$/;
const LEGACY_PREFIX_RE = /^(feature|research)-([1-9]\d*)$/;
const BARE_NUMERIC_RE = /^[1-9]\d*$/;

class SpecIdentityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SpecIdentityError';
  }
}

/**
 * @param {{ kind: 'feature'|'research', number: number }} parts
 * @returns {string}
 */
function formatDisplayKey(parts) {
  const letter = KIND_TO_LETTER[parts.kind];
  if (!letter) {
    throw new SpecIdentityError(`Unknown spec kind: ${JSON.stringify(parts.kind)}`);
  }
  if (!Number.isInteger(parts.number) || parts.number < 1) {
    throw new SpecIdentityError('Spec number must be a positive integer');
  }
  return `${letter}${parts.number}`;
}

/**
 * Parse a canonical display key (`F42`, `R43`).
 *
 * @param {string} key
 * @returns {{ key: string, kind: 'feature'|'research', letter: 'F'|'R', number: number }}
 */
function parseDisplayKey(key) {
  if (typeof key !== 'string' || !key.trim()) {
    throw new SpecIdentityError('Spec key must be a non-empty string');
  }
  const trimmed = key.trim();
  const match = trimmed.match(DISPLAY_KEY_RE);
  if (!match) {
    throw new SpecIdentityError(`Malformed spec key: ${JSON.stringify(key)}`);
  }
  const letter = match[1];
  return {
    key: trimmed,
    kind: LETTER_TO_KIND[letter],
    letter,
    number: parseInt(match[2], 10),
  };
}

/**
 * @param {'feature'|'research'} kind
 * @returns {'feature'|'research'}
 */
function entityTypeFromKind(kind) {
  return kind === 'research' ? 'research' : 'feature';
}

/**
 * Build a full identity record for a prioritised spec.
 *
 * @param {{ kind: 'feature'|'research', number: number, slug?: string|null }} parts
 * @returns {{ key: string, number: number, kind: 'feature'|'research', slug: string|null, numericId: string }}
 */
function buildSpecIdentity(parts) {
  const kind = entityTypeFromKind(parts.kind);
  const number = parts.number;
  const slug = parts.slug == null ? null : String(parts.slug);
  return {
    key: formatDisplayKey({ kind, number }),
    number,
    kind,
    slug,
    numericId: String(number),
  };
}

/**
 * Extract identity fields from a spec filename.
 *
 * @param {string} filename
 * @returns {{ kind: 'feature'|'research', number: number|null, slug: string|null }|null}
 */
function parseSpecFilename(filename) {
  const base = String(filename || '').trim();
  if (!base.endsWith('.md')) return null;
  const stem = base.slice(0, -3);
  const featureNumeric = stem.match(/^feature-(\d+)-(.+)$/);
  if (featureNumeric) {
    return {
      kind: 'feature',
      number: parseInt(featureNumeric[1], 10),
      slug: featureNumeric[2],
    };
  }
  const researchNumeric = stem.match(/^research-(\d+)-(.+)$/);
  if (researchNumeric) {
    return {
      kind: 'research',
      number: parseInt(researchNumeric[1], 10),
      slug: researchNumeric[2],
    };
  }
  const featureSlug = stem.match(/^feature-(.+)$/);
  if (featureSlug && !/^\d+$/.test(featureSlug[1])) {
    return { kind: 'feature', number: null, slug: featureSlug[1] };
  }
  const researchSlug = stem.match(/^research-(.+)$/);
  if (researchSlug && !/^\d+$/.test(researchSlug[1])) {
    return { kind: 'research', number: null, slug: researchSlug[1] };
  }
  return null;
}

/**
 * Resolve user/CLI input to a spec identity.
 *
 * Accepts: `F575`, `R43`, `feature-575`, `research-43`, bare `575` (requires
 * `options.kind`). At kind-agnostic call sites bare numerics throw rather than
 * guess.
 *
 * @param {string} input
 * @param {{ kind?: 'feature'|'research' }} [options]
 * @returns {{ key: string, number: number, kind: 'feature'|'research', slug: string|null, numericId: string }}
 */
function resolveSpecIdentity(input, options = {}) {
  const raw = String(input || '').trim();
  if (!raw) {
    throw new SpecIdentityError('Spec identity input must be a non-empty string');
  }

  if (DISPLAY_KEY_RE.test(raw)) {
    const parsed = parseDisplayKey(raw);
    if (options.kind && parsed.kind !== entityTypeFromKind(options.kind)) {
      throw new SpecIdentityError(
        `Spec key ${parsed.key} is ${parsed.kind} but caller expected ${entityTypeFromKind(options.kind)}`
      );
    }
    return buildSpecIdentity({ kind: parsed.kind, number: parsed.number, slug: null });
  }

  const legacy = raw.match(LEGACY_PREFIX_RE);
  if (legacy) {
    const kind = legacy[1] === 'research' ? 'research' : 'feature';
    const number = parseInt(legacy[2], 10);
    if (options.kind && kind !== entityTypeFromKind(options.kind)) {
      throw new SpecIdentityError(
        `Legacy id ${raw} is ${kind} but caller expected ${entityTypeFromKind(options.kind)}`
      );
    }
    return buildSpecIdentity({ kind, number, slug: null });
  }

  if (BARE_NUMERIC_RE.test(raw)) {
    if (!options.kind) {
      throw new SpecIdentityError(
        `Ambiguous bare numeric id ${raw}: pass options.kind ('feature' or 'research')`
      );
    }
    const kind = entityTypeFromKind(options.kind);
    return buildSpecIdentity({ kind, number: parseInt(raw, 10), slug: null });
  }

  throw new SpecIdentityError(`Unrecognized spec identity: ${JSON.stringify(input)}`);
}

/**
 * Normalize resolver output to the workflow numeric id string used by engine paths.
 *
 * @param {string} input
 * @param {{ kind?: 'feature'|'research' }} [options]
 * @returns {string}
 */
function resolveNumericId(input, options = {}) {
  return resolveSpecIdentity(input, options).numericId;
}

/**
 * Try to resolve input; return null when the format is not an identity reference
 * (e.g. slug-only inbox names).
 *
 * @param {string} input
 * @param {{ kind?: 'feature'|'research' }} [options]
 * @returns {{ key: string, number: number, kind: 'feature'|'research', slug: string|null, numericId: string }|null}
 */
function tryResolveSpecIdentity(input, options = {}) {
  try {
    return resolveSpecIdentity(input, options);
  } catch (_) {
    return null;
  }
}

module.exports = {
  SpecIdentityError,
  KIND_TO_LETTER,
  LETTER_TO_KIND,
  formatDisplayKey,
  parseDisplayKey,
  entityTypeFromKind,
  buildSpecIdentity,
  parseSpecFilename,
  resolveSpecIdentity,
  resolveNumericId,
  tryResolveSpecIdentity,
};
