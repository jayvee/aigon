'use strict';

const { parseSpecKey, entityTypeFromKind } = require('./spec-key');

/**
 * Normalize a SpecStore entity reference — display key (`F42`) or workflow address.
 *
 * @param {string | { entityType: string, entityId: string }} ref
 * @returns {{ entityType: 'feature'|'research', entityId: string }}
 */
function normalizeEntityRef(ref) {
  if (typeof ref === 'string') {
    const parsed = parseSpecKey(ref);
    return {
      entityType: entityTypeFromKind(parsed.kind),
      entityId: String(parsed.number),
    };
  }
  if (ref && (ref.entityType === 'feature' || ref.entityType === 'research') && ref.entityId != null) {
    return { entityType: ref.entityType, entityId: String(ref.entityId) };
  }
  throw new Error('Invalid SpecStore entity reference');
}

module.exports = { normalizeEntityRef };
