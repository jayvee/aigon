'use strict';

/**
 * Spec key parsing and formatting.
 *
 * Canonical keys: `F42` (feature #42), `R43` (research #43).
 */

const KIND_TO_LETTER = Object.freeze({ feature: 'F', research: 'R' });
const LETTER_TO_KIND = Object.freeze({ F: 'feature', R: 'research' });

class SpecKeyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SpecKeyError';
  }
}

/**
 * @param {string} key
 * @returns {{ key: string, kind: 'feature'|'research', letter: 'F'|'R', number: number }}
 */
function parseSpecKey(key) {
  if (typeof key !== 'string' || !key.trim()) {
    throw new SpecKeyError('Spec key must be a non-empty string');
  }
  const trimmed = key.trim();
  const match = trimmed.match(/^([FR])(\d+)$/);
  if (!match) {
    throw new SpecKeyError(`Malformed spec key: ${JSON.stringify(key)}`);
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
 * @param {{ kind: 'feature'|'research', number: number }} parsed
 * @returns {string}
 */
function formatSpecKey(parsed) {
  const letter = KIND_TO_LETTER[parsed.kind];
  if (!letter) {
    throw new SpecKeyError(`Unknown spec kind: ${JSON.stringify(parsed.kind)}`);
  }
  if (!Number.isInteger(parsed.number) || parsed.number < 0) {
    throw new SpecKeyError(`Spec number must be a non-negative integer`);
  }
  return `${letter}${parsed.number}`;
}

/**
 * @param {'feature'|'research'} kind
 * @returns {'feature'|'research'}
 */
function entityTypeFromKind(kind) {
  return kind === 'research' ? 'research' : 'feature';
}

module.exports = {
  SpecKeyError,
  parseSpecKey,
  formatSpecKey,
  entityTypeFromKind,
  KIND_TO_LETTER,
  LETTER_TO_KIND,
};
