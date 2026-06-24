'use strict';

/**
 * Spec key parsing and formatting — thin re-export of lib/spec-identity.js so
 * SpecStore callers keep a stable import path without depending on store internals
 * from the identity layer (identity does not import spec-store).
 */

const specIdentity = require('../spec-identity');

module.exports = {
  SpecKeyError: specIdentity.SpecIdentityError,
  parseSpecKey: specIdentity.parseDisplayKey,
  formatSpecKey: specIdentity.formatDisplayKey,
  entityTypeFromKind: specIdentity.entityTypeFromKind,
  KIND_TO_LETTER: specIdentity.KIND_TO_LETTER,
  LETTER_TO_KIND: specIdentity.LETTER_TO_KIND,
};
